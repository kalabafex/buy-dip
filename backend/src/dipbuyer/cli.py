"""Command-line helpers: ``python -m dipbuyer.cli {hash-pw,gen-totp,backtest,openapi}``."""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import getpass
import json
import sys
from decimal import Decimal
from pathlib import Path

import pyotp

from dipbuyer.api.security import hash_password
from dipbuyer.backtest import WARMUP_CALENDAR_DAYS, BacktestResult, default_rule, run_backtest
from dipbuyer.domain.enums import TradingMode
from dipbuyer.domain.models import Bar


def _out(text: str) -> None:
    sys.stdout.write(text + "\n")


def cmd_hash_pw(_: argparse.Namespace) -> int:
    pw = getpass.getpass("Password: ")
    if pw != getpass.getpass("Repeat: "):
        _out("passwords do not match")
        return 1
    if len(pw) < 12:
        _out("use at least 12 characters")
        return 1
    _out(f"APP_ADMIN_PASSWORD_HASH='{hash_password(pw)}'")
    return 0


def cmd_gen_totp(args: argparse.Namespace) -> int:
    secret = pyotp.random_base32()
    uri = pyotp.TOTP(secret).provisioning_uri(name=args.username, issuer_name="Dip Buyer")
    _out(f"APP_TOTP_SECRET={secret}")
    _out(f"otpauth URL: {uri}")
    return 0


def load_csv_bars(path: Path) -> list[Bar]:
    with path.open() as fh:
        return [
            Bar(
                symbol=r["symbol"],
                session_date=dt.date.fromisoformat(r["session_date"]),
                open=Decimal(r["open"]),
                high=Decimal(r["high"]),
                low=Decimal(r["low"]),
                close=Decimal(r["close"]),
                volume=Decimal(r["volume"]),
            )
            for r in csv.DictReader(fh)
        ]


def format_result(r: BacktestResult) -> str:
    rows = [
        ("", "Rule", "Monthly DCA"),
        ("Total invested", r.rule.total_invested, r.baseline.total_invested),
        ("Final value", r.rule.final_value, r.baseline.final_value),
        ("Return %", r.rule.return_pct, r.baseline.return_pct),
        ("Max drawdown %", r.rule.max_drawdown_pct, r.baseline.max_drawdown_pct),
        ("Buys", r.rule.num_buys, r.baseline.num_buys),
        ("Average cost", r.rule.avg_cost, r.baseline.avg_cost),
    ]

    def fmt(v: object) -> str:
        if isinstance(v, Decimal):
            return f"{v:,.2f}"
        return "-" if v is None else str(v)

    lines = [f"{r.symbol} {r.start_date} -> {r.end_date}, starting cash {r.starting_cash:,.2f}"]
    lines += [f"{a:<16}{fmt(b):>16}{fmt(c):>16}" for a, b, c in rows]
    lines.append("Decisions: " + ", ".join(f"{k}={v}" for k, v in r.decisions.items()))
    return "\n".join(lines)


def cmd_backtest(args: argparse.Namespace) -> int:
    start = dt.date.fromisoformat(args.start)
    end = dt.date.fromisoformat(args.end)
    symbol = args.symbol.upper()
    if args.csv:
        bars = [b for b in load_csv_bars(Path(args.csv)) if b.symbol == symbol]
    else:
        from dipbuyer.config import get_settings  # noqa: PLC0415 - only needed for Alpaca
        from dipbuyer.data.market_data import AlpacaMarketData  # noqa: PLC0415

        env = get_settings()
        key, secret = env.alpaca_keys(TradingMode.PAPER)  # data only
        md = AlpacaMarketData(key, secret, env.alpaca_data_feed)
        bars = md.get_daily_bars(symbol, start - dt.timedelta(days=WARMUP_CALENDAR_DAYS), end)
    result = run_backtest(default_rule(symbol), bars, start, end, Decimal(args.cash))
    if args.json:
        _out(json.dumps(result.to_json(), indent=2))
    else:
        _out(format_result(result))
    return 0


def cmd_openapi(args: argparse.Namespace) -> int:
    from dipbuyer.api.openapi import export_openapi  # noqa: PLC0415

    Path(args.out).write_text(json.dumps(export_openapi(), indent=2, sort_keys=True) + "\n")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="dipbuyer")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("hash-pw").set_defaults(fn=cmd_hash_pw)
    g = sub.add_parser("gen-totp")
    g.add_argument("--username", default="admin")
    g.set_defaults(fn=cmd_gen_totp)
    b = sub.add_parser("backtest")
    b.add_argument("symbol")
    b.add_argument("start")
    b.add_argument("end")
    b.add_argument("--cash", default="10000")
    b.add_argument("--csv", help="read bars from a CSV instead of Alpaca")
    b.add_argument("--json", action="store_true")
    b.set_defaults(fn=cmd_backtest)
    o = sub.add_parser("openapi")
    o.add_argument("--out", default="openapi.json")
    o.set_defaults(fn=cmd_openapi)
    args = p.parse_args(argv)
    return int(args.fn(args))


if __name__ == "__main__":
    sys.exit(main())

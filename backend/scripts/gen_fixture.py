"""Generate the deterministic synthetic daily-bar fixture used by backtest tests.

Run: uv run python scripts/gen_fixture.py > tests/fixtures/SYNTH_daily.csv
"""

from __future__ import annotations

import datetime as dt
import sys

import numpy as np

from dipbuyer.data.calendar import sessions_between


def main() -> None:
    rng = np.random.default_rng(20240101)
    days = sessions_between(dt.date(2020, 1, 2), dt.date(2023, 12, 29))
    price = 100.0
    out = ["symbol,session_date,open,high,low,close,volume"]
    for i, d in enumerate(days):
        drift = 0.0004
        vol = 0.018
        # A few scripted sell-offs so the rule has dips to buy.
        if 300 <= i < 315 or 620 <= i < 640 or 900 <= i < 908:
            drift = -0.012
        ret = drift + vol * float(rng.standard_normal())
        open_ = price * (1 + 0.004 * float(rng.standard_normal()))
        close = price * (1 + ret)
        high = max(open_, close) * (1 + abs(0.006 * float(rng.standard_normal())))
        low = min(open_, close) * (1 - abs(0.006 * float(rng.standard_normal())))
        vol_shares = int(1_000_000 * (1 + abs(float(rng.standard_normal()))))
        out.append(
            f"SYNTH,{d.isoformat()},{open_:.2f},{high:.2f},{low:.2f},{close:.2f},{vol_shares}"
        )
        price = round(close, 2)
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()

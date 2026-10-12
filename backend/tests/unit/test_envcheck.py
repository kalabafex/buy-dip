from __future__ import annotations

from pathlib import Path

from dipbuyer.envcheck import check_env_file

GOOD = (
    "DATABASE_URL=postgresql+psycopg://dipbuyer:dipbuyer@db:5432/dipbuyer\n"
    "ALPACA_PAPER_KEY_ID=PK\nALPACA_PAPER_SECRET=SK\n"
    "APP_ADMIN_PASSWORD_HASH='$argon2id$v=19$m=65536,t=3,p=4$abc$def'\n"
    "APP_TOTP_SECRET=JBSWY3DPEHPK3PXP\n"
    f"SESSION_SECRET={'a' * 64}\n"
)


def write(tmp_path: Path, text: str) -> Path:
    p = tmp_path / ".env"
    p.write_text(text)
    return p


def test_good_env(tmp_path: Path) -> None:
    r = check_env_file(write(tmp_path, GOOD))
    assert r.ok and not r.warnings


def test_missing_file(tmp_path: Path) -> None:
    assert not check_env_file(tmp_path / ".env").ok


def test_short_or_empty_session_secret(tmp_path: Path) -> None:
    r = check_env_file(write(tmp_path, GOOD + "SESSION_SECRET=short\n"))
    assert any("SESSION_SECRET is 5 characters" in e for e in r.errors)
    assert any("set 2 times" in w for w in r.warnings)
    r = check_env_file(
        write(tmp_path, GOOD.replace(f"SESSION_SECRET={'a' * 64}", "SESSION_SECRET="))
    )
    assert any(e.startswith("SESSION_SECRET is empty") for e in r.errors)


def test_unquoted_hash_and_bad_totp(tmp_path: Path) -> None:
    text = GOOD.replace("'$argon2id$v=19$m=65536,t=3,p=4$abc$def'", "$argon2id$v=19$abc").replace(
        "JBSWY3DPEHPK3PXP", "not-base32!"
    )
    r = check_env_file(write(tmp_path, text))
    assert any("single quotes" in e for e in r.errors)
    assert any("base32" in e for e in r.errors)


def test_inline_comment_and_missing_keys_warn(tmp_path: Path) -> None:
    text = GOOD.replace("ALPACA_PAPER_KEY_ID=PK", "ALPACA_PAPER_KEY_ID=   # later") + "X=1 # note\n"
    r = check_env_file(write(tmp_path, text))
    assert r.ok
    assert any("inline" in w for w in r.warnings)
    assert any("Alpaca paper keys" in w for w in r.warnings)


def test_crlf_and_bom(tmp_path: Path) -> None:
    p = tmp_path / ".env"
    p.write_bytes(b"\xef\xbb\xbf" + GOOD.replace("\n", "\r\n").encode())
    assert check_env_file(p).ok


def test_fill_env_text_replaces_first_drops_duplicates_appends_missing() -> None:
    from dipbuyer.envcheck import fill_env_text

    text = "# comment\nSESSION_SECRET=\nA=1\nSESSION_SECRET=\n"
    out = fill_env_text(
        text, {"SESSION_SECRET": "s" * 40, "APP_ADMIN_PASSWORD_HASH": "$argon2id$x"}
    )
    assert out == (
        f"# comment\nSESSION_SECRET={'s' * 40}\nA=1\nAPP_ADMIN_PASSWORD_HASH='$argon2id$x'\n"
    )


def test_init_env_creates_and_fills(tmp_path: Path, monkeypatch: object) -> None:
    import getpass

    import pytest

    from dipbuyer import cli

    mp: pytest.MonkeyPatch = monkeypatch  # type: ignore[assignment]
    mp.setattr(getpass, "getpass", lambda _prompt="": "a-long-password-123")
    example = tmp_path / ".env.example"
    example.write_text(Path(__file__).parents[3].joinpath(".env.example").read_text())
    env = tmp_path / ".env"
    assert cli.main(["init-env", str(env), "--example", str(example)]) == 0
    r = check_env_file(env)
    assert r.ok
    first = env.read_text()
    # running again changes nothing
    assert cli.main(["init-env", str(env), "--example", str(example)]) == 0
    assert env.read_text() == first

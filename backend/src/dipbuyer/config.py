from __future__ import annotations

from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from dipbuyer.domain.enums import TradingMode


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    database_url: str = "postgresql+psycopg://dipbuyer:dipbuyer@localhost:5432/dipbuyer"
    alpaca_paper_key_id: SecretStr = SecretStr("")
    alpaca_paper_secret: SecretStr = SecretStr("")
    alpaca_live_key_id: SecretStr = SecretStr("")
    alpaca_live_secret: SecretStr = SecretStr("")
    alpaca_data_feed: str = Field(default="iex", pattern="^(iex|sip)$")
    app_admin_username: str = "admin"
    app_admin_password_hash: SecretStr = SecretStr("")
    app_totp_secret: SecretStr = SecretStr("")
    session_secret: SecretStr = SecretStr("")
    session_cookie_secure: bool = True
    ntfy_topic_url: str = ""
    heartbeat_url: str = ""
    cors_origin: str = "http://localhost:5173"
    dry_run: bool = False
    log_level: str = "INFO"

    def alpaca_keys(self, mode: TradingMode) -> tuple[str, str]:
        """Return (key_id, secret). Live keys are only read when ``mode`` is LIVE."""
        if mode is TradingMode.LIVE:
            return (
                self.alpaca_live_key_id.get_secret_value(),
                self.alpaca_live_secret.get_secret_value(),
            )
        return (
            self.alpaca_paper_key_id.get_secret_value(),
            self.alpaca_paper_secret.get_secret_value(),
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()

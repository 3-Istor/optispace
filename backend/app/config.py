from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    db_enabled: bool = True
    db_type: str = "sqlite"
    sqlite_path: str = "./app.db"
    db_host: str = "db"
    db_port: int = 5432
    db_name: str = "app_db"
    db_user: str = "postgres"
    db_password: str = "postgres"

    oidc_issuer: str = ""
    fm_group: str = "facility-managers"
    # Groups of the platform team: no company, no business data. Read as JSON from STAFF_GROUPS.
    staff_groups: list[str] = ["project-admins", "project-members"]
    # Local dev only, JSON claims {"sub", "email", "name", "groups", "organization"}: skips token checks. Ignored when oidc_issuer is set.
    dev_fake_user: str = ""
    device_api_key: str = ""
    # Off by default so prod refuses simulator data; dev, tests and staging turn it on.
    allow_simulated_telemetry: bool = False
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:support@3istor.com"
    gemini_api_key: SecretStr = SecretStr("")
    gemini_model: str = "gemini-3.5-flash-lite"

    model_config = SettingsConfigDict(env_file=("../.env", ".env"), env_file_encoding="utf-8")

    @property
    def database_url(self) -> str | None:
        if not self.db_enabled:
            return None

        if self.db_type == "sqlite":
            return f"sqlite:///{self.sqlite_path}"

        if self.db_type == "postgres":
            return (
                f"postgresql+psycopg://{self.db_user}:{self.db_password}"
                f"@{self.db_host}:{self.db_port}/{self.db_name}"
            )

        raise ValueError(f"Unsupported DB_TYPE: {self.db_type}")


@lru_cache
def get_settings() -> Settings:
    return Settings()

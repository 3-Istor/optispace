from functools import lru_cache
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
    fm_group: str = "project-admins"
    # Local dev only, JSON claims {"sub", "email", "name", "groups"}: skips token checks. Ignored when oidc_issuer is set.
    dev_fake_user: str = ""
    device_api_key: str = ""
    # Off by default so prod refuses simulator data; dev, tests and staging turn it on.
    allow_simulated_telemetry: bool = False
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:support@3istor.com"

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

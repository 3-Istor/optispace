import enum
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, TypeDecorator, create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import get_settings

settings = get_settings()
DATABASE_URL = settings.database_url

engine = None
SessionLocal = None


class UTCDateTime(TypeDecorator):
    """timestamptz read and written as aware UTC; SQLite would return naive values."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetime")
        return value.astimezone(timezone.utc)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


class Base(DeclarativeBase):
    type_annotation_map = {
        datetime: UTCDateTime(),
        # Enum values as VARCHAR(32) on every database; the margin lets a longer value come without a migration.
        enum.Enum: Enum(enum.Enum, native_enum=False, length=32, values_callable=lambda e: [m.value for m in e]),
    }


if DATABASE_URL:
    connect_args = {"check_same_thread": False} if settings.db_type == "sqlite" else {}
    engine = create_engine(DATABASE_URL, connect_args=connect_args)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def is_database_enabled() -> bool:
    return DATABASE_URL is not None


def check_database_connection() -> bool:
    if engine is None:
        return False

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except Exception:
        return False

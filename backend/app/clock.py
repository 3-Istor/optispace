from datetime import datetime, timezone


def now() -> datetime:
    """The only source of "now". Call it as `clock.now()` (in column defaults
    through a lambda) so tests can patch it."""
    return datetime.now(timezone.utc)

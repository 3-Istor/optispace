from sqlalchemy.orm import Session

from app.models import OrgSettings

DEFAULTS = {"absence_delay_min": 10, "booth_min_min": 15, "booth_max_min": 60, "meeting_min_min": 30, "meeting_max_min": 180}


def get(db: Session, organization: str) -> OrgSettings:
    """The company's row, or a transient one with the defaults (never added to the session)."""
    return db.get(OrgSettings, organization) or OrgSettings(organization=organization, **DEFAULTS)


def save(db: Session, organization: str, changes: dict) -> OrgSettings:
    row = get(db, organization)
    for field, value in changes.items():
        setattr(row, field, value)
    db.add(row)
    db.commit()
    return row

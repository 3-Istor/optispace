import base64
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import AwareDatetime
from sqlalchemy.orm import Session

from app import clock
from app.database import get_db
from app.models import AppUser
from app.security import require_fm
from app.services import report_pdf, reports

router = APIRouter(tags=["reports"])


@router.post("/reports/usage")
def generate_usage_report(
    frm: AwareDatetime = Query(alias="from"),
    to: AwareDatetime = Query(),
    start_hour: int = Query(default=9, ge=0, le=23),
    end_hour: int = Query(default=18, ge=1, le=24),
    weekdays_only: bool = True,
    space_id: list[UUID] | None = Query(default=None),
    user: AppUser = Depends(require_fm),
    db: Session = Depends(get_db),
):
    """A manual generation returns facts and a PDF of that same immutable response snapshot."""
    result = reports.compute(db, user.organization, frm, to, clock.now(), start_hour, end_hour, weekdays_only, space_id)
    result["pdf_base64"] = base64.b64encode(report_pdf.render(result)).decode("ascii")
    return result

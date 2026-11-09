from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import AwareDatetime
from sqlalchemy.orm import Session

from app import clock
from app.database import get_db
from app.models import AppUser
from app.security import member, require_fm
from app.services import booking, insights

router = APIRouter(tags=["insights"], dependencies=[Depends(member)])


@router.get("/spaces/{space_id}/insights")
def read_insights(
    space_id: UUID,
    frm: AwareDatetime = Query(alias="from"),
    to: AwareDatetime = Query(),
    user: AppUser = Depends(require_fm),
    db: Session = Depends(get_db),
):
    """IOT-36 §6.2 as is; 400 INVALID_PERIOD for bounds off the minute or from >= to."""
    booking.space_in(db, space_id, user.organization)
    return insights.compute(db, space_id, frm, to, clock.now())

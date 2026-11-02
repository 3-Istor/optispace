from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import AwareDatetime
from sqlalchemy.orm import Session

from app import clock
from app.database import get_db
from app.security import require_fm
from app.services import insights

router = APIRouter(tags=["insights"])


@router.get("/spaces/{space_id}/insights", dependencies=[Depends(require_fm)])
def read_insights(
    space_id: UUID,
    frm: AwareDatetime = Query(alias="from"),
    to: AwareDatetime = Query(),
    db: Session = Depends(get_db),
):
    """IOT-36 §6.2 as is; 400 INVALID_PERIOD for bounds off the minute or from >= to."""
    return insights.compute(db, space_id, frm, to, clock.now())

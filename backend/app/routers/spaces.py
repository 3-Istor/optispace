import datetime as dt
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AwareDatetime
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import clock
from app.database import get_db
from app.models import AbsenceEpisode, AppUser, Observation, Reservation, Space, SpaceStatus
from app.models.enums import ReservationStatus, SpaceType
from app.schemas.spaces import (
    CurrentReservation, DayReservation, EpisodeOut, History, HistoryReservation, ObservationOut, SpaceDetail, SpaceIn,
    SpaceOut, SpacePatch,
)
from app.security import current_user, get_app_user, is_fm, require_fm
from app.services import absence, booking, devices, occupancy
from app.services.notifications import PARIS

router = APIRouter(tags=["spaces"])

FIELDS = ("id", "name", "type", "description", "capacity", "floor", "equipment", "is_active")


def _name(db: Session, user_id: UUID) -> str | None:
    user = db.get(AppUser, user_id)
    return user.display_name or user.email


def _evaluate(db: Session, spaces: list[Space], now: dt.datetime) -> None:
    """Absence deadlines are evaluated by the requests that read a space (no background job)."""
    for space in sorted(spaces, key=lambda s: s.id):  # a fixed order keeps row locks deadlock-free
        absence.evaluate_space(db, space.id, now)
    db.commit()


def space_out(db: Session, space: Space, now: dt.datetime, fm: bool) -> SpaceOut:
    lo, hi = booking.duration_bounds(db, space)
    status = db.get(SpaceStatus, space.id)
    current = None
    if r := booking.current_reservation(db, space.id, now):
        episode = booking.pending_episode(db, r.id)
        current = CurrentReservation(
            id=r.id, start_at=r.start_at, end_at=r.end_at, release_at=episode.deadline_at if episode else None,
            booker_name=_name(db, r.user_id) if fm else None,
        )
    return SpaceOut(
        **{field: getattr(space, field) for field in FIELDS}, min_duration_min=lo, max_duration_min=hi,
        min_duration_override=space.min_duration_min if fm else None,
        max_duration_override=space.max_duration_min if fm else None,
        space_state=occupancy.space_state(db, space, now),
        occupancy_fresh_at=status.last_observation_at if status else None, current_reservation=current,
    )


def _space(db: Session, space_id: UUID, fm: bool) -> Space:
    space = db.get(Space, space_id)
    if space is None or not (space.is_active or fm):
        raise HTTPException(status_code=404, detail="SPACE_NOT_FOUND")
    return space


@router.get("/spaces", response_model=list[SpaceOut])
def list_spaces(
    type: SpaceType | None = None,
    min_capacity: int | None = None,
    floor: int | None = None,
    equipment: list[str] = Query(default=[]),
    claims: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Inactive spaces only for facility managers; a space has every `equipment` asked."""
    now, fm = clock.now(), is_fm(claims)
    spaces = booking.find_spaces(db, type, min_capacity, floor, equipment, active_only=not fm)
    devices.notify_offline(db, now)  # committed by _evaluate
    _evaluate(db, spaces, now)
    return [space_out(db, s, now, fm) for s in spaces]


@router.get("/spaces/availability", response_model=list[SpaceOut])
def availability(
    start_at: AwareDatetime,
    end_at: AwareDatetime,
    type: SpaceType | None = None,
    min_capacity: int | None = None,
    floor: int | None = None,
    equipment: list[str] = Query(default=[]),
    claims: dict = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Active spaces free on [start_at, end_at[ whose durations allow it; 422 INVALID_SLOT."""
    now = clock.now()
    spaces = booking.free_spaces(db, start_at, end_at, type, min_capacity, floor, equipment, now)
    _evaluate(db, spaces, now)
    return [space_out(db, s, now, is_fm(claims)) for s in spaces]


@router.get("/spaces/{space_id}", response_model=SpaceDetail)
def read_space(
    space_id: UUID,
    date: dt.date | None = None,
    claims: dict = Depends(current_user),
    user: AppUser = Depends(get_app_user),
    db: Session = Depends(get_db),
):
    """The space and the reservations of `date` (Paris day, default today), cancelled ones excluded."""
    now, fm = clock.now(), is_fm(claims)
    space = _space(db, space_id, fm)
    _evaluate(db, [space], now)
    day = date or now.astimezone(PARIS).date()
    start = dt.datetime.combine(day, dt.time(), PARIS)
    end = dt.datetime.combine(day + dt.timedelta(days=1), dt.time(), PARIS)
    reservations = db.scalars(select(Reservation).where(
        Reservation.space_id == space.id, Reservation.status != ReservationStatus.CANCELLED,
        Reservation.start_at < end, Reservation.end_at > start,
    ).order_by(Reservation.start_at)).all()
    return SpaceDetail(
        **space_out(db, space, now, fm).model_dump(), date=day,
        reservations=[DayReservation(
            id=r.id, start_at=r.start_at, end_at=r.end_at, status=r.status, released_at=r.released_at,
            mine=r.user_id == user.id, booker_name=_name(db, r.user_id) if fm else None,
        ) for r in reservations],
    )


def _save(db: Session, space: Space) -> None:
    lo, hi = booking.duration_bounds(db, space)
    if lo > hi:
        raise HTTPException(status_code=422, detail="INVALID_SPACE")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="SPACE_NAME_TAKEN")


@router.post("/spaces", status_code=201, response_model=SpaceOut, dependencies=[Depends(require_fm)])
def create_space(body: SpaceIn, db: Session = Depends(get_db)):
    space = Space(**body.model_dump())
    db.add(space)
    _save(db, space)
    return space_out(db, space, clock.now(), fm=True)


@router.patch("/spaces/{space_id}", response_model=SpaceOut, dependencies=[Depends(require_fm)])
def update_space(space_id: UUID, body: SpacePatch, db: Session = Depends(get_db)):
    """Existing reservations are not touched (spec §4.1)."""
    space = _space(db, space_id, fm=True)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(space, field, value)
    _save(db, space)
    return space_out(db, space, clock.now(), fm=True)


@router.get("/spaces/{space_id}/history", response_model=History, dependencies=[Depends(require_fm)])
def history(
    space_id: UUID,
    frm: AwareDatetime = Query(alias="from"),
    to: AwareDatetime = Query(),
    db: Session = Depends(get_db),
):
    """Observations, reservations (any status) and their absence episodes on [from, to[."""
    if frm >= to:
        raise HTTPException(status_code=400, detail="INVALID_PERIOD")
    space = _space(db, space_id, fm=True)
    # ponytail: no pagination (8640 observations a day per space); add it when periods get long
    observations = db.scalars(select(Observation).where(
        Observation.space_id == space.id, Observation.observed_at >= frm, Observation.observed_at < to,
    ).order_by(Observation.observed_at)).all()
    reservations = db.scalars(select(Reservation).where(
        Reservation.space_id == space.id, Reservation.start_at < to, Reservation.end_at > frm,
    ).order_by(Reservation.start_at)).all()
    episodes = db.scalars(select(AbsenceEpisode).where(
        AbsenceEpisode.reservation_id.in_([r.id for r in reservations]),
    ).order_by(AbsenceEpisode.opened_at)).all()
    return History(
        observations=[ObservationOut.model_validate(o) for o in observations],
        reservations=[HistoryReservation(
            id=r.id, start_at=r.start_at, end_at=r.end_at, status=r.status, released_at=r.released_at,
            booker_name=_name(db, r.user_id),
        ) for r in reservations],
        episodes=[EpisodeOut.model_validate(e) for e in episodes],
    )

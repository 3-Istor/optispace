from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import AwareDatetime
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import clock
from app.database import get_db
from app.models import AppUser, Reservation, Space
from app.models.enums import ReservationStatus
from app.schemas.reservations import ReservationIn, ReservationOut, ReservationPatch
from app.security import get_app_user, member
from app.services import absence, booking

router = APIRouter(tags=["reservations"], dependencies=[Depends(member)])


def reservation_out(db: Session, r: Reservation) -> ReservationOut:
    episode = booking.pending_episode(db, r.id)
    return ReservationOut(
        id=r.id, space_id=r.space_id, space_name=db.get(Space, r.space_id).name, start_at=r.start_at,
        end_at=r.end_at, status=r.status, released_at=r.released_at,
        release_at=episode.deadline_at if episode else None,
    )


@router.post("/reservations", status_code=201, response_model=ReservationOut)
def create_reservation(body: ReservationIn, user: AppUser = Depends(get_app_user), db: Session = Depends(get_db)):
    r = booking.create(db, user, body.space_id, body.start_at, body.end_at, clock.now())
    db.commit()
    return reservation_out(db, r)


@router.get("/reservations/mine", response_model=list[ReservationOut])
def my_reservations(
    frm: AwareDatetime | None = Query(default=None, alias="from"),
    to: AwareDatetime | None = None,
    user: AppUser = Depends(get_app_user),
    db: Session = Depends(get_db),
):
    """The user's reservations overlapping [from, to[, any status, by start."""
    now = clock.now()
    query = select(Reservation).where(Reservation.user_id == user.id).order_by(Reservation.start_at)
    if frm is not None:
        query = query.where(Reservation.end_at > frm)
    if to is not None:
        query = query.where(Reservation.start_at < to)
    reservations = db.scalars(query).all()
    current = {r.space_id for r in reservations if r.status == ReservationStatus.ACTIVE and r.start_at <= now < r.end_at}
    for space_id in sorted(current):  # a fixed order keeps row locks deadlock-free
        absence.evaluate_space(db, space_id, now)
    db.commit()
    return [reservation_out(db, r) for r in reservations]


@router.patch("/reservations/{reservation_id}", response_model=ReservationOut)
def modify_reservation(
    reservation_id: UUID, body: ReservationPatch, user: AppUser = Depends(get_app_user), db: Session = Depends(get_db),
):
    r = booking.modify(db, user, reservation_id, body.space_id, body.start_at, body.end_at, clock.now())
    db.commit()
    return reservation_out(db, r)


@router.delete("/reservations/{reservation_id}", status_code=204)
def cancel_reservation(reservation_id: UUID, user: AppUser = Depends(get_app_user), db: Session = Depends(get_db)):
    booking.cancel(db, user, reservation_id, clock.now())
    db.commit()

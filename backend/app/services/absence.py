"""Absence episodes and automatic release (spec §4.2), evaluated inside requests."""
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import exists, func, select, update
from sqlalchemy.orm import Session

from app.models import AbsenceEpisode, AppSettings, AppUser, Device, Observation, Reservation, Space, SpaceStatus
from app.models.enums import EpisodeKind, EpisodeOutcome, NotificationType, Presence, ReservationStatus
from app.services import alerts, booking, occupancy
from app.services.notifications import iso, notify


def evaluate_space(db: Session, space_id: UUID, now: datetime) -> None:
    """Open, close or release the absence episode of the space's current reservation.
    Idempotent: a second call at the same instant changes nothing. The caller commits."""
    # No request reached the deadline before the end: nothing was released.
    for episode in db.scalars(select(AbsenceEpisode).join(Reservation).where(
        Reservation.space_id == space_id, AbsenceEpisode.outcome == EpisodeOutcome.PENDING,
        func.coalesce(Reservation.released_at, Reservation.end_at) <= now,
    )):
        episode.outcome, episode.closed_at = EpisodeOutcome.RELEASE_BLOCKED, now
    current = booking.current_reservation(db, space_id, now)
    if current is None:
        return
    # Row lock: concurrent evaluations of one reservation run one after the other on PostgreSQL.
    r = db.get(Reservation, current.id, with_for_update=True, populate_existing=True)
    if r.status != ReservationStatus.ACTIVE:
        return
    status = db.get(SpaceStatus, space_id)
    device = db.scalar(select(Device).where(Device.space_id == space_id))
    presence = occupancy.effective_occupancy(status, device, now)
    delay = timedelta(minutes=db.get(AppSettings, 1).absence_delay_min)
    space = db.get(Space, space_id)

    episode = booking.pending_episode(db, r.id)
    if episode is not None:
        if presence == Presence.PRESENT:
            episode.outcome, episode.closed_at = EpisodeOutcome.PRESENCE_DETECTED, now
            return
        if now < episode.deadline_at:
            return
        if presence == Presence.ABSENT and status.occupancy_since <= episode.opened_at:
            _release(db, r, episode, space, now)
            return
        # unknown, or a data gap during the episode
        episode.outcome, episode.closed_at = EpisodeOutcome.RELEASE_BLOCKED, now
        db.flush()  # before a new pending episode: at most one per reservation

    if presence != Presence.ABSENT:
        return
    seen = db.scalar(select(exists().where(
        Observation.space_id == space_id, Observation.presence == Presence.PRESENT,
        Observation.observed_at >= r.start_at, Observation.observed_at <= now,
    )))
    first = episode is None and not db.scalar(select(exists().where(AbsenceEpisode.reservation_id == r.id)))
    if first and not seen:
        kind = EpisodeKind.NO_SHOW  # from the start, or as soon as absence is established
    elif now - status.occupancy_since >= delay:
        kind = EpisodeKind.EARLY_DEPARTURE if seen else EpisodeKind.NO_SHOW
    else:
        return
    deadline = now + delay
    if deadline >= r.end_at:
        return
    db.add(AbsenceEpisode(reservation_id=r.id, kind=kind, opened_at=now, deadline_at=deadline))
    db.flush()
    notify(db, db.get(AppUser, r.user_id), NotificationType.ABSENCE_WARNING,
           reservation_id=r.id, space_id=space_id, space_name=space.name, at=iso(deadline))


def _release(db: Session, r: Reservation, episode: AbsenceEpisode, space: Space, now: datetime) -> None:
    released = db.execute(update(Reservation).where(
        Reservation.id == r.id, Reservation.status == ReservationStatus.ACTIVE,
    ).values(status=ReservationStatus.RELEASED, released_at=now)).rowcount
    if not released:
        return
    episode.outcome, episode.closed_at = EpisodeOutcome.RELEASED, now
    notify(db, db.get(AppUser, r.user_id), NotificationType.RELEASED,
           reservation_id=r.id, space_id=space.id, space_name=space.name, at=iso(now))
    alerts.on_freed(db, space, now, r.end_at, now)

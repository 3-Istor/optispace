from enum import StrEnum


class SpaceType(StrEnum):
    INDIVIDUAL_BOOTH = "individual_booth"
    MEETING_ROOM = "meeting_room"


class SealState(StrEnum):
    SEALED = "sealed"
    UNSEALED = "unsealed"


class Presence(StrEnum):
    PRESENT = "present"
    ABSENT = "absent"
    UNKNOWN = "unknown"


class ObservationKind(StrEnum):
    TRANSITION = "transition"
    HEARTBEAT = "heartbeat"
    CONFIRMATION = "confirmation"


class Target(StrEnum):
    MOVING = "moving"
    STATIC = "static"
    NONE = "none"


class Source(StrEnum):
    REAL = "real"
    SIMULATED = "simulated"


class ReservationStatus(StrEnum):
    ACTIVE = "active"
    CANCELLED = "cancelled"
    RELEASED = "released"


class EpisodeKind(StrEnum):
    NO_SHOW = "no_show"
    EARLY_DEPARTURE = "early_departure"


class EpisodeOutcome(StrEnum):
    PENDING = "pending"
    PRESENCE_DETECTED = "presence_detected"
    RELEASED = "released"
    RELEASE_BLOCKED = "release_blocked"
    CANCELLED = "cancelled"


class AlertStatus(StrEnum):
    ACTIVE = "active"
    FULFILLED = "fulfilled"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class NotificationType(StrEnum):
    ABSENCE_WARNING = "ABSENCE_WARNING"
    RELEASED = "RELEASED"
    SPACE_AVAILABLE = "SPACE_AVAILABLE"
    DEVICE_OFFLINE = "DEVICE_OFFLINE"
    DEVICE_SEALED = "DEVICE_SEALED"


class SpaceState(StrEnum):
    FREE = "free"
    AWAITING_PRESENCE = "awaiting_presence"
    OCCUPIED_RESERVED = "occupied_reserved"
    OCCUPIED_UNRESERVED = "occupied_unreserved"
    UNKNOWN = "unknown"
    SEALED = "sealed"

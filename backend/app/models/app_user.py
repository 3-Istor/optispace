import uuid
from datetime import datetime

from sqlalchemy import false
from sqlalchemy.orm import Mapped, mapped_column

from app import clock
from app.database import Base


class AppUser(Base):
    __tablename__ = "app_user"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The token's `sub`: stable, unlike the e-mail address or the username.
    keycloak_sub: Mapped[str] = mapped_column(unique=True)
    email: Mapped[str | None]
    display_name: Mapped[str | None]
    phone: Mapped[str | None]
    notify_push: Mapped[bool] = mapped_column(default=True)
    notify_in_app: Mapped[bool] = mapped_column(default=True)
    alert_device_offline: Mapped[bool] = mapped_column(default=True)
    alert_device_sealed: Mapped[bool] = mapped_column(default=True)
    # Copied from the token's groups on each request, to find who gets device alerts.
    is_fm: Mapped[bool] = mapped_column(default=False, server_default=false())
    # The token's organization alias, copied on each request; NULL for staff.
    organization: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(default=lambda: clock.now())

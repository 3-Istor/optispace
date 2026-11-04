import hmac
import json

from fastapi import APIRouter, Depends, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from app import clock
from app.config import get_settings
from app.database import get_db
from app.errors import DomainError
from app.models.enums import Source
from app.schemas.telemetry import SCHEMA, TelemetryIn, TelemetryOut
from app.services import devices


class TelemetryRoute(APIRoute):
    """Device key check and the contract's error codes (spec §7) instead of FastAPI's 422;
    every reject is logged as one JSON line on stdout."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def route(request: Request):
            try:
                payload = await request.json()  # cached: the handler reads the same body
            except ValueError:
                payload = None
            fields = payload if isinstance(payload, dict) else {}
            try:
                key = get_settings().device_api_key
                given = request.headers.get("x-api-key", "")
                if not key or not hmac.compare_digest(given.encode(), key.encode()):
                    raise DomainError(401, "INVALID_API_KEY")
                if "schema" in fields and fields["schema"] != SCHEMA:
                    raise DomainError(422, "UNKNOWN_SCHEMA")
                try:
                    return await handler(request)
                except RequestValidationError:
                    raise DomainError(400, "INVALID_PAYLOAD") from None
            except DomainError as error:
                print(json.dumps({
                    "event": "telemetry_rejected", "device_id": fields.get("device_id"),
                    "seq": fields.get("seq"), "code": error.code,
                }), flush=True)
                raise

        return route


router = APIRouter(tags=["telemetry"], route_class=TelemetryRoute)


@router.post("/telemetry", response_model=TelemetryOut)
def post_telemetry(body: TelemetryIn, db: Session = Depends(get_db)):
    if body.source == Source.SIMULATED and not get_settings().allow_simulated_telemetry:
        raise DomainError(422, "SIMULATED_NOT_ALLOWED")
    result = devices.ingest(db, body, clock.now())
    db.commit()
    return result

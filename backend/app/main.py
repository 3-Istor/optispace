import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import check_database_connection, is_database_enabled
from app.errors import DomainError, domain_error_handler
from app.routers import alerts, devices, insights, me, notifications, push, reservations, spaces, telemetry
from app.routers import settings as settings_routes

settings = get_settings()
if settings.dev_fake_user and settings.oidc_issuer:
    logging.getLogger(__name__).warning("DEV_FAKE_USER is ignored: OIDC_ISSUER is set")
app = FastAPI(title="OptiSpace API")
app.add_exception_handler(DomainError, domain_error_handler)
for module in (
    me, settings_routes, spaces, reservations, alerts, notifications, push, devices, insights, telemetry,
):
    app.include_router(module.router, prefix="/api/v1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "message": "Bienvenue sur l'API Cloud Native Template",
        "version": "1.0.0",
        "endpoints": {
            "hello": "/api/hello",
            "database": "/api/db/status",
            "health": "/health",
        },
    }


@app.get("/api/hello")
async def say_hello():
    return {"message": "Hello from FastAPI"}


@app.get("/api/db/status")
async def database_status():
    enabled = is_database_enabled()
    return {
        "enabled": enabled,
        "type": settings.db_type if enabled else None,
        "connected": check_database_connection() if enabled else False,
    }

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

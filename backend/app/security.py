import json
from functools import lru_cache

import jwt
from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import AppUser


@lru_cache
def _jwks() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{get_settings().oidc_issuer}/protocol/openid-connect/certs")


def current_user(authorization: str = Header(default="")) -> dict:
    """Claims of the gateway's token. Verified here too: other pods reach the backend without the gateway."""
    settings = get_settings()
    if settings.dev_fake_user and not settings.oidc_issuer:  # an issuer means a real deployment
        return json.loads(settings.dev_fake_user)
    token = authorization.removeprefix("Bearer ")
    if not token:
        raise HTTPException(status_code=401, detail="NOT_AUTHENTICATED")
    try:
        key = _jwks().get_signing_key_from_jwt(token).key
        # Keycloak access tokens carry aud "account"; azp is the app's client.
        return jwt.decode(
            token, key, algorithms=["RS256"], issuer=settings.oidc_issuer,
            options={"verify_aud": False, "require": ["exp", "sub"]},
        )
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="INVALID_TOKEN")


def is_fm(claims: dict) -> bool:
    return get_settings().fm_group in claims.get("groups", [])


def require_fm(claims: dict = Depends(current_user)) -> dict:
    if not is_fm(claims):
        raise HTTPException(status_code=403, detail="FORBIDDEN")
    return claims


def get_app_user(db: Session = Depends(get_db), claims: dict = Depends(current_user)) -> AppUser:
    """The user of the token, created on first call; e-mail, name and FM role follow the IdP."""
    by_sub = select(AppUser).where(AppUser.keycloak_sub == claims["sub"])
    email, name = claims.get("email"), claims.get("name") or claims.get("preferred_username")
    fm = is_fm(claims)
    user = db.scalar(by_sub)
    if user is None:
        user = AppUser(keycloak_sub=claims["sub"])
        db.add(user)
    elif (user.email, user.display_name, user.is_fm) == (email, name, fm):
        return user
    user.email, user.display_name, user.is_fm = email, name, fm
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # the browser's parallel first requests: another one created the row
        user = db.scalar(by_sub)
    return user

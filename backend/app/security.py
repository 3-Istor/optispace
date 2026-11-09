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
    # Cloudflare in front of Keycloak answers 403 to urllib's default "Python-urllib" User-Agent.
    return jwt.PyJWKClient(
        f"{get_settings().oidc_issuer}/protocol/openid-connect/certs",
        headers={"User-Agent": "optispace-backend"},
    )


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


def organization_of(claims: dict) -> str | None:
    """The one organization alias of the token (list or object keyed by alias), else None."""
    org = claims.get("organization")
    if isinstance(org, dict):
        org = list(org)
    if isinstance(org, list) and len(org) == 1 and isinstance(org[0], str):
        return org[0]
    return None


def is_staff(claims: dict) -> bool:
    return bool(set(get_settings().staff_groups) & set(claims.get("groups", [])))


def is_fm(claims: dict) -> bool:
    return (
        not is_staff(claims)
        and organization_of(claims) is not None
        and get_settings().fm_group in claims.get("groups", [])
    )


def get_app_user(db: Session = Depends(get_db), claims: dict = Depends(current_user)) -> AppUser:
    """The user of the token, created on first call; e-mail, name, company and FM role follow the IdP."""
    staff = is_staff(claims)
    organization = None if staff else organization_of(claims)
    if not staff and organization is None:
        raise HTTPException(status_code=403, detail="NO_ORGANIZATION")
    by_sub = select(AppUser).where(AppUser.keycloak_sub == claims["sub"])
    email, name = claims.get("email"), claims.get("name") or claims.get("preferred_username")
    fm = is_fm(claims)
    user = db.scalar(by_sub)
    if user is None:
        user = AppUser(keycloak_sub=claims["sub"])
        db.add(user)
    elif (user.email, user.display_name, user.is_fm, user.organization) == (email, name, fm, organization):
        return user
    user.email, user.display_name, user.is_fm, user.organization = email, name, fm, organization
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # the browser's parallel first requests (or an old pod): another one created the row
        user = db.scalar(by_sub)
        user.email, user.display_name, user.is_fm, user.organization = email, name, fm, organization
        db.commit()
    return user


def member(user: AppUser = Depends(get_app_user)) -> AppUser:
    """A company account; staff (no organization) have no business data."""
    if user.organization is None:
        raise HTTPException(status_code=403, detail="FORBIDDEN")
    return user


def require_fm(user: AppUser = Depends(member)) -> AppUser:
    if not user.is_fm:
        raise HTTPException(status_code=403, detail="FORBIDDEN")
    return user


def require_staff(user: AppUser = Depends(get_app_user), claims: dict = Depends(current_user)) -> AppUser:
    if not is_staff(claims):
        raise HTTPException(status_code=403, detail="FORBIDDEN")
    return user


def fm_or_staff(user: AppUser = Depends(get_app_user), claims: dict = Depends(current_user)) -> AppUser:
    if not is_staff(claims) and not user.is_fm:
        raise HTTPException(status_code=403, detail="FORBIDDEN")
    return user

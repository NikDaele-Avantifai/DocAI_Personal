"""
Auth0 JWT verification for FastAPI.

How it works:
  1. Auth0 issues a signed JWT (RS256) to the React frontend after login.
  2. The frontend includes it as:  Authorization: Bearer <token>
  3. This module fetches Auth0's public JWKS, verifies the token signature,
     and returns the decoded claims as the "current user".

Dev mode (AUTH0_DOMAIN not set):
  Every request is treated as an authenticated dev user — no token required.
  Set AUTH0_DOMAIN in .env to enable enforcement.
"""

import logging
from typing import Any, Optional

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.core.config import settings

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------
# JWKS cache — fetched once per process start, refreshed on key miss
# ------------------------------------------------------------------
_jwks_cache: Optional[dict] = None


async def _get_jwks() -> dict:
    global _jwks_cache
    if _jwks_cache is not None:
        return _jwks_cache
    url = f"https://{settings.auth0_domain}/.well-known/jwks.json"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        _jwks_cache = resp.json()
        return _jwks_cache


# ------------------------------------------------------------------
# Dependency
# ------------------------------------------------------------------
_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict[str, Any]:
    """
    FastAPI dependency that validates the Auth0 JWT and returns decoded claims.

    Usage:
        @router.get("/protected")
        async def route(user = Depends(get_current_user)):
            return {"sub": user["sub"]}

    Dev bypass:
        When AUTH0_DOMAIN is empty the dependency returns a synthetic dev user
        and skips all token checks.  Set AUTH0_DOMAIN in .env to enforce auth.
    """
    # ── Dev bypass ─────────────────────────────────────────────
    if not settings.auth0_domain:
        return {
            "sub": "dev|local",
            "email": "dev@localhost",
            "name": "Dev User",
            "roles": ["admin"],
        }

    # ── Require token ──────────────────────────────────────────
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header missing",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    # ── Decode header to get kid ───────────────────────────────
    try:
        unverified_header = jwt.get_unverified_header(token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token header",
        )

    kid = unverified_header.get("kid")

    # ── Fetch JWKS and find matching key ───────────────────────
    try:
        jwks = await _get_jwks()
    except Exception as exc:
        logger.error("Failed to fetch JWKS from Auth0: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to fetch identity provider keys",
        )

    rsa_key: dict = {}
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            rsa_key = {
                "kty": key["kty"],
                "kid": key["kid"],
                "use": key["use"],
                "n": key["n"],
                "e": key["e"],
            }
            break

    if not rsa_key:
        # Key not in cache — flush and retry once
        global _jwks_cache
        _jwks_cache = None
        try:
            jwks = await _get_jwks()
            for key in jwks.get("keys", []):
                if key.get("kid") == kid:
                    rsa_key = {
                        "kty": key["kty"],
                        "kid": key["kid"],
                        "use": key["use"],
                        "n": key["n"],
                        "e": key["e"],
                    }
                    break
        except Exception:
            pass

    if not rsa_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unable to find appropriate key",
        )

    # ── Verify and decode ──────────────────────────────────────
    try:
        payload = jwt.decode(
            token,
            rsa_key,
            algorithms=["RS256"],
            audience=settings.auth0_audience,
            issuer=f"https://{settings.auth0_domain}/",
        )
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token validation failed: {exc}",
        )

    return payload

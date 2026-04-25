"""
Auth0 JWT verification for FastAPI.

How it works:
  1. Auth0 issues a signed JWT (RS256) to the React frontend after login.
  2. The frontend includes it as:  Authorization: Bearer <token>
  3. This module uses PyJWT's PyJWKClient to fetch Auth0's public JWKS,
     verify the token signature, and return the decoded claims as the
     "current user". JWKS caching is handled automatically by PyJWKClient.

Dev mode (AUTH0_DOMAIN not set):
  Every request is treated as an authenticated dev user — no token required.
  Set AUTH0_DOMAIN in .env to enable enforcement.
"""

import logging
from typing import Any, Optional

import jwt as pyjwt
from jwt import PyJWTError as JWTError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------
# PyJWT's PyJWKClient handles JWKS fetching and caching automatically.
# Cache is per-process; lifespan=3600 refreshes keys hourly.
# ------------------------------------------------------------------
_jwks_client: pyjwt.PyJWKClient | None = None


def _get_jwks_client() -> pyjwt.PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        url = f"https://{settings.auth0_domain}/.well-known/jwks.json"
        _jwks_client = pyjwt.PyJWKClient(url, cache_jwk_set=True, lifespan=3600)
    return _jwks_client


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
            "roles": ["admin"],  # dev bypass always admin
        }

    # ── Require token ──────────────────────────────────────────
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header missing",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    # ── Fetch signing key and verify token ─────────────────────
    try:
        client = _get_jwks_client()
        signing_key = client.get_signing_key_from_jwt(token)
        payload = pyjwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.auth0_audience,
            issuer=f"https://{settings.auth0_domain}/",
        )
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        )
    except pyjwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token validation failed: {exc}",
        )

    # Extract roles from Auth0 custom claim
    # Auth0 Action sets: api.accessToken.setCustomClaim('https://docai.io/roles', [...])
    roles = payload.get("https://docai.io/roles", [])
    if isinstance(roles, str):
        roles = [roles]
    payload["roles"] = roles  # normalize to list, always present

    return payload


def require_role(*required_roles: str):
    """
    FastAPI dependency factory for role-based access control.

    Usage:
        @router.post("/apply")
        async def apply_fix(user = Depends(require_role("admin"))):

    Multiple roles = any of them is sufficient:
        Depends(require_role("admin", "editor"))
    """
    async def _check_role(
        user: dict = Depends(get_current_user)
    ) -> dict:
        user_roles = user.get("roles", [])
        if not any(r in user_roles for r in required_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": "insufficient_permissions",
                    "message": (
                        f"This action requires one of these roles: "
                        f"{', '.join(required_roles)}. "
                        f"Your role: {', '.join(user_roles) or 'none'}. "
                        f"Contact your workspace admin to request access."
                    ),
                    "required_roles": list(required_roles),
                    "user_roles": user_roles,
                }
            )
        return user
    return _check_role


# Convenience dependency — import this in routers
require_admin = require_role("admin")

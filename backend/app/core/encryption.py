"""
Symmetric encryption for sensitive fields (Confluence tokens).
Uses Fernet (AES-128-CBC + HMAC-SHA256).

Key derivation: PBKDF2-HMAC-SHA256 from APP_SECRET_KEY.

IMPORTANT: Changing APP_SECRET_KEY will invalidate all stored tokens.
After deploying a new key, run migrate.py to clear encrypted tokens so
users are prompted to re-enter their Confluence credentials.
"""
import base64
import hashlib
from cryptography.fernet import Fernet


def _get_fernet() -> Fernet:
    from app.core.config import settings
    raw_key = settings.app_secret_key
    if len(raw_key) < 16:
        raise ValueError(
            "APP_SECRET_KEY must be at least 16 characters. "
            "Set a strong secret in Railway environment variables."
        )
    # PBKDF2 key derivation — deterministic from the secret, no random salt
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        raw_key.encode(),
        b"docai-confluence-token-salt",
        iterations=100_000,
        dklen=32,
    )
    key = base64.urlsafe_b64encode(derived)
    return Fernet(key)


def encrypt_token(plain: str) -> str:
    return _get_fernet().encrypt(plain.encode()).decode()


def decrypt_token(encrypted: str) -> str:
    return _get_fernet().decrypt(encrypted.encode()).decode()

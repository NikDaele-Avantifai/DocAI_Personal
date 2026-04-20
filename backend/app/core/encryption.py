"""
Symmetric encryption for sensitive fields (Confluence tokens).
Uses Fernet (AES-128-CBC + HMAC-SHA256).
Key comes from APP_SECRET_KEY in environment — must be 32 url-safe base64 bytes.
"""
import base64
from cryptography.fernet import Fernet
from app.core.config import settings


def _get_fernet() -> Fernet:
    # Derive a 32-byte url-safe base64 key from APP_SECRET_KEY
    raw = settings.app_secret_key.encode()[:32].ljust(32, b'0')
    key = base64.urlsafe_b64encode(raw)
    return Fernet(key)


def encrypt_token(plain: str) -> str:
    return _get_fernet().encrypt(plain.encode()).decode()


def decrypt_token(encrypted: str) -> str:
    return _get_fernet().decrypt(encrypted.encode()).decode()

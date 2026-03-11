import time
from typing import Optional

import jwt

import backend.config as config

TOKEN_EXPIRY_SECONDS = 86400  # 24 hours


def auto_login() -> Optional[str]:
    """Generate a JWT for the local user when LOCAL_MODE is enabled."""
    if not config.LOCAL_MODE:
        return None

    payload = {
        "user_id": "local",
        "iat": int(time.time()),
        "exp": int(time.time()) + TOKEN_EXPIRY_SECONDS,
    }
    return jwt.encode(payload, config.SECRET_KEY, algorithm="HS256")


def verify_token(token: str) -> Optional[str]:
    """Verify a JWT and return the user_id, or None if invalid/expired."""
    try:
        payload = jwt.decode(token, config.SECRET_KEY, algorithms=["HS256"])
        return payload.get("user_id")
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None

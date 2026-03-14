import re
import time
import uuid
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
import jwt

import backend.config as config
from backend.database import _get_connection

TOKEN_EXPIRY_SECONDS = 86400  # 24 hours


# ========================================================================
# Password Hashing & Validation
# ========================================================================


def hash_password(password: str) -> str:
    """Hash a password using bcrypt.

    Args:
        password: Plain text password

    Returns:
        Bcrypt hash string (60 chars, starts with $2b$)
    """
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a password against a bcrypt hash.

    Args:
        password: Plain text password to verify
        password_hash: Bcrypt hash to check against

    Returns:
        True if password matches, False otherwise
    """
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


def validate_password(password: str) -> dict:
    """Validate password meets security requirements.

    Requirements:
        - At least 8 characters
        - Contains uppercase letter
        - Contains lowercase letter
        - Contains digit
        - Contains special character

    Args:
        password: Password to validate

    Returns:
        {"valid": bool, "error": Optional[str]}
    """
    if len(password) < 8:
        return {"valid": False, "error": "Password must be at least 8 characters"}

    if not re.search(r"[A-Z]", password):
        return {"valid": False, "error": "Password must contain at least one uppercase letter"}

    if not re.search(r"[a-z]", password):
        return {"valid": False, "error": "Password must contain at least one lowercase letter"}

    if not re.search(r"\d", password):
        return {"valid": False, "error": "Password must contain at least one digit"}

    if not re.search(r'[!@#$%^&*(),.?":{}|<>€£¥_+\-=\[\]\\;/~`]', password):
        return {"valid": False, "error": "Password must contain at least one special character"}

    return {"valid": True, "error": None}


# ========================================================================
# User Management
# ========================================================================


def create_user(username: str, password: str, email: str) -> dict:
    """Create a new user account.

    Args:
        username: Unique username
        password: Plain text password (will be hashed)
        email: User email address

    Returns:
        {
            "success": bool,
            "user": Optional[dict],  # user data if success
            "error": Optional[str]   # error message if failed
        }
    """
    # Validate email format
    email_pattern = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
    if not re.match(email_pattern, email):
        return {"success": False, "user": None, "error": "Invalid email format"}

    # Validate password
    validation = validate_password(password)
    if not validation["valid"]:
        return {"success": False, "user": None, "error": validation["error"]}

    # Check if username already exists
    existing_user = get_user(username)
    if existing_user is not None:
        return {"success": False, "user": None, "error": "Username already exists"}

    # Hash password
    password_hash = hash_password(password)

    # Insert user
    try:
        conn = _get_connection()
        cursor = conn.execute(
            """
            INSERT INTO users (username, email, password_hash)
            VALUES (?, ?, ?)
            """,
            (username, email, password_hash),
        )
        conn.commit()

        # Retrieve created user
        row = conn.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
        user = dict(row)
        return {"success": True, "user": user, "error": None}

    except Exception as e:
        return {"success": False, "user": None, "error": str(e)}


def get_user(username: str) -> Optional[dict]:
    """Retrieve user by username.

    Args:
        username: Username to look up

    Returns:
        User dict if found, None otherwise
    """
    try:
        conn = _get_connection()
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        return dict(row) if row else None
    except Exception:
        return None


def delete_user(username: str) -> bool:
    """Delete a user account.

    Args:
        username: Username to delete

    Returns:
        True if deleted, False if user doesn't exist
    """
    try:
        conn = _get_connection()
        cursor = conn.execute("DELETE FROM users WHERE username = ?", (username,))
        conn.commit()
        return cursor.rowcount > 0
    except Exception:
        return False


def update_password(username: str, old_password: str, new_password: str) -> dict:
    """Update user's password.

    Args:
        username: Username
        old_password: Current password (for verification)
        new_password: New password to set

    Returns:
        {"success": bool, "error": Optional[str]}
    """
    # Verify credentials
    verification = verify_credentials(username, old_password)
    if not verification["valid"]:
        return {"success": False, "error": "Current password is incorrect"}

    # Validate new password
    validation = validate_password(new_password)
    if not validation["valid"]:
        return {"success": False, "error": validation["error"]}

    # Hash new password
    new_password_hash = hash_password(new_password)

    # Update database
    try:
        conn = _get_connection()
        conn.execute(
            """
            UPDATE users
            SET password_hash = ?, updated_at = datetime('now', 'localtime')
            WHERE username = ?
            """,
            (new_password_hash, username),
        )
        conn.commit()
        return {"success": True, "error": None}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ========================================================================
# Credential Verification
# ========================================================================


def verify_credentials(username: str, password: str) -> dict:
    """Verify username and password.

    Args:
        username: Username to verify
        password: Password to verify

    Returns:
        {
            "valid": bool,
            "user": Optional[dict],   # user data if valid
            "error": Optional[str]    # error message if invalid
        }
    """
    user = get_user(username)
    if user is None:
        return {"valid": False, "user": None, "error": "User not found or invalid credentials"}

    if not verify_password(password, user["password_hash"]):
        return {"valid": False, "user": None, "error": "User not found or invalid credentials"}

    # Update last login
    try:
        conn = _get_connection()
        conn.execute(
            "UPDATE users SET last_login = datetime('now', 'localtime') WHERE username = ?",
            (username,),
        )
        conn.commit()
    except Exception:
        pass  # Non-critical failure

    return {"valid": True, "user": user, "error": None}


# ========================================================================
# JWT Token Management
# ========================================================================


def generate_token(user_id: str, expiry_seconds: int = TOKEN_EXPIRY_SECONDS) -> str:
    """Generate a JWT token for a user.

    Args:
        user_id: User identifier
        expiry_seconds: Token expiry time in seconds (default: 24h)

    Returns:
        JWT token string
    """
    now = int(time.time())
    payload = {
        "user_id": user_id,
        "iat": now,
        "exp": now + expiry_seconds,
        "jti": str(uuid.uuid4()),  # Unique token ID for revocation
    }
    return jwt.encode(payload, config.SECRET_KEY, algorithm="HS256")


def verify_token(token: str) -> Optional[str]:
    """Verify a JWT and return the user_id, or None if invalid/expired/revoked.

    Args:
        token: JWT token string

    Returns:
        user_id if valid, None otherwise
    """
    try:
        payload = jwt.decode(token, config.SECRET_KEY, algorithms=["HS256"])
        user_id = payload.get("user_id")
        jti = payload.get("jti")

        # Check if token is revoked
        if jti and is_token_revoked(jti):
            return None

        return user_id
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


def revoke_token(token: str) -> None:
    """Revoke a JWT token by adding its JTI to the revoked_tokens table.

    Args:
        token: JWT token to revoke
    """
    try:
        payload = jwt.decode(token, config.SECRET_KEY, algorithms=["HS256"])
        jti = payload.get("jti")
        exp = payload.get("exp")

        if not jti or not exp:
            return

        # Convert exp timestamp to ISO format
        expires_at = datetime.fromtimestamp(exp).strftime("%Y-%m-%d %H:%M:%S")

        conn = _get_connection()
        conn.execute(
            """
            INSERT OR IGNORE INTO revoked_tokens (jti, expires_at)
            VALUES (?, ?)
            """,
            (jti, expires_at),
        )
        conn.commit()

    except Exception:
        pass  # Invalid token, nothing to revoke


def is_token_revoked(jti: str) -> bool:
    """Check if a token JTI is in the revoked list.

    Args:
        jti: Token ID to check

    Returns:
        True if revoked, False otherwise
    """
    try:
        conn = _get_connection()
        row = conn.execute("SELECT 1 FROM revoked_tokens WHERE jti = ?", (jti,)).fetchone()
        return row is not None
    except Exception:
        return False


def refresh_token(old_token: str) -> dict:
    """Refresh a JWT token by issuing a new one.

    Args:
        old_token: Current JWT token

    Returns:
        {
            "success": bool,
            "token": Optional[str],  # new token if success
            "error": Optional[str]   # error message if failed
        }
    """
    try:
        payload = jwt.decode(old_token, config.SECRET_KEY, algorithms=["HS256"])
        user_id = payload.get("user_id")

        if not user_id:
            return {"success": False, "token": None, "error": "Invalid token"}

        # Check if revoked
        jti = payload.get("jti")
        if jti and is_token_revoked(jti):
            return {"success": False, "token": None, "error": "Token has been revoked"}

        # Generate new token
        new_token = generate_token(user_id)
        return {"success": True, "token": new_token, "error": None}

    except jwt.ExpiredSignatureError:
        return {"success": False, "token": None, "error": "Token has expired"}
    except jwt.InvalidTokenError:
        return {"success": False, "token": None, "error": "Invalid token"}


def cleanup_expired_revoked_tokens() -> int:
    """Remove expired tokens from revoked_tokens table.

    Returns:
        Number of tokens cleaned up
    """
    try:
        conn = _get_connection()
        cursor = conn.execute(
            """
            DELETE FROM revoked_tokens
            WHERE datetime(expires_at) < datetime('now', 'localtime')
            """
        )
        conn.commit()
        return cursor.rowcount
    except Exception:
        return 0


# ========================================================================
# Backward Compatibility (Local Mode)
# ========================================================================


def auto_login() -> Optional[str]:
    """Generate a JWT for the local user when LOCAL_MODE is enabled.

    This maintains backward compatibility with the existing local-only auth.

    Returns:
        JWT token if LOCAL_MODE is enabled, None otherwise
    """
    if not config.LOCAL_MODE:
        return None

    payload = {
        "user_id": "local",
        "iat": int(time.time()),
        "exp": int(time.time()) + TOKEN_EXPIRY_SECONDS,
    }
    return jwt.encode(payload, config.SECRET_KEY, algorithm="HS256")

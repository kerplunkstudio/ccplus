import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import time
from datetime import datetime, timedelta

import jwt
import pytest

import backend.config as config
from backend.auth import (
    TOKEN_EXPIRY_SECONDS,
    auto_login,
    create_user,
    delete_user,
    generate_token,
    get_user,
    hash_password,
    refresh_token,
    revoke_token,
    update_password,
    validate_password,
    verify_credentials,
    verify_password,
    verify_token,
)


class TestPasswordHashing:
    """Test password hashing and verification."""

    def test_hash_password_returns_string(self):
        """Hash should return a bcrypt-compatible string."""
        hashed = hash_password("secure_password_123")
        assert isinstance(hashed, str)
        assert hashed.startswith("$2b$")
        assert len(hashed) == 60  # bcrypt hash length

    def test_hash_password_generates_unique_hashes(self):
        """Same password should generate different hashes (salt)."""
        password = "same_password"
        hash1 = hash_password(password)
        hash2 = hash_password(password)
        assert hash1 != hash2

    def test_verify_password_correct(self):
        """Correct password should verify successfully."""
        password = "my_secure_password"
        hashed = hash_password(password)
        assert verify_password(password, hashed) is True

    def test_verify_password_incorrect(self):
        """Incorrect password should fail verification."""
        password = "my_secure_password"
        hashed = hash_password(password)
        assert verify_password("wrong_password", hashed) is False

    def test_verify_password_empty_string(self):
        """Empty password should fail verification."""
        hashed = hash_password("password")
        assert verify_password("", hashed) is False

    def test_hash_password_handles_unicode(self):
        """Password hashing should handle unicode characters."""
        password = "пароль_密码_🔐"
        hashed = hash_password(password)
        assert verify_password(password, hashed) is True


class TestPasswordValidation:
    """Test password validation rules."""

    def test_validate_password_minimum_length(self):
        """Password must be at least 8 characters."""
        result = validate_password("short")
        assert result["valid"] is False
        assert "8 characters" in result["error"]

    def test_validate_password_requires_uppercase(self):
        """Password must contain uppercase letter."""
        result = validate_password("lowercase123!")
        assert result["valid"] is False
        assert "uppercase" in result["error"].lower()

    def test_validate_password_requires_lowercase(self):
        """Password must contain lowercase letter."""
        result = validate_password("UPPERCASE123!")
        assert result["valid"] is False
        assert "lowercase" in result["error"].lower()

    def test_validate_password_requires_digit(self):
        """Password must contain a digit."""
        result = validate_password("NoDigits!Here")
        assert result["valid"] is False
        assert "digit" in result["error"].lower()

    def test_validate_password_requires_special(self):
        """Password must contain special character."""
        result = validate_password("NoSpecial123")
        assert result["valid"] is False
        assert "special" in result["error"].lower()

    def test_validate_password_valid(self):
        """Valid password should pass all checks."""
        result = validate_password("Secure123!")
        assert result["valid"] is True
        assert result["error"] is None

    def test_validate_password_unicode_special(self):
        """Unicode special characters should count."""
        result = validate_password("Password1€")
        assert result["valid"] is True


class TestUserManagement:
    """Test user creation, retrieval, and deletion."""

    def test_create_user_success(self):
        """Creating a user should return user data."""
        result = create_user("test_user_1", "SecurePass123!", "test1@example.com")
        assert result["success"] is True
        assert result["user"]["username"] == "test_user_1"
        assert result["user"]["email"] == "test1@example.com"
        assert "password_hash" in result["user"]
        assert "created_at" in result["user"]
        # Cleanup
        delete_user("test_user_1")

    def test_create_user_weak_password(self):
        """Creating user with weak password should fail."""
        result = create_user("test_user_weak", "weak", "weak@example.com")
        assert result["success"] is False
        assert "password" in result["error"].lower()

    def test_create_user_duplicate_username(self):
        """Creating user with duplicate username should fail."""
        create_user("test_duplicate", "SecurePass123!", "dup1@example.com")
        result = create_user("test_duplicate", "SecurePass123!", "dup2@example.com")
        assert result["success"] is False
        assert "exists" in result["error"].lower()
        # Cleanup
        delete_user("test_duplicate")

    def test_create_user_invalid_email(self):
        """Creating user with invalid email should fail."""
        result = create_user("test_invalid_email", "SecurePass123!", "not-an-email")
        assert result["success"] is False
        assert "email" in result["error"].lower()

    def test_get_user_exists(self):
        """Getting existing user should return user data."""
        create_user("test_get_user", "SecurePass123!", "get@example.com")
        user = get_user("test_get_user")
        assert user is not None
        assert user["username"] == "test_get_user"
        assert user["email"] == "get@example.com"
        # Cleanup
        delete_user("test_get_user")

    def test_get_user_not_exists(self):
        """Getting non-existent user should return None."""
        user = get_user("nonexistent_user_xyz")
        assert user is None

    def test_delete_user_success(self):
        """Deleting user should succeed and user should not be retrievable."""
        create_user("test_delete", "SecurePass123!", "delete@example.com")
        result = delete_user("test_delete")
        assert result is True
        assert get_user("test_delete") is None

    def test_delete_user_not_exists(self):
        """Deleting non-existent user should return False."""
        result = delete_user("nonexistent_user_xyz")
        assert result is False


class TestCredentialVerification:
    """Test username/password credential verification."""

    def test_verify_credentials_success(self):
        """Correct credentials should verify successfully."""
        create_user("test_cred", "SecurePass123!", "cred@example.com")
        result = verify_credentials("test_cred", "SecurePass123!")
        assert result["valid"] is True
        assert result["user"]["username"] == "test_cred"
        # Cleanup
        delete_user("test_cred")

    def test_verify_credentials_wrong_password(self):
        """Wrong password should fail verification."""
        create_user("test_cred2", "SecurePass123!", "cred2@example.com")
        result = verify_credentials("test_cred2", "WrongPassword123!")
        assert result["valid"] is False
        assert "invalid" in result["error"].lower()
        # Cleanup
        delete_user("test_cred2")

    def test_verify_credentials_user_not_exists(self):
        """Non-existent user should fail verification."""
        result = verify_credentials("nonexistent_user", "AnyPassword123!")
        assert result["valid"] is False
        assert "not found" in result["error"].lower() or "invalid" in result["error"].lower()


class TestPasswordUpdate:
    """Test password update functionality."""

    def test_update_password_success(self):
        """Updating password with correct old password should succeed."""
        create_user("test_update", "OldPass123!", "update@example.com")
        result = update_password("test_update", "OldPass123!", "NewPass456!")
        assert result["success"] is True
        # Verify new password works
        verify_result = verify_credentials("test_update", "NewPass456!")
        assert verify_result["valid"] is True
        # Cleanup
        delete_user("test_update")

    def test_update_password_wrong_old_password(self):
        """Updating password with wrong old password should fail."""
        create_user("test_update2", "OldPass123!", "update2@example.com")
        result = update_password("test_update2", "WrongOldPass!", "NewPass456!")
        assert result["success"] is False
        assert "incorrect" in result["error"].lower() or "invalid" in result["error"].lower()
        # Cleanup
        delete_user("test_update2")

    def test_update_password_weak_new_password(self):
        """Updating to weak password should fail."""
        create_user("test_update3", "OldPass123!", "update3@example.com")
        result = update_password("test_update3", "OldPass123!", "weak")
        assert result["success"] is False
        assert "password" in result["error"].lower()
        # Cleanup
        delete_user("test_update3")


class TestTokenGeneration:
    """Test JWT token generation."""

    def test_generate_token_default_expiry(self):
        """Generated token should have default 24h expiry."""
        token = generate_token("test_user")
        payload = jwt.decode(token, config.SECRET_KEY, algorithms=["HS256"])
        assert payload["user_id"] == "test_user"
        exp_delta = payload["exp"] - payload["iat"]
        assert exp_delta == TOKEN_EXPIRY_SECONDS

    def test_generate_token_custom_expiry(self):
        """Generated token should respect custom expiry."""
        custom_expiry = 3600  # 1 hour
        token = generate_token("test_user", expiry_seconds=custom_expiry)
        payload = jwt.decode(token, config.SECRET_KEY, algorithms=["HS256"])
        exp_delta = payload["exp"] - payload["iat"]
        assert exp_delta == custom_expiry

    def test_generate_token_contains_jti(self):
        """Generated token should have unique JTI (token ID)."""
        token1 = generate_token("user1")
        token2 = generate_token("user1")
        payload1 = jwt.decode(token1, config.SECRET_KEY, algorithms=["HS256"])
        payload2 = jwt.decode(token2, config.SECRET_KEY, algorithms=["HS256"])
        assert "jti" in payload1
        assert "jti" in payload2
        assert payload1["jti"] != payload2["jti"]


class TestTokenRevocation:
    """Test token revocation functionality."""

    def test_revoke_token_success(self):
        """Revoking a token should prevent its use."""
        token = generate_token("test_revoke")
        # Verify token works before revocation
        assert verify_token(token) == "test_revoke"
        # Revoke token
        revoke_token(token)
        # Verify token no longer works
        assert verify_token(token) is None

    def test_revoke_token_invalid(self):
        """Revoking invalid token should not error."""
        revoke_token("invalid_token_xyz")


class TestTokenRefresh:
    """Test token refresh functionality."""

    def test_refresh_token_success(self):
        """Refreshing valid token should return new token."""
        original_token = generate_token("test_refresh")
        time.sleep(0.1)  # Ensure different iat
        result = refresh_token(original_token)
        assert result["success"] is True
        new_token = result["token"]
        # Verify new token is different and valid
        assert new_token != original_token
        assert verify_token(new_token) == "test_refresh"
        # Original token should still work (until revoked)
        assert verify_token(original_token) == "test_refresh"

    def test_refresh_token_expired(self):
        """Refreshing expired token should fail."""
        # Create expired token
        payload = {
            "user_id": "test_user",
            "iat": int(time.time()) - 7200,
            "exp": int(time.time()) - 3600,
            "jti": "expired_jti",
        }
        expired_token = jwt.encode(payload, config.SECRET_KEY, algorithm="HS256")
        result = refresh_token(expired_token)
        assert result["success"] is False
        assert "expired" in result["error"].lower()

    def test_refresh_token_invalid(self):
        """Refreshing invalid token should fail."""
        result = refresh_token("not_a_valid_token")
        assert result["success"] is False


class TestAutoLoginBackwardCompatibility:
    """Test that existing auto_login still works."""

    def test_returns_token_in_local_mode(self):
        original = config.LOCAL_MODE
        config.LOCAL_MODE = True
        try:
            token = auto_login()
            assert token is not None
            assert isinstance(token, str)
        finally:
            config.LOCAL_MODE = original

    def test_returns_none_when_not_local(self):
        original = config.LOCAL_MODE
        config.LOCAL_MODE = False
        try:
            token = auto_login()
            assert token is None
        finally:
            config.LOCAL_MODE = original


class TestVerifyTokenBackwardCompatibility:
    """Test that existing verify_token still works."""

    def test_valid_token(self):
        payload = {
            "user_id": "test-user",
            "iat": int(time.time()),
            "exp": int(time.time()) + 3600,
        }
        token = jwt.encode(payload, config.SECRET_KEY, algorithm="HS256")
        assert verify_token(token) == "test-user"

    def test_expired_token(self):
        payload = {
            "user_id": "test-user",
            "iat": int(time.time()) - 7200,
            "exp": int(time.time()) - 3600,
        }
        token = jwt.encode(payload, config.SECRET_KEY, algorithm="HS256")
        assert verify_token(token) is None

    def test_invalid_token(self):
        assert verify_token("not-a-real-token") is None

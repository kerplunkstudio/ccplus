import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import time

import jwt
import pytest

import backend.config as config
from backend.auth import TOKEN_EXPIRY_SECONDS, auto_login, verify_token


class TestAutoLogin:
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

    def test_token_contains_local_user_id(self):
        original = config.LOCAL_MODE
        config.LOCAL_MODE = True
        try:
            token = auto_login()
            payload = jwt.decode(token, config.SECRET_KEY, algorithms=["HS256"])
            assert payload["user_id"] == "local"
        finally:
            config.LOCAL_MODE = original

    def test_token_has_expiry(self):
        original = config.LOCAL_MODE
        config.LOCAL_MODE = True
        try:
            token = auto_login()
            payload = jwt.decode(token, config.SECRET_KEY, algorithms=["HS256"])
            assert "exp" in payload
            assert payload["exp"] > int(time.time())
        finally:
            config.LOCAL_MODE = original


class TestVerifyToken:
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

    def test_wrong_secret(self):
        payload = {
            "user_id": "test-user",
            "iat": int(time.time()),
            "exp": int(time.time()) + 3600,
        }
        token = jwt.encode(payload, "wrong-secret", algorithm="HS256")
        assert verify_token(token) is None

    def test_roundtrip_with_auto_login(self):
        original = config.LOCAL_MODE
        config.LOCAL_MODE = True
        try:
            token = auto_login()
            user_id = verify_token(token)
            assert user_id == "local"
        finally:
            config.LOCAL_MODE = original

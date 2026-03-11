import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import os

import pytest


class TestConfig:
    def test_project_root_is_parent_of_backend(self):
        from backend.config import PROJECT_ROOT

        assert (PROJECT_ROOT / "backend").exists()

    def test_data_dir_created(self):
        from backend.config import DATA_DIR

        assert DATA_DIR.exists()
        assert DATA_DIR.is_dir()

    def test_log_dir_created(self):
        from backend.config import LOG_DIR

        assert LOG_DIR.exists()
        assert LOG_DIR.is_dir()

    def test_default_values(self):
        from backend.config import (
            DATABASE_PATH,
            MAX_ACTIVITY_EVENTS,
            MAX_CONVERSATION_HISTORY,
            PORT,
            SDK_MODEL,
        )

        assert MAX_CONVERSATION_HISTORY == 50
        assert MAX_ACTIVITY_EVENTS == 200
        assert "ccplus.db" in DATABASE_PATH

    def test_local_mode_default(self):
        from backend.config import LOCAL_MODE

        assert LOCAL_MODE is True

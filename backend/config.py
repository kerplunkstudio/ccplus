import logging
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

_log = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
LOG_DIR = PROJECT_ROOT / "logs"
STATIC_DIR = PROJECT_ROOT / "static" / "chat"

# Version and channel
VERSION_FILE = PROJECT_ROOT / "VERSION"
try:
    VERSION = VERSION_FILE.read_text().strip()
except Exception:
    VERSION = "dev"

CCPLUS_CHANNEL = os.environ.get("CCPLUS_CHANNEL", "stable")

# Ensure dirs exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

# Environment
WORKSPACE_PATH = os.environ.get("WORKSPACE_PATH", str(Path.home() / "Workspace"))
SDK_MODEL = os.environ.get("SDK_MODEL", "sonnet")
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "4000"))
DATABASE_PATH = str(DATA_DIR / "ccplus.db")
LOCAL_MODE = os.environ.get("CCPLUS_AUTH", "local") == "local"

_DEFAULT_SECRET = "ccplus-dev-secret-change-me"
SECRET_KEY = os.environ.get("SECRET_KEY", _DEFAULT_SECRET)

# Abort startup if the insecure default key is used outside local/dev mode.
# In local mode, emit a loud warning so developers know to change it before
# exposing the service to a network.
if SECRET_KEY == _DEFAULT_SECRET:
    if not LOCAL_MODE:
        print(
            "FATAL: SECRET_KEY is set to the insecure default value. "
            "Set a strong SECRET_KEY environment variable before running in production.",
            file=sys.stderr,
        )
        sys.exit(1)
    else:
        _log.warning(
            "SECRET_KEY is using the insecure default value. "
            "Set SECRET_KEY in your .env file before exposing this service to a network."
        )

MAX_CONVERSATION_HISTORY = 50
MAX_ACTIVITY_EVENTS = 200

# Worker process paths
WORKER_SOCKET_PATH = str(DATA_DIR / "sdk_worker.sock")
WORKER_PID_PATH = str(DATA_DIR / "sdk_worker.pid")
WORKER_LOG = str(LOG_DIR / "worker.log")
WORKER_EVENT_BUFFER_SIZE = 1000

# Server process paths
SERVER_PID_PATH = str(DATA_DIR / "flask_server.pid")

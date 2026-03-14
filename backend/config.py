import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
LOG_DIR = PROJECT_ROOT / "logs"
STATIC_DIR = PROJECT_ROOT / "static" / "chat"

# Ensure dirs exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

# Environment
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
WORKSPACE_PATH = os.environ.get("WORKSPACE_PATH", str(Path.home() / "Workspace"))
SDK_MODEL = os.environ.get("SDK_MODEL", "sonnet")
PORT = int(os.environ.get("PORT", "4000"))
DATABASE_PATH = str(DATA_DIR / "ccplus.db")
LOCAL_MODE = os.environ.get("CCPLUS_AUTH", "local") == "local"
SECRET_KEY = os.environ.get("SECRET_KEY", "ccplus-dev-secret-change-me")
MAX_CONVERSATION_HISTORY = 50
MAX_ACTIVITY_EVENTS = 200

# Worker process paths
WORKER_SOCKET_PATH = str(DATA_DIR / "sdk_worker.sock")
WORKER_PID_PATH = str(DATA_DIR / "sdk_worker.pid")
WORKER_LOG = str(LOG_DIR / "worker.log")
WORKER_EVENT_BUFFER_SIZE = 1000

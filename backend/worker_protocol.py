"""
Worker Protocol -- shared message types and helpers for Flask <-> SDK Worker IPC.

Communication uses JSON-lines over a Unix domain socket.
Each message is a single JSON object terminated by newline.
"""

import json
from typing import AsyncIterator

# Socket path (relative to project root)
WORKER_SOCKET_PATH = "data/sdk_worker.sock"
WORKER_PID_PATH = "data/sdk_worker.pid"

# --- Flask -> Worker message types ---
MSG_SUBMIT_QUERY = "submit_query"
MSG_CANCEL_QUERY = "cancel_query"
MSG_DISCONNECT_SESSION = "disconnect_session"
MSG_LIST_SESSIONS = "list_sessions"
MSG_PING = "ping"

# --- Worker -> Flask message types ---
MSG_TEXT_DELTA = "text_delta"
MSG_TOOL_EVENT = "tool_event"
MSG_RESPONSE_COMPLETE = "response_complete"
MSG_ERROR = "error"
MSG_QUERY_ACK = "query_ack"
MSG_SESSIONS_LIST = "sessions_list"
MSG_PONG = "pong"
MSG_SESSION_STATUS = "session_status"


def encode_message(msg: dict) -> bytes:
    """Encode a message dict to JSON-line bytes (with trailing newline)."""
    return json.dumps(msg, default=str).encode("utf-8") + b"\n"


def decode_message(line: bytes) -> dict:
    """Decode a JSON-line bytes to a message dict."""
    return json.loads(line.decode("utf-8").strip())


async def read_messages(reader) -> AsyncIterator[dict]:
    """Async generator that reads JSON-line messages from an asyncio StreamReader."""
    while True:
        line = await reader.readline()
        if not line:
            break
        try:
            yield json.loads(line.decode("utf-8").strip())
        except json.JSONDecodeError:
            continue

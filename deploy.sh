#!/bin/bash
# Deploy script for ccplus
# Usage: ./deploy.sh [component]
# Components: all (default), server (skip frontend build)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT=3000

# Colors (graceful degradation for non-interactive terminals)
if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
    RED=$(tput setaf 1)
    GREEN=$(tput setaf 2)
    YELLOW=$(tput setaf 3)
    BLUE=$(tput setaf 4)
    BOLD=$(tput bold)
    RESET=$(tput sgr0)
else
    RED="" GREEN="" YELLOW="" BLUE="" BOLD="" RESET=""
fi

info()  { echo "${BLUE}[info]${RESET}  $*"; }
ok()    { echo "${GREEN}[ok]${RESET}    $*"; }
warn()  { echo "${YELLOW}[warn]${RESET}  $*"; }
error() { echo "${RED}[error]${RESET} $*" >&2; }
header() {
    echo ""
    echo "${BOLD}--- $* ---${RESET}"
}

# Detect Python (prefer venv)
detect_python() {
    if [ -f "$SCRIPT_DIR/venv/bin/python" ]; then
        PYTHON="$SCRIPT_DIR/venv/bin/python"
        info "Using venv Python: $PYTHON"
    elif command -v python3 >/dev/null 2>&1; then
        PYTHON="python3"
        warn "No venv found, using system python3"
    else
        error "Python not found. Create a venv: python3 -m venv venv"
        exit 1
    fi
}

# Build React frontend
build_frontend() {
    header "Building frontend"

    cd "$SCRIPT_DIR/frontend"

    if [ ! -d "node_modules" ]; then
        warn "node_modules not found, running npm install..."
        npm install || { error "npm install failed"; exit 1; }
    fi

    info "Running npm run build..."
    npm run build || { error "Frontend build failed"; exit 1; }

    cd "$SCRIPT_DIR"
    ok "Frontend build complete"
}

# Deploy build output to static/chat/
deploy_static() {
    header "Deploying to static/chat/"

    mkdir -p "$SCRIPT_DIR/static/chat"
    rm -rf "$SCRIPT_DIR/static/chat/"*

    if [ ! -d "$SCRIPT_DIR/frontend/build" ]; then
        error "No frontend build found. Run: ./deploy.sh"
        exit 1
    fi

    cp -r "$SCRIPT_DIR/frontend/build/"* "$SCRIPT_DIR/static/chat/"
    ok "Static files deployed"
}

# Kill existing server on PORT
kill_server() {
    header "Stopping existing server"

    if lsof -ti:$PORT >/dev/null 2>&1; then
        info "Killing processes on port $PORT..."
        lsof -ti:$PORT | xargs kill -TERM 2>/dev/null || true
        sleep 2

        # Force kill if still running
        if lsof -ti:$PORT >/dev/null 2>&1; then
            warn "Force killing processes on port $PORT..."
            lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
            sleep 1
        fi

        if lsof -ti:$PORT >/dev/null 2>&1; then
            error "Failed to free port $PORT"
            exit 1
        fi
    fi

    ok "Port $PORT is free"
}

# Start backend server
start_server() {
    header "Starting server"

    detect_python
    mkdir -p "$SCRIPT_DIR/logs"

    export PYTHONPATH="$SCRIPT_DIR:${PYTHONPATH:-}"
    nohup "$PYTHON" "$SCRIPT_DIR/backend/server.py" > "$SCRIPT_DIR/logs/server.log" 2>&1 &
    SERVER_PID=$!

    info "Server starting (PID: $SERVER_PID)"

    # Health check
    info "Waiting for health check at localhost:$PORT/health..."
    max_wait=15
    waited=0
    while [ $waited -lt $max_wait ]; do
        status=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/health" 2>/dev/null || echo "000")
        if [ "$status" = "200" ]; then
            ok "Server is healthy (PID: $SERVER_PID)"
            echo ""
            echo "${GREEN}${BOLD}Deployment complete!${RESET}"
            echo ""
            echo "  URL:  ${BOLD}http://localhost:$PORT${RESET}"
            echo "  Logs: tail -f logs/server.log"
            echo ""
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done

    error "Server failed health check after ${max_wait}s"
    echo "Last 20 lines of logs:" >&2
    tail -20 "$SCRIPT_DIR/logs/server.log" 2>/dev/null || true
    exit 1
}

# Usage
show_usage() {
    echo "Usage: ./deploy.sh [component]"
    echo ""
    echo "Components:"
    echo "  (none)     Full deploy: build frontend + deploy + restart server"
    echo "  frontend   Build + deploy frontend only (no server restart, preserves sessions)"
    echo "  server     Skip frontend build, just restart server"
    echo ""
    echo "Examples:"
    echo "  ./deploy.sh            # Full deploy"
    echo "  ./deploy.sh frontend   # Frontend only, keeps sessions alive"
    echo "  ./deploy.sh server     # Restart server only"
}

# Main
COMPONENT="${1:-all}"

case "$COMPONENT" in
    all)
        build_frontend
        deploy_static
        kill_server
        start_server
        ;;
    frontend)
        build_frontend
        deploy_static
        ok "Frontend deployed (server not restarted)"
        echo ""
        echo "  ${BOLD}Hard refresh your browser (Cmd+Shift+R) to load new assets${RESET}"
        echo ""
        ;;
    server)
        kill_server
        start_server
        ;;
    -h|--help)
        show_usage
        ;;
    *)
        error "Unknown component: $COMPONENT"
        show_usage
        exit 1
        ;;
esac

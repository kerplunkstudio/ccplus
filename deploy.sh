#!/bin/bash
# Deploy script for ccplus
# Usage: ./deploy.sh [component]
# Components: all (default), server, frontend, worker, stop

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-4000}"

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

# Worker PID file
WORKER_PID_FILE="$SCRIPT_DIR/data/sdk_worker.pid"

# Worker checksum file
WORKER_CHECKSUM_FILE="$SCRIPT_DIR/data/worker_checksums.md5"

# Files that require a worker restart when changed
WORKER_FILES=(
    "backend/sdk_worker.py"
    "backend/worker_protocol.py"
    "backend/config.py"
)

# Check if worker is running
worker_running() {
    if [ -f "$WORKER_PID_FILE" ]; then
        local pid
        pid=$(cat "$WORKER_PID_FILE" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

# Save current checksums of worker files
save_worker_checksums() {
    mkdir -p "$SCRIPT_DIR/data"
    > "$WORKER_CHECKSUM_FILE"  # Clear file

    for f in "${WORKER_FILES[@]}"; do
        if [ -f "$SCRIPT_DIR/$f" ]; then
            local checksum
            checksum=$(md5 -q "$SCRIPT_DIR/$f" 2>/dev/null || echo "missing")
            echo "$checksum  $f" >> "$WORKER_CHECKSUM_FILE"
        fi
    done
}

# Check if worker code has changed since the worker was started
worker_code_changed() {
    if ! worker_running; then
        return 0  # Not running = needs start
    fi

    # If no checksum file exists, treat as changed (first run)
    if [ ! -f "$WORKER_CHECKSUM_FILE" ]; then
        info "No worker checksum file found — treating as changed"
        return 0
    fi

    # Compare current checksums against saved checksums
    for f in "${WORKER_FILES[@]}"; do
        if [ -f "$SCRIPT_DIR/$f" ]; then
            local current_checksum
            current_checksum=$(md5 -q "$SCRIPT_DIR/$f" 2>/dev/null || echo "missing")

            local saved_checksum
            saved_checksum=$(grep " $f\$" "$WORKER_CHECKSUM_FILE" 2>/dev/null | cut -d' ' -f1 || echo "")

            if [ "$current_checksum" != "$saved_checksum" ]; then
                info "Worker code changed: $f (checksum mismatch)"
                return 0
            fi
        fi
    done

    return 1  # No changes
}

# Start worker if not already running
start_worker() {
    header "Checking SDK worker"

    if worker_running; then
        local pid
        pid=$(cat "$WORKER_PID_FILE")
        ok "SDK worker already running (PID: $pid)"
        return 0
    fi

    info "Starting SDK worker..."
    detect_python
    mkdir -p "$SCRIPT_DIR/logs" "$SCRIPT_DIR/data"

    export PYTHONPATH="$SCRIPT_DIR:${PYTHONPATH:-}"
    nohup "$PYTHON" "$SCRIPT_DIR/backend/sdk_worker.py" > "$SCRIPT_DIR/logs/worker.log" 2>&1 &

    # Wait for socket to appear
    local max_wait=10
    local waited=0
    while [ $waited -lt $max_wait ]; do
        if [ -S "$SCRIPT_DIR/data/sdk_worker.sock" ]; then
            ok "SDK worker started (PID: $(cat "$WORKER_PID_FILE" 2>/dev/null))"
            # Save checksums after successful start
            save_worker_checksums
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done

    error "SDK worker failed to start after ${max_wait}s"
    tail -20 "$SCRIPT_DIR/logs/worker.log" 2>/dev/null || true
    exit 1
}

# Stop the worker
stop_worker() {
    header "Stopping SDK worker"

    if ! worker_running; then
        ok "SDK worker not running"
        return 0
    fi

    local pid
    pid=$(cat "$WORKER_PID_FILE")
    info "Stopping SDK worker (PID: $pid)..."
    kill -TERM "$pid" 2>/dev/null || true
    sleep 2

    if kill -0 "$pid" 2>/dev/null; then
        warn "Force killing worker..."
        kill -9 "$pid" 2>/dev/null || true
    fi

    rm -f "$WORKER_PID_FILE" "$SCRIPT_DIR/data/sdk_worker.sock"
    ok "SDK worker stopped"
}

# Restart worker only if its code changed
smart_worker_restart() {
    if worker_code_changed; then
        if worker_running; then
            warn "Worker code changed — restarting worker (active sessions will be interrupted)"
            stop_worker
        fi
        start_worker
        # Checksums saved by start_worker after successful start
    else
        start_worker  # ensures it's running, no-op if already running
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

# Install Electron dependencies
install_electron() {
    header "Installing Electron dependencies"

    if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
        info "Running npm install in project root..."
        cd "$SCRIPT_DIR"
        npm install || { error "npm install failed"; exit 1; }
    else
        ok "Electron dependencies already installed"
    fi
}

# Launch desktop app (exclusive mode - stops existing services)
launch_desktop() {
    header "Launching desktop app"

    # Ensure electron is installed
    install_electron

    # Build frontend first if needed
    if [ ! -d "$SCRIPT_DIR/static/chat" ] || [ -z "$(ls -A "$SCRIPT_DIR/static/chat" 2>/dev/null)" ]; then
        warn "No static build found, building frontend first..."
        build_frontend
        deploy_static
    fi

    # Stop any running web server (desktop app starts its own)
    if lsof -ti:$PORT >/dev/null 2>&1; then
        info "Stopping web server (desktop app will start its own)..."
        kill_server
    fi

    # Stop worker if running (desktop app starts its own)
    if worker_running; then
        info "Stopping worker (desktop app will start its own)..."
        stop_worker
    fi

    info "Starting cc+ Desktop..."
    cd "$SCRIPT_DIR"
    npm run electron:dev
}

# Launch desktop app (parallel mode - runs alongside web server)
launch_desktop_parallel() {
    header "Launching desktop app (parallel mode)"

    # Ensure electron is installed
    install_electron

    # Build frontend first if needed
    if [ ! -d "$SCRIPT_DIR/static/chat" ] || [ -z "$(ls -A "$SCRIPT_DIR/static/chat" 2>/dev/null)" ]; then
        warn "No static build found, building frontend first..."
        build_frontend
        deploy_static
    fi

    # Ensure worker is running (shared between web and desktop)
    if ! worker_running; then
        info "Starting shared SDK worker..."
        start_worker
    else
        info "Using existing SDK worker (shared with web server)"
    fi

    # Check if web server is running
    if lsof -ti:$PORT >/dev/null 2>&1; then
        info "Web server running on port $PORT"
        info "Desktop will run on port 4001"
    else
        info "No web server running, desktop will use port 4001"
    fi

    info "Starting cc+ Desktop (parallel mode)..."
    cd "$SCRIPT_DIR"
    # Use port 4001 for desktop to avoid conflict with web server
    PORT=4001 npm run electron:dev
}

# Usage
show_usage() {
    echo "Usage: ./deploy.sh [component]"
    echo ""
    echo "Components:"
    echo "  (none)     Full deploy: build frontend + deploy + restart server"
    echo "             Worker only restarts if sdk_worker.py or config.py changed."
    echo "             Active SDK sessions survive server-only restarts."
    echo "  frontend   Build + deploy frontend only (no server restart)"
    echo "  server     Restart Flask server only (worker stays alive)"
    echo "  worker     Force restart the SDK worker (kills active SDK sessions)"
    echo "  desktop    Launch the Electron desktop app (stops existing services)"
    echo "  desktop-parallel  Launch desktop app in parallel with web server (port 4001)"
    echo "  stop       Stop both Flask server and SDK worker"
    echo ""
    echo "Examples:"
    echo "  ./deploy.sh            # Safe deploy — active queries survive if possible"
    echo "  ./deploy.sh frontend   # Frontend only, keeps everything alive"
    echo "  ./deploy.sh server     # Restart Flask only, SDK sessions survive"
    echo "  ./deploy.sh worker     # Force restart worker (drops active sessions)"
    echo "  ./deploy.sh desktop    # Launch desktop app (stops web server)"
    echo "  ./deploy.sh desktop-parallel  # Launch desktop alongside web server"
    echo "  ./deploy.sh stop       # Stop everything"
}

# Main
COMPONENT="${1:-all}"

case "$COMPONENT" in
    all)
        smart_worker_restart
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
        smart_worker_restart
        kill_server
        start_server
        ;;
    worker)
        stop_worker
        start_worker
        # Flask must reconnect to the new worker socket
        kill_server
        start_server
        ;;
    desktop)
        launch_desktop
        ;;
    desktop-parallel)
        launch_desktop_parallel
        ;;
    stop)
        kill_server
        stop_worker
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

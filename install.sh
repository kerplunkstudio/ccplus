#!/usr/bin/env bash
# cc+ installer - One-line install for ccplus
# Usage: curl -fsSL https://raw.githubusercontent.com/mjfuentes/ccplus/main/install.sh | bash

set -euo pipefail

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

# Banner
show_banner() {
    cat <<'EOF'

   ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
   ┃                            ┃
   ┃      cc+ installer         ┃
   ┃                            ┃
   ┃  Claude Code Context Plus  ┃
   ┃  Web UI & Observability    ┃
   ┃                            ┃
   ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

EOF
}

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Darwin*)
            OS="macos"
            ;;
        Linux*)
            if grep -qi microsoft /proc/version 2>/dev/null; then
                OS="wsl"
            else
                OS="linux"
            fi
            ;;
        *)
            OS="unknown"
            ;;
    esac
}

# Show install instructions for missing prerequisites
show_install_instructions() {
    local prereq="$1"

    echo ""
    error "Missing prerequisite: $prereq"
    echo ""

    case "$prereq" in
        python3)
            echo "Install Python 3.12+:"
            if [ "$OS" = "macos" ]; then
                echo "  brew install python@3.12"
            elif [ "$OS" = "linux" ]; then
                echo "  # Debian/Ubuntu:"
                echo "  sudo apt update && sudo apt install python3.12 python3.12-venv"
                echo ""
                echo "  # Fedora:"
                echo "  sudo dnf install python3.12"
            fi
            echo ""
            echo "Or download from: https://www.python.org/downloads/"
            ;;
        node)
            echo "Install Node.js 18+:"
            if [ "$OS" = "macos" ]; then
                echo "  brew install node"
            elif [ "$OS" = "linux" ]; then
                echo "  # Debian/Ubuntu:"
                echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
                echo "  sudo apt-get install -y nodejs"
                echo ""
                echo "  # Fedora:"
                echo "  sudo dnf install nodejs npm"
            fi
            echo ""
            echo "Or download from: https://nodejs.org/en/download/"
            ;;
        npm)
            echo "npm is usually bundled with Node.js"
            echo "If you have Node.js but not npm, reinstall Node.js from: https://nodejs.org/"
            ;;
        git)
            echo "Install git:"
            if [ "$OS" = "macos" ]; then
                echo "  brew install git"
            elif [ "$OS" = "linux" ]; then
                echo "  # Debian/Ubuntu:"
                echo "  sudo apt install git"
                echo ""
                echo "  # Fedora:"
                echo "  sudo dnf install git"
            fi
            ;;
    esac
    echo ""
}

# Check prerequisites
check_prerequisites() {
    header "Checking prerequisites"

    local missing=0

    # Python 3.12+
    if command -v python3 >/dev/null 2>&1; then
        py_version=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "0.0")
        py_major=$(echo "$py_version" | cut -d. -f1)
        py_minor=$(echo "$py_version" | cut -d. -f2)

        if [ "$py_major" -eq 3 ] && [ "$py_minor" -ge 12 ]; then
            ok "Python $py_version"
        else
            error "Python $py_version found (need 3.12+)"
            show_install_instructions "python3"
            missing=1
        fi
    else
        error "Python 3 not found"
        show_install_instructions "python3"
        missing=1
    fi

    # Node.js 18+
    if command -v node >/dev/null 2>&1; then
        node_version=$(node -v)
        node_major=$(echo "$node_version" | sed 's/v//' | cut -d. -f1)

        if [ "$node_major" -ge 18 ]; then
            ok "Node.js $node_version"
        else
            error "Node.js $node_version found (need 18+)"
            show_install_instructions "node"
            missing=1
        fi
    else
        error "Node.js not found"
        show_install_instructions "node"
        missing=1
    fi

    # npm
    if command -v npm >/dev/null 2>&1; then
        npm_version=$(npm -v)
        ok "npm $npm_version"
    else
        error "npm not found"
        show_install_instructions "npm"
        missing=1
    fi

    # git
    if command -v git >/dev/null 2>&1; then
        git_version=$(git --version | awk '{print $3}')
        ok "git $git_version"
    else
        error "git not found"
        show_install_instructions "git"
        missing=1
    fi

    # Claude CLI (warn but not fatal)
    if command -v claude >/dev/null 2>&1; then
        claude_version=$(claude --version 2>&1 | head -1 || echo "unknown")
        ok "Claude CLI ($claude_version)"
    else
        warn "Claude CLI not found (required for cc+ to work)"
        echo ""
        echo "  Install with: ${BOLD}npm install -g @anthropic-ai/claude-code${RESET}"
        echo ""
        echo "  You can install it now or after cc+ installation."
        echo ""
    fi

    if [ $missing -gt 0 ]; then
        echo ""
        error "Please install missing prerequisites and try again"
        exit 1
    fi

    ok "All prerequisites met"
}

# Determine install directory
determine_install_dir() {
    INSTALL_DIR="${CCPLUS_INSTALL_DIR:-$HOME/.ccplus}"

    if [ -d "$INSTALL_DIR" ]; then
        if [ -d "$INSTALL_DIR/.git" ]; then
            # Existing ccplus installation
            info "Found existing installation at $INSTALL_DIR"

            # Check if it's actually ccplus
            if [ -f "$INSTALL_DIR/ccplus" ]; then
                echo ""
                read -p "Would you like to update instead? (y/n) [y]: " response
                response="${response:-y}"

                if [ "$response" = "y" ] || [ "$response" = "Y" ]; then
                    cd "$INSTALL_DIR"

                    # Fetch and pull
                    info "Fetching updates..."
                    git fetch --quiet 2>/dev/null || true

                    info "Pulling latest changes..."
                    git pull --quiet 2>/dev/null || true

                    # Run ccplus to build and start
                    info "Rebuilding and starting..."
                    ./ccplus

                    echo ""
                    ok "Update complete!"
                    echo ""
                    echo "  URL: ${BOLD}http://localhost:4000${RESET}"
                    echo ""
                    exit 0
                else
                    error "Installation cancelled"
                    exit 1
                fi
            else
                error "$INSTALL_DIR exists but does not appear to be a ccplus installation"
                error "Please remove it manually: rm -rf $INSTALL_DIR"
                exit 1
            fi
        else
            error "$INSTALL_DIR exists but is not a git repository"
            error "Please remove it manually: rm -rf $INSTALL_DIR"
            exit 1
        fi
    fi
}

# Clone repository
clone_repo() {
    header "Cloning ccplus"

    info "Cloning from GitHub to $INSTALL_DIR..."

    if ! git clone --quiet https://github.com/mjfuentes/ccplus.git "$INSTALL_DIR" 2>&1; then
        error "Failed to clone repository"
        exit 1
    fi

    cd "$INSTALL_DIR"

    # If stable channel, checkout latest tag
    CHANNEL="${CCPLUS_CHANNEL:-stable}"
    if [ "$CHANNEL" = "stable" ]; then
        LATEST_TAG=$(git tag --sort=-v:refname 2>/dev/null | head -1)
        if [ -n "$LATEST_TAG" ]; then
            info "Checking out stable release: $LATEST_TAG"
            git checkout --quiet "$LATEST_TAG" 2>/dev/null || true
        fi
    fi

    ok "Repository cloned"
}

# Run setup
run_setup() {
    header "Running setup"

    cd "$INSTALL_DIR"

    info "Running ./ccplus (this will setup and start the server)..."
    echo ""

    # Run ccplus which will trigger first-run setup
    ./ccplus
}

# Setup PATH
setup_path() {
    header "Setting up PATH"

    # Detect shell
    SHELL_NAME=$(basename "$SHELL")

    case "$SHELL_NAME" in
        bash)
            SHELL_RC="$HOME/.bashrc"
            ;;
        zsh)
            SHELL_RC="$HOME/.zshrc"
            ;;
        *)
            SHELL_RC="$HOME/.profile"
            ;;
    esac

    # Check if already in PATH
    if echo "$PATH" | grep -q "$INSTALL_DIR"; then
        ok "Install directory already in PATH"
        return 0
    fi

    # Try to create symlink in ~/.local/bin or /usr/local/bin
    if [ -d "$HOME/.local/bin" ] && [ -w "$HOME/.local/bin" ]; then
        info "Creating symlink in ~/.local/bin/ccplus"
        ln -sf "$INSTALL_DIR/ccplus" "$HOME/.local/bin/ccplus"
        ln -sf "$INSTALL_DIR/ccplus-desktop" "$HOME/.local/bin/ccplus-desktop"
        ok "Symlinks created in ~/.local/bin"

        # Check if ~/.local/bin is in PATH
        if ! echo "$PATH" | grep -q "$HOME/.local/bin"; then
            warn "~/.local/bin is not in your PATH"
            echo ""
            echo "  Add this to your $SHELL_RC:"
            echo ""
            echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
            echo ""
        fi
    elif [ -d "/usr/local/bin" ] && [ -w "/usr/local/bin" ]; then
        info "Creating symlink in /usr/local/bin/ccplus"
        ln -sf "$INSTALL_DIR/ccplus" "/usr/local/bin/ccplus"
        ln -sf "$INSTALL_DIR/ccplus-desktop" "/usr/local/bin/ccplus-desktop"
        ok "Symlinks created in /usr/local/bin"
    else
        warn "Could not create symlinks in ~/.local/bin or /usr/local/bin"
        echo ""
        echo "  To use 'ccplus' from anywhere, add this to your $SHELL_RC:"
        echo ""
        echo "    export PATH=\"$INSTALL_DIR:\$PATH\""
        echo ""
        echo "  Or create an alias:"
        echo ""
        echo "    alias ccplus='$INSTALL_DIR/ccplus'"
        echo ""
    fi
}

# Open browser
open_browser() {
    header "Opening browser"

    local url="http://localhost:4000"

    # Wait for server to be ready
    local max_wait=5
    local waited=0
    while [ $waited -lt $max_wait ]; do
        if curl -s -o /dev/null -w "%{http_code}" "$url/health" 2>/dev/null | grep -q "200"; then
            break
        fi
        sleep 1
        waited=$((waited + 1))
    done

    # Open browser based on OS
    case "$OS" in
        macos)
            open "$url" 2>/dev/null || true
            ok "Opened browser (macOS)"
            ;;
        linux)
            if command -v xdg-open >/dev/null 2>&1; then
                xdg-open "$url" 2>/dev/null || true
                ok "Opened browser (Linux)"
            fi
            ;;
        wsl)
            if command -v wslview >/dev/null 2>&1; then
                wslview "$url" 2>/dev/null || true
                ok "Opened browser (WSL)"
            elif command -v cmd.exe >/dev/null 2>&1; then
                cmd.exe /c start "$url" 2>/dev/null || true
                ok "Opened browser (WSL)"
            fi
            ;;
    esac
}

# Show final message
show_final_message() {
    echo ""
    echo "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo ""
    echo "${GREEN}${BOLD}  Installation complete!${RESET}"
    echo ""
    echo "  Install location: ${BOLD}$INSTALL_DIR${RESET}"
    echo "  URL:              ${BOLD}http://localhost:4000${RESET}"
    echo ""
    echo "${BOLD}Quick start:${RESET}"
    echo ""
    echo "  Start cc+:        ${BLUE}ccplus${RESET}"
    echo "  Stop cc+:         ${BLUE}ccplus stop${RESET}"
    echo "  View logs:        ${BLUE}ccplus logs${RESET}"
    echo "  System health:    ${BLUE}ccplus doctor${RESET}"
    echo "  Desktop app:      ${BLUE}ccplus desktop${RESET}"
    echo ""
    echo "${BOLD}Update & uninstall:${RESET}"
    echo ""
    echo "  Check for update: ${BLUE}ccplus check-update${RESET}"
    echo "  Update:           ${BLUE}ccplus update${RESET}"
    echo "  Uninstall:        ${BLUE}rm -rf $INSTALL_DIR${RESET}"
    echo ""
    echo "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo ""
}

# Cleanup on Ctrl+C
cleanup() {
    echo ""
    warn "Installation interrupted"

    if [ -d "$INSTALL_DIR" ] && [ ! -f "$INSTALL_DIR/.env" ]; then
        info "Cleaning up partial installation..."
        rm -rf "$INSTALL_DIR"
    fi

    exit 1
}

trap cleanup INT TERM

# Main installation flow
main() {
    show_banner

    detect_os
    info "Detected OS: $OS"

    check_prerequisites

    determine_install_dir

    clone_repo

    run_setup

    setup_path

    open_browser

    show_final_message
}

main

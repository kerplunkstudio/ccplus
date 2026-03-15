#!/bin/bash
# One-time setup for ccplus
# Usage: ./setup.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Setting up ccplus..."

# Check prerequisites
if ! command -v python3 >/dev/null 2>&1; then
    echo "Error: Python 3 not found" >&2
    exit 1
fi

py_version=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
py_major=$(echo "$py_version" | cut -d. -f1)
py_minor=$(echo "$py_version" | cut -d. -f2)

if [ "$py_major" -ne 3 ] || [ "$py_minor" -lt 12 ]; then
    echo "Error: Python 3.12+ required (found $py_version)" >&2
    exit 1
fi

if ! command -v node >/dev/null 2>&1; then
    echo "Error: Node.js not found" >&2
    exit 1
fi

node_major=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$node_major" -lt 18 ]; then
    echo "Error: Node.js 18+ required (found $(node -v))" >&2
    exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "Error: npm not found" >&2
    exit 1
fi

# Create venv if needed
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv || exit 1
fi

# Install Python dependencies
echo "Installing Python dependencies..."
source venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt || exit 1

# Install frontend dependencies
echo "Installing frontend dependencies..."
cd frontend
npm install --silent || exit 1
cd "$SCRIPT_DIR"

# Setup .env file
if [ ! -f ".env" ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
fi

# Check Claude Code CLI is available
if ! command -v claude >/dev/null 2>&1; then
    echo "Error: Claude Code CLI not found. Install it first: npm install -g @anthropic-ai/claude-code" >&2
    exit 1
fi

echo ""
echo "Setup complete!"
echo ""
echo "Run ./ccplus to start"
echo ""

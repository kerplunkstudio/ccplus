#!/bin/bash
LOCKDIR="/tmp/ccplus-vitest.lock"
TIMEOUT=300
WAITED=0

# Acquire lock using atomic mkdir
while ! mkdir "$LOCKDIR" 2>/dev/null; do
  if [ $WAITED -ge $TIMEOUT ]; then
    echo "Timeout waiting for test lock after ${TIMEOUT}s" >&2
    exit 1
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done

# Release lock on exit
trap 'rmdir "$LOCKDIR" 2>/dev/null' EXIT

npx vitest "$@"

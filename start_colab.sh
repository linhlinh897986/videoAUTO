#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT_DIR/.colab-logs"
NGROK_DIR="$ROOT_DIR/.ngrok-bin"
NGROK_BIN="$NGROK_DIR/ngrok"
NGROK_TOKEN="${NGROK_AUTHTOKEN:-2ScO6CTnKEI0FI0RcxcyLADNCAh_771vYkBo8o7jNKwgFX4Jt}"
BACKEND_PORT=8000
FRONTEND_PORT=4173
NGROK_CONFIG="$LOG_DIR/ngrok.yml"

mkdir -p "$LOG_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

cleanup_process() {
    local pattern="$1"
    if pgrep -f "$pattern" >/dev/null 2>&1; then
        log "Stopping existing process matching '$pattern'"
        pkill -f "$pattern" || true
    fi
}

ensure_python_env() {
    if ! command -v python3 >/dev/null 2>&1; then
        log "Python 3 is required but was not found. Aborting."
        exit 1
    fi

    log "Installing backend dependencies"
    python3 -m pip install --upgrade pip >/dev/null
    python3 -m pip install -r "$ROOT_DIR/Backend/requirements.txt"
}

ensure_node() {
    if ! command -v node >/dev/null 2>&1; then
        log "Node.js not found. Installing via apt-get (this can take a minute)"
        apt-get update >/dev/null
        apt-get install -y nodejs npm >/dev/null
    fi

    if ! command -v npm >/dev/null 2>&1; then
        log "npm installation failed. Aborting."
        exit 1
    fi

    (cd "$ROOT_DIR/Frontend" && log "Installing frontend dependencies" && npm install >/dev/null)
}

ensure_ngrok() {
    if [ ! -x "$NGROK_BIN" ]; then
        log "Downloading ngrok binary"
        mkdir -p "$NGROK_DIR"
        curl -sSLo "$NGROK_DIR/ngrok.tgz" https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz
        tar -xzf "$NGROK_DIR/ngrok.tgz" -C "$NGROK_DIR"
        rm "$NGROK_DIR/ngrok.tgz"
        chmod +x "$NGROK_BIN"
    fi

    cat > "$NGROK_CONFIG" <<CFG
version: 2
authtoken: $NGROK_TOKEN
tunnels:
  backend:
    addr: $BACKEND_PORT
    proto: http
  frontend:
    addr: $FRONTEND_PORT
    proto: http
CFG
}

start_backend() {
    cleanup_process "uvicorn.*main:app"
    log "Starting FastAPI backend on port $BACKEND_PORT"
    (cd "$ROOT_DIR/Backend" && nohup python3 -m uvicorn main:app --host 0.0.0.0 --port "$BACKEND_PORT" > "$LOG_DIR/backend.log" 2>&1 &)
}

start_ngrok() {
    cleanup_process "ngrok .*ngrok.yml"
    log "Starting ngrok tunnels"
    nohup "$NGROK_BIN" start --all --config "$NGROK_CONFIG" > "$LOG_DIR/ngrok.log" 2>&1 &

    # Wait for ngrok API to report active tunnels
    local attempts=0
    while [ $attempts -lt 30 ]; do
        sleep 2
        if curl -sS http://127.0.0.1:4040/api/tunnels >/dev/null 2>&1; then
            break
        fi
        attempts=$((attempts + 1))
    done

    if [ $attempts -eq 30 ]; then
        log "ngrok API did not start in time"
        exit 1
    fi
}

extract_ngrok_url() {
    local tunnel_name="$1"
    curl -sS http://127.0.0.1:4040/api/tunnels | python3 - "$tunnel_name" <<'PY'
import json
import sys

data = json.load(sys.stdin)
target = sys.argv[1]
for tunnel in data.get("tunnels", []):
    if tunnel.get("name") == target:
        print(tunnel.get("public_url", ""))
        break
PY
}

start_frontend() {
    cleanup_process "npm run dev"

    local backend_url=""
    local attempts=0
    while [ $attempts -lt 15 ]; do
        backend_url=$(extract_ngrok_url backend)
        if [ -n "$backend_url" ]; then
            break
        fi
        sleep 2
        attempts=$((attempts + 1))
    done

    if [ -z "$backend_url" ]; then
        log "Failed to determine backend ngrok URL"
        exit 1
    fi

    log "Starting Vite frontend on port $FRONTEND_PORT (API base: $backend_url)"
    (cd "$ROOT_DIR/Frontend" && VITE_API_BASE_URL="$backend_url" nohup npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" > "$LOG_DIR/frontend.log" 2>&1 &)
}

print_summary() {
    local backend_url="" frontend_url=""

    local attempts=0
    while [ $attempts -lt 15 ]; do
        backend_url=$(extract_ngrok_url backend)
        frontend_url=$(extract_ngrok_url frontend)
        if [ -n "$backend_url" ] && [ -n "$frontend_url" ]; then
            break
        fi
        sleep 2
        attempts=$((attempts + 1))
    done

    log "--- Setup Complete ---"
    log "Backend public URL:  $backend_url"
    log "Frontend public URL: $frontend_url"
    log "Backend log:   $LOG_DIR/backend.log"
    log "Frontend log:  $LOG_DIR/frontend.log"
    log "ngrok log:     $LOG_DIR/ngrok.log"
    log "Use 'tail -f <logfile>' to monitor output."
}

ensure_python_env
ensure_node
start_backend
ensure_ngrok
start_ngrok
start_frontend
print_summary

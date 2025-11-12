#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT_DIR/.colab-logs"
CLOUDFLARED_DIR="$ROOT_DIR/.cloudflared-bin"
CLOUDFLARED_BIN="$CLOUDFLARED_DIR/cloudflared"
BACKEND_PORT=8000
FRONTEND_PORT=4173

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

ensure_ffmpeg() {
    if ! command -v ffmpeg >/dev/null 2>&1; then
        log "ffmpeg not found. Installing via apt-get (this can take a minute)"
        sudo apt-get update >/dev/null 2>&1 || apt-get update >/dev/null 2>&1
        sudo apt-get install -y ffmpeg >/dev/null 2>&1 || apt-get install -y ffmpeg >/dev/null 2>&1
    fi
    
    if ! command -v ffmpeg >/dev/null 2>&1; then
        log "WARNING: ffmpeg installation failed. Audio extraction from video will not work."
    else
        log "ffmpeg is available: $(ffmpeg -version | head -n1)"
    fi
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

ensure_cloudflared() {
    if [ ! -x "$CLOUDFLARED_BIN" ]; then
        log "Downloading cloudflared binary"
        mkdir -p "$CLOUDFLARED_DIR"
        curl -sSLo "$CLOUDFLARED_BIN" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
        chmod +x "$CLOUDFLARED_BIN"
    fi
}

start_backend() {
    cleanup_process "uvicorn.*main:app"
    log "Starting FastAPI backend on port $BACKEND_PORT"
    (cd "$ROOT_DIR/Backend" && nohup python3 -m uvicorn main:app --host 0.0.0.0 --port "$BACKEND_PORT" > "$LOG_DIR/backend.log" 2>&1 &)
}

start_cloudflared() {
    cleanup_process "cloudflared tunnel"
    log "Starting cloudflared tunnel for frontend"
    nohup "$CLOUDFLARED_BIN" tunnel --url "http://127.0.0.1:$FRONTEND_PORT" > "$LOG_DIR/cloudflared.log" 2>&1 &

    # Wait for cloudflared to start
    sleep 5
}

extract_cloudflared_url() {
    # Extract URL from cloudflared log file
    local attempts=0
    while [ $attempts -lt 30 ]; do
        if [ -f "$LOG_DIR/cloudflared.log" ]; then
            local url=$(grep -oP 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$LOG_DIR/cloudflared.log" | head -n1)
            if [ -n "$url" ]; then
                echo "$url"
                return 0
            fi
        fi
        sleep 2
        attempts=$((attempts + 1))
    done
    echo ""
}

wait_for_backend() {
    log "Waiting for backend readiness on http://127.0.0.1:$BACKEND_PORT"
    local attempts=0
    while [ $attempts -lt 30 ]; do
        if curl -sS "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null 2>&1; then
            return 0
        fi
        sleep 2
        attempts=$((attempts + 1))
    done

    log "Backend did not become ready in time"
    exit 1
}

start_frontend() {
    cleanup_process "npm run dev"
    wait_for_backend

    log "Starting Vite frontend on port $FRONTEND_PORT (API base: local backend)"
    (cd "$ROOT_DIR/Frontend" && VITE_API_BASE_URL="" nohup npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" > "$LOG_DIR/frontend.log" 2>&1 &)
}

print_summary() {
    local frontend_url=$(extract_cloudflared_url)

    log "--- Setup Complete ---"
    log "Backend local URL:   http://127.0.0.1:$BACKEND_PORT (inside Colab runtime)"
    log "Frontend public URL: $frontend_url"
    log "Uploaded media path: $ROOT_DIR/Backend/data/files"
    log "ASR SRT exports:     $ROOT_DIR/Backend/data/asr"
    log "Backend log:      $LOG_DIR/backend.log"
    log "Frontend log:     $LOG_DIR/frontend.log"
    log "Cloudflared log:  $LOG_DIR/cloudflared.log"
    log "Use 'tail -f <logfile>' to monitor output."
}

ensure_python_env
ensure_ffmpeg
ensure_node
start_backend
ensure_cloudflared
start_cloudflared
start_frontend
print_summary

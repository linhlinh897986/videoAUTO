from __future__ import annotations

import os
from pathlib import Path


# The legacy application stored its SQLite database and generated assets in
# Backend/data.  When the FastAPI routers were split into modules the root
# calculation accidentally pointed to Backend/app instead, which caused new
# files (including TTS audio) to be written under Backend/app/data.  The
# frontend still expects everything under Backend/data, so we restore the
# original root path calculation here.
APP_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = APP_ROOT / "data"
DB_PATH = DATA_ROOT / "app.db"

DATA_ROOT.mkdir(parents=True, exist_ok=True)

# Video rendering configuration for large video support
# Timeout in seconds for video rendering (default: 2 hours for large videos)
# Can be overridden with RENDER_TIMEOUT_SECONDS environment variable
RENDER_TIMEOUT_SECONDS = int(os.getenv("RENDER_TIMEOUT_SECONDS", "7200"))

# Maximum file size for uploads in bytes (default: 10GB)
# Can be overridden with MAX_UPLOAD_SIZE_BYTES environment variable
MAX_UPLOAD_SIZE_BYTES = int(os.getenv("MAX_UPLOAD_SIZE_BYTES", str(10 * 1024 * 1024 * 1024)))

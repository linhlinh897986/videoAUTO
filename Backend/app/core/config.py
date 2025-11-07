from __future__ import annotations

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

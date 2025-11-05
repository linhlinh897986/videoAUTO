from __future__ import annotations

from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = APP_ROOT / "data"
DB_PATH = DATA_ROOT / "app.db"

DATA_ROOT.mkdir(parents=True, exist_ok=True)

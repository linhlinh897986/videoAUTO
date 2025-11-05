from __future__ import annotations

from app.db import Database
from app.core.config import DB_PATH


db = Database(DB_PATH)

"""Core dependencies and configuration for the VideoAUTO backend."""

from __future__ import annotations

from .config import APP_ROOT, DATA_ROOT, DB_PATH, RENDER_TIMEOUT_SECONDS, MAX_UPLOAD_SIZE_BYTES
from .database import db

__all__ = ["APP_ROOT", "DATA_ROOT", "DB_PATH", "RENDER_TIMEOUT_SECONDS", "MAX_UPLOAD_SIZE_BYTES", "db"]

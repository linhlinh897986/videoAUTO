"""Core dependencies and configuration for the VideoAUTO backend."""

from __future__ import annotations

from .config import APP_ROOT, DATA_ROOT, DB_PATH
from .database import db

__all__ = ["APP_ROOT", "DATA_ROOT", "DB_PATH", "db"]

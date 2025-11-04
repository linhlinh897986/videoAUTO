from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


class Database:
    """Simple SQLite-backed storage for projects, settings, and binary files."""

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._data_root = self._db_path.parent  # data/ folder
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                PRAGMA foreign_keys = ON;

                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS api_keys (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS custom_styles (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS files (
                    id TEXT PRIMARY KEY,
                    project_id TEXT,
                    filename TEXT NOT NULL,
                    content_type TEXT,
                    data BLOB NOT NULL,
                    created_at TEXT NOT NULL,
                    storage_path TEXT,
                    file_size INTEGER,
                    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
                );
                """
            )
            self._ensure_file_columns(conn)

    def _ensure_file_columns(self, conn: sqlite3.Connection) -> None:
        """Ensure newer metadata columns exist for the files table."""

        def _add_column(column: str, ddl: str) -> None:
            try:
                conn.execute(f"ALTER TABLE files ADD COLUMN {column} {ddl}")
            except sqlite3.OperationalError:
                # Column already exists
                pass

        _add_column("storage_path", "TEXT")
        _add_column("file_size", "INTEGER")

    # --- Projects -----------------------------------------------------------------
    def list_projects(self) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT data FROM projects ORDER BY updated_at DESC").fetchall()
        return [json.loads(row["data"]) for row in rows]

    def upsert_project(self, project: Dict[str, Any], updated_at: str) -> None:
        project_id = project.get("id")
        if not project_id:
            raise ValueError("Project payload is missing an 'id'")

        with self._connect() as conn:
            conn.execute(
                "REPLACE INTO projects (id, data, updated_at) VALUES (?, ?, ?)",
                (project_id, json.dumps(project), updated_at),
            )
            conn.commit()

    def delete_project(self, project_id: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            conn.commit()

    def get_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT data FROM projects WHERE id = ?",
                (project_id,),
            ).fetchone()
        if row is None:
            return None
        return json.loads(row["data"])

    # --- API keys ------------------------------------------------------------------
    def list_api_keys(self) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT data FROM api_keys ORDER BY updated_at DESC").fetchall()
        return [json.loads(row["data"]) for row in rows]

    def replace_api_keys(self, keys: Iterable[Dict[str, Any]], updated_at: str) -> None:
        serialized = [(key.get("id"), json.dumps(key)) for key in keys]

        with self._connect() as conn:
            conn.execute("DELETE FROM api_keys")
            if serialized:
                conn.executemany(
                    "INSERT INTO api_keys (id, data, updated_at) VALUES (?, ?, ?)",
                    [(key_id or "", payload, updated_at) for key_id, payload in serialized],
                )
            conn.commit()

    # --- Custom styles -------------------------------------------------------------
    def list_custom_styles(self) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT data FROM custom_styles ORDER BY updated_at DESC").fetchall()
        return [json.loads(row["data"]) for row in rows]

    def replace_custom_styles(self, styles: Iterable[Dict[str, Any]], updated_at: str) -> None:
        serialized = [(style.get("id"), json.dumps(style)) for style in styles]

        with self._connect() as conn:
            conn.execute("DELETE FROM custom_styles")
            if serialized:
                conn.executemany(
                    "INSERT INTO custom_styles (id, data, updated_at) VALUES (?, ?, ?)",
                    [(style_id or "", payload, updated_at) for style_id, payload in serialized],
                )
            conn.commit()

    # --- Files ---------------------------------------------------------------------
    def save_file(
        self,
        file_id: str,
        project_id: Optional[str],
        filename: str,
        content_type: Optional[str],
        data: bytes,
        created_at: str,
    ) -> Tuple[Path, int]:
        if not file_id:
            raise ValueError("File ID must be provided")

        # Persist file on disk: data/{project_id}/files/{filename}
        # Use filename parameter for the actual file, sanitize it for safety
        safe_filename = Path(filename).name
        project_folder = project_id or "unassigned"
        target_dir = self._data_root / project_folder / "files"
        target_dir.mkdir(parents=True, exist_ok=True)
        storage_path = target_dir / safe_filename
        storage_path.write_bytes(data)
        file_size = storage_path.stat().st_size

        with self._connect() as conn:
            conn.execute(
                "REPLACE INTO files (id, project_id, filename, content_type, data, created_at, storage_path, file_size)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    file_id,
                    project_id,
                    filename,
                    content_type,
                    data,
                    created_at,
                    str(storage_path),
                    file_size,
                ),
            )
            conn.commit()

        return storage_path, file_size

    def get_file(self, file_id: str) -> Optional[Tuple[bytes, Optional[str], str]]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT data, content_type, filename, storage_path FROM files WHERE id = ?",
                (file_id,),
            ).fetchone()
        if row is None:
            return None
        storage_path = row["storage_path"]
        if storage_path:
            path = Path(storage_path)
            if path.exists():
                return path.read_bytes(), row["content_type"], row["filename"]
        return row["data"], row["content_type"], row["filename"]

    def get_file_metadata(self, file_id: str) -> Optional[Dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, project_id, filename, content_type, created_at, storage_path, file_size"
                " FROM files WHERE id = ?",
                (file_id,),
            ).fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "project_id": row["project_id"],
            "filename": row["filename"],
            "content_type": row["content_type"],
            "created_at": row["created_at"],
            "storage_path": row["storage_path"],
            "file_size": row["file_size"],
        }

    def delete_file(self, file_id: str) -> None:
        storage_path: Optional[str] = None
        with self._connect() as conn:
            row = conn.execute(
                "SELECT storage_path FROM files WHERE id = ?",
                (file_id,),
            ).fetchone()
            if row is not None:
                storage_path = row["storage_path"]
            conn.execute("DELETE FROM files WHERE id = ?", (file_id,))
            conn.commit()

        if storage_path:
            path = Path(storage_path)
            try:
                path.unlink()
            except FileNotFoundError:
                pass

    def delete_files_for_project(self, project_id: str) -> None:
        storage_paths: List[str] = []
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT storage_path FROM files WHERE project_id = ?",
                (project_id,),
            ).fetchall()
            storage_paths = [row["storage_path"] for row in rows if row["storage_path"]]
            conn.execute("DELETE FROM files WHERE project_id = ?", (project_id,))
            conn.commit()

        for storage_path in storage_paths:
            path = Path(storage_path)
            try:
                path.unlink()
            except FileNotFoundError:
                pass

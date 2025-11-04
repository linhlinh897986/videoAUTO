from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from app.db import Database

APP_ROOT = Path(__file__).resolve().parent
DB_PATH = APP_ROOT / "data" / "app.db"

db = Database(DB_PATH)

app = FastAPI(title="VideoAUTO Storage API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check() -> Dict[str, str]:
    return {"status": "ok"}


# --- Projects ----------------------------------------------------------------------
@app.get("/projects", response_model=List[Dict[str, Any]])
def list_projects() -> List[Dict[str, Any]]:
    return db.list_projects()


@app.put("/projects/{project_id}")
def save_project(project_id: str, project: Dict[str, Any] = Body(...)) -> Dict[str, str]:
    payload_id = project.get("id")
    if not payload_id or payload_id != project_id:
        raise HTTPException(status_code=400, detail="Project ID mismatch")

    db.upsert_project(project, dt.datetime.utcnow().isoformat())
    return {"status": "saved"}


@app.delete("/projects/{project_id}")
def delete_project(project_id: str) -> Dict[str, str]:
    db.delete_files_for_project(project_id)
    db.delete_project(project_id)
    return {"status": "deleted"}


# --- API Keys ----------------------------------------------------------------------
@app.get("/api-keys", response_model=List[Dict[str, Any]])
def list_api_keys() -> List[Dict[str, Any]]:
    return db.list_api_keys()


@app.put("/api-keys")
def save_api_keys(keys: List[Dict[str, Any]] = Body(...)) -> Dict[str, str]:
    db.replace_api_keys(keys, dt.datetime.utcnow().isoformat())
    return {"status": "saved"}


# --- Custom Styles -----------------------------------------------------------------
@app.get("/custom-styles", response_model=List[Dict[str, Any]])
def list_custom_styles() -> List[Dict[str, Any]]:
    return db.list_custom_styles()


@app.put("/custom-styles")
def save_custom_styles(styles: List[Dict[str, Any]] = Body(...)) -> Dict[str, str]:
    db.replace_custom_styles(styles, dt.datetime.utcnow().isoformat())
    return {"status": "saved"}


# --- Files -------------------------------------------------------------------------
@app.post("/files")
async def upload_file(
    file_id: str = Form(...),
    project_id: Optional[str] = Form(None),
    file: UploadFile = File(...),
) -> Dict[str, str]:
    data = await file.read()
    db.save_file(
        file_id=file_id,
        project_id=project_id,
        filename=file.filename or file_id,
        content_type=file.content_type,
        data=data,
        created_at=dt.datetime.utcnow().isoformat(),
    )
    return {"status": "saved"}


@app.get("/files/{file_id}")
def download_file(file_id: str) -> Response:
    stored = db.get_file(file_id)
    if stored is None:
        raise HTTPException(status_code=404, detail="File not found")

    data, content_type, filename = stored
    media_type = content_type or "application/octet-stream"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=data, media_type=media_type, headers=headers)


@app.delete("/files/{file_id}")
def delete_file(file_id: str) -> Dict[str, str]:
    db.delete_file(file_id)
    return {"status": "deleted"}


__all__ = ["app"]

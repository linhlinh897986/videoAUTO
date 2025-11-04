from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from app.db import Database
from app.asr_utils import convert_directory_to_srt

APP_ROOT = Path(__file__).resolve().parent
DB_PATH = APP_ROOT / "data" / "app.db"
ASR_ROOT = APP_ROOT / "data" / "asr"

ASR_ROOT.mkdir(parents=True, exist_ok=True)

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


class FileUploadResponse(BaseModel):
    status: str
    path: Optional[str] = None
    size: Optional[int] = None
    created_at: Optional[str] = None


@app.post("/files", response_model=FileUploadResponse)
async def upload_file(
    file_id: str = Form(...),
    project_id: Optional[str] = Form(None),
    file: UploadFile = File(...),
) -> FileUploadResponse:
    data = await file.read()
    created_at = dt.datetime.utcnow().isoformat()
    storage_path, file_size = db.save_file(
        file_id=file_id,
        project_id=project_id,
        filename=file.filename or file_id,
        content_type=file.content_type,
        data=data,
        created_at=created_at,
    )
    return FileUploadResponse(
        status="saved",
        path=str(storage_path),
        size=file_size,
        created_at=created_at,
    )


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


@app.get("/files/{file_id}/info")
def file_info(file_id: str) -> Dict[str, Any]:
    metadata = db.get_file_metadata(file_id)
    if metadata is None:
        raise HTTPException(status_code=404, detail="File not found")
    return metadata


class AsrExportRequest(BaseModel):
    source_dir: str
    output_dir: Optional[str] = None
    pattern: Optional[str] = None
    overwrite: bool = True


@app.post("/asr/export-srt")
def export_asr_to_srt(payload: AsrExportRequest) -> Dict[str, Any]:
    def _resolve(path_value: Optional[str]) -> Optional[Path]:
        if not path_value:
            return None
        candidate = Path(path_value).expanduser()
        if not candidate.is_absolute():
            candidate = (APP_ROOT / candidate).resolve()
        else:
            candidate = candidate.resolve()
        return candidate

    source_dir = _resolve(payload.source_dir)
    if source_dir is None:
        raise HTTPException(status_code=400, detail="source_dir is required")

    output_dir = _resolve(payload.output_dir) or ASR_ROOT

    try:
        conversion = convert_directory_to_srt(
            source_dir=source_dir,
            output_dir=output_dir,
            pattern=payload.pattern,
            overwrite=payload.overwrite,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return {
        "status": "ok",
        "source_dir": str(source_dir),
        "output_dir": str(output_dir),
        **conversion,
    }


__all__ = ["app"]

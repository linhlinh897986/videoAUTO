from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from app.core import db


class FileUploadResponse(BaseModel):
    status: str
    path: Optional[str] = None
    size: Optional[int] = None
    created_at: Optional[str] = None


router = APIRouter(prefix="/files")


@router.post("", response_model=FileUploadResponse)
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


@router.get("/{file_id}")
@router.head("/{file_id}")
def download_file(file_id: str) -> Response:
    # First, try to get file metadata to check if file exists and get storage path
    metadata = db.get_file_metadata(file_id)
    if metadata is None:
        raise HTTPException(status_code=404, detail="File not found")
    
    storage_path_str = metadata.get("storage_path")
    
    # If file is stored on disk, stream it using FileResponse for better performance
    if storage_path_str:
        storage_path = Path(storage_path_str)
        if storage_path.exists():
            media_type = metadata.get("content_type") or "application/octet-stream"
            filename = metadata.get("filename", file_id)
            return FileResponse(
                path=storage_path,
                media_type=media_type,
                filename=filename,
            )
    
    # Fallback to loading from database (for legacy files or small files)
    stored = db.get_file(file_id)
    if stored is None:
        raise HTTPException(status_code=404, detail="File not found")
    
    data, content_type, filename = stored
    media_type = content_type or "application/octet-stream"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=data, media_type=media_type, headers=headers)


@router.delete("/{file_id}")
def delete_file(file_id: str) -> Dict[str, str]:
    db.delete_file(file_id)
    return {"status": "deleted"}


@router.get("/{file_id}/info")
def file_info(file_id: str) -> Dict[str, Any]:
    metadata = db.get_file_metadata(file_id)
    if metadata is None:
        raise HTTPException(status_code=404, detail="File not found")
    return metadata

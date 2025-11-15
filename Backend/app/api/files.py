from __future__ import annotations

import datetime as dt
from typing import Any, Dict, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
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
    created_at = dt.datetime.utcnow().isoformat()
    
    # Use streaming for large files (videos)
    is_video = False
    content_type = file.content_type or ""
    filename = file.filename or file_id
    
    if content_type.startswith("video/") or filename.lower().endswith((".mp4", ".mov", ".avi", ".mkv", ".webm")):
        is_video = True
    
    storage_path, file_size = db.save_file_streaming(
        file_id=file_id,
        project_id=project_id,
        filename=filename,
        content_type=content_type,
        file_stream=file.file,
        created_at=created_at,
        is_video=is_video,
    )
    
    return FileUploadResponse(
        status="saved",
        path=str(storage_path),
        size=file_size,
        created_at=created_at,
    )


@router.get("/{file_id}")
def download_file(file_id: str):
    metadata = db.get_file_metadata(file_id)
    if metadata is None:
        raise HTTPException(status_code=404, detail="File not found")
    
    storage_path = metadata.get("storage_path")
    content_type = metadata.get("content_type") or "application/octet-stream"
    filename = metadata.get("filename", file_id)
    is_video = metadata.get("is_video", False)
    
    # Use streaming for videos and large files
    if storage_path and is_video:
        from pathlib import Path
        storage_file = Path(storage_path)
        
        if not storage_file.exists():
            raise HTTPException(status_code=404, detail="Video file not found on disk")
        
        def iterfile():
            chunk_size = 8 * 1024 * 1024  # 8MB chunks
            with open(storage_file, mode="rb") as file_like:
                while chunk := file_like.read(chunk_size):
                    yield chunk
        
        headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
        return StreamingResponse(iterfile(), media_type=content_type, headers=headers)
    else:
        # For small files (audio, subtitles), use regular response
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

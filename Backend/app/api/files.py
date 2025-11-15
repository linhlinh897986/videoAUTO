from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
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
def download_file(file_id: str, request: Request) -> Response:
    # Get file metadata to determine storage path
    metadata = db.get_file_metadata(file_id)
    if metadata is None:
        raise HTTPException(status_code=404, detail="File not found")
    
    storage_path_str = metadata.get("storage_path")
    content_type = metadata.get("content_type") or "application/octet-stream"
    filename = metadata.get("filename", file_id)
    
    # If we have a storage path, use streaming for better performance on large files
    if storage_path_str:
        storage_path = Path(storage_path_str)
        if storage_path.exists():
            return stream_file_with_range(storage_path, content_type, filename, request)
    
    # Fallback to loading from database (for backward compatibility)
    stored = db.get_file(file_id)
    if stored is None:
        raise HTTPException(status_code=404, detail="File not found")

    data, content_type, filename = stored
    media_type = content_type or "application/octet-stream"
    headers = {"Content-Disposition": f'inline; filename="{filename}"'}
    return Response(content=data, media_type=media_type, headers=headers)


def stream_file_with_range(
    file_path: Path, 
    content_type: str, 
    filename: str, 
    request: Request
) -> Response:
    """Stream a file with support for HTTP Range requests (for video/audio streaming)."""
    
    file_size = file_path.stat().st_size
    range_header = request.headers.get("range")
    
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Disposition": f'inline; filename="{filename}"',
    }
    
    # If no range is requested, return the full file
    if not range_header:
        def iterfile():
            with open(file_path, mode="rb") as f:
                yield from f
        
        headers["Content-Length"] = str(file_size)
        return StreamingResponse(
            iterfile(),
            media_type=content_type,
            headers=headers,
        )
    
    # Parse range header (format: "bytes=start-end")
    try:
        range_str = range_header.replace("bytes=", "")
        range_parts = range_str.split("-")
        start = int(range_parts[0]) if range_parts[0] else 0
        end = int(range_parts[1]) if len(range_parts) > 1 and range_parts[1] else file_size - 1
        
        # Validate range
        if start >= file_size or end >= file_size or start > end:
            raise HTTPException(status_code=416, detail="Range Not Satisfiable")
        
        content_length = end - start + 1
        
        def iterfile_range():
            with open(file_path, mode="rb") as f:
                f.seek(start)
                remaining = content_length
                chunk_size = 8192
                while remaining > 0:
                    read_size = min(chunk_size, remaining)
                    data = f.read(read_size)
                    if not data:
                        break
                    remaining -= len(data)
                    yield data
        
        headers.update({
            "Content-Length": str(content_length),
            "Content-Range": f"bytes {start}-{end}/{file_size}",
        })
        
        return StreamingResponse(
            iterfile_range(),
            media_type=content_type,
            status_code=206,  # Partial Content
            headers=headers,
        )
        
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="Invalid Range header")


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

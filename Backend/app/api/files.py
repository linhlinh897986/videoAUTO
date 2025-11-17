from __future__ import annotations

import datetime as dt
from typing import Any, Dict, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, Request
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
    stored = db.get_file(file_id)
    if stored is None:
        raise HTTPException(status_code=404, detail="File not found")

    data, content_type, filename = stored
    media_type = content_type or "application/octet-stream"
    
    # Enable range requests for video streaming (large files)
    # This allows seeking in video player without loading entire file
    is_video = content_type and content_type.startswith('video/')
    
    # Check if client supports range requests
    range_header = request.headers.get('range')
    
    if is_video and range_header:
        # Parse range header (e.g., "bytes=0-1023")
        try:
            range_str = range_header.replace('bytes=', '')
            range_start, range_end = range_str.split('-')
            start = int(range_start) if range_start else 0
            end = int(range_end) if range_end else len(data) - 1
            
            # Ensure valid range
            if start >= len(data):
                raise HTTPException(status_code=416, detail="Range not satisfiable")
            
            end = min(end, len(data) - 1)
            chunk = data[start:end + 1]
            
            headers = {
                "Content-Range": f"bytes {start}-{end}/{len(data)}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(len(chunk)),
                "Content-Type": media_type,
                "Cache-Control": "public, max-age=3600",  # Cache for 1 hour
            }
            
            return Response(content=chunk, status_code=206, headers=headers, media_type=media_type)
        except (ValueError, IndexError):
            # Invalid range format, fall back to full response
            pass
    
    # For non-video files or no range request, return full content
    # Use RFC 2231 encoding for filenames with non-ASCII characters
    # This properly handles Chinese characters and other Unicode characters
    try:
        # Try to encode as ASCII - if it works, use simple filename
        filename.encode('ascii')
        content_disposition = f'attachment; filename="{filename}"'
    except UnicodeEncodeError:
        # If filename contains non-ASCII chars, use RFC 2231 encoding
        from urllib.parse import quote
        encoded_filename = quote(filename)
        # Use both filename and filename* for better compatibility
        # filename with ASCII fallback, filename* with UTF-8
        ascii_filename = filename.encode('ascii', 'ignore').decode('ascii') or 'download'
        content_disposition = f'attachment; filename="{ascii_filename}"; filename*=UTF-8\'\'{encoded_filename}'
    
    headers = {"Content-Disposition": content_disposition}
    
    # Add Accept-Ranges header for video files to enable seeking
    if is_video:
        headers["Accept-Ranges"] = "bytes"
        headers["Content-Length"] = str(len(data))
        headers["Cache-Control"] = "public, max-age=3600"  # Cache for 1 hour
    
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

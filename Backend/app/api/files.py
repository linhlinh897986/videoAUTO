from __future__ import annotations

import datetime as dt
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response, StreamingResponse, FileResponse
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
    # Get file path and metadata without loading content
    file_info = db.get_file_path(file_id)
    if file_info is None:
        raise HTTPException(status_code=404, detail="File not found")
    
    file_path, content_type, filename, file_size = file_info
    
    # If file is not on disk (legacy blob storage), fall back to old method
    if file_path is None or not file_path.exists():
        stored = db.get_file(file_id)
        if stored is None:
            raise HTTPException(status_code=404, detail="File not found")
        data, content_type, filename = stored
        file_size = len(data)
        
        # Handle range request for blob data
        range_header = request.headers.get("range")
        if range_header:
            try:
                range_str = range_header.replace("bytes=", "")
                range_parts = range_str.split("-")
                start = int(range_parts[0]) if range_parts[0] else 0
                end = int(range_parts[1]) if len(range_parts) > 1 and range_parts[1] else file_size - 1
                
                if start >= file_size or end >= file_size or start > end:
                    raise HTTPException(status_code=416, detail="Requested range not satisfiable")
                
                chunk = data[start:end + 1]
                headers = {
                    "Content-Range": f"bytes {start}-{end}/{file_size}",
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(len(chunk)),
                    "Content-Type": content_type or "application/octet-stream",
                }
                return Response(content=chunk, status_code=206, headers=headers)
            except (ValueError, IndexError):
                raise HTTPException(status_code=400, detail="Invalid range header")
        
        # Return full blob
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": content_type or "application/octet-stream",
        }
        return Response(content=data, headers=headers)
    
    # File is on disk - use efficient streaming
    media_type = content_type or "application/octet-stream"
    range_header = request.headers.get("range")
    
    if range_header:
        # Parse range header (format: "bytes=start-end")
        try:
            range_str = range_header.replace("bytes=", "")
            range_parts = range_str.split("-")
            start = int(range_parts[0]) if range_parts[0] else 0
            end = int(range_parts[1]) if len(range_parts) > 1 and range_parts[1] else file_size - 1
            
            # Validate range
            if start >= file_size or end >= file_size or start > end:
                raise HTTPException(status_code=416, detail="Requested range not satisfiable")
            
            # Read only the requested chunk from disk
            chunk_size = end - start + 1
            with open(file_path, "rb") as f:
                f.seek(start)
                chunk = f.read(chunk_size)
            
            headers = {
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(len(chunk)),
                "Content-Type": media_type,
            }
            
            return Response(content=chunk, status_code=206, headers=headers, media_type=media_type)
        except (ValueError, IndexError) as e:
            raise HTTPException(status_code=400, detail=f"Invalid range header: {e}")
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"Error reading file: {e}")
    
    # No range requested - use FileResponse for efficient full file streaming
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(file_size),
    }
    return FileResponse(
        path=file_path,
        media_type=media_type,
        headers=headers,
    )


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

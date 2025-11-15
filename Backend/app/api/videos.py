from __future__ import annotations

import datetime as dt
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

from app.core import DATA_ROOT, db


router = APIRouter(prefix="/projects/{project_id}/videos")


@router.get("/scan-folder")
def scan_project_video_folder(project_id: str) -> Dict[str, Any]:
    project = db.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    supported_extensions = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
    found_videos: List[Dict[str, Any]] = []

    project_video_folder = DATA_ROOT / project_id / "Video"
    project_video_folder.mkdir(parents=True, exist_ok=True)

    for video_file in project_video_folder.iterdir():
        if video_file.is_file() and video_file.suffix.lower() in supported_extensions:
            found_videos.append(
                {
                    "filename": video_file.name,
                    "path": str(video_file),
                    "size": video_file.stat().st_size,
                }
            )

    return {
        "status": "ok",
        "videos": found_videos,
        "folder": str(project_video_folder),
        "count": len(found_videos),
    }


@router.post("/import-from-folder")
async def import_videos_from_folder(project_id: str) -> Dict[str, Any]:
    project = db.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    supported_extensions = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
    imported_videos: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []

    project_video_folder = DATA_ROOT / project_id / "Video"
    project_video_folder.mkdir(parents=True, exist_ok=True)

    for video_file in project_video_folder.iterdir():
        if not video_file.is_file() or video_file.suffix.lower() not in supported_extensions:
            continue

        try:
            file_id = f"video-{project_id}-{dt.datetime.utcnow().timestamp()}-{video_file.stem}"

            created_at = dt.datetime.utcnow().isoformat()
            
            # Use streaming to save video file without loading it entirely in memory
            with open(video_file, 'rb') as video_stream:
                storage_path, file_size = db.save_file_streaming(
                    file_id=file_id,
                    project_id=project_id,
                    filename=video_file.name,
                    content_type="video/mp4" if video_file.suffix.lower() == ".mp4" else "video/*",
                    file_stream=video_stream,
                    created_at=created_at,
                    is_video=True,
                )

            imported_videos.append(
                {
                    "file_id": file_id,
                    "filename": video_file.name,
                    "storage_path": str(storage_path),
                    "file_size": file_size,
                    "created_at": created_at,
                }
            )

        except Exception as exc:
            errors.append({"filename": video_file.name, "error": str(exc)})

    return {
        "status": "ok",
        "project_id": project_id,
        "imported": imported_videos,
        "errors": errors,
        "count": len(imported_videos),
    }

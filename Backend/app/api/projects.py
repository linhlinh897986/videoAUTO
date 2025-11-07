from __future__ import annotations

import datetime as dt
from typing import Any, Dict, List

from fastapi import APIRouter, Body, HTTPException

from app.core import db


router = APIRouter(prefix="/projects")


@router.get("", response_model=List[Dict[str, Any]])
def list_projects() -> List[Dict[str, Any]]:
    return db.list_projects()


@router.put("/{project_id}")
def save_project(project_id: str, project: Dict[str, Any] = Body(...)) -> Dict[str, str]:
    payload_id = project.get("id")
    if not payload_id or payload_id != project_id:
        raise HTTPException(status_code=400, detail="Project ID mismatch")

    db.upsert_project(project, dt.datetime.utcnow().isoformat())
    return {"status": "saved"}


@router.delete("/{project_id}")
def delete_project(project_id: str) -> Dict[str, str]:
    db.delete_files_for_project(project_id)
    db.delete_project(project_id)
    return {"status": "deleted"}

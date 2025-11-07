from __future__ import annotations

import datetime as dt
from typing import Any, Dict, List

from fastapi import APIRouter, Body

from app.core import db


router = APIRouter(prefix="/custom-styles")


@router.get("", response_model=List[Dict[str, Any]])
def list_custom_styles() -> List[Dict[str, Any]]:
    return db.list_custom_styles()


@router.put("")
def save_custom_styles(styles: List[Dict[str, Any]] = Body(...)) -> Dict[str, str]:
    db.replace_custom_styles(styles, dt.datetime.utcnow().isoformat())
    return {"status": "saved"}

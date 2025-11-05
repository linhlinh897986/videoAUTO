from __future__ import annotations

import datetime as dt
from typing import Any, Dict, List

from fastapi import APIRouter, Body

from app.core import db


router = APIRouter(prefix="/api-keys")


@router.get("", response_model=List[Dict[str, Any]])
def list_api_keys() -> List[Dict[str, Any]]:
    return db.list_api_keys()


@router.put("")
def save_api_keys(keys: List[Dict[str, Any]] = Body(...)) -> Dict[str, str]:
    db.replace_api_keys(keys, dt.datetime.utcnow().isoformat())
    return {"status": "saved"}

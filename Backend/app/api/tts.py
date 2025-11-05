from __future__ import annotations

import datetime as dt
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.TTS import clines as tts_engine
from app.TTS.constants import sessionid as tts_sessionids, voices as tts_voices
from app.core import db


class TTSRequest(BaseModel):
    text: str
    voice: str = "BV074_streaming"
    session_id: Optional[str] = None


class TTSBatchRequest(BaseModel):
    subtitles: List[Dict[str, Any]]
    voice: str = "BV074_streaming"
    session_id: Optional[str] = None


router = APIRouter()


@router.get("/tts/voices")
def list_tts_voices() -> List[Dict[str, str]]:
    return [{"name": name, "id": voice_id} for name, voice_id in tts_voices]


@router.post("/tts/generate")
def generate_tts(payload: TTSRequest) -> Dict[str, Any]:
    session_id = payload.session_id or tts_sessionids[0]

    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp_file:
        temp_path = Path(tmp_file.name)

    try:
        result = tts_engine.tts(
            session_id=session_id,
            text_speaker=payload.voice,
            req_text=payload.text,
            filename=str(temp_path),
            play=False,
        )

        if result.get("status_code") != 0:
            raise HTTPException(status_code=400, detail=f"TTS generation failed: {result.get('status')}")

        audio_data = temp_path.read_bytes()

        return {
            "status": "success",
            "duration": result.get("duration", 0),
            "audio_data": audio_data.hex(),
            "size": len(audio_data),
        }
    finally:
        if temp_path.exists():
            temp_path.unlink()


@router.post("/projects/{project_id}/tts/batch")
async def generate_batch_tts(project_id: str, payload: TTSBatchRequest) -> Dict[str, Any]:
    project = db.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    session_id = payload.session_id or tts_sessionids[0]
    generated_files: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []

    project_files = project.get("files") or []
    existing_audio_files = [
        f for f in project_files if isinstance(f, dict) and f.get("type") == "audio"
    ]
    next_track = max([f.get("track", 0) for f in existing_audio_files], default=-1) + 1

    def overlaps(start1: float, end1: float, start2: float, end2: float) -> bool:
        return start1 < end2 and start2 < end1

    def find_available_track(new_start: float, new_duration: float, generated_so_far: List[Dict[str, Any]]) -> int:
        new_end = new_start + new_duration
        track = next_track

        while True:
            has_overlap = False
            for existing in generated_so_far:
                if existing["track"] == track:
                    existing_end = existing["start_time"] + existing["duration"]
                    if overlaps(new_start, new_end, existing["start_time"], existing_end):
                        has_overlap = True
                        break

            if not has_overlap:
                return track
            track += 1

    for subtitle in payload.subtitles:
        try:
            text = subtitle.get("text", "").strip()
            if not text:
                continue

            subtitle_id = subtitle.get("id")
            start_time = subtitle.get("startTime", "00:00:00,000")

            file_id = f"tts-{project_id}-{subtitle_id}-{dt.datetime.utcnow().timestamp()}"
            filename = f"tts_{project_id}_subtitle_{subtitle_id}.mp3"

            with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp_file:
                temp_path = Path(tmp_file.name)

            try:
                result = tts_engine.synthesize_long_text(
                    session_id=session_id,
                    text_speaker=payload.voice,
                    text=text,
                    output_filename=str(temp_path),
                    chunk_size=200,
                    keep_chunks=False,
                    play=False,
                )

                if result.get("status_code") != 0:
                    errors.append(
                        {
                            "subtitle_id": subtitle_id,
                            "error": f"TTS failed: {result.get('status')}",
                        }
                    )
                    continue

                if not temp_path.exists():
                    errors.append(
                        {
                            "subtitle_id": subtitle_id,
                            "error": "TTS file was not created",
                        }
                    )
                    continue

                audio_data = temp_path.read_bytes()

                if len(audio_data) == 0:
                    errors.append(
                        {
                            "subtitle_id": subtitle_id,
                            "error": "TTS file is empty",
                        }
                    )
                    continue

                is_mp3 = (
                    audio_data[:3] == b"ID3"
                    or (
                        len(audio_data) >= 2
                        and audio_data[0] == 0xFF
                        and audio_data[1] in (0xFB, 0xF3, 0xF2)
                    )
                )

                if not is_mp3:
                    errors.append(
                        {
                            "subtitle_id": subtitle_id,
                            "error": (
                                "Generated file is not a valid MP3 (magic bytes: "
                                f"{audio_data[:4].hex() if len(audio_data) >= 4 else 'empty'})"
                            ),
                        }
                    )
                    continue

                created_at = dt.datetime.utcnow().isoformat()
                storage_path, file_size = db.save_file(
                    file_id=file_id,
                    project_id=project_id,
                    filename=filename,
                    content_type="audio/mpeg",
                    data=audio_data,
                    created_at=created_at,
                )

                time_parts = start_time.replace(",", ".").split(":")
                start_seconds = (
                    float(time_parts[0]) * 3600
                    + float(time_parts[1]) * 60
                    + float(time_parts[2])
                )

                duration_seconds = result.get("duration", 0) / 1000.0

                assigned_track = find_available_track(
                    start_seconds, duration_seconds, generated_files
                )

                generated_files.append(
                    {
                        "file_id": file_id,
                        "filename": filename,
                        "subtitle_id": subtitle_id,
                        "text": text,
                        "duration": duration_seconds,
                        "track": assigned_track,
                        "start_time": start_seconds,
                        "storage_path": str(storage_path),
                        "file_size": file_size,
                        "created_at": created_at,
                    }
                )
            finally:
                if temp_path.exists():
                    temp_path.unlink()

        except Exception as exc:
            errors.append(
                {
                    "subtitle_id": subtitle.get("id"),
                    "error": str(exc),
                }
            )

    return {
        "status": "ok",
        "project_id": project_id,
        "generated": generated_files,
        "errors": errors,
        "voice": payload.voice,
    }

from __future__ import annotations

import datetime as dt
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from app.db import Database
from app.asr_utils import SUPPORTED_EXTENSIONS, convert_directory_to_srt
from app.ASR.ASRData import from_subtitle_file
from app.ASR import transcribe
from app.TTS import clines as tts_engine
from app.TTS.constants import voices as tts_voices, sessionid as tts_sessionids

APP_ROOT = Path(__file__).resolve().parent
DB_PATH = APP_ROOT / "data" / "app.db"
DATA_ROOT = APP_ROOT / "data"

DATA_ROOT.mkdir(parents=True, exist_ok=True)

db = Database(DB_PATH)

app = FastAPI(title="VideoAUTO Storage API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check() -> Dict[str, str]:
    return {"status": "ok"}


# --- Projects ----------------------------------------------------------------------
@app.get("/projects", response_model=List[Dict[str, Any]])
def list_projects() -> List[Dict[str, Any]]:
    return db.list_projects()


@app.put("/projects/{project_id}")
def save_project(project_id: str, project: Dict[str, Any] = Body(...)) -> Dict[str, str]:
    payload_id = project.get("id")
    if not payload_id or payload_id != project_id:
        raise HTTPException(status_code=400, detail="Project ID mismatch")

    db.upsert_project(project, dt.datetime.utcnow().isoformat())
    return {"status": "saved"}


@app.delete("/projects/{project_id}")
def delete_project(project_id: str) -> Dict[str, str]:
    db.delete_files_for_project(project_id)
    db.delete_project(project_id)
    return {"status": "deleted"}


# --- API Keys ----------------------------------------------------------------------
@app.get("/api-keys", response_model=List[Dict[str, Any]])
def list_api_keys() -> List[Dict[str, Any]]:
    return db.list_api_keys()


@app.put("/api-keys")
def save_api_keys(keys: List[Dict[str, Any]] = Body(...)) -> Dict[str, str]:
    db.replace_api_keys(keys, dt.datetime.utcnow().isoformat())
    return {"status": "saved"}


# --- Custom Styles -----------------------------------------------------------------
@app.get("/custom-styles", response_model=List[Dict[str, Any]])
def list_custom_styles() -> List[Dict[str, Any]]:
    return db.list_custom_styles()


@app.put("/custom-styles")
def save_custom_styles(styles: List[Dict[str, Any]] = Body(...)) -> Dict[str, str]:
    db.replace_custom_styles(styles, dt.datetime.utcnow().isoformat())
    return {"status": "saved"}


# --- Files -------------------------------------------------------------------------


class FileUploadResponse(BaseModel):
    status: str
    path: Optional[str] = None
    size: Optional[int] = None
    created_at: Optional[str] = None


@app.post("/files", response_model=FileUploadResponse)
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


@app.get("/files/{file_id}")
def download_file(file_id: str) -> Response:
    stored = db.get_file(file_id)
    if stored is None:
        raise HTTPException(status_code=404, detail="File not found")

    data, content_type, filename = stored
    media_type = content_type or "application/octet-stream"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=data, media_type=media_type, headers=headers)


@app.delete("/files/{file_id}")
def delete_file(file_id: str) -> Dict[str, str]:
    db.delete_file(file_id)
    return {"status": "deleted"}


@app.get("/files/{file_id}/info")
def file_info(file_id: str) -> Dict[str, Any]:
    metadata = db.get_file_metadata(file_id)
    if metadata is None:
        raise HTTPException(status_code=404, detail="File not found")
    return metadata


class AsrExportRequest(BaseModel):
    source_dir: str
    output_dir: Optional[str] = None
    pattern: Optional[str] = None
    overwrite: bool = True


class ProjectAsrGenerationRequest(BaseModel):
    source_dir: Optional[str] = None
    output_dir: Optional[str] = None


def _resolve_path(path_value: Optional[str], *, default: Optional[Path] = None) -> Optional[Path]:
    if not path_value:
        return default
    candidate = Path(path_value).expanduser()
    if not candidate.is_absolute():
        candidate = (APP_ROOT / candidate).resolve()
    else:
        candidate = candidate.resolve()
    return candidate


@app.post("/asr/export-srt")
def export_asr_to_srt(payload: AsrExportRequest) -> Dict[str, Any]:
    source_dir = _resolve_path(payload.source_dir)
    if source_dir is None:
        raise HTTPException(status_code=400, detail="source_dir is required")

    # Default to data/asr if no output_dir specified
    default_asr = DATA_ROOT / "asr"
    output_dir = _resolve_path(payload.output_dir, default=default_asr) or default_asr

    try:
        conversion = convert_directory_to_srt(
            source_dir=source_dir,
            output_dir=output_dir,
            pattern=payload.pattern,
            overwrite=payload.overwrite,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return {
        "status": "ok",
        "source_dir": str(source_dir),
        "output_dir": str(output_dir),
        **conversion,
    }


class AudioPreparationError(RuntimeError):
    def __init__(self, message: str, reason: str) -> None:
        super().__init__(message)
        self.reason = reason


def _ensure_mp3_payload(data: bytes, source_name: str) -> Tuple[bytes, str, Optional[str]]:
    suffix = Path(source_name).suffix.lower()
    if suffix == ".mp3":
        return data, source_name, None

    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        raise AudioPreparationError("ffmpeg không khả dụng để trích xuất âm thanh", "ffmpeg-missing")

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix or ".bin") as tmp_in:
        tmp_in.write(data)
        input_path = Path(tmp_in.name)

    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp_out:
        output_path = Path(tmp_out.name)

    try:
        result = subprocess.run(
            [
                ffmpeg_path,
                "-y",
                "-i",
                str(input_path),
                "-vn",
                "-acodec",
                "libmp3lame",
                str(output_path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="ignore").strip()
            raise AudioPreparationError(
                f"Không thể chuyển '{source_name}' sang MP3: {stderr or 'ffmpeg trả về lỗi'}",
                "audio-conversion-failed",
            )

        converted = output_path.read_bytes()
        if not converted:
            raise AudioPreparationError(
                f"Không tìm thấy track âm thanh trong '{source_name}'",
                "no-audio-track",
            )
    finally:
        try:
            input_path.unlink()
        except FileNotFoundError:
            pass
        try:
            output_path.unlink()
        except FileNotFoundError:
            pass

    converted_name = f"{Path(source_name).stem}.mp3"
    return converted, converted_name, source_name


def _transcribe_audio_with_bcut(audio_file_id: str, audio_filename: str) -> Tuple[str, str, Optional[str]]:
    stored = db.get_file(audio_file_id)
    if stored is None:
        raise AudioPreparationError("Không tìm thấy dữ liệu âm thanh", "no-audio-source")

    data, _content_type, stored_filename = stored
    resolved_name = audio_filename or stored_filename
    if not resolved_name:
        resolved_name = audio_file_id

    try:
        payload, mp3_name, original_name = _ensure_mp3_payload(data, resolved_name)
    except AudioPreparationError:
        raise
    except Exception as exc:  # pragma: no cover - unexpected conversion errors
        raise AudioPreparationError(str(exc), "audio-conversion-failed") from exc

    try:
        asr_data = transcribe(payload, "BcutASR", use_cache=True)
    except Exception as exc:  # pragma: no cover - depends on remote service
        raise RuntimeError(str(exc)) from exc

    srt_text = asr_data.to_srt()
    if not srt_text.strip():
        raise RuntimeError("Bcut trả về dữ liệu rỗng")

    return srt_text, mp3_name, original_name


@app.post("/projects/{project_id}/asr/generate-missing")
def generate_missing_project_srts(
    project_id: str,
    payload: Optional[ProjectAsrGenerationRequest] = Body(None),
) -> Dict[str, Any]:
    project = db.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    project_files = project.get("files") or []
    media_files = [
        f
        for f in project_files
        if isinstance(f, dict) and f.get("type") in {"video", "audio"}
    ]
    existing_srt_stems = {
        Path(f.get("name", "")).stem.lower()
        for f in project_files
        if isinstance(f, dict) and f.get("type") == "srt" and f.get("name")
    }

    if not media_files:
        return {
            "status": "ok",
            "project_id": project_id,
            "generated": [],
            "skipped": [],
            "missing_sources": [],
            "errors": [],
            "source_dir": None,
            "output_dir": None,
        }

    request_payload = payload or ProjectAsrGenerationRequest()
    # Use data/{project_id}/asr folder
    default_source = DATA_ROOT / project_id / "asr"
    source_dir = _resolve_path(request_payload.source_dir, default=default_source)
    if source_dir is None:
        source_dir = default_source

    output_dir = _resolve_path(request_payload.output_dir)
    if output_dir is None:
        output_dir = default_source

    output_dir.mkdir(parents=True, exist_ok=True)

    source_index: Dict[str, Path] = {}
    if source_dir.exists():
        for candidate in source_dir.rglob("*"):
            if candidate.is_file() and candidate.suffix.lower() in SUPPORTED_EXTENSIONS:
                source_index.setdefault(candidate.stem.lower(), candidate)

    audio_index: Dict[str, Dict[str, Any]] = {}
    for media in media_files:
        if media.get("type") != "audio":
            continue
        name = media.get("name")
        file_id = media.get("id")
        if not name or not file_id:
            continue
        audio_index.setdefault(Path(name).stem.lower(), media)

    generated: List[Dict[str, Any]] = []
    missing_sources: List[Dict[str, Any]] = []
    skipped: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    processed_targets: Set[str] = set()

    def _append_skip(file_obj: Dict[str, Any], reason: str) -> None:
        skipped.append(
            {
                "file_id": file_obj.get("id"),
                "file_name": file_obj.get("name"),
                "file_type": file_obj.get("type"),
                "reason": reason,
            }
        )

    def _append_missing(file_obj: Dict[str, Any], reason: str) -> None:
        missing_sources.append(
            {
                "file_id": file_obj.get("id"),
                "file_name": file_obj.get("name"),
                "file_type": file_obj.get("type"),
                "reason": reason,
            }
        )

    def _append_error(file_obj: Dict[str, Any], message: str, *, reason: Optional[str] = None) -> None:
        errors.append(
            {
                "file_id": file_obj.get("id"),
                "file_name": file_obj.get("name"),
                "file_type": file_obj.get("type"),
                "error": message,
                "reason": reason,
            }
        )

    def _append_generated(
        file_obj: Dict[str, Any],
        output_path: Path,
        srt_text: str,
        *,
        audio_source: Optional[Dict[str, Any]] = None,
        source_descriptor: Optional[str] = None,
        audio_converted_filename: Optional[str] = None,
    ) -> None:
        output_path.write_text(srt_text, encoding="utf-8")
        generated.append(
            {
                "file_id": file_obj.get("id"),
                "file_name": file_obj.get("name"),
                "file_type": file_obj.get("type"),
                "source": source_descriptor or str(output_path),
                "output": str(output_path),
                "srt_filename": output_path.name,
                "srt_content": srt_text,
                "audio_file_id": audio_source.get("id") if audio_source else None,
                "audio_file_name": audio_source.get("name") if audio_source else None,
                "audio_source_type": audio_source.get("type") if audio_source else None,
                "audio_converted_filename": audio_converted_filename,
            }
        )

    for media in media_files:
        media_name = media.get("name")
        media_id = media.get("id")
        if not media_name or not media_id:
            continue

        stem = Path(media_name).stem
        stem_lower = stem.lower()

        if stem_lower in processed_targets:
            continue
        processed_targets.add(stem_lower)

        if stem_lower in existing_srt_stems:
            _append_skip(media, "subtitle-already-present")
            continue

        source_file = source_index.get(stem_lower)
        if source_file is not None:
            output_path = output_dir / f"{stem}.srt"
            try:
                if not output_path.exists():
                    asr_data = from_subtitle_file(str(source_file))
                    asr_data.to_srt(save_path=str(output_path))
                srt_text = output_path.read_text(encoding="utf-8")
                if not srt_text.strip():
                    raise ValueError("Generated SRT is empty")
                _append_generated(media, output_path, srt_text, source_descriptor=str(source_file))
            except Exception as exc:  # pragma: no cover
                _append_error(media, str(exc))
            continue

        audio_candidate: Optional[Dict[str, Any]]
        if media.get("type") == "audio":
            audio_candidate = media
        else:
            audio_candidate = audio_index.get(stem_lower) or (
                media if media.get("type") == "video" else None
            )

        if audio_candidate is None:
            _append_missing(media, "no-audio-source")
            continue

        audio_name = audio_candidate.get("name") or media_name
        output_path = output_dir / f"{stem}.srt"
        try:
            srt_text, converted_name, original_source = _transcribe_audio_with_bcut(
                audio_candidate.get("id"),
                audio_name,
            )
        except AudioPreparationError as exc:
            if exc.reason in {"no-audio-source", "no-audio-track"}:
                _append_missing(media, exc.reason)
            else:
                _append_error(media, str(exc), reason=exc.reason)
            continue
        except RuntimeError as exc:
            _append_error(media, f"Bcut lỗi: {exc}", reason="bcut-error")
            continue

        descriptor = f"BcutASR({converted_name})"
        if original_source and original_source != converted_name:
            descriptor = f"BcutASR({converted_name} ⇐ {original_source})"

        _append_generated(
            media,
            output_path,
            srt_text,
            audio_source=audio_candidate,
            source_descriptor=descriptor,
            audio_converted_filename=converted_name if original_source else None,
        )

    return {
        "status": "ok",
        "project_id": project_id,
        "source_dir": str(source_dir),
        "output_dir": str(output_dir),
        "generated": generated,
        "missing_sources": missing_sources,
        "skipped": skipped,
        "errors": errors,
    }


# --- TTS (Text-to-Speech) ------------------------------------------------------

class TTSRequest(BaseModel):
    text: str
    voice: str = "BV074_streaming"  # Default TTS voice (Cô gái hoạt ngôn)
    session_id: Optional[str] = None


class TTSBatchRequest(BaseModel):
    """Generate TTS for multiple subtitle blocks"""
    subtitles: List[Dict[str, Any]]  # List of subtitle objects with id, text, startTime, endTime
    voice: str = "BV074_streaming"  # Default TTS voice (Cô gái hoạt ngôn)
    session_id: Optional[str] = None


@app.get("/tts/voices")
def list_tts_voices() -> List[Dict[str, str]]:
    """List available TTS voices"""
    return [{"name": name, "id": voice_id} for name, voice_id in tts_voices]


@app.post("/tts/generate")
def generate_tts(payload: TTSRequest) -> Dict[str, Any]:
    """Generate TTS audio from text"""
    session_id = payload.session_id or tts_sessionids[0]
    
    # Create temp file for TTS output
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp_file:
        temp_path = Path(tmp_file.name)
    
    try:
        # Generate TTS
        result = tts_engine.tts(
            session_id=session_id,
            text_speaker=payload.voice,
            req_text=payload.text,
            filename=str(temp_path),
            play=False
        )
        
        if result.get("status_code") != 0:
            raise HTTPException(status_code=400, detail=f"TTS generation failed: {result.get('status')}")
        
        # Read the generated MP3
        audio_data = temp_path.read_bytes()
        
        return {
            "status": "success",
            "duration": result.get("duration", 0),
            "audio_data": audio_data.hex(),  # Return as hex string
            "size": len(audio_data),
        }
    finally:
        # Clean up temp file
        if temp_path.exists():
            temp_path.unlink()


@app.post("/projects/{project_id}/tts/batch")
async def generate_batch_tts(project_id: str, payload: TTSBatchRequest) -> Dict[str, Any]:
    """Generate TTS for multiple subtitles and save as audio files in the project"""
    project = db.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
    
    session_id = payload.session_id or tts_sessionids[0]
    generated_files: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    
    # Get existing audio files to determine next track number
    project_files = project.get("files") or []
    existing_audio_files = [f for f in project_files if isinstance(f, dict) and f.get("type") == "audio"]
    next_track = max([f.get("track", 0) for f in existing_audio_files], default=-1) + 1
    
    # Helper function to check if two time ranges overlap
    def overlaps(start1: float, end1: float, start2: float, end2: float) -> bool:
        return start1 < end2 and start2 < end1
    
    # Helper function to find available track for a new block
    def find_available_track(new_start: float, new_duration: float, generated_so_far: List[Dict]) -> int:
        new_end = new_start + new_duration
        track = next_track
        
        while True:
            # Check if this track is free for the time range
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
    
    for idx, subtitle in enumerate(payload.subtitles):
        try:
            text = subtitle.get("text", "").strip()
            if not text:
                continue
            
            subtitle_id = subtitle.get("id")
            start_time = subtitle.get("startTime", "00:00:00,000")
            
            # Generate unique file ID and filename with project_id to avoid conflicts
            file_id = f"tts-{project_id}-{subtitle_id}-{dt.datetime.utcnow().timestamp()}"
            filename = f"tts_{project_id}_subtitle_{subtitle_id}.mp3"
            
            # Create temp file for TTS
            with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp_file:
                temp_path = Path(tmp_file.name)
            
            try:
                # Generate TTS using synthesize_long_text for better handling of long text
                result = tts_engine.synthesize_long_text(
                    session_id=session_id,
                    text_speaker=payload.voice,
                    text=text,
                    output_filename=str(temp_path),
                    chunk_size=200,
                    keep_chunks=False,
                    play=False
                )
                
                if result.get("status_code") != 0:
                    errors.append({
                        "subtitle_id": subtitle_id,
                        "error": f"TTS failed: {result.get('status')}",
                    })
                    continue
                
                # Verify the file exists and is not empty
                if not temp_path.exists():
                    errors.append({
                        "subtitle_id": subtitle_id,
                        "error": "TTS file was not created",
                    })
                    continue
                
                # Read generated audio
                audio_data = temp_path.read_bytes()
                
                if len(audio_data) == 0:
                    errors.append({
                        "subtitle_id": subtitle_id,
                        "error": "TTS file is empty",
                    })
                    continue
                
                # Verify it's an MP3 file by checking magic bytes
                # MP3 files start with ID3 (0x49 0x44 0x33) or 0xFF 0xFB/0xFF 0xF3/0xFF 0xF2
                is_mp3 = (
                    audio_data[:3] == b'ID3' or  # ID3 tag
                    (len(audio_data) >= 2 and audio_data[0] == 0xFF and audio_data[1] in (0xFB, 0xF3, 0xF2))  # MP3 frame sync
                )
                
                if not is_mp3:
                    errors.append({
                        "subtitle_id": subtitle_id,
                        "error": f"Generated file is not a valid MP3 (magic bytes: {audio_data[:4].hex() if len(audio_data) >= 4 else 'empty'})",
                    })
                    continue
                
                # Save to database
                created_at = dt.datetime.utcnow().isoformat()
                storage_path, file_size = db.save_file(
                    file_id=file_id,
                    project_id=project_id,
                    filename=filename,
                    content_type="audio/mpeg",
                    data=audio_data,
                    created_at=created_at,
                )
                
                # Convert start time to seconds
                time_parts = start_time.replace(',', '.').split(':')
                start_seconds = float(time_parts[0]) * 3600 + float(time_parts[1]) * 60 + float(time_parts[2])
                
                # Calculate duration
                duration_seconds = result.get("duration", 0) / 1000.0  # Convert ms to seconds
                
                # Find available track (auto-move to lower track if overlap detected)
                assigned_track = find_available_track(start_seconds, duration_seconds, generated_files)
                
                generated_files.append({
                    "file_id": file_id,
                    "filename": filename,
                    "subtitle_id": subtitle_id,
                    "text": text,
                    "duration": duration_seconds,
                    "track": assigned_track,  # Auto-assigned track (may be pushed down if overlap)
                    "start_time": start_seconds,
                    "storage_path": str(storage_path),
                    "file_size": file_size,
                    "created_at": created_at,
                })
            finally:
                if temp_path.exists():
                    temp_path.unlink()
                    
        except Exception as exc:
            errors.append({
                "subtitle_id": subtitle.get("id"),
                "error": str(exc),
            })
    
    return {
        "status": "ok",
        "project_id": project_id,
        "generated": generated_files,
        "errors": errors,
        "voice": payload.voice,
    }


# --- Video Auto-Import ---------------------------------------------------------

@app.get("/projects/{project_id}/videos/scan-folder")
def scan_project_video_folder(project_id: str) -> Dict[str, Any]:
    """Scan the project's Video folder for video files to import"""
    project = db.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
    
    supported_extensions = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
    found_videos: List[Dict[str, Any]] = []
    
    # Use data/{project_id}/Video folder
    project_video_folder = DATA_ROOT / project_id / "Video"
    project_video_folder.mkdir(parents=True, exist_ok=True)
    
    for video_file in project_video_folder.iterdir():
        if video_file.is_file() and video_file.suffix.lower() in supported_extensions:
            found_videos.append({
                "filename": video_file.name,
                "path": str(video_file),
                "size": video_file.stat().st_size,
            })
    
    return {
        "status": "ok",
        "videos": found_videos,
        "folder": str(project_video_folder),
        "count": len(found_videos),
    }


@app.post("/projects/{project_id}/videos/import-from-folder")
async def import_videos_from_folder(project_id: str) -> Dict[str, Any]:
    """Import all videos from the project's Video folder into the specified project"""
    project = db.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
    
    supported_extensions = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
    imported_videos: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    
    # Use data/{project_id}/Video folder
    project_video_folder = DATA_ROOT / project_id / "Video"
    project_video_folder.mkdir(parents=True, exist_ok=True)
    
    for video_file in project_video_folder.iterdir():
        if not video_file.is_file() or video_file.suffix.lower() not in supported_extensions:
            continue
        
        try:
            # Generate unique file ID
            file_id = f"video-{project_id}-{dt.datetime.utcnow().timestamp()}-{video_file.stem}"
            
            # Read video data
            video_data = video_file.read_bytes()
            
            # Save to database
            created_at = dt.datetime.utcnow().isoformat()
            storage_path, file_size = db.save_file(
                file_id=file_id,
                project_id=project_id,
                filename=video_file.name,
                content_type="video/mp4" if video_file.suffix.lower() == ".mp4" else "video/*",
                data=video_data,
                created_at=created_at,
            )
            
            imported_videos.append({
                "file_id": file_id,
                "filename": video_file.name,
                "storage_path": str(storage_path),
                "file_size": file_size,
                "created_at": created_at,
            })
            
        except Exception as exc:
            errors.append({
                "filename": video_file.name,
                "error": str(exc),
            })
    
    return {
        "status": "ok",
        "project_id": project_id,
        "imported": imported_videos,
        "errors": errors,
        "count": len(imported_videos),
    }


# --- Video Rendering -----------------------------------------------------------

# --- Video Rendering -----------------------------------------------------------

class VideoRenderRequest(BaseModel):
    """Request to render a video with all editing data"""
    video_file_id: str
    video_segments: List[Dict[str, Any]]  # Video segments with timing, playback rates
    subtitles: List[Dict[str, Any]]  # All subtitle blocks with text, timing, track
    audio_files: List[Dict[str, Any]]  # Audio files with timing and track info
    subtitle_style: Optional[Dict[str, Any]] = None
    hardsub_cover_box: Optional[Dict[str, Any]] = None
    master_volume_db: float = 0.0
    video_frame_url: Optional[str] = None  # PNG frame overlay
    output_filename: Optional[str] = None


def _create_ass_subtitle_file(
    subtitles: List[Dict[str, Any]], 
    style: Optional[Dict[str, Any]],
    output_path: Path
) -> None:
    """Create ASS subtitle file with styling for ffmpeg"""
    # Default style
    font_family = style.get("fontFamily", "Arial") if style else "Arial"
    font_size = style.get("fontSize", 24) if style else 24
    primary_color = style.get("primaryColor", "#FFFFFF") if style else "#FFFFFF"
    outline_color = style.get("outlineColor", "#000000") if style else "#000000"
    outline_width = style.get("outlineWidth", 2) if style else 2
    vertical_margin = style.get("verticalMargin", 10) if style else 10
    h_align = style.get("horizontalAlign", "center") if style else "center"
    
    # Convert hex color to ASS format (&HAABBGGRR)
    def hex_to_ass(hex_color: str) -> str:
        hex_color = hex_color.lstrip('#')
        r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
        return f"&H00{b:02X}{g:02X}{r:02X}"
    
    primary_ass = hex_to_ass(primary_color)
    outline_ass = hex_to_ass(outline_color)
    
    # ASS alignment (2=bottom center, 1=bottom left, 3=bottom right)
    alignment = 2 if h_align == "center" else (1 if h_align == "left" else 3)
    
    # Create ASS content
    ass_content = f"""[Script Info]
Title: Rendered Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_family},{font_size},{primary_ass},&H000000FF,{outline_ass},&H80000000,0,0,0,0,100,100,0,0,1,{outline_width},0,{alignment},10,10,{vertical_margin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    
    # Convert SRT time to ASS time format (0:00:00.00)
    def srt_to_ass_time(srt_time: str) -> str:
        # SRT format: 00:00:00,000 -> ASS format: 0:00:00.00
        time_part = srt_time.replace(',', '.')
        parts = time_part.split(':')
        if len(parts) == 3:
            h, m, s = parts
            s_parts = s.split('.')
            if len(s_parts) == 2:
                s, ms = s_parts
                cs = ms[:2]  # centiseconds (first 2 digits of milliseconds)
                return f"{int(h)}:{m}:{s}.{cs}"
        return srt_time
    
    # Add subtitle events
    for sub in subtitles:
        start = srt_to_ass_time(sub.get("startTime", "00:00:00,000"))
        end = srt_to_ass_time(sub.get("endTime", "00:00:00,000"))
        text = sub.get("text", "").replace('\n', '\\N')
        ass_content += f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}\n"
    
    output_path.write_text(ass_content, encoding='utf-8')


@app.post("/projects/{project_id}/render")
async def render_video(project_id: str, payload: VideoRenderRequest) -> Dict[str, Any]:
    """
    Render video with ffmpeg using all editing information
    """
    import subprocess
    
    project = db.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
    
    # Get video file from database
    video_data_tuple = db.get_file(payload.video_file_id)
    if video_data_tuple is None:
        raise HTTPException(status_code=404, detail=f"Video file not found: {payload.video_file_id}")
    
    video_data, content_type, filename = video_data_tuple
    
    # Check if ffmpeg is available
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return {
            "status": "error",
            "message": "ffmpeg không được cài đặt trên server. Vui lòng cài đặt ffmpeg để render video.",
            "video_segments_count": len(payload.video_segments),
            "audio_tracks_count": len(payload.audio_files),
            "subtitles_count": len(payload.subtitles),
        }
    
    # Create temp directory for rendering
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        
        # Save original video to temp file
        input_video = temp_path / f"input{Path(filename).suffix}"
        input_video.write_bytes(video_data)
        
        # Create subtitle file if subtitles exist
        subtitle_file = None
        if payload.subtitles and len(payload.subtitles) > 0:
            subtitle_file = temp_path / "subtitles.ass"
            _create_ass_subtitle_file(payload.subtitles, payload.subtitle_style, subtitle_file)
        
        # Save audio files
        audio_paths = []
        for i, audio_file in enumerate(payload.audio_files):
            audio_id = audio_file.get("id")
            if audio_id:
                audio_tuple = db.get_file(audio_id)
                if audio_tuple:
                    audio_data, _, audio_name = audio_tuple
                    audio_path = temp_path / f"audio_{i}_{audio_name}"
                    audio_path.write_bytes(audio_data)
                    audio_paths.append({
                        "path": audio_path,
                        "start_time": audio_file.get("startTime", 0),
                        "track": audio_file.get("track", i)
                    })
        
        # Save video frame overlay if provided
        frame_overlay_path = None
        if payload.video_frame_url and payload.video_frame_url.startswith('data:image/png;base64,'):
            import base64
            base64_data = payload.video_frame_url.split(',')[1]
            frame_data = base64.b64decode(base64_data)
            frame_overlay_path = temp_path / "frame_overlay.png"
            frame_overlay_path.write_bytes(frame_data)
        
        # Build ffmpeg command
        output_filename = payload.output_filename or f"rendered_{project_id}_{dt.datetime.utcnow().timestamp()}.mp4"
        output_path = DATA_ROOT / project_id / "rendered" / output_filename
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Start with input video
        ffmpeg_cmd = [ffmpeg_path, "-y", "-i", str(input_video)]
        
        # Add audio inputs
        for audio_info in audio_paths:
            ffmpeg_cmd.extend(["-i", str(audio_info["path"])])
        
        # Add frame overlay if exists
        if frame_overlay_path:
            ffmpeg_cmd.extend(["-i", str(frame_overlay_path)])
        
        # Build filter complex for both video and audio processing
        filter_complex_parts = []
        video_filters = []
        has_blur_region = False
        blur_region_params = None
        
        # Check if hardsub cover box needs blur (using modern drawbox with blur parameter)
        if payload.hardsub_cover_box and payload.hardsub_cover_box.get("enabled"):
            box = payload.hardsub_cover_box
            x = int(box.get("x", 0) * 1920 / 100)  # Convert percentage to pixels (assuming 1920x1080)
            y = int(box.get("y", 0) * 1080 / 100)
            w = int(box.get("width", 0) * 1920 / 100)
            h = int(box.get("height", 0) * 1080 / 100)
            has_blur_region = True
            blur_region_params = {'x': x, 'y': y, 'w': w, 'h': h}
        
        # Note: frame overlay and blur will be handled in filter_complex
        
        # Apply blur region using modern drawbox filter with built-in blur (requires ffmpeg ≥5.1)
        if has_blur_region:
            params = blur_region_params
            # Modern drawbox with blur parameter - much simpler and faster
            video_filters.append(f"drawbox=x={params['x']}:y={params['y']}:w={params['w']}:h={params['h']}:color=black@0.0:t=fill:blur=20")
        
        # Add scale and fps filters (must come before subtitles)
        # Force 1080p resolution and 30fps
        video_filters.append("scale=1920:1080:force_original_aspect_ratio=decrease")
        video_filters.append("pad=1920:1080:(ow-iw)/2:(oh-ih)/2")
        video_filters.append("fps=30")
        
        # Add subtitles if exists (must be last in video filter chain)
        if subtitle_file:
            # Fix path for Windows/Linux compatibility - use forward slashes and escape special chars
            subtitle_path_str = str(subtitle_file).replace('\\', '/').replace(':', r'\:')
            video_filters.append(f"ass='{subtitle_path_str}'")
        
        # Combine video and audio processing
        use_filter_complex = len(audio_paths) > 0 or frame_overlay_path  # Need filter_complex if mixing audio or overlaying
        
        if use_filter_complex:
            # Use filter_complex for both video and audio
            filter_parts = []
            
            # Video processing chain
            # Start with base video and apply all video filters
            video_stream = "[0:v]"
            
            # Apply basic filters (drawbox blur, scale, pad, fps)
            basic_filters = [f for f in video_filters if not f.startswith('[') and 'overlay' not in f and 'ass' not in f]
            if basic_filters:
                video_stream = f"{video_stream}{','.join(basic_filters)}"
            
            # Apply overlay if frame exists
            if frame_overlay_path:
                overlay_input_idx = 1 + len(audio_paths)
                video_stream = f"{video_stream}[vtmp];[vtmp][{overlay_input_idx}:v]overlay=0:0"
            
            # Apply subtitles (must be last)
            subtitle_filter = [f for f in video_filters if 'ass' in f]
            if subtitle_filter:
                video_stream = f"{video_stream},{subtitle_filter[0]}"
            
            video_stream = f"{video_stream}[vout]"
            filter_parts.append(video_stream)
            
            # Audio mixing
            if len(audio_paths) > 0:
                audio_inputs = "[0:a]"
                for i in range(len(audio_paths)):
                    audio_inputs += f"[{i+1}:a]"
                audio_chain = f"{audio_inputs}amix=inputs={len(audio_paths)+1}:duration=longest[aout]"
                filter_parts.append(audio_chain)
            
            # Apply filter_complex
            ffmpeg_cmd.extend(["-filter_complex", ";".join(filter_parts)])
            
            # Map outputs
            ffmpeg_cmd.extend(["-map", "[vout]"])
            
            if len(audio_paths) > 0:
                ffmpeg_cmd.extend(["-map", "[aout]"])
            else:
                ffmpeg_cmd.extend(["-map", "0:a"])
        else:
            # Use simple -vf if no audio mixing or overlay needed
            if video_filters:
                # Just basic filters like drawbox with blur and ass
                ffmpeg_cmd.extend(["-vf", ",".join(video_filters)])
        
        # Check for GPU encoder availability (NVENC for NVIDIA GPUs)
        gpu_encoder = None
        try:
            # Check if h264_nvenc is available
            probe_result = subprocess.run(
                [ffmpeg_path, "-hide_banner", "-encoders"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False
            )
            encoders_output = probe_result.stdout.decode('utf-8', errors='ignore')
            if 'h264_nvenc' in encoders_output:
                gpu_encoder = "h264_nvenc"
        except Exception:
            pass  # Fall back to CPU encoding
        
        # Output settings with GPU priority
        output_settings = []
        
        # Video codec - prioritize GPU encoding
        if gpu_encoder:
            output_settings.extend(["-c:v", gpu_encoder])
            output_settings.extend(["-preset", "p4"])  # NVENC preset (p1-p7, p4 is balanced)
            output_settings.extend(["-cq", "23"])  # NVENC quality (similar to CRF)
        else:
            output_settings.extend(["-c:v", "libx264"])
            output_settings.extend(["-preset", "medium"])
            output_settings.extend(["-crf", "23"])
        
        # Audio codec
        output_settings.extend(["-c:a", "aac", "-b:a", "192k"])
        
        # Output file
        output_settings.append(str(output_path))
        
        ffmpeg_cmd.extend(output_settings)
        
        # Create log file path
        log_file_path = output_path.parent / f"render_log_{dt.datetime.utcnow().timestamp()}.txt"
        
        # Run ffmpeg
        try:
            # Write command to log file
            with open(log_file_path, 'w', encoding='utf-8') as log_file:
                log_file.write("=" * 80 + "\n")
                log_file.write("FFMPEG RENDER LOG\n")
                log_file.write("=" * 80 + "\n\n")
                log_file.write(f"Project ID: {project_id}\n")
                log_file.write(f"Timestamp: {dt.datetime.utcnow().isoformat()}\n")
                log_file.write(f"Output: {output_path}\n\n")
                log_file.write("COMMAND:\n")
                log_file.write(' '.join(ffmpeg_cmd) + "\n\n")
                log_file.write("=" * 80 + "\n")
                log_file.write("FFMPEG OUTPUT:\n")
                log_file.write("=" * 80 + "\n\n")
            
            result = subprocess.run(
                ffmpeg_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=600,  # 10 minute timeout
                check=False
            )
            
            # Decode outputs
            stdout = result.stdout.decode('utf-8', errors='ignore')
            stderr = result.stderr.decode('utf-8', errors='ignore')
            
            # Append output to log file
            with open(log_file_path, 'a', encoding='utf-8') as log_file:
                log_file.write("STDOUT:\n")
                log_file.write(stdout + "\n\n")
                log_file.write("STDERR:\n")
                log_file.write(stderr + "\n\n")
                log_file.write("=" * 80 + "\n")
                log_file.write(f"Return Code: {result.returncode}\n")
                log_file.write("=" * 80 + "\n")
            
            if result.returncode != 0:
                # Show the last part of stderr which contains the actual error
                stderr_lines = stderr.strip().split('\n')
                # Get last 10 lines which usually contain the actual error
                error_summary = '\n'.join(stderr_lines[-10:]) if len(stderr_lines) > 10 else stderr
                
                return {
                    "status": "error",
                    "message": f"ffmpeg rendering failed:\n{error_summary}",
                    "ffmpeg_command": ' '.join(ffmpeg_cmd),  # Include command for debugging
                    "log_file": str(log_file_path),  # Include log file path
                    "video_segments_count": len(payload.video_segments),
                    "audio_tracks_count": len(payload.audio_files),
                    "subtitles_count": len(payload.subtitles),
                }
            
            # Get output file info
            file_size = output_path.stat().st_size
            
            # Get video duration using ffprobe
            duration_seconds = None
            try:
                probe_result = subprocess.run(
                    [ffmpeg_path.replace('ffmpeg', 'ffprobe'), "-v", "error", "-show_entries",
                     "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(output_path)],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=False
                )
                if probe_result.returncode == 0:
                    duration_seconds = float(probe_result.stdout.decode().strip())
            except Exception:
                pass
            
            return {
                "status": "success",
                "message": "Video rendered successfully!",
                "log_file": str(log_file_path),  # Include log file path for success too
                "output_filename": output_filename,
                "output_path": str(output_path),
                "file_size": file_size,
                "duration_seconds": duration_seconds,
                "video_segments_count": len(payload.video_segments),
                "audio_tracks_count": len(payload.audio_files),
                "subtitles_count": len(payload.subtitles),
            }
            
        except subprocess.TimeoutExpired:
            # Write timeout info to log
            try:
                with open(log_file_path, 'a', encoding='utf-8') as log_file:
                    log_file.write("\n" + "=" * 80 + "\n")
                    log_file.write("TIMEOUT: Process exceeded 10 minutes\n")
                    log_file.write("=" * 80 + "\n")
            except Exception:
                pass
            
            return {
                "status": "error",
                "message": "Rendering timeout (>10 minutes). Video may be too long or complex.",
                "log_file": str(log_file_path) if log_file_path.exists() else None,
                "video_segments_count": len(payload.video_segments),
                "audio_tracks_count": len(payload.audio_files),
                "subtitles_count": len(payload.subtitles),
            }


__all__ = ["app"]

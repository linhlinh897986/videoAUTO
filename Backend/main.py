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

APP_ROOT = Path(__file__).resolve().parent
DB_PATH = APP_ROOT / "data" / "app.db"
ASR_ROOT = APP_ROOT / "data" / "asr"

ASR_ROOT.mkdir(parents=True, exist_ok=True)

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

    output_dir = _resolve_path(payload.output_dir, default=ASR_ROOT) or ASR_ROOT

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
    default_source = ASR_ROOT / project_id
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

__all__ = ["app"]

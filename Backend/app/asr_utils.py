from __future__ import annotations

import fnmatch
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from .ASR.ASRData import ASRData, from_subtitle_file

SUPPORTED_EXTENSIONS = {".json", ".srt", ".vtt", ".ass"}


def _iter_subtitle_sources(source_dir: Path, pattern: Optional[str]) -> Iterable[Path]:
    for file_path in sorted(source_dir.rglob("*")):
        if not file_path.is_file():
            continue
        if file_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        if pattern and not fnmatch.fnmatch(file_path.name, pattern):
            continue
        yield file_path


def convert_directory_to_srt(
    source_dir: Path,
    output_dir: Optional[Path] = None,
    pattern: Optional[str] = None,
    overwrite: bool = True,
) -> Dict[str, List[Dict[str, str]]]:
    """Convert supported subtitle sources within *source_dir* to SRT files.

    Returns a mapping describing generated, skipped, and failed conversions.
    """

    generated: List[Dict[str, str]] = []
    skipped: List[Dict[str, str]] = []
    failed: List[Dict[str, str]] = []

    if not source_dir.exists() or not source_dir.is_dir():
        raise FileNotFoundError(f"Source directory does not exist: {source_dir}")

    for file_path in _iter_subtitle_sources(source_dir, pattern):
        try:
            asr_data: ASRData = from_subtitle_file(str(file_path))
        except Exception as exc:  # pragma: no cover - defensive against unknown formats
            failed.append({
                "source": str(file_path),
                "error": str(exc),
            })
            continue

        destination_dir = output_dir or file_path.parent
        destination_dir.mkdir(parents=True, exist_ok=True)
        destination = destination_dir / f"{file_path.stem}.srt"

        if not overwrite and destination.exists():
            skipped.append({
                "source": str(file_path),
                "output": str(destination),
            })
            continue

        asr_data.to_srt(save_path=str(destination))
        generated.append({
            "source": str(file_path),
            "output": str(destination),
        })

    return {
        "generated": generated,
        "skipped": skipped,
        "failed": failed,
    }


__all__ = ["convert_directory_to_srt"]

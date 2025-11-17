from __future__ import annotations

import base64
import datetime as dt
import math
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel

from app.core import DATA_ROOT, db, RENDER_TIMEOUT_SECONDS


# ASS format reference resolution for subtitle rendering
# All subtitle dimensions are specified relative to this resolution
REFERENCE_HEIGHT = 1080
REFERENCE_WIDTH = 1920


class VideoRenderRequest(BaseModel):
    video_file_id: str
    video_segments: List[Dict[str, Any]]
    subtitles: List[Dict[str, Any]]
    audio_files: List[Dict[str, Any]]
    subtitle_style: Optional[Dict[str, Any]] = None
    hardsub_cover_box: Optional[Dict[str, Any]] = None
    master_volume_db: float = 0.0
    video_frame_url: Optional[str] = None
    output_filename: Optional[str] = None


router = APIRouter()


def _create_ass_subtitle_file(
    subtitles: List[Dict[str, Any]],
    style: Optional[Dict[str, Any]],
    output_path: Path,
) -> None:
    """
    Create an ASS subtitle file with styling that matches the frontend preview.
    
    ASS Format Parameters (all values documented):
    - Fontname: Font family name (from style.fontFamily)
    - Fontsize: Font size in pixels at reference resolution (from style.fontSize)
    - PrimaryColour: Main text color (from style.primaryColor)
    - SecondaryColour: Secondary color for karaoke effects (hardcoded, not used in preview)
    - OutlineColour: Outline/border color (from style.outlineColor)
    - BackColour: Shadow color (hardcoded with alpha, no shadow in preview)
    - Bold: -1 for bold, 0 for normal (hardcoded to 0, matches frontend normal weight)
    - Italic: -1 for italic, 0 for normal (hardcoded to 0, not supported in preview)
    - Underline: -1 for underline, 0 for none (hardcoded to 0, not supported in preview)
    - StrikeOut: -1 for strikeout, 0 for none (hardcoded to 0, not supported in preview)
    - ScaleX: Horizontal scaling percentage (hardcoded to 100, no scaling in preview)
    - ScaleY: Vertical scaling percentage (hardcoded to 100, no scaling in preview)
    - Spacing: Letter spacing in pixels (hardcoded to 0, matches frontend letterSpacing='0px')
    - Angle: Rotation angle in degrees (hardcoded to 0, not supported in preview)
    - BorderStyle: 1=outline+shadow, 3=opaque box (hardcoded to 1, matches preview outline)
    - Outline: Outline width in pixels (from style.outlineWidth)
    - Shadow: Shadow depth in pixels (hardcoded to 0, no shadow rendered in preview)
    - Alignment: Text alignment (from style.horizontalAlign: 1=left, 2=center, 3=right)
    - MarginL: Left margin in pixels (hardcoded to 10)
    - MarginR: Right margin in pixels (hardcoded to 10)
    - MarginV: Vertical margin from bottom in pixels (calculated from style.verticalMargin percentage)
    - Encoding: Character encoding (hardcoded to 1 = default)
    """
    font_family = style.get("fontFamily", "Arial") if style else "Arial"
    font_size = style.get("fontSize", 48) if style else 48  # Match frontend default
    primary_color = style.get("primaryColor", "#FFFFFF") if style else "#FFFFFF"
    outline_color = style.get("outlineColor", "#000000") if style else "#000000"
    outline_width = style.get("outlineWidth", 2.5) if style else 2.5  # Match frontend default
    vertical_margin_percent = style.get("verticalMargin", 8) if style else 8  # Match frontend default (percentage)
    h_align = style.get("horizontalAlign", "center") if style else "center"
    
    # Convert vertical margin from percentage to pixels for reference resolution
    # Frontend: y = height * (1 - verticalMargin / 100)
    # For reference height: margin from bottom = REFERENCE_HEIGHT * (verticalMargin / 100)
    vertical_margin = int(REFERENCE_HEIGHT * vertical_margin_percent / 100)

    def hex_to_ass(hex_color: str) -> str:
        hex_color = hex_color.lstrip("#")
        r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
        return f"&H00{b:02X}{g:02X}{r:02X}"

    primary_ass = hex_to_ass(primary_color)
    outline_ass = hex_to_ass(outline_color)

    alignment = 2 if h_align == "center" else (1 if h_align == "left" else 3)

    def srt_time_to_seconds(srt_time: str) -> float:
        """Convert SRT time format to seconds"""
        time_part = srt_time.replace(",", ".")
        parts = time_part.split(":")
        if len(parts) == 3:
            h, m, s = parts
            return float(h) * 3600 + float(m) * 60 + float(s)
        return 0.0

    def seconds_to_ass_time(seconds: float) -> str:
        """Convert seconds to ASS time format"""
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = seconds % 60
        return f"{h}:{m:02d}:{s:05.2f}"

    ass_content = f"""[Script Info]
Title: Rendered Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: {REFERENCE_WIDTH}
PlayResY: {REFERENCE_HEIGHT}
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_family},{font_size},{primary_ass},&H000000FF,{outline_ass},&H80000000,0,0,0,0,100,100,0,0,1,{outline_width},0,{alignment},10,10,{vertical_margin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    for sub in subtitles:
        start_time_str = sub.get("startTime", "00:00:00,000")
        end_time_str = sub.get("endTime", "00:00:00,000")
        
        # Convert SRT time format to ASS format
        # Frontend already adjusted times based on playback rates
        start_seconds = srt_time_to_seconds(start_time_str)
        end_seconds = srt_time_to_seconds(end_time_str)
        
        start = seconds_to_ass_time(start_seconds)
        end = seconds_to_ass_time(end_seconds)
        
        text = sub.get("text", "").replace("\n", "\\N")
        ass_content += f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}\n"

    output_path.write_text(ass_content, encoding="utf-8-sig")


@router.post("/projects/{project_id}/render")
async def render_video(project_id: str, payload: VideoRenderRequest = Body(...)) -> Dict[str, Any]:
    """
    Render video with subtitles, audio tracks, and effects.
    
    Optimized for large videos:
    - Uses temporary directory to avoid memory buildup
    - Supports configurable timeout via RENDER_TIMEOUT_SECONDS
    - FFmpeg processes video in streaming mode where possible
    - Uses faststart for progressive download support
    """
    project = db.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    video_data_tuple = db.get_file(payload.video_file_id)
    if video_data_tuple is None:
        raise HTTPException(status_code=404, detail=f"Video file not found: {payload.video_file_id}")

    video_data, _content_type, filename = video_data_tuple

    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return {
            "status": "error",
            "message": "ffmpeg không được cài đặt trên server. Vui lòng cài đặt ffmpeg để render video.",
            "video_segments_count": len(payload.video_segments),
            "audio_tracks_count": len(payload.audio_files),
            "subtitles_count": len(payload.subtitles),
        }

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        input_video = temp_path / f"input{Path(filename).suffix}"
        # Write video to temp file - this allows FFmpeg to stream read
        # instead of loading entire file into memory
        input_video.write_bytes(video_data)

        subtitle_file = None
        if payload.subtitles and len(payload.subtitles) > 0:
            subtitle_file = temp_path / "subtitles.ass"
            _create_ass_subtitle_file(
                payload.subtitles, payload.subtitle_style, subtitle_file
            )

        audio_paths = []
        for i, audio_file in enumerate(payload.audio_files):
            audio_id = audio_file.get("id")
            if audio_id:
                audio_tuple = db.get_file(audio_id)
                if audio_tuple:
                    audio_data, _, audio_name = audio_tuple
                    audio_path = temp_path / f"audio_{i}_{audio_name}"
                    audio_path.write_bytes(audio_data)
                    audio_paths.append(
                        {
                            "path": audio_path,
                            "start_time": audio_file.get("startTime", 0),
                            "track": audio_file.get("track", i),
                            "volume_db": audio_file.get("volumeDb", 0),
                        }
                    )

        frame_overlay_path = None
        if payload.video_frame_url and payload.video_frame_url.startswith("data:image/png;base64,"):
            base64_data = payload.video_frame_url.split(",")[1]
            frame_data = base64.b64decode(base64_data)
            frame_overlay_path = temp_path / "frame_overlay.png"
            frame_overlay_path.write_bytes(frame_data)

        output_filename = (
            payload.output_filename
            or f"rendered_{project_id}_{dt.datetime.utcnow().timestamp()}.mp4"
        )
        output_path = DATA_ROOT / project_id / "rendered" / output_filename
        output_path.parent.mkdir(parents=True, exist_ok=True)

        ffmpeg_cmd = [ffmpeg_path, "-y", "-i", str(input_video)]

        for audio_info in audio_paths:
            ffmpeg_cmd.extend(["-i", str(audio_info["path"])])

        if frame_overlay_path:
            ffmpeg_cmd.extend(["-i", str(frame_overlay_path)])

        filter_complex_parts: List[str] = []
        video_filters: List[str] = []
        has_blur_region = False
        blur_region_params: Optional[Dict[str, int]] = None

        if payload.hardsub_cover_box and payload.hardsub_cover_box.get("enabled"):
            box = payload.hardsub_cover_box
            x = int(box.get("x", 0) * 1920 / 100)
            y = int(box.get("y", 0) * 1080 / 100)
            w = int(box.get("width", 0) * 1920 / 100)
            h = int(box.get("height", 0) * 1080 / 100)
            has_blur_region = True
            blur_region_params = {"x": x, "y": y, "w": w, "h": h}

        video_filters.append("scale=1920:1080:force_original_aspect_ratio=decrease")
        video_filters.append("pad=1920:1080:(ow-iw)/2:(oh-ih)/2")
        video_filters.append("fps=30")

        if subtitle_file:
            subtitle_path_str = str(subtitle_file).replace("\\", "/").replace(":", r"\:")
            video_filters.append(f"ass='{subtitle_path_str}'")

        use_filter_complex = bool(audio_paths) or frame_overlay_path or has_blur_region

        if use_filter_complex:
            filter_parts: List[str] = []

            video_segments = (
                payload.video_segments
                if hasattr(payload, "video_segments") and payload.video_segments
                else None
            )

            if video_segments and len(video_segments) >= 1:
                segment_filters: List[str] = []
                for i, segment in enumerate(video_segments):
                    start = segment.get("sourceStartTime", 0)
                    end = segment.get("sourceEndTime", 0)
                    rate = segment.get("playbackRate", 1.0)

                    segment_filter = (
                        f"[0:v]trim=start={start}:end={end},setpts=(PTS-STARTPTS)/{rate}[seg{i}v]"
                    )
                    segment_filters.append(segment_filter)

                filter_parts.append(";".join(segment_filters))

                if len(video_segments) > 1:
                    segment_labels = "".join([f"[seg{i}v]" for i in range(len(video_segments))])
                    concat_filter = (
                        f"{segment_labels}concat=n={len(video_segments)}:v=1:a=0[raw_video]"
                    )
                    filter_parts.append(concat_filter)
                    video_stream = "[raw_video]"
                else:
                    video_stream = "[seg0v]"
            else:
                video_stream = "[0:v]"

            basic_filters = [
                f for f in video_filters if not f.startswith("[") and "overlay" not in f and "ass" not in f
            ]
            if basic_filters:
                video_stream = f"{video_stream}{','.join(basic_filters)}"

            if has_blur_region and blur_region_params:
                params = blur_region_params
                video_stream = (
                    f"{video_stream}[main];[main]split[v1][v2];[v2]crop={params['w']}:{params['h']}:{params['x']}:{params['y']}"
                    ",boxblur=luma_radius=20:luma_power=3[blurred];[v1][blurred]overlay="
                    f"{params['x']}:{params['y']}"
                )

            if frame_overlay_path:
                overlay_input_idx = 1 + len(audio_paths)
                video_stream = (
                    f"{video_stream}[vtmp];[{overlay_input_idx}:v]scale=1920:1080[frame];[vtmp][frame]overlay=0:0"
                )

            subtitle_filter = [f for f in video_filters if "ass" in f]
            if subtitle_filter:
                video_stream = f"{video_stream},{subtitle_filter[0]}"

            filter_parts.append(f"{video_stream}[vout]")

            audio_output_label: Optional[str] = None

            if audio_paths:
                base_audio_stream = "[0:a]"

                if video_segments and len(video_segments) > 0:
                    audio_segment_filters: List[str] = []
                    for i, segment in enumerate(video_segments):
                        start = segment.get("sourceStartTime", 0)
                        end = segment.get("sourceEndTime", 0)
                        rate = segment.get("playbackRate", 1.0)

                        # FFmpeg atempo filter only supports 0.5-2.0 range
                        # For extreme rates, chain multiple atempo filters
                        if rate == 1.0:
                            tempo_filter = ""
                        elif 0.5 <= rate <= 2.0:
                            tempo_filter = f",atempo={rate}"
                        else:
                            # Chain atempo filters for extreme rates
                            tempo_filters = []
                            current_rate = rate
                            # For fast rates (>2.0), apply multiple 2.0x filters
                            while current_rate > 2.0:
                                tempo_filters.append("atempo=2.0")
                                current_rate /= 2.0
                            # For slow rates (<0.5), apply multiple 0.5x filters
                            while current_rate < 0.5:
                                tempo_filters.append("atempo=0.5")
                                current_rate *= 2.0  # Each 0.5x filter doubles the effective rate
                            # Apply remaining rate if not exactly 1.0
                            if current_rate != 1.0:
                                tempo_filters.append(f"atempo={current_rate}")
                            tempo_filter = "," + ",".join(tempo_filters) if tempo_filters else ""

                        audio_trim = (
                            f"[0:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS"
                        )
                        audio_segment_filters.append(
                            f"{audio_trim}{tempo_filter}[seg{i}a]"
                        )

                    if audio_segment_filters:
                        filter_parts.append(";".join(audio_segment_filters))
                        segment_labels = "".join([f"[seg{i}a]" for i in range(len(audio_segment_filters))])
                        filter_parts.append(
                            f"{segment_labels}concat=n={len(audio_segment_filters)}:v=0:a=1[orig_audio]"
                        )
                        base_audio_stream = "[orig_audio]"

                delay_filters: List[str] = []
                delayed_labels: List[str] = []
                for idx, audio_info in enumerate(audio_paths):
                    start_time = audio_info.get("start_time", 0)
                    volume_db = audio_info.get("volume_db", 0)
                    
                    # Frontend already adjusted start time based on playback rates
                    start_time_ms = int(start_time * 1000)
                    
                    # Apply individual volume adjustment if specified
                    if volume_db != 0:
                        linear_gain = math.pow(10.0, volume_db / 20.0)
                        delay_filters.append(
                            f"[{idx + 1}:a]volume={linear_gain:.6f},adelay={start_time_ms}|{start_time_ms}[a{idx + 1}]"
                        )
                    else:
                        delay_filters.append(
                            f"[{idx + 1}:a]adelay={start_time_ms}|{start_time_ms}[a{idx + 1}]"
                        )
                    delayed_labels.append(f"[a{idx + 1}]")

                mix_inputs = base_audio_stream + "".join(delayed_labels)
                mix_label = "aout"
                if payload.master_volume_db:
                    mix_label = "aout_mix"

                delay_filters.append(
                    f"{mix_inputs}amix=inputs={len(audio_paths) + 1}:duration=longest:normalize=0[{mix_label}]"
                )

                if payload.master_volume_db:
                    linear_gain = math.pow(10.0, payload.master_volume_db / 20.0)
                    delay_filters.append(f"[{mix_label}]volume={linear_gain:.6f}[aout]")
                    audio_output_label = "[aout]"
                else:
                    audio_output_label = f"[{mix_label}]"

                filter_parts.append(";".join(delay_filters))
            elif payload.master_volume_db:
                linear_gain = math.pow(10.0, payload.master_volume_db / 20.0)
                filter_parts.append(f"[0:a]volume={linear_gain:.6f}[aout]")
                audio_output_label = "[aout]"

            filter_complex_parts.extend(filter_parts)

            ffmpeg_cmd.extend(["-filter_complex", ";".join(filter_complex_parts)])
            ffmpeg_cmd.extend(["-map", "[vout]"])
            if audio_output_label:
                ffmpeg_cmd.extend(["-map", audio_output_label])
            elif audio_paths:
                ffmpeg_cmd.extend(["-map", "[aout]"])
            else:
                ffmpeg_cmd.extend(["-map", "0:a?"])
        else:
            ffmpeg_cmd.extend(video_filters)

        ffmpeg_cmd.extend(["-c:v", "libx264"])
        ffmpeg_cmd.extend(["-preset", "medium"])
        ffmpeg_cmd.extend(["-crf", "23"])
        # Optimize for large video files with two-pass encoding hint
        ffmpeg_cmd.extend(["-movflags", "+faststart"])  # Enable streaming/progressive download
        ffmpeg_cmd.extend(["-max_muxing_queue_size", "1024"])  # Increase buffer for large files
        ffmpeg_cmd.extend(["-c:a", "aac", "-b:a", "192k"])
        ffmpeg_cmd.append(str(output_path))

        log_file_path = output_path.parent / f"render_log_{dt.datetime.utcnow().timestamp()}.txt"

        try:
            with open(log_file_path, "w", encoding="utf-8") as log_file:
                log_file.write("=" * 80 + "\n")
                log_file.write("FFMPEG RENDER LOG\n")
                log_file.write("=" * 80 + "\n\n")
                log_file.write(f"Project ID: {project_id}\n")
                log_file.write(f"Timestamp: {dt.datetime.utcnow().isoformat()}\n")
                log_file.write(f"Output: {output_path}\n\n")
                log_file.write("COMMAND:\n")
                log_file.write(" ".join(ffmpeg_cmd) + "\n\n")
                log_file.write("=" * 80 + "\n")
                log_file.write("FFMPEG OUTPUT:\n")
                log_file.write("=" * 80 + "\n\n")

            result = subprocess.run(
                ffmpeg_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=RENDER_TIMEOUT_SECONDS,
                check=False,
            )

            stdout = result.stdout.decode("utf-8", errors="ignore")
            stderr = result.stderr.decode("utf-8", errors="ignore")

            with open(log_file_path, "a", encoding="utf-8") as log_file:
                log_file.write("STDOUT:\n")
                log_file.write(stdout + "\n\n")
                log_file.write("STDERR:\n")
                log_file.write(stderr + "\n\n")
                log_file.write("=" * 80 + "\n")
                log_file.write(f"Return Code: {result.returncode}\n")
                log_file.write("=" * 80 + "\n")

            if result.returncode != 0:
                stderr_lines = stderr.strip().split("\n")
                error_summary = (
                    "\n".join(stderr_lines[-10:]) if len(stderr_lines) > 10 else stderr
                )

                return {
                    "status": "error",
                    "message": f"ffmpeg rendering failed:\n{error_summary}",
                    "ffmpeg_command": " ".join(ffmpeg_cmd),
                    "log_file": str(log_file_path),
                    "video_segments_count": len(payload.video_segments),
                    "audio_tracks_count": len(payload.audio_files),
                    "subtitles_count": len(payload.subtitles),
                }

            file_size = output_path.stat().st_size

            duration_seconds = None
            try:
                probe_result = subprocess.run(
                    [
                        ffmpeg_path.replace("ffmpeg", "ffprobe"),
                        "-v",
                        "error",
                        "-show_entries",
                        "format=duration",
                        "-of",
                        "default=noprint_wrappers=1:nokey=1",
                        str(output_path),
                    ],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=False,
                )
                if probe_result.returncode == 0:
                    duration_seconds = float(probe_result.stdout.decode().strip())
            except Exception:
                pass

            return {
                "status": "success",
                "message": "Video rendered successfully!",
                "log_file": str(log_file_path),
                "output_filename": output_filename,
                "output_path": str(output_path),
                "file_size": file_size,
                "duration_seconds": duration_seconds,
                "video_segments_count": len(payload.video_segments),
                "audio_tracks_count": len(payload.audio_files),
                "subtitles_count": len(payload.subtitles),
            }

        except subprocess.TimeoutExpired:
            try:
                with open(log_file_path, "a", encoding="utf-8") as log_file:
                    log_file.write("\n" + "=" * 80 + "\n")
                    log_file.write(f"TIMEOUT: Process exceeded {RENDER_TIMEOUT_SECONDS} seconds ({RENDER_TIMEOUT_SECONDS/60:.1f} minutes)\n")
                    log_file.write("=" * 80 + "\n")
            except Exception:
                pass

            return {
                "status": "error",
                "message": f"Rendering timeout (>{RENDER_TIMEOUT_SECONDS/60:.1f} minutes). Video may be too long or complex. Consider increasing RENDER_TIMEOUT_SECONDS environment variable.",
                "ffmpeg_command": " ".join(ffmpeg_cmd),
                "log_file": str(log_file_path),
                "video_segments_count": len(payload.video_segments),
                "audio_tracks_count": len(payload.audio_files),
                "subtitles_count": len(payload.subtitles),
            }

from __future__ import annotations

import base64
import io
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
import pytesseract
from fastapi import APIRouter, HTTPException
from PIL import Image
from pydantic import BaseModel

from app.core import db


class BoundingBox(BaseModel):
    x: float  # percentage
    y: float  # percentage
    width: float  # percentage
    height: float  # percentage
    enabled: bool


class OCRAnalysisRequest(BaseModel):
    video_file_id: str
    num_samples: int = 20
    language: str = "chi_sim"  # Default to Chinese simplified


router = APIRouter()


def _extract_video_frames(
    video_data: bytes,
    num_samples: int,
    video_duration: Optional[float] = None,
) -> tuple[List[np.ndarray], int, int]:
    """
    Extract frames from video at regular intervals for OCR analysis.
    
    Returns:
        Tuple of (frames, video_width, video_height)
    """
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as temp_video:
        temp_video_path = Path(temp_video.name)
        temp_video.write(video_data)
        temp_video.flush()
        
        try:
            # Get video duration if not provided
            if video_duration is None:
                ffprobe_cmd = [
                    "ffprobe",
                    "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    str(temp_video_path),
                ]
                result = subprocess.run(
                    ffprobe_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=False,
                )
                if result.returncode == 0:
                    video_duration = float(result.stdout.decode().strip())
                else:
                    video_duration = 60.0  # Default fallback
            
            # Open video with OpenCV
            cap = cv2.VideoCapture(str(temp_video_path))
            if not cap.isOpened():
                raise ValueError("Failed to open video file")
            
            # Get video properties
            video_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            video_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = cap.get(cv2.CAP_PROP_FPS)
            
            frames = []
            sample_interval = video_duration / (num_samples + 1)
            
            for i in range(1, num_samples + 1):
                sample_time = i * sample_interval
                frame_number = int(sample_time * fps)
                
                # Seek to frame
                cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
                ret, frame = cap.read()
                
                if ret:
                    frames.append(frame)
            
            cap.release()
            return frames, video_width, video_height
            
        finally:
            temp_video_path.unlink(missing_ok=True)


def _analyze_frames_for_subtitles(
    frames: List[np.ndarray],
    video_width: int,
    video_height: int,
    language: str = "chi_sim",
) -> Optional[BoundingBox]:
    """
    Analyze video frames using OCR to detect hardcoded subtitle positions.
    
    Args:
        frames: List of video frames as numpy arrays
        video_width: Width of video in pixels
        video_height: Height of video in pixels
        language: Tesseract language code (e.g., 'chi_sim', 'eng')
    
    Returns:
        BoundingBox if subtitles detected, None otherwise
    """
    all_bboxes: List[Dict[str, int]] = []
    
    for frame in frames:
        # Convert BGR (OpenCV) to RGB (PIL)
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pil_image = Image.fromarray(rgb_frame)
        
        # Run OCR with bounding box data
        try:
            ocr_data = pytesseract.image_to_data(
                pil_image,
                lang=language,
                output_type=pytesseract.Output.DICT,
            )
            
            # Filter for text in bottom 30% of frame with confidence > 60
            for i, conf in enumerate(ocr_data["conf"]):
                if conf > 60:  # Confidence threshold
                    y = ocr_data["top"][i]
                    if y > video_height * 0.7:  # Bottom 30%
                        x = ocr_data["left"][i]
                        w = ocr_data["width"][i]
                        h = ocr_data["height"][i]
                        all_bboxes.append({
                            "x0": x,
                            "y0": y,
                            "x1": x + w,
                            "y1": y + h,
                        })
        except Exception as e:
            # Log error but continue processing other frames
            print(f"OCR error on frame: {e}")
            continue
    
    if not all_bboxes:
        return None
    
    # Find overall horizontal extent and the absolute bottom edge
    min_x = min(box["x0"] for box in all_bboxes)
    max_x = max(box["x1"] for box in all_bboxes)
    max_y = max(box["y1"] for box in all_bboxes)
    
    # Calculate the median height of detected subtitle lines
    heights = sorted([box["y1"] - box["y0"] for box in all_bboxes])
    median_height = heights[len(heights) // 2] if heights else 20
    
    # Define the box anchored to the bottom, tall enough for two lines
    new_min_y = max_y - (median_height * 2.5)
    
    # Use smaller padding to create a tighter box
    PADDING_Y = 0.5  # smaller vertical padding
    PADDING_X = 1.0
    
    bounding_box = BoundingBox(
        x=max(0, (min_x / video_width) * 100 - PADDING_X),
        y=max(0, (new_min_y / video_height) * 100 - PADDING_Y),
        width=min(100, ((max_x - min_x) / video_width) * 100 + 2 * PADDING_X),
        height=min(100, ((max_y - new_min_y) / video_height) * 100 + 2 * PADDING_Y),
        enabled=True,
    )
    
    return bounding_box


@router.post("/projects/{project_id}/videos/{video_id}/analyze-hardsubs")
async def analyze_hardsubs(
    project_id: str,
    video_id: str,
    request: OCRAnalysisRequest,
) -> Dict[str, Any]:
    """
    Analyze a video to detect hardcoded subtitle positions using OCR.
    
    This endpoint extracts frames from the video at regular intervals,
    performs OCR analysis to detect text in the bottom portion of frames,
    and returns a bounding box that can be used to cover the hardcoded subtitles.
    """
    # Verify project exists
    project = db.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
    
    # Get video file data
    video_tuple = db.get_file(video_id)
    if video_tuple is None:
        raise HTTPException(status_code=404, detail=f"Video file not found: {video_id}")
    
    video_data, content_type, filename = video_tuple
    
    try:
        # Extract frames from video
        frames, video_width, video_height = _extract_video_frames(
            video_data,
            request.num_samples,
        )
        
        if not frames:
            return {
                "status": "error",
                "message": "Failed to extract frames from video",
                "detected": False,
            }
        
        # Analyze frames for subtitles
        bounding_box = _analyze_frames_for_subtitles(
            frames,
            video_width,
            video_height,
            request.language,
        )
        
        if bounding_box is None:
            return {
                "status": "success",
                "message": "No hardcoded subtitles detected",
                "detected": False,
                "frames_analyzed": len(frames),
            }
        
        return {
            "status": "success",
            "message": "Hardcoded subtitles detected successfully",
            "detected": True,
            "frames_analyzed": len(frames),
            "bounding_box": {
                "x": bounding_box.x,
                "y": bounding_box.y,
                "width": bounding_box.width,
                "height": bounding_box.height,
                "enabled": bounding_box.enabled,
            },
        }
        
    except Exception as e:
        # Log the error for debugging but don't expose details to client
        import logging
        import traceback
        
        logger = logging.getLogger(__name__)
        logger.error(f"OCR analysis failed: {str(e)}")
        logger.error(traceback.format_exc())
        
        # Return generic error message without exposing internal details
        return {
            "status": "error",
            "message": "Failed to analyze video. Please check server logs for details.",
            "detected": False,
        }

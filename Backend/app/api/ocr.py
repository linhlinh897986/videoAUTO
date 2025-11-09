from __future__ import annotations

import base64
import concurrent.futures
import io
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
import pytesseract
from fastapi import APIRouter, HTTPException
from PIL import Image
from pydantic import BaseModel

from app.core import db

# Try to import GPU-accelerated OCR libraries
try:
    import torch
    import easyocr
    GPU_AVAILABLE = torch.cuda.is_available()
    if GPU_AVAILABLE:
        print("GPU detected - EasyOCR GPU mode enabled")
    else:
        print("GPU not detected - will use CPU-based OCR")
except ImportError:
    GPU_AVAILABLE = False
    print("EasyOCR not installed - using pytesseract (CPU only)")


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
    max_workers: int = 4  # Number of parallel OCR workers


router = APIRouter()

# Initialize EasyOCR reader globally (expensive operation, done once)
EASYOCR_READER = None
if GPU_AVAILABLE:
    try:
        # Initialize with Chinese and English support
        EASYOCR_READER = easyocr.Reader(['ch_sim', 'en'], gpu=True, verbose=False)
        print("EasyOCR GPU reader initialized successfully")
    except Exception as e:
        print(f"Failed to initialize EasyOCR GPU reader: {e}")
        GPU_AVAILABLE = False


def _check_tesseract_installation(language: str = "chi_sim") -> Tuple[bool, str]:
    """
    Check if Tesseract is properly installed and the required language data is available.
    
    Returns:
        Tuple of (is_available, error_message)
    """
    try:
        # Check if tesseract command is available
        version = pytesseract.get_tesseract_version()
        
        # Try to get available languages
        langs = pytesseract.get_languages()
        
        if language not in langs:
            return False, f"Tesseract language '{language}' not installed. Available: {', '.join(langs)}"
        
        return True, ""
    except pytesseract.TesseractNotFoundError:
        return False, "Tesseract OCR is not installed on the server"
    except Exception as e:
        return False, f"Error checking Tesseract: {str(e)}"


def _get_video_rotation(video_path: Path) -> int:
    """
    Detect video rotation metadata using ffprobe.
    
    Returns rotation angle (0, 90, 180, 270) based on video metadata.
    """
    try:
        cmd = [
            "ffprobe",
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream_tags=rotate",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(video_path),
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        if result.returncode == 0 and result.stdout:
            rotation = int(result.stdout.decode().strip())
            return rotation
    except (ValueError, Exception):
        pass
    return 0


def _apply_rotation(frame: np.ndarray, rotation: int) -> np.ndarray:
    """
    Apply rotation correction to frame based on metadata.
    
    Args:
        frame: Video frame as numpy array
        rotation: Rotation angle (90, 180, 270)
    
    Returns:
        Rotated frame
    """
    if rotation == 90:
        return cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
    elif rotation == 180:
        return cv2.rotate(frame, cv2.ROTATE_180)
    elif rotation == 270:
        return cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return frame


def _extract_video_frames(
    video_data: bytes,
    num_samples: int,
    video_duration: Optional[float] = None,
) -> tuple[List[np.ndarray], int, int]:
    """
    Extract frames from video at regular intervals for OCR analysis.
    Handles video rotation metadata to ensure frames are correctly oriented.
    
    Returns:
        Tuple of (frames, video_width, video_height)
    """
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as temp_video:
        temp_video_path = Path(temp_video.name)
        temp_video.write(video_data)
        temp_video.flush()
        
        try:
            # Get video rotation metadata
            rotation = _get_video_rotation(temp_video_path)
            
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
                    # Apply rotation correction if needed
                    if rotation != 0:
                        frame = _apply_rotation(frame, rotation)
                    frames.append(frame)
            
            cap.release()
            
            # Adjust dimensions if video was rotated 90 or 270 degrees
            if rotation in [90, 270]:
                video_width, video_height = video_height, video_width
            
            return frames, video_width, video_height
            
        finally:
            temp_video_path.unlink(missing_ok=True)


def _process_single_frame_ocr_gpu(
    frame: np.ndarray,
    video_height: int,
) -> Tuple[List[Dict[str, int]], bool]:
    """
    Process a single frame with GPU-accelerated EasyOCR.
    
    Args:
        frame: Video frame as numpy array
        video_height: Height of video in pixels
    
    Returns:
        Tuple of (bounding boxes found, success flag)
    """
    bboxes = []
    try:
        # EasyOCR expects RGB format
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # Run EasyOCR (returns list of (bbox, text, confidence))
        results = EASYOCR_READER.readtext(rgb_frame)
        
        # Group words into lines based on their vertical position
        # Filter for text in bottom 30% of frame
        lines_dict = {}  # y_position -> list of word boxes
        
        for bbox, text, confidence in results:
            if confidence > 0.6:  # Confidence threshold
                # bbox is [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
                x0 = int(min(point[0] for point in bbox))
                y0 = int(min(point[1] for point in bbox))
                x1 = int(max(point[0] for point in bbox))
                y1 = int(max(point[1] for point in bbox))
                
                # Check if in bottom 30%
                if y0 > video_height * 0.7:
                    # Group by approximate line (within 5 pixels)
                    line_y = round(y0 / 5) * 5
                    if line_y not in lines_dict:
                        lines_dict[line_y] = []
                    lines_dict[line_y].append({
                        "x0": x0,
                        "y0": y0,
                        "x1": x1,
                        "y1": y1,
                    })
        
        # Merge words in each line into a single bounding box
        for line_boxes in lines_dict.values():
            if line_boxes:
                min_x = min(box["x0"] for box in line_boxes)
                max_x = max(box["x1"] for box in line_boxes)
                min_y = min(box["y0"] for box in line_boxes)
                max_y = max(box["y1"] for box in line_boxes)
                
                bboxes.append({
                    "x0": min_x,
                    "y0": min_y,
                    "x1": max_x,
                    "y1": max_y,
                })
        
        return bboxes, True
    except Exception as e:
        print(f"GPU OCR error on frame: {e}")
        return [], False


def _process_single_frame_ocr(
    frame: np.ndarray,
    video_height: int,
    language: str,
) -> Tuple[List[Dict[str, int]], bool]:
    """
    Process a single frame with OCR. Uses GPU if available, falls back to CPU.
    Uses line-level detection to match frontend behavior.
    
    Args:
        frame: Video frame as numpy array
        video_height: Height of video in pixels
        language: Tesseract language code (ignored if using GPU)
    
    Returns:
        Tuple of (bounding boxes found, success flag)
    """
    # Try GPU first if available
    if GPU_AVAILABLE and EASYOCR_READER is not None:
        return _process_single_frame_ocr_gpu(frame, video_height)
    
    # Fall back to CPU-based Tesseract OCR
    bboxes = []
    try:
        # Convert BGR (OpenCV) to RGB (PIL)
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pil_image = Image.fromarray(rgb_frame)
        
        # Run OCR with line-level bounding box data (matches frontend behavior)
        ocr_data = pytesseract.image_to_data(
            pil_image,
            lang=language,
            output_type=pytesseract.Output.DICT,
        )
        
        # Group words into lines based on their vertical position
        # Filter for text in bottom 30% of frame with confidence > 60
        lines_dict = {}  # y_position -> list of word boxes
        
        for i, conf in enumerate(ocr_data["conf"]):
            if conf > 60:  # Confidence threshold
                y = ocr_data["top"][i]
                if y > video_height * 0.7:  # Bottom 30%
                    x = ocr_data["left"][i]
                    w = ocr_data["width"][i]
                    h = ocr_data["height"][i]
                    
                    # Group by approximate line (within 5 pixels)
                    line_y = round(y / 5) * 5
                    if line_y not in lines_dict:
                        lines_dict[line_y] = []
                    lines_dict[line_y].append({
                        "x0": x,
                        "y0": y,
                        "x1": x + w,
                        "y1": y + h,
                    })
        
        # Merge words in each line into a single bounding box
        for line_boxes in lines_dict.values():
            if line_boxes:
                min_x = min(box["x0"] for box in line_boxes)
                max_x = max(box["x1"] for box in line_boxes)
                min_y = min(box["y0"] for box in line_boxes)
                max_y = max(box["y1"] for box in line_boxes)
                
                bboxes.append({
                    "x0": min_x,
                    "y0": min_y,
                    "x1": max_x,
                    "y1": max_y,
                })
        
        return bboxes, True
    except Exception as e:
        print(f"OCR error on frame: {e}")
        return [], False


def _analyze_frames_for_subtitles(
    frames: List[np.ndarray],
    video_width: int,
    video_height: int,
    language: str = "chi_sim",
    max_workers: int = 4,
) -> tuple[Optional[BoundingBox], int, int]:
    """
    Analyze video frames using OCR to detect hardcoded subtitle positions.
    Uses parallel processing for faster OCR analysis.
    
    Args:
        frames: List of video frames as numpy arrays
        video_width: Width of video in pixels
        video_height: Height of video in pixels
        language: Tesseract language code (e.g., 'chi_sim', 'eng')
        max_workers: Number of parallel workers for OCR processing
    
    Returns:
        Tuple of (BoundingBox if subtitles detected or None, successful_frames, failed_frames)
    """
    all_bboxes: List[Dict[str, int]] = []
    successful_frames = 0
    failed_frames = 0
    
    # Use ThreadPoolExecutor for parallel OCR processing
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all OCR tasks
        future_to_frame = {
            executor.submit(_process_single_frame_ocr, frame, video_height, language): idx
            for idx, frame in enumerate(frames)
        }
        
        # Collect results as they complete
        for future in concurrent.futures.as_completed(future_to_frame):
            try:
                bboxes, success = future.result()
                if success:
                    successful_frames += 1
                    all_bboxes.extend(bboxes)
                else:
                    failed_frames += 1
            except Exception as e:
                failed_frames += 1
                print(f"OCR processing error: {e}")
    
    if not all_bboxes:
        return None, successful_frames, failed_frames
    
    # Find overall horizontal extent and the absolute bottom edge
    min_x = min(box["x0"] for box in all_bboxes)
    max_x = max(box["x1"] for box in all_bboxes)
    max_y = max(box["y1"] for box in all_bboxes)
    
    # Calculate the median height of detected subtitle lines
    heights = sorted([box["y1"] - box["y0"] for box in all_bboxes])
    median_height = heights[len(heights) // 2] if heights else 20
    
    # Define the box anchored to the bottom, tall enough for two lines
    new_min_y = max_y - (median_height * 2.5)
    
    # Use smaller padding for height
    PADDING_Y = 0.5  # smaller vertical padding
    
    # Width is always 100% (covers full width of video)
    bounding_box = BoundingBox(
        x=0,  # Always start from left edge
        y=max(0, (new_min_y / video_height) * 100 - PADDING_Y),
        width=100,  # Always cover full width
        height=min(100, ((max_y - new_min_y) / video_height) * 100 + 2 * PADDING_Y),
        enabled=True,
    )
    
    return bounding_box, successful_frames, failed_frames


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
    # Skip Tesseract check if GPU is available
    if not (GPU_AVAILABLE and EASYOCR_READER is not None):
        # Check if Tesseract is properly installed (only needed for CPU fallback)
        is_available, error_msg = _check_tesseract_installation(request.language)
        if not is_available:
            return {
                "status": "error",
                "message": f"Tesseract OCR configuration error: {error_msg}. GPU OCR is not available either.",
                "detected": False,
                "tesseract_error": True,
                "ocr_engine": "none",
            }
    
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
        
        # Analyze frames for subtitles with parallel processing
        bounding_box, successful_frames, failed_frames = _analyze_frames_for_subtitles(
            frames,
            video_width,
            video_height,
            request.language,
            request.max_workers,
        )
        
        # If all frames failed, return an error
        if failed_frames > 0 and successful_frames == 0:
            ocr_engine = "GPU (EasyOCR)" if (GPU_AVAILABLE and EASYOCR_READER is not None) else "CPU (Tesseract)"
            return {
                "status": "error",
                "message": f"OCR failed on all {failed_frames} frames. OCR engine may not be configured correctly.",
                "detected": False,
                "frames_analyzed": len(frames),
                "successful_frames": successful_frames,
                "failed_frames": failed_frames,
                "ocr_engine": ocr_engine,
            }
        
        # Determine which OCR engine was used
        ocr_engine = "GPU (EasyOCR)" if (GPU_AVAILABLE and EASYOCR_READER is not None) else "CPU (Tesseract)"
        
        if bounding_box is None:
            message = "No hardcoded subtitles detected"
            if failed_frames > 0:
                message += f" ({failed_frames}/{len(frames)} frames had OCR errors)"
            
            return {
                "status": "success",
                "message": message,
                "detected": False,
                "frames_analyzed": len(frames),
                "successful_frames": successful_frames,
                "failed_frames": failed_frames,
                "ocr_engine": ocr_engine,
            }
        
        return {
            "status": "success",
            "message": "Hardcoded subtitles detected successfully",
            "detected": True,
            "frames_analyzed": len(frames),
            "successful_frames": successful_frames,
            "failed_frames": failed_frames,
            "ocr_engine": ocr_engine,
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

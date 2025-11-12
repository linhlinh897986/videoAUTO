from __future__ import annotations

import concurrent.futures
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from app.core import db

router = APIRouter(prefix="/downloads")


# --- Models ---
class ChannelItem(BaseModel):
    id: str
    name: str
    url: str
    type: str  # 'douyin' or 'youtube'
    created_at: str


class ChannelListCreate(BaseModel):
    name: str
    url: str
    type: str


class ChannelListResponse(BaseModel):
    channels: List[ChannelItem]


class ScanRequest(BaseModel):
    url: str
    type: str  # 'douyin' or 'other' (for youtube/bilibili/etc)
    mode: str = "fast"  # 'fast' or 'detailed'
    max_videos: int = 10  # For fast mode preview


class ScannedVideo(BaseModel):
    id: str
    title: str
    description: Optional[str] = ""  # Can be None
    thumbnail: Optional[str] = ""  # Can be None
    author: Optional[str] = ""  # Can be None
    created_time: Optional[str] = ""  # Can be None
    duration: Optional[str] = None
    url: str
    view_count: Optional[int] = None  # View count for detailed mode
    tags: Optional[List[str]] = None  # Tags for detailed mode
    downloaded: bool = False  # Track if video has been downloaded


class ScanResponse(BaseModel):
    status: str
    videos: List[ScannedVideo]
    channel_info: Dict[str, Any]
    mode: str  # 'fast' or 'detailed'
    total_channel_videos: Optional[int] = None  # Total videos in channel


class DownloadRequest(BaseModel):
    video_id: str
    url: str
    project_id: str
    type: str  # 'douyin', 'youtube', or 'bilibili'


class DownloadStatusResponse(BaseModel):
    id: str
    status: str  # 'pending', 'downloading', 'completed', 'failed'
    progress: Optional[int] = None
    message: Optional[str] = None
    video_info: Optional[Dict[str, Any]] = None


class MarkDownloadedRequest(BaseModel):
    video_ids: List[str]
    downloaded: bool  # True to mark as downloaded, False to unmark


# --- API Endpoints ---
@router.get("/channels", response_model=ChannelListResponse)
async def get_channel_lists() -> ChannelListResponse:
    """Get all saved channel lists."""
    channels = db.list_channel_lists()
    return ChannelListResponse(channels=channels)


@router.post("/channels", response_model=ChannelItem)
async def add_channel_list(data: ChannelListCreate) -> ChannelItem:
    """Add a new channel to the saved list."""
    channel_id = f"channel-{dt.datetime.utcnow().timestamp()}"
    created_at = dt.datetime.utcnow().isoformat()
    
    channel = ChannelItem(
        id=channel_id,
        name=data.name,
        url=data.url,
        type=data.type,
        created_at=created_at,
    )
    
    # Convert Pydantic model to dict
    try:
        # Pydantic v2
        channel_dict = channel.model_dump()
    except AttributeError:
        # Pydantic v1
        channel_dict = channel.dict()
    
    db.save_channel_list(channel_dict, created_at)
    return channel


@router.delete("/channels/{channel_id}")
async def delete_channel_list(channel_id: str) -> Dict[str, str]:
    """Delete a channel from the saved list."""
    db.delete_channel_list(channel_id)
    return {"status": "deleted", "channel_id": channel_id}


@router.post("/scan", response_model=ScanResponse)
async def scan_channel(data: ScanRequest) -> ScanResponse:
    """Scan a channel/user URL and return video information.
    
    Two modes:
    - fast: Quick scan using --flat-playlist (limit 10 videos by default)
    - detailed: Full metadata fetch with concurrent threads (10 threads)
    
    Smart logic:
    - If fast mode returns all new videos (not in DB), automatically trigger full channel scan
    - Then detailed mode can be called to fetch full metadata for selected videos
    """
    try:
        if data.type == "douyin":
            result = await _scan_douyin_channel(data.url, data.max_videos)
            result["mode"] = data.mode
        else:
            # Unified handling for YouTube, Bilibili and other yt-dlp supported platforms
            if data.mode == "fast":
                result = await _scan_ytdlp_fast(data.url, data.max_videos)
            else:  # detailed mode
                result = await _scan_ytdlp_detailed(data.url, data.max_videos)
        
        # Save scanned videos to database and check download status
        new_video_count = 0
        for video in result["videos"]:
            existing = db.get_scanned_video(video["id"])
            if not existing:
                new_video_count += 1
            db.save_scanned_video(video)
            # Check if this video was previously downloaded
            video["downloaded"] = db.get_video_download_status(video["id"])
        
        # Smart logic: if fast mode and all videos are new, trigger full scan
        if data.mode == "fast" and new_video_count == len(result["videos"]) and new_video_count >= data.max_videos:
            # All preview videos are new, fetch full channel list
            full_result = await _scan_ytdlp_fast(data.url, max_videos=None)  # No limit
            for video in full_result["videos"]:
                db.save_scanned_video(video)
                video["downloaded"] = db.get_video_download_status(video["id"])
            result = full_result
        
        return ScanResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scan failed: {str(e)}")


@router.post("/download")
async def download_video(data: DownloadRequest, background_tasks: BackgroundTasks) -> Dict[str, str]:
    """Start downloading a video."""
    download_id = f"download-{dt.datetime.utcnow().timestamp()}"
    
    # Create initial download record
    db.save_download_status(
        download_id=download_id,
        video_id=data.video_id,
        project_id=data.project_id,
        status="pending",
        url=data.url,
        type=data.type,
        created_at=dt.datetime.utcnow().isoformat(),
    )
    
    # Start download in background
    background_tasks.add_task(_download_video_task, download_id, data)
    
    return {"status": "started", "download_id": download_id}


@router.get("/download/{download_id}", response_model=DownloadStatusResponse)
async def get_download_status(download_id: str) -> DownloadStatusResponse:
    """Get the status of a download."""
    status_data = db.get_download_status(download_id)
    if not status_data:
        raise HTTPException(status_code=404, detail="Download not found")
    
    return DownloadStatusResponse(**status_data)


@router.get("/history")
async def get_download_history(project_id: Optional[str] = None) -> Dict[str, List[Dict[str, Any]]]:
    """Get download history, optionally filtered by project."""
    history = db.list_download_history(project_id)
    return {"downloads": history}


@router.post("/mark-downloaded")
async def mark_videos_downloaded(data: MarkDownloadedRequest) -> Dict[str, Any]:
    """Mark videos as downloaded or unmark them."""
    try:
        for video_id in data.video_ids:
            db.mark_video_downloaded(video_id, data.downloaded)
        
        return {
            "status": "success",
            "marked": len(data.video_ids),
            "downloaded": data.downloaded
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to mark videos: {str(e)}")


# --- Helper Functions ---
async def _scan_douyin_channel(url: str, max_videos: int) -> Dict[str, Any]:
    """Scan a Douyin channel using the douyin main.py script."""
    douyin_script = Path(__file__).parent.parent / "download" / "douyin" / "main.py"
    douyin_dir = douyin_script.parent
    
    try:
        # Run douyin script to get channel info
        # Change to douyin directory so it can find cookies.txt and other files in its directory
        # Use both --recent-count and --need-items to get more videos
        # Add --cookie-file parameter to load cookies for both douyin.py and mdouyin.py
        result = subprocess.run(
            [sys.executable, str(douyin_script), "--url", url, 
             "--recent-count", str(max_videos), 
             "--need-items", str(max_videos),
             "--cookie-file", "cookies.txt"],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(douyin_dir),  # Run in douyin directory for cookie access
        )
        
        if result.returncode != 0:
            raise RuntimeError(f"Douyin scan failed: {result.stderr}")
        
        # Parse JSON output
        data = json.loads(result.stdout)
        
        # Convert to our format
        videos = []
        if "user" in data and "videos" in data:
            for v in data["videos"][:max_videos]:
                videos.append({
                    "id": v.get("aweme_id", ""),
                    "title": v.get("desc", "No title"),
                    "description": v.get("desc", ""),
                    "thumbnail": v.get("cover", ""),
                    "author": v.get("author", ""),
                    "created_time": v.get("created", ""),
                    "duration": None,
                    "url": v.get("page_url", ""),
                })
            
            channel_info = {
                "name": data["user"].get("nickname", "Unknown"),
                "id": data["user"].get("sec_uid", ""),
                "total_videos": data["user"].get("total_videos", 0),
            }
        elif "video" in data:
            # Single video
            v = data["video"]
            videos.append({
                "id": v.get("aweme_id", ""),
                "title": v.get("desc", "No title"),
                "description": v.get("desc", ""),
                "thumbnail": v.get("cover", ""),
                "author": v.get("author", ""),
                "created_time": v.get("created", ""),
                "duration": None,
                "url": v.get("page_url", ""),
            })
            channel_info = {"name": v.get("author", "Unknown"), "id": "", "total_videos": 1}
        else:
            raise RuntimeError("Invalid response from douyin script")
        
        return {
            "status": "success",
            "videos": videos,
            "channel_info": channel_info,
            "mode": "fast",  # Douyin always uses its own mode
        }
    except Exception as e:
        raise RuntimeError(f"Failed to scan Douyin channel: {str(e)}")


def _get_ytdlp_command() -> Optional[str]:
    """Get the yt-dlp command based on platform."""
    import platform
    import shutil
    
    if platform.system() == "Windows":
        yt_dlp_path = Path(__file__).parent.parent / "download" / "yt-dlp.exe"
        if yt_dlp_path.exists():
            return str(yt_dlp_path)
    
    # On Linux/Mac, try to use yt-dlp from PATH
    yt_dlp_cmd = shutil.which("yt-dlp")
    return yt_dlp_cmd


async def _scan_ytdlp_fast(url: str, max_videos: Optional[int] = 10) -> Dict[str, Any]:
    """Fast scan using yt-dlp with --flat-playlist.
    
    This retrieves basic information (ID, title, URL) quickly without accessing each video.
    Suitable for YouTube, Bilibili, and other yt-dlp supported platforms.
    
    Args:
        url: Channel/playlist URL
        max_videos: Maximum number of videos to fetch (None for all)
    """
    yt_dlp_cmd = _get_ytdlp_command()
    
    try:
        # Build command for fast scanning
        if yt_dlp_cmd:
            cmd = [
                yt_dlp_cmd,
                "--flat-playlist",
                "--print", "%(id)s\t%(title)s\t%(url)s\t%(uploader)s\t%(channel_id)s",
                "--no-warnings",
            ]
        else:
            # Use python module as fallback
            cmd = [
                sys.executable, "-m", "yt_dlp",
                "--flat-playlist",
                "--print", "%(id)s\t%(title)s\t%(url)s\t%(uploader)s\t%(channel_id)s",
                "--no-warnings",
            ]
        
        # Add playlist limit if specified
        if max_videos is not None:
            cmd.extend(["--playlist-end", str(max_videos)])
        
        cmd.append(url)
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=180,
        )
        
        if result.returncode != 0:
            raise RuntimeError(f"yt-dlp scan failed: {result.stderr}")
        
        # Parse tab-separated output (one video per line)
        videos = []
        channel_info = {"name": "Unknown", "id": "", "total_videos": 0}
        
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            try:
                # Split by tab: id, title, url, uploader, channel_id
                parts = line.split("\t")
                if len(parts) >= 3:
                    video_id = parts[0]
                    title = parts[1]
                    video_url = parts[2] if len(parts) > 2 and parts[2] != "NA" else ""
                    author = parts[3] if len(parts) > 3 and parts[3] != "NA" else "Unknown"
                    channel_id = parts[4] if len(parts) > 4 and parts[4] != "NA" else ""
                    
                    videos.append({
                        "id": video_id,
                        "title": title,
                        "description": "",
                        "thumbnail": "",
                        "author": author,
                        "created_time": "",
                        "duration": "",
                        "url": video_url,
                    })
                    
                    # Update channel info from first video
                    if not channel_info["id"] and author != "Unknown":
                        channel_info = {
                            "name": author,
                            "id": channel_id,
                            "total_videos": 0,
                        }
            except Exception:
                continue
        
        return {
            "status": "success",
            "videos": videos,
            "channel_info": channel_info,
            "mode": "fast",
        }
    except Exception as e:
        raise RuntimeError(f"Failed to scan with yt-dlp (fast mode): {str(e)}")


async def _fetch_video_details(video_id: str, platform_url: str) -> Dict[str, Any]:
    """Fetch detailed information for a single video using yt-dlp.
    
    This is called by the detailed mode to get complete metadata.
    """
    yt_dlp_cmd = _get_ytdlp_command()
    
    try:
        # Build command for detailed video info
        if yt_dlp_cmd:
            cmd = [
                yt_dlp_cmd,
                "--dump-single-json",
                "--no-warnings",
                platform_url,
            ]
        else:
            cmd = [
                sys.executable, "-m", "yt_dlp",
                "--dump-single-json",
                "--no-warnings",
                platform_url,
            ]
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60,
        )
        
        if result.returncode != 0:
            # If failed, return basic info
            return {
                "id": video_id,
                "title": "Error fetching details",
                "description": "",
                "thumbnail": "",
                "author": "",
                "created_time": "",
                "duration": "",
                "url": platform_url,
                "view_count": None,
                "tags": None,
            }
        
        # Parse JSON output
        data = json.loads(result.stdout)
        
        # Extract detailed information
        return {
            "id": data.get("id", video_id),
            "title": data.get("title", "No title"),
            "description": data.get("description", ""),
            "thumbnail": data.get("thumbnail", ""),
            "author": data.get("uploader", "Unknown"),
            "created_time": data.get("upload_date", ""),
            "duration": str(data.get("duration", "")) if data.get("duration") else "",
            "url": data.get("webpage_url", platform_url),
            "view_count": data.get("view_count"),
            "tags": data.get("tags", []),
        }
    except Exception as e:
        # Return basic info on error
        return {
            "id": video_id,
            "title": "Error fetching details",
            "description": str(e),
            "thumbnail": "",
            "author": "",
            "created_time": "",
            "duration": "",
            "url": platform_url,
            "view_count": None,
            "tags": None,
        }


async def _scan_ytdlp_detailed(url: str, max_videos: int = 10) -> Dict[str, Any]:
    """Detailed scan using yt-dlp with concurrent threads.
    
    First performs a fast scan to get video IDs, then fetches detailed info
    for each video concurrently using 10 threads.
    
    Args:
        url: Channel/playlist URL
        max_videos: Maximum number of videos to process
    """
    # First, do a fast scan to get the list of video IDs
    fast_result = await _scan_ytdlp_fast(url, max_videos)
    videos_basic = fast_result["videos"]
    
    # Now fetch detailed information concurrently
    detailed_videos = []
    
    # Use ThreadPoolExecutor to fetch details concurrently (10 threads)
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        # Create futures for each video
        future_to_video = {
            executor.submit(_fetch_video_details_sync, video["id"], video["url"]): video
            for video in videos_basic
        }
        
        # Wait for all futures to complete
        for future in concurrent.futures.as_completed(future_to_video):
            try:
                detailed_info = future.result()
                detailed_videos.append(detailed_info)
            except Exception as e:
                # If a video fails, use basic info
                video = future_to_video[future]
                detailed_videos.append(video)
    
    return {
        "status": "success",
        "videos": detailed_videos,
        "channel_info": fast_result["channel_info"],
        "mode": "detailed",
    }


def _fetch_video_details_sync(video_id: str, platform_url: str) -> Dict[str, Any]:
    """Synchronous wrapper for _fetch_video_details for use with ThreadPoolExecutor."""
    import asyncio
    
    # Create a new event loop for this thread
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(_fetch_video_details(video_id, platform_url))
    finally:
        loop.close()


# Keep old functions for backward compatibility during transition
async def _scan_youtube_channel(url: str, max_videos: int) -> Dict[str, Any]:
    """Legacy function - redirects to unified yt-dlp fast scan."""
    return await _scan_ytdlp_fast(url, max_videos)


async def _scan_bilibili_channel(url: str, max_videos: int) -> Dict[str, Any]:
    """Legacy function - redirects to unified yt-dlp fast scan."""
    return await _scan_ytdlp_fast(url, max_videos)


async def _download_video_task(download_id: str, data: DownloadRequest) -> None:
    """Background task to download a video."""
    try:
        # Update status to downloading
        db.update_download_status(download_id, "downloading", progress=0)
        
        # Determine output path
        from app.core.database import db as db_instance
        data_dir = db_instance._data_root / data.project_id / "files"
        data_dir.mkdir(parents=True, exist_ok=True)
        
        if data.type == "douyin":
            video_path = await _download_douyin_video(data.url, data_dir, download_id)
        else:
            # Use unified yt-dlp download for all other platforms (youtube, bilibili, etc.)
            video_path = await _download_ytdlp_video(data.url, data_dir, download_id)
        
        # Read video file and save to database
        with open(video_path, "rb") as f:
            video_data = f.read()
        
        file_id = f"{data.video_id}-{dt.datetime.utcnow().timestamp()}"
        created_at = dt.datetime.utcnow().isoformat()
        
        storage_path, file_size = db.save_file(
            file_id=file_id,
            project_id=data.project_id,
            filename=video_path.name,
            content_type="video/mp4",
            data=video_data,
            created_at=created_at,
        )
        
        # Update download status to completed
        db.update_download_status(
            download_id,
            "completed",
            progress=100,
            video_info={
                "file_id": file_id,
                "filename": video_path.name,
                "size": file_size,
                "path": str(storage_path),
            },
        )
        
        # Mark video as downloaded in scanned_videos table
        db.mark_video_downloaded(data.video_id, True)
    except Exception as e:
        # Update status to failed
        db.update_download_status(
            download_id,
            "failed",
            message=str(e),
        )


async def _download_douyin_video(url: str, output_dir: Path, download_id: str) -> Path:
    """Download a Douyin video."""
    # Use requests to download the video directly
    # First, get the video URL from the douyin script
    douyin_script = Path(__file__).parent.parent / "download" / "douyin" / "main.py"
    douyin_dir = douyin_script.parent
    
    result = subprocess.run(
        [sys.executable, str(douyin_script), "--url", url, "--cookie-file", "cookies.txt"],
        capture_output=True,
        text=True,
        timeout=60,
        cwd=str(douyin_dir),  # Run in douyin directory for cookie access
    )
    
    if result.returncode != 0:
        raise RuntimeError(f"Failed to get Douyin video info: {result.stderr}")
    
    data = json.loads(result.stdout)
    
    # Extract video URL
    video_url = None
    if "video" in data:
        video_url = data["video"].get("best_play")
    elif "videos" in data and len(data["videos"]) > 0:
        video_url = data["videos"][0].get("best_play")
    
    if not video_url:
        raise RuntimeError("Could not find video URL in response")
    
    # Download the video
    import requests
    response = requests.get(video_url, stream=True, timeout=300)
    response.raise_for_status()
    
    # Save to file
    output_path = output_dir / f"douyin-{download_id}.mp4"
    with open(output_path, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)
    
    return output_path


async def _download_ytdlp_video(url: str, output_dir: Path, download_id: str) -> Path:
    """Unified download function using yt-dlp for YouTube, Bilibili, and other platforms."""
    yt_dlp_cmd = _get_ytdlp_command()
    
    output_template = str(output_dir / f"video-{download_id}.%(ext)s")
    
    if yt_dlp_cmd:
        cmd = [
            yt_dlp_cmd,
            "-f", "best[ext=mp4]/best",
            "-o", output_template,
            url,
        ]
    else:
        # Use python module as fallback
        cmd = [
            sys.executable, "-m", "yt_dlp",
            "-f", "best[ext=mp4]/best",
            "-o", output_template,
            url,
        ]
    
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=600,
    )
    
    if result.returncode != 0:
        raise RuntimeError(f"Video download failed: {result.stderr}")
    
    # Find the downloaded file
    downloaded_files = list(output_dir.glob(f"video-{download_id}.*"))
    if not downloaded_files:
        raise RuntimeError("Downloaded file not found")
    
    return downloaded_files[0]


# Legacy functions for backward compatibility
async def _download_youtube_video(url: str, output_dir: Path, download_id: str) -> Path:
    """Legacy function - redirects to unified yt-dlp download."""
    return await _download_ytdlp_video(url, output_dir, download_id)


async def _download_bilibili_video(url: str, output_dir: Path, download_id: str) -> Path:
    """Legacy function - redirects to unified yt-dlp download."""
    return await _download_ytdlp_video(url, output_dir, download_id)

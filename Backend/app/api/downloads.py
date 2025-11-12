from __future__ import annotations

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
    type: str  # 'douyin', 'youtube', or 'bilibili'
    max_videos: int = 30


class ScannedVideo(BaseModel):
    id: str
    title: str
    description: Optional[str] = ""  # Can be None
    thumbnail: Optional[str] = ""  # Can be None
    author: Optional[str] = ""  # Can be None
    created_time: Optional[str] = ""  # Can be None
    duration: Optional[str] = None
    url: str
    downloaded: bool = False  # Track if video has been downloaded


class ScanResponse(BaseModel):
    status: str
    videos: List[ScannedVideo]
    channel_info: Dict[str, Any]


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
    """Scan a channel/user URL and return video information."""
    try:
        if data.type == "douyin":
            result = await _scan_douyin_channel(data.url, data.max_videos)
        elif data.type == "youtube":
            result = await _scan_youtube_channel(data.url, data.max_videos)
        elif data.type == "bilibili":
            result = await _scan_bilibili_channel(data.url, data.max_videos)
        else:
            raise HTTPException(status_code=400, detail="Invalid type. Must be 'douyin', 'youtube', or 'bilibili'")
        
        # Save scanned videos to database and check download status
        for video in result["videos"]:
            db.save_scanned_video(video)
            # Check if this video was previously downloaded
            video["downloaded"] = db.get_video_download_status(video["id"])
        
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
        }
    except Exception as e:
        raise RuntimeError(f"Failed to scan Douyin channel: {str(e)}")


async def _scan_youtube_channel(url: str, max_videos: int) -> Dict[str, Any]:
    """Scan a YouTube channel using yt-dlp."""
    import platform
    import shutil
    
    # Determine which yt-dlp to use based on platform
    if platform.system() == "Windows":
        yt_dlp_path = Path(__file__).parent.parent / "download" / "yt-dlp.exe"
        yt_dlp_cmd = str(yt_dlp_path)
    else:
        # On Linux/Mac, try to use yt-dlp from PATH
        yt_dlp_cmd = shutil.which("yt-dlp")
        if not yt_dlp_cmd:
            # Try python -m yt_dlp as fallback
            yt_dlp_cmd = None
    
    try:
        # Use yt-dlp with --print to get video info efficiently
        # Format: id\ttitle\tthumbnail_url (tab-separated)
        if yt_dlp_cmd:
            cmd = [
                yt_dlp_cmd,
                "--flat-playlist",
                "--extractor-args", "youtube:tab=videos",
                "--print", "%(id)s\t%(title)s\t%(thumbnails.-1.url)s\t%(uploader)s\t%(channel_id)s",
                "--playlist-end", str(max_videos),
                "--no-warnings",
                url,
            ]
        else:
            # Use python module as fallback
            cmd = [
                sys.executable, "-m", "yt_dlp",
                "--flat-playlist",
                "--extractor-args", "youtube:tab=videos",
                "--print", "%(id)s\t%(title)s\t%(thumbnails.-1.url)s\t%(uploader)s\t%(channel_id)s",
                "--playlist-end", str(max_videos),
                "--no-warnings",
                url,
            ]
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=180,
        )
        
        if result.returncode != 0:
            raise RuntimeError(f"YouTube scan failed: {result.stderr}")
        
        # Parse tab-separated output (one video per line)
        videos = []
        channel_info = {"name": "Unknown", "id": "", "total_videos": 0}
        
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            try:
                # Split by tab: id, title, thumbnail, uploader, channel_id
                parts = line.split("\t")
                if len(parts) >= 3:
                    video_id = parts[0]
                    title = parts[1]
                    thumbnail = parts[2] if len(parts) > 2 and parts[2] != "NA" else ""
                    author = parts[3] if len(parts) > 3 and parts[3] != "NA" else "Unknown"
                    channel_id = parts[4] if len(parts) > 4 and parts[4] != "NA" else ""
                    
                    videos.append({
                        "id": video_id,
                        "title": title,
                        "description": "",
                        "thumbnail": thumbnail,
                        "author": author,
                        "created_time": "",
                        "duration": "",
                        "url": f"https://youtube.com/watch?v={video_id}",
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
        }
    except Exception as e:
        raise RuntimeError(f"Failed to scan YouTube channel: {str(e)}")


async def _scan_bilibili_channel(url: str, max_videos: int) -> Dict[str, Any]:
    """Scan a Bilibili channel using yt-dlp."""
    import platform
    import shutil
    
    # Determine which yt-dlp to use based on platform
    if platform.system() == "Windows":
        yt_dlp_path = Path(__file__).parent.parent / "download" / "yt-dlp.exe"
        yt_dlp_cmd = str(yt_dlp_path)
    else:
        # On Linux/Mac, try to use yt-dlp from PATH
        yt_dlp_cmd = shutil.which("yt-dlp")
        if not yt_dlp_cmd:
            # Try python -m yt_dlp as fallback
            yt_dlp_cmd = None
    
    try:
        # Use yt-dlp with JSON output for more reliable parsing
        if yt_dlp_cmd:
            cmd = [
                yt_dlp_cmd,
                "--flat-playlist",
                "--dump-single-json",
                "--playlist-end", str(max_videos),
                "--no-warnings",
                url,
            ]
        else:
            # Use python module as fallback
            cmd = [
                sys.executable, "-m", "yt_dlp",
                "--flat-playlist",
                "--dump-single-json",
                "--playlist-end", str(max_videos),
                "--no-warnings",
                url,
            ]
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=180,
        )
        
        if result.returncode != 0:
            raise RuntimeError(f"Bilibili scan failed: {result.stderr}")
        
        # Parse JSON output
        data = json.loads(result.stdout)
        videos = []
        channel_info = {"name": "Unknown", "id": "", "total_videos": 0}
        
        # Extract channel info
        if "uploader" in data:
            channel_info["name"] = data.get("uploader", "Unknown")
            channel_info["id"] = data.get("uploader_id", "")
            channel_info["total_videos"] = data.get("playlist_count", 0)
        
        # Extract video entries
        entries = data.get("entries", [])
        for entry in entries:
            if not entry:
                continue
            
            video_id = entry.get("id", "")
            title = entry.get("title", "No title")
            
            # Get thumbnail - try multiple fields
            thumbnail = ""
            if "thumbnail" in entry:
                thumbnail = entry["thumbnail"]
            elif "thumbnails" in entry and entry["thumbnails"]:
                thumbnail = entry["thumbnails"][-1].get("url", "")
            
            author = entry.get("uploader", channel_info["name"])
            uploader_id = entry.get("uploader_id", channel_info["id"])
            
            videos.append({
                "id": video_id,
                "title": title,
                "description": entry.get("description", ""),
                "thumbnail": thumbnail,
                "author": author,
                "created_time": "",
                "duration": str(entry.get("duration", "")) if entry.get("duration") else "",
                "url": entry.get("url", f"https://www.bilibili.com/video/{video_id}"),
            })
        
        return {
            "status": "success",
            "videos": videos,
            "channel_info": channel_info,
        }
    except Exception as e:
        raise RuntimeError(f"Failed to scan Bilibili channel: {str(e)}")


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
        elif data.type == "youtube":
            video_path = await _download_youtube_video(data.url, data_dir, download_id)
        elif data.type == "bilibili":
            video_path = await _download_bilibili_video(data.url, data_dir, download_id)
        else:
            raise ValueError(f"Invalid download type: {data.type}")
        
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


async def _download_youtube_video(url: str, output_dir: Path, download_id: str) -> Path:
    """Download a YouTube video using yt-dlp."""
    import platform
    import shutil
    
    # Determine which yt-dlp to use based on platform
    if platform.system() == "Windows":
        yt_dlp_path = Path(__file__).parent.parent / "download" / "yt-dlp.exe"
        yt_dlp_cmd = str(yt_dlp_path)
    else:
        # On Linux/Mac, try to use yt-dlp from PATH
        yt_dlp_cmd = shutil.which("yt-dlp")
        if not yt_dlp_cmd:
            # Try python -m yt_dlp as fallback
            yt_dlp_cmd = None
    
    output_template = str(output_dir / f"youtube-{download_id}.%(ext)s")
    
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
        raise RuntimeError(f"YouTube download failed: {result.stderr}")
    
    # Find the downloaded file
    downloaded_files = list(output_dir.glob(f"youtube-{download_id}.*"))
    if not downloaded_files:
        raise RuntimeError("Downloaded file not found")
    
    return downloaded_files[0]


async def _download_bilibili_video(url: str, output_dir: Path, download_id: str) -> Path:
    """Download a Bilibili video using yt-dlp."""
    import platform
    import shutil
    
    # Determine which yt-dlp to use based on platform
    if platform.system() == "Windows":
        yt_dlp_path = Path(__file__).parent.parent / "download" / "yt-dlp.exe"
        yt_dlp_cmd = str(yt_dlp_path)
    else:
        # On Linux/Mac, try to use yt-dlp from PATH
        yt_dlp_cmd = shutil.which("yt-dlp")
        if not yt_dlp_cmd:
            # Try python -m yt_dlp as fallback
            yt_dlp_cmd = None
    
    output_template = str(output_dir / f"bilibili-{download_id}.%(ext)s")
    
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
        raise RuntimeError(f"Bilibili download failed: {result.stderr}")
    
    # Find the downloaded file
    downloaded_files = list(output_dir.glob(f"bilibili-{download_id}.*"))
    if not downloaded_files:
        raise RuntimeError("Downloaded file not found")
    
    return downloaded_files[0]

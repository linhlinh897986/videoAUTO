# Download Tab Feature

## Overview

The Download Tab feature allows users to download videos from Douyin and YouTube directly within the application. Downloaded videos are automatically added to the project's Files tab for immediate use.

## Features

### 1. Channel Management
- **Save Channel Lists**: Save frequently used channel URLs for quick access
- **Multiple Platforms**: Support for both Douyin and YouTube
- **Easy Access**: Saved channels appear in a sidebar for one-click loading

### 2. Video Scanning
- **Preview Before Download**: Scan channel URLs to see available videos
- **YouTube-like Grid**: Videos displayed with thumbnails, titles, and authors
- **Detailed Information**: View video metadata including creation date and duration

### 3. Video Downloads
- **One-Click Download**: Download videos with a single click
- **Progress Tracking**: Real-time progress updates during download
- **Status Indicators**: Visual feedback showing pending, downloading, or completed states
- **Auto-Import**: Downloaded videos automatically appear in the Files tab

### 4. Database Persistence
- **Scan History**: All scanned videos stored in database for quick access
- **Download History**: Track all downloads with status and metadata
- **Channel Lists**: Saved channels persist across sessions

## How to Use

### Scanning a Channel

1. **Select Platform**: Choose between Douyin or YouTube
2. **Enter URL**: Paste the channel or video URL
3. **Click Scan**: Click the "Quét" (Scan) button to fetch videos
4. **Browse Results**: View videos in the grid layout

### Downloading Videos

1. **Find Video**: Browse scanned videos in the grid
2. **Click Download**: Click "Tải xuống" (Download) button on desired video
3. **Monitor Progress**: Watch the progress indicator update
4. **Access File**: Once complete, find the video in the Files tab

### Managing Saved Channels

1. **Add Channel**: Click the "+" icon in the Saved Channels sidebar
2. **Fill Details**: Enter channel name, URL, and select platform type
3. **Save**: Click "Thêm" (Add) to save the channel
4. **Load Channel**: Click on any saved channel to load its videos
5. **Delete Channel**: Hover over a channel and click the trash icon

## Technical Details

### Backend Endpoints

- `GET /downloads/channels` - Get all saved channel lists
- `POST /downloads/channels` - Add a new channel
- `DELETE /downloads/channels/{channel_id}` - Delete a channel
- `POST /downloads/scan` - Scan a channel URL for videos
- `POST /downloads/download` - Start downloading a video
- `GET /downloads/download/{download_id}` - Get download status
- `GET /downloads/history` - Get download history

### Database Tables

1. **channel_lists**: Stores saved channel information
   - id, name, url, type, created_at

2. **scanned_videos**: Caches scanned video information
   - id, title, description, thumbnail, author, created_time, url

3. **download_status**: Tracks download progress and history
   - id, video_id, project_id, status, progress, message, video_info, url, type

### Integration

- **Douyin**: Uses `Backend/app/download/douyin/main.py` script
- **YouTube**: Uses `Backend/app/download/yt-dlp.exe` executable
- **File Storage**: Downloaded videos saved in project's files directory
- **Project Files**: Videos automatically added to project's files array

## Requirements

- Python 3.8+ with required packages (fastapi, requests, etc.)
- yt-dlp executable in `Backend/app/download/` directory
- Working Douyin scanning scripts
- Network access to Douyin and YouTube

## Troubleshooting

### Scan Fails
- Verify URL is valid and accessible
- Check network connectivity
- Ensure backend services are running

### Download Fails
- Check available disk space
- Verify write permissions to data directory
- Review backend logs for detailed error messages

### Videos Don't Appear in Files Tab
- Verify download completed successfully
- Check project refresh/reload
- Review browser console for errors

## Future Enhancements

Possible improvements for future versions:
- Batch download multiple videos
- Download quality selection
- Scheduled/background downloads
- Download speed limiting
- Proxy support
- Subtitle/caption downloads

# Quick Start Guide: Two-Mode Video Scanning

## Overview

The videoAUTO application now supports two scanning modes for efficiently retrieving video information from YouTube, Bilibili, and other platforms.

## Two Modes

### 🚀 Fast Mode (Quick Preview)
- Returns basic info in seconds
- Shows: video ID, title, URL, author
- Perfect for: Checking new videos, quick browsing
- Default: 10 videos

### 📊 Detailed Mode (Complete Information)
- Returns full metadata
- Shows: All basic info + description, view count, tags, duration, upload date
- Uses: 10 concurrent threads for speed
- Perfect for: Data collection, detailed analysis

## How to Use

### Option 1: API Endpoints

#### Fast Mode
```bash
POST /downloads/scan
Content-Type: application/json

{
    "url": "https://www.youtube.com/channel/UCxxxxxx",
    "type": "other",
    "mode": "fast",
    "max_videos": 10
}
```

#### Detailed Mode
```bash
POST /downloads/scan
Content-Type: application/json

{
    "url": "https://www.youtube.com/channel/UCxxxxxx",
    "type": "other",
    "mode": "detailed",
    "max_videos": 10
}
```

### Option 2: Frontend Service

```typescript
import { scanChannel } from '@/services/downloadService';

// Fast mode (default)
const result = await scanChannel(
    'https://www.youtube.com/channel/UCxxxxxx',
    'youtube',  // or 'bilibili'
    'fast',     // mode
    10          // max videos
);

// Detailed mode
const detailedResult = await scanChannel(
    'https://www.youtube.com/channel/UCxxxxxx',
    'youtube',
    'detailed',
    10
);

// Access the data
console.log('Mode:', result.mode);
console.log('Videos:', result.videos);
result.videos.forEach(video => {
    console.log(video.title);
    console.log(video.view_count);  // Available in detailed mode
    console.log(video.tags);        // Available in detailed mode
});
```

## Smart Features

### Auto Full-Channel Scan

When you scan a channel in fast mode:
- If all 10 preview videos are NEW (not in database)
- System automatically fetches the FULL channel list
- All videos saved to database
- Returns complete list instead of just 10

**Example:**
```typescript
// You request 10 videos
const result = await scanChannel(url, 'youtube', 'fast', 10);

// If all 10 are new, you might get 100+ videos!
console.log(result.videos.length); // Could be 150+ videos
```

### Database Caching

All scanned videos are saved to database:
- ✅ No duplicate fetching
- ✅ Quick lookup for already-scanned videos
- ✅ Track download status
- ✅ Resume capability

## Response Format

### Fast Mode Response
```json
{
    "status": "success",
    "mode": "fast",
    "videos": [
        {
            "id": "dQw4w9WgXcQ",
            "title": "Video Title",
            "description": "",
            "thumbnail": "",
            "author": "Channel Name",
            "created_time": "",
            "duration": "",
            "url": "https://youtube.com/watch?v=dQw4w9WgXcQ",
            "view_count": null,
            "tags": null,
            "downloaded": false
        }
    ],
    "channel_info": {
        "name": "Channel Name",
        "id": "UCxxxxxx",
        "total_videos": 100
    }
}
```

### Detailed Mode Response
```json
{
    "status": "success",
    "mode": "detailed",
    "videos": [
        {
            "id": "dQw4w9WgXcQ",
            "title": "Rick Astley - Never Gonna Give You Up",
            "description": "The official video for...",
            "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
            "author": "Rick Astley",
            "created_time": "20091025",
            "duration": "213",
            "url": "https://youtube.com/watch?v=dQw4w9WgXcQ",
            "view_count": 1234567890,
            "tags": ["music", "pop", "80s"],
            "downloaded": false
        }
    ],
    "channel_info": {
        "name": "Rick Astley",
        "id": "UCxxxxxx",
        "total_videos": 50
    }
}
```

## Best Practices

### When to Use Fast Mode
- ✅ Quick channel preview
- ✅ Checking for new videos
- ✅ Building video lists
- ✅ Testing channel URLs

### When to Use Detailed Mode
- ✅ Need view counts for sorting
- ✅ Need tags for categorization
- ✅ Need full descriptions
- ✅ Data analysis purposes
- ✅ Complete metadata collection

### Workflow Recommendation

1. **First Visit:** Use fast mode to preview
2. **Check Database:** See which videos are new
3. **Get Details:** Use detailed mode only for videos you need
4. **Download:** Download selected videos

```typescript
// Step 1: Fast preview
const preview = await scanChannel(url, 'youtube', 'fast', 10);

// Step 2: Identify new videos
const newVideos = preview.videos.filter(v => !v.downloaded);

// Step 3: Get details only if needed
if (needsDetails) {
    const details = await scanChannel(url, 'youtube', 'detailed', 10);
    // Use detailed information
}

// Step 4: Download selected videos
await downloadVideo(selectedVideo.id, selectedVideo.url, projectId, 'youtube');
```

## Platform Support

### Supported Platforms
- ✅ YouTube
- ✅ Bilibili
- ✅ Any yt-dlp supported platform
- ✅ Douyin (uses separate optimized process)

### Type Mapping
Frontend uses specific types:
- `'youtube'` → Backend: `'other'`
- `'bilibili'` → Backend: `'other'`
- `'douyin'` → Backend: `'douyin'`

You don't need to worry about this - the service layer handles it automatically!

## Performance

### Fast Mode
- **Time:** 1-5 seconds
- **Network:** 1 API call
- **Data:** ~1 KB per video

### Detailed Mode
- **Time:** 10-60 seconds for 10 videos
- **Network:** 11 API calls (1 list + 10 details)
- **Concurrency:** 10 parallel requests
- **Data:** ~10-50 KB per video

### Comparison
| Feature | Fast | Detailed | Speedup |
|---------|------|----------|---------|
| 10 videos | 2s | 15s | 7.5x |
| Basic info | ✅ | ✅ | - |
| Full metadata | ❌ | ✅ | - |
| Concurrency | N/A | 10x | 10x |

## Troubleshooting

### "Scan too slow"
- ✅ Use fast mode first
- ✅ Reduce max_videos
- ✅ Check network speed

### "Missing metadata"
- ✅ Use detailed mode
- ✅ Check mode in response
- ✅ Verify video is accessible

### "Videos not appearing"
- ✅ Check database
- ✅ Verify scan completed
- ✅ Check response status

### "Error: Unable to download"
- ✅ Check URL is valid
- ✅ Verify network access
- ✅ Try again (may be temporary)

## Examples

### Example 1: Channel Preview
```typescript
// Quick preview of latest videos
const latest = await scanChannel(
    channelUrl,
    'youtube',
    'fast',
    5  // Just 5 videos
);

console.log(`Found ${latest.videos.length} videos`);
latest.videos.forEach(v => console.log(`- ${v.title}`));
```

### Example 2: Full Metadata Collection
```typescript
// Get complete info for top 20 videos
const fullData = await scanChannel(
    channelUrl,
    'youtube',
    'detailed',
    20
);

// Analyze data
const mostViewed = fullData.videos.sort((a, b) => 
    (b.view_count || 0) - (a.view_count || 0)
);

console.log('Most viewed:', mostViewed[0].title);
console.log('Views:', mostViewed[0].view_count);
```

### Example 3: Smart Scanning
```typescript
// Let smart logic handle it
const result = await scanChannel(
    channelUrl,
    'youtube',
    'fast',
    10
);

// If all 10 are new, system automatically fetched full channel!
if (result.videos.length > 10) {
    console.log('Got full channel!', result.videos.length, 'videos');
}
```

## More Information

- 📖 **Technical Details:** See `TWO_MODE_SCANNING.md`
- 📝 **Implementation:** See `IMPLEMENTATION_SUMMARY_TWO_MODE.md`
- 🔍 **API Reference:** See `Backend/app/api/downloads.py`

## Support

For issues or questions:
1. Check the documentation
2. Review error messages
3. Check network connectivity
4. Verify yt-dlp is installed

---

**Happy scanning! 🎥✨**

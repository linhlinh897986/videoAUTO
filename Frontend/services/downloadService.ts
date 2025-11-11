// Download service for managing video downloads from Douyin and YouTube

const API_BASE_URL = 'http://localhost:8000';

export interface ChannelItem {
    id: string;
    name: string;
    url: string;
    type: 'douyin' | 'youtube';
    created_at: string;
}

export interface ScannedVideo {
    id: string;
    title: string;
    description: string;
    thumbnail: string;
    author: string;
    created_time: string;
    duration?: string;
    url: string;
}

export interface ScanResult {
    status: string;
    videos: ScannedVideo[];
    channel_info: {
        name: string;
        id: string;
        total_videos: number;
    };
}

export interface DownloadStatus {
    id: string;
    status: 'pending' | 'downloading' | 'completed' | 'failed';
    progress?: number;
    message?: string;
    video_info?: {
        file_id: string;
        filename: string;
        size: number;
        path: string;
    };
}

/**
 * Get all saved channel lists
 */
export async function getChannelLists(): Promise<ChannelItem[]> {
    const response = await fetch(`${API_BASE_URL}/downloads/channels`);
    if (!response.ok) {
        throw new Error(`Failed to fetch channel lists: ${response.statusText}`);
    }
    const data = await response.json();
    return data.channels;
}

/**
 * Add a new channel to the saved list
 */
export async function addChannelList(name: string, url: string, type: 'douyin' | 'youtube'): Promise<ChannelItem> {
    const response = await fetch(`${API_BASE_URL}/downloads/channels`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, url, type }),
    });
    
    if (!response.ok) {
        throw new Error(`Failed to add channel: ${response.statusText}`);
    }
    
    return response.json();
}

/**
 * Delete a channel from the saved list
 */
export async function deleteChannelList(channelId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/downloads/channels/${channelId}`, {
        method: 'DELETE',
    });
    
    if (!response.ok) {
        throw new Error(`Failed to delete channel: ${response.statusText}`);
    }
}

/**
 * Scan a channel/user URL and get video list
 */
export async function scanChannel(url: string, type: 'douyin' | 'youtube', maxVideos: number = 30): Promise<ScanResult> {
    const response = await fetch(`${API_BASE_URL}/downloads/scan`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            url,
            type,
            max_videos: maxVideos,
        }),
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || `Failed to scan channel: ${response.statusText}`);
    }
    
    return response.json();
}

/**
 * Start downloading a video
 */
export async function downloadVideo(
    videoId: string,
    url: string,
    projectId: string,
    type: 'douyin' | 'youtube'
): Promise<{ status: string; download_id: string }> {
    const response = await fetch(`${API_BASE_URL}/downloads/download`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            video_id: videoId,
            url,
            project_id: projectId,
            type,
        }),
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || `Failed to start download: ${response.statusText}`);
    }
    
    return response.json();
}

/**
 * Get download status
 */
export async function getDownloadStatus(downloadId: string): Promise<DownloadStatus> {
    const response = await fetch(`${API_BASE_URL}/downloads/download/${downloadId}`);
    
    if (!response.ok) {
        throw new Error(`Failed to get download status: ${response.statusText}`);
    }
    
    return response.json();
}

/**
 * Get download history
 */
export async function getDownloadHistory(projectId?: string): Promise<DownloadStatus[]> {
    const url = projectId 
        ? `${API_BASE_URL}/downloads/history?project_id=${projectId}`
        : `${API_BASE_URL}/downloads/history`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
        throw new Error(`Failed to get download history: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.downloads;
}

/**
 * Poll download status until completion
 */
export async function pollDownloadStatus(
    downloadId: string,
    onProgress: (status: DownloadStatus) => void,
    intervalMs: number = 2000
): Promise<DownloadStatus> {
    return new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
            try {
                const status = await getDownloadStatus(downloadId);
                onProgress(status);
                
                if (status.status === 'completed' || status.status === 'failed') {
                    clearInterval(interval);
                    if (status.status === 'completed') {
                        resolve(status);
                    } else {
                        reject(new Error(status.message || 'Download failed'));
                    }
                }
            } catch (error) {
                clearInterval(interval);
                reject(error);
            }
        }, intervalMs);
    });
}

// Download service for managing video downloads from Douyin and YouTube

const rawBase = import.meta.env.VITE_API_BASE_URL ?? '';
const API_BASE_URL = rawBase ? rawBase.replace(/\/$/, '') : '';

/**
 * Helper function for JSON fetch with proper error handling
 */
const jsonFetch = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });

    if (!response.ok) {
        // Try to get error message from response
        let message = `Request to ${path} failed with status ${response.status}`;
        try {
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                const errorData = await response.json();
                message = errorData.detail || errorData.message || message;
            } else {
                const textMessage = await response.text();
                if (textMessage && !textMessage.startsWith('<!DOCTYPE') && !textMessage.startsWith('<html')) {
                    message = textMessage;
                }
            }
        } catch (e) {
            // If we can't parse the error, use the default message
        }
        throw new Error(message);
    }

    if (response.status === 204) {
        return undefined as T;
    }

    return (await response.json()) as T;
};

export interface ChannelItem {
    id: string;
    name: string;
    url: string;
    type: 'douyin' | 'youtube' | 'bilibili';
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
    const data = await jsonFetch<{ channels: ChannelItem[] }>('/downloads/channels');
    return data.channels;
}

/**
 * Add a new channel to the saved list
 */
export async function addChannelList(name: string, url: string, type: 'douyin' | 'youtube' | 'bilibili'): Promise<ChannelItem> {
    return jsonFetch<ChannelItem>('/downloads/channels', {
        method: 'POST',
        body: JSON.stringify({ name, url, type }),
    });
}

/**
 * Delete a channel from the saved list
 */
export async function deleteChannelList(channelId: string): Promise<void> {
    await jsonFetch<void>(`/downloads/channels/${channelId}`, {
        method: 'DELETE',
    });
}

/**
 * Scan a channel/user URL and get video list
 */
export async function scanChannel(url: string, type: 'douyin' | 'youtube' | 'bilibili', maxVideos: number = 30): Promise<ScanResult> {
    return jsonFetch<ScanResult>('/downloads/scan', {
        method: 'POST',
        body: JSON.stringify({
            url,
            type,
            max_videos: maxVideos,
        }),
    });
}

/**
 * Start downloading a video
 */
export async function downloadVideo(
    videoId: string,
    url: string,
    projectId: string,
    type: 'douyin' | 'youtube' | 'bilibili'
): Promise<{ status: string; download_id: string }> {
    return jsonFetch<{ status: string; download_id: string }>('/downloads/download', {
        method: 'POST',
        body: JSON.stringify({
            video_id: videoId,
            url,
            project_id: projectId,
            type,
        }),
    });
}

/**
 * Get download status
 */
export async function getDownloadStatus(downloadId: string): Promise<DownloadStatus> {
    return jsonFetch<DownloadStatus>(`/downloads/download/${downloadId}`);
}

/**
 * Get download history
 */
export async function getDownloadHistory(projectId?: string): Promise<DownloadStatus[]> {
    const url = projectId 
        ? `/downloads/history?project_id=${projectId}`
        : `/downloads/history`;
    
    const data = await jsonFetch<{ downloads: DownloadStatus[] }>(url);
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

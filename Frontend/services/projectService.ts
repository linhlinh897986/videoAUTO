import { Project, CustomStyle, ApiKey } from '../types';
import { encrypt, decrypt } from './encryptionService';

const rawBase = import.meta.env.VITE_API_BASE_URL ?? '';
const API_BASE_URL = rawBase ? rawBase.replace(/\/$/, '') : '';

const jsonFetch = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Request to ${path} failed with status ${response.status}`);
    }

    if (response.status === 204) {
        return undefined as T;
    }

    return (await response.json()) as T;
};

// --- FILE STORAGE HELPERS ---------------------------------------------------------
export interface FileUploadResult {
    path?: string;
    size?: number;
    created_at?: string;
}

export interface StoredFileMetadata {
    id: string;
    project_id?: string;
    filename: string;
    content_type?: string;
    created_at?: string;
    storage_path?: string;
    file_size?: number;
}

export type AsrMediaType = 'video' | 'audio';

export interface AsrGenerationItem {
    file_id?: string;
    file_name?: string;
    file_type?: AsrMediaType;
    source?: string;
    output?: string;
    srt_filename?: string;
    srt_content?: string;
    audio_file_id?: string | null;
    audio_file_name?: string | null;
    audio_source_type?: AsrMediaType | null;
    audio_converted_filename?: string | null;
    reason?: string;
    error?: string;
}

export interface GenerateMissingSrtsResponse {
    status: string;
    project_id: string;
    source_dir: string | null;
    output_dir: string | null;
    generated: AsrGenerationItem[];
    missing_sources: AsrGenerationItem[];
    skipped: AsrGenerationItem[];
    errors: AsrGenerationItem[];
}

export const saveVideo = async (
    projectId: string, 
    id: string, 
    file: File,
    onProgress?: (progress: number) => void
): Promise<FileUploadResult> => {
    const formData = new FormData();
    formData.append('file_id', id);
    formData.append('project_id', projectId);
    formData.append('file', file);

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        // Track upload progress
        if (onProgress) {
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const percentComplete = (e.loaded / e.total) * 100;
                    onProgress(percentComplete);
                }
            });
        }

        xhr.addEventListener('load', async () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const payload = JSON.parse(xhr.responseText);
                    resolve({
                        path: payload?.path ?? undefined,
                        size: payload?.size ?? undefined,
                        created_at: payload?.created_at ?? undefined,
                    });
                } catch (error) {
                    resolve({});
                }
            } else {
                reject(new Error(xhr.responseText || `Failed to upload file ${id}`));
            }
        });

        xhr.addEventListener('error', () => {
            reject(new Error(`Network error while uploading file ${id}`));
        });

        xhr.addEventListener('abort', () => {
            reject(new Error(`Upload aborted for file ${id}`));
        });

        xhr.open('POST', `${API_BASE_URL}/files`);
        xhr.send(formData);
    });
};

export const getVideoUrl = async (id: string): Promise<string | null> => {
    // Properly encode the file ID to handle special characters (Chinese, spaces, hashtags, etc.)
    const encodedId = encodeURIComponent(id);
    const response = await fetch(`${API_BASE_URL}/files/${encodedId}`);
    if (response.status === 404) {
        return null;
    }

    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Failed to load file ${id}`);
    }

    const blob = await response.blob();
    return URL.createObjectURL(blob);
};

// Alias for getVideoUrl - works for any file type (video, audio, etc.)
export const getFileUrl = getVideoUrl;

export const deleteVideo = async (id: string): Promise<void> => {
    // Properly encode the file ID to handle special characters
    const encodedId = encodeURIComponent(id);
    const response = await fetch(`${API_BASE_URL}/files/${encodedId}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
        const message = await response.text();
        throw new Error(message || `Failed to delete file ${id}`);
    }
};

export const getStoredFileInfo = async (id: string): Promise<StoredFileMetadata | null> => {
    // Properly encode the file ID to handle special characters
    const encodedId = encodeURIComponent(id);
    const response = await fetch(`${API_BASE_URL}/files/${encodedId}/info`);
    if (response.status === 404) {
        return null;
    }
    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Failed to retrieve metadata for file ${id}`);
    }
    return (await response.json()) as StoredFileMetadata;
};

export const generateMissingSrtsFromAsr = async (projectId: string): Promise<GenerateMissingSrtsResponse> => {
    const response = await fetch(`${API_BASE_URL}/projects/${projectId}/asr/generate-missing`, {
        method: 'POST',
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Không thể tạo phụ đề từ ASR');
    }

    return (await response.json()) as GenerateMissingSrtsResponse;
};

// --- DATA ABSTRACTION LAYER (PUBLIC API) ------------------------------------------
export const init = async (): Promise<{ projects: Project[], apiKeys: ApiKey[], customStyles: CustomStyle[] }> => {
    const [projects, encryptedKeys, customStyles] = await Promise.all([
        jsonFetch<Project[]>('/projects'),
        jsonFetch<ApiKey[]>('/api-keys'),
        jsonFetch<CustomStyle[]>('/custom-styles'),
    ]);

    const decryptedKeys = encryptedKeys.map(key => ({ ...key, value: decrypt(key.value) }));
    return { projects, apiKeys: decryptedKeys, customStyles };
};

export const saveProject = async (project: Project): Promise<void> => {
    await jsonFetch(`/projects/${project.id}`, {
        method: 'PUT',
        body: JSON.stringify(project),
    });
};

export const deleteProject = async (projectId: string): Promise<void> => {
    await jsonFetch(`/projects/${projectId}`, { method: 'DELETE' });
};

export const saveApiKeys = async (keys: ApiKey[]): Promise<void> => {
    const encryptedKeys = keys.map(key => ({ ...key, value: encrypt(key.value) }));
    await jsonFetch('/api-keys', {
        method: 'PUT',
        body: JSON.stringify(encryptedKeys),
    });
};

export const getApiKeys = async (): Promise<ApiKey[]> => {
    const encryptedKeys = await jsonFetch<ApiKey[]>('/api-keys');
    return encryptedKeys.map(key => ({ ...key, value: decrypt(key.value) }));
};

export const saveCustomStyles = async (styles: CustomStyle[]): Promise<void> => {
    await jsonFetch('/custom-styles', {
        method: 'PUT',
        body: JSON.stringify(styles),
    });
};

// --- VIDEO AUTO-IMPORT ---------------------------------------------------------
export interface VideoInFolder {
    filename: string;
    path: string;
    size: number;
}

export interface ScanVideoFolderResponse {
    status: string;
    videos: VideoInFolder[];
    folder: string;
    count: number;
    message?: string;
}

export interface ImportedVideo {
    file_id: string;
    filename: string;
    storage_path: string;
    file_size: number;
    created_at: string;
}

export interface ImportVideosResponse {
    status: string;
    project_id: string;
    imported: ImportedVideo[];
    errors: Array<{ filename: string; error: string }>;
    count: number;
    message?: string;
}

export const scanVideoFolder = async (projectId: string): Promise<ScanVideoFolderResponse> => {
    return await jsonFetch<ScanVideoFolderResponse>(`/projects/${projectId}/videos/scan-folder`);
};

export const importVideosFromFolder = async (projectId: string): Promise<ImportVideosResponse> => {
    return await jsonFetch<ImportVideosResponse>(`/projects/${projectId}/videos/import-from-folder`, {
        method: 'POST',
    });
};

import { SubtitleBlock } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

export interface TTSVoice {
    name: string;
    id: string;
}

export interface TTSGenerationResult {
    file_id: string;
    filename: string;
    subtitle_id: number;
    text: string;
    duration: number;
    track: number;
    start_time: number;
    storage_path: string;
    file_size: number;
    created_at: string;
}

export interface TTSBatchResponse {
    status: string;
    project_id: string;
    generated: TTSGenerationResult[];
    errors: Array<{ subtitle_id: number; error: string }>;
    voice: string;
}

export const listTTSVoices = async (): Promise<TTSVoice[]> => {
    const response = await fetch(`${API_BASE_URL}/tts/voices`);
    if (!response.ok) {
        throw new Error('Failed to fetch TTS voices');
    }
    return await response.json();
};

export const generateBatchTTS = async (
    projectId: string,
    subtitles: SubtitleBlock[],
    voice: string,
    sessionId?: string
): Promise<TTSBatchResponse> => {
    const response = await fetch(`${API_BASE_URL}/projects/${projectId}/tts/batch`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            subtitles: subtitles.map(sub => ({
                id: sub.id,
                text: sub.text,
                startTime: sub.startTime,
                endTime: sub.endTime,
            })),
            voice,
            session_id: sessionId,
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(error || 'Failed to generate TTS');
    }

    return await response.json();
};

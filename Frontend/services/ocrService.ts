import { BoundingBox } from '../types';

const rawBase = import.meta.env.VITE_API_BASE_URL ?? '';
const API_BASE_URL = rawBase ? rawBase.replace(/\/$/, '') : '';

export interface OCRAnalysisRequest {
    video_file_id: string;
    num_samples?: number;
    language?: string;
}

export interface OCRAnalysisResponse {
    status: 'success' | 'error';
    message: string;
    detected: boolean;
    frames_analyzed?: number;
    successful_frames?: number;
    failed_frames?: number;
    tesseract_error?: boolean;
    bounding_box?: BoundingBox;
}

/**
 * Analyze a video for hardcoded subtitles using backend OCR.
 * 
 * @param projectId - The project ID
 * @param videoId - The video file ID
 * @param options - Optional configuration for analysis
 * @returns Promise with analysis results including bounding box if detected
 */
export const analyzeHardcodedSubtitles = async (
    projectId: string,
    videoId: string,
    options: {
        numSamples?: number;
        language?: string;
    } = {}
): Promise<OCRAnalysisResponse> => {
    const requestBody: OCRAnalysisRequest = {
        video_file_id: videoId,
        num_samples: options.numSamples ?? 20,
        language: options.language ?? 'chi_sim',
    };

    const response = await fetch(
        `${API_BASE_URL}/projects/${projectId}/videos/${videoId}/analyze-hardsubs`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        }
    );

    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `OCR analysis failed with status ${response.status}`);
    }

    return (await response.json()) as OCRAnalysisResponse;
};

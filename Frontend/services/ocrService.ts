import { BoundingBox } from '../types';

const rawBase = import.meta.env.VITE_API_BASE_URL ?? '';
const API_BASE_URL = rawBase ? rawBase.replace(/\/$/, '') : '';

export interface OCRAnalysisRequest {
    video_file_id: string;
    num_samples?: number;
    language?: string;
    max_workers?: number;
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
 * Uses parallel processing for faster analysis.
 * 
 * @param projectId - The project ID
 * @param videoId - The video file ID
 * @param options - Optional configuration for analysis
 * @param options.numSamples - Number of frames to sample (default: 20)
 * @param options.language - Tesseract language code (default: 'chi_sim')
 * @param options.maxWorkers - Number of parallel OCR workers (default: 4)
 * @returns Promise with analysis results including bounding box if detected
 */
export const analyzeHardcodedSubtitles = async (
    projectId: string,
    videoId: string,
    options: {
        numSamples?: number;
        language?: string;
        maxWorkers?: number;
    } = {}
): Promise<OCRAnalysisResponse> => {
    const requestBody: OCRAnalysisRequest = {
        video_file_id: videoId,
        num_samples: options.numSamples ?? 20,
        language: options.language ?? 'chi_sim',
        max_workers: options.maxWorkers ?? 4,
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

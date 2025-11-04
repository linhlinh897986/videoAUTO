import Tesseract from 'tesseract.js';
import { BoundingBox } from '../types';

// --- WAVEFORM GENERATION & CACHING ---

let audioContext: AudioContext | null = null;
const audioBufferCache = new Map<string, Promise<AudioBuffer>>();

export const preloadAudioBuffer = (videoUrl: string): Promise<AudioBuffer> => {
    if (!audioContext) {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioBufferCache.has(videoUrl)) {
        return audioBufferCache.get(videoUrl)!;
    }

    const promise = fetch(videoUrl)
        .then(response => response.arrayBuffer())
        .then(arrayBuffer => audioContext!.decodeAudioData(arrayBuffer));
    
    audioBufferCache.set(videoUrl, promise);
    return promise;
};


// --- HARDSUB ANALYSIS ---

export const analyzeVideoForHardsubs = async (
    videoUrl: string,
    onProgress?: (progress: number) => void
): Promise<BoundingBox | null> => {
    
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = videoUrl;

    await new Promise(resolve => {
        video.onloadedmetadata = resolve;
    });

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
     if (!ctx) {
        console.error("Không thể tạo context 2D cho canvas");
        return null;
    }

    let worker: Tesseract.Worker | null = null;
    try {
        onProgress?.(0);
        worker = await Tesseract.createWorker('chi_sim', 1);

        const allBBoxes: Tesseract.Bbox[] = [];
        const NUM_SAMPLES = 20;
        const sampleInterval = video.duration / (NUM_SAMPLES + 1);

        for (let i = 1; i <= NUM_SAMPLES; i++) {
            const sampleTime = i * sampleInterval;
            video.currentTime = sampleTime;
            await new Promise(resolve => { video.onseeked = resolve; });
            
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const { data } = await worker.recognize(canvas);
            
            data.lines.forEach(line => {
                if (line.confidence > 60 && line.bbox.y0 > canvas.height * 0.7) {
                    allBBoxes.push(line.bbox);
                }
            });
            onProgress?.(i / NUM_SAMPLES);
        }

        if (allBBoxes.length > 0) {
            let minX = canvas.width, maxX = 0, maxY = 0;
            allBBoxes.forEach(box => {
                minX = Math.min(minX, box.x0);
                maxX = Math.max(maxX, box.x1);
                maxY = Math.max(maxY, box.y1);
            });
            
            const heights = allBBoxes.map(b => b.y1 - b.y0).sort((a, b) => a - b);
            const medianHeight = heights[Math.floor(heights.length / 2)] || 20;
            const newMinY = maxY - (medianHeight * 2.5);
            const PADDING_Y = 0.5;
            const PADDING_X = 1.0;

            return {
                x: Math.max(0, (minX / canvas.width) * 100 - PADDING_X),
                y: Math.max(0, (newMinY / canvas.height) * 100 - PADDING_Y),
                width: Math.min(100, ((maxX - minX) / canvas.width) * 100 + 2 * PADDING_X),
                height: Math.min(100, ((maxY - newMinY) / canvas.height) * 100 + 2 * PADDING_Y),
                enabled: true,
            };
        }
        return null;
    } catch (error) {
        console.error("Lỗi khi phân tích hardsub:", error);
        return null;
    } finally {
        await worker?.terminate();
        video.remove();
        canvas.remove();
    }
};

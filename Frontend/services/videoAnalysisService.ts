// --- WAVEFORM GENERATION & CACHING ---

let audioContext: AudioContext | null = null;
const audioBufferCache = new Map<string, Promise<AudioBuffer>>();

export const preloadAudioBuffer = async (videoUrl: string): Promise<AudioBuffer> => {
    if (!audioContext) {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioBufferCache.has(videoUrl)) {
        return audioBufferCache.get(videoUrl)!;
    }

    const promise = (async () => {
        try {
            // First, try to get the Content-Length header to check file size
            const headResponse = await fetch(videoUrl, { method: 'HEAD' });
            const contentLength = headResponse.headers.get('Content-Length');
            const fileSizeMB = contentLength ? parseInt(contentLength) / (1024 * 1024) : 0;

            // For large files (> 500MB), skip waveform generation to avoid memory issues
            // The user can still edit the video, just without the waveform visualization
            if (fileSizeMB > 500) {
                console.warn(`Video file is ${fileSizeMB.toFixed(0)}MB, skipping waveform generation for performance`);
                throw new Error('File too large for waveform generation');
            }

            // For smaller files, proceed with normal waveform generation
            const response = await fetch(videoUrl);
            const arrayBuffer = await response.arrayBuffer();
            return await audioContext!.decodeAudioData(arrayBuffer);
        } catch (error) {
            console.error('Failed to generate waveform:', error);
            // Return a minimal empty audio buffer as fallback
            // This allows the editor to work without waveform
            const emptyBuffer = audioContext!.createBuffer(2, audioContext!.sampleRate, audioContext!.sampleRate);
            return emptyBuffer;
        }
    })();
    
    audioBufferCache.set(videoUrl, promise);
    return promise;
};

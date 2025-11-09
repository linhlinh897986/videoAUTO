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

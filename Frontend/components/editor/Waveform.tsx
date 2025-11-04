import React, { useEffect, useRef, useState, useMemo } from 'react';
import { LoadingSpinner } from '../ui/Icons';
import { preloadAudioBuffer } from '../../services/videoAnalysisService';

interface WaveformProps {
    videoUrl: string | null;
    sourceStartTime: number;
    sourceEndTime: number;
}

// Function to process audio buffer and extract peak data as mono
const getPeakData = (buffer: AudioBuffer, width: number, startSample: number, endSample: number): number[][] => {
    const numChannels = buffer.numberOfChannels;
    const channelData = Array.from({ length: numChannels }, (_, i) => buffer.getChannelData(i));
    const peaks: number[][] = []; // Now will be array of [min, max]
    const totalSamples = endSample - startSample;
    const samplesPerPixel = Math.floor(totalSamples / width);

    if (samplesPerPixel <= 0) return [];

    for (let i = 0; i < width; i++) {
        const start = startSample + (i * samplesPerPixel);
        const end = start + samplesPerPixel;
        let min = 0;
        let max = 0;

        for (let j = start; j < end; j++) {
            let sample = 0;
            for (let chan = 0; chan < numChannels; chan++) {
                sample += channelData[chan]?.[j] || 0;
            }
            sample /= numChannels; // Average the channels

            if (sample < min) min = sample;
            if (sample > max) max = sample;
        }
        peaks.push([min, max]);
    }
    return peaks;
};


const useAudioBufferSegment = (videoUrl: string | null) => {
    const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!videoUrl) return;

        let isCancelled = false;
        const processAudio = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const buffer = await preloadAudioBuffer(videoUrl);
                if (!isCancelled) {
                    setAudioBuffer(buffer);
                }
            } catch (err) {
                 console.error("Error processing audio waveform:", err);
                if (!isCancelled) {
                    setError("Could not process audio waveform.");
                }
            } finally {
                if (!isCancelled) {
                    setIsLoading(false);
                }
            }
        };

        processAudio();
        
        return () => {
            isCancelled = true;
        };
    }, [videoUrl]);
    
    return { audioBuffer, isLoading, error };
};

const Waveform: React.FC<WaveformProps> = ({ videoUrl, sourceStartTime, sourceEndTime }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { audioBuffer, isLoading, error } = useAudioBufferSegment(videoUrl);
    const [width, setWidth] = useState(1000);

    useEffect(() => {
        const resizeObserver = new ResizeObserver(entries => {
            if (entries[0]) {
                setWidth(entries[0].contentRect.width);
            }
        });

        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }
        return () => resizeObserver.disconnect();
    }, []);

    const peakData = useMemo(() => {
        if (!audioBuffer) return null;
        const startSample = Math.floor(sourceStartTime * audioBuffer.sampleRate);
        const endSample = Math.floor(sourceEndTime * audioBuffer.sampleRate);
        return getPeakData(audioBuffer, width, startSample, endSample);
    }, [audioBuffer, width, sourceStartTime, sourceEndTime]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !peakData || !containerRef.current) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = containerRef.current.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, rect.width, rect.height);
        
        const channelHeight = rect.height;

        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(45, 212, 191, 0.7)`; // teal-400

        for (let i = 0; i < peakData.length; i++) {
            const minPeak = peakData[i][0];
            const maxPeak = peakData[i][1];
            const yCenter = channelHeight / 2;
            const yMin = yCenter + minPeak * (channelHeight / 2);
            const yMax = yCenter + maxPeak * (channelHeight / 2);
            
            ctx.beginPath();
            ctx.moveTo(i, yMin);
            ctx.lineTo(i, yMax);
            ctx.stroke();
        }

    }, [peakData, width]);

    return (
        <div ref={containerRef} className="relative w-full h-full">
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
            {isLoading && <div className="absolute inset-0 flex items-center justify-center"><LoadingSpinner className="w-6 h-6 text-gray-400" /><p className="ml-2 text-sm text-gray-400">Đang xử lý âm thanh...</p></div>}
            {error && <div className="absolute inset-0 flex items-center justify-center text-sm text-red-400">{error}</div>}
        </div>
    );
};

export default Waveform;

import React from 'react';
import { AudioFile } from '../../types';
import { InteractionHandlers } from '../../hooks/useTimelineInteraction';
import Waveform from './Waveform';
import { AudioWaveIcon } from '../ui/Icons';

interface AudioTrackItemProps {
    audioFile: AudioFile;
    audioUrl: string | null;
    timelineVisualDuration: number;
    timelineWidthPx: number;
    getInteractionHandlers: (type: 'audio', id: string) => InteractionHandlers;
    isSelected: boolean;
    onSelect: (id: string, e: React.MouseEvent) => void;
    adjustTimeForSegments: (sourceTime: number) => number;
}

const AudioTrackItem: React.FC<AudioTrackItemProps> = ({ audioFile, audioUrl, timelineVisualDuration, timelineWidthPx, getInteractionHandlers, isSelected, onSelect, adjustTimeForSegments }) => {
    const { duration = 0, startTime = 0, name } = audioFile;
    if (duration <= 0 || timelineVisualDuration <= 0) return null;
    
    // Adjust audio start position based on video segment playback rates (same as subtitles)
    const adjustedStartTime = adjustTimeForSegments(startTime);
    
    const leftPx = (adjustedStartTime / timelineVisualDuration) * timelineWidthPx;
    const widthPx = (duration / timelineVisualDuration) * timelineWidthPx;  // Keep original duration

    return (
        <div
            className={`audio-track-item absolute h-10 rounded border-2 flex items-center p-1 cursor-grab active:cursor-grabbing transition-colors pointer-events-auto ${
                isSelected 
                    ? 'bg-purple-700/90 border-purple-400 shadow-lg shadow-purple-500/20' 
                    : 'bg-purple-900/80 border-purple-700 hover:border-purple-500'
            }`}
            style={{ left: `${leftPx}px`, width: `${widthPx}px`, top: '4px' }}
            onClick={(e) => { e.stopPropagation(); onSelect(audioFile.id, e); }}
            onMouseDown={getInteractionHandlers('audio', audioFile.id).onMouseDown}
        >
            <div className="absolute inset-0 opacity-20 overflow-hidden rounded pointer-events-none">
                {audioUrl && duration > 0 && (
                    <Waveform
                        videoUrl={audioUrl}
                        sourceStartTime={0}
                        sourceEndTime={duration}
                    />
                )}
            </div>
            <AudioWaveIcon className="w-4 h-4 text-purple-300 mr-2 flex-shrink-0 z-10 pointer-events-none" />
            <p className="text-xs text-white truncate pointer-events-none z-10">{name}</p>
        </div>
    );
};

export default AudioTrackItem;

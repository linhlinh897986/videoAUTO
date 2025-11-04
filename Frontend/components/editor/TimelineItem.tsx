import React from 'react';
import { SubtitleBlock } from '../../types';
import { srtTimeToSeconds } from '../../services/srtParser';
import { InteractionHandlers } from '../../hooks/useTimelineInteraction';

interface TimelineItemProps {
    subtitle: SubtitleBlock;
    duration: number; // This is now scaledDuration
    getInteractionHandlers: (type: 'subtitle' | 'resize-start' | 'resize-end', id: number) => InteractionHandlers;
    isSelected: boolean;
    onSelect: (id: number, e: React.MouseEvent) => void;
}

const TimelineItem: React.FC<TimelineItemProps> = ({ subtitle, duration, getInteractionHandlers, isSelected, onSelect }) => {
    const start = srtTimeToSeconds(subtitle.startTime);
    const end = srtTimeToSeconds(subtitle.endTime);
    const left = (start / duration) * 100;
    const width = ((end - start) / duration) * 100;

    return (
        <div 
            className={`timeline-item absolute h-10 bg-yellow-900/80 rounded border-2 flex items-center justify-center p-1 cursor-grab active:cursor-grabbing transition-colors ${isSelected ? 'border-yellow-400 shadow-lg shadow-yellow-500/20' : 'border-yellow-700 hover:border-yellow-500'}`} 
            style={{ left: `${left}%`, width: `${width}%`, top: `4px`}} // 4px for vertical padding inside track
            onClick={(e) => { e.stopPropagation(); onSelect(subtitle.id, e); }}
            onMouseDown={getInteractionHandlers('subtitle', subtitle.id).onMouseDown}
        >
            <div 
                className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize"
                onMouseDown={getInteractionHandlers('resize-start', subtitle.id).onMouseDown}
            />
            <p className="text-xs text-white truncate pointer-events-none">{subtitle.text}</p>
             <div 
                className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize"
                onMouseDown={getInteractionHandlers('resize-end', subtitle.id).onMouseDown}
            />
        </div>
    );
};

export default TimelineItem;

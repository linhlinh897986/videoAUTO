import React from 'react';
import { SubtitleBlock } from '../../types';
import TimelineItem from './TimelineItem';
import { InteractionHandlers } from '../../hooks/useTimelineInteraction';
import { TRACK_HEIGHT } from '../../constants';

interface TrackProps {
    trackIndex: number;
    duration: number;
    timelineWidthPx: number;
    subtitles: SubtitleBlock[];
    getInteractionHandlers: (type: 'subtitle' | 'resize-start' | 'resize-end', id: number) => InteractionHandlers;
    selectedSubtitleIds: number[];
    onSelectSubtitle: (id: number, e: React.MouseEvent) => void;
    adjustTimeForSegments: (sourceTime: number) => number;
}

const Track: React.FC<TrackProps> = ({ trackIndex, duration, timelineWidthPx, subtitles, getInteractionHandlers, selectedSubtitleIds, onSelectSubtitle, adjustTimeForSegments }) => {
    return (
        <div 
            className="absolute w-full"
            style={{ 
                top: `${trackIndex * TRACK_HEIGHT}px`, 
                height: `${TRACK_HEIGHT}px`,
                borderBottom: '1px solid rgba(55, 65, 81, 0.5)' // border-gray-700/50
            }}
        >
            {subtitles.map(sub => (
                <TimelineItem 
                    key={sub.id}
                    subtitle={sub}
                    duration={duration}
                    timelineWidthPx={timelineWidthPx}
                    isSelected={selectedSubtitleIds.includes(sub.id)}
                    getInteractionHandlers={getInteractionHandlers}
                    onSelect={onSelectSubtitle}
                    adjustTimeForSegments={adjustTimeForSegments}
                />
            ))}
        </div>
    );
};

export default Track;

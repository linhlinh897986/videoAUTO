import React from 'react';
import { TRACK_HEIGHT } from '../../constants';

interface TrackHeaderProps {
    name: string;
    height?: number;
    controls?: React.ReactNode;
}

const TrackHeader: React.FC<TrackHeaderProps> = ({ name, height = TRACK_HEIGHT, controls }) => {
    return (
        <div 
            className="p-2 border-b border-gray-700/50 text-xs text-gray-300 flex items-center justify-between"
            style={{ height: `${height}px`, boxSizing: 'border-box' }}
        >
            <span>{name}</span>
            {controls && <div>{controls}</div>}
        </div>
    );
};

export default TrackHeader;
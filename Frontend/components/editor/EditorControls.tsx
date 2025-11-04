import React, { useMemo } from 'react';
import { PlayIcon, PauseIcon, SpeakerWaveIcon, SpeakerXMarkIcon, BackwardIcon, ForwardIcon, ZoomInIcon, ZoomOutIcon, TrimModeIcon, UndoIcon, RedoIcon } from '../ui/Icons';
import { VideoSegment } from '../../types';

interface EditorControlsProps {
    videoRef: React.RefObject<HTMLVideoElement>;
    isPlaying: boolean;
    onTogglePlayPause: () => void;
    currentTime: number;
    duration: number; // This is now unscaled source timeline duration
    selectedSegmentIds: string[];
    segments: VideoSegment[];
    onBatchUpdateSegments: (segmentIds: string[], updates: Partial<VideoSegment>) => void;
    zoom: number;
    setZoom: React.Dispatch<React.SetStateAction<number>>;
    onSplitItem: () => void;
    onUndo: () => void;
    onRedo: () => void;
    canUndo: boolean;
    canRedo: boolean;
}

const formatTime = (time: number) => {
    if (isNaN(time) || time < 0) return '00:00.000';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    const milliseconds = Math.floor((time % 1) * 1000);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
};

const EditorControls: React.FC<EditorControlsProps> = ({
    videoRef, isPlaying, onTogglePlayPause, currentTime, duration,
    selectedSegmentIds, segments, onBatchUpdateSegments,
    zoom, setZoom, onSplitItem, onUndo, onRedo, canUndo, canRedo
}) => {

    const firstSelectedSegment = useMemo(() => {
        if (selectedSegmentIds.length === 0) return null;
        return segments.find(s => s.id === selectedSegmentIds[0]);
    }, [segments, selectedSegmentIds]);

    const handleFrameStep = (direction: 'back' | 'forward') => {
        if (videoRef.current) {
            videoRef.current.pause();
            const frameTime = 1 / 30; // Assuming 30fps
            const newTime = videoRef.current.currentTime + (direction === 'forward' ? frameTime : -frameTime);
            videoRef.current.currentTime = Math.max(0, newTime);
        }
    };

    return (
        <div className="flex-shrink-0 mb-1 flex items-center justify-between bg-gray-800/60 p-1 rounded-md">
            {/* Left Controls */}
            <div className="flex items-center space-x-2">
                <button onClick={onUndo} disabled={!canUndo} className="text-white p-2 rounded hover:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed" aria-label="Hoàn tác" title="Hoàn tác (Ctrl+Z)">
                    <UndoIcon className="w-5 h-5"/>
                </button>
                <button onClick={onRedo} disabled={!canRedo} className="text-white p-2 rounded hover:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed" aria-label="Làm lại" title="Làm lại (Ctrl+Y)">
                    <RedoIcon className="w-5 h-5"/>
                </button>
                <button onClick={onSplitItem} className="text-white p-2 rounded hover:bg-gray-700" aria-label="Split Item" title="Cắt mục (Ctrl+B)">
                    <TrimModeIcon className="w-5 h-5"/>
                </button>
            </div>
            
            {/* Center Controls */}
             <div className="flex items-center space-x-2">
                <button onClick={() => handleFrameStep('back')} className="text-white p-1 rounded hover:bg-gray-700" aria-label="Lùi một khung hình">
                    <BackwardIcon className="w-5 h-5"/>
                </button>
                 <button onClick={onTogglePlayPause} className="text-white p-1 rounded hover:bg-gray-700" aria-label={isPlaying ? "Tạm dừng" : "Phát"}>
                    {isPlaying ? <PauseIcon className="w-6 h-6"/> : <PlayIcon className="w-6 h-6"/>}
                </button>
                 <button onClick={() => handleFrameStep('forward')} className="text-white p-1 rounded hover:bg-gray-700" aria-label="Tiến một khung hình">
                    <ForwardIcon className="w-5 h-5"/>
                </button>
                 <div className="font-mono text-sm text-gray-300">
                    <span className="text-white">{formatTime(currentTime)}</span> / <span>{formatTime(duration)}</span>
                </div>
            </div>


            {/* Right Controls */}
            <div className="flex items-center space-x-3 text-gray-400">
                 {/* Segment Controls */}
                 <div className="flex items-center space-x-2">
                    {firstSelectedSegment ? (
                        <>
                            <div className="flex items-center bg-gray-700 rounded" title="Âm lượng đoạn video">
                                <SpeakerWaveIcon className="w-4 h-4 ml-2 text-gray-400"/>
                                <input
                                    type="range" min="-60" max="6" step="0.5"
                                    value={firstSelectedSegment.volumeDb ?? 0}
                                    onChange={e => onBatchUpdateSegments(selectedSegmentIds, { volumeDb: parseFloat(e.target.value) })}
                                    className="w-20 mx-1 h-1 bg-gray-500 rounded-lg appearance-none cursor-pointer accent-indigo-400"
                                    aria-label="Âm lượng đoạn video"
                                />
                                <span className="text-xs font-mono w-14 text-center pr-1 text-gray-300">
                                    {selectedSegmentIds.length > 1 ? `Nhiều` : `${(firstSelectedSegment.volumeDb ?? 0).toFixed(1)} dB`}
                                </span>
                            </div>

                            <div className="flex items-center bg-gray-700 rounded" title="Tốc độ đoạn video">
                                <input
                                    type="number"
                                    min="0.1"
                                    max="4"
                                    step="0.05"
                                    defaultValue={(firstSelectedSegment.playbackRate || 1).toFixed(2)}
                                    key={firstSelectedSegment.id} // Re-mount component to show correct value if selection changes
                                    onBlur={(e) => {
                                        let value = parseFloat(e.target.value);
                                        if (isNaN(value) || value < 0.1) value = 0.1;
                                        if (value > 4) value = 4;
                                        onBatchUpdateSegments(selectedSegmentIds, { playbackRate: value });
                                    }}
                                    className="w-16 bg-transparent text-xs text-center font-mono outline-none focus:ring-1 focus:ring-indigo-500 rounded-l p-1"
                                    aria-label="Tốc độ đoạn video"
                                />
                                <span className="text-xs pr-2 text-gray-400">x</span>
                            </div>
                        </>
                    ) : (
                        <div className="h-[26px]" style={{ width: '280px' }}></div> // Placeholder to prevent layout shift
                    )}
                 </div>

                {/* Zoom */}
                <button onClick={() => setZoom(z => Math.max(1, z / 1.5))} className="p-1 rounded hover:bg-gray-700 hover:text-white" aria-label="Thu nhỏ dòng thời gian"><ZoomOutIcon className="w-5 h-5"/></button>
                <input
                    type="range" min="1" max="50" step="0.5" value={zoom}
                    onChange={e => setZoom(parseFloat(e.target.value))}
                    className="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    aria-label="Thu phóng dòng thời gian"
                />
                <button onClick={() => setZoom(z => Math.min(z * 1.5, 50))} className="p-1 rounded hover:bg-gray-700 hover:text-white" aria-label="Phóng to dòng thời gian"><ZoomInIcon className="w-5 h-5"/></button>
            </div>
        </div>
    );
};
export default EditorControls;

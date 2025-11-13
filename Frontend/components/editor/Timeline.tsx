import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { SubtitleBlock, VideoFile, VideoSegment, AudioFile } from '../../types';
import Track from './Track';
import TrackHeader from './TrackHeader';
import Waveform from './Waveform';
import AudioTrackItem from './AudioTrackItem';
import useTimelineInteraction from '../../hooks/useTimelineInteraction';
import { TRACK_HEIGHT, RULER_HEIGHT, PIXELS_PER_SECOND } from '../../constants';
import { FilmIcon, EyeIcon, EyeSlashIcon, SpeakerWaveIcon, SpeakerXMarkIcon } from '../ui/Icons';
import { EditorState } from '../views/ProfessionalVideoEditor';
import { getVideoUrl, getFileUrl } from '../../services/projectService';

interface TimelineProps {
    videoUrl: string | null;
    videoFile: VideoFile;
    subtitles: SubtitleBlock[];
    audioFiles: AudioFile[];
    audioUrls: Map<string, string>; // Receive URLs from parent instead of loading them
    onTimelineUpdate: (updateFn: (prevState: EditorState) => EditorState) => void;
    onTimelineInteractionStart: () => void;
    onTimelineInteractionEnd: () => void;
    onBatchUpdateSubtitles: (subs: SubtitleBlock[]) => void;
    currentTime: number;
    onSeek: (time: number) => void;
    onSeeking: (isSeeking: boolean) => void;
    timelineVisualDuration: number;
    zoom: number;
    isPlaying: boolean;
    isOverlayVisible: boolean;
    onToggleOverlayVisibility: () => void;
    selectedSegmentIds: string[];
    onSelectSegment: (id: string, e: React.MouseEvent) => void;
    selectedSubtitleIds: number[];
    onSelectSubtitle: (id: number, e: React.MouseEvent) => void;
    selectedAudioIds: string[];
    onSelectAudio: (id: string, e: React.MouseEvent) => void;
    onDeselectAll: () => void;
    onMarqueeSelect: (segmentIds: string[], subtitleIds: number[], audioIds: string[], isAdditive: boolean) => void;
    isMuted: boolean;
    onToggleMute: () => void;
}

const formatRulerTime = (time: number) => {
  if (isNaN(time) || time < 0) return '00:00';
  const minutes = Math.floor((time % 3600) / 60);
  const seconds = Math.floor(time % 60);
  const mStr = String(minutes).padStart(2, '0');
  const sStr = String(seconds).padStart(2, '0');
  return `${mStr}:${sStr}`;
};

const usePrevious = <T,>(value: T): T | undefined => {
    const ref = useRef<T | undefined>(undefined);
    useEffect(() => {
        ref.current = value;
    });
    return ref.current;
};

const WAVEFORM_TRACK_HEIGHT = 80;
const VIDEO_TRACK_HEIGHT = TRACK_HEIGHT;

const Timeline: React.FC<TimelineProps> = (props) => {
    const { subtitles, audioFiles, audioUrls, currentTime, timelineVisualDuration, zoom, isPlaying, videoFile, isOverlayVisible, onToggleOverlayVisibility, selectedSegmentIds, onSelectSegment, selectedSubtitleIds, onSelectSubtitle, selectedAudioIds, onSelectAudio, onDeselectAll, isMuted, onToggleMute } = props;
    const timelineContainerRef = useRef<HTMLDivElement>(null);
    const contentWrapperRef = useRef<HTMLDivElement>(null);
    const headerWrapperRef = useRef<HTMLDivElement>(null);
    
    // Calculate timeline width in pixels (instead of percentage)
    // This ensures that long videos remain usable by providing consistent pixel density
    const timelineWidthPx = useMemo(() => {
        return timelineVisualDuration * PIXELS_PER_SECOND * zoom;
    }, [timelineVisualDuration, zoom]);
    
    // Helper function to convert timeline time to pixel position
    const timeToPixels = useCallback((time: number): number => {
        if (timelineVisualDuration === 0) return 0;
        return (time / timelineVisualDuration) * timelineWidthPx;
    }, [timelineVisualDuration, timelineWidthPx]);
    
    // Helper function to convert source time to visual time considering playback rates
    const adjustTimeForSegments = useMemo(() => {
        return (sourceTime: number): number => {
            if (!videoFile.segments || videoFile.segments.length === 0) {
                return sourceTime;
            }
            
            let visualTime = 0;
            
            for (const segment of videoFile.segments) {
                const rate = segment.playbackRate || 1;
                const segmentSourceDuration = segment.sourceEndTime - segment.sourceStartTime;
                const segmentVisualDuration = segmentSourceDuration / rate;
                
                if (sourceTime < segment.sourceStartTime) {
                    // Source time is before this segment
                    break;
                } else if (sourceTime <= segment.sourceEndTime) {
                    // Source time is within this segment
                    const offsetInSegment = sourceTime - segment.sourceStartTime;
                    visualTime += offsetInSegment / rate;
                    break;
                } else {
                    // Source time is after this segment, accumulate full segment duration
                    visualTime += segmentVisualDuration;
                }
            }
            
            // If source time is after all segments, add remaining time at normal speed
            const lastSegment = videoFile.segments[videoFile.segments.length - 1];
            if (sourceTime > lastSegment.sourceEndTime) {
                visualTime += sourceTime - lastSegment.sourceEndTime;
            }
            
            return visualTime;
        };
    }, [videoFile.segments]);

    const numAudioTracks = useMemo(() => {
        if (audioFiles.length === 0) return 1;
        const maxTrack = Math.max(-1, ...audioFiles.map(s => s.track ?? -1));
        return maxTrack + 2;
    }, [audioFiles]);

    const { 
        getInteractionHandlers,
        snapLinePosition,
        marqueeRect
    } = useTimelineInteraction({ 
        ...props, 
        timelineRef: contentWrapperRef,
        containerRef: timelineContainerRef,
        adjustTimeForSegments
    });

    const numSubtitleTracks = useMemo(() => {
        if (subtitles.length === 0) return 1;
        const maxTrack = Math.max(...subtitles.map(s => s.track ?? 0));
        return maxTrack + 2;
    }, [subtitles]);
    
    useEffect(() => {
        const timelineEl = timelineContainerRef.current;
        const handleScroll = () => {
            if (timelineEl && headerWrapperRef.current) {
                headerWrapperRef.current.scrollTop = timelineEl.scrollTop;
            }
        };
        timelineEl?.addEventListener('scroll', handleScroll);
        return () => timelineEl?.removeEventListener('scroll', handleScroll);
    }, []);

    useEffect(() => {
      if (timelineContainerRef.current && contentWrapperRef.current && timelineVisualDuration > 0 && isPlaying) {
        const containerEl = timelineContainerRef.current;
        const playheadPos = (currentTime / timelineVisualDuration) * timelineWidthPx;
        const visibleStart = containerEl.scrollLeft;
        const visibleEnd = containerEl.scrollLeft + containerEl.clientWidth;
        const buffer = containerEl.clientWidth * 0.2;
        if (playheadPos < visibleStart + buffer || playheadPos > visibleEnd - buffer) {
            containerEl.scrollTo({
                left: playheadPos - containerEl.clientWidth / 2,
                behavior: 'smooth'
            });
        }
      }
    }, [currentTime, timelineVisualDuration, zoom, isPlaying, timelineWidthPx]);

    const prevZoom = usePrevious(zoom);

    useEffect(() => {
        if (prevZoom === undefined || prevZoom === zoom || isPlaying) return;

        if (!timelineContainerRef.current || timelineVisualDuration <= 0) return;

        const container = timelineContainerRef.current;
        const containerWidth = container.clientWidth;
        
        const playheadTime = currentTime;
        
        const playheadPx = (playheadTime / timelineVisualDuration) * timelineWidthPx;

        const newScrollLeft = playheadPx - (containerWidth / 2);

        container.scrollLeft = newScrollLeft;

    }, [zoom, prevZoom, currentTime, timelineVisualDuration, isPlaying, timelineContainerRef, timelineWidthPx]);


    const handleTimelineClick = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
    
        if (target.closest('.video-segment-item') || target.closest('.timeline-item') || target.closest('.playhead') || target.closest('.audio-track-item')) {
            return;
        }
        
        onDeselectAll();
        getInteractionHandlers('timeline').onMouseDown(e);
    };

    const audioTracksTop = RULER_HEIGHT + VIDEO_TRACK_HEIGHT + WAVEFORM_TRACK_HEIGHT;
    const subtitlesTop = audioTracksTop + (numAudioTracks * TRACK_HEIGHT);

    return (
        <div className="flex-grow flex bg-gray-800/50 rounded-md overflow-hidden select-none">
            <div ref={headerWrapperRef} className="w-40 flex-shrink-0 bg-gray-700/30 overflow-hidden">
                <div style={{ height: RULER_HEIGHT, boxSizing: 'border-box' }} className="border-b border-gray-700"></div>
                <TrackHeader
                    key="video-header"
                    name="Video"
                    controls={
                        <div className="flex items-center space-x-2">
                            <button
                                onClick={onToggleMute}
                                className="text-gray-400 hover:text-white"
                                title={isMuted ? "Bật tiếng" : "Tắt tiếng"}
                            >
                                {isMuted ? <SpeakerXMarkIcon className="w-4 h-4" /> : <SpeakerWaveIcon className="w-4 h-4" />}
                            </button>
                            <button 
                                onClick={onToggleOverlayVisibility} 
                                className="text-gray-400 hover:text-white"
                                title={isOverlayVisible ? "Ẩn lớp phủ" : "Hiện lớp phủ"}
                            >
                                {isOverlayVisible ? <EyeIcon className="w-4 h-4" /> : <EyeSlashIcon className="w-4 h-4" />}
                            </button>
                        </div>
                    }
                />
                <TrackHeader name="Sóng Âm" height={WAVEFORM_TRACK_HEIGHT} />
                {Array.from({ length: numAudioTracks }).map((_, i) => (
                    <TrackHeader key={`audio-header-${i}`} name={`Âm thanh ${i + 1}`} />
                ))}
                {Array.from({ length: numSubtitleTracks }).map((_, i) => (
                    <TrackHeader key={i} name={`Phụ đề ${i + 1}`} />
                ))}
            </div>

            <div ref={timelineContainerRef} className="flex-grow relative overflow-auto cursor-text" onMouseDown={handleTimelineClick}>
                <div 
                    ref={contentWrapperRef}
                    className="relative" 
                    style={{ width: `${timelineWidthPx}px`, minHeight: '100%' }} 
                >
                    <div style={{ height: RULER_HEIGHT }} className="border-b border-gray-700 sticky top-0 left-0 right-0 z-20 bg-gray-800/80 backdrop-blur-sm" onMouseDown={getInteractionHandlers('ruler').onMouseDown}>
                        {timelineVisualDuration > 0 && (() => {
                            const ticks = [];
                            const visibleDurationInSeconds = timelineVisualDuration / zoom;
                            let interval = 60;
                            if (visibleDurationInSeconds < 5) interval = 1;
                            else if (visibleDurationInSeconds < 15) interval = 2;
                            else if (visibleDurationInSeconds < 30) interval = 5;
                            else if (visibleDurationInSeconds < 60) interval = 10;
                            else if (visibleDurationInSeconds < 120) interval = 15;
                            else if (visibleDurationInSeconds < 300) interval = 30;

                            const numTicks = Math.floor(timelineVisualDuration / interval);
                            for (let i = 0; i <= numTicks; i++) {
                                const time = i * interval;
                                if (time > timelineVisualDuration + 1) continue;
                                
                                ticks.push(
                                    <div key={time} className="absolute h-full" style={{ left: `${timeToPixels(time)}px` }}>
                                        <div className="w-px h-2 bg-gray-500"></div>
                                        <span className="text-xs text-gray-500 absolute top-2 left-1">{formatRulerTime(time)}</span>
                                    </div>
                                );
                            }
                            return ticks;
                        })()}
                    </div>
                    
                    <div 
                        className="absolute w-full track-bg"
                        style={{ 
                            top: `${RULER_HEIGHT}px`, 
                            height: `${VIDEO_TRACK_HEIGHT}px`,
                            borderBottom: '1px solid rgba(55, 65, 81, 0.5)'
                        }}
                    >
                        {timelineVisualDuration > 0 && (() => {
                            let accumulatedVisualDuration = 0;
                            return videoFile.segments.map((segment) => {
                                const rate = segment.playbackRate || 1;
                                const segmentVisualDuration = (segment.sourceEndTime - segment.sourceStartTime) / rate;
                                const leftPx = timeToPixels(accumulatedVisualDuration);
                                const widthPx = timeToPixels(segmentVisualDuration);
                                accumulatedVisualDuration += segmentVisualDuration;

                                const isSelected = selectedSegmentIds.includes(segment.id);
                                
                                return (
                                    <div 
                                        key={segment.id}
                                        onClick={(e) => onSelectSegment(segment.id, e)}
                                        className={`video-segment-item absolute h-10 bg-cyan-900/80 rounded border-2 flex items-center p-2 cursor-pointer transition-all duration-100
                                            ${isSelected ? 'border-yellow-400 shadow-lg shadow-yellow-500/20' : 'border-cyan-700 hover:border-cyan-500'}
                                        `}
                                        style={{ left: `${leftPx}px`, width: `${widthPx}px`, top: `4px`}}
                                        title={videoFile.name}
                                    >
                                        <FilmIcon className="w-4 h-4 text-cyan-300 mr-2 flex-shrink-0" />
                                        <p className="text-xs text-white truncate pointer-events-none">{videoFile.name}</p>
                                        {rate !== 1 && (
                                            <div className="absolute bottom-1 right-1 bg-black/50 text-white text-[10px] font-mono rounded-sm px-1.5 py-0.5 pointer-events-none">
                                                {rate.toFixed(2)}x
                                            </div>
                                        )}
                                    </div>
                                );
                            });
                        })()}
                    </div>

                    <div className="absolute w-full track-bg" style={{ top: RULER_HEIGHT + VIDEO_TRACK_HEIGHT, height: WAVEFORM_TRACK_HEIGHT, borderBottom: '1px solid #374151' }}>
                        {timelineVisualDuration > 0 && (() => {
                            let accumulatedVisualDuration = 0;
                             return videoFile.segments.map((segment) => {
                                const rate = segment.playbackRate || 1;
                                const segmentVisualDuration = (segment.sourceEndTime - segment.sourceStartTime) / rate;
                                const leftPx = timeToPixels(accumulatedVisualDuration);
                                const widthPx = timeToPixels(segmentVisualDuration);
                                accumulatedVisualDuration += segmentVisualDuration;
                                
                                return (
                                    <div key={segment.id} className="absolute h-full" style={{ left: `${leftPx}px`, width: `${widthPx}px` }}>
                                        <Waveform 
                                            videoUrl={props.videoUrl} 
                                            sourceStartTime={segment.sourceStartTime}
                                            sourceEndTime={segment.sourceEndTime}
                                        />
                                    </div>
                                );
                             });
                        })()}
                    </div>

                    <div className="absolute" style={{ top: audioTracksTop, left: 0, right: 0, height: `${numAudioTracks * TRACK_HEIGHT}px` }}>
                        {Array.from({ length: numAudioTracks }).map((_, i) => (
                            <div
                                key={`audio-track-bg-${i}`}
                                className="absolute w-full"
                                style={{
                                    top: `${i * TRACK_HEIGHT}px`,
                                    height: `${TRACK_HEIGHT}px`,
                                    borderBottom: '1px solid rgba(55, 65, 81, 0.5)'
                                }}
                            />
                        ))}
                        {audioFiles.map((audioFile) => (
                            <div key={audioFile.id} className="absolute w-full pointer-events-none" style={{ top: `${(audioFile.track ?? 0) * TRACK_HEIGHT}px`, height: TRACK_HEIGHT }}>
                                <AudioTrackItem
                                    audioFile={audioFile}
                                    audioUrl={audioUrls.get(audioFile.id) || null}
                                    timelineVisualDuration={timelineVisualDuration}
                                    timelineWidthPx={timelineWidthPx}
                                    getInteractionHandlers={getInteractionHandlers}
                                    isSelected={selectedAudioIds.includes(audioFile.id)}
                                    onSelect={onSelectAudio}
                                    adjustTimeForSegments={adjustTimeForSegments}
                                />
                            </div>
                        ))}
                    </div>
                    
                    <div className="absolute" style={{ top: subtitlesTop, left: 0, right: 0, height: `${numSubtitleTracks * TRACK_HEIGHT}px` }}>
                        {Array.from({ length: numSubtitleTracks }).map((_, i) => (
                            <Track
                                key={i}
                                trackIndex={i}
                                duration={timelineVisualDuration}
                                timelineWidthPx={timelineWidthPx}
                                subtitles={props.subtitles.filter(s => (s.track ?? 0) === i)}
                                getInteractionHandlers={getInteractionHandlers}
                                selectedSubtitleIds={selectedSubtitleIds}
                                onSelectSubtitle={onSelectSubtitle}
                                adjustTimeForSegments={adjustTimeForSegments}
                            />
                        ))}
                    </div>

                    {snapLinePosition !== null && (
                        <div 
                            className="absolute top-0 bottom-0 w-px bg-yellow-400 z-35 pointer-events-none"
                            style={{ left: `${timeToPixels(snapLinePosition)}px` }}
                        />
                    )}

                    {timelineVisualDuration > 0 && (
                        <div 
                            className="playhead absolute top-0 bottom-0 w-0.5 bg-red-500 z-30 group" 
                            style={{ left: `${timeToPixels(currentTime)}px` }}
                            onMouseDown={getInteractionHandlers('playhead').onMouseDown}
                        >
                            <div className="absolute -top-1 -left-1.5 w-4 h-4 rounded-full bg-red-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                    )}

                    {marqueeRect && (
                        <div
                            className="absolute bg-blue-500 bg-opacity-20 border border-blue-400 pointer-events-none z-50"
                            style={{
                                transform: `translateX(${marqueeRect.x}px) translateY(${marqueeRect.y}px)`,
                                width: marqueeRect.width,
                                height: marqueeRect.height
                            }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

export default Timeline;
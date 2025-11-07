import React, { useState, useEffect, useCallback, RefObject } from 'react';
import { SubtitleBlock, VideoFile, AudioFile } from '../../types';
import { srtTimeToSeconds, secondsToSrtTime } from '../services/srtParser';
import { TRACK_HEIGHT, RULER_HEIGHT, WAVEFORM_TRACK_HEIGHT, VIDEO_TRACK_HEIGHT } from '../constants';
import { EditorState } from '../components/views/ProfessionalVideoEditor';

type InteractionType = 'move' | 'resize-start' | 'resize-end' | 'seek' | 'marquee' | 'move-audio' | null;

interface InteractionState {
    type: InteractionType;
    itemId?: number | string;
    initialMouseX: number;
    initialMouseY: number;
    initialStartTime: number;
    initialEndTime: number;
    initialTrack: number;
}

interface TimelineInteractionProps {
    subtitles: SubtitleBlock[];
    audioFiles: AudioFile[];
    videoFile: VideoFile;
    currentTime: number;
    onTimelineUpdate: (updateFn: (prevState: EditorState) => EditorState) => void;
    onTimelineInteractionStart: () => void;
    onTimelineInteractionEnd: () => void;
    onBatchUpdateSubtitles: (subs: SubtitleBlock[]) => void;
    onSeek: (time: number) => void;
    onSeeking: (isSeeking: boolean) => void;
    timelineVisualDuration: number;
    zoom: number;
    onSelectSubtitle: (id: number, e: React.MouseEvent) => void;
    onMarqueeSelect: (segmentIds: string[], subtitleIds: number[], audioIds: string[], isAdditive: boolean) => void;
    timelineRef: RefObject<HTMLDivElement>;
    containerRef: RefObject<HTMLDivElement>; // Ref for the scrolling container
    adjustTimeForSegments: (sourceTime: number) => number; // Function to convert source time to visual time
}

export interface InteractionHandlers {
    onMouseDown: (e: React.MouseEvent) => void;
}

const useTimelineInteraction = (props: TimelineInteractionProps) => {
    const { subtitles, audioFiles, videoFile, currentTime, timelineVisualDuration, onSeek, onSeeking, onTimelineUpdate, onTimelineInteractionStart, onTimelineInteractionEnd, timelineRef, containerRef, onSelectSubtitle, onMarqueeSelect, adjustTimeForSegments } = props;
    const [interaction, setInteraction] = useState<InteractionState | null>(null);
    const [snapLinePosition, setSnapLinePosition] = useState<number | null>(null);
    const [marqueeRect, setMarqueeRect] = useState<{ x: number, y: number, width: number, height: number } | null>(null);


    const pixelsToTimelineSeconds = useCallback((pixelX: number): number => {
        if (!timelineRef.current || !containerRef.current || !timelineVisualDuration) return 0;
    
        const containerRect = containerRef.current.getBoundingClientRect();
        const contentWidth = timelineRef.current.scrollWidth;
        const mouseXInContainer = pixelX - containerRect.left;
        const absoluteX = containerRef.current.scrollLeft + mouseXInContainer;
        const time = (absoluteX / contentWidth) * timelineVisualDuration;
    
        return Math.max(0, time);
    }, [timelineVisualDuration, timelineRef, containerRef]);

    // Convert visual time back to source time (reverse of adjustTimeForSegments)
    const visualToSourceTime = useCallback((visualTime: number): number => {
        if (!videoFile.segments || videoFile.segments.length === 0) {
            return visualTime;
        }
        
        let accumulatedVisualTime = 0;
        
        for (const segment of videoFile.segments) {
            const rate = segment.playbackRate || 1;
            const segmentSourceDuration = segment.sourceEndTime - segment.sourceStartTime;
            const segmentVisualDuration = segmentSourceDuration / rate;
            
            if (visualTime <= accumulatedVisualTime + segmentVisualDuration) {
                // Visual time is within this segment
                const offsetInSegmentVisual = visualTime - accumulatedVisualTime;
                const offsetInSegmentSource = offsetInSegmentVisual * rate;
                return segment.sourceStartTime + offsetInSegmentSource;
            }
            
            accumulatedVisualTime += segmentVisualDuration;
        }
        
        // If visual time is after all segments, assume normal speed
        const lastSegment = videoFile.segments[videoFile.segments.length - 1];
        return lastSegment.sourceEndTime + (visualTime - accumulatedVisualTime);
    }, [videoFile.segments]);

    const handleMouseDown = useCallback((type: InteractionType, e: React.MouseEvent, itemId?: number | string) => {
        e.preventDefault();
        e.stopPropagation();

        onTimelineInteractionStart();
        
        if (type === 'seek' || type === 'marquee') {
            const state: InteractionState = { type, initialMouseX: e.clientX, initialMouseY: e.clientY, initialStartTime: 0, initialEndTime: 0, initialTrack: 0 };
             setInteraction(state);
            if (type === 'marquee') {
                const containerRect = containerRef.current!.getBoundingClientRect();
                setMarqueeRect({
                    x: e.clientX - containerRect.left + containerRef.current!.scrollLeft,
                    y: e.clientY - containerRect.top + containerRef.current!.scrollTop,
                    width: 0,
                    height: 0,
                });
            }
            return;
        }

        if (type === 'move' && typeof itemId === 'number') {
            onSelectSubtitle(itemId, e);
        }

        const sub = type !== 'move-audio' && typeof itemId === 'number' ? subtitles.find(s => s.id === itemId) : undefined;
        const audio = type === 'move-audio' && typeof itemId === 'string' ? audioFiles.find(a => a.id === itemId) : undefined;
        
        if (!sub && !audio) return;
        
        setInteraction({
            type,
            itemId,
            initialMouseX: e.clientX,
            initialMouseY: e.clientY,
            initialStartTime: sub ? srtTimeToSeconds(sub.startTime) : (audio?.startTime || 0),
            initialEndTime: sub ? srtTimeToSeconds(sub.endTime) : (audio?.startTime || 0) + (audio?.duration || 0),
            initialTrack: sub ? sub.track ?? 0 : (audio?.track ?? 0),
        });
    }, [containerRef, onTimelineInteractionStart, subtitles, audioFiles, onSelectSubtitle]);
    
    useEffect(() => {
        if (!interaction) {
            onSeeking(false);
            return;
        }

        onSeeking(true);

        const handleMouseMove = (e: MouseEvent) => {
            if (!timelineRef.current || !containerRef.current) return;

            if (interaction.type === 'marquee') {
                const containerRect = containerRef.current!.getBoundingClientRect();
                const startX = interaction.initialMouseX - containerRect.left + containerRef.current!.scrollLeft;
                const startY = interaction.initialMouseY - containerRect.top + containerRef.current!.scrollTop;
                const currentX = e.clientX - containerRect.left + containerRef.current!.scrollLeft;
                const currentY = e.clientY - containerRect.top + containerRef.current!.scrollTop;

                const newMarquee = {
                    x: Math.min(startX, currentX),
                    y: Math.min(startY, currentY),
                    width: Math.abs(startX - currentX),
                    height: Math.abs(startY - currentY),
                };
                setMarqueeRect(newMarquee);
                return;
            }
            
            if (interaction.type === 'seek') {
                const currentTimelineSeconds = pixelsToTimelineSeconds(e.clientX);
                onSeek(currentTimelineSeconds);
                return;
            }

            if (!interaction.itemId) return;
            
            const contentWidth = timelineRef.current.scrollWidth;
            const SNAP_PX_THRESHOLD = 8;
            const thresholdInSeconds = SNAP_PX_THRESHOLD * (timelineVisualDuration / contentWidth);
            
            const snapPoints: number[] = [currentTime];
            
            // Subtitles: stored with source video times, need conversion to visual timeline
            subtitles.forEach(sub => {
                if (sub.id !== interaction.itemId) {
                    // Convert source time to visual time for snap points
                    const visualStart = adjustTimeForSegments(srtTimeToSeconds(sub.startTime));
                    const visualEnd = adjustTimeForSegments(srtTimeToSeconds(sub.endTime));
                    snapPoints.push(visualStart);
                    snapPoints.push(visualEnd);
                }
            });
            
            // Audio files: startTime is source time, needs adjustment to visual time (like subtitles)
            audioFiles.forEach(audio => {
                if (audio.id !== interaction.itemId) {
                    const visualStart = adjustTimeForSegments(audio.startTime || 0);
                    const visualEnd = visualStart + (audio.duration || 0);
                    snapPoints.push(visualStart);
                    snapPoints.push(visualEnd);
                }
            });

            let accumulatedVisualDuration = 0;
            videoFile.segments.forEach(seg => {
                snapPoints.push(accumulatedVisualDuration);
                const rate = seg.playbackRate || 1;
                accumulatedVisualDuration += (seg.sourceEndTime - seg.sourceStartTime) / rate;
                snapPoints.push(accumulatedVisualDuration);
            });

            const snap = (time: number): { time: number, point: number | null } => {
                let bestSnap: { point: number, dist: number } | null = null;
                for (const point of snapPoints) {
                    const dist = Math.abs(time - point);
                    if (dist < thresholdInSeconds) {
                        if (!bestSnap || dist < bestSnap.dist) {
                            bestSnap = { point, dist };
                        }
                    }
                }
                return bestSnap ? { time: bestSnap.point, point: bestSnap.point } : { time, point: null };
            };


            const initialTimelineSeconds = pixelsToTimelineSeconds(interaction.initialMouseX);
            const currentTimelineSeconds = pixelsToTimelineSeconds(e.clientX);
            const dtTimeline = currentTimelineSeconds - initialTimelineSeconds;
            const minSubDuration = 0.1;
            
            const updateFn = (prevState: EditorState): EditorState => {
                 let snapPos: number | null = null;

                 switch (interaction.type) {
                     case 'move': {
                        const subToUpdate = prevState.subtitles.find(s => s.id === interaction.itemId);
                        if (!subToUpdate) return prevState;

                        const containerRect = containerRef.current!.getBoundingClientRect();
                        const numAudioTracksForSub = prevState.audioFiles.length > 0 ? Math.max(...prevState.audioFiles.map(a => a.track ?? 0)) + 2 : 1;
                        const subtitlesBaseY = RULER_HEIGHT + VIDEO_TRACK_HEIGHT + WAVEFORM_TRACK_HEIGHT + (numAudioTracksForSub * TRACK_HEIGHT);
                        const relativeY = e.clientY - containerRect.top + containerRef.current!.scrollTop - subtitlesBaseY;
                        const newTrack = Math.max(0, Math.floor(relativeY / TRACK_HEIGHT));
                        
                        const subDuration = interaction.initialEndTime - interaction.initialStartTime;
                        let newStart = interaction.initialStartTime + dtTimeline;

                        const { time: snappedStartTime, point: startSnapPoint } = snap(newStart);
                        const { time: snappedEndTime, point: endSnapPoint } = snap(newStart + subDuration);

                        if (startSnapPoint !== null) {
                            newStart = snappedStartTime;
                            snapPos = startSnapPoint;
                        } else if (endSnapPoint !== null) {
                            newStart = snappedEndTime - subDuration;
                            snapPos = endSnapPoint;
                        }
                        setSnapLinePosition(snapPos);

                        let newEnd = newStart + subDuration;

                        if (newStart < 0) {
                            newStart = 0;
                            newEnd = subDuration;
                        }
                        if (newEnd > timelineVisualDuration) {
                            newEnd = timelineVisualDuration;
                            newStart = newEnd - subDuration;
                        }

                        const hasCollision = prevState.subtitles.some(other => {
                            if (other.id === interaction.itemId) return false;
                            if ((other.track ?? 0) !== newTrack) return false;
                            const otherStart = srtTimeToSeconds(other.startTime);
                            const otherEnd = srtTimeToSeconds(other.endTime);
                            return newStart < otherEnd - 0.001 && newEnd > otherStart + 0.001;
                        });

                        if (hasCollision) return prevState;
                        
                        return {
                            ...prevState,
                            subtitles: prevState.subtitles.map(s => 
                                s.id === interaction.itemId 
                                ? { ...s, track: newTrack, startTime: secondsToSrtTime(newStart), endTime: secondsToSrtTime(newEnd) } 
                                : s
                            )
                        };
                     }
                    case 'move-audio': {
                        const audioToUpdate = prevState.audioFiles.find(a => a.id === interaction.itemId);
                        if (!audioToUpdate) return prevState;

                        const containerRect = containerRef.current!.getBoundingClientRect();
                        const audioTracksBaseY = RULER_HEIGHT + VIDEO_TRACK_HEIGHT + WAVEFORM_TRACK_HEIGHT;
                        const relativeY = e.clientY - containerRect.top + containerRef.current!.scrollTop - audioTracksBaseY;
                        const newTrack = Math.max(0, Math.floor(relativeY / TRACK_HEIGHT));

                        const duration = audioToUpdate.duration || 0;
                        // initialStartTime is source time, convert to visual for positioning
                        const initialVisualStart = adjustTimeForSegments(interaction.initialStartTime);
                        let newVisualStart = initialVisualStart + dtTimeline;
                        
                        const { time: snappedStartTime, point: startSnapPoint } = snap(newVisualStart);
                        const { time: snappedEndTime, point: endSnapPoint } = snap(newVisualStart + duration);

                        if (startSnapPoint !== null) {
                            newVisualStart = snappedStartTime;
                            snapPos = startSnapPoint;
                        } else if (endSnapPoint !== null) {
                            newVisualStart = snappedEndTime - duration;
                            snapPos = endSnapPoint;
                        }
                        setSnapLinePosition(snapPos);

                        let newVisualEnd = newVisualStart + duration;

                        if (newVisualStart < 0) {
                            newVisualStart = 0;
                            newVisualEnd = duration;
                        }
                        if (newVisualEnd > timelineVisualDuration) {
                            newVisualEnd = timelineVisualDuration;
                            newVisualStart = newVisualEnd - duration;
                        }

                        // Check collision in visual time
                        const hasCollision = prevState.audioFiles.some(other => {
                            if (other.id === interaction.itemId) return false;
                            if ((other.track ?? 0) !== newTrack) return false;
                            const otherVisualStart = adjustTimeForSegments(other.startTime || 0);
                            const otherVisualEnd = otherVisualStart + (other.duration || 0);
                            return newVisualStart < otherVisualEnd - 0.001 && newVisualEnd > otherVisualStart + 0.001;
                        });

                        if (hasCollision) return prevState;

                        // Convert visual time back to source time for storage
                        const newSourceStart = visualToSourceTime(newVisualStart);

                        return {
                            ...prevState,
                            audioFiles: prevState.audioFiles.map(a =>
                                a.id === interaction.itemId ? { ...a, startTime: newSourceStart, track: newTrack } : a
                            )
                        };
                    }
                     case 'resize-start': {
                        const subToUpdate = prevState.subtitles.find(s => s.id === interaction.itemId);
                        if (!subToUpdate) return prevState;
                        
                        const currentTrack = subToUpdate.track ?? 0;
                        const prevSub = prevState.subtitles
                            .filter(other => other.id !== subToUpdate.id && (other.track ?? 0) === currentTrack && srtTimeToSeconds(other.endTime) <= interaction.initialStartTime)
                            .sort((a, b) => srtTimeToSeconds(b.endTime) - srtTimeToSeconds(a.endTime))[0];
                        const leftBoundary = prevSub ? srtTimeToSeconds(prevSub.endTime) : 0;
                        
                        let newStart = interaction.initialStartTime + dtTimeline;
                        newStart = Math.max(leftBoundary, newStart);
                        newStart = Math.min(newStart, interaction.initialEndTime - minSubDuration);
                        
                        const { time: snappedTime, point } = snap(newStart);
                        newStart = snappedTime;
                        setSnapLinePosition(point);

                        return {
                           ...prevState,
                           subtitles: prevState.subtitles.map(s => s.id === interaction.itemId ? {...s, startTime: secondsToSrtTime(newStart)} : s)
                        };
                    }
                    case 'resize-end': {
                        const subToUpdate = prevState.subtitles.find(s => s.id === interaction.itemId);
                        if (!subToUpdate) return prevState;

                        const currentTrack = subToUpdate.track ?? 0;
                        const nextSub = prevState.subtitles
                            .filter(other => other.id !== subToUpdate.id && (other.track ?? 0) === currentTrack && srtTimeToSeconds(other.startTime) >= interaction.initialEndTime)
                            .sort((a, b) => srtTimeToSeconds(a.startTime) - srtTimeToSeconds(b.startTime))[0];
                        const rightBoundary = nextSub ? srtTimeToSeconds(nextSub.startTime) : timelineVisualDuration;

                        let newEnd = interaction.initialEndTime + dtTimeline;
                        newEnd = Math.min(rightBoundary, newEnd);
                        newEnd = Math.max(newEnd, interaction.initialStartTime + minSubDuration);
                        
                        const { time: snappedTime, point } = snap(newEnd);
                        newEnd = snappedTime;
                        setSnapLinePosition(point);

                        return {
                           ...prevState,
                           subtitles: prevState.subtitles.map(s => s.id === interaction.itemId ? {...s, endTime: secondsToSrtTime(newEnd)} : s)
                        };
                    }
                    default:
                         return prevState;
                 }
            };
            onTimelineUpdate(updateFn);
        };

        const handleMouseUp = (e: MouseEvent) => {
            if (interaction.type === 'marquee') {
                if (marqueeRect && (marqueeRect.width < 5 && marqueeRect.height < 5)) {
                    const time = pixelsToTimelineSeconds(e.clientX);
                    onSeek(time);
                } else if (marqueeRect) {
                    const selectedSegIds: string[] = [];
                    const selectedSubIds: number[] = [];
                    const selectedAudioIds: string[] = [];
                    
                    const contentWidth = timelineRef.current!.scrollWidth;
                    const marqueeStartSec = (marqueeRect.x / contentWidth) * timelineVisualDuration;
                    const marqueeEndSec = ((marqueeRect.x + marqueeRect.width) / contentWidth) * timelineVisualDuration;
                    const marqueeTopPx = marqueeRect.y;
                    const marqueeBottomPx = marqueeRect.y + marqueeRect.height;
                    
                    let accumulatedVisualDuration = 0;
                    videoFile.segments.forEach(segment => {
                        const rate = segment.playbackRate || 1;
                        const segmentVisualDuration = (segment.sourceEndTime - segment.sourceStartTime) / rate;
                        const segmentStartSec = accumulatedVisualDuration;
                        const segmentEndSec = accumulatedVisualDuration + segmentVisualDuration;
                        accumulatedVisualDuration += segmentVisualDuration;

                        const segmentTopPx = RULER_HEIGHT;
                        const segmentBottomPx = RULER_HEIGHT + VIDEO_TRACK_HEIGHT;

                        if (marqueeEndSec > segmentStartSec && marqueeStartSec < segmentEndSec &&
                            marqueeBottomPx > segmentTopPx && marqueeTopPx < segmentBottomPx) {
                            selectedSegIds.push(segment.id);
                        }
                    });

                    if (selectedSegIds.length === 0) {
                        // Check audio files
                        const audioTracksBaseY = RULER_HEIGHT + VIDEO_TRACK_HEIGHT + WAVEFORM_TRACK_HEIGHT;
                        audioFiles.forEach(audio => {
                            // Convert audio source time to visual timeline time
                            const audioStartSec = adjustTimeForSegments(audio.startTime || 0);
                            const audioEndSec = audioStartSec + (audio.duration || 0);
                            const track = audio.track ?? 0;
                            
                            const audioTopPx = audioTracksBaseY + (track * TRACK_HEIGHT);
                            const audioBottomPx = audioTopPx + TRACK_HEIGHT;

                            if (marqueeEndSec > audioStartSec && marqueeStartSec < audioEndSec &&
                                marqueeBottomPx > audioTopPx && marqueeTopPx < audioBottomPx) {
                                selectedAudioIds.push(audio.id);
                            }
                        });

                        // Check subtitle files
                        const numAudioTracks = audioFiles.length > 0 ? Math.max(...audioFiles.map(a => a.track ?? 0)) + 1 : 0;
                        const subtitlesBaseY = audioTracksBaseY + (numAudioTracks * TRACK_HEIGHT);
                        subtitles.forEach(sub => {
                            // Convert subtitle source time to visual timeline time
                            const subStartSec = adjustTimeForSegments(srtTimeToSeconds(sub.startTime));
                            const subEndSec = adjustTimeForSegments(srtTimeToSeconds(sub.endTime));
                            const track = sub.track ?? 0;
                            
                            const subTopPx = subtitlesBaseY + (track * TRACK_HEIGHT);
                            const subBottomPx = subTopPx + TRACK_HEIGHT;

                            if (marqueeEndSec > subStartSec && marqueeStartSec < subEndSec &&
                                marqueeBottomPx > subTopPx && marqueeTopPx < subBottomPx) {
                                selectedSubIds.push(sub.id);
                            }
                        });
                    }
                    onMarqueeSelect(selectedSegIds, selectedSubIds, selectedAudioIds, e.ctrlKey || e.metaKey);
                }
                setMarqueeRect(null);
            }

            setInteraction(null);
            onTimelineInteractionEnd();
            setSnapLinePosition(null);
        };

        const cursor = interaction.type === 'move' || interaction.type === 'move-audio'
            ? 'grabbing' 
            : (interaction.type?.startsWith('resize') ? 'ew-resize' : 'grabbing');
        document.body.style.cursor = cursor;
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp, { once: true });

        return () => {
            document.body.style.cursor = 'default';
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [interaction, subtitles, audioFiles, timelineVisualDuration, pixelsToTimelineSeconds, onSeek, onTimelineUpdate, onSeeking, timelineRef, containerRef, onSelectSubtitle, onTimelineInteractionEnd, currentTime, videoFile, onMarqueeSelect, marqueeRect]);

    const getInteractionHandlers = useCallback((
      type: 'subtitle' | 'resize-start' | 'resize-end' | 'playhead' | 'timeline' | 'ruler' | 'audio',
      id?: number | string
    ): InteractionHandlers => {
        const handlerMap = {
            'subtitle': (e: React.MouseEvent) => handleMouseDown('move', e, id),
            'audio': (e: React.MouseEvent) => handleMouseDown('move-audio', e, id),
            'resize-start': (e: React.MouseEvent) => handleMouseDown('resize-start', e, id),
            'resize-end': (e: React.MouseEvent) => handleMouseDown('resize-end', e, id),
            'playhead': (e: React.MouseEvent) => handleMouseDown('seek', e),
            'timeline': (e: React.MouseEvent) => handleMouseDown('marquee', e),
            'ruler': (e: React.MouseEvent) => handleMouseDown('seek', e),
        };
        return { onMouseDown: handlerMap[type] };
    }, [handleMouseDown]);

    return {
        getInteractionHandlers,
        snapLinePosition,
        marqueeRect
    };
};

export default useTimelineInteraction;
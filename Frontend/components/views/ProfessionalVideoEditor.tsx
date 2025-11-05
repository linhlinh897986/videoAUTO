import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Project, VideoFile, SrtFile, SubtitleBlock, VideoSegment, BoundingBox, SubtitleStyle, AudioFile } from '../../types';
import { getVideoUrl, getFileUrl } from '../../services/projectService';
import { srtTimeToSeconds, secondsToSrtTime } from '../../services/srtParser';
import { BackArrowIcon, ChevronLeftIcon, ChevronRightIcon } from '../ui/Icons';
import VideoPlayer from '../editor/VideoPlayer';
import SubtitleEditor from '../editor/SubtitleList';
import StyleEditor from '../editor/StyleEditor';
import Timeline from '../editor/Timeline';
import EditorControls from '../editor/EditorControls';
import { useHistoryState } from '../../hooks/useHistoryState';
import { generateBatchTTS, listTTSVoices, TTSVoice } from '../../services/ttsService';
import Tesseract from 'tesseract.js';


interface ProfessionalVideoEditorProps {
  project: Project;
  videoFile: VideoFile;
  srtFile: SrtFile;
  onUpdateProject: (projectId: string, updates: Partial<Project> | ((p: Project) => Partial<Project>)) => void;
  onExit: () => void;
  onSwitchFile: (newVideoId: string, newSrtId: string) => void;
}

export interface EditorState {
    subtitles: SubtitleBlock[];
    segments: VideoSegment[];
    audioFiles: AudioFile[];
    hardsubCoverBox?: BoundingBox;
    masterVolumeDb: number;
}

const ProfessionalVideoEditor: React.FC<ProfessionalVideoEditorProps> = ({ project, videoFile: initialVideoFile, srtFile, onUpdateProject, onExit, onSwitchFile }) => {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzingHardsubs, setIsAnalyzingHardsubs] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ progress: 0, status: '' });
  const [isOverlayVisible, setIsOverlayVisible] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  
  const { 
    state: editorState, 
    setState: setEditorState, 
    undo, 
    redo, 
    canUndo, 
    canRedo,
    reset: resetHistory
  } = useHistoryState<EditorState>({
    subtitles: JSON.parse(JSON.stringify(srtFile.translatedSubtitles)).map((sub: SubtitleBlock) => ({ ...sub, track: sub.track ?? 0 })),
    segments: JSON.parse(JSON.stringify(initialVideoFile.segments.length > 0 ? initialVideoFile.segments : [])),
    audioFiles: JSON.parse(JSON.stringify(project.files.filter((f): f is AudioFile => f.type === 'audio'))),
    hardsubCoverBox: initialVideoFile.hardsubCoverBox ? JSON.parse(JSON.stringify(initialVideoFile.hardsubCoverBox)) : undefined,
    masterVolumeDb: initialVideoFile.masterVolumeDb ?? 0,
  });
  
  const [liveEditorState, setLiveEditorState] = useState(editorState);
  const isInteractingRef = useRef(false);

  useEffect(() => {
    if (!isInteractingRef.current) {
        setLiveEditorState(editorState);
    }
  }, [editorState]);

  const { subtitles, segments, audioFiles, hardsubCoverBox, masterVolumeDb } = liveEditorState;
  
  const videoFile = useMemo(() => ({
    ...initialVideoFile,
    segments,
    hardsubCoverBox,
    masterVolumeDb,
  }), [initialVideoFile, segments, hardsubCoverBox, masterVolumeDb]);

  const isDirty = canUndo;
  
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [currentPlaybackRate, setCurrentPlaybackRate] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [audioUrls, setAudioUrls] = useState<Map<string, string>>(new Map()); // Share URLs with Timeline
  
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([]);
  const [selectedSubtitleIds, setSelectedSubtitleIds] = useState<number[]>([]);
  const [lastSelectedSegmentId, setLastSelectedSegmentId] = useState<string | null>(null);
  const [lastSelectedSubtitleId, setLastSelectedSubtitleId] = useState<number | null>(null);

  
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioUrlsRef = useRef<Map<string, string>>(new Map()); // Store URLs separately
  const playingAudioRef = useRef<Set<string>>(new Set()); // Track which audio is currently playing
  const editorContainerRef = useRef<HTMLDivElement>(null);

  const [activeRightTab, setActiveRightTab] = useState<'subtitles' | 'style'>('subtitles');
  const [isGeneratingTTS, setIsGeneratingTTS] = useState(false);
  const [ttsVoices, setTtsVoices] = useState<TTSVoice[]>([]);
  const [selectedTtsVoice, setSelectedTtsVoice] = useState<string>("BV421_vivn_streaming");

  const maxSubtitleEndTime = useMemo(() => {
    if (subtitles.length === 0) return 0;
    return Math.max(...subtitles.map(s => srtTimeToSeconds(s.endTime)));
  }, [subtitles]);

  const timelineVisualDuration = useMemo(() => {
    const segmentsDuration = segments.reduce((total, seg) => {
        const rate = seg.playbackRate || 1;
        return total + (seg.sourceEndTime - seg.sourceStartTime) / rate;
    }, 0);
    return Math.max(segmentsDuration, maxSubtitleEndTime);
  }, [segments, maxSubtitleEndTime]);

  const [isResizing, setIsResizing] = useState<'horizontal' | 'vertical' | null>(null);
  const [panels, setPanels] = useState({ video: 50, timeline: 30 });
  
  const handleMouseDown = (resizer: 'horizontal' | 'vertical') => (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(resizer);
  };

  const handleMouseUp = useCallback(() => setIsResizing(null), []);
  
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !editorContainerRef.current) return;
    const rect = editorContainerRef.current.getBoundingClientRect();
    if (isResizing === 'horizontal') {
        const newVideoWidth = ((e.clientX - rect.left) / rect.width) * 100;
        setPanels(p => ({...p, video: Math.max(20, Math.min(80, newVideoWidth))}));
    } else {
        const mainContentHeight = rect.height - 49;
        const newTimelineHeight = ((rect.bottom - e.clientY) / mainContentHeight) * 100;
        setPanels(p => ({...p, timeline: Math.max(15, Math.min(50, newTimelineHeight))}));
    }
  }, [isResizing]);

  useEffect(() => {
    if (isResizing) {
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = isResizing === 'horizontal' ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
    }
    return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);
  
  useEffect(() => {
    let objectUrl: string | null = null;
    const loadVideo = async () => {
      setIsLoading(true);
      try {
        objectUrl = await getVideoUrl(videoFile.id);
        setVideoUrl(objectUrl);
      } catch (error) {
        console.error("Lỗi khi tải video cho trình chỉnh sửa:", error);
      } finally {
        setIsLoading(false);
      }
    };
    loadVideo();
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [videoFile.id]);
  
  const handleUpdateSubtitle = (id: number, newSub: Partial<SubtitleBlock>) => {
    const updateFn = (prevState: EditorState) => ({
        ...prevState,
        subtitles: prevState.subtitles.map(s => s.id === id ? { ...s, ...newSub } : s),
    });
    setLiveEditorState(updateFn);
    setEditorState(updateFn);
  };

  const handleBatchUpdateSegments = (segmentIds: string[], updates: Partial<VideoSegment>) => {
    const updateFn = (prevState: EditorState) => ({
      ...prevState,
      segments: prevState.segments.map(s => segmentIds.includes(s.id) ? { ...s, ...updates } : s)
    });
    setLiveEditorState(updateFn);
    setEditorState(updateFn);
  };
  
  const handleUpdateSegment = (segmentId: string, updates: Partial<VideoSegment>) => {
    const updateFn = (prevState: EditorState): EditorState => {
        const segmentIndex = prevState.segments.findIndex(s => s.id === segmentId);
        if (segmentIndex === -1) return prevState;

        const segmentToUpdate = prevState.segments[segmentIndex];
        const updatedSegment = { ...segmentToUpdate, ...updates };
        
        const newSegments = [...prevState.segments];
        newSegments[segmentIndex] = updatedSegment;
        
        if (!('playbackRate' in updates) || updates.playbackRate === segmentToUpdate.playbackRate) {
            return { ...prevState, segments: newSegments };
        }

        const oldRate = segmentToUpdate.playbackRate || 1;
        const newRate = updates.playbackRate || 1;
        if (oldRate === newRate) {
            return { ...prevState, segments: newSegments };
        }

        let timelineStartOfChangedSegment = 0;
        for (let i = 0; i < segmentIndex; i++) {
            const seg = prevState.segments[i];
            timelineStartOfChangedSegment += (seg.sourceEndTime - seg.sourceStartTime) / (seg.playbackRate || 1);
        }

        const sourceDuration = segmentToUpdate.sourceEndTime - segmentToUpdate.sourceStartTime;
        const oldVisualDuration = sourceDuration / oldRate;
        const newVisualDuration = sourceDuration / newRate;
        const timelineEndOfChangedSegment_OLD = timelineStartOfChangedSegment + oldVisualDuration;
        
        const timeShift = oldVisualDuration - newVisualDuration;
        const durationRatio = oldVisualDuration > 0 ? newVisualDuration / oldVisualDuration : 0;

        const newSubtitles = prevState.subtitles.map(sub => {
            const subStart = srtTimeToSeconds(sub.startTime);
            const subEnd = srtTimeToSeconds(sub.endTime);

            let newStartTime;
            if (subStart <= timelineStartOfChangedSegment) {
                newStartTime = subStart;
            } else if (subStart >= timelineEndOfChangedSegment_OLD) {
                newStartTime = subStart - timeShift;
            } else {
                const offset = subStart - timelineStartOfChangedSegment;
                newStartTime = timelineStartOfChangedSegment + (offset * durationRatio);
            }

            let newEndTime;
            const timelineEndOfChangedSegment_NEW = timelineStartOfChangedSegment + newVisualDuration;
            if (subEnd <= timelineStartOfChangedSegment) {
                newEndTime = subEnd;
            } else if (subEnd > timelineEndOfChangedSegment_OLD) { 
                const durationAfter = subEnd - timelineEndOfChangedSegment_OLD;
                newEndTime = timelineEndOfChangedSegment_NEW + durationAfter;
            } else {
                const offset = subEnd - timelineStartOfChangedSegment;
                newEndTime = timelineStartOfChangedSegment + (offset * durationRatio);
            }

            return {
                ...sub,
                startTime: secondsToSrtTime(Math.max(0, newStartTime)),
                endTime: secondsToSrtTime(Math.max(0, newEndTime)),
            };
        });

        return {
            ...prevState,
            subtitles: newSubtitles,
            segments: newSegments,
        };
    };

    setLiveEditorState(updateFn);
    setEditorState(updateFn);
  };
  
  const handleBatchUpdateSubtitles = (updatedSubs: SubtitleBlock[]) => {
      const updateFn = (prevState: EditorState) => ({ ...prevState, subtitles: updatedSubs });
      setLiveEditorState(updateFn);
      setEditorState(updateFn);
  };

  const handleMasterVolumeChange = (newDb: number) => {
    const updateFn = (prevState: EditorState) => ({ ...prevState, masterVolumeDb: newDb });
    setLiveEditorState(updateFn);
    setEditorState(updateFn);
  };

  const handleSave = () => {
    onUpdateProject(project.id, p => ({
        files: p.files.map(f => {
            if (f.id === srtFile.id && f.type === 'srt') {
                return { ...f, translatedSubtitles: editorState.subtitles };
            }
            if (f.id === videoFile.id && f.type === 'video') {
                return { ...f, segments: editorState.segments, hardsubCoverBox: editorState.hardsubCoverBox, masterVolumeDb: editorState.masterVolumeDb };
            }
            if (f.type === 'audio') {
                const updatedAudio = editorState.audioFiles.find(af => af.id === f.id);
                return updatedAudio || f;
            }
            return f;
        })
    }));
    resetHistory(liveEditorState);
  };

  const handleExit = () => {
    if (isDirty) {
      handleSave();
    }
    onExit();
  };
  
  const videoFiles = useMemo(() =>
      project.files
          .filter((f): f is VideoFile => f.type === 'video')
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })),
      [project.files]
  );

  const srtFiles = useMemo(() =>
      project.files
          .filter((f): f is SrtFile => f.type === 'srt'),
      [project.files]
  );

  const currentIndex = useMemo(() =>
      videoFiles.findIndex(f => f.id === initialVideoFile.id),
      [videoFiles, initialVideoFile.id]
  );

  const canGoToPrevious = currentIndex > 0;
  const canGoToNext = currentIndex < videoFiles.length - 1;

  const navigateToVideo = (direction: 'previous' | 'next') => {
      if (isDirty) {
          handleSave();
      }

      const newIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1;
      if (newIndex < 0 || newIndex >= videoFiles.length) return;

      const newVideoFile = videoFiles[newIndex];
      if (!newVideoFile) return;

      const newSrtFileName = newVideoFile.name.replace(/\.[^/.]+$/, "") + ".srt";
      const newSrtFile = srtFiles.find(f => f.name === newSrtFileName);

      if (newSrtFile) {
          onSwitchFile(newVideoFile.id, newSrtFile.id);
      } else {
          alert(`Không tìm thấy tệp phụ đề khớp (${newSrtFileName}) cho video này.`);
      }
  };

  const mapTimelineToSourceTime = useCallback((timelineTime: number): number => {
    if (!segments || segments.length === 0) return timelineTime;

    let accumulatedVisualDuration = 0;
    for (const segment of segments) {
        const rate = segment.playbackRate || 1;
        const segmentVisualDuration = (segment.sourceEndTime - segment.sourceStartTime) / rate;
        
        if (timelineTime <= accumulatedVisualDuration + segmentVisualDuration + 0.001) {
            const timeIntoVisualSegment = timelineTime - accumulatedVisualDuration;
            return segment.sourceStartTime + timeIntoVisualSegment * rate;
        }
        accumulatedVisualDuration += segmentVisualDuration;
    }
    return segments[segments.length - 1]?.sourceEndTime || videoDuration;
  }, [segments, videoDuration]);

  const mapSourceToTimelineTime = useCallback((sourceTime: number): { timelineTime: number | null, isInGap: boolean } => {
    if (!segments || segments.length === 0) return { timelineTime: sourceTime, isInGap: false };
      
    let accumulatedVisualDuration = 0;
    for (const segment of segments) {
        if (sourceTime >= segment.sourceStartTime - 0.01 && sourceTime < segment.sourceEndTime + 0.01) {
            const rate = segment.playbackRate || 1;
            const timeIntoSourceSegment = sourceTime - segment.sourceStartTime;
            return { timelineTime: accumulatedVisualDuration + (timeIntoSourceSegment / rate), isInGap: false };
        }
        const rate = segment.playbackRate || 1;
        accumulatedVisualDuration += (segment.sourceEndTime - segment.sourceStartTime) / rate;
    }
    return { timelineTime: null, isInGap: true };
  }, [segments]);
  
  const handleSeek = (timelineTime: number) => {
    if (videoRef.current) {
        const sourceTime = mapTimelineToSourceTime(timelineTime);
        videoRef.current.currentTime = sourceTime;
        setCurrentTime(timelineTime);
    }
  };

  const activeSubtitles = useMemo(() => {
    return subtitles.filter(s => {
      const start = srtTimeToSeconds(s.startTime);
      const end = srtTimeToSeconds(s.endTime);
      return currentTime >= start && currentTime < end;
    });
  }, [currentTime, subtitles]);

  const activeSubtitleId = useMemo(() => activeSubtitles[0]?.id, [activeSubtitles]);
  const activeSubtitlesText = useMemo(() => activeSubtitles.map(s => s.text).join('\n'), [activeSubtitles]);
  
  const handleSplitSubtitle = () => {
      const subToSplit = subtitles.find(sub => {
          const start = srtTimeToSeconds(sub.startTime);
          const end = srtTimeToSeconds(sub.endTime);
          return currentTime > start && currentTime < end;
      });

      if (!subToSplit) return;

      const newSubA: SubtitleBlock = {
          ...subToSplit,
          endTime: secondsToSrtTime(currentTime),
      };
      const newSubB: SubtitleBlock = {
          ...subToSplit,
          id: Date.now(), // Simple unique ID generation
          startTime: secondsToSrtTime(currentTime),
      };
      
      const updateFn = (prevState: EditorState) => {
        const index = prevState.subtitles.findIndex(s => s.id === subToSplit.id);
        if (index === -1) return prevState;
        const newSubs = [...prevState.subtitles];
        newSubs.splice(index, 1, newSubA, newSubB);
        return { ...prevState, subtitles: newSubs };
      };
      setLiveEditorState(updateFn);
      setEditorState(updateFn);
      setSelectedSubtitleIds([newSubB.id]);
      setLastSelectedSubtitleId(newSubB.id);
  };

  const handleSplitVideoSegment = () => {
      let segmentToSplitIndex = -1;
      let accumulatedDuration = 0;
      for(let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          const rate = segment.playbackRate || 1;
          const segmentVisualDuration = (segment.sourceEndTime - segment.sourceStartTime) / rate;
          if (currentTime >= accumulatedDuration && currentTime < accumulatedDuration + segmentVisualDuration) {
              segmentToSplitIndex = i;
              break;
          }
          accumulatedDuration += segmentVisualDuration;
      }
      if (segmentToSplitIndex === -1) return;

      const segmentToSplit = segments[segmentToSplitIndex];
      const timeIntoVisualSegment = currentTime - accumulatedDuration;
      const rate = segmentToSplit.playbackRate || 1;
      const splitTimeInSource = segmentToSplit.sourceStartTime + (timeIntoVisualSegment * rate);

      if (splitTimeInSource <= segmentToSplit.sourceStartTime + 0.1 || splitTimeInSource >= segmentToSplit.sourceEndTime - 0.1) return;

      const newSegmentA: VideoSegment = { ...segmentToSplit, sourceEndTime: splitTimeInSource };
      const newSegmentB: VideoSegment = { ...segmentToSplit, id: `${Date.now()}-split`, sourceStartTime: splitTimeInSource };

      const updateFn = (prevState: EditorState) => {
        const newSegments = [...prevState.segments];
        newSegments.splice(segmentToSplitIndex, 1, newSegmentA, newSegmentB);
        return { ...prevState, segments: newSegments };
      };
      setLiveEditorState(updateFn);
      setEditorState(updateFn);
  };

  const handleDeleteVideoSegment = (segmentIdToDelete: string) => {
    const updateFn = (prevState: EditorState): EditorState => {
        const segmentIndexToDelete = prevState.segments.findIndex(s => s.id === segmentIdToDelete);
        if (segmentIndexToDelete === -1) return prevState;

        const segmentToDelete = prevState.segments[segmentIndexToDelete];
        const rate = segmentToDelete.playbackRate || 1;
        const deletedSegmentVisualDuration = (segmentToDelete.sourceEndTime - segmentToDelete.sourceStartTime) / rate;

        let timelineStartOfDeletedSegment = 0;
        for (let i = 0; i < segmentIndexToDelete; i++) {
            const seg = prevState.segments[i];
            const segRate = seg.playbackRate || 1;
            timelineStartOfDeletedSegment += (seg.sourceEndTime - seg.sourceStartTime) / segRate;
        }
        const timelineEndOfDeletedSegment = timelineStartOfDeletedSegment + deletedSegmentVisualDuration;

        const updatedSubtitles: SubtitleBlock[] = [];
        for (const sub of prevState.subtitles) {
            const subStart = srtTimeToSeconds(sub.startTime);
            const subEnd = srtTimeToSeconds(sub.endTime);

            if (subEnd <= timelineStartOfDeletedSegment) {
                updatedSubtitles.push(sub);
                continue;
            }

            if (subStart >= timelineEndOfDeletedSegment) {
                const newStart = subStart - deletedSegmentVisualDuration;
                const newEnd = subEnd - deletedSegmentVisualDuration;
                updatedSubtitles.push({
                    ...sub,
                    startTime: secondsToSrtTime(newStart),
                    endTime: secondsToSrtTime(newEnd),
                });
                continue;
            }
        }

        const newSegments = prevState.segments.filter(s => s.id !== segmentIdToDelete);
        return { ...prevState, subtitles: updatedSubtitles, segments: newSegments };
    };
    
    setLiveEditorState(updateFn);
    setEditorState(updateFn);
    setSelectedSegmentIds([]);
  };

  const handleDeleteSubtitle = (subtitleIdToDelete: number) => {
      const updateFn = (prevState: EditorState) => ({
          ...prevState,
          subtitles: prevState.subtitles.filter(s => s.id !== subtitleIdToDelete),
      });
      setLiveEditorState(updateFn);
      setEditorState(updateFn);
      setSelectedSubtitleIds([]);
  };
  
    const handleTimelineInteractionStart = useCallback(() => {
        isInteractingRef.current = true;
        setLiveEditorState(editorState);
    }, [editorState]);
    
    const handleTimelineInteractionEnd = useCallback(() => {
        setEditorState(liveEditorState);
        isInteractingRef.current = false;
    }, [liveEditorState, setEditorState]);

    const handleTimelineUpdate = useCallback((updateFn: (prevState: EditorState) => EditorState) => {
        if (isInteractingRef.current) {
            setLiveEditorState(updateFn);
        }
    }, []);

  const handleSplitItem = () => {
    const activeElement = document.activeElement as HTMLElement;
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
        return;
    }
    if (selectedSubtitleIds.length > 0) {
        handleSplitSubtitle();
    } else {
        handleSplitVideoSegment();
    }
  };
  
  const togglePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
        const playPromise = video.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                if (error.name !== 'AbortError') {
                    console.error("Lỗi khi cố gắng phát video:", error);
                }
            });
        }
    } else {
        video.pause();
    }
  }, []);

  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  
  // Create and manage audio elements for TTS files
  useEffect(() => {
    const audioMap = audioElementsRef.current;
    const urlMap = audioUrlsRef.current;
    let cancelled = false;
    
    // Remove audio elements for deleted files
    const currentFileIds = new Set(audioFiles.map(f => f.id));
    for (const [id, audio] of audioMap.entries()) {
      if (!currentFileIds.has(id)) {
        audio.pause();
        audio.src = '';
        audioMap.delete(id);
        
        // Revoke the URL when removing audio
        const url = urlMap.get(id);
        if (url) {
          URL.revokeObjectURL(url);
          urlMap.delete(id);
        }
      }
    }
    
    // Create audio elements for new files (only if not already loaded)
    const loadAudioFiles = async () => {
      let hasNewUrls = false;
      const newUrls = new Map(urlMap); // Start with existing URLs
      
      for (const audioFile of audioFiles) {
        if (cancelled) break;
        
        // Skip if already loaded
        if (audioMap.has(audioFile.id)) continue;
        
        try {
          const audioUrl = await getFileUrl(audioFile.id);
          if (cancelled) {
            // Clean up the blob URL if component unmounted
            if (audioUrl) {
              URL.revokeObjectURL(audioUrl);
            }
            break;
          }
          
          if (audioUrl) {
            const audio = new Audio();
            audio.src = audioUrl;
            audio.preload = 'auto';
            audio.loop = false;
            
            // Add event listeners for better error handling
            audio.addEventListener('error', (e) => {
              console.error(`Audio load error for ${audioFile.id}:`, e);
            });
            
            audio.addEventListener('canplaythrough', () => {
              console.log(`Audio ready to play: ${audioFile.id}`);
            });
            
            audioMap.set(audioFile.id, audio);
            urlMap.set(audioFile.id, audioUrl); // Store URL for later cleanup
            newUrls.set(audioFile.id, audioUrl); // Add to new URLs map
            hasNewUrls = true;
          }
        } catch (error) {
          if (!cancelled) {
            console.error(`Failed to load audio file ${audioFile.id}:`, error);
          }
        }
      }
      
      // Only update the shared URLs state if there are new URLs
      // This prevents unnecessary re-renders and state updates when audio blocks are just moved
      if (!cancelled && hasNewUrls) {
        setAudioUrls(newUrls);
      }
    };
    
    loadAudioFiles();
    
    return () => {
      cancelled = true;
      // Note: Don't clear or revoke on every effect run, only when component unmounts
      // This prevents the audio from breaking when audioFiles array is recreated
    };
  }, [audioFiles]);
  
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let animationFrameId: number;

    const uiUpdateLoop = () => {
        animationFrameId = requestAnimationFrame(uiUpdateLoop);
        
        const sourceTime = video.currentTime;
        
        const { timelineTime } = mapSourceToTimelineTime(sourceTime);
        if (timelineTime !== null && !isSeeking) {
            setCurrentTime(timelineTime);
        }

        let currentSegment = null;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (sourceTime >= seg.sourceStartTime - 0.01 && sourceTime < seg.sourceEndTime) {
                currentSegment = seg;
                break;
            }
        }

        const rateForCurrentPos = currentSegment?.playbackRate || 1;
        if (video.playbackRate !== rateForCurrentPos) {
            video.playbackRate = rateForCurrentPos;
        }
        if (currentPlaybackRate !== rateForCurrentPos) {
            setCurrentPlaybackRate(rateForCurrentPos);
        }
        
        // Handle audio playback for TTS files
        if (timelineTime !== null) {
            const audioMap = audioElementsRef.current;
            const playingAudio = playingAudioRef.current;
            
            for (const audioFile of audioFiles) {
                const audio = audioMap.get(audioFile.id);
                if (!audio) continue;
                
                const audioStart = audioFile.startTime || 0;
                const audioEnd = audioStart + (audioFile.duration || 0);
                const isInRange = timelineTime >= audioStart && timelineTime < audioEnd;
                
                if (isInRange && !video.paused) {
                    // Should be playing
                    const audioTime = timelineTime - audioStart;
                    const timeDiff = Math.abs(audio.currentTime - audioTime);
                    
                    // Only sync if significantly out of sync (>0.3s) or if not playing
                    if (audio.paused || timeDiff > 0.3) {
                        audio.currentTime = audioTime;
                        if (audio.paused) {
                            audio.play().catch(err => {
                                console.warn(`Audio play failed for ${audioFile.id}:`, err);
                            });
                            playingAudio.add(audioFile.id);
                        }
                    }
                } else {
                    // Should not be playing
                    if (!audio.paused) {
                        audio.pause();
                        playingAudio.delete(audioFile.id);
                    }
                }
            }
        } else {
            // Outside any segment - pause all audio
            const audioMap = audioElementsRef.current;
            const playingAudio = playingAudioRef.current;
            for (const [id, audio] of audioMap.entries()) {
                if (!audio.paused) {
                    audio.pause();
                    playingAudio.delete(id);
                }
            }
        }

        if (!video.paused && !video.seeking) {
            if (!currentSegment) {
                const nextSegment = segments.find(seg => seg.sourceStartTime > sourceTime);
                if (nextSegment) {
                    video.currentTime = nextSegment.sourceStartTime;
                } else {
                    video.pause();
                    if (timelineTime === null) {
                         setCurrentTime(timelineVisualDuration);
                    }
                }
            }
        }
    };
    
    animationFrameId = requestAnimationFrame(uiUpdateLoop);

    return () => {
        cancelAnimationFrame(animationFrameId);
    };
  }, [segments, mapSourceToTimelineTime, isSeeking, currentPlaybackRate, timelineVisualDuration, audioFiles, project.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.target as HTMLElement).tagName.toLowerCase() === 'input' || (e.target as HTMLElement).tagName.toLowerCase() === 'textarea') return;

        if (e.ctrlKey || e.metaKey) {
            if (e.code === 'KeyZ') {
                e.preventDefault();
                undo();
                return;
            }
            if (e.code === 'KeyY') {
                e.preventDefault();
                redo();
                return;
            }
        }

        switch (e.code) {
            case 'Space':
                e.preventDefault();
                togglePlayPause();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                handleSeek(currentTime - (e.shiftKey ? 5 : 1));
                break;
            case 'ArrowRight':
                e.preventDefault();
                handleSeek(currentTime + (e.shiftKey ? 5 : 1));
                break;
            case 'KeyB':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    handleSplitItem();
                }
                break;
            case 'Delete':
            case 'Backspace':
                if (selectedSegmentIds.length > 0) {
                    e.preventDefault();
                    selectedSegmentIds.forEach(handleDeleteVideoSegment)
                } else if (selectedSubtitleIds.length > 0) {
                    e.preventDefault();
                    selectedSubtitleIds.forEach(handleDeleteSubtitle)
                }
                break;
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlayPause, handleSplitItem, selectedSegmentIds, currentTime, selectedSubtitleIds, undo, redo, handleDeleteVideoSegment, handleDeleteSubtitle, handleSeek]);

  const handleSelectSegment = (segmentId: string, e: React.MouseEvent) => {
    setSelectedSubtitleIds([]);
    setLastSelectedSubtitleId(null);
    
    const isCtrlOrMeta = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    const orderedSegmentIds = segments.map(s => s.id);

    if (isShift && lastSelectedSegmentId && selectedSegmentIds.length > 0) {
        const lastIndex = orderedSegmentIds.indexOf(lastSelectedSegmentId);
        const currentIndex = orderedSegmentIds.indexOf(segmentId);
        if (lastIndex === -1 || currentIndex === -1) {
            setSelectedSegmentIds([segmentId]);
        } else {
            const start = Math.min(lastIndex, currentIndex);
            const end = Math.max(lastIndex, currentIndex);
            setSelectedSegmentIds(orderedSegmentIds.slice(start, end + 1));
        }
    } else if (isCtrlOrMeta) {
        setSelectedSegmentIds(prev =>
            prev.includes(segmentId)
                ? prev.filter(id => id !== segmentId)
                : [...prev, segmentId]
        );
    } else {
        setSelectedSegmentIds(prev => (prev.length === 1 && prev[0] === segmentId) ? prev : [segmentId]);
    }
    setLastSelectedSegmentId(segmentId);
};

const handleSelectSubtitle = (subtitleId: number, e: React.MouseEvent) => {
    setSelectedSegmentIds([]);
    setLastSelectedSegmentId(null);

    const isCtrlOrMeta = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    const orderedSubtitleIds = subtitles.map(s => s.id);

    if (isShift && lastSelectedSubtitleId !== null && selectedSubtitleIds.length > 0) {
        const lastIndex = orderedSubtitleIds.indexOf(lastSelectedSubtitleId);
        const currentIndex = orderedSubtitleIds.indexOf(subtitleId);
        if (lastIndex === -1 || currentIndex === -1) {
            setSelectedSubtitleIds([subtitleId]);
        } else {
            const start = Math.min(lastIndex, currentIndex);
            const end = Math.max(lastIndex, currentIndex);
            setSelectedSubtitleIds(orderedSubtitleIds.slice(start, end + 1));
        }
    } else if (isCtrlOrMeta) {
        setSelectedSubtitleIds(prev =>
            prev.includes(subtitleId)
                ? prev.filter(id => id !== subtitleId)
                : [...prev, subtitleId]
        );
    } else {
        setSelectedSubtitleIds(prev => (prev.length === 1 && prev[0] === subtitleId) ? prev : [subtitleId]);
    }
    setLastSelectedSubtitleId(subtitleId);
};

const handleDeselectAll = () => {
    setSelectedSegmentIds([]);
    setSelectedSubtitleIds([]);
    setLastSelectedSegmentId(null);
    setLastSelectedSubtitleId(null);
}
  
const handleMarqueeSelect = (segmentIds: string[], subtitleIds: number[], isAdditive: boolean) => {
    if (segmentIds.length > 0) {
        setSelectedSubtitleIds([]);
        setLastSelectedSubtitleId(null);
        setSelectedSegmentIds(prev => {
            if (isAdditive) {
                const newSet = new Set([...prev, ...segmentIds]);
                return Array.from(newSet);
            }
            return segmentIds;
        });
    } else if (subtitleIds.length > 0) {
        setSelectedSegmentIds([]);
        setLastSelectedSegmentId(null);
        setSelectedSubtitleIds(prev => {
            if (isAdditive) {
                const newSet = new Set([...prev, ...subtitleIds]);
                return Array.from(newSet);
            }
            return subtitleIds;
        });
    }
};

    const handleAnalyzeHardsubs = async () => {
        if (!videoRef.current || videoDuration === 0) {
            alert("Video chưa được tải xong. Vui lòng thử lại sau.");
            return;
        }
        setIsAnalyzingHardsubs(true);

        const video = videoRef.current;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            setIsAnalyzingHardsubs(false);
            return;
        }
        
        let worker: Tesseract.Worker | null = null;
        try {
            setAnalysisProgress({ progress: 0, status: 'Đang khởi tạo AI...' });
            worker = await Tesseract.createWorker('chi_sim', 1, {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        setAnalysisProgress(prev => ({ ...prev, progress: m.progress }));
                    }
                }
            });

            const allBBoxes: Tesseract.Bbox[] = [];
            const NUM_SAMPLES = 20;
            const sampleInterval = videoDuration / (NUM_SAMPLES + 1);

            for (let i = 1; i <= NUM_SAMPLES; i++) {
                const sampleTime = i * sampleInterval;
                setAnalysisProgress({ progress: 0, status: `Đang quét khung hình ${i}/${NUM_SAMPLES}...` });

                video.currentTime = sampleTime;
                await new Promise(resolve => {
                    const onSeeked = () => {
                        video.removeEventListener('seeked', onSeeked);
                        resolve(true);
                    };
                    video.addEventListener('seeked', onSeeked);
                });
                
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const { data } = await worker.recognize(canvas);
                
                data.lines.forEach(line => {
                    if (line.confidence > 60 && line.bbox.y0 > canvas.height * 0.7) {
                        allBBoxes.push(line.bbox);
                    }
                });
            }

            if (allBBoxes.length > 0) {
                // Find overall horizontal extent and the absolute bottom edge
                let minX = canvas.width, maxX = 0, maxY = 0;
                allBBoxes.forEach(box => {
                    minX = Math.min(minX, box.x0);
                    maxX = Math.max(maxX, box.x1);
                    maxY = Math.max(maxY, box.y1);
                });

                // Calculate the median height of detected subtitle lines for a robust height estimate
                const heights = allBBoxes.map(b => b.y1 - b.y0).sort((a, b) => a - b);
                const medianHeight = heights[Math.floor(heights.length / 2)] || 20;

                // Define the box anchored to the bottom, tall enough for two lines
                const newMinY = maxY - (medianHeight * 2.5);

                // Use smaller padding to create a tighter box
                const PADDING_Y = 0.5; // smaller vertical padding
                const PADDING_X = 1.0;

                const newCoverBox: BoundingBox = {
                    x: Math.max(0, (minX / canvas.width) * 100 - PADDING_X),
                    y: Math.max(0, (newMinY / canvas.height) * 100 - PADDING_Y),
                    width: Math.min(100, ((maxX - minX) / canvas.width) * 100 + 2 * PADDING_X),
                    height: Math.min(100, ((maxY - newMinY) / canvas.height) * 100 + 2 * PADDING_Y),
                    enabled: true,
                };
                
                const updateFn = (prevState: EditorState) => ({...prevState, hardsubCoverBox: newCoverBox });
                setLiveEditorState(updateFn);
                setEditorState(updateFn);
                alert("Đã phát hiện và tạo vùng che hardsub!");
            } else {
                alert("Không phát hiện thấy hardsub ở cuối video.");
            }

        } catch (error) {
            console.error("Lỗi khi phân tích hardsub:", error);
            alert(`Đã xảy ra lỗi: ${error}`);
        } finally {
            await worker?.terminate();
            setIsAnalyzingHardsubs(false);
            setAnalysisProgress({ progress: 0, status: '' });
        }
    };
    
    const handleUpdateHardsubBox = (box: BoundingBox) => {
        const updateFn = (prevState: EditorState) => ({...prevState, hardsubCoverBox: box });
        setLiveEditorState(updateFn);
        setEditorState(updateFn);
    };

    const handleSubtitleStyleChange = (newStyle: SubtitleStyle) => {
        onUpdateProject(project.id, { subtitleStyle: newStyle });
    };

    // Load TTS voices on mount
    useEffect(() => {
        listTTSVoices()
            .then(voices => setTtsVoices(voices))
            .catch(err => console.error('Failed to load TTS voices:', err));
    }, []);

    const handleGenerateTTS = async (subtitles: SubtitleBlock[]) => {
        if (subtitles.length === 0) {
            alert('Không có phụ đề để tạo TTS');
            return;
        }

        // Filter out empty subtitles (using translated text)
        const validSubtitles = subtitles.filter(sub => sub.text.trim().length > 0);
        if (validSubtitles.length === 0) {
            alert('Không có phụ đề bản dịch hợp lệ (tất cả đều trống)');
            return;
        }

        setIsGeneratingTTS(true);
        try {
            const response = await generateBatchTTS(project.id, validSubtitles, selectedTtsVoice);
            
            if (response.errors.length > 0) {
                console.warn('Some TTS generations failed:', response.errors);
            }

            if (response.generated.length === 0) {
                alert('Không thể tạo TTS cho bất kỳ phụ đề nào. Vui lòng kiểm tra log và đảm bảo backend đang chạy.');
                return;
            }

            // Create AudioFile objects for the generated TTS
            const newAudioFiles: AudioFile[] = response.generated.map(item => ({
                id: item.file_id,
                name: item.filename,
                type: 'audio',
                startTime: item.start_time,
                track: item.track,
                storagePath: item.storage_path,
                fileSize: item.file_size,
                uploadedAt: item.created_at,
                duration: item.duration,
            }));

            // Update editor state with new audio files
            const updateFn = (prevState: EditorState) => ({
                ...prevState,
                audioFiles: [...prevState.audioFiles, ...newAudioFiles]
            });
            setLiveEditorState(updateFn);
            setEditorState(updateFn);

            // Also update project files
            onUpdateProject(project.id, p => ({
                files: [...p.files, ...newAudioFiles]
            }));

            alert(`Đã tạo thành công ${response.generated.length} track TTS từ bản dịch!${response.errors.length > 0 ? ` (${response.errors.length} lỗi)` : ''}`);
        } catch (error) {
            console.error('Failed to generate TTS:', error);
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            if (errorMsg.includes('Failed to fetch') || errorMsg.includes('ERR_CONNECTION_REFUSED')) {
                alert('Lỗi kết nối: Backend không chạy. Vui lòng khởi động backend (uvicorn) trước khi tạo TTS.');
            } else {
                alert(`Lỗi khi tạo TTS: ${errorMsg}`);
            }
        } finally {
            setIsGeneratingTTS(false);
        }
    };

  // Cleanup effect on component unmount
  useEffect(() => {
    return () => {
      // Clean up all audio elements and URLs
      const audioMap = audioElementsRef.current;
      const urlMap = audioUrlsRef.current;
      
      for (const audio of audioMap.values()) {
        audio.pause();
        audio.src = '';
      }
      audioMap.clear();
      
      for (const url of urlMap.values()) {
        URL.revokeObjectURL(url);
      }
      urlMap.clear();
      
      playingAudioRef.current.clear();
    };
  }, []);

  return (
    <div ref={editorContainerRef} className="bg-gray-900 text-white h-screen flex flex-col overflow-hidden">
      <header className="bg-gray-800 p-2 flex items-center justify-between border-b border-gray-700 flex-shrink-0 z-20">
        <div className="flex items-center">
          <button onClick={handleExit} className="mr-4 text-gray-400 hover:text-white"><BackArrowIcon /></button>
          <div>
            <h1 className="text-lg font-bold">{project.name}</h1>
            <p className="text-xs text-gray-400">{initialVideoFile.name}</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
            <button
                onClick={() => navigateToVideo('previous')}
                disabled={!canGoToPrevious}
                className="p-2 rounded-md text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                title="Video trước"
            >
                <ChevronLeftIcon className="w-5 h-5" />
            </button>
            <button
                onClick={() => navigateToVideo('next')}
                disabled={!canGoToNext}
                className="p-2 rounded-md text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                title="Video tiếp theo"
            >
                <ChevronRightIcon className="w-5 h-5" />
            </button>
        </div>
      </header>
      
      <div className="flex-grow flex flex-col min-h-0 relative">
          <div className="flex-grow flex" style={{ height: `${100 - panels.timeline}%`}}>
            <div className="relative" style={{ width: `${panels.video}%` }}>
                <VideoPlayer
                    videoRef={videoRef}
                    videoUrl={videoUrl}
                    isLoading={isLoading}
                    segments={segments}
                    masterVolumeDb={masterVolumeDb}
                    isMuted={isMuted}
                    activeSubtitlesText={activeSubtitlesText}
                    subtitleStyle={project.subtitleStyle}
                    hardsubCoverBox={hardsubCoverBox}
                    isOverlayVisible={isOverlayVisible}
                    // FIX: Cannot find name 'onTogglePlayPause'. Did you mean 'togglePlayPause'?
                    onTogglePlayPause={togglePlayPause}
                    onLoadedMetadata={() => {
                       if (videoRef.current) {
                           const duration = videoRef.current.duration;
                           setVideoDuration(duration);
                           if (!segments || segments.length === 0) {
                               const initialSegments = [{ id: 'initial', sourceStartTime: 0, sourceEndTime: duration, playbackRate: 1, volumeDb: 0 }];
                               const updateFn = (prevState: EditorState) => ({ ...prevState, segments: initialSegments });
                               setLiveEditorState(updateFn);
                               setEditorState(updateFn);
                           }
                       }
                    }}
                    onPlay={handlePlay}
                    onPause={handlePause}
                    onSubtitleStyleChange={handleSubtitleStyleChange}
                />
            </div>
            <div onMouseDown={handleMouseDown('horizontal')} className="w-1.5 bg-gray-700 cursor-col-resize hover:bg-indigo-500 transition-colors flex-shrink-0 z-10" />
            <div className="flex flex-col" style={{ width: `${100 - panels.video}%` }}>
                <div className="flex-shrink-0 border-b border-gray-700">
                    <div className="flex">
                        <button 
                            onClick={() => setActiveRightTab('subtitles')} 
                            className={`flex-1 p-2 text-center text-sm font-semibold transition-colors ${activeRightTab === 'subtitles' ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700/50'}`}
                        >
                            Phụ đề
                        </button>
                        <button 
                            onClick={() => setActiveRightTab('style')} 
                            className={`flex-1 p-2 text-center text-sm font-semibold transition-colors ${activeRightTab === 'style' ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700/50'}`}
                        >
                            Style
                        </button>
                    </div>
                </div>
                <div className="flex-grow relative min-h-0">
                  <div className="absolute inset-0">
                      {activeRightTab === 'subtitles' && (
                          <SubtitleEditor
                              subtitles={subtitles}
                              activeSubtitleId={activeSubtitleId}
                              onSubtitleClick={(sub) => handleSeek(srtTimeToSeconds(sub.startTime))}
                              onUpdateSubtitle={handleUpdateSubtitle}
                              onGenerateTTS={handleGenerateTTS}
                              isGeneratingTTS={isGeneratingTTS}
                          />
                      )}
                      {activeRightTab === 'style' && (
                          <StyleEditor
                              project={project}
                              videoFile={videoFile}
                              onUpdateProject={onUpdateProject}
                              onAnalyzeHardsubs={handleAnalyzeHardsubs}
                              isAnalyzingHardsubs={isAnalyzingHardsubs}
                              analysisProgress={analysisProgress}
                              onUpdateHardsubBox={handleUpdateHardsubBox}
                          />
                      )}
                  </div>
                </div>
            </div>
          </div>
          
          <div onMouseDown={handleMouseDown('vertical')} className="h-1.5 bg-gray-700 cursor-row-resize hover:bg-indigo-500 transition-colors flex-shrink-0 z-10" />

          <div className="relative p-2 flex flex-col bg-gray-800" style={{ height: `${panels.timeline}%`}}>
            <EditorControls 
              videoRef={videoRef}
              isPlaying={isPlaying}
              onTogglePlayPause={togglePlayPause}
              currentTime={currentTime}
              duration={timelineVisualDuration}
              selectedSegmentIds={selectedSegmentIds}
              segments={segments}
              onBatchUpdateSegments={handleBatchUpdateSegments}
              zoom={zoom}
              setZoom={setZoom}
              onSplitItem={handleSplitItem}
              onUndo={undo}
              onRedo={redo}
              canUndo={canUndo}
              canRedo={canRedo}
            />
            <Timeline
              videoFile={videoFile}
              videoUrl={videoUrl}
              subtitles={subtitles}
              audioFiles={audioFiles}
              audioUrls={audioUrls}
              onTimelineUpdate={handleTimelineUpdate}
              onTimelineInteractionStart={handleTimelineInteractionStart}
              onTimelineInteractionEnd={handleTimelineInteractionEnd}
              onBatchUpdateSubtitles={handleBatchUpdateSubtitles}
              currentTime={currentTime}
              onSeek={handleSeek}
              onSeeking={setIsSeeking}
              timelineVisualDuration={timelineVisualDuration}
              zoom={zoom}
              isPlaying={isPlaying}
              isOverlayVisible={isOverlayVisible}
              onToggleOverlayVisibility={() => setIsOverlayVisible(v => !v)}
              selectedSegmentIds={selectedSegmentIds}
              onSelectSegment={handleSelectSegment}
              selectedSubtitleIds={selectedSubtitleIds}
              onSelectSubtitle={handleSelectSubtitle}
              onDeselectAll={handleDeselectAll}
              onMarqueeSelect={handleMarqueeSelect}
              isMuted={isMuted}
              onToggleMute={() => setIsMuted(m => !m)}
            />
          </div>
      </div>
    </div>
  );
};

export default ProfessionalVideoEditor;

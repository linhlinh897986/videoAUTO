import React, { useState, useMemo, useEffect } from 'react';
import JSZip from 'jszip';
import { Project, SrtFile, CustomStyle, KeywordPair, Character, ApiKey, SubtitleBlock, ContextItem, VideoFile, AudioFile } from '../../types';
import { parseSrt, composeSrt, formatForGemini } from '../../services/srtParser';
import { batchTranslateFiles, countTokensInText } from '../../services/geminiService';
import { saveVideo, deleteVideo, getVideoUrl, getStoredFileInfo, generateMissingSrtsFromAsr } from '../../services/projectService';
import { analyzeVideoForHardsubs, preloadAudioBuffer } from '../../services/videoAnalysisService';
import {
  UploadIcon, TrashIcon, TranslateIcon, DownloadIcon,
  LoadingSpinner, DownloadAllIcon, ClipboardIcon, FilmIcon, ClapperboardEditLinear, AudioWaveIcon, SubtitlesIcon
} from '../ui/Icons';


interface ProjectFilesProps {
  project: Project;
  onUpdateProject: (projectId: string, updates: Partial<Project> | ((p: Project) => Partial<Project>)) => void;
  onEditVideo: (videoId: string, srtId: string) => void;
  processingStatus: { [id: string]: string };
  setProcessingStatus: React.Dispatch<React.SetStateAction<{ [id: string]: string }>>;
}


const ProjectFiles: React.FC<ProjectFilesProps> = ({ project, onUpdateProject, onEditVideo, processingStatus, setProcessingStatus }) => {
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [activelyTranslating, setActivelyTranslating] = useState<Set<string>>(new Set());
  const [clipboardMessage, setClipboardMessage] = useState<string | null>(null);
  const [isGeneratingSrts, setIsGeneratingSrts] = useState<boolean>(false);
  
  const srtFiles = useMemo(() => project.files.filter((f): f is SrtFile => f.type === 'srt'), [project.files]);
  const sortedFiles = useMemo(() => {
    return [...project.files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }, [project.files]);
  
  const totalTokens = useMemo(() => srtFiles.reduce((acc, file) => acc + (file.tokenCount || 0), 0), [srtFiles]);

  const isProcessingAnyFile = Object.keys(processingStatus).length > 0;

  useEffect(() => {
    const fileExists = sortedFiles.some(f => f.id === selectedFileId);
    if (!selectedFileId && sortedFiles.length > 0) {
      setSelectedFileId(sortedFiles[0].id);
    }
    else if (selectedFileId && !fileExists) {
      setSelectedFileId(sortedFiles[0]?.id || null);
    }
  }, [sortedFiles, selectedFileId]);

  useEffect(() => {
    if (!clipboardMessage) return;
    const timeout = setTimeout(() => setClipboardMessage(null), 2500);
    return () => clearTimeout(timeout);
  }, [clipboardMessage]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const filesToProcess = Array.from(e.target.files);
    e.target.value = '';

    const newSrtFiles: SrtFile[] = [];
    const newVideoFiles: { file: File, videoInfo: VideoFile }[] = [];
    const newAudioFiles: { file: File, audioInfo: AudioFile }[] = [];
    const tempStatus: {[id: string]: string} = {};

    const existingAudioFiles = project.files.filter((f): f is AudioFile => f.type === 'audio');
    let nextAudioTrack = existingAudioFiles.length > 0 ? Math.max(...existingAudioFiles.map(f => f.track ?? 0)) + 1 : 0;

    for (const file of filesToProcess) {
        const currentFile = file as File;
        const fileId = `${Date.now()}-${currentFile.name}`;
        const fileNameLower = currentFile.name.toLowerCase();
        tempStatus[fileId] = 'Đang chờ...';

        if (fileNameLower.endsWith('.srt')) {
            const fileContent = await currentFile.text();
            const originalSubtitles = parseSrt(fileContent);
            
            newSrtFiles.push({
                id: fileId,
                name: currentFile.name,
                type: 'srt',
                originalSubtitles,
                translatedSubtitles: originalSubtitles.map(sub => ({ ...sub, text: '' })),
            });
        } else if (fileNameLower.endsWith('.mp4') || fileNameLower.endsWith('.mov') || fileNameLower.endsWith('.avi') || fileNameLower.endsWith('.mkv')) {
            const newVideoInfo: VideoFile = {
                id: fileId,
                name: currentFile.name,
                type: 'video',
                segments: [],
                masterVolumeDb: 0,
            };
            newVideoFiles.push({ file: currentFile, videoInfo: newVideoInfo });
        } else if (fileNameLower.endsWith('.mp3')) {
            const newAudioInfo: AudioFile = {
                id: fileId,
                name: currentFile.name,
                type: 'audio',
                startTime: 0,
                track: nextAudioTrack,
            };
            newAudioFiles.push({ file: currentFile, audioInfo: newAudioInfo });
            nextAudioTrack++;
        }
    }
    
    // Immediately update UI with all files so user sees them
    const allNewFiles = [
        ...newSrtFiles,
        ...newVideoFiles.map(v => v.videoInfo),
        ...newAudioFiles.map(a => a.audioInfo)
    ];
    if(allNewFiles.length > 0) {
        onUpdateProject(project.id, p => ({ files: [...p.files, ...allNewFiles] }));
        if(!selectedFileId) setSelectedFileId(allNewFiles[0].id);
    }
    setProcessingStatus(prev => ({...prev, ...tempStatus}));

    // --- Start background processing ---

    // Process SRT token counts
    for (const srtFile of newSrtFiles) {
        try {
            setProcessingStatus(prev => ({ ...prev, [srtFile.id]: 'Đang đếm token...' }));
            const tokenCount = srtFile.originalSubtitles.length > 0
                ? await countTokensInText(formatForGemini(srtFile.originalSubtitles), project.model || 'gemini-2.5-flash', project)
                : 0;
            onUpdateProject(project.id, p => ({
                files: p.files.map(f => f.id === srtFile.id ? { ...f, tokenCount } : f)
            }));
            setProcessingStatus(prev => { const s = {...prev}; delete s[srtFile.id]; return s; });
        } catch (error) {
            console.error(`Error counting tokens for ${srtFile.name}:`, error);
            setProcessingStatus(prev => ({ ...prev, [srtFile.id]: 'Lỗi đếm token' }));
        }
    }

    // Process videos
    for (const { file, videoInfo } of newVideoFiles) {
        try {
            setProcessingStatus(prev => ({ ...prev, [videoInfo.id]: 'Đang lưu video...' }));
            const uploadResult = await saveVideo(project.id, videoInfo.id, file);
            const videoUrl = await getVideoUrl(videoInfo.id);

            if (videoUrl) {
                const waveformPromise = project.autoGenerateWaveform
                    ? (async () => {
                        setProcessingStatus(prev => ({ ...prev, [videoInfo.id]: 'Đang tạo waveform...' }));
                        await preloadAudioBuffer(videoUrl);
                      })()
                    : Promise.resolve();
                
                const hardsubPromise = project.autoAnalyzeHardsubs
                    ? (async () => {
                        setProcessingStatus(prev => ({ ...prev, [videoInfo.id]: 'Đang phân tích hardsub...' }));
                        const hardsubBox = await analyzeVideoForHardsubs(videoUrl, (progress) => {
                             setProcessingStatus(prev => ({ ...prev, [videoInfo.id]: `Phân tích... ${(progress * 100).toFixed(0)}%` }));
                        });
                        if (hardsubBox) {
                            onUpdateProject(project.id, p => ({
                                files: p.files.map(f => f.id === videoInfo.id ? { ...f, hardsubCoverBox: hardsubBox } : f)
                            }));
                        }
                      })()
                    : Promise.resolve();

                await Promise.all([waveformPromise, hardsubPromise]);
            }
            if (uploadResult.path || uploadResult.size || uploadResult.created_at) {
                onUpdateProject(project.id, p => ({
                    files: p.files.map(f => f.id === videoInfo.id ? {
                        ...f,
                        storagePath: uploadResult.path ?? (f as VideoFile).storagePath,
                        fileSize: uploadResult.size ?? (f as VideoFile).fileSize,
                        uploadedAt: uploadResult.created_at ?? (f as VideoFile).uploadedAt,
                    } : f)
                }));
            }
            setProcessingStatus(prev => { const s = {...prev}; delete s[videoInfo.id]; return s; });
        } catch (error) {
            console.error(`Error processing video ${videoInfo.name}:`, error);
            setProcessingStatus(prev => ({ ...prev, [videoInfo.id]: 'Lỗi xử lý video' }));
        }
    }

    // Process audio files
    for (const { file, audioInfo } of newAudioFiles) {
        try {
            setProcessingStatus(prev => ({ ...prev, [audioInfo.id]: 'Đang lưu audio...' }));
            const uploadResult = await saveVideo(project.id, audioInfo.id, file);
            const audioUrl = await getVideoUrl(audioInfo.id);

            if (audioUrl) {
                const audioElement = document.createElement('audio');
                audioElement.src = audioUrl;
                const duration = await new Promise<number>((resolve, reject) => {
                    audioElement.onloadedmetadata = () => resolve(audioElement.duration);
                    audioElement.onerror = () => reject('Error loading audio metadata');
                });
                
                onUpdateProject(project.id, p => ({
                    files: p.files.map(f => f.id === audioInfo.id ? { ...f, duration } : f)
                }));

                setProcessingStatus(prev => ({ ...prev, [audioInfo.id]: 'Đang tạo waveform...' }));
                await preloadAudioBuffer(audioUrl);
            }
            if (uploadResult.path || uploadResult.size || uploadResult.created_at) {
                onUpdateProject(project.id, p => ({
                    files: p.files.map(f => f.id === audioInfo.id ? {
                        ...f,
                        storagePath: uploadResult.path ?? (f as AudioFile).storagePath,
                        fileSize: uploadResult.size ?? (f as AudioFile).fileSize,
                        uploadedAt: uploadResult.created_at ?? (f as AudioFile).uploadedAt,
                    } : f)
                }));
            }
            setProcessingStatus(prev => { const s = {...prev}; delete s[audioInfo.id]; return s; });
        } catch (error) {
            console.error(`Error processing audio ${audioInfo.name}:`, error);
            setProcessingStatus(prev => ({ ...prev, [audioInfo.id]: 'Lỗi xử lý audio' }));
        }
    }
  };
  
  const handleDeleteFile = (fileId: string) => {
    const fileToDelete = project.files.find(f => f.id === fileId);
    if (fileToDelete?.type === 'video' || fileToDelete?.type === 'audio') {
        deleteVideo(fileId).catch(err => console.error(`Failed to delete media ${fileId}`, err));
    }
    onUpdateProject(project.id, (p) => ({
      files: p.files.filter(f => f.id !== fileId)
    }));
  };

  const handleDeleteAllFiles = () => {
    if (project.files.length === 0) return;
    project.files.forEach(file => {
        if (file.type === 'video' || file.type === 'audio') {
            deleteVideo(file.id).catch(err => console.error(`Failed to delete media ${file.id}`, err));
        }
    });
    onUpdateProject(project.id, { files: [] });
    setSelectedFileId(null);
  };

  const createTranslationCallbacks = () => ({
    onFileStart: (id: string) => setActivelyTranslating(prev => new Set(prev).add(id)),
    onFileProgress: (id: string, progressSubtitles: SubtitleBlock[]) => {
        onUpdateProject(project.id, p => ({
            files: p.files.map(f => (f.id === id && f.type === 'srt') ? { ...f, translatedSubtitles: progressSubtitles } : f)
        }));
    },
    onFileComplete: (id: string, finalSubtitles: SubtitleBlock[], status: 'success' | 'error') => {
        onUpdateProject(project.id, p => ({
            files: p.files.map(f => (f.id === id && f.type === 'srt') ? { ...f, translatedSubtitles: finalSubtitles, translationStatus: status } : f)
        }));
        setActivelyTranslating(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  });

  const handleTranslate = async (fileId: string) => {
    const fileToTranslate = srtFiles.find(f => f.id === fileId);
    if (!fileToTranslate) return;

    onUpdateProject(project.id, p => ({
      files: p.files.map(f => f.id === fileId ? { ...f, translationStatus: undefined } as SrtFile : f)
    }));
    
    await batchTranslateFiles([fileToTranslate], project, createTranslationCallbacks());
  };
  
  const handleTranslateAll = async () => {
      const filesToTranslate = srtFiles.filter(f => f.translationStatus !== 'success');
      if (filesToTranslate.length === 0) return;

      const fileIdsToTranslate = new Set(filesToTranslate.map(f => f.id));
      onUpdateProject(project.id, p => ({
          files: p.files.map(f => (fileIdsToTranslate.has(f.id) && f.type === 'srt') ? { ...f, translationStatus: undefined } : f)
      }));

      await batchTranslateFiles(filesToTranslate, project, createTranslationCallbacks());
  };

  const handleDownload = (fileId: string) => {
    const file = srtFiles.find(f => f.id === fileId);
    if (file && file.translatedSubtitles) {
      const srtContent = composeSrt(file.translatedSubtitles);
      const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${file.name.replace('.srt', '')}_translated.srt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleCopy = async (fileId: string) => {
    const file = srtFiles.find(f => f.id === fileId);
    if (file && file.translatedSubtitles && file.translationStatus === 'success') {
      const srtContent = composeSrt(file.translatedSubtitles);
      try {
        await navigator.clipboard.writeText(srtContent);
        console.log(`Nội dung của '${file.name}' đã được sao chép vào clipboard.`);
      } catch (error) {
        console.error("Không thể sao chép nội dung SRT:", error);
      }
    }
  };
  
  const handleDownloadAll = async () => {
    const zip = new JSZip();
    const translatedFiles = srtFiles.filter(file => file.translationStatus === 'success' && file.translatedSubtitles);

    if (translatedFiles.length === 0) {
        alert("Không có tệp đã dịch thành công để tải xuống.");
        return;
    }

    translatedFiles.forEach(file => {
        const srtContent = composeSrt(file.translatedSubtitles);
        const fileName = `${file.name.replace(/\.srt$/i, '')}_translated.srt`;
        zip.file(fileName, srtContent);
    });

    const content = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    const safeProjectName = project.name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
    link.download = `${safeProjectName || 'project'}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleGenerateSrtsFromAsr = async () => {
    if (isGeneratingSrts) {
        return;
    }
    setIsGeneratingSrts(true);
    try {
        const response = await generateMissingSrtsFromAsr(project.id);
        const generatedItems = (response.generated || []).filter(item => (item?.srt_content || '').trim().length > 0);
        const missingAudioSources = (response.missing_sources || []).filter(item => item.reason === 'no-audio-source').length;
        const missingAudioTracks = (response.missing_sources || []).filter(item => item.reason === 'no-audio-track').length;
        const conversionErrors = (response.errors || []).filter(item => item.reason === 'audio-conversion-failed').length;
        const ffmpegMissingErrors = (response.errors || []).filter(item => item.reason === 'ffmpeg-missing').length;
        const bcutErrors = (response.errors || []).filter(item => item.reason === 'bcut-error').length;

        if (generatedItems.length === 0) {
            if (missingAudioSources > 0) {
                setClipboardMessage('Không tìm thấy âm thanh tương ứng cho một số tệp. Hãy tải lên hoặc kiểm tra lại nguồn audio.');
                return;
            }
            if (missingAudioTracks > 0) {
                setClipboardMessage('Một số video không chứa track âm thanh để trích xuất. Vui lòng kiểm tra lại nội dung gốc.');
                return;
            }
            if (conversionErrors > 0) {
                setClipboardMessage('Không thể trích xuất âm thanh bằng ffmpeg cho một số tệp. Kiểm tra log để biết chi tiết.');
                return;
            }
            if (ffmpegMissingErrors > 0) {
                setClipboardMessage('Máy chủ thiếu ffmpeg nên không thể tách âm thanh tự động.');
                return;
            }
            if (bcutErrors > 0) {
                setClipboardMessage('Bcut báo lỗi khi tạo phụ đề. Vui lòng thử lại sau.');
                return;
            }
            const hasPendingMedia = (response.missing_sources?.length || 0) > 0;
            const message = hasPendingMedia
                ? 'Không tìm thấy dữ liệu ASR phù hợp cho các tệp chưa có phụ đề.'
                : 'Tất cả tệp đã có phụ đề hoặc không có tệp nào cần tạo.';
            setClipboardMessage(message);
            return;
        }

        const newSrtFiles: SrtFile[] = [];
        for (const item of generatedItems) {
            const subtitles = parseSrt(item.srt_content ?? '');
            if (subtitles.length === 0) {
                console.warn('Generated ASR subtitle is empty after parsing', item);
                continue;
            }
            const fallbackName = item.file_name ? item.file_name.replace(/\.[^/.]+$/, '') + '.srt' : `subtitle-${Date.now()}.srt`;
            const fileName = item.srt_filename || fallbackName;
            const generatedId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID()
                : `asr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            newSrtFiles.push({
                id: generatedId,
                name: fileName,
                type: 'srt',
                originalSubtitles: subtitles,
                translatedSubtitles: subtitles.map(sub => ({ ...sub, text: '' })),
            });
        }

        if (newSrtFiles.length === 0) {
            setClipboardMessage('Không thể phân tích phụ đề ASR được tạo.');
            return;
        }

        onUpdateProject(project.id, p => ({
            files: [...p.files, ...newSrtFiles],
        }));
        setSelectedFileId(newSrtFiles[0].id);

        // Process SRT token counts for generated files
        for (const srtFile of newSrtFiles) {
            try {
                setProcessingStatus(prev => ({ ...prev, [srtFile.id]: 'Đang đếm token...' }));
                const tokenCount = srtFile.originalSubtitles.length > 0
                    ? await countTokensInText(formatForGemini(srtFile.originalSubtitles), project.model || 'gemini-2.5-flash', project)
                    : 0;
                onUpdateProject(project.id, p => ({
                    files: p.files.map(f => f.id === srtFile.id ? { ...f, tokenCount } : f)
                }));
                setProcessingStatus(prev => { const s = {...prev}; delete s[srtFile.id]; return s; });
            } catch (error) {
                console.error(`Error counting tokens for ${srtFile.name}:`, error);
                setProcessingStatus(prev => ({ ...prev, [srtFile.id]: 'Lỗi đếm token' }));
                // Clear error status after 3 seconds
                setTimeout(() => {
                    setProcessingStatus(prev => { const s = {...prev}; delete s[srtFile.id]; return s; });
                }, 3000);
            }
        }

        const extraNotices: string[] = [];
        if (missingAudioSources > 0) {
            extraNotices.push(`${missingAudioSources} tệp chưa có nguồn âm thanh`);
        }
        if (missingAudioTracks > 0) {
            extraNotices.push(`${missingAudioTracks} video không có track âm thanh`);
        }
        const remainingMissing = (response.missing_sources?.length || 0) - missingAudioSources - missingAudioTracks;
        if (remainingMissing > 0) {
            extraNotices.push(`${remainingMissing} tệp thiếu dữ liệu ASR`);
        }
        if (conversionErrors > 0) {
            extraNotices.push(`${conversionErrors} lỗi khi trích xuất audio bằng ffmpeg`);
        }
        if (ffmpegMissingErrors > 0) {
            extraNotices.push('Thiếu ffmpeg trên máy chủ');
        }
        if (bcutErrors > 0) {
            extraNotices.push(`${bcutErrors} lỗi từ Bcut`);
        }
        const autoExtractedCount = generatedItems.filter(item => item.audio_source_type === 'video').length;
        if (autoExtractedCount > 0) {
            extraNotices.push(`Đã tự động tách âm thanh cho ${autoExtractedCount} video`);
        }
        const statusMessage = [`Đã thêm ${newSrtFiles.length} phụ đề từ ASR/Bcut.`];
        if (extraNotices.length > 0) {
            statusMessage.push(extraNotices.join('. '));
        }
        setClipboardMessage(statusMessage.join(' '));
    } catch (error) {
        console.error('Failed to generate SRT files from ASR data', error);
        setClipboardMessage(error instanceof Error ? `Lỗi tạo SRT: ${error.message}` : 'Lỗi tạo SRT từ ASR.');
    } finally {
        setIsGeneratingSrts(false);
    }
  };
  
    const handleEditVideo = (videoFile: VideoFile) => {
    const srtFileName = videoFile.name.replace(/\.[^/.]+$/, "") + ".srt";
    const matchedSrtFile = srtFiles.find(f => f.name === srtFileName);
    if (matchedSrtFile) {
        onEditVideo(videoFile.id, matchedSrtFile.id);
    } else {
        alert(`Không tìm thấy tệp phụ đề khớp (${srtFileName}). Vui lòng tải lên tệp SRT có cùng tên với video.`);
    }
  };

  const selectedFile = useMemo(() => project.files.find(f => f.id === selectedFileId), [project.files, selectedFileId]);

  useEffect(() => {
    if (!selectedFile) return;
    if (selectedFile.type === 'video' || selectedFile.type === 'audio') {
        const hasMetadata = (selectedFile as VideoFile | AudioFile).storagePath || (selectedFile as VideoFile | AudioFile).fileSize;
        if (!hasMetadata) {
            getStoredFileInfo(selectedFile.id)
                .then(info => {
                    if (info?.storage_path || info?.file_size || info?.created_at) {
                        onUpdateProject(project.id, p => ({
                            files: p.files.map(f => f.id === selectedFile.id ? {
                                ...f,
                                storagePath: info.storage_path ?? (f as VideoFile | AudioFile).storagePath,
                                fileSize: info.file_size ?? (f as VideoFile | AudioFile).fileSize,
                                uploadedAt: info.created_at ?? (f as VideoFile | AudioFile).uploadedAt,
                            } : f)
                        }));
                    }
                })
                .catch(error => console.error('Failed to fetch metadata', error));
        }
    }
  }, [selectedFile, onUpdateProject, project.id]);

  const formatBytes = (size?: number): string => {
    if (size === undefined || size === null) return 'Không rõ';
    if (size === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
    const value = size / Math.pow(1024, exponent);
    return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
  };

  const copyToClipboard = async (text: string) => {
    try {
        await navigator.clipboard.writeText(text);
        setClipboardMessage('Đã sao chép đường dẫn vào clipboard');
    } catch (error) {
        console.error('Clipboard error', error);
        setClipboardMessage('Không thể sao chép. Vui lòng thử lại.');
    }
  };

  const handleDownloadMedia = async (file: VideoFile | AudioFile) => {
    try {
        const mediaUrl = await getVideoUrl(file.id);
        if (!mediaUrl) {
            setClipboardMessage('Không tìm thấy tệp để tải.');
            return;
        }
        const link = document.createElement('a');
        link.href = mediaUrl;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(mediaUrl), 0);
    } catch (error) {
        console.error('Download error', error);
        setClipboardMessage('Tải về thất bại.');
    }
  };
  
  return (
    <>
      <div className="flex h-full">
          <div className="w-1/4 border-r border-gray-700 flex flex-col">
              <div className="p-2 border-b border-gray-700 flex items-center justify-between">
                <h3 className="font-semibold text-lg">Tệp Tin</h3>
                <label className={`cursor-pointer text-indigo-400 hover:text-indigo-300 p-2 rounded-full hover:bg-gray-700 ${isProcessingAnyFile ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    {isProcessingAnyFile ? <LoadingSpinner className="w-5 h-5"/> : <UploadIcon className="w-5 h-5" />}
                    <input type="file" multiple accept=".srt,.mp4,.mov,.avi,.mkv,.mp3" className="hidden" onChange={handleFileChange} disabled={isProcessingAnyFile} />
                </label>
              </div>
              <div className="flex-grow overflow-y-auto">
                  {sortedFiles.map(file => (
                      <div key={file.id} 
                           className={`p-3 cursor-pointer flex justify-between items-center ${selectedFileId === file.id ? 'bg-indigo-900/50' : 'hover:bg-gray-700/50'}`}
                           onClick={() => setSelectedFileId(file.id)}>
                          <div className="flex items-center space-x-2 truncate">
                              {file.type === 'srt' ? (
                                <span className={`flex-shrink-0 w-2 h-2 rounded-full mr-1 ${
                                  activelyTranslating.has(file.id) ? 'bg-blue-500 animate-pulse' :
                                  (file as SrtFile).translationStatus === 'success' ? 'bg-green-500' :
                                  (file as SrtFile).translationStatus === 'error' ? 'bg-red-500' :
                                  'bg-gray-500'
                                }`}></span>
                              ) : file.type === 'video' ? (
                                <FilmIcon className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                              ) : (
                                <AudioWaveIcon className="w-4 h-4 text-purple-400 flex-shrink-0" />
                              )}
                              <div className="truncate">
                                  <span className="truncate text-sm">{file.name}</span>
                                  {processingStatus[file.id] && <p className="text-xs text-cyan-400">{processingStatus[file.id]}</p>}
                              </div>
                          </div>
                           <div className="flex items-center space-x-2 text-xs text-gray-400 flex-shrink-0">
                                {file.type === 'srt' ? (
                                    typeof (file as SrtFile).tokenCount === 'number' && <span>{(file as SrtFile).tokenCount.toLocaleString()} t</span>
                                ) : file.type === 'video' ? (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleEditVideo(file as VideoFile);
                                      }}
                                      className="text-cyan-400 hover:text-cyan-300 px-2 py-1 rounded-md hover:bg-gray-800 flex items-center space-x-1"
                                      aria-label={`Chỉnh sửa video ${file.name}`}
                                    >
                                      <ClapperboardEditLinear className="w-4 h-4" />
                                    </button>
                                ) : null}
                                <button onClick={(e) => {e.stopPropagation(); handleDeleteFile(file.id)}} className="text-gray-500 hover:text-red-500"><TrashIcon className="w-4 h-4"/></button>
                           </div>
                      </div>
                  ))}
              </div>
              <div className="p-2 border-t border-gray-700 space-y-2">
                 <div className="text-center text-sm text-gray-400 mb-2">
                    Tổng số token: {isProcessingAnyFile ? <LoadingSpinner className="w-4 h-4 inline-block"/> : totalTokens.toLocaleString()}
                 </div>
                <button onClick={handleTranslateAll} disabled={activelyTranslating.size > 0 || isProcessingAnyFile} className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-800 disabled:cursor-wait text-white font-bold py-2 px-4 rounded flex items-center justify-center space-x-2">
                    {activelyTranslating.size > 0 ? <LoadingSpinner /> : <TranslateIcon className="w-5 h-5"/>}
                    <span>Dịch Tất Cả</span>
                </button>
                <button
                    onClick={handleGenerateSrtsFromAsr}
                    disabled={isGeneratingSrts || isProcessingAnyFile}
                    className="w-full bg-amber-600 hover:bg-amber-700 disabled:bg-amber-800 disabled:cursor-wait text-white font-bold py-2 px-4 rounded flex items-center justify-center space-x-2"
                >
                    {isGeneratingSrts ? <LoadingSpinner /> : <SubtitlesIcon className="w-5 h-5" />}
                    <span>Tạo SRT từ ASR</span>
                </button>
                <button onClick={handleDeleteAllFiles} disabled={project.files.length === 0} className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded flex items-center justify-center space-x-2">
                    <TrashIcon className="w-5 h-5" />
                    <span>Xóa Tất Cả</span>
                </button>
                <button onClick={handleDownloadAll} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded flex items-center justify-center space-x-2">
                    <DownloadAllIcon className="w-5 h-5" />
                    <span>Tải Về Tất Cả Bản Dịch</span>
                </button>
              </div>
          </div>
          <div className="w-3/4 flex flex-col h-full relative">
              {clipboardMessage && (
                <div className="absolute top-2 right-4 bg-gray-900/80 border border-gray-700 text-gray-100 px-4 py-2 rounded shadow-lg text-sm z-10">
                  {clipboardMessage}
                </div>
              )}
              <div className="flex-grow flex flex-col overflow-hidden">
                {selectedFile?.type === 'srt' ? (
                  <>
                    <div className="p-2 border-b border-gray-700 flex justify-between items-center flex-shrink-0">
                      <h4 className="font-semibold truncate">{selectedFile.name}</h4>
                      <div className="flex space-x-2">
                        <button onClick={() => handleTranslate(selectedFile.id)} disabled={activelyTranslating.has(selectedFile.id) || isProcessingAnyFile} className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-800 disabled:cursor-wait text-white font-bold py-1 px-3 rounded flex items-center space-x-2 text-sm">
                          {activelyTranslating.has(selectedFile.id) ? <LoadingSpinner /> : <TranslateIcon className="w-4 h-4"/>}
                          <span>Dịch</span>
                        </button>
                        <button onClick={() => handleCopy(selectedFile.id)} disabled={(selectedFile as SrtFile).translationStatus !== 'success'} className="bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-bold py-1 px-3 rounded flex items-center space-x-2 text-sm">
                          <ClipboardIcon className="w-4 h-4" />
                          <span>Sao chép</span>
                        </button>
                        <button onClick={() => handleDownload(selectedFile.id)} disabled={(selectedFile as SrtFile).translationStatus !== 'success'} className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold py-1 px-3 rounded flex items-center space-x-2 text-sm">
                          <DownloadIcon className="w-4 h-4" />
                          <span>Tải Về</span>
                        </button>
                      </div>
                    </div>
                    <div className="flex-grow overflow-y-auto grid grid-cols-2 gap-4 p-4 text-sm font-mono">
                        <div>
                            <h5 className="text-center font-sans font-bold text-gray-400 mb-2">Bản Gốc</h5>
                            <div className="bg-gray-900/50 p-2 rounded h-full overflow-y-auto">
                              {(selectedFile as SrtFile).originalSubtitles.map(sub => (
                                  <div key={sub.id} className="bg-gray-800/50 rounded-lg p-3 mb-3 border border-gray-700/50">
                                    <p className="text-xs text-gray-500 mb-1">{sub.id} | {sub.startTime} --&gt; {sub.endTime}</p>
                                    <p className="text-gray-200">{sub.text}</p>
                                  </div>
                              ))}
                            </div>
                        </div>
                         <div>
                            <h5 className="text-center font-sans font-bold text-gray-400 mb-2">Bản Dịch</h5>
                             <div className="bg-gray-900/50 p-2 rounded h-full overflow-y-auto">
                               {(selectedFile as SrtFile).translatedSubtitles.map(sub => (
                                  <div key={sub.id} className="bg-gray-800/50 rounded-lg p-3 mb-3 border border-gray-700/50">
                                    <p className="text-xs text-gray-500 mb-1">{sub.id} | {sub.startTime} --&gt; {sub.endTime}</p>
                                    <p className={`text-gray-200 ${sub.text.includes('[') ? 'text-red-400' : ''}`}>
                                      {sub.text || (activelyTranslating.has(selectedFile.id) ? '...' : '')}
                                    </p>
                                  </div>
                               ))}
                             </div>
                        </div>
                    </div>
                  </>
                ) : selectedFile ? (
                  <div className="flex-grow overflow-y-auto p-6 text-sm text-gray-200">
                    <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-6 space-y-4">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div>
                          <h4 className="text-xl font-semibold text-white">{selectedFile.name}</h4>
                          <p className="text-gray-400 capitalize">Loại tệp: {selectedFile.type === 'video' ? 'Video' : 'Âm thanh'}</p>
                        </div>
                        <button
                          onClick={() => handleDownloadMedia(selectedFile as VideoFile | AudioFile)}
                          className="self-start md:self-auto bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow"
                        >
                          Tải xuống bản gốc
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs md:text-sm">
                        <div className="space-y-2">
                          <p className="text-gray-400">Dung lượng: <span className="text-gray-100">{formatBytes((selectedFile as VideoFile | AudioFile).fileSize)}</span></p>
                          <p className="text-gray-400">Thời gian tải lên: <span className="text-gray-100">{(selectedFile as VideoFile | AudioFile).uploadedAt ? new Date((selectedFile as VideoFile | AudioFile).uploadedAt as string).toLocaleString() : 'Không rõ'}</span></p>
                        </div>
                        <div className="space-y-2">
                          <p className="text-gray-400">Đường dẫn Colab:</p>
                          {(selectedFile as VideoFile | AudioFile).storagePath ? (
                            <div className="bg-gray-950/70 border border-gray-800 rounded p-2 text-xs break-all">
                              {(selectedFile as VideoFile | AudioFile).storagePath}
                              <button
                                onClick={() => copyToClipboard((selectedFile as VideoFile | AudioFile).storagePath!)}
                                className="mt-2 inline-flex items-center text-indigo-400 hover:text-indigo-200"
                              >
                                Sao chép đường dẫn
                              </button>
                            </div>
                          ) : (
                            <p className="text-gray-500">Không tìm thấy đường dẫn đã lưu. Nếu đây là tệp cũ, hãy tải lại để đồng bộ.</p>
                          )}
                        </div>
                      </div>
                      {selectedFile.type === 'video' && (
                        <p className="text-gray-500 text-xs">Sử dụng đường dẫn này trong Colab để dựng video hoặc xử lý hậu kỳ.</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex-grow flex items-center justify-center text-gray-500">
                    <p>Chọn một tệp hoặc tải lên tệp mới để bắt đầu.</p>
                  </div>
                )}
              </div>
          </div>
      </div>
    </>
  );
};

export default ProjectFiles;
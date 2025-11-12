import React, { useState, useEffect } from 'react';
import { Project } from '../../types';
import { LoadingSpinner, DownloadIcon, TrashIcon, PlusIcon, SearchIcon } from '../ui/Icons';
import * as downloadService from '../../services/downloadService';
import { ScannedVideo, ChannelItem, DownloadStatus } from '../../services/downloadService';

interface ProjectDownloadProps {
  project: Project;
  onUpdateProject: (projectId: string, updates: Partial<Project> | ((p: Project) => Partial<Project>)) => void;
}

const ProjectDownload: React.FC<ProjectDownloadProps> = ({ project, onUpdateProject }) => {
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [scannedVideos, setScannedVideos] = useState<ScannedVideo[]>([]);
  const [channelInfo, setChannelInfo] = useState<{ name: string; total_videos: number } | null>(null);
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());
  
  const [scanUrl, setScanUrl] = useState('');
  const [scanType, setScanType] = useState<'douyin' | 'youtube' | 'bilibili'>('douyin');
  const [maxVideos, setMaxVideos] = useState(100); // Increased default limit
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  
  const [downloadingVideos, setDownloadingVideos] = useState<Set<string>>(new Set());
  const [downloadStatuses, setDownloadStatuses] = useState<Map<string, DownloadStatus>>(new Map());
  
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelUrl, setNewChannelUrl] = useState('');
  const [newChannelType, setNewChannelType] = useState<'douyin' | 'youtube' | 'bilibili'>('douyin');
  
  const [backendError, setBackendError] = useState<string | null>(null);

  // Load saved channels on mount
  useEffect(() => {
    loadChannels();
  }, []);

  const loadChannels = async () => {
    try {
      const channelList = await downloadService.getChannelLists();
      setChannels(channelList);
      setBackendError(null); // Clear error on success
    } catch (error) {
      console.error('Failed to load channels:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('404') || errorMessage.includes('Failed to fetch') || errorMessage.includes('fetch')) {
        setBackendError('Không thể kết nối đến backend server. Vui lòng kiểm tra backend đang chạy và VITE_API_BASE_URL được cấu hình đúng.');
      }
    }
  };

  const handleAddChannel = async () => {
    if (!newChannelName || !newChannelUrl) {
      alert('Vui lòng nhập tên và URL kênh');
      return;
    }

    try {
      await downloadService.addChannelList(newChannelName, newChannelUrl, newChannelType);
      setNewChannelName('');
      setNewChannelUrl('');
      setShowAddChannel(false);
      await loadChannels();
    } catch (error) {
      console.error('Failed to add channel:', error);
      alert(`Không thể thêm kênh: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDeleteChannel = async (channelId: string) => {
    if (!confirm('Bạn có chắc muốn xóa kênh này?')) return;

    try {
      await downloadService.deleteChannelList(channelId);
      await loadChannels();
    } catch (error) {
      console.error('Failed to delete channel:', error);
      alert(`Không thể xóa kênh: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleScanChannel = async () => {
    if (!scanUrl) {
      alert('Vui lòng nhập URL để quét');
      return;
    }

    setIsScanning(true);
    setScanError(null);
    setScannedVideos([]);
    setChannelInfo(null);
    setSelectedVideos(new Set()); // Clear selections

    try {
      const result = await downloadService.scanChannel(scanUrl, scanType, maxVideos);
      // Videos should already be in newest-to-oldest order from the API
      setScannedVideos(result.videos);
      setChannelInfo({
        name: result.channel_info.name,
        total_videos: result.channel_info.total_videos,
      });
      setBackendError(null); // Clear backend error on success
    } catch (error) {
      console.error('Scan failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setScanError(errorMessage);
      
      // Show backend connection error if applicable
      if (errorMessage.includes('404') || errorMessage.includes('Failed to fetch') || errorMessage.includes('fetch')) {
        setBackendError('Không thể kết nối đến backend server. Vui lòng kiểm tra backend đang chạy và VITE_API_BASE_URL được cấu hình đúng.');
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleLoadChannel = async (channel: ChannelItem) => {
    setScanUrl(channel.url);
    setScanType(channel.type);
    await handleScanChannel();
  };

  const toggleVideoSelection = (videoId: string) => {
    setSelectedVideos(prev => {
      const newSet = new Set(prev);
      if (newSet.has(videoId)) {
        newSet.delete(videoId);
      } else {
        newSet.add(videoId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedVideos.size === scannedVideos.length) {
      // Deselect all
      setSelectedVideos(new Set());
    } else {
      // Select all
      setSelectedVideos(new Set(scannedVideos.map(v => v.id)));
    }
  };

  const handleMarkSelectedAsDownloaded = async (downloaded: boolean) => {
    if (selectedVideos.size === 0) {
      alert('Vui lòng chọn ít nhất một video');
      return;
    }

    try {
      const videoIds = Array.from(selectedVideos);
      await downloadService.markVideosDownloaded(videoIds, downloaded);
      
      // Update local state
      setScannedVideos(prev => 
        prev.map(v => selectedVideos.has(v.id) ? { ...v, downloaded } : v)
      );
      
      const action = downloaded ? 'đã tải' : 'chưa tải';
      alert(`Đã đánh dấu ${videoIds.length} video là ${action}`);
    } catch (error) {
      console.error('Failed to mark videos:', error);
      alert(`Không thể đánh dấu video: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDownloadSelected = async () => {
    const videosToDownload = scannedVideos.filter(v => selectedVideos.has(v.id) && !v.downloaded);
    if (videosToDownload.length === 0) {
      alert('Vui lòng chọn ít nhất một video chưa tải để tải xuống');
      return;
    }

    // Download videos sequentially to avoid overwhelming the server
    for (const video of videosToDownload) {
      if (!downloadingVideos.has(video.id)) {
        await handleDownloadVideo(video);
      }
    }
  };

  const handleDownloadVideo = async (video: ScannedVideo) => {
    if (downloadingVideos.has(video.id)) {
      return; // Already downloading
    }
    
    // Skip if already downloaded
    if (video.downloaded) {
      alert(`Video "${video.title}" đã được tải trước đó`);
      return;
    }

    try {
      setDownloadingVideos(prev => new Set(prev).add(video.id));
      
      const { download_id } = await downloadService.downloadVideo(
        video.id,
        video.url,
        project.id,
        scanType
      );

      // Poll for download status
      const completedStatus = await downloadService.pollDownloadStatus(
        download_id,
        (status) => {
          setDownloadStatuses(prev => new Map(prev).set(video.id, status));
        }
      );

      // Download completed - add to project files
      if (completedStatus.video_info) {
        const newVideoFile = {
          id: completedStatus.video_info.file_id,
          name: completedStatus.video_info.filename,
          type: 'video' as const,
          segments: [],
          masterVolumeDb: 0,
        };

        // Add the video to the project's files array
        onUpdateProject(project.id, p => ({
          files: [...p.files, newVideoFile]
        }));

        // Mark video as downloaded in local state
        setScannedVideos(prev => 
          prev.map(v => v.id === video.id ? { ...v, downloaded: true } : v)
        );

        alert(`Video "${video.title}" đã được tải xuống và thêm vào tab Tệp Tin!`);
      }
      
    } catch (error) {
      console.error('Download failed:', error);
      alert(`Không thể tải video: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDownloadingVideos(prev => {
        const newSet = new Set(prev);
        newSet.delete(video.id);
        return newSet;
      });
    }
  };

  const getDownloadButtonText = (video: ScannedVideo): string => {
    if (video.downloaded) {
      return 'Đã tải';
    }
    if (downloadingVideos.has(video.id)) {
      const status = downloadStatuses.get(video.id);
      if (status) {
        if (status.status === 'downloading' && status.progress !== undefined) {
          return `Đang tải ${status.progress}%`;
        }
        return status.status === 'pending' ? 'Đang chờ...' : 'Đang tải...';
      }
      return 'Đang tải...';
    }
    return 'Tải xuống';
  };

  return (
    <div className="h-full flex flex-col bg-gray-900 text-white overflow-hidden">
      {/* Header Section */}
      <div className="p-6 border-b border-gray-700">
        <h2 className="text-xl font-bold mb-4">Tải Video</h2>
        
        {/* Backend Connection Error Banner */}
        {backendError && (
          <div className="bg-red-900/50 border border-red-700 rounded p-4 mb-4">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-sm font-medium text-red-300">Lỗi kết nối Backend</h3>
                <div className="mt-2 text-sm text-red-200">
                  <p>{backendError}</p>
                </div>
                <div className="mt-3">
                  <button
                    onClick={loadChannels}
                    className="text-sm font-medium text-red-300 hover:text-red-200 underline"
                  >
                    Thử lại
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Scan URL Input */}
        <div className="flex gap-2 mb-4">
          <select
            value={scanType}
            onChange={(e) => setScanType(e.target.value as 'douyin' | 'youtube' | 'bilibili')}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2"
          >
            <option value="douyin">Douyin</option>
            <option value="youtube">YouTube</option>
            <option value="bilibili">Bilibili</option>
          </select>
          
          <input
            type="number"
            value={maxVideos}
            onChange={(e) => setMaxVideos(Math.max(1, Math.min(500, parseInt(e.target.value) || 100)))}
            placeholder="Số video"
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2 w-24"
            title="Số lượng video tối đa để quét (1-500)"
          />
          
          <input
            type="text"
            value={scanUrl}
            onChange={(e) => setScanUrl(e.target.value)}
            placeholder="Nhập URL kênh hoặc video..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2"
          />
          
          <button
            onClick={handleScanChannel}
            disabled={isScanning}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 px-4 py-2 rounded flex items-center gap-2"
          >
            {isScanning ? <LoadingSpinner className="w-5 h-5" /> : <SearchIcon className="w-5 h-5" />}
            Quét
          </button>
        </div>

        {/* Channel Info & Bulk Actions */}
        {channelInfo && (
          <div className="bg-gray-800 rounded p-3 mb-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="font-semibold">{channelInfo.name}</p>
                <p className="text-sm text-gray-400">
                  Tổng số video: {channelInfo.total_videos} | Đã quét: {scannedVideos.length} | Đã chọn: {selectedVideos.size}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={toggleSelectAll}
                  className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm"
                >
                  {selectedVideos.size === scannedVideos.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                </button>
                <button
                  onClick={handleDownloadSelected}
                  disabled={selectedVideos.size === 0}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 px-4 py-2 rounded text-sm flex items-center gap-2"
                >
                  <DownloadIcon className="w-4 h-4" />
                  Tải đã chọn ({selectedVideos.size})
                </button>
              </div>
            </div>
            
            {/* Mark as Downloaded Controls */}
            <div className="flex items-center gap-2 pt-3 border-t border-gray-700">
              <span className="text-sm text-gray-400">Đánh dấu đã chọn:</span>
              <button
                onClick={() => handleMarkSelectedAsDownloaded(true)}
                disabled={selectedVideos.size === 0}
                className="bg-green-700 hover:bg-green-600 disabled:bg-gray-600 px-3 py-1 rounded text-sm"
              >
                Đã tải
              </button>
              <button
                onClick={() => handleMarkSelectedAsDownloaded(false)}
                disabled={selectedVideos.size === 0}
                className="bg-red-700 hover:bg-red-600 disabled:bg-gray-600 px-3 py-1 rounded text-sm"
              >
                Bỏ dấu
              </button>
            </div>
          </div>
        )}

        {/* Error Message */}
        {scanError && (
          <div className="bg-red-900/50 border border-red-700 rounded p-3 mb-4">
            <p className="text-red-300">Lỗi: {scanError}</p>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Saved Channels Sidebar */}
        <div className="w-64 border-r border-gray-700 flex flex-col">
          <div className="p-4 border-b border-gray-700 flex items-center justify-between">
            <h3 className="font-semibold">Kênh Đã Lưu</h3>
            <button
              onClick={() => setShowAddChannel(true)}
              className="text-indigo-400 hover:text-indigo-300"
            >
              <PlusIcon className="w-5 h-5" />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-2">
            {channels.map((channel) => (
              <div
                key={channel.id}
                className="bg-gray-800 rounded p-3 mb-2 hover:bg-gray-750 cursor-pointer group"
                onClick={() => handleLoadChannel(channel)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{channel.name}</p>
                    <p className="text-xs text-gray-400 capitalize">{channel.type}</p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteChannel(channel.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 ml-2"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
            
            {channels.length === 0 && (
              <p className="text-gray-500 text-sm text-center mt-4">Chưa có kênh nào</p>
            )}
          </div>
        </div>

        {/* Video Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {isScanning ? (
            <div className="flex items-center justify-center h-full">
              <LoadingSpinner className="w-8 h-8" />
              <p className="ml-3">Đang quét kênh...</p>
            </div>
          ) : scannedVideos.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {scannedVideos.map((video) => {
                const isSelected = selectedVideos.has(video.id);
                const isDownloaded = video.downloaded || false;
                
                // Determine background color based on status
                let bgColor = 'bg-gray-800'; // default
                if (isSelected) {
                  bgColor = 'bg-green-900/40'; // green for selected/checked
                } else if (isDownloaded) {
                  bgColor = 'bg-yellow-900/40'; // yellow for downloaded
                }
                
                return (
                  <div key={video.id} className={`${bgColor} rounded-lg overflow-hidden hover:ring-2 ring-indigo-500 transition relative`}>
                    {/* Checkbox */}
                    <div className="absolute top-2 left-2 z-10">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleVideoSelection(video.id)}
                        className="w-5 h-5 rounded bg-gray-700 border-gray-600 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </div>
                    
                    {/* Downloaded Badge */}
                    {isDownloaded && (
                      <div className="absolute top-2 right-2 z-10 bg-yellow-500 text-yellow-900 text-xs font-bold px-2 py-1 rounded">
                        Đã tải
                      </div>
                    )}
                    
                    {/* Thumbnail */}
                    <div className="relative aspect-video bg-gray-700 flex items-center justify-center">
                      {video.thumbnail && video.thumbnail !== "" && video.thumbnail !== "N/A" ? (
                        <img
                          src={video.thumbnail}
                          alt={video.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.onerror = null; // Prevent infinite loop
                            target.style.display = 'none';
                            const parent = target.parentElement;
                            if (parent && !parent.querySelector('.thumbnail-fallback')) {
                              const fallback = document.createElement('div');
                              fallback.className = 'thumbnail-fallback absolute inset-0 flex items-center justify-center text-gray-400 text-sm p-4 text-center';
                              fallback.innerHTML = `
                                <div>
                                  <svg class="w-12 h-12 mx-auto mb-2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                  </svg>
                                  <div>Không có ảnh xem trước</div>
                                </div>
                              `;
                              parent.appendChild(fallback);
                            }
                          }}
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm p-4 text-center">
                          <div>
                            <svg className="w-12 h-12 mx-auto mb-2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            <div>Không có ảnh xem trước</div>
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* Video Info */}
                    <div className="p-3">
                      <h4 className="font-medium line-clamp-2 mb-1" title={video.title}>
                        {video.title || 'No title'}
                      </h4>
                      <p className="text-sm text-gray-400 mb-2">{video.author}</p>
                      {video.created_time && (
                        <p className="text-xs text-gray-500 mb-2">{video.created_time}</p>
                      )}
                      
                      {/* Download Button */}
                      <button
                        onClick={() => handleDownloadVideo(video)}
                        disabled={downloadingVideos.has(video.id) || video.downloaded}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 px-3 py-2 rounded text-sm flex items-center justify-center gap-2"
                      >
                        {downloadingVideos.has(video.id) ? (
                          <LoadingSpinner className="w-4 h-4" />
                        ) : (
                          <DownloadIcon className="w-4 h-4" />
                        )}
                        {getDownloadButtonText(video)}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              <p>Nhập URL và nhấn "Quét" để xem danh sách video</p>
            </div>
          )}
        </div>
      </div>

      {/* Add Channel Modal */}
      {showAddChannel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-bold mb-4">Thêm Kênh Mới</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm mb-1">Tên kênh</label>
                <input
                  type="text"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2"
                  placeholder="VD: Kênh của tôi"
                />
              </div>
              
              <div>
                <label className="block text-sm mb-1">URL kênh</label>
                <input
                  type="text"
                  value={newChannelUrl}
                  onChange={(e) => setNewChannelUrl(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2"
                  placeholder="https://..."
                />
              </div>
              
              <div>
                <label className="block text-sm mb-1">Loại</label>
                <select
                  value={newChannelType}
                  onChange={(e) => setNewChannelType(e.target.value as 'douyin' | 'youtube' | 'bilibili')}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2"
                >
                  <option value="douyin">Douyin</option>
                  <option value="youtube">YouTube</option>
                  <option value="bilibili">Bilibili</option>
                </select>
              </div>
            </div>
            
            <div className="flex gap-2 mt-6">
              <button
                onClick={handleAddChannel}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded"
              >
                Thêm
              </button>
              <button
                onClick={() => {
                  setShowAddChannel(false);
                  setNewChannelName('');
                  setNewChannelUrl('');
                }}
                className="flex-1 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded"
              >
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectDownload;

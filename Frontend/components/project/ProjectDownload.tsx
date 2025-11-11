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
  
  const [scanUrl, setScanUrl] = useState('');
  const [scanType, setScanType] = useState<'douyin' | 'youtube'>('douyin');
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  
  const [downloadingVideos, setDownloadingVideos] = useState<Set<string>>(new Set());
  const [downloadStatuses, setDownloadStatuses] = useState<Map<string, DownloadStatus>>(new Map());
  
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelUrl, setNewChannelUrl] = useState('');
  const [newChannelType, setNewChannelType] = useState<'douyin' | 'youtube'>('douyin');
  
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
        setBackendError('Không thể kết nối đến backend server. Vui lòng đảm bảo backend đang chạy (python -m uvicorn main:app --host 0.0.0.0 --port 8000)');
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

    try {
      const result = await downloadService.scanChannel(scanUrl, scanType, 30);
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
        setBackendError('Không thể kết nối đến backend server. Vui lòng đảm bảo backend đang chạy (python -m uvicorn main:app --host 0.0.0.0 --port 8000)');
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

  const handleDownloadVideo = async (video: ScannedVideo) => {
    if (downloadingVideos.has(video.id)) {
      return; // Already downloading
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
            onChange={(e) => setScanType(e.target.value as 'douyin' | 'youtube')}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2"
          >
            <option value="douyin">Douyin</option>
            <option value="youtube">YouTube</option>
          </select>
          
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

        {/* Channel Info */}
        {channelInfo && (
          <div className="bg-gray-800 rounded p-3 mb-4">
            <p className="font-semibold">{channelInfo.name}</p>
            <p className="text-sm text-gray-400">Tổng số video: {channelInfo.total_videos}</p>
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
              {scannedVideos.map((video) => (
                <div key={video.id} className="bg-gray-800 rounded-lg overflow-hidden hover:ring-2 ring-indigo-500 transition">
                  {/* Thumbnail */}
                  <div className="relative aspect-video bg-gray-700">
                    {video.thumbnail ? (
                      <img
                        src={video.thumbnail}
                        alt={video.title}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-500">
                        No thumbnail
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
                      disabled={downloadingVideos.has(video.id)}
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
              ))}
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
                  onChange={(e) => setNewChannelType(e.target.value as 'douyin' | 'youtube')}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2"
                >
                  <option value="douyin">Douyin</option>
                  <option value="youtube">YouTube</option>
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

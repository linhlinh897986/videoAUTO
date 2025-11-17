import React, { useState, useMemo, useEffect } from 'react';
import { Project, ApiKey } from '../../types';
import { AVAILABLE_MODELS, DEFAULT_TTS_VOICE } from '../../constants';
import { PencilIcon, ChevronDownIcon } from '../ui/Icons';
import { listTTSVoices, TTSVoice } from '../../services/ttsService';

interface ProjectSettingsProps {
  project: Project;
  onUpdateProject: (projectId: string, updates: Partial<Project> | ((p: Project) => Partial<Project>)) => void;
  onRefreshApiKeys: () => void;
  setIsApiKeyModalOpen: (isOpen: boolean) => void;
  setIsStyleModalOpen: (isOpen: boolean) => void;
  currentStyleName: string;
  apiKeys: ApiKey[];
}

const CollapsibleSection: React.FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, children, defaultOpen = false }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="border-b border-gray-700 last:border-b-0">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex w-full items-center justify-between py-5 text-left text-lg font-semibold text-white hover:text-indigo-300 focus:outline-none"
                aria-expanded={isOpen}
            >
                <span>{title}</span>
                <ChevronDownIcon className={`h-5 w-5 transform transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            <div
                className={`overflow-hidden transition-all duration-300 ease-in-out ${isOpen ? 'max-h-[1000px] pb-5 opacity-100' : 'max-h-0 opacity-0'}`}
            >
                {children}
            </div>
        </div>
    );
};

const ProjectSettings: React.FC<ProjectSettingsProps> = ({
  project,
  onUpdateProject,
  onRefreshApiKeys,
  setIsApiKeyModalOpen,
  setIsStyleModalOpen,
  currentStyleName,
  apiKeys
}) => {
  const activeApiKeysCount = useMemo(() => apiKeys.filter(k => k.status === 'active').length, [apiKeys]);
  const maxConcurrency = activeApiKeysCount > 0 ? activeApiKeysCount * 4 : 1;
  const [ttsVoices, setTtsVoices] = useState<TTSVoice[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);

  // Load TTS voices on mount
  useEffect(() => {
    setIsLoadingVoices(true);
    listTTSVoices()
      .then(voices => setTtsVoices(voices))
      .catch(err => console.error('Failed to load TTS voices:', err))
      .finally(() => setIsLoadingVoices(false));
  }, []);

  return (
    <div className="p-6 h-full overflow-y-auto">
      <h2 className="text-2xl font-bold mb-4">Cài Đặt Dự Án</h2>
      
      <CollapsibleSection title="Quản lý API & Phong cách Dịch" defaultOpen={true}>
        <div className="space-y-8">
            <div>
              <h4 className="text-lg font-semibold mb-2 text-gray-200">Quản lý API Key</h4>
              <p className="text-gray-400 mb-4">Thêm, xóa và xem trạng thái các API key của bạn. Ứng dụng sẽ tự động xoay vòng các key đang hoạt động.</p>
              <button 
                onClick={() => {
                  onRefreshApiKeys();
                  setIsApiKeyModalOpen(true);
                }} 
                className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-md flex items-center space-x-2"
              >
                <PencilIcon className="w-5 h-5"/>
                <span>Quản Lý API Keys</span>
              </button>
            </div>
            <div>
              <h4 className="text-lg font-semibold mb-2 text-gray-200">Mẫu Lệnh Phong Cách</h4>
              <p className="text-gray-400 mb-4">Mẫu lệnh này hướng dẫn phong cách dịch, giọng văn và cách xưng hô của AI. Bạn có thể sử dụng một mẫu có sẵn hoặc tạo phong cách của riêng mình.</p>
              <div className="w-full bg-gray-900 border border-gray-600 text-gray-300 p-3 rounded-md mb-4">
                <span className="text-gray-400">Phong cách hiện tại: </span>
                <span className="font-semibold text-white">{currentStyleName}</span>
              </div>
              <button onClick={() => setIsStyleModalOpen(true)} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-md flex items-center space-x-2">
                <PencilIcon className="w-5 h-5"/><span>Quản Lý Phong Cách</span>
              </button>
            </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Tự động hóa & Hiệu suất">
         <div className="space-y-8">
            <div>
              <h4 className="text-lg font-semibold mb-2 text-gray-200">Lớp Phủ Hardsub Tự Động</h4>
              <p className="text-gray-400 mb-4">Video sẽ tự động có lớp phủ 8% ở dưới cùng để che phụ đề gốc khi tải lên.</p>
              <div className="text-sm text-gray-500 p-3 bg-gray-800/50 rounded-md">
                <p>✓ Lớp phủ tự động: 8% chiều cao ở đáy video</p>
                <p>✓ Không cần OCR hay phân tích</p>
                <p>✓ Tải lên nhanh hơn</p>
              </div>
            </div>
            <div>
              <h4 className="text-lg font-semibold mb-2 text-gray-200">Mô Hình & Tốc Độ</h4>
               <p className="text-gray-400 mb-4">Chọn mô hình dịch và bật/tắt "thinking" để cân bằng giữa chất lượng và tốc độ.</p>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <select
                    value={project.model}
                    onChange={(e) => onUpdateProject(project.id, { model: e.target.value })}
                    className="w-full bg-gray-700 border border-gray-600 text-white rounded-md px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  >
                    {AVAILABLE_MODELS.map(model => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                   <select
                    value={project.thinkingEnabled === false ? 'off' : 'on'}
                    onChange={(e) => onUpdateProject(project.id, { thinkingEnabled: e.target.value === 'on' })}
                    className="w-full bg-gray-700 border border-gray-600 text-white rounded-md px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  >
                    <option value="on">Thinking: Bật (Chất lượng cao hơn)</option>
                    <option value="off">Thinking: Tắt (Tốc độ nhanh hơn)</option>
                  </select>
               </div>
            </div>

            <div>
              <h4 className="text-lg font-semibold mb-2 text-gray-200">Xử lý Từ Khóa</h4>
              <p className="text-gray-400 mb-4">Chọn cách áp dụng các quy tắc thay thế từ khóa.</p>
              <select
                  value={project.keywordHandling || 'api'}
                  onChange={(e) => onUpdateProject(project.id, { keywordHandling: e.target.value as 'api' | 'post-process' | 'off' })}
                  className="w-full md:w-1/2 bg-gray-700 border border-gray-600 text-white rounded-md px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              >
                  <option value="api">Gửi qua API (Đề xuất)</option>
                  <option value="post-process">Xử lý hậu kỳ (Client-side)</option>
                  <option value="off">Tắt</option>
              </select>
            </div>

            <div>
              <h4 className="text-lg font-semibold mb-2 text-gray-200">Luồng & Giới hạn Token</h4>
              <p className="text-gray-400 mb-4">Điều chỉnh các thông số để tối ưu hóa tốc độ dịch và tránh lỗi API.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm text-gray-400 mb-1">Luồng Dịch Đồng Thời</label>
                    <input
                      type="number"
                      min="1"
                      max={maxConcurrency}
                      value={project.translationConcurrency || 5}
                      onChange={(e) => {
                          const value = parseInt(e.target.value, 10);
                          if (!isNaN(value) && value >= 1 && value <= maxConcurrency) {
                              onUpdateProject(project.id, { translationConcurrency: value });
                          }
                      }}
                      className="w-full bg-gray-700 border border-gray-600 text-white rounded-md px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                    />
                    <p className="text-xs text-gray-500 mt-2">
                        Tối đa: {maxConcurrency} (dựa trên {activeApiKeysCount} key)
                    </p>
                </div>
                <div>
                   <label className="block text-sm text-gray-400 mb-1">Token Tối Đa / Yêu Cầu</label>
                   <input
                      type="number"
                      min="1000"
                      max="60000"
                      step="100"
                      value={project.maxTokensPerRequest || 50000}
                      onChange={(e) => {
                          const value = parseInt(e.target.value, 10);
                          if (!isNaN(value) && value >= 1000 && value <= 60000) {
                              onUpdateProject(project.id, { maxTokensPerRequest: value });
                          }
                      }}
                      className="w-full bg-gray-700 border border-gray-600 text-white rounded-md px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                    />
                    <p className="text-xs text-gray-500 mt-2">Mặc định: 50000</p>
                </div>
              </div>
            </div>
         </div>
      </CollapsibleSection>

      <CollapsibleSection title="Text-to-Speech (TTS)">
        <div className="space-y-4">
          <div>
            <h4 className="text-lg font-semibold mb-2 text-gray-200">Giọng Nói TTS</h4>
            <p className="text-gray-400 mb-4">Chọn giọng nói mặc định để tạo âm thanh từ phụ đề đã dịch.</p>
            <select
              value={project.ttsVoice || DEFAULT_TTS_VOICE}
              onChange={(e) => onUpdateProject(project.id, { ttsVoice: e.target.value })}
              className="w-full bg-gray-700 border border-gray-600 text-white rounded-md px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              disabled={isLoadingVoices}
            >
              {isLoadingVoices ? (
                <option>Đang tải...</option>
              ) : ttsVoices.length > 0 ? (
                ttsVoices.map(voice => (
                  <option key={voice.id} value={voice.id}>{voice.name}</option>
                ))
              ) : (
                <option value={DEFAULT_TTS_VOICE}>{DEFAULT_TTS_VOICE} (Mặc định)</option>
              )}
            </select>
            <p className="text-xs text-gray-500 mt-2">
              Giọng nói này sẽ được sử dụng khi tạo TTS trong trình chỉnh sửa video.
            </p>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
};

export default ProjectSettings;

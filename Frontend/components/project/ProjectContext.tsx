import React, { useState } from 'react';
import { Project, SrtFile, ContextItem } from '../../types';
import { analyzeContext } from '../../services/geminiService';
import { formatForGemini } from '../../services/srtParser';
import { PlusIcon, TrashIcon, SparklesIcon, LoadingSpinner } from '../ui/Icons';

type ContextType = 'locations' | 'skills' | 'realms';

interface ProjectContextProps {
  project: Project;
  onUpdateProject: (projectId: string, updates: Partial<Project> | ((p: Project) => Partial<Project>)) => void;
}

const ProjectContext: React.FC<ProjectContextProps> = ({ project, onUpdateProject }) => {
    const [analysisOptions, setAnalysisOptions] = useState({ locations: true, skills: true, realms: true });
    const [isAnalyzingContext, setIsAnalyzingContext] = useState(false);
    const srtFiles = project.files.filter((f): f is SrtFile => f.type === 'srt');
    
    const handleAnalyzeContext = async () => {
    setIsAnalyzingContext(true);
    const filesToAnalyze = srtFiles;
    if (!filesToAnalyze || filesToAnalyze.length === 0) {
        alert("Vui lòng tải lên tệp SRT trước khi phân tích.");
        setIsAnalyzingContext(false);
        return;
    }

    const BATCH_SIZE = 10;
    const CONCURRENCY_LIMIT = 5;

    const fileBatches: SrtFile[][] = [];
    for (let i = 0; i < filesToAnalyze.length; i += BATCH_SIZE) {
        fileBatches.push(filesToAnalyze.slice(i, i + BATCH_SIZE));
    }

    const batchQueue = [...fileBatches];
    let hasError = false;

    const worker = async () => {
        while (batchQueue.length > 0) {
            const batch = batchQueue.shift();
            if (!batch) continue;

            const batchContent = batch.map(file => formatForGemini(file.originalSubtitles)).join('\n\n---\n\n');
            if (!batchContent.trim()) continue;

            try {
                const initialContext = { locations: project.locations || [], skills: project.skills || [], realms: project.realms || [] };
                const result = await analyzeContext(batchContent, analysisOptions, initialContext, project);
                onUpdateProject(project.id, p => {
                    const updatedProject: Partial<Project> = {}; let somethingChanged = false;
                    const processContextType = (type: ContextType, newItems?: Omit<ContextItem, 'id'>[]) => {
                      if(newItems) {
                        const currentItems = p[type] || [];
                        const existingNames = new Set(currentItems.map(i => i.chineseName));
                        const trulyNewItems = newItems.filter(item => !existingNames.has(item.chineseName)).map(item => ({...item, id: `${Date.now()}-${type}-${item.chineseName}`}));
                        if(trulyNewItems.length > 0) {
                          updatedProject[type] = [...currentItems, ...trulyNewItems];
                          somethingChanged = true;
                        }
                      }
                    };
                    if(analysisOptions.locations) processContextType('locations', result.locations);
                    if(analysisOptions.skills) processContextType('skills', result.skills);
                    if(analysisOptions.realms) processContextType('realms', result.realms);
                    return somethingChanged ? updatedProject : {};
                });
            } catch (error) {
                console.error("Failed to analyze a context batch:", error); hasError = true;
            }
        }
    };
    const workerPromises = Array.from({ length: Math.min(CONCURRENCY_LIMIT, batchQueue.length) }, () => worker());
    try {
        await Promise.all(workerPromises);
        if (hasError) alert("Phân tích bối cảnh hoàn tất với một số lỗi.");
    } catch (error) {
        alert("Đã xảy ra lỗi không mong muốn khi điều phối phân tích bối cảnh.");
    } finally {
        setIsAnalyzingContext(false);
    }
  };

  const handleAddContextItem = (type: ContextType) => {
    const newItem: ContextItem = { id: Date.now().toString(), chineseName: '', vietnameseName: '', description: '' };
    onUpdateProject(project.id, p => ({ [type]: [...(p[type] || []), newItem] }));
  };

  const handleDeleteContextItem = (type: ContextType, id: string) => {
    onUpdateProject(project.id, p => ({ [type]: (p[type] || []).filter(item => item.id !== id) }));
  };
  
  const handleUpdateContextItem = (type: ContextType, id: string, field: 'chineseName' | 'vietnameseName' | 'description', value: string) => {
    onUpdateProject(project.id, p => ({ [type]: (p[type] || []).map(item => item.id === id ? { ...item, [field]: value } : item) }));
  };
    
    const renderContextColumn = (type: ContextType, title: string) => (
    <div className="bg-gray-800/50 p-4 rounded-lg">
        <div className="flex justify-between items-center mb-3">
            <h4 className="font-semibold text-lg">{title}</h4>
            <button onClick={() => handleAddContextItem(type)} className="text-indigo-400 hover:text-indigo-300"><PlusIcon className="w-5 h-5"/></button>
        </div>
        <div className="space-y-3 max-h-[calc(100vh-350px)] overflow-y-auto pr-2">
            {(project[type] || []).map(item => (
                <div key={item.id} className="bg-gray-700/50 p-3 rounded-md space-y-2">
                    <div className="flex justify-end">
                         <button onClick={() => handleDeleteContextItem(type, item.id)} className="text-gray-500 hover:text-red-500 flex-shrink-0"><TrashIcon className="w-4 h-4"/></button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                       <input
                            type="text"
                            placeholder="Tên Tiếng Trung"
                            value={item.chineseName}
                            onChange={e => handleUpdateContextItem(type, item.id, 'chineseName', e.target.value)}
                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                         <input
                            type="text"
                            placeholder="Tên Tiếng Việt"
                            value={item.vietnameseName}
                            onChange={e => handleUpdateContextItem(type, item.id, 'vietnameseName', e.target.value)}
                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                    </div>
                    <textarea
                        placeholder="Mô tả..."
                        value={item.description}
                        onChange={e => handleUpdateContextItem(type, item.id, 'description', e.target.value)}
                        className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-300 outline-none resize-none h-20 focus:ring-2 focus:ring-indigo-500"
                    />
                </div>
            ))}
        </div>
    </div>
  );

  return (
      <div className="p-6 h-full overflow-y-auto flex flex-col">
          <div className="flex justify-between items-center mb-4 pb-4 border-b border-gray-700">
              <h3 className="text-xl font-semibold">Phân Tích Bối Cảnh</h3>
              <div className="flex items-center space-x-6">
                  <div className="flex items-center space-x-4">
                      <label className="flex items-center space-x-2 cursor-pointer">
                          <input type="checkbox" checked={analysisOptions.locations} onChange={e => setAnalysisOptions(o => ({...o, locations: e.target.checked}))} className="form-checkbox bg-gray-700 border-gray-600 text-indigo-500 h-5 w-5 rounded focus:ring-indigo-500"/>
                          <span>Địa danh</span>
                      </label>
                      <label className="flex items-center space-x-2 cursor-pointer">
                          <input type="checkbox" checked={analysisOptions.skills} onChange={e => setAnalysisOptions(o => ({...o, skills: e.target.checked}))} className="form-checkbox bg-gray-700 border-gray-600 text-indigo-500 h-5 w-5 rounded focus:ring-indigo-500"/>
                          <span>Kỹ năng</span>
                      </label>
                      <label className="flex items-center space-x-2 cursor-pointer">
                          <input type="checkbox" checked={analysisOptions.realms} onChange={e => setAnalysisOptions(o => ({...o, realms: e.target.checked}))} className="form-checkbox bg-gray-700 border-gray-600 text-indigo-500 h-5 w-5 rounded focus:ring-indigo-500"/>
                          <span>Cảnh giới</span>
                      </label>
                  </div>
                  <button onClick={handleAnalyzeContext} disabled={isAnalyzingContext} className="bg-cyan-600 hover:bg-cyan-700 disabled:bg-cyan-800 disabled:cursor-wait text-white font-bold py-2 px-4 rounded-md flex items-center space-x-2">
                      {isAnalyzingContext ? <LoadingSpinner className="w-5 h-5"/> : <SparklesIcon className="w-5 h-5"/>}
                      <span>Phân Tích (AI)</span>
                  </button>
              </div>
          </div>
          <p className="text-gray-400 mb-6">Sử dụng AI để tự động trích xuất địa danh, kỹ năng và cảnh giới từ kịch bản. Chọn các mục bạn muốn phân tích và bắt đầu.</p>
          <div className="flex-grow grid grid-cols-1 md:grid-cols-3 gap-6">
              {renderContextColumn('locations', 'Địa Danh')}
              {renderContextColumn('skills', 'Kỹ Năng')}
              {renderContextColumn('realms', 'Cảnh Giới')}
          </div>
      </div>
  );
};
export default ProjectContext;

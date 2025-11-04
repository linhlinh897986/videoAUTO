import React, { useState } from 'react';
import { Project, Character, SrtFile } from '../../types';
import { analyzeCharacters } from '../../services/geminiService';
import { formatForGemini } from '../../services/srtParser';
import { PlusIcon, TrashIcon, SparklesIcon, LoadingSpinner } from '../ui/Icons';


interface ProjectCharactersProps {
  project: Project;
  onUpdateProject: (projectId: string, updates: Partial<Project> | ((p: Project) => Partial<Project>)) => void;
}

const ProjectCharacters: React.FC<ProjectCharactersProps> = ({ project, onUpdateProject }) => {
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const srtFiles = project.files.filter((f): f is SrtFile => f.type === 'srt');
    
    const handleAnalyzeAllCharacters = async () => {
    setIsAnalyzing(true);
    const filesToAnalyze = srtFiles;
    if (!filesToAnalyze || filesToAnalyze.length === 0) {
        console.warn("Không có tệp để phân tích. Vui lòng tải lên tệp SRT trước.");
        setIsAnalyzing(false);
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

            const batchContent = batch
                .map(file => formatForGemini(file.originalSubtitles))
                .join('\n\n---\n\n');

            if (!batchContent.trim()) continue;

            try {
                const newCharacters = await analyzeCharacters(batchContent, project.characterProfile || [], project);
                
                if (newCharacters.length > 0) {
                    onUpdateProject(project.id, p => {
                        const currentProfile = p.characterProfile || [];
                        const existingNames = new Set(currentProfile.map(c => c.chineseName));
                        const trulyNewCharacters = newCharacters.filter(nc => !existingNames.has(nc.chineseName));
                        if (trulyNewCharacters.length > 0) {
                            return { characterProfile: [...currentProfile, ...trulyNewCharacters] };
                        }
                        return {};
                    });
                }
            } catch (error) {
                console.error("Failed to analyze a character batch:", error);
                hasError = true;
            }
        }
    };

    const workerPromises = Array.from({ length: Math.min(CONCURRENCY_LIMIT, batchQueue.length) }, () => worker());

    try {
        await Promise.all(workerPromises);
        if (hasError) {
            console.warn("Phân tích nhân vật hoàn tất với một số lỗi.");
        } else {
            console.log("Phân tích nhân vật hoàn tất.");
        }
    } catch (error) {
      console.error("An unexpected error occurred during character analysis orchestration:", error);
    } finally {
        setIsAnalyzing(false);
    }
  };


  const handleCharacterChange = (id: string, field: keyof Omit<Character, 'id'>, value: string) => {
     onUpdateProject(project.id, p => ({
       characterProfile: (p.characterProfile || []).map(char => char.id === id ? { ...char, [field]: value } : char)
     }));
  };
  
  const handleAddCharacter = () => {
      const newCharacter: Character = { id: Date.now().toString(), chineseName: '', vietnameseName: '', relationship: '', addressing: '', gender: '', age: '' };
      onUpdateProject(project.id, p => ({
        characterProfile: [...(p.characterProfile || []), newCharacter]
      }));
  };
  
  const handleDeleteCharacter = (id: string) => {
    onUpdateProject(project.id, p => ({
      characterProfile: (p.characterProfile || []).filter(char => char.id !== id)
    }));
  };
    
    return (
     <div className="p-6 h-full overflow-y-auto">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold">Hồ Sơ Nhân Vật</h3>
        <div className="flex space-x-2">
            <button 
                onClick={handleAnalyzeAllCharacters} 
                disabled={isAnalyzing} 
                className="bg-cyan-600 hover:bg-cyan-700 disabled:bg-cyan-800 disabled:cursor-wait text-white font-bold py-2 px-4 rounded-md flex items-center space-x-2"
            >
                {isAnalyzing ? <LoadingSpinner className="w-5 h-5"/> : <SparklesIcon className="w-5 h-5"/>}
                <span>Phân Tích Nhân Vật (AI)</span>
            </button>
            <button onClick={handleAddCharacter} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-md flex items-center space-x-2">
                <PlusIcon className="w-5 h-5"/><span>Thêm Thủ Công</span>
            </button>
        </div>
      </div>
       <p className="text-gray-400 mb-6">Sử dụng AI để tự động phát hiện các nhân vật và tạo hồ sơ từ kịch bản, hoặc thêm thủ công. Hồ sơ giúp AI duy trì cách xưng hô và mối quan hệ nhất quán.</p>
       <div className="space-y-4">
        {(project.characterProfile || []).map(char => (
          <div key={char.id} className="bg-gray-700/50 p-4 rounded-lg space-y-3">
            <div className="flex justify-between items-start">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-grow">
                 <div>
                    <label className="text-xs text-gray-400 block mb-1">Tên Tiếng Trung</label>
                    <input type="text" value={char.chineseName} onChange={e => handleCharacterChange(char.id, 'chineseName', e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none" />
                 </div>
                 <div>
                    <label className="text-xs text-gray-400 block mb-1">Tên Tiếng Việt</label>
                    <input type="text" value={char.vietnameseName} onChange={e => handleCharacterChange(char.id, 'vietnameseName', e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none" />
                 </div>
                 <div>
                    <label className="text-xs text-gray-400 block mb-1">Giới tính</label>
                    <input type="text" value={char.gender || ''} onChange={e => handleCharacterChange(char.id, 'gender', e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none" />
                 </div>
                 <div>
                    <label className="text-xs text-gray-400 block mb-1">Tuổi</label>
                    <input type="text" value={char.age || ''} onChange={e => handleCharacterChange(char.id, 'age', e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none" />
                 </div>
                 <div className="md:col-span-2">
                    <label className="text-xs text-gray-400 block mb-1">Mối Quan Hệ / Vai Trò</label>
                    <input type="text" value={char.relationship} onChange={e => handleCharacterChange(char.id, 'relationship', e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none" />
                 </div>
                 <div className="md:col-span-2">
                    <label className="text-xs text-gray-400 block mb-1">Kiểu Xưng Hô</label>
                    <input type="text" value={char.addressing} onChange={e => handleCharacterChange(char.id, 'addressing', e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none" />
                 </div>
              </div>
              <button onClick={() => handleDeleteCharacter(char.id)} className="text-gray-500 hover:text-red-500 ml-4"><TrashIcon className="w-5 h-5"/></button>
            </div>
          </div>
        ))}
       </div>
    </div>
    );
};

export default ProjectCharacters;

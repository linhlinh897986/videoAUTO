import React from 'react';
import { Project } from '../../types';
import { PlusIcon, TrashIcon } from '../ui/Icons';

interface ProjectKeywordsProps {
  project: Project;
  onUpdateProject: (projectId: string, updates: Partial<Project> | ((p: Project) => Partial<Project>)) => void;
}

const ProjectKeywords: React.FC<ProjectKeywordsProps> = ({ project, onUpdateProject }) => {

  const handleKeywordChange = (id: string, field: 'find' | 'replace', value: string) => {
    onUpdateProject(project.id, p => ({
      keywords: p.keywords.map(kw => kw.id === id ? { ...kw, [field]: value } : kw)
    }));
  };
  const handleAddKeyword = () => {
    onUpdateProject(project.id, p => ({
      keywords: [...(p.keywords || []), { id: Date.now().toString(), find: '', replace: '' }]
    }));
  };
  const handleDeleteKeyword = (id: string) => {
    onUpdateProject(project.id, p => ({
      keywords: p.keywords.filter(kw => kw.id !== id)
    }));
  };

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold">Thay Thế Từ Khóa</h3>
        <button onClick={handleAddKeyword} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-md flex items-center space-x-2">
          <PlusIcon className="w-5 h-5"/><span>Thêm Từ Khóa</span>
        </button>
      </div>
      <p className="text-gray-400 mb-6">Xác định các từ hoặc cụm từ cụ thể sẽ được thay thế trong quá trình dịch. Điều này hữu ích cho tên riêng, địa danh hoặc thuật ngữ kỹ thuật.</p>
      <div className="space-y-3">
        {(project.keywords || []).map(kw => (
          <div key={kw.id} className="flex items-center space-x-3 bg-gray-700/50 p-3 rounded-md">
            <input type="text" placeholder="Tìm" value={kw.find} onChange={e => handleKeywordChange(kw.id, 'find', e.target.value)} className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none" />
            <input type="text" placeholder="Thay thế" value={kw.replace} onChange={e => handleKeywordChange(kw.id, 'replace', e.target.value)} className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none" />
            <button onClick={() => handleDeleteKeyword(kw.id)} className="text-gray-500 hover:text-red-500"><TrashIcon className="w-5 h-5"/></button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProjectKeywords;

import React, { useState } from 'react';
import { Project } from '../../types';
import { PlusIcon, TrashIcon, ArrowRightIcon } from '../ui/Icons';

interface ProjectManagerProps {
  projects: Project[];
  onSelectProject: (id: string) => void;
  onAddProject: (name: string) => void | Promise<void>;
  onDeleteProject: (id: string) => void | Promise<void>;
}

const ProjectManager: React.FC<ProjectManagerProps> = ({ projects, onSelectProject, onAddProject, onDeleteProject }) => {
  const [newProjectName, setNewProjectName] = useState('');

  const handleAddProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (newProjectName.trim()) {
      void onAddProject(newProjectName.trim());
      setNewProjectName('');
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 relative">
      <div className="w-full max-w-2xl">
        <div className="bg-gray-800 shadow-2xl rounded-lg p-6 mb-8">
          <h2 className="text-2xl font-semibold mb-4 text-white">Dự Án Mới</h2>
          <form onSubmit={handleAddProject} className="flex space-x-4">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Nhập tên dự án (ví dụ: Tên Phim S01)"
              className="flex-grow bg-gray-700 border border-gray-600 text-white rounded-md px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"
            />
            <button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-md flex items-center space-x-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!newProjectName.trim()}
            >
              <PlusIcon className="w-5 h-5" />
              <span>Tạo</span>
            </button>
          </form>
        </div>

        <div className="bg-gray-800 shadow-2xl rounded-lg p-6">
            <h2 className="text-2xl font-semibold mb-4 text-white">Các Dự Án Hiện Có</h2>
            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2">
                {projects.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">Chưa có dự án nào. Hãy tạo một dự án ở trên để bắt đầu!</p>
                ) : (
                    projects.map((project) => (
                        <div
                            key={project.id}
                            className="bg-gray-700 rounded-lg p-4 flex justify-between items-center group hover:bg-gray-600 transition"
                        >
                            <span className="font-medium text-lg">{project.name}</span>
                            <div className="flex items-center space-x-3">
                                <button
                                    onClick={() => void onDeleteProject(project.id)}
                                    className="text-gray-400 hover:text-red-500 transition"
                                    aria-label={`Xóa ${project.name}`}
                                >
                                    <TrashIcon className="w-5 h-5" />
                                </button>
                                <button
                                    onClick={() => onSelectProject(project.id)}
                                    className="bg-indigo-500 hover:bg-indigo-600 text-white font-semibold py-1 px-3 rounded-md flex items-center space-x-2 transition"
                                >
                                    <span>Mở</span>
                                    <ArrowRightIcon className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectManager;
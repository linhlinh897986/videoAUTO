import React, { useState, useMemo, useEffect } from 'react';
import { Project, SrtFile, CustomStyle, ApiKey } from '../../types';
import { PRESET_STYLES } from '../../constants';
import { BackArrowIcon, PencilIcon, SparklesIcon, FileIcon, UserAvatar, GlobeAltIcon } from '../ui/Icons';
import StyleManagerModal from '../modals/StyleManagerModal';
import ApiKeyManagerModal from '../modals/ApiKeyManagerModal';
import ProjectFiles from '../project/ProjectFiles';
import ProjectKeywords from '../project/ProjectKeywords';
import ProjectCharacters from '../project/ProjectCharacters';
import ProjectContext from '../project/ProjectContext';
import ProjectSettings from '../project/ProjectSettings';

interface ProjectViewProps {
  project: Project;
  onUpdateProject: (projectId: string, updates: Partial<Project> | ((p: Project) => Partial<Project>)) => void;
  onBack: () => void;
  customStyles: CustomStyle[];
  onUpdateCustomStyles: (styles: CustomStyle[]) => void;
  apiKeys: ApiKey[];
  onApiKeysChange: (keys: ApiKey[]) => void;
  onRefreshApiKeys: () => void;
  onEditVideo: (videoId: string, srtId: string) => void;
  processingStatus: { [id: string]: string };
  setProcessingStatus: React.Dispatch<React.SetStateAction<{ [id: string]: string }>>;
}

type Tab = 'files' | 'keywords' | 'characters' | 'context' | 'settings';

const ProjectView: React.FC<ProjectViewProps> = (props) => {
  const { project, onUpdateProject, onBack, customStyles, onUpdateCustomStyles, apiKeys, onApiKeysChange, onRefreshApiKeys, onEditVideo, processingStatus, setProcessingStatus } = props;
  const [activeTab, setActiveTab] = useState<Tab>('files');
  const [isStyleModalOpen, setIsStyleModalOpen] = useState(false);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);

  const handleSelectPrompt = (prompt: string) => onUpdateProject(project.id, { stylePrompt: prompt });

  const currentStyleName = useMemo(() => ([...PRESET_STYLES, ...customStyles].find(style => style.prompt === project.stylePrompt)?.name || 'Phong cách tùy chỉnh'), [project.stylePrompt, customStyles]);

  const TABS: { id: Tab, name: string, icon: React.ReactNode }[] = [
      { id: 'files', name: `Tệp Tin (${project.files.length})`, icon: <FileIcon className="w-5 h-5 mr-2" />},
      { id: 'keywords', name: `Từ Khóa (${(project.keywords || []).length})`, icon: <SparklesIcon className="w-5 h-5 mr-2" />},
      { id: 'characters', name: `Nhân Vật (${(project.characterProfile || []).length})`, icon: <UserAvatar className="w-5 h-5 mr-2"/> },
      { id: 'context', name: `Bối Cảnh (${(project.locations?.length || 0) + (project.skills?.length || 0) + (project.realms?.length || 0)})`, icon: <GlobeAltIcon className="w-5 h-5 mr-2"/> },
      { id: 'settings', name: 'Cài Đặt', icon: <PencilIcon className="w-5 h-5 mr-2"/>},
  ];

  return (
    <div className="bg-gray-900 text-white min-h-screen flex flex-col">
      <header className="bg-gray-800/50 backdrop-blur-sm border-b border-gray-700 p-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center">
            <button onClick={onBack} className="mr-4 text-gray-400 hover:text-white"><BackArrowIcon /></button>
            <h1 className="text-2xl font-bold">{project.name}</h1>
        </div>
      </header>
      <main className="flex-grow flex flex-col md:flex-row">
        <nav className="w-full md:w-64 border-b md:border-b-0 md:border-r border-gray-700 p-4">
            <ul className="space-y-2">
                {TABS.map(tab => (
                    <li key={tab.id}>
                        <button onClick={() => setActiveTab(tab.id)} className={`w-full text-left flex items-center p-3 rounded-md transition ${activeTab === tab.id ? 'bg-indigo-600 text-white' : 'hover:bg-gray-700 text-gray-300'}`}>
                            {tab.icon} {tab.name}
                        </button>
                    </li>
                ))}
            </ul>
        </nav>
        <section className="flex-grow">
          <div className="h-[calc(100vh-69px)]">
             {activeTab === 'files' && <ProjectFiles {...props} processingStatus={processingStatus} setProcessingStatus={setProcessingStatus} />}
             {activeTab === 'keywords' && <ProjectKeywords {...props} />}
             {activeTab === 'characters' && <ProjectCharacters {...props} />}
             {activeTab === 'context' && <ProjectContext {...props} />}
             {activeTab === 'settings' && <ProjectSettings {...props} setIsApiKeyModalOpen={setIsApiKeyModalOpen} setIsStyleModalOpen={setIsStyleModalOpen} currentStyleName={currentStyleName} />}
          </div>
        </section>
      </main>

      <StyleManagerModal 
        isOpen={isStyleModalOpen}
        onClose={() => setIsStyleModalOpen(false)}
        customStyles={customStyles}
        onUpdateCustomStyles={onUpdateCustomStyles}
        onSelectPrompt={handleSelectPrompt}
      />
      <ApiKeyManagerModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        apiKeys={apiKeys}
        onUpdateApiKeys={onApiKeysChange}
      />
    </div>
  );
};

export default ProjectView;

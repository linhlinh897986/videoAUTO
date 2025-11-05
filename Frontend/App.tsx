import React, { useState, useEffect } from 'react';
import { Project, CustomStyle, ApiKey, VideoFile, SrtFile } from './types';
import useLocalStorage from './hooks/useLocalStorage';
import ProjectManager from './components/views/ProjectManager';
import ProjectView from './components/views/ProjectView';
import ProfessionalVideoEditor from './components/views/ProfessionalVideoEditor';
import * as dataService from './services/projectService';
import { PRESET_STYLES, AVAILABLE_MODELS } from './constants';
import { LoadingSpinner } from './components/ui/Icons';

const App: React.FC = () => {
    // State management
    const [projects, setProjects] = useState<Project[]>([]);
    const [customStyles, setCustomStyles] = useState<CustomStyle[]>([]);
    const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);

    const [selectedProjectId, setSelectedProjectId] = useLocalStorage<string | null>('srt-translator-selected-project-id', null);
    
    const [isLoading, setIsLoading] = useState(true);
    const [editingFileIds, setEditingFileIds] = useState<{ projectId: string; videoId: string; srtId: string } | null>(null);
    const [processingStatus, setProcessingStatus] = useState<{ [id: string]: string }>({});


    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            try {
                const loadedData = await dataService.init();
                setProjects(loadedData.projects);
                setApiKeys(loadedData.apiKeys);
                setCustomStyles(loadedData.customStyles);
            } catch (error) {
                console.error("Failed to initialize data service:", error);
                alert(`Không thể tải dữ liệu. Lỗi: ${error instanceof Error ? error.message : String(error)}. Vui lòng thử lại.`);
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, []);

    useEffect(() => {
      const fetchUserIp = async () => {
        try {
          const response = await fetch('https://api.ipify.org?format=json');
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          const data = await response.json();
          console.log('Địa chỉ IP của người dùng:', data.ip);
        } catch (error) {
          console.error('Không thể lấy địa chỉ IP của người dùng:', error);
        }
      };

      fetchUserIp();
    }, []); // Mảng phụ thuộc rỗng đảm bảo hook này chỉ chạy một lần khi component được mount

    const selectedProject = projects.find(p => p.id === selectedProjectId);
    
    const projectForEditor = editingFileIds ? projects.find(p => p.id === editingFileIds.projectId) : null;
    const videoFileForEditor = projectForEditor ? projectForEditor.files.find(f => f.id === editingFileIds.videoId && f.type === 'video') as VideoFile : null;
    const srtFileForEditor = projectForEditor ? projectForEditor.files.find(f => f.id === editingFileIds.srtId && f.type === 'srt') as SrtFile : null;

    const handleRefreshApiKeys = async () => {
        const freshKeys = await dataService.getApiKeys();
        setApiKeys(freshKeys);
    };

    // --- Data Handlers ---

    const handleAddProject = async (name: string) => {
        const newProject: Project = {
            id: Date.now().toString(),
            name,
            stylePrompt: PRESET_STYLES[0]?.prompt || '',
            keywords: [],
            model: AVAILABLE_MODELS[0],
            files: [],
            characterProfile: [],
            translationConcurrency: 5,
            maxTokensPerRequest: 20000,
            keywordHandling: 'api',
            thinkingEnabled: true,
            locations: [],
            skills: [],
            realms: [],
            subtitleStyle: {
                fontFamily: 'Arial',
                fontSize: 48,
                primaryColor: '#FFFFFF',
                outlineColor: '#000000',
                outlineWidth: 2.5,
                verticalMargin: 8,
                horizontalAlign: 'center',
            },
            autoAnalyzeHardsubs: true,
            autoGenerateWaveform: true,
        };

        setProjects(prev => [...prev, newProject]);
        setSelectedProjectId(newProject.id);

        try {
            await dataService.saveProject(newProject);
        } catch (error) {
            console.error('Failed to save project:', error);
            setProjects(prev => prev.filter(p => p.id !== newProject.id));
            setSelectedProjectId(prev => (prev === newProject.id ? null : prev));
            alert(`Không thể lưu dự án mới. Lỗi: ${error instanceof Error ? error.message : String(error)}.`);
        }
    };

    const handleDeleteProject = async (id: string) => {
        const previousProjects = projects;
        const wasSelected = selectedProjectId === id;
        setProjects(previousProjects.filter(proj => proj.id !== id));
        if (wasSelected) {
            setSelectedProjectId(null);
        }

        try {
            await dataService.deleteProject(id);
        } catch (error) {
            console.error('Failed to delete project:', error);
            setProjects(previousProjects);
            if (wasSelected) {
                setSelectedProjectId(id);
            }
            alert(`Không thể xóa dự án. Lỗi: ${error instanceof Error ? error.message : String(error)}.`);
        }
    };

    const handleUpdateProject = (projectId: string, updates: Partial<Project> | ((p: Project) => Partial<Project>)) => {
        let previousProject: Project | null = null;
        let updatedProject: Project | null = null;

        setProjects(currentProjects =>
            currentProjects.map(p => {
                if (p.id === projectId) {
                    previousProject = p;
                    const newValues = typeof updates === 'function' ? updates(p) : updates;
                    updatedProject = { ...p, ...newValues };
                    return updatedProject;
                }
                return p;
            })
        );

        if (updatedProject) {
            void dataService.saveProject(updatedProject).catch(error => {
                console.error('Failed to update project:', error);
                if (previousProject) {
                    setProjects(current => current.map(p => (p.id === projectId ? previousProject as Project : p)));
                }
                alert(`Không thể cập nhật dự án. Lỗi: ${error instanceof Error ? error.message : String(error)}.`);
            });
        }
    };

    const handleUpdateApiKeys = async (keys: ApiKey[]) => {
        setApiKeys(keys);
        try {
            await dataService.saveApiKeys(keys);
        } catch (error) {
            console.error('Failed to save API keys:', error);
            alert(`Không thể lưu API key. Lỗi: ${error instanceof Error ? error.message : String(error)}.`);
        }
    };

    const handleUpdateCustomStyles = async (styles: CustomStyle[]) => {
        setCustomStyles(styles);
        try {
            await dataService.saveCustomStyles(styles);
        } catch (error) {
            console.error('Failed to save custom styles:', error);
            alert(`Không thể lưu phong cách tùy chỉnh. Lỗi: ${error instanceof Error ? error.message : String(error)}.`);
        }
    };
    
    const handleSelectProject = (id: string) => {
        setSelectedProjectId(id);
    };

    const handleBackToManager = () => {
        setSelectedProjectId(null);
    };
    
    const handleSwitchEditorFile = (newVideoId: string, newSrtId: string) => {
        setEditingFileIds(prev => {
            if (!prev) return null;
            return {
                ...prev,
                videoId: newVideoId,
                srtId: newSrtId,
            };
        });
    };

    // Main render logic
    if (isLoading) {
        return (
            <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-white">
                <LoadingSpinner className="w-12 h-12 mb-4" />
                <p>Đang tải dữ liệu...</p>
            </div>
        );
    }
    
    if (editingFileIds && projectForEditor && videoFileForEditor && srtFileForEditor) {
        return (
            <ProfessionalVideoEditor
                project={projectForEditor}
                videoFile={videoFileForEditor}
                srtFile={srtFileForEditor}
                onUpdateProject={handleUpdateProject}
                onExit={() => setEditingFileIds(null)}
                onSwitchFile={handleSwitchEditorFile}
            />
        );
    }


    if (selectedProject) {
        return (
            <ProjectView
                project={selectedProject}
                onUpdateProject={handleUpdateProject}
                onBack={handleBackToManager}
                customStyles={customStyles}
                onUpdateCustomStyles={handleUpdateCustomStyles}
                apiKeys={apiKeys}
                onApiKeysChange={handleUpdateApiKeys}
                onRefreshApiKeys={handleRefreshApiKeys}
                onEditVideo={(videoId, srtId) => setEditingFileIds({ projectId: selectedProject.id, videoId, srtId })}
                processingStatus={processingStatus}
                setProcessingStatus={setProcessingStatus}
            />
        );
    }

    return (
        <ProjectManager
            projects={projects}
            onSelectProject={handleSelectProject}
            onAddProject={handleAddProject}
            onDeleteProject={handleDeleteProject}
        />
    );
};

export default App;
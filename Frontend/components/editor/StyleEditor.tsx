import React, { useState, useEffect } from 'react';
import { Project, SubtitleStyle, BoundingBox, VideoFile } from '../../types';
import { SparklesIcon, LoadingSpinner, TrashIcon } from '../ui/Icons';


interface StyleEditorProps {
    project: Project;
    videoFile: VideoFile;
    onUpdateProject: (projectId: string, updates: Partial<Project> | ((p: Project) => Partial<Project>)) => void;
    onAnalyzeHardsubs: () => void;
    isAnalyzingHardsubs: boolean;
    analysisProgress: { progress: number; status: string };
    onUpdateHardsubBox: (box: BoundingBox) => void;
}

const FONT_FAMILIES = [
    'Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Impact',
    'Times New Roman', 'Georgia', 'Courier New', 'Lucida Console'
];

const StyleEditor: React.FC<StyleEditorProps> = ({ 
    project, videoFile, onUpdateProject, 
    onAnalyzeHardsubs, isAnalyzingHardsubs, analysisProgress,
    onUpdateHardsubBox
}) => {
    
    const defaultStyle: SubtitleStyle = {
        fontFamily: 'Arial',
        fontSize: 48,
        primaryColor: '#FFFFFF',
        outlineColor: '#000000',
        outlineWidth: 2.5,
        verticalMargin: 8,
        horizontalAlign: 'center',
    };

    const [style, setStyle] = useState<SubtitleStyle>(project.subtitleStyle || defaultStyle);
    const hardsubCoverBox = videoFile.hardsubCoverBox;

    useEffect(() => {
        if (JSON.stringify(project.subtitleStyle) !== JSON.stringify(style)) {
            setStyle(project.subtitleStyle || defaultStyle);
        }
    }, [project.subtitleStyle]);

    const handleStyleChange = (field: keyof SubtitleStyle, value: any) => {
        const newStyle = { ...style, [field]: value };
        setStyle(newStyle);
        onUpdateProject(project.id, { subtitleStyle: newStyle });
    };

    const handleFrameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && file.type === 'image/png') {
            const reader = new FileReader();
            reader.onload = (event) => {
                const result = event.target?.result as string;
                handleStyleChange('videoFrameUrl', result);
            };
            reader.readAsDataURL(file);
        } else if (file) {
            alert("Vui lòng chỉ tải lên tệp tin PNG.");
        }
        e.target.value = '';
    };

    const handleRemoveFrame = () => {
        const newStyle = { ...style };
        delete newStyle.videoFrameUrl;
        setStyle(newStyle);
        onUpdateProject(project.id, { subtitleStyle: newStyle });
    };
    
    const handleHardsubBoxChange = (field: keyof BoundingBox, value: any) => {
        if (!hardsubCoverBox) return;
        const newBox = { ...hardsubCoverBox, [field]: value };
        onUpdateHardsubBox(newBox);
    };
    
    const handleRemoveHardsubBox = () => {
        onUpdateProject(project.id, p => ({
            files: p.files.map(f => {
                if (f.id === videoFile.id && f.type === 'video') {
                    const { hardsubCoverBox, ...rest } = f;
                    return rest;
                }
                return f;
            })
        }));
    };

    return (
        <div className="w-full h-full flex flex-col bg-gray-800/50 p-4 overflow-y-auto">
            <h3 className="text-lg font-semibold mb-6 text-center">Tùy Chỉnh Style</h3>

            {/* Controls Section */}
            <div className="space-y-5">
                 {/* Hardsub Cover Section */}
                <div className="space-y-3 p-3 bg-gray-900/30 rounded-lg">
                     <h4 className="text-md font-semibold text-gray-200">Che Hardsub (AI)</h4>
                    <p className="text-xs text-gray-400">Sử dụng AI để tự động phát hiện và che phụ đề gốc (hardsub) có sẵn trong video.</p>
                    <button
                        onClick={onAnalyzeHardsubs}
                        disabled={isAnalyzingHardsubs}
                        className="w-full bg-cyan-600 hover:bg-cyan-700 disabled:bg-cyan-800 disabled:cursor-wait text-white text-sm text-center font-bold py-2 px-4 rounded-md cursor-pointer transition flex items-center justify-center space-x-2"
                    >
                       {isAnalyzingHardsubs ? <LoadingSpinner className="w-5 h-5"/> : <SparklesIcon className="w-5 h-5"/>}
                       <span>Phân Tích & Che Hardsub</span>
                    </button>
                    {isAnalyzingHardsubs && (
                        <div className="text-center text-xs text-cyan-300">
                            <p>{analysisProgress.status}</p>
                            <div className="w-full bg-gray-700 rounded-full h-1.5 mt-1">
                                <div className="bg-cyan-500 h-1.5 rounded-full" style={{ width: `${analysisProgress.progress * 100}%` }}></div>
                            </div>
                        </div>
                    )}
                    {hardsubCoverBox && (
                         <div className="pt-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <label htmlFor="enable-cover" className="flex items-center space-x-2 cursor-pointer text-sm font-medium text-gray-300">
                                   Bật lớp che
                                </label>
                                 <label className="relative inline-flex items-center cursor-pointer">
                                  <input type="checkbox" id="enable-cover" checked={hardsubCoverBox.enabled} onChange={e => handleHardsubBoxChange('enabled', e.target.checked)} className="sr-only peer" />
                                  <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                                </label>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                {(['x', 'y', 'width', 'height'] as const).map(field => (
                                    <div key={field}>
                                        <label className="block text-xs text-gray-400 mb-1 capitalize">{field} (%)</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            value={hardsubCoverBox[field].toFixed(1)}
                                            onChange={e => handleHardsubBoxChange(field, parseFloat(e.target.value))}
                                            className="w-full bg-gray-700 border border-gray-600 text-white rounded-md px-2 py-1 text-sm focus:ring-1 focus:ring-indigo-500 outline-none"
                                        />
                                    </div>
                                ))}
                            </div>
                            <button onClick={handleRemoveHardsubBox} className="w-full text-xs text-red-400 hover:text-red-300 flex items-center justify-center space-x-1 pt-2">
                                <TrashIcon className="w-3 h-3"/>
                                <span>Xóa Vùng Che</span>
                            </button>
                         </div>
                    )}
                </div>
                
                <h3 className="text-lg font-semibold pt-4 text-center border-t border-gray-700">Style Phụ Đề Mềm</h3>

                {/* Font Family */}
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">Phông chữ</label>
                    <select
                        value={style.fontFamily}
                        onChange={e => handleStyleChange('fontFamily', e.target.value)}
                        className="w-full bg-gray-700 border border-gray-600 text-white rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    >
                        {FONT_FAMILIES.map(font => <option key={font} value={font}>{font}</option>)}
                    </select>
                </div>

                {/* Font Size */}
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">Kích thước chữ (px)</label>
                    <input
                        type="number"
                        min="10"
                        max="100"
                        value={style.fontSize}
                        onChange={e => handleStyleChange('fontSize', parseInt(e.target.value, 10) || style.fontSize)}
                        className="w-full bg-gray-700 border border-gray-600 text-white rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                </div>

                {/* Primary Color */}
                <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-300">Màu chính</label>
                    <input
                        type="color"
                        value={style.primaryColor}
                        onChange={e => handleStyleChange('primaryColor', e.target.value)}
                        className="w-16 h-8 bg-gray-700 border border-gray-600 rounded-md cursor-pointer"
                    />
                </div>

                {/* Outline Color */}
                <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-300">Màu viền</label>
                    <input
                        type="color"
                        value={style.outlineColor}
                        onChange={e => handleStyleChange('outlineColor', e.target.value)}
                        className="w-16 h-8 bg-gray-700 border border-gray-600 rounded-md cursor-pointer"
                    />
                </div>
                
                {/* Outline Width */}
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">Độ rộng viền (px)</label>
                    <input
                        type="number"
                        min="0"
                        max="10"
                        step="0.1"
                        value={style.outlineWidth}
                        onChange={e => handleStyleChange('outlineWidth', parseFloat(e.target.value) || 0)}
                        className="w-full bg-gray-700 border border-gray-600 text-white rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                </div>

                {/* Video Frame */}
                <div className="space-y-3 p-3 bg-gray-900/30 rounded-lg">
                    <h4 className="text-md font-semibold text-gray-200">Khung Video (PNG trong suốt)</h4>
                    <p className="text-xs text-gray-400">Thêm một ảnh PNG trong suốt để hiển thị trên video, bên dưới phụ đề.</p>
                    <div className="flex items-center space-x-4">
                        <label htmlFor="frame-upload" className="flex-1 bg-gray-600 hover:bg-gray-500 text-white text-sm text-center font-bold py-2 px-4 rounded-md cursor-pointer transition">
                            Tải Lên Khung
                        </label>
                        <input id="frame-upload" type="file" accept="image/png" className="hidden" onChange={handleFrameChange} />
                        {style.videoFrameUrl && (
                            <button onClick={handleRemoveFrame} className="bg-red-600 hover:bg-red-500 text-white text-sm font-bold py-2 px-4 rounded-md transition">
                                Xóa Khung
                            </button>
                        )}
                    </div>
                    {style.videoFrameUrl && (
                        <div className="mt-4 p-2 bg-black/30 rounded-md border border-gray-600">
                            <p className="text-xs text-gray-400 mb-2">Xem trước:</p>
                            <img src={style.videoFrameUrl} alt="Frame Preview" className="max-w-full h-auto rounded" style={{ backgroundColor: 'rgba(255, 255, 255, 0.1)' }}/>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StyleEditor;
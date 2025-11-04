import React, { useRef, useEffect } from 'react';
import { SubtitleBlock } from '../../types';
import { srtTimeToSeconds } from '../../services/srtParser';

interface SubtitleEditorProps {
    subtitles: SubtitleBlock[];
    activeSubtitleId: number | undefined;
    onSubtitleClick: (sub: SubtitleBlock) => void;
    onUpdateSubtitle: (id: number, newSub: Partial<SubtitleBlock>) => void;
}

const SubtitleEditor: React.FC<SubtitleEditorProps> = ({ subtitles, activeSubtitleId, onSubtitleClick, onUpdateSubtitle }) => {
    const activeSubtitleRef = useRef<HTMLDivElement>(null);
    
    useEffect(() => {
        if (activeSubtitleRef.current) {
            activeSubtitleRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [activeSubtitleId]);

    const handleTimeChange = (id: number, field: 'startTime' | 'endTime', value: string) => {
        // Basic validation for time format
        if (/^\d{2}:\d{2}:\d{2},\d{3}$/.test(value)) {
            onUpdateSubtitle(id, { [field]: value });
        }
    };

    return (
        <div className="w-full h-full flex flex-col bg-gray-800/50">
            <h3 className="p-2 text-lg font-semibold border-b border-gray-700 flex-shrink-0 text-center">Trình Chỉnh Sửa Phụ Đề</h3>
            <div className="flex-grow overflow-y-auto p-2 space-y-2">
                {subtitles.map(sub => (
                    <div 
                        key={sub.id} 
                        ref={sub.id === activeSubtitleId ? activeSubtitleRef : null}
                        className={`p-2 rounded-md border-l-4 transition-colors ${sub.id === activeSubtitleId ? 'bg-indigo-900/50 border-indigo-400' : 'bg-gray-800 border-transparent'}`}
                    >
                        <div className="flex items-center space-x-2 mb-1">
                            <input 
                                type="text" 
                                value={sub.startTime}
                                onChange={e => onUpdateSubtitle(sub.id, { startTime: e.target.value })}
                                onBlur={e => handleTimeChange(sub.id, 'startTime', e.target.value)}
                                className="font-mono text-xs bg-gray-700 rounded p-1 w-24 text-center outline-none focus:ring-1 focus:ring-indigo-400"
                            />
                            <span className="text-gray-400 text-xs">&rarr;</span>
                             <input 
                                type="text" 
                                value={sub.endTime}
                                onChange={e => onUpdateSubtitle(sub.id, { endTime: e.target.value })}
                                onBlur={e => handleTimeChange(sub.id, 'endTime', e.target.value)}
                                className="font-mono text-xs bg-gray-700 rounded p-1 w-24 text-center outline-none focus:ring-1 focus:ring-indigo-400"
                            />
                            <button onClick={() => onSubtitleClick(sub)} className="text-gray-400 hover:text-white text-xs ml-auto p-1">Phát</button>
                        </div>
                        <textarea 
                            value={sub.text}
                            onChange={(e) => onUpdateSubtitle(sub.id, { text: e.target.value })}
                            className="w-full bg-gray-900/50 text-gray-200 p-2 rounded-md resize-none text-sm leading-tight outline-none focus:ring-1 focus:ring-indigo-400"
                            rows={2}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};

export default SubtitleEditor;

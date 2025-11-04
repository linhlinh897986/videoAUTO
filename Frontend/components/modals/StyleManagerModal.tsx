import React, { useState, useEffect } from 'react';
import { CustomStyle } from '../../types';
import { PRESET_STYLES } from '../../constants';
import { PlusIcon, TrashIcon, PencilIcon, XMarkIcon } from '../ui/Icons';

interface StyleManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  customStyles: CustomStyle[];
  onUpdateCustomStyles: (styles: CustomStyle[]) => void;
  onSelectPrompt: (prompt: string) => void;
}

const StyleManagerModal: React.FC<StyleManagerModalProps> = ({
  isOpen,
  onClose,
  customStyles,
  onUpdateCustomStyles,
  onSelectPrompt
}) => {
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  const [editingStyle, setEditingStyle] = useState<{ id: string; name: string; prompt: string } | null>(null);

  useEffect(() => {
    if (isOpen && !selectedStyleId && customStyles.length > 0) {
      setSelectedStyleId(customStyles[0].id);
    } else if (isOpen && !selectedStyleId && customStyles.length === 0 && PRESET_STYLES.length > 0) {
      setSelectedStyleId(PRESET_STYLES[0].name);
    }
  }, [isOpen, customStyles, selectedStyleId]);
  
  useEffect(() => {
    const allStyles = [...PRESET_STYLES.map(p => ({...p, id: p.name})), ...customStyles];
    const selected = allStyles.find(s => s.id === selectedStyleId);
    if (selected) {
      setEditingStyle({ id: selected.id, name: selected.name, prompt: selected.prompt });
    } else if (allStyles.length > 0) {
        setSelectedStyleId(allStyles[0].id);
    }
    else {
      setEditingStyle(null);
    }
  }, [selectedStyleId, customStyles]);

  if (!isOpen) return null;

  const isPresetSelected = PRESET_STYLES.some(p => p.name === selectedStyleId);

  const handleCreateNew = () => {
    const newId = Date.now().toString();
    const newStyle = { id: newId, name: 'Phong Cách Tùy Chỉnh Mới', prompt: 'Nhập mẫu lệnh của bạn tại đây...' };
    onUpdateCustomStyles([...customStyles, newStyle]);
    setSelectedStyleId(newId);
  };

  const handleSaveChanges = () => {
    if (!editingStyle || isPresetSelected) return;
    onUpdateCustomStyles(customStyles.map(s => s.id === editingStyle.id ? editingStyle : s));
  };
  
  const handleDelete = (id: string) => {
    onUpdateCustomStyles(customStyles.filter(s => s.id !== id));
    setSelectedStyleId(PRESET_STYLES[0]?.name || null);
  };

  const handleSelectAndClose = () => {
    if (editingStyle) {
      onSelectPrompt(editingStyle.prompt);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white">Quản Lý Phong Cách Dịch</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><XMarkIcon /></button>
        </div>
        
        <div className="flex-grow flex overflow-hidden">
          {/* Left Panel: Style List */}
          <div className="w-1/3 border-r border-gray-700 overflow-y-auto p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Mẫu Cài Sẵn</h3>
              <div className="space-y-1">
                {PRESET_STYLES.map(preset => (
                  <div key={preset.name} onClick={() => setSelectedStyleId(preset.name)} className={`p-2 rounded-md cursor-pointer text-sm ${selectedStyleId === preset.name ? 'bg-indigo-600 text-white' : 'hover:bg-gray-700'}`}>
                    {preset.name}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Phong Cách Của Bạn</h3>
                <button onClick={handleCreateNew} className="text-indigo-400 hover:text-indigo-300"><PlusIcon className="w-5 h-5"/></button>
              </div>
              <div className="space-y-1">
                {customStyles.map(style => (
                   <div key={style.id} onClick={() => setSelectedStyleId(style.id)} className={`flex items-center justify-between p-2 rounded-md cursor-pointer text-sm ${selectedStyleId === style.id ? 'bg-indigo-600 text-white' : 'hover:bg-gray-700'}`}>
                    <span>{style.name}</span>
                    {selectedStyleId === style.id && (
                       <button onClick={(e) => {e.stopPropagation(); handleDelete(style.id)}} className="text-red-400 hover:text-red-300"><TrashIcon className="w-4 h-4"/></button>
                    )}
                   </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Panel: Editor */}
          <div className="w-2/3 flex flex-col p-4">
            {editingStyle ? (
              <>
                <input
                  type="text"
                  value={editingStyle.name}
                  onChange={(e) => setEditingStyle({...editingStyle, name: e.target.value})}
                  disabled={isPresetSelected}
                  className="bg-gray-900 text-white text-lg font-semibold p-2 rounded-md mb-3 outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-transparent disabled:text-gray-300"
                />
                <textarea
                  value={editingStyle.prompt}
                  onChange={(e) => setEditingStyle({...editingStyle, prompt: e.target.value})}
                  disabled={isPresetSelected}
                  className="flex-grow bg-gray-900 text-gray-300 p-3 rounded-md outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-900/50 resize-none"
                />
                 {!isPresetSelected && <button onClick={handleSaveChanges} className="mt-4 bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-md w-full">Lưu Thay Đổi</button>}
              </>
            ) : (
              <div className="flex-grow flex items-center justify-center text-gray-500">Chọn hoặc tạo một phong cách.</div>
            )}
          </div>
        </div>
        
        <div className="p-4 border-t border-gray-700 flex justify-end">
          <button onClick={handleSelectAndClose} disabled={!editingStyle} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-5 rounded-md disabled:opacity-50">
              Sử Dụng Phong Cách Này
          </button>
        </div>
      </div>
    </div>
  );
};
export default StyleManagerModal;
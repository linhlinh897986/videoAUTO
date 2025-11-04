import React, { useState, useEffect } from 'react';
import { ApiKey } from '../../types';
import { PlusIcon, TrashIcon, XMarkIcon } from '../ui/Icons';

interface ApiKeyManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKeys: ApiKey[];
  onUpdateApiKeys: (keys: ApiKey[]) => void;
}

const ApiKeyManagerModal: React.FC<ApiKeyManagerModalProps> = ({ isOpen, onClose, apiKeys, onUpdateApiKeys }) => {
  const [newKeyValue, setNewKeyValue] = useState('');
  const [timeUntilReset, setTimeUntilReset] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    // A function to calculate and set the time
    const calculateAndSetTime = () => {
        const now = new Date();
        // Target is midnight UTC of the *next* day
        const tomorrowUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
        const diff = tomorrowUTC.getTime() - now.getTime();

        if (diff <= 0) {
            setTimeUntilReset('00:00:00');
            return;
        }

        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        setTimeUntilReset(
            `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        );
    };
    
    calculateAndSetTime(); // Initial calculation
    const timerId = setInterval(calculateAndSetTime, 1000);

    // Cleanup interval on component unmount or when isOpen becomes false
    return () => clearInterval(timerId);
  }, [isOpen]);


  if (!isOpen) return null;

  const handleAddKey = () => {
    if (newKeyValue.trim() === '') return;

    const newKey: ApiKey = {
      id: Date.now().toString(),
      value: newKeyValue.trim(),
      usage: {
        total: 0,
        daily: {},
      },
      status: 'active',
      lastUsed: 0,
      createdAt: Date.now(),
    };

    onUpdateApiKeys([...apiKeys, newKey]);
    setNewKeyValue('');
  };

  const handleDeleteKey = (id: string) => {
    onUpdateApiKeys(apiKeys.filter(key => key.id !== id));
  };
  
  const handleResetStatus = (id: string) => {
    onUpdateApiKeys(apiKeys.map(key => key.id === id ? { ...key, status: 'active' } : key));
  };

  // This correctly uses the UTC date, which aligns with the UTC reset timer.
  const todayStr = new Date().toISOString().split('T')[0];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-gray-700">
          <div className="flex items-center space-x-4">
              <h2 className="text-xl font-bold text-white">Quản Lý API Keys</h2>
              {timeUntilReset && (
                  <div className="text-sm font-mono bg-gray-700 text-cyan-300 px-3 py-1 rounded-md">
                      <span>Làm mới sau: </span>
                      <span className="font-semibold tracking-wider">{timeUntilReset}</span>
                  </div>
              )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><XMarkIcon /></button>
        </div>
        
        <div className="flex-grow p-6 overflow-y-auto space-y-4">
          {apiKeys.map(key => (
            <div key={key.id} className="bg-gray-700/50 p-4 rounded-lg border border-gray-600">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                {/* Key Value */}
                <div className="md:col-span-5 font-mono text-sm">
                    <span className="text-gray-400">Key:</span>
                    <span className="text-white ml-2">
                        {`${key.value.substring(0, 4)}...${key.value.slice(-4)}`}
                    </span>
                </div>

                {/* Status */}
                <div className="md:col-span-2 flex items-center">
                   <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                       key.status === 'active' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
                   }`}>
                       {key.status === 'active' ? 'Hoạt động' : 'Đã hết lượt'}
                   </span>
                </div>
                
                {/* Usage Stats */}
                <div className="md:col-span-2 text-sm">
                    <span className="text-gray-400">Hôm nay:</span>
                    <span className="text-white ml-2 font-semibold">{key.usage.daily[todayStr] || 0}</span>
                </div>
                <div className="md:col-span-2 text-sm">
                    <span className="text-gray-400">Tổng:</span>
                    <span className="text-white ml-2 font-semibold">{key.usage.total}</span>
                </div>

                {/* Actions */}
                <div className="md:col-span-1 flex justify-end space-x-2">
                   {key.status === 'exhausted' && (
                     <button onClick={() => handleResetStatus(key.id)} className="text-sky-400 hover:text-sky-300 p-1" title="Kích hoạt lại">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 11.664 0l3.181-3.183m-3.181-4.991v4.99" />
                        </svg>
                     </button>
                   )}
                   <button onClick={() => handleDeleteKey(key.id)} className="text-gray-500 hover:text-red-400 p-1" title="Xóa Key">
                       <TrashIcon className="w-5 h-5" />
                   </button>
                </div>
              </div>
            </div>
          ))}
          {apiKeys.length === 0 && (
            <p className="text-center text-gray-500 py-8">Chưa có API key nào. Hãy thêm một key ở dưới.</p>
          )}
        </div>
        
        <div className="p-4 border-t border-gray-700">
          <div className="flex space-x-3">
            <input
              type="text"
              value={newKeyValue}
              onChange={(e) => setNewKeyValue(e.target.value)}
              placeholder="Dán API Key mới vào đây"
              className="flex-grow bg-gray-700 border border-gray-600 text-white rounded-md px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition font-mono"
            />
            <button
              onClick={handleAddKey}
              disabled={!newKeyValue.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-md flex items-center space-x-2 transition disabled:opacity-50"
            >
              <PlusIcon className="w-5 h-5" />
              <span>Thêm Key</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiKeyManagerModal;
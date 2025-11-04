import { Project, CustomStyle, ApiKey } from '../types';
import { encrypt, decrypt } from './encryptionService';

// --- LOCAL STORAGE HELPERS ---
const getFromLS = <T>(key: string, defaultValue: T): T => {
    try {
        const item = window.localStorage.getItem(key);
        return item ? JSON.parse(item) : defaultValue;
    } catch {
        return defaultValue;
    }
};
const saveToLS = <T>(key: string, value: T): void => {
    window.localStorage.setItem(key, JSON.stringify(value));
};

// --- IndexedDB for Video Storage ---
const DB_NAME = 'VideoStorage';
const STORE_NAME = 'videos';
let dbPromise: Promise<IDBDatabase> | null = null;

const openDB = (): Promise<IDBDatabase> => {
    if (dbPromise) {
        return dbPromise;
    }
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
    });
    return dbPromise;
};

export const saveVideo = async (id: string, file: File): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(file, id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
};

export const getVideoUrl = async (id: string): Promise<string | null> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);
        request.onsuccess = () => {
            if (request.result) {
                const url = URL.createObjectURL(request.result);
                resolve(url);
            } else {
                resolve(null);
            }
        };
        request.onerror = () => reject(request.error);
    });
};

export const deleteVideo = async (id: string): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
};


// --- DATA ABSTRACTION LAYER (PUBLIC API) ---

export const init = async (): Promise<{ projects: Project[], apiKeys: ApiKey[], customStyles: CustomStyle[] }> => {
    console.log("Initializing data from Local Storage.");
    const projects = getFromLS<Project[]>('srt-translator-projects', []);
    const encryptedApiKeys = getFromLS<ApiKey[]>('gemini-api-keys-v2', []);
    const apiKeys = encryptedApiKeys.map(key => ({ ...key, value: decrypt(key.value) }));
    const customStyles = getFromLS<CustomStyle[]>('srt-translator-custom-styles', []);
    return { projects, apiKeys, customStyles };
};

export const saveProject = (project: Project): void => {
    const projects = getFromLS<Project[]>('srt-translator-projects', []);
    const projectIndex = projects.findIndex(p => p.id === project.id);
    if (projectIndex > -1) {
        projects[projectIndex] = project;
    } else {
        projects.push(project);
    }
    saveToLS('srt-translator-projects', projects);
};

export const deleteProject = (projectId: string): void => {
    const projects = getFromLS<Project[]>('srt-translator-projects', []);
    const projectToDelete = projects.find(p => p.id === projectId);

    if (projectToDelete) {
        projectToDelete.files.forEach(file => {
            if (file.type === 'video' || file.type === 'audio') {
                deleteVideo(file.id).catch(err => console.error(`Failed to delete media ${file.id} from IDB`, err));
            }
        });
    }
    
    const projectsToKeep = projects.filter(p => p.id !== projectId);
    saveToLS('srt-translator-projects', projectsToKeep);
};

export const saveApiKeys = (keys: ApiKey[]): void => {
    const encryptedKeys = keys.map(key => ({ ...key, value: encrypt(key.value) }));
    saveToLS('gemini-api-keys-v2', encryptedKeys);
};

export const getApiKeys = async (): Promise<ApiKey[]> => {
    const encryptedKeys = getFromLS<ApiKey[]>('gemini-api-keys-v2', []);
    const decryptedKeys = encryptedKeys.map(key => ({ ...key, value: decrypt(key.value) }));
    return Promise.resolve(decryptedKeys);
};

export const saveCustomStyles = (styles: CustomStyle[]): void => {
    saveToLS('srt-translator-custom-styles', styles);
};

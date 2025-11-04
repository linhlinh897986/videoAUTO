import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { Project, SrtFile, SubtitleBlock, KeywordPair, Character, ApiKey, ContextItem } from '../types';
import { formatForGemini, parseFromGemini } from './srtParser';
import { getApiKeys, saveApiKeys } from './projectService';
import { geminiRateLimiter } from './rateLimiter';

// --- API Key Management (v2 with metadata) ---
// This section manages user-provided keys from the central projectService.

const getAndUseNextUserApiKey = async (): Promise<{ keyToUse: string, keyId: string }> => {
    const keys = await getApiKeys();
    const activeKeys = keys.filter(k => k.status === 'active');

    if (activeKeys.length === 0) {
        throw new Error("Không có API Key người dùng nào đang hoạt động. Vui lòng thêm key mới hoặc kiểm tra lại các key đã hết lượt.");
    }

    activeKeys.sort((a, b) => a.lastUsed - b.lastUsed);
    const keyToUpdate = activeKeys[0];

    const today = new Date().toISOString().split('T')[0];
    keyToUpdate.lastUsed = Date.now();
    keyToUpdate.usage.total = (keyToUpdate.usage.total || 0) + 1;
    keyToUpdate.usage.daily[today] = (keyToUpdate.usage.daily[today] || 0) + 1;
    
    const updatedKeys = keys.map(k => k.id === keyToUpdate.id ? keyToUpdate : k);
    await saveApiKeys(updatedKeys);

    console.log(`Sử dụng API Key người dùng ID: ${keyToUpdate.id}`);
    return { keyToUse: keyToUpdate.value, keyId: keyToUpdate.id };
};


const markKeyAsExhausted = async (keyId: string): Promise<void> => {
    const keys = await getApiKeys();
    const keyIndex = keys.findIndex(k => k.id === keyId);

    if (keyIndex !== -1) {
        keys[keyIndex].status = 'exhausted';
        await saveApiKeys(keys);
        console.warn(`API Key ID ${keyId} đã được đánh dấu là 'đã hết lượt'.`);
    }
};

async function getUserApiClient(): Promise<{ client: GoogleGenAI, keyId: string }> {
    const { keyToUse, keyId } = await getAndUseNextUserApiKey();
    return { client: new GoogleGenAI({ apiKey: keyToUse }), keyId };
}

interface GenerativeApiOptions {
  project: Project;
  maxRetriesPerKey?: number;
  initialDelay?: number;
}

// --- CORE HANDLER FOR GENERATIVE TASKS (Translation, Analysis) ---
// This function exclusively uses user-managed keys and handles retries, rotation, and exhaustion.
const performGenerativeApiCall = async <T>(
  apiCall: (ai: GoogleGenAI) => Promise<T>,
  options: GenerativeApiOptions
): Promise<T> => {
    const { maxRetriesPerKey = 2, initialDelay = 2000 } = options;
    let lastError: any = new Error("Tất cả các API Key của người dùng đều đã thử và thất bại.");

    const userKeys = await getApiKeys();
    const activeUserKeys = userKeys.filter(k => k.status === 'active');

    if (activeUserKeys.length === 0) {
        alert("Hoạt động này yêu cầu API key, nhưng không có key nào đang hoạt động. Vui lòng thêm key trong Cài đặt.");
        throw new Error("Không có API key nào đang hoạt động.");
    }

    console.log(`Bắt đầu tác vụ tạo sinh với ${activeUserKeys.length} API key của người dùng.`);

    for (let keyAttempt = 0; keyAttempt < activeUserKeys.length; keyAttempt++) {
        let currentKeyId: string | null = null;
        try {
            const { client: userApiClient, keyId } = await getUserApiClient();
            currentKeyId = keyId;
            console.log(`Đang thực hiện yêu cầu API với key người dùng ID: ${currentKeyId}.`);

            let transientAttempt = 0;
            let delay = initialDelay;
            while (true) {
                try {
                    return await apiCall(userApiClient); // SUCCESS
                } catch (error: any) {
                    lastError = error;
                    const errorString = String(error.message || error);

                    if (errorString.includes('429') || errorString.includes('RESOURCE_EXHAUSTED')) {
                        console.warn(`Key người dùng ID ${currentKeyId} đã hết hạn mức.`);
                        if (currentKeyId) {
                            await markKeyAsExhausted(currentKeyId);
                        }
                        break; // Move to the next key
                    }

                    transientAttempt++;
                    if (transientAttempt >= maxRetriesPerKey) {
                        console.error(`Lỗi API không thể phục hồi trên key ID ${currentKeyId} sau ${maxRetriesPerKey} lần thử.`);
                        break; // Move to the next key
                    }

                    const jitter = Math.random() * 1000;
                    const waitTime = delay + jitter;
                    console.warn(`Lỗi API tạm thời trên key ID ${currentKeyId} (lần thử ${transientAttempt}/${maxRetriesPerKey}). Thử lại sau ${(waitTime / 1000).toFixed(1)} giây...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    delay *= 2;
                }
            }
        } catch (error) {
            lastError = error;
            console.error(`Lỗi nghiêm trọng khi lấy API client người dùng:`, error);
        }
    }

    alert("Tất cả các API Key của người dùng đều không khả dụng hoặc đã gặp lỗi. Vui lòng kiểm tra lại key và hạn mức.");
    throw lastError;
};

// --- CORE HANDLER FOR TOKEN COUNTING ---
// This function exclusively uses the environment key and does not fall back to user keys.
export const countTokensInText = async (text: string, modelName: string, project: Project): Promise<number> => {
    const envApiKey = process.env.GEMINI_API_KEY;

    if (!envApiKey) {
        console.error("Không tìm thấy API key môi trường (GEMINI_API_KEY). Không thể đếm token.");
        throw new Error("API key môi trường (GEMINI_API_KEY) để đếm token không được cung cấp.");
    }

    console.log("Đếm token bằng API key từ môi trường (GEMINI_API_KEY).");
    const envApiClient = new GoogleGenAI({ apiKey: envApiKey });

    try {
        const response = await envApiClient.models.countTokens({
            model: modelName,
            contents: text,
        });
        return response.totalTokens;
    } catch (error: any) {
        console.error("Lỗi khi đếm token bằng key môi trường (GEMINI_API_KEY):", error);
        throw error;
    }
};


interface TranslationWorkItem {
    subtitles: SubtitleBlock[]; // with globally unique IDs if batched, original otherwise
    tokenCount: number;
    idMap: Map<number, { fileId: string, originalId: number }>;
    filesInvolved: { id: string, name: string }[];
}

interface TranslationCallbacks {
  onFileStart: (fileId: string) => void;
  onFileProgress: (fileId: string, progressSubtitles: SubtitleBlock[]) => void;
  onFileComplete: (fileId: string, finalSubtitles: SubtitleBlock[], status: 'success' | 'error') => void;
}

const constructUserPrompt = (
    formattedSubtitles: string,
    keywords: KeywordPair[],
    characterProfile?: Character[],
    locations?: ContextItem[],
    skills?: ContextItem[],
    realms?: ContextItem[]
): string => {
    let userPrompt = `Dịch các phụ đề sau đây sang tiếng Việt.

Hãy sử dụng hồ sơ nhân vật, thông tin bối cảnh và quy tắc thay thế dưới đây để đảm bảo bản dịch chính xác và nhất quán.
`;

    if (characterProfile && characterProfile.length > 0) {
        userPrompt += "\n--- Hồ sơ nhân vật ---\n";
        userPrompt += "Đây là thông tin về các nhân vật để giúp dịch xưng hô và mối quan hệ cho chính xác:\n";
        characterProfile.forEach(char => {
            const genderInfo = char.gender ? ` Giới tính: ${char.gender}.` : '';
            const ageInfo = char.age ? ` Tuổi: ${char.age}.` : '';
            userPrompt += `- ${char.chineseName}: Tên Việt: ${char.vietnameseName}. Vai trò: ${char.relationship}. Xưng hô: ${char.addressing}.${genderInfo}${ageInfo}\n`;
        });
    }

    const addContextSection = (title: string, items: ContextItem[] | undefined, subtitleText: string) => {
        if (!items || items.length === 0) return '';
        const relevantItems = items.filter(item => item.chineseName && subtitleText.includes(item.chineseName));
        if (relevantItems.length === 0) return '';

        let section = `\n\n--- ${title} ---\n`;
        section += `Sử dụng các thông tin sau để dịch cho nhất quán:\n`;
        relevantItems.forEach(item => {
            section += `- ${item.chineseName} (tên Việt: ${item.vietnameseName})\n`;
        });
        return section;
    };
    
    // Scan the subtitle chunk and add relevant context
    userPrompt += addContextSection('Bối cảnh Địa danh', locations, formattedSubtitles);
    userPrompt += addContextSection('Bối cảnh Kỹ năng/Công pháp', skills, formattedSubtitles);
    userPrompt += addContextSection('Bối cảnh Cảnh giới', realms, formattedSubtitles);

    if (keywords && keywords.length > 0) {
        userPrompt += "\n\n--- Quy tắc thay thế từ khóa/cụm từ ---\n";
        userPrompt += "Áp dụng các thay thế này một cách nghiêm ngặt:\n";
        keywords.forEach(kw => {
            userPrompt += `- Thay thế "${kw.find}" bằng "${kw.replace}".\n`;
        });
    }

    userPrompt += "\n\n--- Phụ đề cần dịch ---\n";
    userPrompt += formattedSubtitles;

    return userPrompt;
};

// Internal function to run the translation pipeline for a given set of work items.
const _executeTranslationPipeline = async (
    workItems: TranslationWorkItem[],
    filesInScope: SrtFile[],
    project: Project,
    callbacks: TranslationCallbacks,
    baseTokenCount: number
) => {
    const CONCURRENCY_PER_KEY = 4;
    const modelName = project.model || 'gemini-2.5-flash';
    const keywordHandling = project.keywordHandling || 'api';
    
    const activeApiKeys = (await getApiKeys()).filter(k => k.status === 'active');

    if (activeApiKeys.length === 0) {
        alert("Không có API Key nào đang hoạt động. Vui lòng thêm key trong Cài đặt để bắt đầu dịch.");
        workItems.forEach(wi => {
            for (const file of wi.filesInvolved) {
                const originalFile = filesInScope.find(f => f.id === file.id);
                if (originalFile) {
                    callbacks.onFileComplete(file.id, originalFile.originalSubtitles.map(s => ({...s, text: '[Lỗi: Không có API Key]'})), 'error');
                }
            }
        });
        return;
    }

    const maxTotalConcurrency = activeApiKeys.length * CONCURRENCY_PER_KEY;
    const totalConcurrencyLimit = Math.min(project.translationConcurrency || 5, maxTotalConcurrency);

    console.log(`Bắt đầu pipeline dịch với ${totalConcurrencyLimit} luồng trên ${activeApiKeys.length} key.`);

    const keyPool = activeApiKeys.map(key => ({
        id: key.id,
        value: key.value,
        inFlight: 0,
        isExhausted: false,
    }));

    const workItemsByFile = new Map<string, TranslationWorkItem[]>();
    for (const wi of workItems) {
        for (const file of wi.filesInvolved) {
            if (!workItemsByFile.has(file.id)) workItemsByFile.set(file.id, []);
            workItemsByFile.get(file.id)!.push(wi);
        }
    }

    const fileProgress = new Map<string, {
      originalSubtitles: SubtitleBlock[];
      translatedTexts: Map<number, string>;
      totalWorkItems: number;
      completedWorkItems: number;
      hasErrors: boolean;
    }>();

    for (const file of filesInScope) {
        const fileWorkItemsForThisFile = workItemsByFile.get(file.id) || [];
        if (fileWorkItemsForThisFile.length > 0) {
             fileProgress.set(file.id, {
                originalSubtitles: file.originalSubtitles,
                translatedTexts: new Map(file.translatedSubtitles.map(s => [s.id, s.text])),
                totalWorkItems: fileWorkItemsForThisFile.length,
                completedWorkItems: 0,
                hasErrors: false,
            });
        }
    }
    
    const workItemQueue = [...workItems];

    const worker = async () => {
        while (true) {
            const workItem = workItemQueue.shift();
            if (!workItem) return; // No more work

            const estimatedRequestTokens = workItem.tokenCount + baseTokenCount;
            await geminiRateLimiter.acquire(modelName, estimatedRequestTokens);

            let keyInUse: (typeof keyPool)[0] | null = null;
            
            // --- Key Acquisition Loop ---
            while (keyInUse === null) {
                keyPool.sort((a, b) => a.inFlight - b.inFlight); // Prioritize least busy key
                const availableKey = keyPool.find(k => !k.isExhausted && k.inFlight < CONCURRENCY_PER_KEY);

                if (availableKey) {
                    keyInUse = availableKey;
                    keyInUse.inFlight++;
                } else {
                    if (keyPool.every(k => k.isExhausted)) {
                        console.warn("Tất cả các API key đều đã hết lượt. Worker đang dừng lại.");
                        workItemQueue.unshift(workItem); // Put work back
                        return; // Stop this worker
                    }
                    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for a key to become available
                }
            }
            
            workItem.filesInvolved.forEach(f => callbacks.onFileStart(f.id));
            
            try {
                const tempClient = new GoogleGenAI({ apiKey: keyInUse.value });
                const subtitlesText = workItem.subtitles.map(s => s.text).join('\n');
                const relevantCharacters = (project.characterProfile || []).filter(char => 
                    char.chineseName && subtitlesText.includes(char.chineseName)
                );

                const formattedChunk = formatForGemini(workItem.subtitles);
                const keywordsForApi = keywordHandling === 'api' ? project.keywords : [];
                
                const userPrompt = constructUserPrompt(
                    formattedChunk, 
                    keywordsForApi, 
                    relevantCharacters,
                    project.locations,
                    project.skills,
                    project.realms
                );
                
                const modelConfig: any = {
                    systemInstruction: project.stylePrompt,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                id: { type: Type.NUMBER, description: "Số thứ tự gốc của phụ đề." },
                                translation: { type: Type.STRING, description: "Nội dung phụ đề đã được dịch." }
                            },
                            required: ["id", "translation"]
                        }
                    }
                };

                if (project.thinkingEnabled === false) {
                    modelConfig.thinkingConfig = { thinkingBudget: 0 };
                }

                const response = await tempClient.models.generateContent({
                    model: modelName,
                    contents: userPrompt,
                    config: modelConfig
                });
                
                const fullResponseText = response.text;
                let parsedTranslations = parseFromGemini(fullResponseText);
                if (keywordHandling === 'post-process' && project.keywords.length > 0) {
                     parsedTranslations.forEach((translatedText, subId) => {
                        let processedText = translatedText;
                        project.keywords.forEach(kw => {
                            if (kw.find) {
                                processedText = processedText.split(kw.find).join(kw.replace);
                            }
                        });
                        parsedTranslations.set(subId, processedText);
                    });
                }
                
                const translationsByFile = new Map<string, Map<number, string>>();
                parsedTranslations.forEach((text, globalId) => {
                    const mapping = workItem.idMap.get(globalId);
                    if (mapping) {
                        const { fileId, originalId } = mapping;
                        if (!translationsByFile.has(fileId)) translationsByFile.set(fileId, new Map());
                        translationsByFile.get(fileId)!.set(originalId, text);
                    }
                });

                for (const { id: fileId } of workItem.filesInvolved) {
                    const currentFileProgress = fileProgress.get(fileId);
                    if (!currentFileProgress) continue;

                    const fileTranslations = translationsByFile.get(fileId) || new Map();
                    fileTranslations.forEach((val, key) => currentFileProgress.translatedTexts.set(key, val));

                    const progressSubtitles = currentFileProgress.originalSubtitles.map(sub => ({
                        ...sub,
                        text: currentFileProgress.translatedTexts.get(sub.id) || ""
                    }));
                    callbacks.onFileProgress(fileId, progressSubtitles);
                    
                    currentFileProgress.completedWorkItems++;
                    
                    if (currentFileProgress.completedWorkItems >= currentFileProgress.totalWorkItems) {
                        let hasPersistentErrors = false;
                        const finalSubtitles = currentFileProgress.originalSubtitles.map(sub => {
                            const translatedText = currentFileProgress.translatedTexts.get(sub.id);
                            const textIsEmpty = !translatedText || translatedText.trim() === '';
                            const hasChinese = /[\u4e00-\u9fa5]/.test(translatedText || '');
                            
                            if(textIsEmpty || hasChinese) {
                               hasPersistentErrors = true;
                               const errorMsg = textIsEmpty ? `[Bản dịch bị thiếu]` : `[DỊCH LẠI THẤT BẠI - Vẫn còn tiếng Trung]`;
                               return {...sub, text: errorMsg };
                            }
                            
                            return {
                                ...sub,
                                text: translatedText || `[Thiếu bản dịch cho ID ${sub.id}]`,
                            };
                        });

                        callbacks.onFileComplete(fileId, finalSubtitles, (currentFileProgress.hasErrors || hasPersistentErrors) ? 'error' : 'success');
                    }
                }

            } catch (error: any) {
                console.error(`Lỗi khi dịch lô công việc với key ${keyInUse.id}:`, error);
                const errorString = String(error.message || error);

                if (errorString.includes('429') || errorString.includes('RESOURCE_EXHAUSTED')) {
                    console.warn(`Key ${keyInUse.id} đã hết hạn mức. Sẽ thử lại với key khác.`);
                    keyInUse.isExhausted = true;
                    await markKeyAsExhausted(keyInUse.id);
                    workItemQueue.unshift(workItem); // Re-queue the task
                } else {
                    for (const { id: fileId } of workItem.filesInvolved) {
                        const currentFileProgress = fileProgress.get(fileId);
                        if (!currentFileProgress) continue;
                        
                        currentFileProgress.hasErrors = true;
                        currentFileProgress.completedWorkItems++;

                        // Add error messages for subtitles that were part of this failed work item
                        workItem.idMap.forEach((mapping, globalId) => {
                            if (mapping.fileId === fileId && !currentFileProgress.translatedTexts.has(mapping.originalId)) {
                                currentFileProgress.translatedTexts.set(mapping.originalId, `[Lỗi dịch ID ${mapping.originalId}]`);
                            }
                        });

                        if (currentFileProgress.completedWorkItems >= currentFileProgress.totalWorkItems) {
                            const finalSubtitles = currentFileProgress.originalSubtitles.map(sub => ({
                                ...sub,
                                text: currentFileProgress.translatedTexts.get(sub.id) || `[Thiếu bản dịch cho ID ${sub.id}]`,
                            }));
                            callbacks.onFileComplete(fileId, finalSubtitles, 'error');
                        }
                    }
                }
            } finally {
                if (keyInUse) {
                    keyInUse.inFlight--;
                }
            }
        }
    };
    
    const workerPromises = Array.from({ length: Math.min(totalConcurrencyLimit, workItems.length) }, () => worker());
    await Promise.all(workerPromises);

    if (workItemQueue.length > 0) {
        console.warn(`${workItemQueue.length} tác vụ không thể hoàn thành vì tất cả các key đều đã hết hạn mức.`);
        alert("Dịch thuật đã dừng lại vì tất cả các API Key đều đã hết lượt. Vui lòng kiểm tra lại key trong Cài đặt.");
        const remainingFileIds = new Set<string>();
        workItemQueue.forEach(wi => wi.filesInvolved.forEach(f => remainingFileIds.add(f.id)));
        
        for (const fileId of remainingFileIds) {
             const progress = fileProgress.get(fileId);
             if (progress && progress.completedWorkItems < progress.totalWorkItems) {
                 const finalSubtitles = progress.originalSubtitles.map(sub => ({
                    ...sub,
                    text: progress.translatedTexts.get(sub.id) || `[Dịch bị hủy do hết API Key]`,
                }));
                callbacks.onFileComplete(fileId, finalSubtitles, 'error');
             }
        }
    }
};


const _identifyFailedOriginalSubtitles = (file: SrtFile): SubtitleBlock[] => {
    const failedOriginalSubs: SubtitleBlock[] = [];
    const translatedMap = new Map(file.translatedSubtitles.map(sub => [sub.id, sub.text]));
    const chineseCharRegex = /[\u4e00-\u9fa5]/;

    for (const originalSub of file.originalSubtitles) {
        const translatedText = translatedMap.get(originalSub.id);
        if (!translatedText || translatedText.trim() === '' || chineseCharRegex.test(translatedText) || translatedText.startsWith('[')) {
            failedOriginalSubs.push(originalSub);
        }
    }
    return failedOriginalSubs;
};

export const batchTranslateFiles = async (
    files: SrtFile[],
    project: Project,
    callbacks: TranslationCallbacks,
): Promise<void> => {
    const MAX_TOKENS_PER_REQUEST = project.maxTokensPerRequest || 50000;
    const modelName = project.model || 'gemini-2.5-flash';
    const keywordHandling = project.keywordHandling || 'api';

    const keywordsForSizing = keywordHandling === 'api' ? project.keywords : [];
    const baseUserPromptForSizing = constructUserPrompt(
        "", 
        keywordsForSizing, 
        project.characterProfile,
        project.locations,
        project.skills,
        project.realms
    );
    
    let baseTokenCount: number;
    try {
        baseTokenCount = await countTokensInText(project.stylePrompt + baseUserPromptForSizing, modelName, project);
    } catch (error) {
        console.error("Không thể tính token cho prompt, không thể tiếp tục dịch hàng loạt.", error);
        files.forEach(file => {
             callbacks.onFileComplete(file.id, file.originalSubtitles.map(sub => ({ ...sub, text: `[Lỗi: Không thể bắt đầu dịch]` })), 'error');
        });
        return;
    }

    const availableTokensForSubtitles = MAX_TOKENS_PER_REQUEST - baseTokenCount;
    const workItems: TranslationWorkItem[] = [];
    const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    interface FileJob {
        file: SrtFile;
        subtitlesToProcess: SubtitleBlock[];
        estimatedTokens: number;
    }

    const jobs: FileJob[] = [];
    for (const file of sortedFiles) {
        if (typeof file.tokenCount !== 'number') {
            console.warn(`Không thể dịch tệp ${file.name} vì số token chưa được tính.`);
            callbacks.onFileComplete(file.id, file.originalSubtitles.map(sub => ({ ...sub, text: `[Lỗi: Không thể tính số token]` })), 'error');
            continue;
        }

        const subtitlesToProcess = file.translationStatus === 'error'
            ? _identifyFailedOriginalSubtitles(file)
            : file.originalSubtitles;
        
        if (subtitlesToProcess.length === 0) {
            console.log(`Không có phụ đề nào cần dịch cho tệp ${file.name}, bỏ qua.`);
            if (file.translationStatus === 'error') {
                callbacks.onFileComplete(file.id, file.translatedSubtitles, 'success');
            }
            continue;
        }

        const avgTokensPerSub = (file.tokenCount > 0 && file.originalSubtitles.length > 0)
            ? file.tokenCount / file.originalSubtitles.length
            : 15;
        
        const estimatedTokens = Math.round(subtitlesToProcess.length * avgTokensPerSub);
        jobs.push({ file, subtitlesToProcess, estimatedTokens });
    }

    const largeFileJobs = jobs.filter(j => j.estimatedTokens > availableTokensForSubtitles);
    const smallFileJobs = jobs.filter(j => j.estimatedTokens <= availableTokensForSubtitles);

    for (const { file, subtitlesToProcess, estimatedTokens } of largeFileJobs) {
        const avgTokensPerSub = estimatedTokens > 0 && subtitlesToProcess.length > 0 ? estimatedTokens / subtitlesToProcess.length : 15;
        const subsPerChunk = Math.max(1, Math.floor(availableTokensForSubtitles / avgTokensPerSub));

        for (let i = 0; i < subtitlesToProcess.length; i += subsPerChunk) {
            const chunk = subtitlesToProcess.slice(i, i + subsPerChunk);
            const estimatedChunkTokens = Math.round(chunk.length * avgTokensPerSub);
            workItems.push({
                subtitles: chunk,
                tokenCount: estimatedChunkTokens,
                idMap: new Map(chunk.map(s => [s.id, { fileId: file.id, originalId: s.id }])),
                filesInvolved: [{ id: file.id, name: file.name }],
            });
        }
    }

    let currentBatchSubs: SubtitleBlock[] = [];
    let currentBatchTokenCount = 0;
    let currentBatchIdMap = new Map<number, { fileId: string, originalId: number }>();
    let currentBatchFiles: { id: string, name: string }[] = [];
    let globalId = 1;

    const finalizeBatch = () => {
        if (currentBatchSubs.length > 0) {
            workItems.push({
                subtitles: currentBatchSubs,
                tokenCount: currentBatchTokenCount,
                idMap: currentBatchIdMap,
                filesInvolved: currentBatchFiles,
            });
            currentBatchSubs = [];
            currentBatchTokenCount = 0;
            currentBatchIdMap = new Map();
            currentBatchFiles = [];
        }
    };

    for (const { file, subtitlesToProcess, estimatedTokens } of smallFileJobs) {
        if (estimatedTokens === 0) continue;
        if (currentBatchTokenCount + estimatedTokens > availableTokensForSubtitles && currentBatchSubs.length > 0) {
            finalizeBatch();
        }

        currentBatchFiles.push({ id: file.id, name: file.name });
        currentBatchTokenCount += estimatedTokens;
        for (const sub of subtitlesToProcess) {
            currentBatchIdMap.set(globalId, { fileId: file.id, originalId: sub.id });
            currentBatchSubs.push({ ...sub, id: globalId });
            globalId++;
        }
    }
    finalizeBatch();

    if (workItems.length > 0) {
        await _executeTranslationPipeline(workItems, files, project, callbacks, baseTokenCount);
    }
};

export const analyzeCharacters = async (
    allFilesContent: string,
    existingCharacters: Character[],
    project: Project
): Promise<Character[]> => {
    const existingCharacterNames = existingCharacters.map(c => c.chineseName).join(', ');

    const prompt = `Dựa vào đoạn hội thoại kịch bản sau đây, hãy xác định các nhân vật chính. Với mỗi nhân vật, hãy cung cấp một hồ sơ bao gồm: tên tiếng Trung, tên tiếng Việt gợi ý, giới tính (Nam/Nữ), khoảng tuổi ước tính (ví dụ: "20-25", "40-50"), mối quan hệ/vai trò của họ (bằng tiếng Việt), và cách xưng hô đề xuất (bằng tiếng Việt).

    Phân tích lời thoại, cách xưng hô và bối cảnh để suy đoán giới tính và độ tuổi của nhân vật.
    
    Quan trọng: Tất cả các trường văn bản như "gender", "relationship", và "addressing" PHẢI được viết bằng tiếng Việt. Trường "age" phải là một khoảng số dạng chuỗi (ví dụ: "20-25").
    
    ${existingCharacters.length > 0 ? `Các nhân vật sau đã có hồ sơ, không cần tạo lại: ${existingCharacterNames}. Chỉ xác định các nhân vật mới.` : ''}

    Trả về kết quả dưới dạng một mảng JSON, trong đó mỗi đối tượng đại diện cho một nhân vật và có các thuộc tính sau: "chineseName", "vietnameseName", "gender", "age", "relationship", "addressing".

    --- HỘI THOẠI KỊCH BẢN ---
    ${allFilesContent}
    `;

    try {
        const response: GenerateContentResponse = await performGenerativeApiCall((ai) =>
            ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                chineseName: {
                                    type: Type.STRING,
                                    description: 'Tên gốc tiếng Trung của nhân vật trong kịch bản.',
                                },
                                vietnameseName: {
                                    type: Type.STRING,
                                    description: 'Gợi ý một tên tiếng Việt phù hợp văn hóa.',
                                },
                                gender: {
                                    type: Type.STRING,
                                    description: 'Giới tính của nhân vật (ví dụ: "Nam", "Nữ"), viết bằng tiếng Việt.',
                                },
                                age: {
                                    type: Type.STRING,
                                    description: 'Khoảng tuổi ước tính của nhân vật, trả về dưới dạng một chuỗi số (ví dụ: "25-30", "50-60").',
                                },
                                relationship: {
                                    type: Type.STRING,
                                    description: 'Mối quan hệ hoặc vai trò chính của nhân vật, viết bằng tiếng Việt (ví dụ: Nhân vật chính, sư phụ của nhân vật X).',
                                },
                                addressing: {
                                    type: Type.STRING,
                                    description: 'Cách xưng hô tiêu biểu của nhân vật này hoặc cách người khác gọi nhân vật này, viết bằng tiếng Việt (ví dụ: "Lão sư", "Ca ca", "Bệ hạ").',
                                },
                            },
                            required: ["chineseName", "vietnameseName", "gender", "age", "relationship", "addressing"],
                        },
                    },
                },
            }),
            { project }
        );
        
        const jsonStr = response.text?.trim();
        console.log("Phản hồi từ Gemini (Phân tích nhân vật):", jsonStr);
        if (!jsonStr) {
            return [];
        }
        
        const newCharacters = JSON.parse(jsonStr);

        return newCharacters.map((char: Omit<Character, 'id'>) => ({
            ...char,
            id: `${Date.now()}-${char.chineseName}`,
        }));

    } catch (error) {
        console.error("Error analyzing characters with Gemini API after retries:", error);
        throw new Error("Không thể phân tích nhân vật từ hội thoại.");
    }
};

export interface AnalysisResult {
    locations?: Omit<ContextItem, 'id'>[];
    skills?: Omit<ContextItem, 'id'>[];
    realms?: Omit<ContextItem, 'id'>[];
}

export const analyzeContext = async (
    allFilesContent: string,
    analysisTypes: { locations: boolean; skills: boolean; realms: boolean; },
    existingContext: { locations: ContextItem[]; skills: ContextItem[]; realms: ContextItem[] },
    project: Project
): Promise<AnalysisResult> => {

    const anyTypeSelected = Object.values(analysisTypes).some(v => v);
    if (!anyTypeSelected) {
        console.warn("Không có loại bối cảnh nào được chọn để phân tích.");
        return {};
    }

    let prompt = `Dựa vào đoạn hội thoại kịch bản sau đây, hãy xác định và phân tích các yếu tố bối cảnh được yêu cầu. Với mỗi mục, hãy cung cấp tên tiếng Trung, tên tiếng Việt và một mô tả ngắn gọn bằng tiếng Việt.`;
    
    const responseProperties: { [key: string]: any } = {};
    const requiredProperties: string[] = [];

    const itemSchema = {
        type: Type.OBJECT,
        properties: {
            chineseName: { type: Type.STRING, description: "Tên gốc tiếng Trung của mục." },
            vietnameseName: { type: Type.STRING, description: "Tên tiếng Việt tương ứng của mục." },
            description: { type: Type.STRING, description: "Mô tả ngắn gọn về mục bằng tiếng Việt." }
        },
        required: ["chineseName", "vietnameseName", "description"]
    };

    if (analysisTypes.locations) {
        const existingNames = existingContext.locations.map(i => i.chineseName).join(', ') || 'Không có';
        prompt += `\n- **Địa danh:** Liệt kê các địa điểm, vùng đất, thành phố, hoặc tông môn được nhắc đến. Bỏ qua các địa danh đã tồn tại sau: ${existingNames}.`;
        responseProperties.locations = {
            type: Type.ARRAY,
            description: "Danh sách các địa danh mới được tìm thấy.",
            items: itemSchema
        };
        requiredProperties.push('locations');
    }

    if (analysisTypes.skills) {
        const existingNames = existingContext.skills.map(i => i.chineseName).join(', ') || 'Không có';
        prompt += `\n- **Kỹ năng:** Liệt kê các chiêu thức, kỹ năng, công pháp, hoặc phép thuật được sử dụng. Bỏ qua các kỹ năng đã tồn tại sau: ${existingNames}.`;
        responseProperties.skills = {
            type: Type.ARRAY,
            description: "Danh sách các kỹ năng mới được tìm thấy.",
            items: itemSchema
        };
        requiredProperties.push('skills');
    }

    if (analysisTypes.realms) {
        const existingNames = existingContext.realms.map(i => i.chineseName).join(', ') || 'Không có';
        prompt += `\n- **Cảnh giới:** Liệt kê các cấp độ tu luyện hoặc cảnh giới sức mạnh được đề cập. Bỏ qua các cảnh giới đã tồn tại sau: ${existingNames}.`;
        responseProperties.realms = {
            type: Type.ARRAY,
            description: "Danh sách các cảnh giới mới được tìm thấy.",
            items: itemSchema
        };
        requiredProperties.push('realms');
    }

    prompt += `\n\nTrả về kết quả dưới dạng một đối tượng JSON duy nhất. Đối tượng này CHỈ được chứa các khóa tương ứng với các mục bạn được yêu cầu phân tích (${requiredProperties.join(', ')}). Nếu không tìm thấy mục nào cho một danh mục, hãy trả về một mảng rỗng cho khóa đó.`;
    prompt += `\n\n--- HỘI THOẠI KỊCH BẢN ---\n${allFilesContent}`;

    const responseSchema = {
        type: Type.OBJECT,
        properties: responseProperties,
        required: requiredProperties
    };

    try {
        const response: GenerateContentResponse = await performGenerativeApiCall((ai) =>
            ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: responseSchema,
                },
            }),
            { project }
        );

        const jsonStr = response.text?.trim();
        console.log("Phản hồi từ Gemini (Phân tích bối cảnh):", jsonStr);
        if (!jsonStr) {
            return {};
        }

        return JSON.parse(jsonStr);

    } catch (error) {
        console.error("Lỗi khi phân tích bối cảnh với Gemini API sau khi thử lại:", error);
        throw new Error("Không thể phân tích bối cảnh từ hội thoại.");
    }
};

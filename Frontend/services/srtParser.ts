import { SubtitleBlock } from '../types';

export const parseSrt = (srtContent: string): SubtitleBlock[] => {
    // Normalize line endings to LF (\n) to handle files from different OS (Windows: \r\n, Unix: \n)
    // and then split into blocks. A block is separated by one or more empty lines.
    const blocks = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split(/\n\n+/);

    return blocks.map((block): SubtitleBlock | null => {
        const lines = block.split(/\n/);
        
        // A valid block needs at least an ID line and a timecode line. The text is optional.
        if (lines.length < 2) return null;

        const id = parseInt(lines[0], 10);
        if (isNaN(id)) return null;

        // Make timecode parsing more robust to extra spaces.
        const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
        if (!timeMatch) return null;

        const [, startTime, endTime] = timeMatch;
        const textLines = lines.slice(2);
        
        const text = textLines.join(' ');

        return { id, startTime, endTime, text };
    }).filter((b): b is SubtitleBlock => b !== null);
};

export const formatForGemini = (subtitles: SubtitleBlock[]): string => {
    return subtitles.map(sub => `[${sub.id}] ${sub.text}`).join('\n');
};

const parseFromGeminiLegacy = (geminiResponse: string): Map<number, string> => {
    const translationMap = new Map<number, string>();
    // This regex robustly handles multiple entries on the same line and multi-line content for a single entry.
    // It finds all occurrences of `[number] text` until the next `[number]` or the end of the string.
    const matches = geminiResponse.matchAll(/\[(\d+)\]\s*(.*?)(?=\s*\[\d+\]|$)/gs);

    for (const match of matches) {
        const id = parseInt(match[1], 10);
        const text = match[2].trim();
        if (!isNaN(id) && text) {
            translationMap.set(id, text);
        }
    }
    return translationMap;
};

export const parseFromGemini = (geminiResponse: string): Map<number, string> => {
    const translationMap = new Map<number, string>();
    try {
        // Attempt to clean up and parse as JSON first.
        const cleanedJson = geminiResponse
            .replace(/^```json\s*/, '')
            .replace(/```$/, '')
            .trim();

        // The model might stream an incomplete JSON string if it's cut off.
        // A simple check to see if it looks like a valid array.
        if (!cleanedJson.startsWith('[') || !cleanedJson.endsWith(']')) {
             throw new Error("Phản hồi không phải là một mảng JSON hoàn chỉnh.");
        }
        
        const translations: { id: number; translation: string }[] = JSON.parse(cleanedJson);

        if (Array.isArray(translations)) {
            for (const item of translations) {
                if (typeof item.id === 'number' && typeof item.translation === 'string') {
                    translationMap.set(item.id, item.translation);
                }
            }
            if (translationMap.size > 0) {
                console.log("Phân tích phản hồi JSON thành công.");
                return translationMap;
            }
        }
    } catch (error) {
        console.warn("Không thể phân tích phản hồi dưới dạng JSON. Thử lại với phương pháp cũ (legacy).", { error: error, response: geminiResponse });
        // Fallback to legacy parsing if JSON fails
        return parseFromGeminiLegacy(geminiResponse);
    }
    // If JSON parsing resulted in an empty array but the original string was not empty, fall back.
    if (geminiResponse.trim().length > 0) {
        console.warn("Phản hồi JSON hợp lệ nhưng trống. Thử lại với phương pháp cũ (legacy).");
        return parseFromGeminiLegacy(geminiResponse);
    }

    return translationMap;
};


export const composeSrt = (subtitles: SubtitleBlock[]): string => {
    return subtitles.map(sub => {
        return `${sub.id}\n${sub.startTime} --> ${sub.endTime}\n${sub.text}`;
    }).join('\n\n');
};

export const srtTimeToSeconds = (time: string): number => {
    const parts = time.split(/[:,]/);
    if (parts.length !== 4) return 0;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const s = parseInt(parts[2], 10);
    const ms = parseInt(parts[3], 10);
    if (isNaN(h) || isNaN(m) || isNaN(s) || isNaN(ms)) return 0;
    return h * 3600 + m * 60 + s + ms / 1000;
};

export const secondsToSrtTime = (timeInSeconds: number): string => {
  if (isNaN(timeInSeconds) || timeInSeconds < 0) return '00:00:00,000';
  const hours = Math.floor(timeInSeconds / 3600);
  const minutes = Math.floor((timeInSeconds % 3600) / 60);
  const seconds = Math.floor(timeInSeconds % 60);
  const milliseconds = Math.floor((timeInSeconds % 1) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
};

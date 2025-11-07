/**
 * Service for fetching available fonts from the backend server
 * This ensures only fonts that are available on the rendering server are shown
 */

// Default fallback fonts in case backend is unavailable
const DEFAULT_FONTS = [
    'Arial',
    'Courier New',
    'DejaVu Sans',
    'DejaVu Serif',
    'Georgia',
    'Helvetica',
    'Impact',
    'Liberation Sans',
    'Liberation Serif',
    'Times New Roman',
    'Trebuchet MS',
    'Verdana',
];

// Get API base URL from environment
const rawBase = import.meta.env.VITE_API_BASE_URL ?? '';
const API_BASE_URL = rawBase ? rawBase.replace(/\/$/, '') : '';

/**
 * Fetch available fonts from the backend server
 * These are the fonts that will be used for actual video rendering
 */
export async function getAvailableFonts(): Promise<string[]> {
    try {
        const response = await fetch(`${API_BASE_URL}/fonts`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch fonts: ${response.status}`);
        }

        const fonts = await response.json();
        
        if (Array.isArray(fonts) && fonts.length > 0) {
            return fonts;
        }
        
        // Fallback if response is invalid
        return DEFAULT_FONTS;
    } catch (error) {
        console.warn('Failed to fetch fonts from backend, using fallback list:', error);
        return DEFAULT_FONTS;
    }
}

/**
 * Get cached fonts or fetch them if not cached
 */
let cachedFonts: string[] | null = null;

export async function getCachedAvailableFonts(): Promise<string[]> {
    if (cachedFonts === null) {
        cachedFonts = await getAvailableFonts();
    }
    return cachedFonts;
}

/**
 * Clear the font cache (useful for testing or when fonts are installed)
 */
export function clearFontCache(): void {
    cachedFonts = null;
}

export { DEFAULT_FONTS };

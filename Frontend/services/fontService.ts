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
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch fonts: ${response.status}`);
        }

        const fonts = await response.json();
        
        if (Array.isArray(fonts) && fonts.length > 0) {
            // Prioritize Arial as the default font by putting it first
            return prioritizeDefaultFont(fonts, 'Arial');
        }
        
        // Fallback if response is invalid
        return DEFAULT_FONTS;
    } catch (error) {
        console.warn('Failed to fetch fonts from backend, using fallback list:', error);
        return DEFAULT_FONTS;
    }
}

/**
 * Prioritize a specific font to be first in the list
 * @param fonts - List of font names
 * @param preferredFont - Font to prioritize (e.g., 'Arial')
 * @returns Sorted font list with preferred font first if available
 */
function prioritizeDefaultFont(fonts: string[], preferredFont: string): string[] {
    const hasPreferredFont = fonts.some(f => f === preferredFont);
    
    if (hasPreferredFont) {
        // Remove preferred font from list and add it to the beginning
        const otherFonts = fonts.filter(f => f !== preferredFont).sort();
        return [preferredFont, ...otherFonts];
    }
    
    // If preferred font not available, just return sorted list
    return fonts.sort();
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

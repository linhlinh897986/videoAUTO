/**
 * Service for detecting and managing system fonts
 */

// Default fallback fonts that should always be available
const DEFAULT_FONTS = [
    'Arial',
    'Helvetica',
    'Verdana',
    'Tahoma',
    'Trebuchet MS',
    'Times New Roman',
    'Georgia',
    'Courier New',
    'Impact',
    'Comic Sans MS',
    'Lucida Console',
    'Lucida Sans Unicode',
    'Palatino Linotype',
    'Book Antiqua',
    'MS Sans Serif',
    'MS Serif',
];

// Common fonts to check for
const COMMON_FONTS = [
    'Arial',
    'Arial Black',
    'Arial Narrow',
    'Arial Rounded MT Bold',
    'Calibri',
    'Cambria',
    'Candara',
    'Century Gothic',
    'Comic Sans MS',
    'Consolas',
    'Constantia',
    'Corbel',
    'Courier',
    'Courier New',
    'Franklin Gothic Medium',
    'Garamond',
    'Georgia',
    'Helvetica',
    'Helvetica Neue',
    'Impact',
    'Lucida Console',
    'Lucida Sans Unicode',
    'Microsoft Sans Serif',
    'Monaco',
    'Palatino',
    'Palatino Linotype',
    'Segoe UI',
    'Tahoma',
    'Times',
    'Times New Roman',
    'Trebuchet MS',
    'Verdana',
];

/**
 * Check if a font is available in the browser
 */
function isFontAvailable(fontName: string): boolean {
    // Create a canvas to test font rendering
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return false;

    // Set a baseline font
    const testString = 'mmmmmmmmmmlli';
    const fontSize = 72;
    const baselineFont = 'monospace';

    // Measure the test string with baseline font
    context.font = `${fontSize}px ${baselineFont}`;
    const baselineWidth = context.measureText(testString).width;

    // Measure with the font we're testing
    context.font = `${fontSize}px "${fontName}", ${baselineFont}`;
    const testWidth = context.measureText(testString).width;

    // If widths differ, the font is likely available
    return testWidth !== baselineWidth;
}

/**
 * Get all available system fonts
 */
export async function getAvailableFonts(): Promise<string[]> {
    // Try to use the modern Font Access API if available
    if ('queryLocalFonts' in window) {
        try {
            const permission = await (navigator as any).permissions.query({ name: 'local-fonts' });
            if (permission.state === 'granted' || permission.state === 'prompt') {
                const fonts = await (window as any).queryLocalFonts();
                const fontNames = Array.from(
                    new Set(fonts.map((font: any) => font.family))
                ).sort() as string[];
                return fontNames;
            }
        } catch (error) {
            console.warn('Font Access API not available or permission denied:', error);
        }
    }

    // Fallback: Check common fonts
    const availableFonts = COMMON_FONTS.filter(isFontAvailable);
    
    // Always include default fonts
    const uniqueFonts = Array.from(new Set([...availableFonts, ...DEFAULT_FONTS])).sort();
    
    return uniqueFonts;
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

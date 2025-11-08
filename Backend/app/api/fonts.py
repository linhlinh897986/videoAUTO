from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import List

from fastapi import APIRouter


router = APIRouter()


def get_fonts_from_directory_scan() -> List[str]:
    """
    Fallback method to get fonts by scanning common font directories.
    Used when fc-list is not available (e.g., Google Colab, minimal Docker containers).
    """
    import sys
    font_dirs = [
        "/usr/share/fonts",
        "/usr/local/share/fonts",
        "~/.fonts",
        "~/.local/share/fonts",
    ]
    
    font_families = set()
    
    for font_dir in font_dirs:
        expanded_dir = Path(font_dir).expanduser()
        if expanded_dir.exists():
            print(f"[fonts.py] Scanning directory: {expanded_dir}", file=sys.stderr)
            # Find all font files
            for ext in ['*.ttf', '*.otf', '*.TTF', '*.OTF']:
                for font_file in expanded_dir.rglob(ext):
                    # Extract font name from filename
                    font_name = font_file.stem
                    # Clean up common suffixes
                    for suffix in ['-Regular', '-Bold', '-Italic', '-BoldItalic', 
                                   'Regular', 'Bold', 'Italic', 'BoldItalic']:
                        if font_name.endswith(suffix):
                            font_name = font_name[:-len(suffix)]
                    font_families.add(font_name.strip())
    
    return sorted(font_families)


@router.get("/fonts")
def get_available_fonts() -> List[str]:
    """
    Get list of fonts available on the server for subtitle rendering.
    
    Method 1 (preferred): Uses fontconfig's fc-list command
    Method 2 (fallback): Scans common font directories
    Method 3 (last resort): Returns hardcoded default list
    
    This works on Linux, Windows, macOS, Docker containers, and Google Colab.
    Arial is prioritized as the default font if available.
    """
    import sys
    
    # Method 1: Try fc-list (fontconfig)
    try:
        # Determine fc-list command based on OS
        fc_list_cmd = "fc-list"
        
        # Try to find fc-list in PATH
        import shutil
        fc_list_path = shutil.which("fc-list")
        if not fc_list_path:
            # fc-list not found in PATH, try common locations
            if os.name == 'nt':  # Windows
                possible_paths = [
                    r"C:\Program Files\fontconfig\bin\fc-list.exe",
                    r"C:\msys64\usr\bin\fc-list.exe",
                    r"C:\cygwin64\bin\fc-list.exe",
                ]
                for path in possible_paths:
                    if os.path.exists(path):
                        fc_list_cmd = path
                        break
        else:
            fc_list_cmd = fc_list_path
        
        print(f"[fonts.py] Method 1: Using fc-list command: {fc_list_cmd}", file=sys.stderr)
        
        # Run fc-list to get all available fonts
        result = subprocess.run(
            [fc_list_cmd, ":", "family"],
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
            shell=(os.name == 'nt')  # Use shell on Windows
        )
        
        print(f"[fonts.py] fc-list returned {len(result.stdout)} characters", file=sys.stderr)
        
        # Parse the output to extract unique font family names
        # fc-list can return multiple family names per line separated by commas
        font_families = set()
        for line in result.stdout.strip().split('\n'):
            if line:
                # Split by comma to get all font family variants
                variants = [v.strip() for v in line.split(',')]
                for variant in variants:
                    if variant:
                        font_families.add(variant)
        
        fonts = sorted(font_families)
        print(f"[fonts.py] Method 1 success: Found {len(fonts)} unique fonts", file=sys.stderr)
        
        # Prioritize Arial if available
        if 'Arial' in fonts:
            fonts.remove('Arial')
            fonts.insert(0, 'Arial')
        
        return fonts
    
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as e:
        print(f"[fonts.py] Method 1 failed: {type(e).__name__}: {e}", file=sys.stderr)
    
    # Method 2: Scan font directories (for Google Colab, minimal containers)
    try:
        print(f"[fonts.py] Method 2: Scanning font directories...", file=sys.stderr)
        fonts = get_fonts_from_directory_scan()
        
        if fonts and len(fonts) > 5:  # Only use if we found a reasonable number of fonts
            print(f"[fonts.py] Method 2 success: Found {len(fonts)} fonts from directory scan", file=sys.stderr)
            
            # Prioritize Arial if available
            if 'Arial' in fonts:
                fonts.remove('Arial')
                fonts.insert(0, 'Arial')
            
            return fonts
        else:
            print(f"[fonts.py] Method 2 found only {len(fonts)} fonts, trying Method 3", file=sys.stderr)
    
    except Exception as e:
        print(f"[fonts.py] Method 2 failed: {type(e).__name__}: {e}", file=sys.stderr)
    
    # Method 3: Return hardcoded default list
    print(f"[fonts.py] Method 3: Using fallback default font list", file=sys.stderr)
    return [
        'Arial',
        'DejaVu Sans',
        'Liberation Sans',
        'Helvetica',
        'Verdana',
        'Courier New',
        'DejaVu Serif',
        'Liberation Serif',
        'Times New Roman',
        'Georgia',
        'Impact',
        'Trebuchet MS',
    ]

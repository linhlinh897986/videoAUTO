from __future__ import annotations

import subprocess
from typing import List

from fastapi import APIRouter


router = APIRouter()


@router.get("/fonts")
def get_available_fonts() -> List[str]:
    """
    Get list of fonts available on the server for subtitle rendering.
    Uses fontconfig's fc-list command to enumerate system fonts.
    Arial is prioritized as the default font if available.
    """
    try:
        # Run fc-list to get all available fonts
        # Format: "Family Name:style=Style Name"
        result = subprocess.run(
            ["fc-list", ":", "family"],
            capture_output=True,
            text=True,
            check=True,
            timeout=5
        )
        
        # Parse the output to extract unique font family names
        font_families = set()
        for line in result.stdout.strip().split('\n'):
            if line:
                # fc-list output format: "Font Family Name,Alternative Name"
                # We take the first family name
                family = line.split(',')[0].strip()
                if family:
                    font_families.add(family)
        
        # Convert to sorted list
        fonts = sorted(font_families)
        
        # Prioritize Arial as the default font if it exists
        if 'Arial' in fonts:
            fonts.remove('Arial')
            fonts.insert(0, 'Arial')
        
        return fonts
    
    except (subprocess.SubprocessError, FileNotFoundError, subprocess.TimeoutExpired) as e:
        # If fc-list is not available or fails, return a default list
        # This ensures the API doesn't break on systems without fontconfig
        # Arial is listed first as it's the default font preference
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

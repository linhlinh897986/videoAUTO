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
        
        # Sort and return as list
        return sorted(font_families)
    
    except (subprocess.SubprocessError, FileNotFoundError, subprocess.TimeoutExpired) as e:
        # If fc-list is not available or fails, return a default list
        # This ensures the API doesn't break on systems without fontconfig
        return [
            'Arial',
            'Courier New',
            'Georgia',
            'Helvetica',
            'Impact',
            'Times New Roman',
            'Trebuchet MS',
            'Verdana',
        ]

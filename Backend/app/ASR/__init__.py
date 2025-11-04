from __future__ import annotations

from typing import Dict, Type

from .BaseASR import BaseASR

_AVAILABLE_MODELS: Dict[str, Type[BaseASR]] = {}

try:  # pragma: no cover - optional dependency
    from .BcutASR import BcutASR

    _AVAILABLE_MODELS["BcutASR"] = BcutASR
except ModuleNotFoundError:  # pragma: no cover
    pass

try:  # pragma: no cover - optional dependency
    from .FasterWhisperASR import FasterWhisperASR

    _AVAILABLE_MODELS["FasterWhisper"] = FasterWhisperASR
except ModuleNotFoundError:  # pragma: no cover
    pass

try:  # pragma: no cover - optional dependency
    from .VideocrASR import VideocrASR

    _AVAILABLE_MODELS["Videocr"] = VideocrASR
except Exception:  # pragma: no cover - catch all errors for videocr
    pass

__all__ = list(_AVAILABLE_MODELS.keys())


def transcribe(audio_file, platform, **kwargs):
    """
    Transcribe audio using the specified platform.
    
    Args:
        audio_file: Path to audio file or binary data
        platform: ASR platform name (e.g., 'BcutASR', 'FasterWhisper')
        **kwargs: Additional configuration parameters for the ASR platform
    
    Returns:
        ASRData: Transcription result
    """
    if platform not in _AVAILABLE_MODELS:
        raise ValueError(f"ASR platform '{platform}' is not available")
    asr = _AVAILABLE_MODELS[platform](audio_file, **kwargs)
    return asr.run()

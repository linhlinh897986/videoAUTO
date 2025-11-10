# GPU Acceleration for OCR Processing

## ✅ Automatic GPU Detection

The OCR hardsub detection now **automatically detects and uses GPU** if available:
- **Priority 1**: GPU-accelerated EasyOCR (if CUDA GPU detected)
- **Priority 2**: CPU-based Tesseract (automatic fallback)

The system will use the best available option without any configuration required.

## Current Status

**GPU Detection:**
- Automatically detects CUDA-capable GPUs on startup
- Initializes EasyOCR with GPU support if available
- Falls back to Tesseract if no GPU or EasyOCR not installed

**Performance:**
- **GPU (EasyOCR)**: 5-10x faster than CPU
- **CPU (Tesseract)**: Good baseline performance with multi-threading (2-4x speedup)

## Installation

### Basic Installation (CPU-only)
```bash
# Install Tesseract OCR
sudo apt-get update
sudo apt-get install tesseract-ocr tesseract-ocr-chi-sim

# Install Python dependencies
cd Backend
pip install -r requirements.txt
```

This provides CPU-based OCR using Tesseract with multi-threading.

### GPU-Accelerated Installation (Recommended)

**Prerequisites:**
1. NVIDIA GPU with CUDA support
2. CUDA Toolkit installed

**Steps:**

1. **Verify GPU is available:**
   ```bash
   nvidia-smi
   ```

2. **Install CUDA Toolkit** (if not already installed):
   ```bash
   # Ubuntu
   sudo apt-get install nvidia-cuda-toolkit
   ```

3. **Install PyTorch with CUDA support:**
   ```bash
   # For CUDA 11.8 (check your CUDA version with nvidia-smi)
   pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
   ```

4. **Install EasyOCR:**
   ```bash
   pip install easyocr
   ```

5. **Restart backend server:**
   The system will automatically detect GPU and use EasyOCR.

## Verification

Check server startup logs for GPU status:
```
GPU detected - EasyOCR GPU mode enabled
EasyOCR GPU reader initialized successfully
```

Or if no GPU:
```
GPU not detected - will use CPU-based OCR
```

The API response includes `ocr_engine` field showing which engine was used:
```json
{
  "status": "success",
  "ocr_engine": "GPU (EasyOCR)",  // or "CPU (Tesseract)"
  "frames_analyzed": 20,
  ...
}
```

## Performance Comparison

### CPU (Tesseract) with Multi-threading
- **Processing time**: 5-10 seconds for 20 frames
- **Setup**: Minimal (just install tesseract)
- **Works on**: Any system

### GPU (EasyOCR)
- **Processing time**: 1-3 seconds for 20 frames
- **Speedup**: 3-10x faster than CPU
- **Setup**: Requires NVIDIA GPU with CUDA
- **Works on**: Systems with CUDA-capable GPU

## Troubleshooting

### GPU not detected but you have NVIDIA GPU
1. Check CUDA installation: `nvidia-smi`
2. Verify PyTorch can see GPU:
   ```python
   import torch
   print(torch.cuda.is_available())  # Should print True
   ```
3. Reinstall PyTorch with CUDA support

### EasyOCR fails to initialize
1. Check CUDA version compatibility
2. Ensure enough GPU memory (minimum 2GB recommended)
3. Check logs for specific error messages

### Tesseract fallback not working
1. Install Tesseract: `sudo apt-get install tesseract-ocr tesseract-ocr-chi-sim`
2. Verify installation: `tesseract --version`

## Multi-threading Configuration

- **GPU mode**: Recommend `max_workers: 1-2` (GPU handles parallelism internally)
- **CPU mode**: Recommend `max_workers: 4-8` (based on CPU cores)

## Advanced Configuration

### Disable GPU (force CPU mode)
If you want to force CPU mode even with GPU available, you can modify the code:
```python
# In ocr.py, set this at the top
GPU_AVAILABLE = False
```

### Custom EasyOCR languages
Modify the reader initialization in `ocr.py`:
```python
EASYOCR_READER = easyocr.Reader(['ch_sim', 'en', 'ja'], gpu=True)
```

## System Requirements

### Minimum (CPU-only)
- CPU: 2+ cores
- RAM: 2GB
- Software: Tesseract OCR

### Recommended (GPU-accelerated)
- CPU: 4+ cores
- RAM: 8GB
- GPU: NVIDIA GPU with 4GB+ VRAM
- Software: CUDA 11.x or 12.x, cuDNN, Tesseract OCR (fallback)

---

**Note:** The automatic GPU detection and fallback ensures optimal performance
on any system without manual configuration.

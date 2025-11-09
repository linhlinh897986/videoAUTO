# GPU Acceleration for OCR Processing

## Current Implementation

The OCR hardsub detection now uses **multi-threading** for parallel processing:
- Default: 4 parallel workers
- Configurable via `max_workers` parameter (recommended: 4-8)
- Processes multiple video frames simultaneously
- Significantly faster than sequential processing

## Video Frame Extraction

Frame extraction includes:
- **Automatic rotation detection** - Reads video metadata to detect rotation
- **Rotation correction** - Applies 90°, 180°, or 270° rotations as needed
- **Proper frame orientation** - Ensures frames are correctly oriented for OCR

## GPU Acceleration Options

### For Tesseract OCR

Tesseract itself doesn't have native GPU support. However, you can use alternatives:

#### 1. EasyOCR (GPU-accelerated alternative)
```bash
pip install easyocr
```

To use EasyOCR instead of Tesseract:
- Modify `app/api/ocr.py` to use `easyocr.Reader`
- EasyOCR uses PyTorch and supports CUDA GPUs
- Much faster on GPU, but requires CUDA setup

#### 2. PaddleOCR (GPU-accelerated)
```bash
pip install paddlepaddle-gpu paddleocr
```

PaddleOCR features:
- Native GPU support
- Fast inference
- Good accuracy for Chinese text
- Requires CUDA/cuDNN setup

### For Video Processing (OpenCV)

OpenCV can use GPU for video decoding:

```bash
# Install OpenCV with CUDA support
pip uninstall opencv-python
pip install opencv-contrib-python
```

Then enable CUDA in OpenCV:
```python
cv2.cuda.setDevice(0)  # Use first GPU
```

## Performance Optimization Tips

### Current Multi-threading Setup
```python
# Adjust max_workers based on your CPU cores
max_workers = 8  # Good for 8+ core CPUs
```

### If Using GPU

1. **Install CUDA Toolkit**
   ```bash
   # Check if NVIDIA GPU is available
   nvidia-smi
   
   # Install CUDA toolkit (Ubuntu)
   sudo apt-get install nvidia-cuda-toolkit
   ```

2. **Install cuDNN** (for deep learning OCR engines)
   ```bash
   # Download from NVIDIA website
   # Follow installation guide for your system
   ```

3. **Configure PyTorch for GPU** (if using EasyOCR)
   ```bash
   pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
   ```

## Recommended Configuration

### For CPU-only systems (current)
- `max_workers: 4-8` (based on CPU cores)
- Uses Tesseract with multi-threading
- Good performance for moderate workloads

### For GPU systems
- Replace Tesseract with EasyOCR or PaddleOCR
- Keep `max_workers: 1-2` (GPU handles parallelism)
- 5-10x faster processing
- Requires CUDA setup

## Testing Performance

```python
import time

start = time.time()
# ... OCR processing ...
end = time.time()

print(f"Processing time: {end - start:.2f}s")
print(f"Frames per second: {num_frames / (end - start):.2f}")
```

## Current Status

✅ **Implemented:**
- Multi-threaded OCR processing
- Automatic video rotation detection
- Frame orientation correction
- Configurable worker count

⚠️ **GPU Support:**
- Requires manual installation of GPU-enabled OCR engine
- Not included by default (to maintain compatibility)
- Significant performance boost if configured

## Migration to GPU-based OCR

To switch to GPU-accelerated OCR:

1. Install GPU dependencies
2. Modify `_process_single_frame_ocr()` to use EasyOCR/PaddleOCR
3. Test with small video first
4. Adjust `max_workers` accordingly

Example EasyOCR integration:
```python
import easyocr

# Initialize once (expensive)
reader = easyocr.Reader(['ch_sim', 'en'], gpu=True)

def _process_single_frame_ocr_gpu(frame, video_height):
    # Use EasyOCR instead of Tesseract
    results = reader.readtext(frame)
    # Process results...
```

---

**Note:** Current implementation prioritizes compatibility and ease of deployment.
GPU acceleration requires additional setup but can provide 5-10x speedup for large-scale processing.

# 🎬 Large Video Support - Quick Start Guide

## Tóm Tắt (Summary)

Ứng dụng videoAUTO giờ đây đã được nâng cấp để **xử lý chuyên nghiệp các video dung lượng lớn (vài tiếng)** với các tính năng:

The videoAUTO application has been upgraded to **professionally handle large videos (several hours)** with features:

✅ **Không giới hạn thời lượng video** (No video length limit)
✅ **Phát video mượt mà với tính năng streaming** (Smooth video playback with streaming)
✅ **Theo dõi tiến trình tải lên** (Upload progress tracking)
✅ **Cảnh báo thông minh cho file lớn** (Smart warnings for large files)
✅ **Cấu hình linh hoạt** (Flexible configuration)

## 🚀 Sử Dụng Ngay (Quick Start)

### Cách 1: Sử Dụng Mặc Định (Default Usage)

Không cần cấu hình gì! Chỉ cần khởi động như bình thường:

```bash
# Backend
cd Backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000

# Frontend
cd Frontend
npm run dev
```

**Mặc định hỗ trợ**:
- ⏱️ Render video tối đa: **2 giờ**
- 📦 Upload tối đa: **10 GB**
- 🎥 Tất cả định dạng: MP4, MOV, AVI, MKV

### Cách 2: Video Rất Lớn (For Very Large Videos)

Nếu video của bạn > 2 giờ, tăng timeout:

```bash
# Cho video 6 tiếng (For 6-hour videos)
export RENDER_TIMEOUT_SECONDS=21600  # 6 giờ / 6 hours
export MAX_UPLOAD_SIZE_BYTES=21474836480  # 20GB

cd Backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

## 📱 Các Tính Năng Mới (New Features)

### 1. Cảnh Báo Thông Minh (Smart Warnings)

Khi bạn tải lên video > 2GB, sẽ có cảnh báo:

```
⚠️ Cảnh báo: Bạn đang tải lên video dung lượng lớn:
video.mp4 (3.50 GB)

Video lớn có thể mất nhiều thời gian để:
- Tải lên (vài phút đến vài chục phút)
- Xử lý và phát (tốc độ tùy thiết bị)  
- Render (có thể mất vài giờ)

Bạn có muốn tiếp tục không? [OK] [Cancel]
```

### 2. Theo Dõi Tiến Trình (Progress Tracking)

Với video > 100MB, bạn sẽ thấy tiến trình tải lên:

```
Đang lưu video (1500 MB)... 0%
Đang lưu video (1500 MB)... 25%
Đang lưu video (1500 MB)... 50%
Đang lưu video (1500 MB)... 75%
Đang lưu video (1500 MB)... 100% ✓
```

### 3. Phát Video Mượt Mà (Smooth Video Playback)

- ✅ Không cần tải toàn bộ video
- ✅ Tua (seek) ngay lập tức
- ✅ Phát trong khi đang tải
- ✅ Tiết kiệm bộ nhớ

### 4. Render Không Giới Hạn (Unlimited Rendering)

- ⏱️ Mặc định: 2 giờ
- ⚙️ Có thể cấu hình: Không giới hạn
- 📊 Theo dõi tiến trình trong log
- 🔄 Xử lý tự động các video phức tạp

## 📊 Dung Lượng Khuyến Nghị (Recommended Sizes)

| Thời Lượng | Dung Lượng | Thời Gian Render | Trạng Thái |
|------------|-----------|------------------|------------|
| < 30 phút | < 1 GB | 5-15 phút | ⚡ Rất tốt |
| 30 phút - 1 giờ | 1-2 GB | 15-30 phút | ✅ Tốt |
| 1-2 giờ | 2-4 GB | 30-60 phút | ✅ Tốt |
| 2-4 giờ | 4-8 GB | 1-2 giờ | ✅ Được hỗ trợ |
| > 4 giờ | > 8 GB | > 2 giờ | ⚙️ Cần cấu hình |

## 🔧 Cấu Hình Nâng Cao (Advanced Configuration)

### Tăng Timeout Render

```bash
# 4 giờ (4 hours)
export RENDER_TIMEOUT_SECONDS=14400

# 8 giờ (8 hours)  
export RENDER_TIMEOUT_SECONDS=28800

# 12 giờ (12 hours)
export RENDER_TIMEOUT_SECONDS=43200
```

### Tăng Giới Hạn Upload

```bash
# 20 GB
export MAX_UPLOAD_SIZE_BYTES=21474836480

# 50 GB
export MAX_UPLOAD_SIZE_BYTES=53687091200

# 100 GB
export MAX_UPLOAD_SIZE_BYTES=107374182400
```

### Ví Dụ Hoàn Chỉnh (Complete Example)

```bash
# Cho video 10 tiếng, dung lượng 30GB
export RENDER_TIMEOUT_SECONDS=43200      # 12 giờ / 12 hours
export MAX_UPLOAD_SIZE_BYTES=53687091200  # 50 GB

cd Backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

## 📖 Tài Liệu Chi Tiết (Detailed Documentation)

Xem thêm tài liệu chi tiết:

1. **LARGE_VIDEO_GUIDE.md** - Hướng dẫn đầy đủ
   - Best practices
   - Troubleshooting
   - FAQ
   - Configuration examples

2. **LARGE_VIDEO_IMPLEMENTATION.md** - Chi tiết kỹ thuật
   - Implementation details
   - Performance metrics
   - Technical specifications

## 🐛 Gặp Vấn Đề? (Troubleshooting)

### Vấn Đề: Render Timeout

**Giải pháp**:
```bash
# Tăng timeout
export RENDER_TIMEOUT_SECONDS=28800  # 8 giờ
```

### Vấn Đề: Tải Lên Chậm

**Giải pháp**:
1. Kiểm tra kết nối mạng
2. Sử dụng mạng có dây thay vì WiFi
3. Đảm bảo không có app khác đang tải

### Vấn Đề: Video Player Lag

**Giải pháp**:
1. Video đã được tối ưu với streaming
2. Đóng các tab browser khác
3. Xóa cache browser

### Vấn Đề: Hết Bộ Nhớ

**Giải pháp**:
1. Khởi động lại server
2. Xử lý video từng phần
3. Tăng RAM của máy chủ

## ✅ Kiểm Tra (Verification)

### Test Configuration

```bash
cd Backend
python3 -c "
from app.core import RENDER_TIMEOUT_SECONDS, MAX_UPLOAD_SIZE_BYTES
print(f'Timeout: {RENDER_TIMEOUT_SECONDS}s ({RENDER_TIMEOUT_SECONDS/3600:.1f}h)')
print(f'Max upload: {MAX_UPLOAD_SIZE_BYTES/(1024**3):.1f}GB')
"
```

**Kết quả mong đợi (Expected output)**:
```
Timeout: 7200s (2.0h)
Max upload: 10.0GB
```

### Test API

```bash
# Kiểm tra backend đang chạy
curl http://localhost:8000/health

# Kết quả: {"status":"ok"}
```

## 📞 Hỗ Trợ (Support)

Nếu gặp vấn đề:

1. ✅ Kiểm tra [LARGE_VIDEO_GUIDE.md](LARGE_VIDEO_GUIDE.md)
2. ✅ Xem log files trong `Backend/data/*/rendered/render_log_*.txt`
3. ✅ Thử với video nhỏ hơn để test
4. ✅ Đảm bảo FFmpeg đã được cài đặt: `ffmpeg -version`

## 🎉 Kết Luận (Conclusion)

Ứng dụng videoAUTO giờ đây:

✅ **Xử lý video dài** (vài tiếng) một cách chuyên nghiệp
✅ **Trình phát video** được tối ưu với streaming
✅ **Trải nghiệm người dùng** tốt với progress tracking
✅ **Linh hoạt** với environment variables
✅ **Dễ sử dụng** với cấu hình mặc định hợp lý

**Bắt đầu ngay** với cấu hình mặc định, không cần thay đổi gì!

---

**Phiên bản**: 1.0.0
**Ngày cập nhật**: November 16, 2025
**Tương thích**: Tất cả video hiện tại (backward compatible)

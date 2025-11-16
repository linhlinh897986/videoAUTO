# Hướng Dẫn Xử Lý Video Dung Lượng Lớn
# Large Video Handling Guide

## Tổng Quan (Overview)

Ứng dụng videoAUTO đã được tối ưu hóa để hỗ trợ xử lý video dung lượng lớn (vài giờ) một cách chuyên nghiệp. Tài liệu này cung cấp hướng dẫn và khuyến nghị để đạt hiệu quả tốt nhất.

The videoAUTO application has been optimized to professionally support processing large videos (several hours long). This document provides guidelines and recommendations for best results.

## Cải Tiến Chính (Key Improvements)

### 1. Tăng Thời Gian Render (Extended Rendering Timeout)
- **Trước đây (Previous)**: 10 phút (600 giây)
- **Hiện tại (Current)**: 2 giờ (7200 giây) - có thể cấu hình
- **Cấu hình (Configuration)**: Đặt biến môi trường `RENDER_TIMEOUT_SECONDS`

```bash
# Ví dụ: Tăng timeout lên 4 giờ
export RENDER_TIMEOUT_SECONDS=14400
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

### 2. Tối Ưu FFmpeg Cho Video Lớn (FFmpeg Optimization)
- **Fast Start**: Cho phép phát video trước khi tải xong
- **Increased Buffer**: Xử lý tốt hơn với video dung lượng lớn
- **Streaming Support**: Hỗ trợ phát trực tuyến và tải xuống tuần tự

### 3. Theo Dõi Tiến Trình Tải Lên (Upload Progress Tracking)
- Hiển thị phần trăm khi tải lên video > 100MB
- Cảnh báo trước khi tải video > 2GB
- Hủy bỏ tải lên nếu người dùng không muốn tiếp tục

### 4. Tối Ưu Trình Phát Video (Video Player Optimization)
- Preload metadata only: Giảm thời gian tải ban đầu
- Lazy loading: Chỉ tải phần video cần thiết
- Hiệu suất tốt hơn với video dài

## Khuyến Nghị Cho Video Lớn (Recommendations for Large Videos)

### Định Dạng Video Tốt Nhất (Best Video Formats)

| Format | Kích thước | Hiệu suất | Khuyến nghị |
|--------|-----------|-----------|-------------|
| MP4 (H.264) | ✅ Tốt | ✅ Tốt nhất | **Khuyến nghị** |
| MKV | ⚠️ Lớn | ✅ Tốt | Chấp nhận |
| AVI | ❌ Rất lớn | ⚠️ Chậm | Không khuyến nghị |
| MOV | ✅ Tốt | ✅ Tốt | Chấp nhận |

### Kích Thước Video Khuyến Nghị (Recommended Video Sizes)

| Thời lượng | Dung lượng tối đa | Thời gian render dự kiến |
|------------|------------------|--------------------------|
| < 30 phút | < 1 GB | 5-15 phút |
| 30 phút - 1 giờ | 1-2 GB | 15-30 phút |
| 1-2 giờ | 2-4 GB | 30-60 phút |
| 2-4 giờ | 4-8 GB | 1-2 giờ |
| > 4 giờ | > 8 GB | > 2 giờ |

**Lưu ý**: Thời gian render phụ thuộc vào:
- Độ phức tạp của video (số segment, hiệu ứng)
- Số lượng audio tracks
- Số lượng phụ đề
- Cấu hình máy chủ (CPU, RAM, GPU)

### Chuẩn Bị Video Trước Khi Tải Lên (Prepare Video Before Upload)

#### 1. Nén Video Nếu Cần (Compress Video If Needed)
```bash
# Sử dụng FFmpeg để nén video mà không mất nhiều chất lượng
ffmpeg -i input.mp4 -c:v libx264 -crf 23 -preset medium -c:a aac -b:a 128k output.mp4
```

#### 2. Cắt Video Thành Các Phần Nhỏ (Split Large Videos)
Nếu video quá lớn (> 5 giờ), xem xét chia thành nhiều phần:
```bash
# Cắt video thành các đoạn 2 giờ
ffmpeg -i input.mp4 -c copy -map 0 -segment_time 7200 -f segment output_%03d.mp4
```

#### 3. Kiểm Tra Codec Video (Check Video Codec)
```bash
# Kiểm tra thông tin video
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,duration -of default=noprint_wrappers=1 input.mp4
```

## Xử Lý Sự Cố (Troubleshooting)

### Vấn Đề: Tải Lên Lâu (Slow Upload)

**Nguyên nhân**: Video dung lượng lớn, kết nối mạng chậm

**Giải pháp**:
1. Kiểm tra kết nối mạng
2. Đảm bảo không có ứng dụng khác đang tải xuống/lên
3. Xem xét nén video trước khi tải lên
4. Sử dụng mạng có dây thay vì WiFi

### Vấn Đề: Render Timeout

**Nguyên nhân**: Video quá phức tạp hoặc quá dài

**Giải pháp**:
1. Tăng `RENDER_TIMEOUT_SECONDS`:
   ```bash
   export RENDER_TIMEOUT_SECONDS=21600  # 6 giờ
   ```
2. Giảm số lượng segment và audio tracks
3. Tắt các hiệu ứng không cần thiết
4. Render từng phần video riêng biệt

### Vấn Đề: Video Player Lag

**Nguyên nhân**: Video độ phân giải cao, thiết bị yếu

**Giải pháp**:
1. Giảm độ phân giải video xuống 1080p:
   ```bash
   ffmpeg -i input.mp4 -vf scale=1920:1080 -c:v libx264 -crf 23 output.mp4
   ```
2. Sử dụng máy tính/thiết bị mạnh hơn
3. Đóng các tab trình duyệt khác
4. Xóa cache trình duyệt

### Vấn Đề: Hết Bộ Nhớ (Out of Memory)

**Nguyên nhân**: Video quá lớn, RAM không đủ

**Giải pháp**:
1. Tăng RAM của máy chủ
2. Giảm số lượng worker threads trong cấu hình
3. Xử lý video từng phần thay vì toàn bộ
4. Khởi động lại server để giải phóng bộ nhớ

## Cấu Hình Nâng Cao (Advanced Configuration)

### Tối Ưu Backend Server

**File**: `Backend/app/core/config.py`

```python
# Timeout cho rendering (giây)
RENDER_TIMEOUT_SECONDS = 7200  # 2 giờ

# Dung lượng tối đa cho file upload (bytes)
MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024 * 1024  # 10GB
```

### Biến Môi Trường (Environment Variables)

```bash
# Tăng timeout render (4 giờ)
export RENDER_TIMEOUT_SECONDS=14400

# Tăng giới hạn upload (20GB)
export MAX_UPLOAD_SIZE_BYTES=21474836480

# Khởi động server
cd Backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

### Tối Ưu FFmpeg

Nếu bạn cần tùy chỉnh thêm, chỉnh sửa file `Backend/app/api/render.py`:

```python
# Preset nhanh hơn (chất lượng thấp hơn)
ffmpeg_cmd.extend(["-preset", "fast"])

# Preset chậm hơn (chất lượng cao hơn)
ffmpeg_cmd.extend(["-preset", "slow"])

# Giảm CRF để tăng chất lượng (tăng dung lượng)
ffmpeg_cmd.extend(["-crf", "18"])

# Tăng CRF để giảm dung lượng (giảm chất lượng)
ffmpeg_cmd.extend(["-crf", "28"])
```

## Monitoring và Logging

### Kiểm Tra Log Render

Log files được lưu tại: `Backend/data/{project_id}/rendered/render_log_*.txt`

```bash
# Xem log mới nhất
tail -f Backend/data/*/rendered/render_log_*.txt

# Tìm lỗi trong log
grep -i "error" Backend/data/*/rendered/render_log_*.txt
```

### Theo Dõi Tiến Trình FFmpeg

Log FFmpeg cung cấp thông tin về:
- Thời gian đã render
- FPS (frames per second)
- Bitrate
- Dung lượng file output

## Best Practices

### ✅ Nên Làm (Do's)

1. **Kiểm tra video trước khi tải lên**: Đảm bảo video không bị lỗi
2. **Sử dụng định dạng MP4 H.264**: Tương thích tốt nhất
3. **Theo dõi tiến trình**: Chú ý đến thông báo tiến trình upload/render
4. **Lưu công việc thường xuyên**: Save project trước khi render
5. **Test với video ngắn trước**: Kiểm tra cài đặt với video nhỏ

### ❌ Không Nên (Don'ts)

1. **Không tải lên video quá lớn mà không cảnh báo**: Kiểm tra dung lượng
2. **Không render nhiều video cùng lúc**: Render từng video một
3. **Không đóng trình duyệt khi đang render**: Có thể mất công việc
4. **Không dùng video chất lượng quá cao**: 1080p là đủ cho hầu hết trường hợp
5. **Không bỏ qua cảnh báo**: Đọc kỹ thông báo trước khi tiếp tục

## Câu Hỏi Thường Gặp (FAQ)

### Q: Video bao lâu được coi là "lớn"?
**A**: Video > 2GB hoặc > 1 giờ được coi là video lớn và có cảnh báo đặc biệt.

### Q: Có giới hạn tối đa về dung lượng video không?
**A**: Mặc định là 10GB, có thể tăng bằng cách đặt `MAX_UPLOAD_SIZE_BYTES`.

### Q: Tại sao render mất nhiều thời gian?
**A**: Rendering là quá trình nặng CPU. Thời gian phụ thuộc vào độ dài video, số lượng hiệu ứng, và cấu hình máy chủ.

### Q: Có thể render video offline không?
**A**: Có, nhưng cần backend server chạy local. Frontend chỉ gửi yêu cầu, backend thực hiện render.

### Q: Video render có chất lượng như video gốc không?
**A**: Gần như vậy. Sử dụng CRF 23 (chất lượng tốt) theo mặc định. Có thể giảm CRF để tăng chất lượng.

## Liên Hệ và Hỗ Trợ (Contact and Support)

Nếu gặp vấn đề với video lớn:
1. Kiểm tra log files
2. Đọc tài liệu troubleshooting
3. Tham khảo GitHub Issues của dự án
4. Liên hệ với maintainers

---

**Cập nhật lần cuối**: 2025-01-16
**Phiên bản**: 1.0.0

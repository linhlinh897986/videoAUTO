# Quick Setup Guide - Download Tab

## Để sử dụng tính năng tải video (To use the video download feature)

**Note**: For handling large videos (several hours long), please also see [LARGE_VIDEO_GUIDE.md](LARGE_VIDEO_GUIDE.md) for optimization tips and best practices.

### Thiết lập Cục bộ (Local Setup)

#### 1. Khởi động Backend Server (Start Backend Server)

Mở terminal và chạy lệnh sau trong thư mục Backend:

```bash
cd Backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Bạn sẽ thấy thông báo:
```
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

#### 2. Khởi động Frontend (Start Frontend)

Mở terminal khác và chạy lệnh sau trong thư mục Frontend:

```bash
cd Frontend
npm run dev
```

#### 3. Cấu hình Environment Variable (Configure Environment Variable)

Đảm bảo file `.env` trong thư mục Frontend có:

```
VITE_API_BASE_URL=http://localhost:8000
```

### Thiết lập trên Google Colab với ngrok (Google Colab + ngrok Setup)

#### 1. Khởi động Backend trên Colab

Trong Colab notebook, chạy backend với ngrok:

```python
# Install dependencies
!pip install fastapi uvicorn pyngrok requests yt-dlp

# Start backend with ngrok
from pyngrok import ngrok
import subprocess

# Start uvicorn in background
backend_process = subprocess.Popen([
    "python", "-m", "uvicorn", "main:app",
    "--host", "0.0.0.0", "--port", "8000"
])

# Create ngrok tunnel
public_url = ngrok.connect(8000)
print(f"Backend URL: {public_url}")
```

#### 2. Cấu hình Frontend

Sử dụng URL ngrok trong file `.env`:

```
VITE_API_BASE_URL=https://xxxx-xx-xxx-xxx-xx.ngrok-free.app
```

Hoặc set trong code trước khi build/run frontend.

### 4. Sử dụng (Usage)

1. Mở ứng dụng trong trình duyệt
2. Chọn một project
3. Chuyển sang tab "Tải Xuống" (Download)
4. Nhập URL của kênh Douyin hoặc YouTube
5. Nhấn "Quét" để xem danh sách video
6. Nhấn "Tải xuống" trên video bạn muốn tải

## Khắc phục sự cố (Troubleshooting)

### Lỗi: "Request to /downloads/scan failed with status 404"

**Nguyên nhân**: Backend server chưa chạy hoặc URL không đúng

**Giải pháp**:
1. **Kiểm tra backend đang chạy**:
   - Local: Kiểm tra terminal có thông báo "Uvicorn running"
   - Colab: Kiểm tra ngrok tunnel còn hoạt động
2. **Kiểm tra `VITE_API_BASE_URL`**:
   - Local: Phải là `http://localhost:8000`
   - Colab: Phải là URL ngrok (vd: `https://xxxx.ngrok-free.app`)
3. **Thử truy cập API docs**:
   - Local: http://localhost:8000/docs
   - Colab: https://your-ngrok-url/docs

### Lỗi: "Unexpected token '<'"

**Nguyên nhân**: Frontend đang kết nối đến sai địa chỉ hoặc backend trả về HTML thay vì JSON

**Giải pháp**:
1. Kiểm tra `VITE_API_BASE_URL` đúng với backend URL
2. Xóa cache của trình duyệt và reload trang
3. Kiểm tra console của trình duyệt để xem URL nào đang được gọi
4. Với ngrok: Đảm bảo không có trang warning của ngrok

### Lỗi: "Failed to fetch" hoặc "ERR_CONNECTION_REFUSED"

**Nguyên nhân**: Không thể kết nối đến backend

**Giải pháp**:
1. Đảm bảo backend server đang chạy
2. Kiểm tra URL trong `VITE_API_BASE_URL` chính xác
3. **Với Colab/ngrok**: 
   - Ngrok tunnel có thể hết hạn (ngrok free có thời gian giới hạn)
   - Tạo lại tunnel và cập nhật `VITE_API_BASE_URL`
4. Kiểm tra firewall không chặn kết nối

## Yêu cầu hệ thống (System Requirements)

- Python 3.8+
- Node.js 16+
- Các dependencies được liệt kê trong `Backend/requirements.txt`
- Các dependencies được liệt kê trong `Frontend/package.json`
- (Optional) ngrok account cho Colab setup

## Lưu ý quan trọng (Important Notes)

- **Backend phải chạy trước** khi sử dụng tính năng download
- **`VITE_API_BASE_URL` phải khớp** với địa chỉ backend thực tế
- Với **ngrok**: URL có thể thay đổi mỗi lần khởi động lại, cần cập nhật lại
- Douyin downloads yêu cầu script `douyin/main.py` hoạt động
- **YouTube downloads**:
  - **Windows**: Sử dụng `yt-dlp.exe` trong thư mục `Backend/app/download/`
  - **Linux/Colab**: Tự động sử dụng `yt-dlp` từ PATH hoặc Python module (cần cài `pip install yt-dlp`)
  - Hệ thống tự động phát hiện platform và sử dụng phương thức phù hợp


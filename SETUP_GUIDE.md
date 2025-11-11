# Quick Setup Guide - Download Tab

## Để sử dụng tính năng tải video (To use the video download feature)

### 1. Khởi động Backend Server (Start Backend Server)

Mở terminal và chạy lệnh sau trong thư mục Backend:

```bash
cd Backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Bạn sẽ thấy thông báo:
```
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

### 2. Khởi động Frontend (Start Frontend)

Mở terminal khác và chạy lệnh sau trong thư mục Frontend:

```bash
cd Frontend
npm run dev
```

### 3. Cấu hình Environment Variable (Configure Environment Variable)

Đảm bảo file `.env` trong thư mục Frontend có:

```
VITE_API_BASE_URL=http://localhost:8000
```

Hoặc nếu chạy trên máy khác, thay `localhost` bằng địa chỉ IP của máy chạy backend.

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
1. Kiểm tra backend server đang chạy (xem bước 1)
2. Kiểm tra `VITE_API_BASE_URL` trong file `.env`
3. Thử truy cập http://localhost:8000/docs trong trình duyệt để xem API docs

### Lỗi: "Unexpected token '<'"

**Nguyên nhân**: Frontend đang kết nối đến sai địa chỉ hoặc backend trả về HTML thay vì JSON

**Giải pháp**:
1. Kiểm tra backend server đang chạy
2. Xóa cache của trình duyệt và reload trang
3. Kiểm tra console của trình duyệt để xem URL nào đang được gọi

### Lỗi: "Failed to fetch" hoặc "ERR_CONNECTION_REFUSED"

**Nguyên nhân**: Không thể kết nối đến backend

**Giải pháp**:
1. Đảm bảo backend server đang chạy
2. Kiểm tra firewall không chặn port 8000
3. Nếu chạy trên máy khác, đảm bảo cấu hình network đúng

## Yêu cầu hệ thống (System Requirements)

- Python 3.8+
- Node.js 16+
- Các dependencies được liệt kê trong `Backend/requirements.txt`
- Các dependencies được liệt kê trong `Frontend/package.json`

## Lưu ý (Notes)

- Backend phải chạy trước khi sử dụng tính năng download
- Douyin downloads yêu cầu script `douyin/main.py` hoạt động
- YouTube downloads yêu cầu `yt-dlp.exe` trong thư mục Backend/app/download/

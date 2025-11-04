# Trình Dịch Phụ Đề SRT & Video Editor

Đây là một ứng dụng web mạnh mẽ được thiết kế để dịch hàng loạt tệp phụ đề SRT bằng API Google Gemini. Nó cung cấp các tính năng nâng cao như quản lý dự án, phong cách dịch tùy chỉnh, thay thế từ khóa và một trình chỉnh sửa video chuyên nghiệp để đồng bộ hóa và tinh chỉnh phụ đề.

## ✨ Tính năng chính

- **Quản lý dựa trên dự án**: Tổ chức công việc dịch thuật của bạn thành các dự án riêng biệt.
- **Tải lên hàng loạt tệp SRT & Video**: Tải lên nhiều tệp SRT và video (.mp4, .mov, .mkv) cùng một lúc.
- **Dịch thuật bằng AI**: Sử dụng API Gemini để có bản dịch chất lượng cao.
- **Phong cách dịch tùy chỉnh**: Xác định các mẫu lệnh (prompt) tùy chỉnh để hướng dẫn giọng điệu, phong cách và từ vựng của AI (ví dụ: cổ trang, tiên hiệp, hiện đại).
- **Thay thế từ khóa**: Tự động thay thế các thuật ngữ cụ thể để đảm bảo tính nhất quán (ví dụ: tên nhân vật, địa danh).
- **Phân tích bối cảnh bằng AI**: Tự động trích xuất hồ sơ nhân vật, địa danh, kỹ năng và cảnh giới từ kịch bản để đảm bảo bản dịch nhất quán.
- **Quản lý API Key nâng cao**: Quản lý nhiều API key Gemini, với cơ chế tự động xoay vòng và theo dõi trạng thái (hoạt động/đã hết lượt).
- **Điều chỉnh hiệu suất**: Điều chỉnh số luồng đồng thời, giới hạn token và cài đặt "thinking" của AI để cân bằng giữa tốc độ và chất lượng.
- **Trình chỉnh sửa video chuyên nghiệp**: Một trình chỉnh sửa đầy đủ tính năng để xem phụ đề đã dịch được đồng bộ hóa với video, điều chỉnh thời gian trên dòng thời gian đa rãnh và tùy chỉnh giao diện phụ đề.
- **Lưu trữ ngoại tuyến**: Sử dụng IndexedDB cho các tệp video và LocalStorage cho dữ liệu dự án, cho phép duy trì dữ liệu giữa các phiên làm việc.

## 🚀 Cách sử dụng

1.  **Tạo dự án mới**: Bắt đầu bằng cách tạo một dự án và đặt tên cho nó.
2.  **Thêm API Key**: Điều hướng đến `Cài đặt` > `Quản lý API Keys` để thêm (các) API key Gemini của bạn.
3.  **Tải tệp lên**: Trong tab `Tệp Tin`, tải lên các tệp SRT và video của bạn.
4.  **Cung cấp bối cảnh (Tùy chọn)**: Sử dụng các tab `Từ Khóa`, `Nhân Vật` và `Bối Cảnh` để thêm ngữ cảnh cho AI, giúp cải thiện độ chính xác.
5.  **Bắt đầu dịch**: Nhấp vào `Dịch Tất Cả` để bắt đầu quá trình dịch.
6.  **Tải về**: Sau khi dịch xong, bạn có thể tải về các tệp riêng lẻ hoặc một kho lưu trữ ZIP chứa tất cả các bản dịch.
7.  **Chỉnh sửa & Tinh chỉnh**: Đối với các tệp video, nhấp vào biểu tượng "Chỉnh sửa" (cây kéo) để mở trình chỉnh sửa chuyên nghiệp và tinh chỉnh phụ đề của bạn.

## 🛠️ Công nghệ sử dụng

- **Frontend**: React, TypeScript, Tailwind CSS
- **API**: Google Gemini API (`@google/genai`)
- **Lưu trữ phía client**: IndexedDB, LocalStorage
- **Tiện ích**: JSZip

## 🌳 Cấu trúc cây thư mục

```
.
├── index.html
├── metadata.json
├── README.md
├── vite.config.ts
└── index.tsx
    ├── App.tsx
    ├── components/
    │   ├── editor/
    │   │   ├── EditorControls.tsx
    │   │   ├── StyleEditor.tsx
    │   │   ├── SubtitleList.tsx
    │   │   ├── Timeline.tsx
    │   │   ├── TimelineItem.tsx
    │   │   ├── Track.tsx
    │   │   ├── TrackHeader.tsx
    │   │   ├── VideoPlayer.tsx
    │   │   └── Waveform.tsx
    │   ├── modals/
    │   │   ├── ApiKeyManagerModal.tsx
    │   │   ├── StyleManagerModal.tsx
    │   │   └── VideoEditorModal.tsx
    │   ├── project/
    │   │   ├── ProjectCharacters.tsx
    │   │   ├── ProjectContext.tsx
    │   │   ├── ProjectFiles.tsx
    │   │   ├── ProjectKeywords.tsx
    │   │   └── ProjectSettings.tsx
    │   ├── ui/
    │   │   └── Icons.tsx
    │   └── views/
    │       ├── ProfessionalVideoEditor.tsx
    │       ├── ProjectManager.tsx
    │       └── ProjectView.tsx
    ├── hooks/
    │   ├── useLocalStorage.ts
    │   └── useTimelineInteraction.ts
    ├── services/
    │   ├── encryptionService.ts
    │   ├── geminiService.ts
    │   ├── projectService.ts
    │   ├── rateLimiter.ts
    │   └── srtParser.ts
    ├── constants.ts
    └── types.ts
```

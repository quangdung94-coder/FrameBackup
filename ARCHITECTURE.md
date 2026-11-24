# Kiến trúc Kỹ thuật (Architecture)

## 1. Tổng quan Hệ thống

Ứng dụng được xây dựng theo mô hình **Electron Multi-Process** để đảm bảo giao diện (Renderer) luôn mượt mà ngay cả khi đang copy hàng trăm GB video hoặc quét hàng nghìn file ảnh RAW:

```text
+-------------------------------------------------------------------+
|                   Renderer Process (React + TS)                   |
|  4-Column UI • Date Guard Alert • Storage Bars • Report Preview   |
+---------------------------------+---------------------------------+
                                  | IPC (ContextBridge / Preload)
+---------------------------------v---------------------------------+
|                     Main Process (Node.js)                        |
|  Job Orchestrator • Power Manager (Prevent Sleep / Shutdown)      |
|  Drive OAuth Manager • Telegram / Email Notifier                  |
+--------+--------------------+--------------------+----------------+
         |                    |                    |
+--------v-------+   +--------v-------+   +--------v----------------+
| Ingest & Copy  |   | Media & Pack   |   | Cloud Upload Worker     |
| Worker Thread  |   | Worker Thread  |   | (Google Drive API v3)   |
| • Date Check   |   | • EXIF / FFmpeg|   | • Resumable Chunked Up  |
| • XXHash64     |   | • Thumbs Gen   |   | • Auto-Retry / Backoff  |
| • Watch Mode   |   | • 7zip-bin     |   | • _BACKUP_REPORT.txt    |
+----------------+   +----------------+   +-------------------------+
```

---

## 2. Chi tiết các Module Chính

### 2.1. Date Guard Engine (Kiểm tra Lệch ngày)
- **Độ ưu tiên đọc ngày gốc của file**:
  1. **Ảnh (JPG, HEIC, ARW, CR2, CR3, NEF, RAF, DNG)**: Đọc `EXIF DateTimeOriginal` bằng `exifr`.
  2. **Video (MP4, MOV, MXF, MKV)**: Đọc `creation_time` trong container metadata bằng `ffprobe` / `ffmpeg-static`.
  3. **Fallback**: Dùng `fs.stat().mtime` (tuyệt đối không chỉ tin vào `birthtime` vì OS thường ghi đè `birthtime` khi copy).
- **Quy tắc Quay xuyên đêm**: Khi bật `overnightMode`, các file có thời gian từ `00:00` đến `04:00` của ngày `D+1` vẫn được gom chung là hợp lệ với ngày quay `D`.
- **Chế độ xử lý khi lệch ngày**:
  - `FILTER_TARGET_ONLY`: Chỉ copy file khớp ngày mục tiêu sang Ổ 1.
  - `SPLIT_BY_DATE`: Tạo các thư mục con `YYYY.MM.DD/` tương ứng trên Ổ 1.
  - `COPY_ALL`: Chép toàn bộ theo cấu trúc gốc.

### 2.2. Dual-Mode Source (Ingest trực tiếp & Watch Mode)
- **Chế độ mặc định (Direct Ingest)**: App đọc danh sách file từ Thẻ nhớ ➔ ghi sang Ổ 1 qua stream kèm tính song song `XXHash64` trên luồng đọc để giảm số lần đọc đĩa.
- **Chế độ dự phòng (Watch Mode)**: Cho phép người dùng tự copy bằng Windows Explorer / TeraCopy / macOS Finder. App theo dõi thư mục Ổ 1 bằng `chokidar` kết hợp 3 lớp xác nhận xong:
  1. Không còn file tạm (`.tmp`, `.part`, `._*`).
  2. Không còn file bị khóa ghi (File-Lock check).
  3. Tổng dung lượng & `mtime` ổn định trong `N` giây (mặc định 30s).

### 2.3. Media Inspector & Thumbnail Generator
- Quét danh sách file hợp lệ đã sao lưu, sắp xếp theo thời gian quay/chụp gốc tăng dần để lấy **First Shot** và **Last Shot**.
- **Video**: Chạy `ffmpeg-static` trích xuất 1 frame nhanh (`-ss 00:00:01 -vframes 1 -vf scale=640:-1`) xuất ra file `.jpg` (~100–200KB).
- **Ảnh (kể cả RAW)**: Dùng `exifr.thumbnail()` trích xuất trực tiếp ảnh JPEG Preview nhúng sẵn trong file RAW (tốc độ vài mili-giây, không cần decode RAW nặng).

### 2.4. Packaging & Google Drive Resumable Upload
- **Đóng gói (`7zip-bin`)**:
  - Chế độ `NONE`: Giữ nguyên thư mục, up từng file.
  - Chế độ `ZIP_STORE`: Nén mức `-mx=0` (Store — không nén CPU, tốc độ ngang copy ổ cứng), đặc biệt tối ưu cho thư mục chứa hàng nghìn file ảnh RAW/JPG.
  - Chế độ `ARCHIVE_7Z`: Nén tiêu chuẩn.
  - Tùy chọn xóa file tạm sau khi upload Drive thành công 100%.
- **Google Drive API v3**:
  - Tách `Folder ID` từ link dán vào (`https://drive.google.com/drive/folders/<ID>`).
  - Gọi `files.get(fields: 'capabilities(canAddChildren)')` để kiểm tra ngay quyền **Editor** trước khi chạy.
  - Sử dụng **Resumable Upload** theo từng chunk (ví dụ 16MB–32MB) có Exponential Backoff khi rớt mạng.
  - Khi xong toàn bộ, upload thêm `_00_BACKUP_REPORT.txt` và 2 ảnh thumbnail (`_01_FIRST_SHOT_*.jpg`, `_02_LAST_SHOT_*.jpg`) ngay đầu thư mục Drive.

### 2.5. Power Management & Build Đa nền tảng (Windows & macOS)
- **Prevent Sleep**: `electron.powerSaveBlocker.start('prevent-app-suspension')` khi có job đang chạy.
- **Post-Job Action**:
  - **Windows**: Sleep (`rundll32.exe powrprof.dll,SetSuspendState 0,1,0`) / Shutdown (`shutdown /s /t 60`).
  - **macOS**: Sleep (`pmset sleepnow` hoặc `osascript -e 'tell app "System Events" to sleep'`).
- **Đóng gói Windows & macOS**: Sử dụng `electron-builder` kết hợp **GitHub Actions** (runner macOS & Windows) ở Phase 5 để tự động xuất đồng thời `.exe` và `.dmg`.

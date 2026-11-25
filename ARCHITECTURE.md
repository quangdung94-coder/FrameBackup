# Kiến trúc Kỹ thuật (Architecture — v1.4.0)

## 1. Tổng quan Hệ thống

Ứng dụng xây dựng theo mô hình **Electron Multi-Process** (Main Node.js async I/O + Child Processes `ffmpeg`, `7za`, TeraCopy/FastCopy/rsync + Renderer React):

```text
+-------------------------------------------------------------------+
|                   Renderer Process (React + TS)                   |
|  Multi-Card Tabs • 4-Column Explorer UI • Preview & ProgressBar   |
+---------------------------------+---------------------------------+
                                  | IPC (ContextBridge / Preload)
+---------------------------------v---------------------------------+
|                     Main Process (Node.js)                        |
|  IPC Handlers (system, disk, pipeline, drive) • PowerSaveBlocker  |
|  Drive Watcher • ShotDate Cache • Verify Ledger                   |
+--------+--------------------+--------------------+----------------+
         |                    |                    |
+--------v-------+   +--------v-------+   +--------v----------------+
| Copy & Verify  |   | Media & Pack   |   | Google Drive API v3     |
| • copyPlan     |   | • EXIF / FFmpeg|   | • OAuth PKCE + Picker   |
| • XXHash64     |   | • Thumbs Cache |   | • 32/64MB x3 Parallel   |
| • Watch Mode   |   | • 7zip-bin     |   | • MD5 Check & PDF/TXT   |
+----------------+   +----------------+   +-------------------------+
```

---

## 2. Chi tiết các Module Chính

### 2.1. Date Guard & ShotDate Cache
- **Độ ưu tiên đọc ngày gốc**: `EXIF DateTimeOriginal` (`exifr`) ➔ Video container atom (`mvhd` / `ffmpeg-static`) ➔ `fs.stat().mtime`.
- **Quét 2 bước**: Hiển thị danh sách file ngay lập tức (`scanRecursiveQuick`), đọc ngày chụp ngầm từng đợt và lưu cache vào `userData/shot-date-cache.json`.
- **Quy tắc Quay xuyên đêm**: Khi bật `overnightMode`, file từ `00:00` đến `04:00` của ngày `D+1` được tính vào ngày quay `D`.

### 2.2. Copy, Verify & Watch Mode
- **Lập kế hoạch (`copyPlan.ts`) & Thực thi (`copyVerifyService.ts`)**:
  - Chặn tự chép đè thư mục cha/con (`assertNonOverlappingDirs`), kiểm tra dung lượng trống trước khi chép, xử lý xung đột tên (`keep-both` / `skip` / `overwrite`), ghi tạm `.fbpart` và đổi tên nguyên tử (atomic rename).
  - Verify **XXHash64** từng file (dùng `xxhash-wasm` + `verify-ledger.json` để bỏ qua file chưa đổi). Hỗ trợ cả engine ngoài (TeraCopy, FastCopy, Robocopy, rsync, ditto) và tự verify XXHash64 sau khi engine ngoài xong.
- **Watch Mode (`watchService.ts`)**: Theo dõi thư mục Ổ 1 qua `chokidar`, đếm cả file đã có sẵn, chỉ kích hoạt chuỗi sau khi đủ file và hết khóa ghi.

### 2.3. Media Info, Thumbnail & Packaging
- **Helper dùng chung (`electron/lib/thumbnail.ts`)**: Trích xuất thumbnail JPEG (`exifr.thumbnail` cho ảnh/RAW, `ffmpeg-static` cho video), dùng chung cho cả Preview lưới (`mediaInfoService.ts`) và Shot đầu/cuối (`mediaInspectorService.ts`).
- **Đóng gói (`packagingService.ts`)**: Hỗ trợ `video-raw-smart` (Video lẻ + Ảnh Zip Store `-mx=0`), `none`, `zip-store`, `7z`; hỗ trợ đóng gói chọn lọc (`selectedFilePaths`), luôn kiểm tra file nén bằng `7za t`, không bao giờ ghi file tạm lên thẻ nhớ/ổ rời.

### 2.4. Google Drive API v3 & Báo cáo PDF/TXT
- **OAuth 2.0 + PKCE & Google Picker (`googleDrive/{auth,picker,storage}.ts`)**: Scope `drive.file`, hỗ trợ chọn trình duyệt, không cần người dùng tự cấu hình JSON nếu đã nhúng `build/google-oauth-client.json` (có `picker_api_key` + `project_number`).
- **Resumable Upload (`googleDrive/{folders,upload}.ts`)**: Chunk **32 MB / 64 MB**, **3 luồng upload song song**, cache danh sách file thư mục đích (`listRemoteFilesInFolder`), đối chiếu `md5Checksum`, tự retry backoff khi gặp `403 rateLimit / 429 / 5xx`.
- **Báo cáo (`reportService.ts`)**: Tạo sau khi upload xong, xuất `_00_BACKUP_REPORT.pdf` (qua Chromium `printToPDF`) + `_00_BACKUP_REPORT.txt` và 2 ảnh thumbnail đầu/cuối.

### 2.5. Power Management & Build Đa nền tảng
- **Prevent Sleep**: `powerSaveBlocker.start('prevent-app-suspension')`.
- **Post-Job Action**: Windows Sleep (PowerShell `SetSuspendState`) / Shutdown (`shutdown.exe /s /t 5`); macOS Sleep (`pmset sleepnow` / `osascript`) / Shutdown (`osascript`).
- **CI/CD**: GitHub Actions (`.github/workflows/build.yml`) chạy `typecheck`, `npm test`, nạp secret `GOOGLE_OAUTH_CLIENT_JSON` và đóng gói song song Windows (`.exe` x64) + macOS Apple Silicon (`.dmg` `arm64` trên `macos-15`).

---

## 3. Sơ đồ Mã nguồn

Xem chi tiết cây thư mục và quy tắc IPC tại [`CLAUDE.md`](./CLAUDE.md).

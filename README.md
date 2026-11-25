# FrameBackup — 4-Column Video & Photo Backup Assistant

[![GitHub](https://img.shields.io/badge/GitHub-FrameBackup-181717?logo=github)](https://github.com/quangdung94-coder/FrameBackup)
[![Version v1.4.0](https://img.shields.io/badge/Release-v1.4.0%20(Win%20%2B%20macOS%20arm64)-10b981)](https://github.com/quangdung94-coder/FrameBackup/releases/tag/v1.4.0)

Ứng dụng Desktop đa nền tảng (**Windows x64 & macOS Apple Silicon `arm64`**) quản lý và tự động hóa quy trình sao lưu dữ liệu quay phim/chụp ảnh theo luồng **4 cột liên thông**:

> **`① Thẻ nhớ (Nguồn)` ➔ `② Ổ 1 (Làm việc)` ➔ `③ Ổ 2 (Sao lưu)` ➔ `④ Google Drive (Cloud)`**

---

## Tính năng Cốt lõi (v1.4.0)

1. **Giao diện 4 Cột kiểu Explorer + Nhiều thẻ song song**:
   - Điều hướng đầy đủ (`Lùi / Tiến / Lên`, thanh địa chỉ sổ thư mục con, cây thư mục, menu chuột phải tiếng Anh, quét chọn chuột, `Ctrl+C / Ctrl+V / F2 / F5`).
   - 5 kiểu xem (`Large icons`, `Medium icons`, `Tiles`, `List`, `Details`), thumbnail ảnh/video, cột Duration, nhóm theo Ngày/Loại/Máy quay, lọc máy quay, khung xem trước (Preview pane).
   - Tự nhận thẻ nhớ / ổ cứng khi cắm hoặc rút; hỗ trợ mở nhiều tab thẻ chạy **Song song** hoặc **Xếp hàng** kèm cảnh báo ghi chung HDD và cảnh báo ổ đám mây ảo (OneDrive, Drive, Dropbox, iCloud, Box).
2. **Cảnh báo Lệch ngày (Date Guard) & An toàn Dữ liệu**:
   - Đọc ngày quay/chụp gốc (`EXIF DateTimeOriginal`, `mvhd/QuickTime`, `mtime`) chạy ngầm + cache (`shot-date-cache.json`).
   - Hỗ trợ **Quay xuyên đêm (00:00–04:00)**, **Smart Sidecar XML** (kể cả `.XML` in hoa), chống ghi đè file trùng tên, kiểm tra dung lượng trước khi chép, Verify **XXHash64** (kể cả sau TeraCopy / FastCopy / rsync) và sổ verify (`verify-ledger.json`).
3. **Google Drive API v3 (`drive.file` + Google Picker) — Upload tốc độ cao**:
   - Đăng nhập 1 chạm (OAuth 2.0 + PKCE + chọn trình duyệt), cấp quyền thư mục qua **Google Picker** (không còn màn hình "chưa xác minh").
   - **Resumable Upload 32 MB / 64 MB, 3 luồng song song**, tự đối chiếu **MD5**, tự retry khi rớt mạng/rate-limit.
   - Hỗ trợ **`Ổ 1 ➔ Drive`**, **`Ổ 2 ➔ Drive`** (cả thư mục hoặc chọn/kéo file lẻ) với công tắc **`Có nén | Không nén`** (`7zip-bin` Zip Store / 7z).
4. **Báo cáo PDF/TXT + 2 Thumbnail & Night Mode**:
   - Tự động trích xuất Thumbnail **Shot đầu tiên & Shot cuối cùng**, xuất **`_00_BACKUP_REPORT.pdf`**, **`_00_BACKUP_REPORT.txt`** và 2 ảnh thumbnail ngay đầu thư mục Drive.
   - Giữ máy thức (**Prevent Sleep**) và tự động **Sleep / Shutdown** khi tất cả các thẻ xong an toàn (đếm ngược tùy chỉnh 1–120 phút).

---

## Tài liệu & Lệnh phát triển

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Kiến trúc kỹ thuật chi tiết và tổ chức module.
- [ROADMAP.md](./ROADMAP.md) — Lộ trình triển khai các giai đoạn.
- [CLAUDE.md](./CLAUDE.md) & [AGENTS.md](./AGENTS.md) — Hướng dẫn dành cho AI coding agents.

```bash
npm run dev          # Chạy Vite + Electron dev
npm run typecheck    # Kiểm tra TypeScript (renderer + electron)
npm test             # Chạy bộ unit test (Vitest)
npm run build        # Build production (dist/ + dist-electron/)
npm run dist:win     # Đóng gói Windows .exe
npm run dist:mac     # Đóng gói macOS .dmg (arm64)
```

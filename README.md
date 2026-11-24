# FrameBackup — 4-Column Video & Photo Backup Assistant

[![GitHub](https://img.shields.io/badge/GitHub-FrameBackup-181717?logo=github)](https://github.com/quangdung94-coder/FrameBackup)

Ứng dụng Desktop đa nền tảng (**Windows & macOS**) hỗ trợ quản lý và tự động hóa toàn bộ quy trình sao lưu dữ liệu quay phim/chụp ảnh ban đêm theo luồng **4 cột liên thông**:

> **`① Thẻ nhớ (Nguồn)` ➔ `② Ổ 1 (Làm việc)` ➔ `③ Ổ 2 (Sao lưu)` ➔ `④ Google Drive (Cloud)`**

---

## Tính năng Cốt lõi

1. **Giao diện 4 Cột Trực quan (lấy cảm hứng từ Air Explorer)**:
   - Quản lý đồng thời 4 điểm dữ liệu trên cùng một màn hình Dark Mode dịu mắt.
   - Thanh kiểm tra dung lượng trống theo thời gian thực ở đầu mỗi cột (cảnh báo trước nếu ổ đích không đủ chỗ).
   - Nút **`⤢ Mở rộng`** từng cột và nút **`⏏ Eject`** rút thẻ nhớ an toàn ngay khi bước 1 Verify xong.
2. **Cảnh báo Lệch ngày Cỡ lớn (Date Guard)**:
   - Tự động đọc ngày quay/chụp gốc trong Metadata (`EXIF DateTimeOriginal` cho ảnh, `QuickTime/Media Creation Date` cho video) và `mtime`.
   - Hỗ trợ chế độ **Quay xuyên đêm (00:00–04:00 sáng)**.
   - Khi phát hiện thẻ nhớ có lẫn dữ liệu ngày cũ, bật **Hero Alert Banner viền đỏ** cho phép:
     - `✅ Chỉ chép file đúng ngày mục tiêu` (tự lọc bỏ file cũ, chống chép trùng).
     - `📂 Tách riêng từng thư mục theo ngày`.
     - `Vẫn chép tất cả` hoặc `Dừng kiểm tra`.
3. **Hỗ trợ cả Video lẫn Ảnh RAW số lượng lớn**:
   - **Ổ 1 & Ổ 2**: Luôn giữ nguyên cấu trúc file gốc + kiểm tra toàn vẹn bằng **XXHash64**.
   - **Google Drive**: Hỗ trợ **Resumable Upload** (rớt mạng tự nối tiếp) và chế độ đóng gói linh hoạt:
     - Video: Up nguyên thư mục (không nén).
     - Ảnh RAW/JPG (hàng nghìn file): Tùy chọn **Zip Store (không nén, gom 1 cục)** để tránh giới hạn rate-limit tạo file của Google Drive API.
4. **Báo cáo Thông minh + Thumbnail Shot đầu & Shot cuối (trên Google Drive)**:
   - Tự động trích xuất thời gian và hình ảnh Thumbnail của **Shot đầu tiên** và **Shot cuối cùng** (`ffmpeg` cho Video, `exifr` đọc Embedded JPEG Preview cho cả ảnh RAW).
   - Tự động tạo và upload ngay đầu thư mục Google Drive:
     - **`_00_BACKUP_REPORT.txt`** (tổng số file, dung lượng, Verify Ổ 1 & Ổ 2, Timeline Shot đầu/cuối).
     - **`_01_FIRST_SHOT_<giờ>_<tên>.jpg`** & **`_02_LAST_SHOT_<giờ>_<tên>.jpg`** (2 ảnh thumbnail đầu & cuối show để nhìn lướt trên app Drive điện thoại là nhận ra ngay).
5. **Chế độ Ban đêm (Night Mode)**:
   - Tự động giữ máy thức (**Prevent Sleep**) trong lúc đang chạy chuỗi.
   - Tự động **Sleep** hoặc **Shutdown** máy tính sau khi hoàn tất 100%.

---

## Tài liệu Dự án

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Kiến trúc kỹ thuật chi tiết, luồng dữ liệu và thư viện sử dụng.
- [ROADMAP.md](./ROADMAP.md) — Lộ trình triển khai theo từng giai đoạn (Phase 1 → Phase 5).
- [ui-prototype.html](./ui-prototype.html) — Bản mẫu giao diện tương tác 4 cột (mở trực tiếp bằng trình duyệt).

---

## Công nghệ sử dụng

- **Desktop & UI**: Electron, React, TypeScript, TailwindCSS (build `.exe` cho Windows & `.dmg` cho macOS).
- **File & Verify Engine**: Node.js Worker Threads, `chokidar`, `xxhash-wasm`, `7zip-bin`.
- **Media & Metadata**: `exifr`, `ffmpeg-static`.
- **Cloud & Report**: `googleapis` (Google Drive API v3 - OAuth 2.0 + Resumable Upload + Auto Drive Report & Thumbnails).

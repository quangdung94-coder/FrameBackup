# Lộ trình Triển khai (Project Roadmap)

Trạng thái hiện tại: **Đã test & Phát hành chính thức (`v1.0.5`)** — Đầy đủ bộ cài Windows (`.exe`) & macOS (`.dmg`) kèm logo **FrameBackup (FB)** đồng bộ hệ sinh thái **FramePilot**.

- **Trang tải bộ cài chính thức**: https://github.com/quangdung94-coder/FrameBackup/releases/tag/v1.0.5

---

## Phase 0: Kế hoạch & Thiết kế UX/UI ✅
- [x] Rà soát tính khả thi & giới hạn kỹ thuật (Windows & macOS).
- [x] Đánh giá kênh báo cáo (Telegram, Drive Note, Discord/Email vs Zalo/Messenger).
- [x] Thiết kế bản mẫu tương tác 4 cột (`ui-prototype.html`) với Cảnh báo Lệch ngày cỡ lớn.
- [x] Khởi tạo tài liệu dự án (`README.md`, `ARCHITECTURE.md`, `ROADMAP.md`), Git & Notion Hub.

---

## Phase 1: Khởi tạo Nền tảng Electron + React (Windows & macOS) ✅
- [x] Khởi tạo project **Electron + Vite + React + TypeScript + TailwindCSS**.
- [x] Thiết lập IPC Bridge an toàn (`preload.ts`) và cấu trúc thư mục `electron/`, `src/`.
- [x] Chuyển đổi giao diện từ `ui-prototype.html` thành các React Component hoàn chỉnh (4 cột, nút Mở rộng, Storage Bar, Top Ribbon, Hero Date Mismatch Alert, Report Preview Modal).
- [x] Tích hợp đọc danh sách ổ đĩa & dung lượng trống đa nền tảng (Windows/macOS) + chọn thư mục thật & Prevent Sleep.

---

## Phase 2: Engine Ingest, Date Guard & Backup Ổ 1 ➔ Ổ 2 ✅
- [x] Xây dựng module đọc Metadata ngày quay/chụp (`exifr` cho Ảnh/RAW + bộ đọc `mvhd` atom tốc độ cao cho MP4/MOV).
- [x] Hoàn thiện **Date Guard**: Phát hiện lệch ngày, hỗ trợ Quay xuyên đêm, 3 chế độ xử lý (Lọc đúng ngày / Tách thư mục ngày / Chép tất cả).
- [x] Xây dựng Engine copy tốc độ cao `Thẻ nhớ ➔ Ổ 1` và `Ổ 1 ➔ Ổ 2` kèm Verify **XXHash64** và thanh tiến trình trực tiếp.
- [x] Tích hợp chế độ dự phòng **Watch Mode** (tương thích Explorer / Finder / TeraCopy) & nút **Safe Eject**.

---

## Phase 3: Media Inspector, Thumbnail & Đóng gói ✅
- [x] Tự động tìm **Shot đầu tiên** và **Shot cuối cùng** theo thời gian quay/chụp gốc.
- [x] Xuất 2 ảnh Thumbnail nhẹ (`ffmpeg-static` cho Video, `exifr` Embedded Preview cho Ảnh RAW/JPG) kèm file `_00_BACKUP_REPORT.txt`.
- [x] Tích hợp `7zip-bin` với 4 chế độ: Video lẻ + Ảnh Zip Store / Không nén / Zip Store toàn bộ / Nén 7z.

---

## Phase 4: Google Drive API v3 & Báo cáo Drive ✅
- [x] Tích hợp đăng nhập **Google OAuth 2.0** (Loopback flow + lưu token an toàn trong `userData`, tự refresh token).
- [x] Tách Folder ID từ Link Google Drive, kiểm tra quyền **Editor** tức thì & liệt kê file trực tiếp trên Cột 4.
- [x] Xây dựng **Resumable Upload Engine (16MB Chunk)** chịu lỗi rớt mạng (Auto-Retry + Query Offset nối tiếp).
- [x] Tự động tạo & upload `_00_BACKUP_REPORT.txt` + `_01_FIRST_SHOT_*.jpg` + `_02_LAST_SHOT_*.jpg` ngay đầu thư mục Drive + tự dọn file nén tạm.

---

## Phase 5: Night Mode, Tiện ích & Đóng gói Bộ cài (Windows & macOS) ✅
- [x] Tích hợp **Prevent Sleep** (`powerSaveBlocker`) và tự động **Sleep / Shutdown** cho Windows & macOS kèm **Đếm ngược tùy chỉnh số phút** (1–120 phút, không khóa cứng 60s) có nút Hủy.
- [x] Tự động nhớ cấu hình & đường dẫn Ổ 1 / Ổ 2 riêng trên từng máy (`localStorage`), bổ sung **Lịch sử Backup** (mở nhanh link Drive) và nút **`Chỉ Up từ Ổ 1`**.
- [x] Thiết lập **GitHub Actions** (`.github/workflows/build.yml`) + `electron-builder` đóng gói song song `.exe` (Windows) và `.dmg` (macOS Apple Silicon + Intel) tự động lên GitHub Releases.

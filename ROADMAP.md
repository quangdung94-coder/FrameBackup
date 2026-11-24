# Lộ trình Triển khai (Project Roadmap)

Trạng thái hiện tại: **Đã chốt Kế hoạch & UX/UI v2 (4 cột)** — Chuẩn bị bước vào Phase 1.

---

## Phase 0: Kế hoạch & Thiết kế UX/UI ✅
- [x] Rà soát tính khả thi & giới hạn kỹ thuật (Windows & macOS).
- [x] Đánh giá kênh báo cáo (Telegram, Drive Note, Discord/Email vs Zalo/Messenger).
- [x] Thiết kế bản mẫu tương tác 4 cột (`ui-prototype.html`) với Cảnh báo Lệch ngày cỡ lớn.
- [x] Khởi tạo tài liệu dự án (`README.md`, `ARCHITECTURE.md`, `ROADMAP.md`), Git & Notion Hub.

---

## Phase 1: Khởi tạo Nền tảng Electron + React (Windows & macOS)
- [ ] Khởi tạo project **Electron + Vite + React + TypeScript + TailwindCSS**.
- [ ] Thiết lập IPC Bridge an toàn (`preload.ts`) và cấu trúc thư mục `main/`, `workers/`, `renderer/`.
- [ ] Chuyển đổi giao diện từ `ui-prototype.html` thành các React Component hoàn chỉnh (4 cột, nút Mở rộng, Storage Bar, Top Ribbon).
- [ ] Tích hợp đọc danh sách ổ đĩa & dung lượng trống đa nền tảng (Windows/macOS).

---

## Phase 2: Engine Ingest, Date Guard & Backup Ổ 1 ➔ Ổ 2
- [ ] Xây dựng module đọc Metadata ngày quay/chụp (`exifr` cho Ảnh/RAW + `ffmpeg-static` cho Video).
- [ ] Hoàn thiện **Date Guard**: Phát hiện lệch ngày, hỗ trợ Quay xuyên đêm, 3 chế độ xử lý (Lọc đúng ngày / Tách thư mục ngày / Chép tất cả).
- [ ] Xây dựng Worker copy tốc độ cao `Thẻ nhớ ➔ Ổ 1` và `Ổ 1 ➔ Ổ 2` kèm Verify **XXHash64**.
- [ ] Tích hợp chế độ dự phòng **Watch Mode** (tương thích Explorer / Finder / TeraCopy) & nút **Safe Eject**.

---

## Phase 3: Media Inspector, Thumbnail & Đóng gói
- [ ] Tự động tìm **Shot đầu tiên** và **Shot cuối cùng** theo thời gian quay/chụp gốc.
- [ ] Xuất 2 ảnh Thumbnail nhẹ (`ffmpeg-static` cho Video, `exifr` Embedded Preview cho Ảnh RAW/JPG).
- [ ] Tích hợp `7zip-bin` với 3 chế độ: Không nén / Zip Store (cho Ảnh) / Nén 7z + tự dọn file tạm.

---

## Phase 4: Google Drive API v3 & Hệ thống Báo cáo
- [ ] Tích hợp đăng nhập **Google OAuth 2.0** (lưu token cục bộ an toàn).
- [ ] Tách Folder ID từ Link Google Drive & kiểm tra quyền **Editor** tức thì.
- [ ] Xây dựng **Resumable Upload Engine** (hiển thị tốc độ MB/s, ETA, tự nối tiếp khi rớt mạng).
- [ ] Tự động tạo & upload file `_BACKUP_REPORT.txt` + `_report/` (2 thumbnails) vào thư mục Drive.
- [ ] Tích hợp **Telegram Bot** (gửi báo cáo + 2 ảnh thumbnail) và tùy chọn dự phòng (Discord / Email).

---

## Phase 5: Night Mode, Kiểm thử & Đóng gói Bộ cài
- [ ] Tích hợp **Prevent Sleep** (`powerSaveBlocker`) và tự động **Sleep / Shutdown** cho Windows & macOS.
- [ ] Bổ sung **Hàng đợi nhiều thẻ (Queue)**, **Preset cấu hình** và **Lịch sử Backup (History)**.
- [ ] Kiểm thử thực tế với dữ liệu lớn (Video 50GB+ và Ảnh RAW 3.000+ files, test ngắt mạng giữa chừng).
- [ ] Đóng gói bộ cài `.exe` (Windows) và `.dmg` (macOS) bằng `electron-builder`.

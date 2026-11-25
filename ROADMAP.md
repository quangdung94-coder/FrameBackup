# Lộ trình Triển khai (Project Roadmap)

Trạng thái hiện tại: **Chuẩn bị phát hành `v1.4.0`** — Windows (`.exe` x64) & macOS Apple Silicon (`.dmg` `arm64`).

---

## Phase 0 – Phase 5: Nền tảng & Phát hành v1.0.5 ✅
- [x] Thiết kế & xây dựng ứng dụng Electron + React + TypeScript + TailwindCSS 4 cột.
- [x] Date Guard (EXIF / Video atom / mtime + Quay xuyên đêm), Copy & Verify XXHash64, Watch Mode, Safe Eject.
- [x] Media Inspector (2 Thumbnail đầu/cuối + Báo cáo), đóng gói `7zip-bin`, Google Drive API v3 Resumable Upload.
- [x] Prevent Sleep + Auto Sleep/Shutdown tùy chỉnh 1–120 phút, bộ icon FrameBackup (FB), GitHub Actions CI.

---

## v1.2 – v1.3: Explorer Navigation, Hiệu năng & Nhiều thẻ ✅
- [x] Ảo hóa danh sách (~60fps), mở thẻ tức thì + đọc ngày chụp ngầm (`shot-date-cache.json`).
- [x] Thanh điều hướng Explorer (Lùi/Tiến/Lên, thanh địa chỉ sổ thư mục con, cây thư mục, menu chuột phải, Ctrl+C/Ctrl+V/F2/F5).
- [x] Sổ verify (`verify-ledger.json`), báo cáo 4 ô PDF + TXT, nhiều tab thẻ chạy song song / xếp hàng.

---

## v1.4.0: Google Picker, Kiểu xem Media, Ổ 2 ➔ Drive & Tối ưu Upload ✅
- [x] Google Drive scope `drive.file` + **Google Picker**, tự nhận thẻ cắm/rút (`driveWatcher.ts`), cảnh báo ổ đám mây ảo.
- [x] 5 kiểu xem (Icons / Tiles / List / Details), thumbnail cache, nhóm & lọc theo máy quay, Preview pane.
- [x] Tối ưu Upload Drive **32/64 MB chunk + 3 luồng song song + cache danh sách thư mục**.
- [x] Upload từ **Ổ 2 ➔ Drive** (cả thư mục hoặc chọn/kéo file lẻ, đồng bộ `Có nén | Không nén`, kèm Báo cáo PDF & 2 Thumbnail), nút F5 cột Drive.
- [x] Bộ Unit Test tự động (Vitest) + Build macOS Apple Silicon (`arm64`).

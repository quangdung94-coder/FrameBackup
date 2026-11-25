# CLAUDE.md — FrameBackup

## 1. Tổng quan dự án
- **Tên app:** FrameBackup (`com.quangdung.framebackup`)
- **Mô tả:** 4-Column Video & Photo Backup Assistant for Windows and macOS (Electron + React + Vite + TypeScript + Tailwind CSS).
- **Repo GitHub:** `quangdung94-coder/FrameBackup`
- **Thư mục gốc:** `d:\Antigravity\03_Assitant Video`
- **Ngôn ngữ giao tiếp với user:** Tiếng Việt (ngắn gọn, rõ ràng).

## 2. Quy tắc BẮT BUỘC: Tự động cập nhật Notion
- **Trang Notion quản lý dự án:** `FrameBackup – Kế hoạch & Tiến độ`
- **Page ID:** `42279a3a-9c40-816e-8923-f1229b9716f5`
- **URL:** `https://app.notion.com/p/42279a3a9c40816e8923f1229b9716f5`

**Mỗi khi bắt đầu phiên mới:**
1. Đọc trang Notion trên (đặc biệt mục mới nhất ở cuối trang) để nắm bối cảnh, các thay đổi local chưa push và checklist việc cần làm tiếp.

**Sau mỗi lần hoàn thành công việc (sửa bug, thêm tính năng, build, hoặc push GitHub):**
1. **Tự động cập nhật thẳng lên trang Notion trên** bằng Notion MCP mà không cần user nhắc lại.
2. Ghi rõ:
   - Các thay đổi đã thực hiện & file liên quan
   - Kết quả `typecheck` / `build` / `dist:win` (hoặc `dist:mac`)
   - Trạng thái Git (chỉ commit/push khi user yêu cầu rõ)
   - Việc còn tồn đọng / bước tiếp theo

## 3. Lệnh Build & Kiểm tra
```bash
npm run typecheck    # Kiểm tra TypeScript cho cả renderer và electron
npm run build        # Build Vite renderer + Electron main/preload
npm run dist:win     # Đóng gói installer Windows (.exe) vào release/ (không publish)
npm run dist:mac     # Đóng gói macOS (.dmg) vào release/ (không publish)
```

## 4. Kiến trúc chính
- `src/App.tsx`: Điều phối state & chuỗi sao lưu (pipeline Thẻ ➔ Ổ 1 ➔ Ổ 2 ➔ Drive). Giao diện tách ra:
  - `src/components/columns/`: `CardColumn` (1. Thẻ nhớ), `Drive1Column` (2. Ổ 1), `Drive2Column` (3. Ổ 2), `GoogleDriveColumn` (4. Drive).
  - `src/components/layout/`: `TopStatusBar`, `RibbonToolbar`, `ColumnParts` (header, thanh đường dẫn, footer, drop overlay...), `Splitters`.
  - `src/hooks/`: `useColumnLayout` (co giãn cột), `useRowSelection` (chọn nhiều kiểu Explorer/Finder), `useDropZone`, `useActivityLog` (toast + Live Log), `useLatestRef`.
  - `src/lib/`: `storage` (localStorage + STORAGE_KEYS), `cardAnalysis` (Date Guard, lọc đuôi), `uploadPlan` (danh sách file up Drive), `dragData`, `paths`, `time`, `demo`.
- `electron/shared/`: **Hợp đồng IPC dùng chung main + renderer** (`types.ts`, `ipcChannels.ts`, `format.ts`, `dates.ts`, `paths.ts`, `driveLink.ts`, `constants.ts`). Chỉ chứa type & hàm thuần (không Node/DOM). `src/types/framebackup.ts` chỉ re-export từ đây — thêm/đổi type IPC thì sửa ở `electron/shared/types.ts`.
- `electron/main.ts` (cửa sổ, single-instance) + `electron/ipc/*` (đăng ký IPC theo nhóm: system, disk, pipeline, drive) + `electron/preload.ts` (bridge có kiểu `FrameBackupBridge`).
- `electron/lib/`: tiện ích dùng chung phía main — `process` (spawn có hủy), `jobSlot` (1 job có thể hủy), `hash` (XXHash64), `tempFiles`, `exec`, `binaries` (asar.unpacked), `progress`, `errors`, `abort`.
- `electron/services/`: copyVerify (Built-in XXHash64, Date Guard, Smart Resume), copyEngine (TeraCopy/Robocopy/FastCopy/rsync/ditto), disk, metadata, mediaInspector, packaging (7za), watch, eject, power; `googleDrive/` (storage, auth, folders, upload) với `googleDriveService.ts` là barrel.
- `build/`: Icon app (`icon.ico`, `icon.png`).

## 5. Lưu ý quan trọng
- **Không tự ý `git push`** nếu user đang test bản build local và chưa yêu cầu đẩy lên GitHub.
- Khi sửa `src/` hoặc `electron/`, luôn chạy `npm run typecheck` và `npm run build` để xác nhận không lỗi trước khi báo xong.

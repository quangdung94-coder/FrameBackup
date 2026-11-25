# CLAUDE.md — FrameBackup

## 1. Dự án
- **App:** FrameBackup (`com.quangdung.framebackup`) — 4-Column Video & Photo Backup Assistant (Windows `.exe` & macOS `.dmg`).
- **Stack:** Electron 33 + React 18 + Vite 6 + TypeScript + Tailwind CSS (`xxhash-wasm`, `7zip-bin`, `exifr`, `ffmpeg-static`, `googleapis`, `chokidar`).
- **Repo:** `quangdung94-coder/FrameBackup` | **Local:** `d:\Antigravity\03_Assitant Video`
- **Ngôn ngữ giao tiếp:** Tiếng Việt (ngắn gọn, rõ ràng).

## 2. Quy tắc BẮT BUỘC: Notion Hub
- **Page:** `FrameBackup – Kế hoạch & Tiến độ` — ID: `42279a3a-9c40-816e-8923-f1229b9716f5`
- **Đầu phiên:** Đọc cuối trang Notion trên để nắm thay đổi mới nhất và trạng thái Git.
- **Cuối mỗi việc (fix bug / tính năng / refactor / build / push):** Tự động append mục mới lên trang Notion gồm: thay đổi & file đã sửa, kết quả `typecheck` / `build` / `dist:*`, trạng thái Git, việc tiếp theo.

## 3. Lệnh kiểm tra & build
```bash
npm run dev          # Chạy Vite + Electron dev (scripts/dev.cjs, tự tìm port)
npm run typecheck    # tsc --noEmit (renderer + electron)
npm run build        # Build renderer + electron
npm run dist:win     # Đóng gói Windows .exe (release/, --publish never)
npm run dist:mac     # Đóng gói macOS .dmg (release/, --publish never)
```

## 4. Kiến trúc hiện tại (v1.4+)
- `electron/shared/`: Hợp đồng IPC dùng chung main + renderer (`types.ts`, `ipcChannels.ts`, `format.ts`, `dates.ts`, `paths.ts`, `driveLink.ts`, `cloudStorage.ts`, `report.ts`, `constants.ts`). `src/types/framebackup.ts` chỉ re-export từ đây.
- `electron/main.ts` + `electron/preload.ts` + `electron/ipc/{index,context,powerSave,systemIpc,diskIpc,pipelineIpc,driveIpc}.ts`.
- `electron/lib/`: `abort`, `binaries`, `errors`, `exec`, `hash`, `jobSlot` (`createJobPool`), `process`, `progress`, `tempFiles`.
- `electron/services/`:
  - Copy & Watch: `copyVerifyService`, `copyEngineService`, `watchService`, `verifyLedger`
  - Disk & Explorer: `diskService`, `driveWatcher`, `fileOpsService`, `ejectService`, `shotDateCache`, `metadataService`
  - Media & Report: `mediaInfoService`, `mediaInspectorService`, `packagingService`, `reportService`
  - Drive & System: `googleDrive/{storage,auth,picker,folders,upload}.ts` (barrel `googleDriveService.ts`), `browserService`, `powerService`.
- `src/`:
  - `App.tsx`: State chung, nhiều tab thẻ, hàng đợi song song/xếp hàng, modal toàn cục.
  - `workspace/`: `CardWorkspace.tsx` (1 tab thẻ 4 cột), `driveUploadFlow.ts` (luồng đóng gói + upload + báo cáo dùng chung), `shared.ts`.
  - `components/columns/`: `CardColumn`, `DriveColumn` (dùng chung cho Ổ 1 & Ổ 2), `GoogleDriveColumn`.
  - `components/files/`: `FilePaneView`, `GridCell`, `FolderTree`, `NavToolbar`, `PreviewPane`, `FileDialogs`.
  - `components/layout/`: `TopStatusBar`, `RibbonToolbar`, `CardTabs`, `ColumnParts`, `Splitters`, `ContextMenu`, `NotificationTray`, `tones`.
  - `hooks/`: `useFilePane`, `useExplorerList`, `useRowSelection`, `useFolderNav`, `useColumnLayout`, `useDropZone`, `useActivityLog`, `useSpecialFolders`, `useTreePref`, `useLatestRef`.
  - `lib/`: `storage`, `cardAnalysis`, `uploadPlan`, `dragData`, `fileMenu`, `globalMenu`, `mediaStore`, `paneLayout`, `paths`, `progressStore`, `sidecar`, `time`, `viewMenu`, `demo`.

## 5. Lưu ý an toàn
- **Không tự ý `git push`** khi user chưa yêu cầu.
- **Không bao giờ commit** `build/google-oauth-client.json`, `credentials.json`, API key hay token.
- Luôn chạy `npm run typecheck` và `npm run build` sau khi sửa `src/` hoặc `electron/`.
- Trên Windows PowerShell 5.1 không dùng `&&`; dùng `npm run typecheck; if ($LASTEXITCODE -eq 0) { npm run build }`.

# AGENTS.md — FrameBackup

Hướng dẫn chung cho mọi AI coding agent (Antigravity, Claude Code, Codex, Cursor) làm việc trên repo này.

- Chi tiết kiến trúc, lệnh build, và quy tắc cập nhật Notion nằm tại [`CLAUDE.md`](./CLAUDE.md) (đọc 1 lần đầu phiên để tránh trùng lặp).
- **Nguyên tắc cốt lõi:**
  1. **An toàn dữ liệu là ưu tiên số 1:** Không ghi lên thẻ nhớ nguồn; không tự xóa file người dùng; giữ nguyên verify XXHash64 (ổ cứng) và MD5 (Google Drive).
  2. **Một nguồn sự thật cho IPC:** Mọi type IPC khai báo ở `electron/shared/types.ts` và kênh ở `electron/shared/ipcChannels.ts`.
  3. **Kiểm tra trước khi báo xong:** Luôn chạy `npm run typecheck` và `npm run build` pass (exit code `0`).
  4. **Không tự ý `git push`** và tuyệt đối không commit `build/google-oauth-client.json` hoặc secret.
  5. **Cập nhật tiến độ lên Notion** (`42279a3a-9c40-816e-8923-f1229b9716f5`) sau khi hoàn thành mỗi hạng mục.

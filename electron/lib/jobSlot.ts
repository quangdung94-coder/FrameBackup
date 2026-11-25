/**
 * Quản lý job có thể hủy (copy, đóng gói, upload Drive), theo `jobId`.
 * Mỗi khu vực thẻ (tab) có jobId riêng nên nhiều thẻ chạy song song được.
 * Bắt đầu job mới với CÙNG jobId sẽ hủy job cũ của jobId đó (giữ hành vi cũ khi chỉ có 1 thẻ).
 */
export const DEFAULT_JOB_ID = 'main';

export interface JobPool {
  /** Hủy job cũ cùng jobId (nếu có) rồi tạo AbortController mới. */
  begin(jobId?: string): AbortController;
  /** Đánh dấu job đã kết thúc (chỉ xoá nếu đúng controller đó). */
  release(jobId?: string, controller?: AbortController): void;
  /** Hủy 1 job (có jobId) hoặc tất cả (không truyền). Trả về true nếu có job bị hủy. */
  cancel(jobId?: string): boolean;
}

export function createJobPool(): JobPool {
  const active = new Map<string, AbortController>();
  return {
    begin(jobId = DEFAULT_JOB_ID) {
      active.get(jobId)?.abort();
      const controller = new AbortController();
      active.set(jobId, controller);
      return controller;
    },
    release(jobId = DEFAULT_JOB_ID, controller) {
      if (!controller || active.get(jobId) === controller) active.delete(jobId);
    },
    cancel(jobId) {
      if (jobId === undefined) {
        const had = active.size > 0;
        for (const c of active.values()) c.abort();
        active.clear();
        return had;
      }
      const c = active.get(jobId);
      if (!c) return false;
      c.abort();
      active.delete(jobId);
      return true;
    },
  };
}

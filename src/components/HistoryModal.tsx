import { ExternalLink, History, Trash2, X } from 'lucide-react';
import { formatBytes, formatShortDate, type BackupHistoryItem } from '../types/framebackup';

interface HistoryModalProps {
  open: boolean;
  onClose: () => void;
  items: BackupHistoryItem[];
  onClearHistory: () => void;
}

export function HistoryModal({ open, onClose, items, onClearHistory }: HistoryModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#1e1e24] border border-[#3e3e4b] rounded-xl w-[860px] max-w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="px-4 py-3 border-b border-[#2b2b34] flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-sm text-zinc-100">
            <History className="w-4 h-4 text-blue-400" />
            Lịch sử Sao lưu & Link Google Drive ({items.length} show)
          </div>
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <button
                onClick={onClearHistory}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-600/15 hover:bg-red-600/30 border border-red-500/40 text-red-300 text-xs"
              >
                <Trash2 className="w-3.5 h-3.5" /> Xóa lịch sử
              </button>
            )}
            <button
              onClick={onClose}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#272730] hover:bg-[#32323e] text-zinc-300 text-xs"
            >
              <X className="w-3.5 h-3.5" /> Đóng
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {items.length === 0 ? (
            <div className="py-12 text-center text-zinc-500 text-xs">
              Chưa có lịch sử sao lưu nào trên máy này. Khi chạy xong một show, lịch sử và link Drive sẽ tự lưu tại đây.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#16161b] text-zinc-400">
                <tr>
                  <th className="py-2 px-3 font-semibold">Thời gian</th>
                  <th className="py-2 px-3 font-semibold">Tên Show</th>
                  <th className="py-2 px-3 font-semibold">Dung lượng</th>
                  <th className="py-2 px-3 font-semibold">Ổ 2</th>
                  <th className="py-2 px-3 font-semibold">Google Drive</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-white/[0.04] hover:bg-[#262630]">
                    <td className="py-2 px-3 text-zinc-400 whitespace-nowrap">{formatShortDate(item.completedAt)}</td>
                    <td className="py-2 px-3 font-semibold text-zinc-100">{item.projectName}</td>
                    <td className="py-2 px-3 text-zinc-300 whitespace-nowrap">
                      {item.totalFiles} files • {formatBytes(item.totalBytes)}
                    </td>
                    <td className="py-2 px-3">
                      {item.drive2BackedUp ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[11px] font-semibold">
                          ✓ OK
                        </span>
                      ) : (
                        <span className="text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {item.driveUploaded && item.driveWebLink ? (
                        <button
                          onClick={() => window.frameBackup?.openExternalUrl(item.driveWebLink!)}
                          className="inline-flex items-center gap-1 text-purple-300 hover:text-purple-200 hover:underline font-medium"
                        >
                          Mở Link Drive <ExternalLink className="w-3 h-3" />
                        </button>
                      ) : (
                        <span className="text-zinc-500">Chưa up</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

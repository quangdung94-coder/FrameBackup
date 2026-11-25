import { AlertTriangle } from 'lucide-react';
import { formatBytes, type ConflictPolicy, type CopyPreflightResult } from '../types/framebackup';

export interface ConflictPrompt {
  /** "Thẻ nhớ ➔ Ổ 1" / "Ổ 1 ➔ Ổ 2" */
  routeLabel: string;
  preflight: CopyPreflightResult;
}

interface ConflictModalProps {
  prompt: ConflictPrompt | null;
  /** null = Hủy lượt chép. */
  onChoose: (policy: ConflictPolicy | null) => void;
}

const MAX_LISTED = 8;

/** Hỏi cách xử lý khi ở đích đã có file trùng tên nhưng khác nội dung (giống hộp thoại Replace/Skip của Windows). */
export function ConflictModal({ prompt, onChoose }: ConflictModalProps) {
  if (!prompt) return null;
  const { preflight } = prompt;
  const differing = preflight.conflicts.filter((c) => !c.sameSize);
  const listed = differing.slice(0, MAX_LISTED);

  return (
    <div className="fixed inset-0 z-[90] bg-black/65 flex items-center justify-center p-4" onMouseDown={() => onChoose(null)}>
      <div
        role="dialog"
        aria-label="File trùng tên ở đích"
        className="w-full max-w-lg rounded-lg bg-[#1d1d23] border border-amber-500/50 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-[#2e2e38] flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
          <div>
            <div className="text-sm font-bold text-zinc-100">
              Đích đã có {differing.length} file trùng tên nhưng khác nội dung
            </div>
            <div className="text-[11px] text-zinc-400">{prompt.routeLabel} • File giống hệt sẽ tự Resume (so XXHash64)</div>
          </div>
        </div>

        <div className="px-4 py-2 max-h-52 overflow-auto text-[11.5px]">
          <table className="w-full">
            <thead className="text-zinc-500 text-[10.5px]">
              <tr>
                <th className="text-left font-semibold py-1">Tên file</th>
                <th className="text-right font-semibold py-1">Nguồn</th>
                <th className="text-right font-semibold py-1">Đang có ở đích</th>
              </tr>
            </thead>
            <tbody>
              {listed.map((c) => (
                <tr key={c.destPath} className="border-t border-white/[0.04]">
                  <td className="py-1 pr-2 truncate max-w-[220px] text-zinc-200" title={c.destPath}>
                    {c.name}
                  </td>
                  <td className="py-1 text-right text-zinc-400 whitespace-nowrap">{formatBytes(c.sourceBytes)}</td>
                  <td className="py-1 text-right text-amber-300 whitespace-nowrap">{formatBytes(c.destBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {differing.length > MAX_LISTED && (
            <div className="text-[11px] text-zinc-500 pt-1">... và {differing.length - MAX_LISTED} file khác</div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[#2e2e38] grid gap-2">
          <button
            autoFocus
            onClick={() => onChoose('keep-both')}
            className="w-full text-left px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-[12px]"
          >
            <strong>Giữ cả hai</strong> (khuyên dùng) — file mới đặt tên &ldquo;tên (2)&rdquo;, không mất file nào
          </button>
          <button
            onClick={() => onChoose('skip')}
            className="w-full text-left px-3 py-2 rounded bg-[#2a2a32] hover:bg-[#34343e] text-zinc-200 text-[12px]"
          >
            <strong>Bỏ qua</strong> — giữ nguyên file đang có ở đích, không chép các file trùng này
          </button>
          <button
            onClick={() => onChoose('overwrite')}
            className="w-full text-left px-3 py-2 rounded bg-red-900/40 hover:bg-red-800/50 border border-red-700/50 text-red-200 text-[12px]"
          >
            <strong>Thay thế</strong> — ghi đè file ở đích bằng file nguồn (file cũ ở đích sẽ mất)
          </button>
          <button onClick={() => onChoose(null)} className="justify-self-end px-3 py-1 text-[11.5px] text-zinc-400 hover:text-zinc-200">
            Hủy lượt chép
          </button>
        </div>
      </div>
    </div>
  );
}

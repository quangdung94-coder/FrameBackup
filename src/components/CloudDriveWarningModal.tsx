import { AlertTriangle } from 'lucide-react';
import type { CloudStorageHit } from '../types/framebackup';

export interface CloudWarning {
  column: 'Ổ 1' | 'Ổ 2';
  path: string;
  hit: CloudStorageHit;
}

interface Props {
  warning: CloudWarning | null;
  onAccept: () => void;
  onChooseOther: () => void;
}

/** v1.4 mục 5: cảnh báo to giữa màn hình khi Ổ 1 / Ổ 2 là ổ ảo / thư mục đồng bộ đám mây. */
export function CloudDriveWarningModal({ warning, onAccept, onChooseOther }: Props) {
  if (!warning) return null;
  const { column, path, hit } = warning;
  return (
    <div className="fixed inset-0 z-[120] bg-black/80 flex items-center justify-center p-6" role="alertdialog" aria-modal="true">
      <div className="bg-[#1e1e24] border-2 border-amber-500/80 rounded-2xl w-[720px] max-w-full p-8 shadow-2xl space-y-5">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 shrink-0 rounded-2xl bg-amber-500/20 border border-amber-500/60 flex items-center justify-center text-amber-400">
            <AlertTriangle className="w-9 h-9" />
          </div>
          <div>
            <h2 className="text-2xl font-extrabold text-amber-300 leading-tight">
              {column} đang là ổ ảo {hit.provider}
            </h2>
            <p className="text-base text-zinc-400 mt-1 font-mono break-all">{path}</p>
          </div>
        </div>

        <ul className="text-lg text-zinc-100 leading-relaxed space-y-3 list-disc pl-6">
          <li>
            File chép vào đây <b>chưa nằm trên ổ cứng thật</b>. App kiểm tra (verify) bản tạm trên máy, chưa chắc bản trên
            mây đã lên đủ.
          </li>
          <li>
            Dữ liệu tạm chiếm chỗ <b>ổ C:</b> (hoặc ổ hệ thống) cho tới khi đồng bộ xong. Thẻ lớn có thể làm <b>đầy ổ C:</b>.
          </li>
          <li>
            Mất mạng hoặc tắt máy sớm thì file có thể <b>chưa lên mây</b>, dù app báo xong.
          </li>
          <li>Tốc độ chép và verify thường chậm hơn ổ cứng gắn ngoài.</li>
        </ul>

        <p className="text-lg text-emerald-300 font-semibold">
          Khuyên dùng: Ổ 1 và Ổ 2 là ổ cứng thật (SSD / HDD). Muốn có bản trên mây thì dùng cột 4 (Google Drive).
        </p>

        <div className="flex gap-3 justify-end pt-2">
          <button
            onClick={onChooseOther}
            className="px-5 py-3 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-base font-semibold text-zinc-100"
          >
            Chọn ổ khác
          </button>
          <button
            onClick={onAccept}
            className="px-5 py-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-base font-bold text-black"
          >
            Tôi hiểu, vẫn dùng
          </button>
        </div>
      </div>
    </div>
  );
}

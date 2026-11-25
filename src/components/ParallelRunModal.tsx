import { Layers, ListOrdered, X } from 'lucide-react';
import { useState } from 'react';

export type ParallelChoice = 'parallel' | 'queue' | 'cancel';

export interface ParallelPrompt {
  tabLabel: string;
  /** Tên các thẻ đang chạy / đang chờ. */
  others: string[];
  /** Ổ đích dùng chung (vd. "J:"), rỗng nếu không rõ. */
  sharedDrive: string;
  resolve: (choice: ParallelChoice, remember: boolean) => void;
}

/** v1.4: hỏi khi bấm chạy thêm 1 thẻ lúc thẻ khác còn chạy (giống TeraCopy hỏi khi có luồng thứ hai). */
export function ParallelRunModal({ prompt }: { prompt: ParallelPrompt | null }) {
  const [remember, setRemember] = useState(false);
  if (!prompt) return null;
  const done = (c: ParallelChoice) => prompt.resolve(c, remember && c !== 'cancel');
  return (
    <div className="fixed inset-0 z-[115] bg-black/75 flex items-center justify-center p-5" role="alertdialog" aria-modal="true">
      <div className="bg-[#1e1e24] border border-[#3e3e4b] rounded-2xl w-[640px] max-w-full p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-zinc-100">Đang có thẻ khác chạy</h2>
            <p className="text-sm text-zinc-400 mt-1">
              Anh vừa bấm chạy <b className="text-zinc-200">{prompt.tabLabel}</b>, trong khi{' '}
              <b className="text-zinc-200">{prompt.others.join(', ')}</b> còn đang chạy.
            </p>
          </div>
          <button onClick={() => done('cancel')} className="text-zinc-500 hover:text-zinc-200" title="Hủy">
            <X className="w-5 h-5" />
          </button>
        </div>

        {prompt.sharedDrive && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/40 text-amber-100 text-sm px-3 py-2">
            ⚠ Các thẻ cùng ghi vào ổ <b>{prompt.sharedDrive}</b>. Nếu đây là ổ HDD, ghi hai luồng cùng lúc thường{' '}
            <b>chậm hơn</b> chạy lần lượt. Ổ SSD / NVMe thì chạy song song vẫn tốt.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => done('parallel')}
            className="text-left p-3 rounded-xl bg-blue-600/20 hover:bg-blue-600/35 border border-blue-400/60 space-y-1"
          >
            <div className="flex items-center gap-2 font-bold text-blue-100">
              <Layers className="w-5 h-5" /> Chạy song song
            </div>
            <div className="text-xs text-zinc-300">Chạy ngay cùng lúc, hai thẻ cùng chép. Xong sớm hơn nếu ổ đích đủ nhanh.</div>
          </button>
          <button
            onClick={() => done('queue')}
            className="text-left p-3 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-400/60 space-y-1"
          >
            <div className="flex items-center gap-2 font-bold text-emerald-100">
              <ListOrdered className="w-5 h-5" /> Xếp hàng chờ
            </div>
            <div className="text-xs text-zinc-300">Chờ thẻ đang chạy xong rồi tự chạy. Ổn định, dễ theo dõi từng thẻ.</div>
          </button>
        </div>

        <div className="flex items-center justify-between pt-1">
          <label className="inline-flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-blue-500" />
            Nhớ lựa chọn này (không hỏi nữa)
          </label>
          <button onClick={() => done('cancel')} className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm font-semibold text-zinc-100">
            Hủy, không chạy thẻ này
          </button>
        </div>
        <p className="text-[11px] text-zinc-500">Đổi lại sau này ở ô "Nhiều thẻ" trên thanh tab thẻ (Hỏi tôi / Luôn song song / Luôn xếp hàng).</p>
      </div>
    </div>
  );
}

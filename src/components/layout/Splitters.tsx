import { ArrowRight } from 'lucide-react';

const COPY_TONE = {
  blue: {
    rail: 'group-hover:bg-blue-500/60',
    button: 'bg-blue-600 hover:bg-blue-500 shadow-blue-950/60',
  },
  emerald: {
    rail: 'group-hover:bg-emerald-500/60',
    button: 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-950/60',
  },
  purple: {
    rail: 'group-hover:bg-purple-500/60',
    button: 'bg-purple-600 hover:bg-purple-500 shadow-purple-950/60',
  },
} as const;

interface CopyArrowSplitterProps {
  tone: keyof typeof COPY_TONE;
  title: string;
  buttonTitle: string;
  /** Chữ dọc trên nút, vd. "Chép sang Ổ 1". */
  label: string;
  /** Dòng số lượng, vd. "128 file +12 XML". */
  detail?: string;
  /** Dòng phụ, vd. dung lượng. */
  sub?: string;
  disabled: boolean;
  onResizeStart: (e: React.MouseEvent) => void;
  onReset: () => void;
  onCopy: () => void;
}

/** Thanh kéo đổi độ rộng giữa 2 cột, kèm nút dọc lớn "Chép sang ..." (số file + dung lượng). */
export function CopyArrowSplitter({ tone, title, buttonTitle, label, detail, sub, disabled, onResizeStart, onReset, onCopy }: CopyArrowSplitterProps) {
  const c = COPY_TONE[tone];
  const rail = <div className={`w-1 flex-1 max-h-24 min-h-3 rounded-full bg-[#2e2e38] ${c.rail} transition`} />;
  return (
    <div
      onMouseDown={onResizeStart}
      onDoubleClick={onReset}
      title={title}
      className="w-11 cursor-col-resize flex flex-col items-center justify-center gap-2 shrink-0 group select-none py-2"
    >
      {rail}
      <button
        type="button"
        disabled={disabled}
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={onCopy}
        title={buttonTitle}
        data-copy-button={tone}
        className={`w-9 py-2.5 rounded-lg ${c.button} disabled:opacity-35 disabled:cursor-not-allowed text-white flex flex-col items-center gap-2 shadow-lg cursor-pointer transition`}
      >
        <ArrowRight className="w-4 h-4 shrink-0" />
        <span className="[writing-mode:vertical-rl] rotate-180 text-[11.5px] font-bold whitespace-nowrap tracking-wide">{label}</span>
        {detail && (
          <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] font-semibold whitespace-nowrap text-white/85">{detail}</span>
        )}
        {sub && <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] whitespace-nowrap text-white/70 max-h-28 truncate">{sub}</span>}
      </button>
      {rail}
    </div>
  );
}

/** Thanh kéo lên/xuống đổi chiều cao khung tiến trình & Live Log. */
export function BottomPanelSplitter({ onResizeStart, onReset }: { onResizeStart: (e: React.MouseEvent) => void; onReset: () => void }) {
  return (
    <div
      onMouseDown={onResizeStart}
      onDoubleClick={onReset}
      title="Kéo lên/xuống để chỉnh độ cao khung tiến trình & Live Log • Double-click để mặc định"
      className="h-2.5 bg-[#121215] border-t border-[#2b2b34] cursor-row-resize flex items-center justify-center shrink-0 group select-none hover:bg-blue-500/15 transition"
    >
      <div className="w-16 h-1 rounded-full bg-[#3e3e4b] group-hover:bg-blue-400 transition" />
    </div>
  );
}

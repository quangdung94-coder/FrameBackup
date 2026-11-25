import type { ReactNode } from 'react';
import { ArrowRight, ArrowUp, FolderOpen, Maximize2, Minimize2, type LucideIcon } from 'lucide-react';
import { TONE_BADGE, TONE_BAR, type ColumnTone } from './tones';

/** Nút phóng to / thu đều cột. */
export function ExpandButton({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="p-1 rounded bg-[#23232a] hover:bg-[#2e2e38] text-zinc-400 hover:text-white"
      title="Phóng to / Thu đều cột"
    >
      {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
    </button>
  );
}

interface ColumnHeaderProps {
  index: 1 | 2 | 3 | 4;
  title: string;
  tone: ColumnTone;
  expanded: boolean;
  onToggleExpand: () => void;
  /** Nút phụ bên trái nút phóng to (Eject, Kết nối Drive...). */
  actions?: ReactNode;
  /** Dòng thứ 2: dung lượng ổ / tài khoản Drive. */
  children?: ReactNode;
}

/** Tiêu đề cột: số thứ tự + tên + nút phụ + nút phóng to, kèm dòng thông tin bên dưới. */
export function ColumnHeader({ index, title, tone, expanded, onToggleExpand, actions, children }: ColumnHeaderProps) {
  const expandBtn = <ExpandButton expanded={expanded} onClick={onToggleExpand} />;
  return (
    <div className="p-2 bg-[#141418] border-b border-[#2b2b34] space-y-1.5">
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 font-bold text-xs">
          <span className={`w-5 h-5 rounded ${TONE_BADGE[tone]} flex items-center justify-center text-[11px]`}>
            {index}
          </span>
          <span>{title}</span>
        </div>
        {actions ? (
          <div className="flex items-center gap-1">
            {actions}
            {expandBtn}
          </div>
        ) : (
          expandBtn
        )}
      </div>
      {children}
    </div>
  );
}

/** Dòng "nhãn ổ • Trống xx" + thanh % đã dùng. */
export function DriveUsageRow({
  text,
  usedPercent,
  tone,
  insufficient = false,
}: {
  text: string;
  usedPercent: number;
  tone: ColumnTone;
  insufficient?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-[10.5px]">
      <span className={insufficient ? 'text-red-400 font-bold' : 'text-zinc-400 truncate'}>{text}</span>
      <div className="flex-1 h-1 bg-[#272730] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${insufficient ? 'bg-red-500' : TONE_BAR[tone]}`}
          style={{ width: `${usedPercent}%` }}
        />
      </div>
    </div>
  );
}

/** Thanh điều hướng đường dẫn (nút lên thư mục cha + ô đường dẫn + nút chọn thư mục). */
export function NavBar({ children }: { children: ReactNode }) {
  return <div className="p-1.5 bg-[#1b1b20] border-b border-[#2b2b34] flex items-center gap-1">{children}</div>;
}

export function UpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-1.5 py-1 rounded bg-[#23232a] hover:bg-[#32323c] border border-[#3e3e4b] text-zinc-300 shrink-0"
      title="Lên thư mục cha"
    >
      <ArrowUp className="w-3.5 h-3.5" />
    </button>
  );
}

export function PickFolderButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-1 rounded bg-[#23232a] hover:bg-[#32323c] border border-[#3e3e4b] text-[11px] text-zinc-200 shrink-0"
    >
      <FolderOpen className="w-3.5 h-3.5" />
    </button>
  );
}

interface PathInputBarProps {
  path: string;
  parentPath: string | null;
  placeholder: string;
  onPathChange: (value: string) => void;
  /** Đọc lại thư mục (blur / Enter). */
  onCommit: () => void;
  onGoUp: (parent: string) => void;
  onPickFolder: () => void;
}

/** Ô nhập đường dẫn Ổ 1 / Ổ 2. */
export function PathInputBar({ path, parentPath, placeholder, onPathChange, onCommit, onGoUp, onPickFolder }: PathInputBarProps) {
  return (
    <NavBar>
      {parentPath && <UpButton onClick={() => onGoUp(parentPath)} />}
      <input
        type="text"
        value={path}
        onChange={(e) => onPathChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit();
        }}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-[#101013] border border-[#2b2b34] rounded px-2 py-1 text-[11px] text-zinc-100 outline-none"
      />
      <PickFolderButton onClick={onPickFolder} />
    </NavBar>
  );
}

/** Dải thông tin nhỏ dưới thanh đường dẫn. */
export function InfoStrip({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 py-1 bg-[#1b1b20] border-b border-[#2b2b34] flex items-center justify-between text-[10.5px] text-zinc-400">
      {children}
    </div>
  );
}

/** Chân cột: số mục / đã chọn / tổng dung lượng. */
export function ColumnFooter({ children, alignCenter = false }: { children: ReactNode; alignCenter?: boolean }) {
  return (
    <div
      className={`px-2.5 py-1.5 bg-[#141418] border-t border-[#2b2b34] flex justify-between ${
        alignCenter ? 'items-center ' : ''
      }text-[11px] text-zinc-400`}
    >
      {children}
    </div>
  );
}

/** Màn hình trống trong cột. */
export function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: ReactNode }) {
  return (
    <div
      className={`h-full flex flex-col items-center justify-center text-center p-4 text-zinc-500 ${hint ? 'gap-2' : 'gap-1.5'}`}
    >
      <Icon className="w-7 h-7 text-zinc-600" />
      <div className="text-xs">{title}</div>
      {hint && <div className="text-[11px] text-zinc-600">{hint}</div>}
    </div>
  );
}

const DROP_OVERLAY: Record<'blue' | 'emerald', { bg: string; icon: string; sub: string }> = {
  blue: { bg: 'bg-blue-950/80', icon: 'text-blue-300', sub: 'text-blue-200' },
  emerald: { bg: 'bg-emerald-950/80', icon: 'text-emerald-300', sub: 'text-emerald-200' },
};

/** Lớp phủ khi đang kéo file vào cột. */
export function DropOverlay({ tone, title }: { tone: 'blue' | 'emerald'; title: string }) {
  const c = DROP_OVERLAY[tone];
  return (
    <div
      className={`absolute inset-0 z-20 ${c.bg} backdrop-blur-[1px] flex flex-col items-center justify-center text-center p-4 pointer-events-none`}
    >
      <ArrowRight className={`w-10 h-10 ${c.icon} mb-2 animate-bounce`} />
      <div className="text-sm font-bold text-white">{title}</div>
      <div className={`text-xs ${c.sub} mt-1`}>Tự động Verify XXHash64</div>
    </div>
  );
}

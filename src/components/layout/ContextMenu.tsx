import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface ContextMenuItem {
  label: string;
  /** Gợi ý phím tắt hiển thị bên phải (vd. "Ctrl+A"). */
  hint?: string;
  disabled?: boolean;
  /** Đường kẻ phân cách phía trên mục này. */
  separatorBefore?: boolean;
  /** Dấu ✓ (mục chọn kiểu xem...). */
  checked?: boolean;
  /** Tiêu đề nhóm (không bấm được). */
  heading?: boolean;
  onSelect: () => void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/** Menu chuột phải kiểu Explorer: đóng khi click ra ngoài, Esc, cuộn hoặc đổi kích thước cửa sổ. */
export function ContextMenu({ menu, onClose }: { menu: ContextMenuState | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Giữ menu trong màn hình (như Explorer lật menu lên/trái khi sát mép)
  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPos(null);
      return;
    }
    const { width, height } = ref.current.getBoundingClientRect();
    const left = Math.max(4, Math.min(menu.x, window.innerWidth - width - 4));
    const top = menu.y + height > window.innerHeight - 4 ? Math.max(4, menu.y - height) : menu.y;
    setPos({ left, top });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    document.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
      document.removeEventListener('scroll', onClose, true);
    };
  }, [menu, onClose]);

  if (!menu) return null;
  const hasChecks = menu.items.some((i) => i.checked !== undefined);
  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}
      className="fixed z-[100] min-w-[220px] py-1 rounded-md bg-[#232329] border border-[#3a3a46] shadow-2xl shadow-black/60 text-[12px] text-zinc-200"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {menu.items.map((item, i) => (
        <div key={`${item.label}-${i}`}>
          {item.separatorBefore && <div className="my-1 border-t border-[#3a3a46]" />}
          {item.heading ? (
            <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{item.label}</div>
          ) : (
          <button
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className="w-full flex items-center justify-between gap-6 px-3 py-1.5 text-left hover:bg-blue-600/40 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <span className="flex items-center gap-2">
              {hasChecks && <span className="w-3 text-blue-300 text-[11px]">{item.checked ? '✓' : ''}</span>}
              {item.label}
            </span>
            {item.hint && <span className="text-[10.5px] text-zinc-500">{item.hint}</span>}
          </button>
          )}
        </div>
      ))}
    </div>
  );
}

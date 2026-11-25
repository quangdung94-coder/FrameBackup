import { Plus, X } from 'lucide-react';
import { useProgress, type ProgressStore } from '../../lib/progressStore';
import type { CardTab, WorkspaceStatus } from '../../workspace/shared';

interface CardTabsProps {
  tabs: CardTab[];
  activeId: string;
  statuses: Record<string, WorkspaceStatus | undefined>;
  stores: Record<string, ProgressStore>;
  parallelChoice: 'ask' | 'parallel' | 'queue';
  onParallelChoiceChange: (v: 'ask' | 'parallel' | 'queue') => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onClose: (id: string) => void;
}

const tabLetter = (i: number) => String.fromCharCode(65 + (i % 26));

function overallPercent(p: ReturnType<typeof useProgress>): number {
  const parts = [p.step1, p.step2, p.step3, p.step4].map((s) => (s ? (s.status === 'completed' ? 100 : s.percent) : 0));
  return parts.reduce((a, b) => a + b, 0) / 4;
}

function TabButton({
  tab,
  index,
  active,
  status,
  store,
  canClose,
  onSelect,
  onClose,
}: {
  tab: CardTab;
  index: number;
  active: boolean;
  status?: WorkspaceStatus;
  store: ProgressStore;
  canClose: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const p = useProgress(store);
  const pct = overallPercent(p);
  const state = status?.running
    ? 'run'
    : status?.waiting
    ? 'wait'
    : status?.watching
    ? 'watch'
    : status?.verdict === 'ok'
    ? 'ok'
    : status?.verdict === 'warn'
    ? 'warn'
    : 'idle';
  const dot = {
    run: 'bg-blue-400 animate-pulse',
    wait: 'bg-amber-400',
    watch: 'bg-amber-300 animate-pulse',
    ok: 'bg-emerald-400',
    warn: 'bg-orange-400',
    idle: 'bg-zinc-600',
  }[state];
  const text = {
    run: 'đang chạy',
    wait: 'chờ lượt',
    watch: 'đang canh Ổ 1',
    ok: 'xong, an toàn',
    warn: 'xong, cần kiểm tra',
    idle: 'sẵn sàng',
  }[state];
  return (
    <div
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={`group relative flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-t-lg border border-b-0 cursor-pointer min-w-[150px] max-w-[240px] ${
        active ? 'bg-[#1b1b20] border-[#3a3a46] text-zinc-100' : 'bg-[#141418] border-[#24242c] text-zinc-400 hover:text-zinc-200'
      }`}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block text-[12px] font-semibold truncate">
          💳 Thẻ {tabLetter(index)}
          {status?.label ? ` · ${status.label}` : ''}
        </span>
        <span className="block text-[10.5px] text-zinc-500 truncate">
          {tab.camFolder ? `${tab.camFolder} · ` : ''}
          {text}
        </span>
      </span>
      {canClose && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="p-0.5 rounded text-zinc-500 hover:text-zinc-100 hover:bg-white/10 opacity-0 group-hover:opacity-100"
          title="Đóng khu vực thẻ này"
        >
          <X className="w-3 h-3" />
        </button>
      )}
      <span className="absolute left-2 right-2 bottom-0 h-[2px] bg-white/5 overflow-hidden rounded">
        <span
          className={`block h-full origin-left transition-transform duration-300 ${state === 'warn' ? 'bg-orange-400' : 'bg-blue-400'}`}
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      </span>
    </div>
  );
}

/** Thanh tab: mỗi thẻ nhớ 1 khu vực làm việc riêng, chạy song song. */
export function CardTabs({ tabs, activeId, statuses, stores, parallelChoice, onParallelChoiceChange, onSelect, onAdd, onClose }: CardTabsProps) {
  return (
    <div className="bg-[#111114] border-b border-[#2b2b34] px-3 pt-2 flex items-end gap-1 shrink-0 overflow-x-auto">
      {tabs.map((t, i) => (
        <TabButton
          key={t.id}
          tab={t}
          index={i}
          active={t.id === activeId}
          status={statuses[t.id]}
          store={stores[t.id]}
          canClose={tabs.length > 1 && !statuses[t.id]?.running && !statuses[t.id]?.watching}
          onSelect={() => onSelect(t.id)}
          onClose={() => onClose(t.id)}
        />
      ))}
      <button
        onClick={onAdd}
        className="mb-1 ml-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-dashed border-[#3a3a46] text-[11.5px] text-zinc-400 hover:text-zinc-100 hover:border-zinc-400 shrink-0"
        title="Mở thêm 1 khu vực cho thẻ nhớ khác (chạy song song)"
      >
        <Plus className="w-3.5 h-3.5" /> Thêm thẻ
      </button>
      <span className="flex-1" />
      {tabs.length > 1 && (
        <label className="mb-1.5 inline-flex items-center gap-1.5 text-[11px] text-zinc-400 shrink-0" title="Khi bấm chạy thẻ thứ hai lúc thẻ khác còn chạy. 2 thẻ cùng ghi 1 ổ HDD thường chậm hơn chạy lần lượt.">
          Nhiều thẻ:
          <select
            value={parallelChoice}
            onChange={(e) => onParallelChoiceChange(e.target.value as 'ask' | 'parallel' | 'queue')}
            className="bg-[#101013] border border-[#2b2b34] rounded px-1 py-0.5 text-[11px] text-zinc-200 outline-none"
          >
            <option value="ask">Hỏi tôi</option>
            <option value="parallel">Luôn song song</option>
            <option value="queue">Luôn xếp hàng</option>
          </select>
        </label>
      )}
    </div>
  );
}

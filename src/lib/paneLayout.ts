import type { PaneGroup } from '../hooks/useFilePane';

/** Vị trí từng mục trong danh sách / lưới (có tiêu đề nhóm xen giữa). Toạ độ tính từ dưới dòng tiêu đề cột. */
export interface PaneLayout {
  tops: Float64Array;
  lefts: Float64Array;
  itemH: number;
  itemW: number;
  height: number;
  headers: Array<{ group: PaneGroup; top: number }>;
}

export const GROUP_H = 24;

export function computePaneLayout(
  count: number,
  groups: PaneGroup[],
  opts: { grid: boolean; cols: number; cellW: number; cellH: number; pad: number; rowH: number }
): PaneLayout {
  const tops = new Float64Array(count);
  const lefts = new Float64Array(count);
  const headers: PaneLayout['headers'] = [];
  const list = groups.length > 0 ? groups : [{ key: '', label: '', start: 0, count }];
  const gh = groups.length > 0 ? GROUP_H : 0;
  const itemH = opts.grid ? opts.cellH : opts.rowH;
  const cols = opts.grid ? Math.max(1, opts.cols) : 1;
  let y = opts.grid ? opts.pad : 0;
  for (const g of list) {
    if (gh) {
      headers.push({ group: g, top: y });
      y += gh;
    }
    for (let j = 0; j < g.count; j++) {
      const i = g.start + j;
      if (i >= count) break;
      tops[i] = y + Math.floor(j / cols) * itemH;
      lefts[i] = opts.grid ? opts.pad + (j % cols) * opts.cellW : 0;
    }
    y += Math.ceil(g.count / cols) * itemH;
  }
  return { tops, lefts, itemH, itemW: opts.grid ? opts.cellW : 0, height: y + (opts.grid ? opts.pad : 0), headers };
}

/** Chỉ số mục đầu tiên có đáy >= y (tìm nhị phân, tops tăng dần). */
function firstBelow(l: PaneLayout, y: number): number {
  let lo = 0;
  let hi = l.tops.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (l.tops[mid] + l.itemH < y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function visibleRange(l: PaneLayout, y0: number, y1: number): [number, number] {
  const first = firstBelow(l, y0);
  let last = first;
  while (last < l.tops.length && l.tops[last] <= y1) last++;
  return [first, last];
}

/** Các mục giao với khung quét chọn (toạ độ nội dung của vùng cuộn, gồm dòng tiêu đề cao headerH). */
export function hitTest(l: PaneLayout, box: { left: number; top: number; width: number; height: number }, headerH: number): number[] {
  const y0 = box.top - headerH;
  const y1 = y0 + box.height;
  const [a, b] = visibleRange(l, y0, y1);
  const out: number[] = [];
  for (let i = a; i < b; i++) {
    if (l.tops[i] + l.itemH <= y0 || l.tops[i] >= y1) continue;
    if (l.itemW > 0 && (l.lefts[i] + l.itemW <= box.left || l.lefts[i] >= box.left + box.width)) continue;
    out.push(i);
  }
  return out;
}

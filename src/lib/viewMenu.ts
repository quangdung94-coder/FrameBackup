import type { ContextMenuItem } from '../components/layout/ContextMenu';
import type { SortState, ViewPrefs } from '../hooks/useFilePane';

export const LARGE_ICON = 192;
export const MEDIUM_ICON = 128;

/** Menu "View" kiểu Explorer: bố cục, sắp xếp, hiện / ẩn. */
export function buildViewMenu(
  view: ViewPrefs,
  setView: (patch: Partial<ViewPrefs>) => void,
  sort: SortState,
  setSort: (s: SortState) => void,
  camera?: { list: Array<[string, number]>; active: string; set: (m: string) => void; loading: boolean }
): ContextMenuItem[] {
  const icons = view.layout === 'icons';
  const sortItem = (label: string, key: SortState['key']): ContextMenuItem => ({
    label,
    checked: sort.key === key,
    onSelect: () => setSort(sort.key === key ? { key, asc: !sort.asc } : { key, asc: key === 'name' }),
  });
  return [
    { label: 'Layout', heading: true, onSelect: () => {} },
    { label: 'Large icons', checked: icons && view.iconSize >= 160, onSelect: () => setView({ layout: 'icons', iconSize: LARGE_ICON }) },
    { label: 'Medium icons', checked: icons && view.iconSize < 160, onSelect: () => setView({ layout: 'icons', iconSize: MEDIUM_ICON }) },
    { label: 'Tiles', checked: view.layout === 'tiles', onSelect: () => setView({ layout: 'tiles' }) },
    { label: 'List', checked: view.layout === 'list', onSelect: () => setView({ layout: 'list' }) },
    { label: 'Details', checked: view.layout === 'details', onSelect: () => setView({ layout: 'details' }) },
    { label: 'Sort by', heading: true, separatorBefore: true, onSelect: () => {} },
    sortItem('Name', 'name'),
    sortItem('Date', 'date'),
    sortItem('Size', 'size'),
    sortItem('Duration', 'duration'),
    {
      label: sort.asc ? 'Ascending' : 'Descending',
      hint: 'đảo chiều',
      onSelect: () => setSort({ ...sort, asc: !sort.asc }),
    },
    { label: 'Group by', heading: true, separatorBefore: true, onSelect: () => {} },
    ...(
      [
        ['none', 'None'],
        ['date', 'Date taken'],
        ['type', 'Type'],
        ['camera', 'Camera'],
      ] as const
    ).map(([g, label]) => ({ label, checked: view.groupBy === g, onSelect: () => setView({ groupBy: g }) })),
    ...(camera
      ? [
          { label: camera.loading ? 'Filter by camera (đang đọc…)' : 'Filter by camera', heading: true, separatorBefore: true, onSelect: () => {} },
          { label: 'All cameras', checked: !camera.active, onSelect: () => camera.set('') },
          ...camera.list.map(([m, n]) => ({ label: `${m}`, hint: String(n), checked: camera.active === m, onSelect: () => camera.set(m) })),
        ]
      : []),
    { label: 'Show / hide', heading: true, separatorBefore: true, onSelect: () => {} },
    { label: 'Preview pane', checked: view.showPreview, onSelect: () => setView({ showPreview: !view.showPreview }) },
    { label: 'Duration column', checked: view.showDuration, onSelect: () => setView({ showDuration: !view.showDuration }) },
    { label: 'Hide sidecar files (XML, THM, IND…)', checked: view.hideSidecar, onSelect: () => setView({ hideSidecar: !view.hideSidecar }) },
  ];
}

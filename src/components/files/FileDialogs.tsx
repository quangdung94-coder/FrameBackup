import { FileText, Folder, HardDrive, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatBytes, formatDateTime, type DriveInfo, type PathProperties } from '../../types/framebackup';

export interface NamePrompt {
  title: string;
  label: string;
  initial: string;
  confirmLabel: string;
  /** Trả về thông báo lỗi để giữ hộp thoại mở, hoặc null khi xong. */
  onSubmit: (name: string) => Promise<string | null>;
}

const INVALID = /[<>:"/\\|?*]/;

/** Hộp nhập tên: Thư mục mới / Đổi tên. Enter = đồng ý, Esc = huỷ. */
export function NameDialog({ prompt, onClose }: { prompt: NamePrompt | null; onClose: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (prompt) {
      setValue(prompt.initial);
      setError(null);
      setBusy(false);
    }
  }, [prompt]);
  if (!prompt) return null;
  const submit = async () => {
    const v = value.trim();
    if (!v) return setError('Hãy nhập tên.');
    if (INVALID.test(v)) return setError('Tên không được chứa \\ / : * ? " < > |');
    setBusy(true);
    const err = await prompt.onSubmit(v);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };
  return (
    <div className="fixed inset-0 z-[110] bg-black/55 flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[400px] max-w-full rounded-lg border border-[#3a3a46] bg-[#1c1c21] p-4 shadow-2xl shadow-black/60 space-y-3">
        <div className="text-sm font-semibold text-zinc-100">{prompt.title}</div>
        <label className="block text-[11.5px] text-zinc-400 space-y-1">
          <span>{prompt.label}</span>
          <input
            autoFocus
            value={value}
            onFocus={(e) => {
              // Đổi tên file: chọn phần tên, chừa đuôi (giống Explorer)
              const dot = e.currentTarget.value.lastIndexOf('.');
              if (dot > 0 && prompt.initial.includes('.')) e.currentTarget.setSelectionRange(0, dot);
              else e.currentTarget.select();
            }}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
              if (e.key === 'Escape') onClose();
            }}
            className="w-full bg-[#101013] border border-[#3a3a46] focus:border-blue-500 rounded px-2.5 py-1.5 text-[13px] text-zinc-100 outline-none"
          />
        </label>
        {error && <div className="text-[11.5px] text-red-300">{error}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md border border-[#3a3a46] text-[12px] text-zinc-300 hover:bg-white/5">
            Huỷ
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-[12px] font-semibold text-white"
          >
            {prompt.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Hộp Thuộc tính (chuột phải > Thuộc tính): vị trí, dung lượng, số file/thư mục, ngày tạo/sửa, chỗ trống của ổ. */
export function PropertiesDialog({ path, drives, onClose }: { path: string | null; drives: DriveInfo[]; onClose: () => void }) {
  const [props, setProps] = useState<PathProperties | null>(null);
  useEffect(() => {
    setProps(null);
    if (!path || !window.frameBackup?.getPathProperties) return;
    let alive = true;
    void window.frameBackup.getPathProperties(path).then((p) => alive && setProps(p));
    return () => {
      alive = false;
    };
  }, [path]);
  useEffect(() => {
    if (!path) return;
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' || e.key === 'Enter') && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [path, onClose]);
  if (!path) return null;
  const lower = path.toLowerCase();
  const drive = [...drives].sort((a, b) => b.mountPath.length - a.mountPath.length).find((d) => lower.startsWith(d.mountPath.toLowerCase()));
  const isDrive = Boolean(drive && drive.mountPath.replace(/[\\/]+$/, '').toLowerCase() === lower.replace(/[\\/]+$/, ''));
  const parent = path.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '') || path;
  const Icon = isDrive ? HardDrive : props?.isDirectory === false ? FileText : Folder;
  const row = (k: string, v: React.ReactNode) => (
    <>
      <span className="text-zinc-500">{k}</span>
      <span className="text-zinc-100 break-all">{v}</span>
    </>
  );
  return (
    <div className="fixed inset-0 z-[110] bg-black/55 flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[440px] max-w-full rounded-lg border border-[#3a3a46] bg-[#1c1c21] p-4 shadow-2xl shadow-black/60 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100 min-w-0">
          <Icon className="w-5 h-5 text-amber-300 shrink-0" />
          <span className="truncate">{isDrive ? drive?.label : props?.name ?? path}</span>
        </div>
        {!props ? (
          <div className="flex items-center gap-2 text-[12px] text-zinc-400 py-3">
            <Loader2 className="w-4 h-4 animate-spin" /> Đang đếm file và dung lượng...
          </div>
        ) : !props.ok ? (
          <div className="text-[12px] text-red-300">Không đọc được: {props.error}</div>
        ) : (
          <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12px]">
            {row('Loại', isDrive ? 'Ổ đĩa' : props.isDirectory ? 'Thư mục' : `File ${props.name.split('.').pop()?.toUpperCase() ?? ''}`)}
            {row('Vị trí', isDrive ? path : parent)}
            {row(
              'Dung lượng',
              <>
                {formatBytes(props.sizeBytes)} <span className="text-zinc-500">({props.sizeBytes.toLocaleString('vi-VN')} byte)</span>
                {props.partial && <span className="text-amber-300"> · chưa đếm hết (thư mục quá lớn)</span>}
              </>
            )}
            {props.isDirectory && row('Gồm', `${props.files.toLocaleString('vi-VN')} file, ${props.folders.toLocaleString('vi-VN')} thư mục`)}
            {!isDrive && row('Ngày tạo', props.createdMs ? formatDateTime(props.createdMs) : '—')}
            {!isDrive && row('Ngày sửa', props.modifiedMs ? formatDateTime(props.modifiedMs) : '—')}
            {drive && row(`Ổ ${drive.label}`, `Trống ${formatBytes(drive.freeBytes)} / ${formatBytes(drive.totalBytes)}`)}
          </div>
        )}
        {drive && (
          <div className="h-2 rounded-full bg-[#2b2b34] overflow-hidden">
            <div className="h-full bg-blue-500" style={{ width: `${drive.usedPercent}%` }} />
          </div>
        )}
        <div className="flex justify-end">
          <button onClick={onClose} className="px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-[12px] font-semibold text-white">
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}

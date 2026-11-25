import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, Cloud, FileKey2, Globe, Loader2, LogIn, LogOut, RefreshCw, X } from 'lucide-react';
import { loadSavedString, saveToStorage, STORAGE_KEYS } from '../lib/storage';
import { formatBytes, type BrowserOption, type DriveAuthStatus } from '../types/framebackup';

interface GoogleDriveAuthModalProps {
  open: boolean;
  onClose: () => void;
  authStatus: DriveAuthStatus;
  onAuthChanged: (status: DriveAuthStatus) => void;
  onNotify: (msg: string) => void;
}

const DEFAULT_BROWSERS: BrowserOption[] = [{ id: 'system', name: 'Trình duyệt mặc định của máy' }];

/**
 * Kết nối Google Drive cho người không rành kỹ thuật: 1 nút "Đăng nhập Google".
 * Cấu hình Google đã nhúng sẵn trong app; credentials.json riêng chỉ còn ở mục Nâng cao.
 */
export function GoogleDriveAuthModal({ open, onClose, authStatus, onAuthChanged, onNotify }: GoogleDriveAuthModalProps) {
  const [busy, setBusy] = useState(false);
  const [waitingBrowser, setWaitingBrowser] = useState(false);
  const [browsers, setBrowsers] = useState<BrowserOption[]>(DEFAULT_BROWSERS);
  const [browserId, setBrowserId] = useState(() => loadSavedString(STORAGE_KEYS.loginBrowser, 'system'));
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!open || !window.frameBackup) return;
    void window.frameBackup.listBrowsers().then((list) => {
      if (list.length > 0) setBrowsers(list);
    });
  }, [open]);

  if (!open) return null;

  const noClient = authStatus.clientSource === 'none' || !authStatus.hasCredentials;
  const selectedBrowser = browsers.find((b) => b.id === browserId) ?? browsers[0];

  const chooseBrowser = (id: string) => {
    setBrowserId(id);
    saveToStorage({ [STORAGE_KEYS.loginBrowser]: id });
  };

  const run = async (fn: () => Promise<void>) => {
    if (!window.frameBackup) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const handleSignIn = () =>
    run(async () => {
      setWaitingBrowser(true);
      try {
        onNotify(`Đang mở ${selectedBrowser.name} để đăng nhập Google...`);
        const status = await window.frameBackup!.signInGoogleDrive(selectedBrowser.id);
        onAuthChanged(status);
        if (status.signedIn) onNotify(`✅ Đã kết nối Google Drive: ${status.email}`);
        else if (status.error) onNotify(`❌ ${status.error}`);
      } finally {
        setWaitingBrowser(false);
      }
    });

  const handleSignOut = () =>
    run(async () => {
      onAuthChanged(await window.frameBackup!.signOutGoogleDrive());
      onNotify('Đã đăng xuất tài khoản Google Drive.');
    });

  const handleImportCreds = () =>
    run(async () => {
      const res = await window.frameBackup!.importDriveCredentials();
      onNotify(res.message);
      onAuthChanged(await window.frameBackup!.getDriveAuthStatus());
    });

  const handleUseBuiltIn = () =>
    run(async () => {
      onAuthChanged(await window.frameBackup!.useBuiltInGoogleClient());
      onNotify('Đã quay về cấu hình Google mặc định của app. Hãy đăng nhập lại.');
    });

  const freeBytes =
    authStatus.quotaLimitBytes && authStatus.quotaUsageBytes !== undefined
      ? Math.max(0, authStatus.quotaLimitBytes - authStatus.quotaUsageBytes)
      : undefined;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget && !waitingBrowser) onClose();
      }}
    >
      <div className="bg-[#1e1e24] border border-[#3e3e4b] rounded-xl w-[560px] max-w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="px-4 py-3 border-b border-[#2b2b34] flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-sm text-zinc-100">
            <Cloud className="w-4 h-4 text-purple-400" />
            Kết nối Google Drive
          </div>
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#272730] hover:bg-[#32323e] text-zinc-300 text-xs"
          >
            <X className="w-3.5 h-3.5" /> Đóng
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-3 text-xs">
          {authStatus.signedIn ? (
            <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/35 space-y-2">
              <div className="flex items-center gap-2 text-emerald-300 font-bold text-[13px]">
                <CheckCircle2 className="w-5 h-5" /> Đã đăng nhập Google Drive
              </div>
              <div className="text-zinc-200">
                👤 {authStatus.displayName} <span className="text-zinc-400">({authStatus.email})</span>
              </div>
              {freeBytes !== undefined && authStatus.quotaLimitBytes && (
                <div className="text-zinc-300">
                  ☁️ Còn trống <strong className="text-emerald-300">{formatBytes(freeBytes)}</strong> /{' '}
                  {formatBytes(authStatus.quotaLimitBytes)}
                </div>
              )}
              <div className="text-zinc-400 pt-1">
                Giờ chỉ cần <strong className="text-zinc-200">dán link thư mục Drive</strong> ở Cột 4 (thư mục của anh, hoặc thư mục
                người khác đã chia sẻ quyền <em>Người chỉnh sửa</em> cho tài khoản này).
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  disabled={busy}
                  onClick={handleSignIn}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#25252f] hover:bg-[#31313e] border border-[#3f3f4e] text-zinc-100 font-semibold"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Đổi tài khoản
                </button>
                <button
                  disabled={busy}
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/35 border border-red-500/40 text-red-200 font-semibold"
                >
                  <LogOut className="w-3.5 h-3.5" /> Đăng xuất
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-lg bg-[#141418] border border-[#2b2b34] space-y-3">
              {waitingBrowser ? (
                <div className="flex flex-col items-center text-center gap-2 py-2">
                  <Loader2 className="w-7 h-7 text-purple-300 animate-spin" />
                  <div className="text-[13px] font-semibold text-zinc-100">Đang chờ anh đăng nhập trên {selectedBrowser.name}...</div>
                  <div className="text-zinc-400">Chọn tài khoản Google ➔ bấm <strong>Tiếp tục / Cho phép</strong> ➔ quay lại app.</div>
                  <button
                    onClick={() => void window.frameBackup?.cancelGoogleSignIn()}
                    className="mt-1 px-3 py-1 rounded bg-[#2a2a32] hover:bg-[#34343e] text-zinc-300"
                  >
                    Huỷ đăng nhập
                  </button>
                </div>
              ) : (
                <>
                  <button
                    disabled={busy || noClient}
                    onClick={handleSignIn}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-bold text-[13px] transition"
                  >
                    <LogIn className="w-4 h-4" /> Đăng nhập Google
                  </button>
                  <label className="flex items-center gap-2 text-zinc-300">
                    <Globe className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <span className="shrink-0">Mở bằng:</span>
                    <select
                      value={selectedBrowser.id}
                      onChange={(e) => chooseBrowser(e.target.value)}
                      className="flex-1 min-w-0 bg-[#101013] border border-[#2b2b34] rounded px-2 py-1 text-[11.5px] text-zinc-100 outline-none"
                    >
                      {browsers.map((b) => (
                        <option key={b.id} value={b.id} className="bg-[#202024]">
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="text-zinc-500 leading-relaxed">
                    Chọn trình duyệt đang đăng nhập sẵn tài khoản Google anh muốn dùng. Nếu Google hiện{' '}
                    <em>&ldquo;Google chưa xác minh ứng dụng này&rdquo;</em>: bấm <strong className="text-zinc-300">Nâng cao</strong> ➔{' '}
                    <strong className="text-zinc-300">Đi tới FrameBackup</strong>.
                  </div>
                </>
              )}
              {noClient && (
                <div className="p-2 rounded bg-amber-500/15 border border-amber-500/40 text-amber-200">
                  Bản app này chưa được nhúng sẵn cấu hình Google. Người build app cần đặt file{' '}
                  <code>build/google-oauth-client.json</code> rồi build lại — hoặc dùng mục Nâng cao bên dưới.
                </div>
              )}
              {authStatus.error && !waitingBrowser && (
                <div className="p-2 rounded bg-red-500/15 border border-red-500/40 text-red-200">{authStatus.error}</div>
              )}
            </div>
          )}

          {/* Nâng cao: Google Cloud riêng (credentials.json) */}
          <div className="rounded-lg border border-[#2b2b34]">
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-zinc-400 hover:text-zinc-200"
            >
              <span>Nâng cao: dùng Google Cloud riêng (credentials.json)</span>
              <ChevronDown className={`w-4 h-4 transition ${showAdvanced || noClient ? 'rotate-180' : ''}`} />
            </button>
            {(showAdvanced || noClient) && (
              <div className="px-3 pb-3 space-y-2 text-zinc-400">
                <div>
                  Đang dùng:{' '}
                  <strong className="text-zinc-200">
                    {authStatus.clientSource === 'custom'
                      ? 'credentials.json tự nạp'
                      : authStatus.clientSource === 'built-in'
                      ? 'cấu hình mặc định của app'
                      : 'chưa có'}
                  </strong>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={busy}
                    onClick={handleImportCreds}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#25252f] hover:bg-[#31313e] border border-[#3f3f4e] text-zinc-100"
                  >
                    <FileKey2 className="w-3.5 h-3.5 text-amber-400" /> Chọn file credentials.json
                  </button>
                  {authStatus.clientSource === 'custom' && (
                    <button
                      disabled={busy}
                      onClick={handleUseBuiltIn}
                      className="px-3 py-1.5 rounded-lg bg-[#25252f] hover:bg-[#31313e] border border-[#3f3f4e] text-zinc-100"
                    >
                      Quay về cấu hình mặc định
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

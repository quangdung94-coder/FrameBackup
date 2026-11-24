import { useState } from 'react';
import { CheckCircle2, Cloud, ExternalLink, FileKey2, LogIn, LogOut, X } from 'lucide-react';
import { formatBytes, type DriveAuthStatus } from '../types/framebackup';

interface GoogleDriveAuthModalProps {
  open: boolean;
  onClose: () => void;
  authStatus: DriveAuthStatus;
  onAuthChanged: (status: DriveAuthStatus) => void;
  onNotify: (msg: string) => void;
}

export function GoogleDriveAuthModal({
  open,
  onClose,
  authStatus,
  onAuthChanged,
  onNotify,
}: GoogleDriveAuthModalProps) {
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const handleImportCreds = async () => {
    if (!window.frameBackup) return;
    setBusy(true);
    try {
      const res = await window.frameBackup.importDriveCredentials();
      onNotify(res.message);
      const refreshed = await window.frameBackup.getDriveAuthStatus();
      onAuthChanged(refreshed);
    } finally {
      setBusy(false);
    }
  };

  const handleSignIn = async () => {
    if (!window.frameBackup) return;
    setBusy(true);
    try {
      onNotify('Đang mở trình duyệt để đăng nhập Google...');
      const status = await window.frameBackup.signInGoogleDrive();
      onAuthChanged(status);
      if (status.signedIn) {
        onNotify(`✅ Đã kết nối Google Drive: ${status.email}`);
      } else if (status.error) {
        onNotify(`❌ Lỗi đăng nhập Google: ${status.error}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (!window.frameBackup) return;
    setBusy(true);
    try {
      const status = await window.frameBackup.signOutGoogleDrive();
      onAuthChanged(status);
      onNotify('Đã đăng xuất tài khoản Google Drive.');
    } finally {
      setBusy(false);
    }
  };

  const freeBytes =
    authStatus.quotaLimitBytes && authStatus.quotaUsageBytes !== undefined
      ? Math.max(0, authStatus.quotaLimitBytes - authStatus.quotaUsageBytes)
      : undefined;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#1e1e24] border border-[#3e3e4b] rounded-xl w-[660px] max-w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="px-4 py-3 border-b border-[#2b2b34] flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-sm text-zinc-100">
            <Cloud className="w-4 h-4 text-purple-400" />
            Kết nối Google Drive (OAuth 2.0)
          </div>
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#272730] hover:bg-[#32323e] text-zinc-300 text-xs"
          >
            <X className="w-3.5 h-3.5" /> Đóng
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4 text-xs">
          {/* Current Status Card */}
          <div className="p-3.5 rounded-lg bg-[#141418] border border-[#2b2b34] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-300">Trạng thái kết nối:</span>
              {authStatus.signedIn ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Đã đăng nhập
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full bg-zinc-700/60 text-zinc-300 font-medium">
                  Chưa kết nối
                </span>
              )}
            </div>

            {authStatus.signedIn && (
              <div className="space-y-1 text-zinc-300">
                <div>
                  👤 <strong>Tài khoản:</strong> {authStatus.displayName} ({authStatus.email})
                </div>
                {freeBytes !== undefined && authStatus.quotaLimitBytes && (
                  <div>
                    ☁️ <strong>Dung lượng Drive:</strong> Còn trống{' '}
                    <strong className="text-emerald-300">{formatBytes(freeBytes)}</strong> /{' '}
                    {formatBytes(authStatus.quotaLimitBytes)}
                  </div>
                )}
              </div>
            )}

            {authStatus.error && (
              <div className="p-2 rounded bg-red-500/15 border border-red-500/40 text-red-200">
                {authStatus.error}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                disabled={busy}
                onClick={handleImportCreds}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#25252f] hover:bg-[#31313e] border border-[#3f3f4e] text-zinc-100 font-semibold transition"
              >
                <FileKey2 className="w-4 h-4 text-amber-400" />
                {authStatus.hasCredentials ? 'Đổi file credentials.json' : 'Bước 1: Chọn file credentials.json'}
              </button>

              {!authStatus.signedIn ? (
                <button
                  disabled={busy || !authStatus.hasCredentials}
                  onClick={handleSignIn}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-bold transition"
                >
                  <LogIn className="w-4 h-4" />
                  Bước 2: Đăng nhập Google
                </button>
              ) : (
                <button
                  disabled={busy}
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600/20 hover:bg-red-600/35 border border-red-500/40 text-red-200 font-semibold transition"
                >
                  <LogOut className="w-4 h-4" /> Đăng xuất
                </button>
              )}
            </div>
          </div>

          {/* 4-Step Setup Guide */}
          <div className="p-3.5 rounded-lg bg-[#141418] border border-[#2b2b34] space-y-2 text-zinc-300 leading-relaxed">
            <div className="font-bold text-blue-300 flex items-center justify-between">
              <span>Hướng dẫn tạo file credentials.json miễn phí (chỉ làm 1 lần, mất ~3 phút):</span>
              <button
                onClick={() => window.frameBackup?.openExternalUrl('https://console.cloud.google.com/apis/credentials')}
                className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:underline"
              >
                Mở Google Cloud <ExternalLink className="w-3 h-3" />
              </button>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-zinc-400">
              <li>
                Vào <strong className="text-zinc-200">Google Cloud Console</strong> ➔ Tạo Project mới (VD: <code className="text-zinc-200">FrameBackup</code>).
              </li>
              <li>
                Vào <strong>APIs &amp; Services ➔ Library</strong> ➔ Tìm &amp; bật <strong className="text-zinc-200">Google Drive API</strong>.
              </li>
              <li>
                Vào <strong>OAuth consent screen</strong> ➔ Chọn <em>External</em> ➔ thêm email Google của anh vào mục <strong>Test users</strong>.
              </li>
              <li>
                Vào <strong>Credentials ➔ Create Credentials ➔ OAuth client ID</strong> ➔ chọn <strong className="text-zinc-200">Desktop app</strong> ➔ tải file JSON về rồi bấm <strong>Bước 1</strong> ở trên.
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

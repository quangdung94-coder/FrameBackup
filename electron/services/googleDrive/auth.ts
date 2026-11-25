import fsp from 'node:fs/promises';
import http from 'node:http';
import { google, type Auth } from 'googleapis';
import type { DriveAuthStatus } from '../../shared/types';
import { getTokenPath, getUserDataDir, readActiveClient } from './storage';

const DRIVE_SCOPE = ['https://www.googleapis.com/auth/drive'];

/** OAuth2 client đã có token (tự lưu token mới khi refresh). null nếu chưa đăng nhập. */
export async function getAuthorizedOAuthClient(): Promise<Auth.OAuth2Client | null> {
  const clientCfg = (await readActiveClient())?.client;
  if (!clientCfg) return null;

  let tokenJson: Auth.Credentials;
  try {
    tokenJson = JSON.parse(await fsp.readFile(getTokenPath(), 'utf8'));
  } catch {
    return null;
  }

  const oauth2 = new google.auth.OAuth2(clientCfg.client_id, clientCfg.client_secret, 'http://127.0.0.1');
  oauth2.setCredentials(tokenJson);

  oauth2.on('tokens', (newTokens) => {
    const merged = { ...tokenJson, ...newTokens };
    tokenJson = merged;
    void fsp.writeFile(getTokenPath(), JSON.stringify(merged, null, 2), 'utf8').catch(() => {});
  });

  return oauth2;
}

export async function getDriveAuthStatus(): Promise<DriveAuthStatus> {
  const active = await readActiveClient();
  if (!active) {
    return { hasCredentials: false, signedIn: false, clientSource: 'none' };
  }
  const clientSource = active.source;

  const auth = await getAuthorizedOAuthClient();
  if (!auth) {
    return { hasCredentials: true, signedIn: false, clientSource };
  }

  try {
    const drive = google.drive({ version: 'v3', auth });
    const about = await drive.about.get({
      fields: 'user(displayName,emailAddress),storageQuota(limit,usage)',
    });
    const user = about.data.user;
    const quota = about.data.storageQuota;
    return {
      hasCredentials: true,
      signedIn: true,
      clientSource,
      email: user?.emailAddress || undefined,
      displayName: user?.displayName || undefined,
      quotaLimitBytes: quota?.limit ? Number(quota.limit) : undefined,
      quotaUsageBytes: quota?.usage ? Number(quota.usage) : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Token bị thu hồi / hết hạn => coi như chưa đăng nhập, xoá token cũ để nút Đăng nhập hiện lại
    if (/invalid_grant|unauthorized|401/i.test(msg)) {
      await fsp.unlink(getTokenPath()).catch(() => {});
      return { hasCredentials: true, signedIn: false, clientSource, error: 'Phiên đăng nhập Google đã hết hạn — bấm Đăng nhập lại.' };
    }
    return { hasCredentials: true, signedIn: false, clientSource, error: msg };
  }
}

/** Huỷ lượt đăng nhập đang chờ trình duyệt (người dùng đóng tab / đổi ý). */
let cancelPendingSignIn: (() => void) | null = null;
export function cancelGoogleSignIn(): boolean {
  if (!cancelPendingSignIn) return false;
  cancelPendingSignIn();
  return true;
}

export async function signInGoogleDrive(openExternalUrl: (url: string) => Promise<void>): Promise<DriveAuthStatus> {
  const active = await readActiveClient();
  if (!active) {
    return {
      hasCredentials: false,
      signedIn: false,
      clientSource: 'none',
      error: 'Bản app này chưa được nhúng cấu hình Google (google-oauth-client.json). Liên hệ người build app.',
    };
  }
  const clientCfg = active.client;
  const clientSource = active.source;
  cancelPendingSignIn?.();

  // PKCE: mã đăng nhập chỉ đổi được token bởi đúng phiên app này
  const pkce = await new google.auth.OAuth2(clientCfg.client_id).generateCodeVerifierAsync();

  return new Promise<DriveAuthStatus>((resolve) => {
    let finished = false;
    const done = (status: DriveAuthStatus) => {
      if (finished) return;
      finished = true;
      server.close();
      clearTimeout(timeout);
      cancelPendingSignIn = null;
      resolve({ clientSource, ...status });
    };
    cancelPendingSignIn = () => done({ hasCredentials: true, signedIn: false, error: 'Đã huỷ đăng nhập.' });

    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
        if (reqUrl.pathname !== '/oauth2callback') {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        const code = reqUrl.searchParams.get('code');
        const errParam = reqUrl.searchParams.get('error');
        if (errParam || !code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h2>Đăng nhập bị hủy hoặc lỗi. Anh có thể đóng tab này.</h2>');
          done({
            hasCredentials: true,
            signedIn: false,
            error:
              errParam === 'access_denied'
                ? 'Đăng nhập đã bị huỷ trên trình duyệt (chưa cấp quyền Google Drive).'
                : errParam || 'Không nhận được mã xác thực.',
          });
          return;
        }

        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
        const oauth2 = new google.auth.OAuth2(clientCfg.client_id, clientCfg.client_secret, redirectUri);
        const { tokens } = await oauth2.getToken({ code, codeVerifier: pkce.codeVerifier });

        await fsp.mkdir(getUserDataDir(), { recursive: true });
        await fsp.writeFile(getTokenPath(), JSON.stringify(tokens, null, 2), 'utf8');

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<div style="font-family:sans-serif;text-align:center;padding:40px;background:#121215;color:#f4f4f5;height:100vh;">' +
            '<h2 style="color:#10b981;">✅ Kết nối Google Drive cho FrameBackup thành công!</h2>' +
            '<p>Anh có thể đóng tab trình duyệt này và quay lại ứng dụng FrameBackup.</p></div>'
        );

        const status = await getDriveAuthStatus();
        done(status);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('OAuth Error');
        done({
          hasCredentials: true,
          signedIn: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    const timeout = setTimeout(() => {
      done({
        hasCredentials: true,
        signedIn: false,
        error: 'Hết thời gian chờ đăng nhập Google (5 phút). Vui lòng thử lại.',
      });
    }, 300_000);

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
      const oauth2 = new google.auth.OAuth2(clientCfg.client_id, clientCfg.client_secret, redirectUri);

      const authUrl = oauth2.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent select_account',
        scope: DRIVE_SCOPE,
        code_challenge_method: 'S256' as Auth.CodeChallengeMethod,
        code_challenge: pkce.codeChallenge,
      });

      void openExternalUrl(authUrl).catch((err) => {
        done({
          hasCredentials: true,
          signedIn: false,
          error: `Không mở được trình duyệt: ${err instanceof Error ? err.message : String(err)}`,
        });
      });
    });
  });
}

export async function signOutGoogleDrive(): Promise<DriveAuthStatus> {
  await fsp.unlink(getTokenPath()).catch(() => {});
  return getDriveAuthStatus();
}

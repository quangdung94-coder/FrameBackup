import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ActionResult } from '../../shared/types';

/** Lưu credentials.json & token OAuth trong thư mục userData của app. */
export interface StoredOAuthClient {
  client_id: string;
  client_secret: string;
  redirect_uris?: string[];
}

let userDataDir = '';
/** Thư mục có thể chứa google-oauth-client.json đóng gói sẵn trong app (resources/ khi đã build, build/ khi dev). */
let bundledClientDirs: string[] = [];

/** Tên file cấu hình Google OAuth (Desktop app) nhúng sẵn trong bản build — KHÔNG commit lên GitHub. */
export const BUNDLED_CLIENT_FILE = 'google-oauth-client.json';

export function initGoogleDriveStorage(appUserDataPath: string, bundledDirs: string[] = []) {
  userDataDir = appUserDataPath;
  bundledClientDirs = bundledDirs;
}

export function getUserDataDir(): string {
  return userDataDir;
}

export function getCredsPath(): string {
  return path.join(userDataDir, 'google-oauth-credentials.json');
}

export function getTokenPath(): string {
  return path.join(userDataDir, 'google-oauth-token.json');
}

function parseClientJson(raw: string): StoredOAuthClient | null {
  try {
    const json = JSON.parse(raw);
    const cfg = json.installed || json.web || json;
    if (cfg && typeof cfg.client_id === 'string' && typeof cfg.client_secret === 'string') {
      return { client_id: cfg.client_id, client_secret: cfg.client_secret, redirect_uris: cfg.redirect_uris };
    }
  } catch {
    // ignore
  }
  return null;
}

/** credentials.json người dùng tự nạp (chế độ nâng cao). */
export async function readStoredClient(): Promise<StoredOAuthClient | null> {
  try {
    return parseClientJson(await fsp.readFile(getCredsPath(), 'utf8'));
  } catch {
    return null;
  }
}

/** Cấu hình Google nhúng sẵn trong app: biến môi trường (dev/CI) hoặc file google-oauth-client.json đóng gói kèm. */
export async function readBundledClient(): Promise<StoredOAuthClient | null> {
  const envId = process.env.FB_GOOGLE_CLIENT_ID;
  const envSecret = process.env.FB_GOOGLE_CLIENT_SECRET;
  if (envId && envSecret) return { client_id: envId, client_secret: envSecret };
  for (const dir of bundledClientDirs) {
    try {
      const cfg = parseClientJson(await fsp.readFile(path.join(dir, BUNDLED_CLIENT_FILE), 'utf8'));
      if (cfg) return cfg;
    } catch {
      // thử thư mục tiếp theo
    }
  }
  return null;
}

export type OAuthClientSource = 'built-in' | 'custom';

/** Client đang dùng: ưu tiên file người dùng tự nạp (nâng cao), không có thì dùng cấu hình nhúng sẵn. */
export async function readActiveClient(): Promise<{ client: StoredOAuthClient; source: OAuthClientSource } | null> {
  const custom = await readStoredClient();
  if (custom) return { client: custom, source: 'custom' };
  const bundled = await readBundledClient();
  if (bundled) return { client: bundled, source: 'built-in' };
  return null;
}

/** Bỏ credentials.json tự nạp, quay về cấu hình nhúng sẵn. */
export async function removeCustomClient(): Promise<void> {
  await fsp.unlink(getCredsPath()).catch(() => {});
  await fsp.unlink(getTokenPath()).catch(() => {});
}

export async function importOAuthCredentials(sourceJsonPath: string): Promise<ActionResult> {
  try {
    const raw = await fsp.readFile(sourceJsonPath, 'utf8');
    const json = JSON.parse(raw);
    const cfg = json.installed || json.web || json;
    if (!cfg?.client_id || !cfg?.client_secret) {
      return {
        ok: false,
        message: 'File JSON không hợp lệ (thiếu client_id / client_secret của Google OAuth Desktop App).',
      };
    }
    const prevClient = (await readActiveClient())?.client ?? null;
    await fsp.mkdir(userDataDir, { recursive: true });
    await fsp.writeFile(getCredsPath(), raw, 'utf8');
    // If OAuth client_id changed, clear old token issued for previous client
    if (prevClient && prevClient.client_id !== cfg.client_id) {
      await fsp.unlink(getTokenPath()).catch(() => {});
    }
    return { ok: true, message: 'Đã lưu file credentials.json thành công! Bấm "Đăng nhập Google" để kết nối.' };
  } catch (err) {
    return {
      ok: false,
      message: `Không đọc được file credentials.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

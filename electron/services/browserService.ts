import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserOption } from '../shared/types';

/** Trình duyệt mặc định của hệ điều hành. */
export const SYSTEM_BROWSER_ID = 'system';

interface BrowserCandidate {
  id: string;
  name: string;
  /** Windows: đường dẫn .exe (tương đối với các thư mục cài đặt). macOS: thư mục .app. */
  paths: string[];
}

function winCandidates(): BrowserCandidate[] {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const inRoots = (rel: string, roots = [pf, pf86, local]) => roots.filter(Boolean).map((r) => path.join(r, rel));
  return [
    { id: 'chrome', name: 'Google Chrome', paths: inRoots('Google\\Chrome\\Application\\chrome.exe') },
    { id: 'edge', name: 'Microsoft Edge', paths: inRoots('Microsoft\\Edge\\Application\\msedge.exe') },
    { id: 'coccoc', name: 'Cốc Cốc', paths: inRoots('CocCoc\\Browser\\Application\\browser.exe') },
    { id: 'firefox', name: 'Firefox', paths: inRoots('Mozilla Firefox\\firefox.exe') },
    { id: 'brave', name: 'Brave', paths: inRoots('BraveSoftware\\Brave-Browser\\Application\\brave.exe') },
    { id: 'opera', name: 'Opera', paths: inRoots('Programs\\Opera\\opera.exe', [local]).concat(inRoots('Opera\\opera.exe')) },
    { id: 'vivaldi', name: 'Vivaldi', paths: inRoots('Vivaldi\\Application\\vivaldi.exe') },
  ];
}

function macCandidates(): BrowserCandidate[] {
  const home = process.env.HOME || '';
  const app = (name: string) => [path.join('/Applications', name), path.join(home, 'Applications', name)];
  return [
    { id: 'safari', name: 'Safari', paths: app('Safari.app').concat('/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app') },
    { id: 'chrome', name: 'Google Chrome', paths: app('Google Chrome.app') },
    { id: 'coccoc', name: 'Cốc Cốc', paths: app('CocCoc.app') },
    { id: 'edge', name: 'Microsoft Edge', paths: app('Microsoft Edge.app') },
    { id: 'firefox', name: 'Firefox', paths: app('Firefox.app') },
    { id: 'brave', name: 'Brave', paths: app('Brave Browser.app') },
    { id: 'arc', name: 'Arc', paths: app('Arc.app') },
    { id: 'opera', name: 'Opera', paths: app('Opera.app') },
    { id: 'vivaldi', name: 'Vivaldi', paths: app('Vivaldi.app') },
  ];
}

/** Dò các trình duyệt đã cài trong máy (luôn có mục "Trình duyệt mặc định" ở đầu). */
export function detectBrowsers(): BrowserOption[] {
  const list: BrowserOption[] = [{ id: SYSTEM_BROWSER_ID, name: 'Trình duyệt mặc định của máy' }];
  const candidates = process.platform === 'win32' ? winCandidates() : process.platform === 'darwin' ? macCandidates() : [];
  for (const c of candidates) {
    const found = c.paths.find((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });
    if (found) list.push({ id: c.id, name: c.name, path: found });
  }
  return list;
}

/** Mở URL bằng trình duyệt đã chọn; không tìm thấy thì dùng trình duyệt mặc định. */
export async function openUrlInBrowser(
  url: string,
  browserId: string | undefined,
  openDefault: (url: string) => Promise<void>
): Promise<void> {
  if (!browserId || browserId === SYSTEM_BROWSER_ID) return openDefault(url);
  const browser = detectBrowsers().find((b) => b.id === browserId && b.path);
  if (!browser?.path) return openDefault(url);

  await new Promise<void>((resolve, reject) => {
    const child =
      process.platform === 'darwin'
        ? spawn('open', ['-a', browser.path!, url], { detached: true, stdio: 'ignore' })
        : spawn(browser.path!, [url], { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

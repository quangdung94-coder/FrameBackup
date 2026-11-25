import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { hashFileXx64 } from '../lib/hash';
import type { CardIngestRecord, Drive2BackupRecord, ShowLedgerInfo } from '../shared/types';

/**
 * Sổ verify (lưu trong thư mục dữ liệu app, KHÔNG ghi vào ổ của người dùng):
 * - XXHash64 đã tính của từng file (khóa = đường dẫn + dung lượng + giờ sửa). File không đổi => không phải đọc lại.
 * - Mỗi thư mục Show trên Ổ 1: thẻ nào đã chép & verify vào, đã sao lưu Ổ 2 lúc nào.
 * Nhờ vậy chạy lại chuỗi (hoặc chỉ Up Drive) không phải hash lại vài trăm GB đã verify.
 */

interface HashEntry {
  s: number; // size
  m: number; // mtimeMs (làm tròn)
  h: string; // xxhash64 hex
  t: number; // lần dùng gần nhất
}

interface LedgerFile {
  version: 1;
  hashes: Record<string, HashEntry>;
  shows: Record<string, ShowLedgerInfo>;
}

const MAX_HASH_ENTRIES = 300_000;
const SAVE_DELAY_MS = 2_000;

let ledgerPath = '';
let data: LedgerFile = { version: 1, hashes: {}, shows: {} };
let loaded = false;
let saveTimer: NodeJS.Timeout | null = null;

const keyOf = (p: string) => {
  const abs = path.resolve(p);
  return process.platform === 'win32' || process.platform === 'darwin' ? abs.toLowerCase() : abs;
};
const roundMtime = (ms: number) => Math.floor(ms);

export function initVerifyLedger(userDataDir: string) {
  ledgerPath = path.join(userDataDir, 'verify-ledger.json');
  try {
    const raw = fs.readFileSync(ledgerPath, 'utf8');
    const parsed = JSON.parse(raw) as LedgerFile;
    if (parsed && parsed.version === 1 && parsed.hashes && parsed.shows) data = parsed;
  } catch {
    // Chưa có sổ hoặc sổ hỏng => bắt đầu sổ mới
  }
  loaded = true;
}

function prune() {
  const keys = Object.keys(data.hashes);
  if (keys.length <= MAX_HASH_ENTRIES) return;
  keys.sort((a, b) => data.hashes[a].t - data.hashes[b].t);
  for (const k of keys.slice(0, keys.length - Math.floor(MAX_HASH_ENTRIES * 0.8))) delete data.hashes[k];
}

function scheduleSave() {
  if (!ledgerPath || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushVerifyLedger();
  }, SAVE_DELAY_MS);
}

export async function flushVerifyLedger() {
  if (!ledgerPath || !loaded) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  prune();
  const tmp = `${ledgerPath}.tmp`;
  try {
    await fsp.writeFile(tmp, JSON.stringify(data), 'utf8');
    await fsp.rename(tmp, ledgerPath);
  } catch {
    // Không ghi được sổ thì lần sau hash lại — không ảnh hưởng dữ liệu
  }
}

/** Ghi nhận XXHash64 của 1 file vừa được tính / vừa chép xong. */
export function rememberHash(filePath: string, size: number, mtimeMs: number, hash: string) {
  data.hashes[keyOf(filePath)] = { s: size, m: roundMtime(mtimeMs), h: hash, t: Date.now() };
  scheduleSave();
}

/** Quên hash của file (trước khi ghi đè / chép mới). */
export function forgetHash(filePath: string) {
  if (delete data.hashes[keyOf(filePath)]) scheduleSave();
}

/** Hash đã biết nếu file chưa đổi (cùng dung lượng + giờ sửa), ngược lại null. */
export function knownHash(filePath: string, size: number, mtimeMs: number): string | null {
  const e = data.hashes[keyOf(filePath)];
  if (!e || e.s !== size || e.m !== roundMtime(mtimeMs)) return null;
  e.t = Date.now();
  return e.h;
}

/** XXHash64 của file, dùng sổ nếu file chưa đổi. `hit` = true khi lấy từ sổ (không đọc file). */
export async function hashWithLedger(filePath: string, signal: AbortSignal): Promise<{ hash: string; hit: boolean }> {
  const st = await fsp.stat(filePath);
  const cached = knownHash(filePath, st.size, st.mtimeMs);
  if (cached) return { hash: cached, hit: true };
  const hash = await hashFileXx64(filePath, signal);
  rememberHash(filePath, st.size, st.mtimeMs, hash);
  return { hash, hit: false };
}

export function recordCardIngest(showDir: string, rec: CardIngestRecord) {
  const k = keyOf(showDir);
  data.shows[k] = { ...data.shows[k], card: rec };
  scheduleSave();
}

export function recordDrive2Backup(showDir: string, rec: Drive2BackupRecord) {
  const k = keyOf(showDir);
  data.shows[k] = { ...data.shows[k], drive2: rec };
  scheduleSave();
}

export function getShowLedger(showDir: string): ShowLedgerInfo {
  return data.shows[keyOf(showDir)] ?? {};
}

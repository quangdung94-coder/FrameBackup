import { BrowserWindow } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { formatDateTime, formatDisplayDate } from '../shared/dates';
import { formatBytes } from '../shared/format';
import { MEDIA_KIND_LABELS, statsOf } from '../shared/report';
import type {
  BackupReport,
  BuildReportRequest,
  LocationStats,
  ReportBox,
  ShotInfo,
} from '../shared/types';
import { scanFilesRecursive, type FileEntry } from './diskService';
import { getShowLedger } from './verifyLedger';

/**
 * Báo cáo sao lưu cuối cùng — tạo SAU khi up Drive để số file trên Drive là số thật.
 * Xuất 2 bản: _00_BACKUP_REPORT.pdf (chữ to, đọc trên Drive / điện thoại) + _00_BACKUP_REPORT.txt.
 */

export const REPORT_TXT_NAME = '_00_BACKUP_REPORT.txt';
export const REPORT_PDF_NAME = '_00_BACKUP_REPORT.pdf';

const sameKey = (p: string) => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);

async function scanOrNull(dir: string | undefined): Promise<FileEntry[] | null> {
  if (!dir) return null;
  try {
    const st = await fsp.stat(dir);
    if (!st.isDirectory()) return null;
  } catch {
    return null;
  }
  try {
    return await scanFilesRecursive(dir, false);
  } catch {
    return null;
  }
}

/** File của Ổ 1 chưa có ở Ổ 2 (so đường dẫn tương đối + dung lượng). */
function missingInMirror(source: FileEntry[], mirror: FileEntry[]): FileEntry[] {
  const have = new Map<string, number>();
  for (const f of mirror) {
    const k = `${sameKey(f.relativePath.replace(/\\/g, '/'))}|${f.sizeBytes}`;
    have.set(k, (have.get(k) ?? 0) + 1);
  }
  const missing: FileEntry[] = [];
  for (const f of source) {
    const k = `${sameKey(f.relativePath.replace(/\\/g, '/'))}|${f.sizeBytes}`;
    const n = have.get(k) ?? 0;
    if (n > 0) have.set(k, n - 1);
    else missing.push(f);
  }
  return missing;
}

const listNames = (files: FileEntry[], max = 4) =>
  files.length <= max ? files.map((f) => f.name).join(', ') : `${files.slice(0, max).map((f) => f.name).join(', ')} … (+${files.length - max})`;

interface Analysis {
  verdict: 'ok' | 'warn';
  headline: string;
  subline: string;
  boxes: ReportBox[];
  autoNotes: string[];
}

function analyse(
  req: BuildReportRequest,
  d1Files: FileEntry[],
  d2Files: FileEntry[] | null
): Analysis {
  const ledger = getShowLedger(req.drive1Dir);
  const card = req.card ?? ledger.card ?? null;
  const d1 = statsOf(d1Files);
  const autoNotes: string[] = [];
  const problems: string[] = [];

  // --- Thẻ ---
  const cardBox: ReportBox = card
    ? {
        key: 'card',
        title: 'Thẻ nhớ',
        state: 'source',
        stats: { files: card.files, bytes: card.bytes, byType: card.byType },
        expectedFiles: card.files,
        status: card.hashVerified ? 'Bản gốc' : 'Bản gốc (chép ngoài app)',
        path: card.sourceDir,
      }
    : {
        key: 'card',
        title: 'Thẻ nhớ',
        state: 'none',
        stats: null,
        status: 'Không có thẻ trong lượt này (up từ Ổ 1)',
      };

  // --- Ổ 1 ---
  const expected = card?.files ?? d1.files;
  const d1Missing = card ? Math.max(0, card.files - d1.files) : 0;
  let d1Box: ReportBox;
  if (!card) {
    d1Box = { key: 'drive1', title: 'Ổ 1', state: 'source', stats: d1, expectedFiles: d1.files, status: 'Bản làm việc', path: req.drive1Dir };
  } else if (d1Missing > 0) {
    d1Box = { key: 'drive1', title: 'Ổ 1', state: 'error', stats: d1, expectedFiles: expected, status: `✗ Thiếu ${d1Missing} file`, path: req.drive1Dir };
    problems.push(`Ổ 1 thiếu ${d1Missing} file so với thẻ`);
    autoNotes.push(
      `Ổ 1 mới có ${d1.files}/${card.files} file của thẻ. Hay gặp khi file được chép vào thư mục khác (vd. thư mục Show bị lồng 2 lần) hoặc chưa chép xong.`
    );
  } else {
    d1Box = {
      key: 'drive1',
      title: 'Ổ 1',
      state: 'ok',
      stats: d1,
      expectedFiles: expected,
      status: card.hashVerified ? '✓ Khớp thẻ (XXHash64)' : '✓ Đủ file (so tên + dung lượng)',
      path: req.drive1Dir,
    };
  }
  const d1Short = d1Box.state === 'error';

  // --- Ổ 2 ---
  let d2Box: ReportBox;
  if (!req.drive2Dir) {
    d2Box = { key: 'drive2', title: 'Ổ 2', state: 'none', stats: null, status: 'Không dùng Ổ 2' };
  } else if (!d2Files || d2Files.length === 0) {
    d2Box = {
      key: 'drive2',
      title: 'Ổ 2',
      state: 'warn',
      stats: d2Files ? statsOf(d2Files) : null,
      expectedFiles: expected,
      status: 'Chưa sao lưu Ổ 2',
      path: req.drive2Dir,
    };
    autoNotes.push('Ổ 2 chưa có bản sao lưu của Show này.');
  } else {
    const miss = missingInMirror(d1Files, d2Files);
    const d2 = statsOf(d2Files);
    const ledgerOk =
      ledger.drive2 && sameKey(path.resolve(ledger.drive2.destDir)) === sameKey(path.resolve(req.drive2Dir)) && ledger.drive2.files >= d1.files;
    const verified = req.drive2VerifiedNow || ledgerOk;
    if (miss.length > 0) {
      d2Box = { key: 'drive2', title: 'Ổ 2', state: 'error', stats: d2, expectedFiles: expected, status: `✗ Thiếu ${miss.length} file so với Ổ 1`, path: req.drive2Dir };
      problems.push(`Ổ 2 thiếu ${miss.length} file so với Ổ 1`);
      autoNotes.push(`Ổ 2 thiếu: ${listNames(miss)}.`);
    } else {
      d2Box = {
        key: 'drive2',
        title: 'Ổ 2',
        state: d1Short ? 'warn' : 'ok',
        stats: d2,
        expectedFiles: expected,
        status: d1Short
          ? '✓ Khớp Ổ 1, nhưng Ổ 1 thiếu'
          : verified
          ? '✓ Khớp Ổ 1 (XXHash64)'
          : '✓ Đủ file (so tên + dung lượng)',
        path: req.drive2Dir,
      };
    }
  }

  // --- Google Drive ---
  let driveBox: ReportBox;
  const dr = req.drive;
  const drivePath = [dr.folderName, dr.link].filter(Boolean).join(' · ') || undefined;
  if (dr.status === 'skipped') {
    driveBox = { key: 'drive', title: 'Google Drive', state: 'none', stats: null, status: 'Chưa up Drive', path: drivePath };
  } else if (dr.status !== 'uploaded') {
    driveBox = {
      key: 'drive',
      title: 'Google Drive',
      state: 'error',
      stats: null,
      expectedFiles: expected,
      status: dr.status === 'cancelled' ? '✗ Đã hủy upload' : '✗ Upload lỗi',
      path: drivePath,
    };
    problems.push(dr.status === 'cancelled' ? 'Upload Drive đã bị hủy' : 'Upload Drive bị lỗi');
    if (dr.error) autoNotes.push(`Lỗi upload Drive: ${dr.error}`);
  } else {
    const files = dr.files ?? d1.files;
    const isPartialSelection = Boolean(req.selectedUploadOnly);
    const expectedForDrive = isPartialSelection ? files : d1.files;
    const full = isPartialSelection ? files > 0 : files >= d1.files;
    const stats: LocationStats = !isPartialSelection && full ? { ...d1 } : { files, bytes: dr.bytes ?? 0, byType: { ...d1.byType } };
    if (!full) {
      driveBox = {
        key: 'drive',
        title: 'Google Drive',
        state: 'error',
        stats,
        expectedFiles: expectedForDrive,
        status: `✗ Thiếu ${d1.files - files} file`,
        path: drivePath,
      };
      problems.push(`Drive thiếu ${d1.files - files} file so với Ổ 1`);
    } else {
      driveBox = {
        key: 'drive',
        title: 'Google Drive',
        state: d1Short ? 'warn' : 'ok',
        stats,
        expectedFiles: expectedForDrive,
        status: isPartialSelection
          ? `✓ Đã up ${files} file chọn lọc (MD5)`
          : d1Short
          ? '✓ Khớp Ổ 1, nhưng thiếu'
          : '✓ Khớp Ổ 1 (MD5)',
        path: drivePath,
      };
    }
  }

  const boxes = [cardBox, d1Box, d2Box, driveBox];
  const copyBoxes = [d1Box, d2Box, driveBox].filter((b) => b.state === 'ok' || (b === d1Box && b.state === 'source'));
  const copyNames = copyBoxes.map((b) => b.title);
  let verdict: 'ok' | 'warn';
  let headline: string;
  let subline: string;
  if (problems.length > 0) {
    verdict = 'warn';
    headline = `⚠️ CHƯA AN TOÀN – ${problems[0]}`;
    subline = card
      ? `Thẻ có ${card.files} file nhưng ${problems.join('; ').toLowerCase()}. Chưa nên format thẻ.`
      : `${problems.join('; ')}.`;
  } else if (copyBoxes.length < 2) {
    verdict = 'warn';
    headline = `⚠️ MỚI CÓ ${copyBoxes.length} BẢN (${copyNames.join(', ') || 'chưa có'})`;
    subline = card
      ? `Thẻ có ${card.files} file, mới lưu ở ${copyNames.join(', ') || 'chưa nơi nào'}. Nên có ít nhất 2 bản trước khi format thẻ.`
      : 'Nên có ít nhất 2 bản (Ổ 2 hoặc Google Drive).';
  } else {
    verdict = 'ok';
    const allVerified = copyBoxes.every((b) => /XXHash64|MD5/.test(b.status) || b.state === 'source');
    headline = `✅ AN TOÀN – đủ ${copyBoxes.length} bản${allVerified ? ', tất cả đã verify' : ''}`;
    subline = card
      ? `Thẻ có ${card.files} file. ${copyNames.join(', ')} đều đủ ${card.files} file. Có thể format thẻ.`
      : `${copyNames.join(', ')} đều đủ ${d1.files} file.`;
  }

  return { verdict, headline, subline, boxes, autoNotes };
}

// ---------------------------------------------------------------------------
// Xuất HTML (cho PDF + xem trước trong app) và TXT
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmtNum = (n: number) => n.toLocaleString('vi-VN');
const timeOf = (ms: number) => formatDateTime(ms).split(' ')[1] ?? '';

const STATE_CLASS: Record<ReportBox['state'], string> = { ok: 'ok', warn: 'warn', error: 'bad', source: '', none: 'off' };

function renderHtml(req: BuildReportRequest, a: Analysis, generatedAt: number, notes: string[]): string {
  const sub = [req.shootDate ? `Ngày quay ${formatDisplayDate(req.shootDate)}` : '', `Báo cáo lúc ${formatDateTime(generatedAt)}`]
    .filter(Boolean)
    .join(' · ');
  const tiles = a.boxes
    .map((b) => {
      const num = b.stats ? fmtNum(b.stats.files) : '—';
      const of = b.stats && b.expectedFiles !== undefined ? `<span> / ${fmtNum(b.expectedFiles)} file</span>` : b.stats ? '<span> file</span>' : '';
      const size = b.stats ? formatBytes(b.stats.bytes) : '&nbsp;';
      return `<div class="tile ${STATE_CLASS[b.state]}"><div class="lbl">${esc(b.title)}</div><div class="num">${num}${of}</div><div class="size">${size}</div><div class="st">${esc(b.status)}</div></div>`;
    })
    .join('');

  const ref = a.boxes[0].stats ?? a.boxes[1].stats;
  const rows = MEDIA_KIND_LABELS.map(([kind, label]) => {
    const refVal = ref?.byType[kind] ?? 0;
    const cells = a.boxes
      .map((b) => {
        if (!b.stats) return '<td class="dim">—</td>';
        const v = b.stats.byType[kind];
        return `<td class="${v < refVal ? 'miss' : ''}">${fmtNum(v)}</td>`;
      })
      .join('');
    return `<tr><td>${label}</td>${cells}</tr>`;
  }).join('');
  const refTotal = ref?.files ?? 0;
  const totals = a.boxes
    .map((b) => (b.stats ? `<td class="${b.stats.files < refTotal ? 'miss' : ''}">${fmtNum(b.stats.files)}</td>` : '<td class="dim">—</td>'))
    .join('');

  const shot = (s: ShotInfo | null, label: string) =>
    s
      ? `<div class="shot"><div class="thumb">${
          s.thumbnailDataUrl ? `<img src="${s.thumbnailDataUrl}" alt="">` : `<span>${label}</span>`
        }</div><div class="cap"><b>${esc(timeOf(s.shotTimeMs))}</b>${esc(s.name)}</div></div>`
      : `<div class="shot"><div class="thumb"><span>Không có file media</span></div><div class="cap"><b>—</b>${label}</div></div>`;

  const pathRows = a.boxes
    .filter((b) => b.path)
    .map((b) => `<tr><td>${esc(b.title)}</td><td><code>${esc(b.path!)}</code></td></tr>`)
    .join('');

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(req.projectName)} – Báo cáo sao lưu</title><style>
:root{--fg:#17171c;--muted:#5d5d68;--line:#e3e3ea;--ok:#0f9f6e;--okbg:#e6f7f0;--warn:#b45309;--warnbg:#fff4e0;--bad:#c62828}
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:var(--fg);font:17px/1.5 "Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.paper{max-width:900px;margin:0 auto;padding:24px 26px 30px}
.head{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid var(--line);padding-bottom:12px}
.head h1{margin:0;font-size:30px;line-height:1.2;word-break:break-word}
.head .sub{color:var(--muted);font-size:16px;margin-top:4px}
.brand{color:var(--muted);font-size:14px;text-align:right;white-space:nowrap}
.verdict{margin:18px 0;border-radius:10px;padding:14px 18px;font-size:22px;font-weight:700}
.verdict small{display:block;font-size:16px;font-weight:400;margin-top:4px;color:var(--fg)}
.verdict.ok{background:var(--okbg);color:var(--ok)}
.verdict.warn{background:var(--warnbg);color:var(--warn)}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.tile{border:2px solid var(--line);border-radius:10px;padding:12px 12px 10px;break-inside:avoid}
.tile .lbl{font-size:14px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.02em}
.tile .num{font-size:38px;font-weight:800;line-height:1.1;margin:6px 0 2px;font-variant-numeric:tabular-nums}
.tile .num span{font-size:18px;color:var(--muted);font-weight:600}
.tile .size{font-size:16px;color:var(--muted)}
.tile .st{margin-top:8px;font-size:15px;font-weight:600}
.tile.ok{border-color:var(--ok)}.tile.ok .st{color:var(--ok)}
.tile.warn{border-color:var(--warn)}.tile.warn .st{color:var(--warn)}
.tile.bad{border-color:var(--bad)}.tile.bad .st{color:var(--bad)}
.tile.off{opacity:.6}
h2{font-size:21px;margin:24px 0 8px}
table{width:100%;border-collapse:collapse;font-size:17px}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums}
th:first-child,td:first-child{text-align:left}
th{font-size:14px;color:var(--muted);text-transform:uppercase}
tfoot td{font-weight:800;border-top:2px solid var(--fg);border-bottom:none}
td.miss{color:var(--bad);font-weight:700}
td.dim{color:var(--muted)}
.shots{display:grid;grid-template-columns:1fr 1fr;gap:12px;break-inside:avoid}
.shot{border:1px solid var(--line);border-radius:10px;overflow:hidden}
.thumb{aspect-ratio:16/9;background:#2b3a55;display:grid;place-items:center;color:#fff;font-size:15px;overflow:hidden}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.cap{padding:8px 12px;font-size:16px;word-break:break-all}
.cap b{display:block;font-size:18px}
.notes li{margin:5px 0}
.paths td{text-align:left;font-size:15px}
.paths td:first-child{width:120px;color:var(--muted);font-weight:600}
code{font-family:Consolas,ui-monospace,Menlo,monospace;font-size:.92em;word-break:break-all}
.foot{margin-top:24px;color:var(--muted);font-size:14px;border-top:1px solid var(--line);padding-top:10px}
@media (max-width:720px){.grid{grid-template-columns:1fr 1fr}.shots{grid-template-columns:1fr}.head h1{font-size:24px}}
</style></head><body><div class="paper">
<div class="head"><div><h1>${esc(req.projectName)}</h1><div class="sub">${esc(sub)}</div></div><div class="brand">FrameBackup<br>Báo cáo sao lưu</div></div>
<div class="verdict ${a.verdict}">${esc(a.headline)}<small>${esc(a.subline)}</small></div>
<div class="grid">${tiles}</div>
<h2>Số file theo loại</h2>
<table><thead><tr><th>Loại</th><th>Thẻ</th><th>Ổ 1</th><th>Ổ 2</th><th>Drive</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td>Tổng</td>${totals}</tr></tfoot></table>
<h2>Shot đầu – Shot cuối</h2>
<div class="shots">${shot(req.firstShot, 'Shot đầu')}${shot(req.lastShot, 'Shot cuối')}</div>
${notes.length ? `<h2>Ghi chú</h2><ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
${pathRows ? `<h2>Vị trí lưu</h2><table class="paths"><tbody>${pathRows}</tbody></table>` : ''}
<div class="foot">“Verify” = FrameBackup tự so mã XXHash64 (ổ cứng) hoặc MD5 (Google Drive) của từng file với bản gốc. File báo cáo và 2 ảnh thumbnail không tính vào số file.</div>
</div></body></html>`;
}

function renderText(req: BuildReportRequest, a: Analysis, generatedAt: number, notes: string[]): string {
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  const line = '='.repeat(64);
  const val = (b: ReportBox, k?: keyof LocationStats['byType']) => (b.stats ? String(k ? b.stats.byType[k] : b.stats.files) : '—');
  const out: string[] = [
    line,
    '  BÁO CÁO SAO LƯU – FRAMEBACKUP',
    `  Show      : ${req.projectName}`,
    `  Ngày quay : ${req.shootDate ? formatDisplayDate(req.shootDate) : '—'}        Lập lúc: ${formatDateTime(generatedAt)}`,
    line,
    '',
    `  KẾT LUẬN: ${a.headline.replace(/^[^\p{L}]+/u, '')}`,
    `  ${a.subline}`,
    '',
    '  NƠI LƯU        SỐ FILE       DUNG LƯỢNG   KIỂM TRA',
    '  ------------   -----------   ----------   -----------------------',
    ...a.boxes.map(
      (b) =>
        '  ' +
        pad(b.title, 15) +
        pad(b.stats ? `${b.stats.files}${b.expectedFiles !== undefined ? ` / ${b.expectedFiles}` : ''}` : '—', 14) +
        pad(b.stats ? formatBytes(b.stats.bytes) : '—', 13) +
        b.status
    ),
    '',
    '  THEO LOẠI            THẺ    Ổ 1    Ổ 2    DRIVE',
    '  ------------------   ----   ----   ----   -----',
    ...MEDIA_KIND_LABELS.map(([k, label]) => '  ' + pad(label, 21) + a.boxes.map((b, i) => (i < 3 ? pad(val(b, k), 7) : val(b, k))).join('')),
    '  ' + pad('Tổng', 21) + a.boxes.map((b, i) => (i < 3 ? pad(val(b), 7) : val(b))).join(''),
    '',
    `  SHOT ĐẦU : ${req.firstShot ? `${formatDateTime(req.firstShot.shotTimeMs)}  ${req.firstShot.name}` : '(không có file media)'}`,
    `  SHOT CUỐI: ${req.lastShot ? `${formatDateTime(req.lastShot.shotTimeMs)}  ${req.lastShot.name}` : '(không có file media)'}`,
  ];
  if (req.firstShot?.thumbnailFileName || req.lastShot?.thumbnailFileName) {
    out.push(`  Thumbnail: ${[req.firstShot?.thumbnailFileName, req.lastShot?.thumbnailFileName].filter(Boolean).join(', ')}`);
  }
  if (notes.length) {
    out.push('', '  GHI CHÚ', ...notes.map((n) => `  - ${n}`));
  }
  const paths = a.boxes.filter((b) => b.path);
  if (paths.length) {
    out.push('', ...paths.map((b) => `  ${pad(b.title, 13)}: ${b.path}`));
  }
  out.push(line);
  return out.join('\n');
}

/** In HTML ra PDF bằng Chromium của Electron (cửa sổ ẩn). */
async function htmlToPdf(html: string, outPath: string): Promise<boolean> {
  const tmpHtml = `${outPath}.html`;
  let win: BrowserWindow | null = null;
  try {
    await fsp.writeFile(tmpHtml, html, 'utf8');
    win = new BrowserWindow({
      show: false,
      width: 1000,
      height: 1400,
      webPreferences: { javascript: false, sandbox: true, contextIsolation: true },
    });
    await win.loadFile(tmpHtml);
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    });
    await fsp.writeFile(outPath, pdf);
    return true;
  } catch {
    return false;
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    await fsp.unlink(tmpHtml).catch(() => {});
  }
}

export async function buildBackupReport(req: BuildReportRequest): Promise<BackupReport> {
  await fsp.mkdir(req.stagingDir, { recursive: true });
  const d1Files = (await scanOrNull(req.drive1Dir)) ?? [];
  const d2Files = await scanOrNull(req.drive2Dir);
  const analysis = analyse(req, d1Files, d2Files);
  const notes = [...analysis.autoNotes, ...(req.notes ?? [])];
  const generatedAt = Date.now();

  const html = renderHtml(req, analysis, generatedAt, notes);
  const text = renderText(req, analysis, generatedAt, notes);

  const txtPath = path.join(req.stagingDir, REPORT_TXT_NAME);
  await fsp.writeFile(txtPath, text, 'utf8');
  const pdfPath = path.join(req.stagingDir, REPORT_PDF_NAME);
  const pdfOk = await htmlToPdf(html, pdfPath);

  return {
    verdict: analysis.verdict,
    headline: analysis.headline,
    subline: analysis.subline,
    boxes: analysis.boxes,
    txtPath,
    txtFileName: REPORT_TXT_NAME,
    pdfPath: pdfOk ? pdfPath : undefined,
    pdfFileName: pdfOk ? REPORT_PDF_NAME : undefined,
    text,
    html,
  };
}

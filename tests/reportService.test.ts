import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('electron', () => ({
  BrowserWindow: class MockBrowserWindow {
    loadFile = vi.fn().mockResolvedValue(undefined);
    webContents = { printToPDF: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock')) };
    isDestroyed = () => false;
    destroy = vi.fn();
  },
}));

import { buildBackupReport } from '../electron/services/reportService';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-report-test-'));
});

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

describe('reportService', () => {
  it('produces ok verdict when Drive 1, Drive 2, and Google Drive all match', async () => {
    const d1 = path.join(tmpRoot, 'D1');
    const d2 = path.join(tmpRoot, 'D2');
    const staging = path.join(tmpRoot, 'staging');
    await fsp.mkdir(d1, { recursive: true });
    await fsp.mkdir(d2, { recursive: true });
    await fsp.writeFile(path.join(d1, 'A.MP4'), Buffer.from('12345'));
    await fsp.writeFile(path.join(d2, 'A.MP4'), Buffer.from('12345'));

    const report = await buildBackupReport({
      projectName: 'Show OK',
      drive1Dir: d1,
      drive2Dir: d2,
      drive2VerifiedNow: true,
      drive: { status: 'uploaded', files: 1, bytes: 5, folderName: 'DriveFolder' },
      firstShot: null,
      lastShot: null,
      stagingDir: staging,
    });

    expect(report.verdict).toBe('ok');
    expect(report.pdfFileName).toBe('_00_BACKUP_REPORT.pdf');
    expect(report.boxes[3].state).toBe('ok');
  });

  it('produces ok verdict for selectedUploadOnly partial upload from Drive 2', async () => {
    const d1 = path.join(tmpRoot, 'D1');
    const d2 = path.join(tmpRoot, 'D2');
    const staging = path.join(tmpRoot, 'staging2');
    await fsp.mkdir(d1, { recursive: true });
    await fsp.mkdir(d2, { recursive: true });
    await fsp.writeFile(path.join(d1, 'A.MP4'), Buffer.from('111'));
    await fsp.writeFile(path.join(d1, 'B.MP4'), Buffer.from('222'));
    await fsp.writeFile(path.join(d2, 'A.MP4'), Buffer.from('111'));
    await fsp.writeFile(path.join(d2, 'B.MP4'), Buffer.from('222'));

    const report = await buildBackupReport({
      projectName: 'Show Partial',
      drive1Dir: d1,
      drive2Dir: d2,
      drive2VerifiedNow: false,
      selectedUploadOnly: true,
      drive: { status: 'uploaded', files: 1, bytes: 3, folderName: 'DriveFolder' },
      firstShot: null,
      lastShot: null,
      stagingDir: staging,
    });

    expect(report.verdict).toBe('ok');
    expect(report.boxes[3].state).toBe('ok');
    expect(report.boxes[3].status).toContain('chọn lọc');
  });
});

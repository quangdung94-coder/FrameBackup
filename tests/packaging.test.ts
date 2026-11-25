import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { packageForDrive } from '../electron/services/packagingService';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-pack-test-'));
});

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  await fsp.rm(path.join(tmpRoot, '.framebackup_pack_tmp'), { recursive: true, force: true }).catch(() => {});
});

describe('packagingService', () => {
  it('returns loose files in none mode', async () => {
    const src = path.join(tmpRoot, 'Show');
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, 'clip1.mp4'), Buffer.from('vid1'));
    await fsp.writeFile(path.join(src, 'img1.jpg'), Buffer.from('jpg1'));

    const res = await packageForDrive(
      { projectName: 'TestShow', sourceDir: src, packMode: 'none' },
      () => {}
    );
    expect(res.success).toBe(true);
    expect(res.archivePaths).toHaveLength(0);
    expect(res.looseFilePaths).toHaveLength(2);
  });

  it('packs photos into Zip Store and keeps videos loose in video-raw-smart mode', async () => {
    const src = path.join(tmpRoot, 'ShowSmart');
    await fsp.mkdir(src, { recursive: true });
    const v1 = path.join(src, 'clip1.mp4');
    const p1 = path.join(src, 'img1.jpg');
    const p2 = path.join(src, 'img2.arw');
    await fsp.writeFile(v1, Buffer.from('video-data'));
    await fsp.writeFile(p1, Buffer.from('photo-data-1'));
    await fsp.writeFile(p2, Buffer.from('raw-data-2'));

    const res = await packageForDrive(
      { projectName: 'TestSmart', sourceDir: src, packMode: 'video-raw-smart' },
      () => {}
    );
    expect(res.success).toBe(true);
    expect(res.archivePaths).toHaveLength(1);
    expect(res.archivePaths[0]).toMatch(/_Photos_Store\.zip$/);
    expect(res.looseFilePaths).toEqual([v1]);

    // Cleanup staging archive created on same drive
    for (const ap of res.archivePaths) await fsp.unlink(ap).catch(() => {});
  });

  it('packages only selectedFilePaths when provided', async () => {
    const src = path.join(tmpRoot, 'ShowSubset');
    await fsp.mkdir(src, { recursive: true });
    const f1 = path.join(src, 'keep.mp4');
    const f2 = path.join(src, 'skip.mp4');
    await fsp.writeFile(f1, Buffer.from('keep'));
    await fsp.writeFile(f2, Buffer.from('skip'));

    const res = await packageForDrive(
      { projectName: 'TestSubset', sourceDir: src, packMode: 'zip-store', selectedFilePaths: [f1] },
      () => {}
    );
    expect(res.success).toBe(true);
    expect(res.sourceFiles).toBe(1);
    expect(res.archivePaths).toHaveLength(1);

    for (const ap of res.archivePaths) await fsp.unlink(ap).catch(() => {});
  });
});

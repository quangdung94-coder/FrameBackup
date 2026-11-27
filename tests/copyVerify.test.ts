import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertNonOverlappingDirs, planCopy, preflightCopy } from '../electron/services/copyPlan';
import { runCopyAndVerify } from '../electron/services/copyVerifyService';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-copy-test-'));
});

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

describe('copyPlan & copyVerifyService', () => {
  it('blocks overlapping source and destination directories', () => {
    const dir = path.join(tmpRoot, 'Show');
    expect(() => assertNonOverlappingDirs(dir, dir)).toThrow();
    expect(() => assertNonOverlappingDirs(dir, path.join(dir, 'sub'))).toThrow();
  });

  it('flattens card paths, includes uppercase Sony .XML sidecars, and renames batch duplicates', async () => {
    const card = path.join(tmpRoot, 'CARD');
    const dest = path.join(tmpRoot, 'D1');
    const dirA = path.join(card, 'PRIVATE', 'M4ROOT', 'CLIP');
    const dirB = path.join(card, 'PRIVATE', '101MSDCF');
    await fsp.mkdir(dirA, { recursive: true });
    await fsp.mkdir(dirB, { recursive: true });

    await fsp.writeFile(path.join(dirA, 'C0001.MP4'), Buffer.from('video-a'));
    await fsp.writeFile(path.join(dirA, 'C0001M01.XML'), Buffer.from('<xml/>'));
    await fsp.writeFile(path.join(dirB, 'C0001.MP4'), Buffer.from('video-b'));

    const plan = await planCopy({
      stage: 'card-to-drive1',
      sourceDir: card,
      destDir: dest,
      allowedExtensions: ['.mp4'],
      includeSidecarXml: true,
    });

    expect(plan.files.length).toBe(3);
    expect(plan.batchDuplicateNames).toBe(1);
    const dests = Array.from(plan.preferredDest.values()).map((p) => path.relative(dest, p));
    expect(dests).toContain('C0001.MP4');
    expect(dests).toContain('C0001 (2).MP4');
    expect(dests).toContain('C0001M01.XML');
  });

  it('copies files atomically with XXHash64 verify and supports Smart Resume', async () => {
    const src = path.join(tmpRoot, 'SRC');
    const dst = path.join(tmpRoot, 'DST');
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, 'A.MP4'), Buffer.from('hello-xxhash-1'));
    await fsp.writeFile(path.join(src, 'B.JPG'), Buffer.from('hello-xxhash-2'));

    const first = await runCopyAndVerify(
      { stage: 'drive1-to-drive2', sourceDir: src, destDir: dst },
      () => {}
    );
    expect(first.success).toBe(true);
    expect(first.copiedFiles).toBe(2);
    expect(first.verifiedFiles).toBe(2);

    // Second run with identical content should Smart Resume without recopying
    const second = await runCopyAndVerify(
      { stage: 'drive1-to-drive2', sourceDir: src, destDir: dst },
      () => {}
    );
    expect(second.success).toBe(true);
    expect(second.resumedFiles).toBe(2);
    expect(second.copiedFiles).toBe(0);

    // Preflight detects conflict if source changes size
    await fsp.writeFile(path.join(src, 'A.MP4'), Buffer.from('changed-size-content'));
    const pre = await preflightCopy({ stage: 'drive1-to-drive2', sourceDir: src, destDir: dst });
    expect(pre.ok).toBe(true);
    expect(pre.conflicts.some((c) => c.name === 'A.MP4' && !c.sameSize)).toBe(true);
  });

  it('pipelines XXHash64 verification across multiple files without leaving .fbpart files', async () => {
    const src = path.join(tmpRoot, 'MULTI_SRC');
    const dst = path.join(tmpRoot, 'MULTI_DST');
    await fsp.mkdir(src, { recursive: true });
    for (let i = 1; i <= 8; i++) {
      await fsp.writeFile(path.join(src, `CLIP_${i}.MP4`), Buffer.alloc(64 * 1024, i));
    }

    const res = await runCopyAndVerify(
      { stage: 'card-to-drive1', sourceDir: src, destDir: dst },
      () => {}
    );
    expect(res.success).toBe(true);
    expect(res.copiedFiles).toBe(8);
    expect(res.verifiedFiles).toBe(8);
    expect(res.orphanPartFiles ?? []).toHaveLength(0);

    const outNames = await fsp.readdir(dst);
    expect(outNames.filter((n) => n.endsWith('.fbpart'))).toHaveLength(0);
    expect(outNames).toHaveLength(8);
  });
});

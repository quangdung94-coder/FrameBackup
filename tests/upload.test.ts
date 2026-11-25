import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const mockGetAccessToken = vi.fn().mockResolvedValue({ token: 'mock-token' });
const mockListRemoteFiles = vi.fn();
const mockEnsureSubfolder = vi.fn();

vi.mock('../electron/services/googleDrive/auth', () => ({
  getAuthorizedOAuthClient: vi.fn().mockImplementation(async () => ({
    getAccessToken: mockGetAccessToken,
  })),
}));

vi.mock('../electron/services/googleDrive/folders', () => ({
  listRemoteFilesInFolder: (...args: unknown[]) => mockListRemoteFiles(...args),
  ensureRemoteSubfolder: (...args: unknown[]) => mockEnsureSubfolder(...args),
}));

import { uploadProjectToDrive } from '../electron/services/googleDrive/upload';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-upload-test-'));
  mockListRemoteFiles.mockReset();
  mockEnsureSubfolder.mockReset();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

describe('googleDrive upload', () => {
  it('skips files already on Drive with matching size and MD5, and uploads new files with MD5 check', async () => {
    const fExisting = path.join(tmpRoot, 'existing.mp4');
    const fNew = path.join(tmpRoot, 'new.mp4');
    const bufExisting = Buffer.from('already-on-drive');
    const bufNew = Buffer.from('brand-new-video-content');
    await fsp.writeFile(fExisting, bufExisting);
    await fsp.writeFile(fNew, bufNew);

    const existingMd5 = crypto.createHash('md5').update(bufExisting).digest('hex');
    const newMd5 = crypto.createHash('md5').update(bufNew).digest('hex');

    mockListRemoteFiles.mockResolvedValue(
      new Map([['existing.mp4', { id: 'remote-1', sizeBytes: bufExisting.length, md5: existingMd5 }]])
    );

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && String(url).includes('uploadType=resumable')) {
        return new Response(null, { status: 200, headers: { location: 'https://upload.example/session1' } });
      }
      if (init?.method === 'PUT' && String(url) === 'https://upload.example/session1') {
        return new Response(JSON.stringify({ id: 'remote-new', md5Checksum: newMd5 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch: ${init?.method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await uploadProjectToDrive(
      {
        parentFolderId: 'folder-root',
        items: [
          { localPath: fExisting, remoteName: 'existing.mp4' },
          { localPath: fNew, remoteName: 'new.mp4' },
        ],
      },
      () => {}
    );

    expect(res.success).toBe(true);
    expect(res.filesUploaded).toBe(2);
    expect(res.dedupedFiles).toBe(1);
    expect(mockListRemoteFiles).toHaveBeenCalledTimes(1);
  });

  it('fails fast when a source file is missing', async () => {
    const res = await uploadProjectToDrive(
      {
        parentFolderId: 'folder-root',
        items: [{ localPath: path.join(tmpRoot, 'does-not-exist.mp4'), remoteName: 'missing.mp4' }],
      },
      () => {}
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain('Không tìm thấy 1 file nguồn');
  });
});

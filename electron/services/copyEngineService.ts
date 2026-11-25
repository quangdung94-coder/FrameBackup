import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileAsync } from '../lib/exec';
import { runAbortableProcess } from '../lib/process';
import { unlinkQuietly, writeTempListFile } from '../lib/tempFiles';
import type { CopyEngineId, CopyEngineOption } from '../shared/types';

export type { CopyEngineId, CopyEngineOption } from '../shared/types';

/**
 * Normalizes a directory path for Windows CLI tools like Robocopy so trailing backslashes
 * never escape closing quotes in Windows CommandLineToArgvW parsing (e.g. "G:\" -> "G:\.").
 */
function safeWindowsCliDir(dirPath: string): string {
  const resolved = path.resolve(dirPath);
  if (/^[A-Za-z]:\\$/.test(resolved)) {
    return `${resolved}.`;
  }
  return resolved.replace(/\\+$/, '');
}

async function findExecutable(candidates: string[], whichName?: string): Promise<string | undefined> {
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  if (whichName) {
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      const { stdout } = await execFileAsync(cmd, [whichName], { windowsHide: true });
      const firstLine = stdout.trim().split(/\r?\n/)[0]?.trim();
      if (firstLine && fs.existsSync(firstLine)) return firstLine;
    } catch {
      // Not in PATH
    }
  }
  return undefined;
}

export async function detectCopyEngines(): Promise<CopyEngineOption[]> {
  const engines: CopyEngineOption[] = [
    {
      id: 'builtin',
      name: 'FrameBackup Built-in (XXHash64)',
      description: 'Mặc định — Hỗ trợ Date Guard, Smart Resume, thanh % thật & Verify XXHash64',
      available: true,
      platform: 'all',
    },
  ];

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    const [teraPath, roboPath, fastPath] = await Promise.all([
      findExecutable(
        [
          path.join(programFiles, 'TeraCopy', 'TeraCopy.exe'),
          path.join(programFilesX86, 'TeraCopy', 'TeraCopy.exe'),
          path.join(localAppData, 'TeraCopy', 'TeraCopy.exe'),
        ],
        'TeraCopy.exe'
      ),
      findExecutable(['C:\\Windows\\System32\\robocopy.exe'], 'robocopy.exe'),
      findExecutable(
        [
          path.join(programFiles, 'FastCopy', 'FastCopy.exe'),
          path.join(localAppData, 'FastCopy', 'FastCopy.exe'),
        ],
        'FastCopy.exe'
      ),
    ]);

    engines.push(
      {
        id: 'teracopy',
        name: 'TeraCopy',
        description: 'Gọi trực tiếp TeraCopy trên Windows',
        available: Boolean(teraPath),
        executablePath: teraPath,
        platform: 'win32',
      },
      {
        id: 'robocopy',
        name: 'Robocopy (Windows)',
        description: 'Trình copy đa luồng có sẵn trên Windows (/MT:8)',
        available: Boolean(roboPath),
        executablePath: roboPath,
        platform: 'win32',
      },
      {
        id: 'fastcopy',
        name: 'FastCopy',
        description: 'Gọi trực tiếp FastCopy kèm Verify trên Windows',
        available: Boolean(fastPath),
        executablePath: fastPath,
        platform: 'win32',
      }
    );
  } else if (process.platform === 'darwin') {
    const [rsyncPath, dittoPath] = await Promise.all([
      findExecutable(['/usr/bin/rsync', '/opt/homebrew/bin/rsync', '/usr/local/bin/rsync'], 'rsync'),
      findExecutable(['/usr/bin/ditto'], 'ditto'),
    ]);

    engines.push(
      {
        id: 'rsync',
        name: 'rsync (macOS)',
        description: 'Trình đồng bộ chuẩn macOS (hỗ trợ lọc file & giữ metadata)',
        available: Boolean(rsyncPath),
        executablePath: rsyncPath,
        platform: 'darwin',
      },
      {
        id: 'ditto',
        name: 'ditto (macOS)',
        description: 'Trình copy gốc của Apple giữ nguyên resource forks',
        available: Boolean(dittoPath),
        executablePath: dittoPath,
        platform: 'darwin',
      }
    );
  }

  return engines;
}

export interface ExternalCopyParams {
  engine: Exclude<CopyEngineId, 'builtin'>;
  executablePath: string;
  sourceDir: string;
  destDir: string;
  filteredFilePaths?: string[];
  relativeFilePaths?: string[];
  /** Chép phẳng (bỏ cấu trúc thư mục con) — dùng khi ingest từ thẻ. */
  flatten?: boolean;
  signal: AbortSignal;
  onLog?: (line: string) => void;
}

export async function runExternalCopyEngine(params: ExternalCopyParams): Promise<void> {
  const { engine, executablePath, sourceDir, destDir, filteredFilePaths, relativeFilePaths, flatten, signal, onLog } = params;
  await fsp.mkdir(destDir, { recursive: true });

  let tempListFile: string | null = null;
  let args: string[] = [];

  if (engine === 'teracopy') {
    const safeDest = safeWindowsCliDir(destDir);
    // Không lọc: chép nội dung sourceDir thẳng vào destDir (không tạo thêm thư mục bọc ngoài)
    const listEntries =
      filteredFilePaths && filteredFilePaths.length > 0
        ? filteredFilePaths
        : (await fsp.readdir(sourceDir)).map((name) => path.join(sourceDir, name));
    tempListFile = await writeTempListFile('framebackup_tera', listEntries, '\r\n');
    args = ['Copy', `*${tempListFile}`, safeDest, '/Close'];
  } else if (engine === 'fastcopy') {
    const safeDest = safeWindowsCliDir(destDir);
    if (filteredFilePaths && filteredFilePaths.length > 0) {
      tempListFile = await writeTempListFile('framebackup_fast', filteredFilePaths, '\r\n');
      args = ['/cmd=diff', '/verify', '/auto_close', `/srcfile=${tempListFile}`, `/to=${safeDest}`];
    } else {
      const safeSrc = safeWindowsCliDir(sourceDir);
      args = ['/cmd=diff', '/verify', '/auto_close', `${safeSrc}\\*`, `/to=${safeDest}`];
    }
  } else if (engine === 'robocopy') {
    args = [
      safeWindowsCliDir(sourceDir),
      safeWindowsCliDir(destDir),
      '/E',
      '/MT:8',
      '/R:2',
      '/W:3',
      '/COPY:DAT',
      '/NP',
      '/NFL',
      '/NDL',
    ];
  } else if (engine === 'rsync') {
    if (relativeFilePaths && relativeFilePaths.length > 0) {
      tempListFile = await writeTempListFile('framebackup_rsync', relativeFilePaths, '\n');
      // --files-from mặc định giữ đường dẫn tương đối; --no-relative để chép phẳng khi ingest từ thẻ
      args = ['-a', flatten ? '--no-relative' : '--relative', `--files-from=${tempListFile}`, sourceDir, destDir];
    } else {
      const normalizedSrc = sourceDir.endsWith('/') ? sourceDir : `${sourceDir}/`;
      args = ['-a', normalizedSrc, destDir];
    }
  } else if (engine === 'ditto') {
    args = [sourceDir, destDir];
  }

  try {
    await runAbortableProcess(executablePath, {
      args,
      signal,
      windowsHide: engine === 'robocopy',
      onOutput: (d) => {
        const line = d.toString().trim();
        if (line) onLog?.(line);
      },
      // Robocopy: mã < 8 là thành công (1 = đã copy, 2 = có file thừa...)
      isSuccessExitCode: (code) => {
        const exitCode = code ?? 0;
        return engine === 'robocopy' ? exitCode < 8 : exitCode === 0;
      },
      formatExitError: (code) => `Trình copy ${engine} kết thúc với mã lỗi ${code ?? 0}`,
    });
  } finally {
    await unlinkQuietly(tempListFile);
  }
}

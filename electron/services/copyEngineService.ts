import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type CopyEngineId = 'builtin' | 'teracopy' | 'robocopy' | 'fastcopy' | 'rsync' | 'ditto';

export interface CopyEngineOption {
  id: CopyEngineId;
  name: string;
  description: string;
  available: boolean;
  executablePath?: string;
  platform: 'all' | 'win32' | 'darwin';
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
      description: 'Mặc định — Hỗ trợ Date Guard, thanh % thật & Verify XXHash64',
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
  filteredFilePaths?: string[]; // Absolute paths (or relative for rsync) when Date Guard filters files
  relativeFilePaths?: string[];
  signal: AbortSignal;
  onLog?: (line: string) => void;
}

export async function runExternalCopyEngine(params: ExternalCopyParams): Promise<void> {
  const { engine, executablePath, sourceDir, destDir, filteredFilePaths, relativeFilePaths, signal, onLog } = params;
  await fsp.mkdir(destDir, { recursive: true });

  let tempListFile: string | null = null;
  let args: string[] = [];

  if (engine === 'teracopy') {
    if (filteredFilePaths && filteredFilePaths.length > 0) {
      tempListFile = path.join(os.tmpdir(), `framebackup_tera_${Date.now()}.txt`);
      await fsp.writeFile(tempListFile, filteredFilePaths.join('\r\n'), 'utf8');
      args = ['Copy', `*${tempListFile}`, destDir, '/Close'];
    } else {
      args = ['Copy', sourceDir, destDir, '/Close'];
    }
  } else if (engine === 'fastcopy') {
    if (filteredFilePaths && filteredFilePaths.length > 0) {
      tempListFile = path.join(os.tmpdir(), `framebackup_fast_${Date.now()}.txt`);
      await fsp.writeFile(tempListFile, filteredFilePaths.join('\r\n'), 'utf8');
      args = ['/cmd=diff', '/verify', '/auto_close', `/srcfile=${tempListFile}`, `/to=${destDir}`];
    } else {
      args = ['/cmd=diff', '/verify', '/auto_close', sourceDir, `/to=${destDir}`];
    }
  } else if (engine === 'robocopy') {
    // Robocopy supports full directory copy; if filtered, we pass specific filenames in sourceDir
    args = [sourceDir, destDir, '/E', '/MT:8', '/R:2', '/W:3', '/COPY:DAT', '/NP', '/NFL', '/NDL'];
  } else if (engine === 'rsync') {
    if (relativeFilePaths && relativeFilePaths.length > 0) {
      tempListFile = path.join(os.tmpdir(), `framebackup_rsync_${Date.now()}.txt`);
      await fsp.writeFile(tempListFile, relativeFilePaths.join('\n'), 'utf8');
      args = ['-a', '--files-from=' + tempListFile, sourceDir, destDir];
    } else {
      const normalizedSrc = sourceDir.endsWith('/') ? sourceDir : `${sourceDir}/`;
      args = ['-a', normalizedSrc, destDir];
    }
  } else if (engine === 'ditto') {
    args = [sourceDir, destDir];
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const child: ChildProcess = spawn(executablePath, args, {
        windowsHide: engine === 'robocopy',
      });

      const onAbort = () => {
        child.kill();
        reject(new Error('CANCELLED'));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });

      child.stdout?.on('data', (d) => {
        const line = d.toString().trim();
        if (line) onLog?.(line);
      });
      child.stderr?.on('data', (d) => {
        const line = d.toString().trim();
        if (line) onLog?.(line);
      });

      child.on('error', (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      });

      child.on('close', (code) => {
        signal.removeEventListener('abort', onAbort);
        const exitCode = code ?? 0;
        // Robocopy returns 0-7 for success; >=8 indicates error
        const ok = engine === 'robocopy' ? exitCode < 8 : exitCode === 0;
        if (ok) resolve();
        else reject(new Error(`Trình copy ${engine} kết thúc với mã lỗi ${exitCode}`));
      });
    });
  } finally {
    if (tempListFile) {
      await fsp.unlink(tempListFile).catch(() => {});
    }
  }
}

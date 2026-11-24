const { spawn, execFileSync, execSync } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';

function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => {
      if (startPort > 5250) return reject(new Error('No free port found between 5173 and 5250'));
      resolve(findFreePort(startPort + 1));
    });
    server.listen(startPort, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function waitForHttp(url, timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for Vite at ${url}`));
        } else {
          setTimeout(attempt, 200);
        }
      });
    };
    attempt();
  });
}

function killTree(child) {
  if (!child || !child.pid || child.killed) return;
  try {
    if (isWin) {
      execSync(`taskkill /pid ${child.pid} /t /f`, { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // Already exited
    }
  }
}

async function main() {
  // 1. Build Electron TypeScript directly via node (safe with spaces in folder paths)
  console.log('[FrameBackup] Building Electron main process...');
  const tscJs = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(process.execPath, [tscJs, '-p', 'tsconfig.electron.json'], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  // 2. Automatically pick a free port (avoids EADDRINUSE if 5173 is busy)
  const port = await findFreePort(5173);
  const devUrl = `http://127.0.0.1:${port}`;
  console.log(`[FrameBackup] Starting Vite dev server on ${devUrl}...`);

  const viteJs = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const viteProc = spawn(process.execPath, [viteJs, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    stdio: 'inherit',
    detached: !isWin,
  });

  let electronProc = null;
  let cleanedUp = false;

  const cleanup = (code = 0) => {
    if (cleanedUp) return;
    cleanedUp = true;
    killTree(electronProc);
    killTree(viteProc);
    process.exit(code);
  };

  process.on('SIGINT', () => cleanup(0));
  process.on('SIGTERM', () => cleanup(0));

  viteProc.on('exit', (code) => {
    if (!cleanedUp) {
      console.error(`[FrameBackup] Vite exited unexpectedly with code ${code}`);
      cleanup(code ?? 1);
    }
  });

  await waitForHttp(devUrl);
  console.log('[FrameBackup] Launching Electron window...');

  const electronExe = require('electron');
  electronProc = spawn(electronExe, ['.'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: devUrl },
  });

  electronProc.on('exit', (code) => {
    cleanup(code ?? 0);
  });
}

main().catch((err) => {
  console.error('[FrameBackup] Dev launcher error:', err);
  process.exit(1);
});

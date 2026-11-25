import http from 'node:http';
import type { DrivePickResult } from '../../shared/types';
import { getAuthorizedOAuthClient } from './auth';
import { readActiveClient } from './storage';

/**
 * v1.4 — Chọn thư mục Google Drive bằng Google Picker (hướng A).
 * Với quyền drive.file, app chỉ ghi được vào thư mục người dùng đã chọn ở đây (1 lần cho mỗi thư mục).
 * Mở trang chọn trong trình duyệt của người dùng (đã đăng nhập Google sẵn), trang chạy trên 127.0.0.1
 * và gửi kết quả về app qua chính máy chủ tạm này, giống bước đăng nhập.
 */
let cancelPending: (() => void) | null = null;

export function cancelDrivePick(): boolean {
  if (!cancelPending) return false;
  cancelPending();
  return true;
}

function pickerPage(opts: { token: string; apiKey: string; appId: string; startFolderId?: string; nonce: string }) {
  const cfg = JSON.stringify(opts).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>FrameBackup – Chọn thư mục Google Drive</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#121215;color:#f4f4f5;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center}
.b{max-width:520px;padding:24px}h2{margin:0 0 8px}p{color:#a1a1aa}.ok{color:#10b981}.err{color:#f87171}button{margin-top:12px;padding:8px 16px;border-radius:6px;border:0;background:#2563eb;color:#fff;font-weight:600;cursor:pointer}</style>
</head><body><div class="b"><h2 id="t">Đang mở bảng chọn thư mục của Google…</h2><p id="m">Chọn thư mục sẽ up file lên, rồi bấm <b>Select</b>.</p><button id="again" hidden>Mở lại bảng chọn</button></div>
<script>
const C=${cfg};
const t=document.getElementById('t'),m=document.getElementById('m'),again=document.getElementById('again');
function send(body){return fetch('/picked?n='+C.nonce,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
function show(){
  const g=google.picker, FOLDER='application/vnd.google-apps.folder';
  const fv=function(label){return new g.DocsView(g.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes(FOLDER).setLabel(label);};
  const views=[];
  // Thư mục anh đã dán link: hiện ĐÚNG thư mục đó để bấm chọn (setParent sẽ mở vào bên trong => trống, không chọn được)
  if(C.startFolderId){const v=fv('Thư mục đã dán link');if(typeof v.setFileIds==='function'){v.setFileIds(C.startFolderId);views.push(v);}}
  views.push(fv('My Drive').setParent('root'));
  views.push(fv('Được chia sẻ với tôi').setOwnedByMe(false));
  views.push(fv('Bộ nhớ dùng chung').setEnableDrives(true));
  const pb=new g.PickerBuilder();views.forEach(function(v){pb.addView(v);});
  pb.setOAuthToken(C.token).setDeveloperKey(C.apiKey).setAppId(C.appId)
    .enableFeature(g.Feature.SUPPORT_DRIVES).setTitle('FrameBackup – chọn thư mục để up file')
    .setLocale('vi')
    .setCallback(function(d){
      if(d.action===g.Action.PICKED){const doc=d.docs[0];t.textContent='✅ Đã chọn "'+doc.name+'"';t.className='ok';m.textContent='Anh có thể đóng tab này và quay lại FrameBackup.';again.hidden=true;send({ok:true,id:doc.id,name:doc.name});}
      else if(d.action===g.Action.CANCEL){t.textContent='Đã đóng bảng chọn';m.textContent='Chưa chọn thư mục nào.';again.hidden=false;}
    }).build().setVisible(true);
}
again.onclick=()=>{again.hidden=true;show();};
window.onGapi=function(){gapi.load('picker',{callback:show,onerror:function(){t.textContent='Không tải được Google Picker';t.className='err';send({ok:false,error:'Không tải được Google Picker.'});}});};
window.addEventListener('beforeunload',function(){navigator.sendBeacon&&navigator.sendBeacon('/closed?n='+C.nonce);});
</script><script src="https://apis.google.com/js/api.js?onload=onGapi" async defer></script></body></html>`;
}

export async function pickDriveFolder(
  openExternalUrl: (url: string) => Promise<void>,
  startFolderId?: string
): Promise<DrivePickResult> {
  const active = await readActiveClient();
  const apiKey = active?.client.picker_api_key;
  const appId = active?.client.project_number;
  if (!apiKey || !appId) {
    return {
      ok: false,
      error:
        'Bản app này chưa có cấu hình Google Picker (picker_api_key + project_number trong google-oauth-client.json). Liên hệ người build app.',
    };
  }
  const auth = await getAuthorizedOAuthClient();
  if (!auth) return { ok: false, error: 'Chưa đăng nhập Google Drive. Bấm "Đăng nhập Google" trước.' };
  let token: string | null | undefined;
  try {
    token = (await auth.getAccessToken()).token;
  } catch (err) {
    return { ok: false, error: `Phiên Google hết hạn — đăng nhập lại. (${err instanceof Error ? err.message : String(err)})` };
  }
  if (!token) return { ok: false, error: 'Không lấy được phiên Google — đăng nhập lại.' };

  cancelPending?.();
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const safeStart = startFolderId && /^[\w-]{10,}$/.test(startFolderId) ? startFolderId : undefined;

  return new Promise<DrivePickResult>((resolve) => {
    let finished = false;
    const done = (r: DrivePickResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      cancelPending = null;
      // Để trang kịp nhận phản hồi rồi mới tắt máy chủ tạm
      setTimeout(() => server.close(), 500);
      resolve(r);
    };
    cancelPending = () => done({ ok: false, cancelled: true, error: 'Đã huỷ chọn thư mục.' });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(pickerPage({ token: token!, apiKey, appId, startFolderId: safeStart, nonce }));
        return;
      }
      if (url.searchParams.get('n') !== nonce) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (req.method === 'POST' && url.pathname === '/picked') {
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > 10_000) req.destroy();
        });
        req.on('end', () => {
          res.writeHead(204);
          res.end();
          try {
            const j = JSON.parse(body) as { ok: boolean; id?: string; name?: string; error?: string };
            if (j.ok && typeof j.id === 'string' && /^[\w-]+$/.test(j.id)) {
              done({ ok: true, folderId: j.id, folderName: typeof j.name === 'string' ? j.name : undefined });
            } else done({ ok: false, error: j.error || 'Không chọn được thư mục.' });
          } catch {
            done({ ok: false, error: 'Phản hồi không hợp lệ từ trang chọn thư mục.' });
          }
        });
        return;
      }
      if (url.pathname === '/closed') {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const timeout = setTimeout(() => done({ ok: false, error: 'Hết thời gian chờ chọn thư mục (5 phút).' }), 300_000);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      void openExternalUrl(`http://127.0.0.1:${port}/`).catch((err) =>
        done({ ok: false, error: `Không mở được trình duyệt: ${err instanceof Error ? err.message : String(err)}` })
      );
    });
  });
}

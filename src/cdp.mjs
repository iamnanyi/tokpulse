import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
const exec = promisify(execFile);
export async function appProcess(pid, appPath) {
  // ZCode changes process.title to "ZCode", so ps command lines lose the executable path.
  const { stdout } = await exec('/usr/sbin/lsof', ['-a','-p',String(pid),'-d','txt','-Fn']);
  return stdout.split('\n').some(line => line.startsWith('n' + appPath + '/Contents/MacOS/'));
}
export function localWebSocket(value, port) {
  const u = new URL(value);
  if (u.protocol !== 'ws:' || u.hostname !== '127.0.0.1' || Number(u.port) !== port || u.username || u.password || !u.pathname.startsWith('/devtools/')) throw Error('拒绝非本机 CDP WebSocket');
  return u.href;
}
export async function verifyListener(port, { appPath, test = false } = {}) {
  let stdout;
  try { ({ stdout } = await exec('/usr/sbin/lsof', ['-nP','-a','-iTCP:' + port,'-sTCP:LISTEN','-Fpcn'])); }
  catch { throw Error('CDP 尚未启动'); }
  const names = stdout.split('\n').filter(x=>x.startsWith('n')).map(x=>x.slice(1));
  if (!names.length || names.some(x=>x !== '127.0.0.1:' + port)) throw Error('CDP 监听地址不是唯一的 127.0.0.1，拒绝连接');
  if (!test) {
    // Keep the original owner selection: auxiliary child processes can inherit the same socket FD.
    const pid = stdout.match(/^p(\d+)$/m)?.[1];
    if (!pid) throw Error('无法核验监听进程');
    if (!await appProcess(pid, appPath)) throw Error('CDP 端口不属于指定 App');
  }
}
export async function targets(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal:AbortSignal.timeout(2000), redirect:'error' });
  if (!r.ok) throw Error('CDP 目标列表不可用');
  return r.json();
}
export function appTarget(t, config = {}) {
  if (t.type !== 'page') return false;
  try {
    const u = new URL(t.url);
    if (config.adapter === 'zcode') {
      return u.protocol === 'file:' && !u.host && !u.hash
        && u.pathname === pathToFileURL(config.appPath + '/Contents/Resources/app.asar/out/renderer/index.html').pathname;
    }
    return u.protocol === 'app:' && u.hostname === '-' && ['/index.html','/detached-window.html'].includes(u.pathname)
      && !/avatar-overlay|prewarm/.test(u.search);
  } catch { return false; }
}
export class CDP {
  constructor(ws) {
    this.ws = ws; this.next = 0; this.pending = new Map();
    ws.addEventListener('message', e => {
      const data = JSON.parse(e.data);
      const entry = this.pending.get(data.id);
      if (!entry) return;
      clearTimeout(entry.timer); this.pending.delete(data.id);
      if (data.error) entry.reject(Error(data.error.message)); else entry.resolve(data.result);
    });
    ws.addEventListener('close', () => {
      for (const e of this.pending.values()) { clearTimeout(e.timer); e.reject(Error('CDP 已断开')); }
      this.pending.clear();
    });
  }
  static async connect(url, port) {
    const ws = new WebSocket(localWebSocket(url, port));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(()=>{ ws.close(); reject(Error('CDP 连接超时')); },3000);
      ws.addEventListener('open', ()=>{clearTimeout(timer);resolve();},{once:true});
      ws.addEventListener('error', ()=>{clearTimeout(timer);reject(Error('CDP 连接失败'));},{once:true});
    });
    return new CDP(ws);
  }
  call(method, params = {}) {
    const id = ++this.next;
    return new Promise((resolve,reject) => {
      const timer = setTimeout(()=>{this.pending.delete(id);reject(Error('CDP 请求超时'));},3000);
      this.pending.set(id,{resolve,reject,timer});
      try {this.ws.send(JSON.stringify({id,method,params}));} catch(e) {clearTimeout(timer);this.pending.delete(id);reject(e);}
    });
  }
  async evaluate(expression) {
    const r = await this.call('Runtime.evaluate',{expression,returnByValue:true});
    if (r.exceptionDetails) throw Error('页面脚本执行失败');
    return r.result?.value;
  }
  close() { this.ws.close(); }
}

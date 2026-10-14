import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CDP, appTarget, targets, verifyListener, appProcess } from './cdp.mjs';
import { bundle } from './build.mjs';
const exec = promisify(execFile);
const sleep = ms => new Promise(r => setTimeout(r,ms));

export async function appRunning(appPath) {
  const { stdout } = await exec('/bin/ps',['-axo','pid=,command=']);
  for (const line of stdout.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    if (match[2].startsWith(appPath + '/Contents/MacOS/')) return true;
    if (match[2].trim() === 'ZCode' && await appProcess(match[1], appPath).catch(()=>false)) return true;
  }
  return false;
}
export function launchApp(config) {
  // Spawn vendor binary directly, leaving signature and resources untouched.
  const child = spawn(config.appPath + '/Contents/MacOS/' + config.executable,
    ['--remote-debugging-address=127.0.0.1','--remote-debugging-port=' + config.port],
    { detached:true, stdio:'ignore', env:process.env });
  child.on('error',()=>console.error('无法启动指定 App；请运行 doctor。'));
  child.unref();
}
export async function run(config, { once = false, remove = false } = {}) {
  const code = await bundle();
  const sessions = new Map();
  let stopping = false, lastState = '', launchAttempted = false;
  const say = state => { if (state !== lastState) { console.log(new Date().toISOString() + ' ' + state); lastState = state; } };
  async function cleanup() {
    stopping = true;
    await Promise.allSettled([...sessions.values()].map(async s => {
      if (s.script) await s.cdp.call('Page.removeScriptToEvaluateOnNewDocument',{identifier:s.script});
      await s.cdp.evaluate('window.__chatgptTokenSpeed?.dispose()');
      s.cdp.close();
    }));
    sessions.clear();
  }
  process.on('SIGTERM',cleanup); process.on('SIGINT',cleanup);
  while (!stopping) {
    try {
      await verifyListener(config.port,{appPath:config.appPath});
      const list = (await targets(config.port)).filter(t => appTarget(t, config));
      const ids = new Set(list.map(t=>t.id));
      for (const [id,s] of sessions) if (!ids.has(id)) {s.cdp.close();sessions.delete(id);}
      for (const t of list) {
        let s = sessions.get(t.id);
        try {
          if (!s) {
            s = { cdp:await CDP.connect(t.webSocketDebuggerUrl,config.port) };
            sessions.set(t.id,s);
            if (!remove) {
              const r = await s.cdp.call('Page.addScriptToEvaluateOnNewDocument',{source:code});
              s.script = r.identifier;
            }
          }
          if (remove) await s.cdp.evaluate('window.__chatgptTokenSpeed?.dispose()');
          else await s.cdp.evaluate(code);
        } catch {s?.cdp.close();sessions.delete(t.id);}
      }
      say(remove ? '已移除当前状态栏' : `已连接 ${sessions.size} 个 App 页面；自动等待可识别的输入框`);
    } catch {
      for (const s of sessions.values()) s.cdp.close();
      sessions.clear();
      if (config.autoLaunch && !launchAttempted && !remove && !await appRunning(config.appPath)) {
        launchAttempted = true; launchApp(config); say('已启动 App，等待本机 CDP');
      } else say('等待 127.0.0.1 CDP；已有 App 不会被强制退出');
    }
    if (once || remove) break;
    await sleep(2000);
  }
  if (once) {for (const s of sessions.values()) s.cdp.close(); sessions.clear();}
  else await cleanup();
  process.removeListener('SIGTERM',cleanup); process.removeListener('SIGINT',cleanup);
}

import path from 'node:path';

export const profiles = {
  chatgpt: { appPath:'/Applications/ChatGPT.app', executable:'ChatGPT', port:9333, adapter:'chatgpt', autoLaunch:true },
  zcode: { appPath:'/Applications/ZCode.app', executable:'ZCode', port:9334, adapter:'zcode', autoLaunch:true }
};

export function validateConfig(value, app = 'chatgpt') {
  if (!Object.hasOwn(profiles, app)) throw Error('未知 App；请选择 chatgpt 或 zcode');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('配置无效');
  const c = { ...profiles[app], ...value };
  if (!Number.isInteger(c.port) || c.port<1024 || c.port>65535 || typeof c.appPath !== 'string'
    || !path.isAbsolute(c.appPath) || typeof c.executable !== 'string' || !/^[-\w ]+$/.test(c.executable)
    || c.adapter !== profiles[app].adapter || typeof c.autoLaunch !== 'boolean') throw Error('配置无效');
  return c;
}

export function installation(app, home) {
  if (!Object.hasOwn(profiles, app)) throw Error('未知 App；请选择 chatgpt 或 zcode');
  const name = app === 'zcode' ? 'ZCode Token Speed' : 'ChatGPT Token Speed';
  const label = app === 'zcode' ? 'local.zcode-token-speed' : 'local.chatgpt-token-speed';
  const base = path.join(home, 'Library', 'Application Support', name);
  return { name, label, base, plist:path.join(home,'Library','LaunchAgents',label+'.plist'), installedConfig:path.join(base,'config.json') };
}

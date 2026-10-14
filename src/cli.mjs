import { readFile, writeFile, mkdir, cp, rm, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { run, appRunning, launchApp } from './daemon.mjs';
import { verifyListener, targets, appTarget } from './cdp.mjs';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../',import.meta.url));
const label = 'local.chatgpt-token-speed';
const base = path.join(homedir(),'Library','Application Support','ChatGPT Token Speed');
const plist = path.join(homedir(),'Library','LaunchAgents',label+'.plist');
const installedConfig = path.join(base,'config.json');
const command = process.argv[2] ?? 'doctor';
const index = process.argv.indexOf('--config');
const configFile = index >= 0 ? process.argv[index+1] : installedConfig;
const xml = s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
async function config() {
  let c;
  try {c=JSON.parse(await readFile(configFile,'utf8'));}
  catch {c={appPath:'/Applications/ChatGPT.app',executable:'ChatGPT',port:9333,autoLaunch:true};}
  if (!Number.isInteger(c.port)||c.port<1024||c.port>65535||!path.isAbsolute(c.appPath)||!/^[-\w ]+$/.test(c.executable)) throw Error('配置无效');
  return c;
}
async function bootout() {
  const service='gui/'+process.getuid()+'/'+label;
  try {await exec('/bin/launchctl',['bootout',service]);} catch {}
  // bootout can return before launchd has finished unregistering the service.
  for(let i=0;i<60;i++) {
    try {await exec('/bin/launchctl',['print',service]);}
    catch {return;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('旧注入服务尚未退出，请稍后重试安装；ChatGPT 无需重启。');
}
async function main() {
  const c=await config();
  if (command==='doctor') {
    const {stdout:version}=await exec('/usr/bin/defaults',['read',c.appPath+'/Contents/Info','CFBundleShortVersionString']);
    console.log('Node '+process.version+'；App '+version.trim());
    console.log('App 正在运行：'+await appRunning(c.appPath));
    try {await verifyListener(c.port,{appPath:c.appPath});console.log('CDP 已核验为 127.0.0.1；App 页面数：'+(await targets(c.port)).filter(appTarget).length);}
    catch(e){console.log(e.message+'。正式 App 需完全退出后使用启动脚本开启 CDP。');}
  } else if (command==='start' || command==='once') {
    await run(c,{once:command==='once'});
  } else if (command==='launch') {
    if (await appRunning(c.appPath)) {
      await verifyListener(c.port,{appPath:c.appPath});
      console.log('App 已运行且 CDP 已核验。');
    } else {launchApp(c);console.log('已使用 127.0.0.1 调试参数启动 App。');}
    // A stopped LaunchAgent can be enabled again without a reinstall.
    let installed=false;
    try {await access(plist);installed=true;} catch {}
    if(installed) {
      try {await exec('/bin/launchctl',['bootstrap','gui/'+process.getuid(),plist]);} catch {}
      await exec('/bin/launchctl',['kickstart','gui/'+process.getuid()+'/'+label]);
    } else console.log('未安装自动启动；请在项目目录运行 npm start。');
  } else if (command==='install') {
    if (process.platform!=='darwin') throw Error('自动启动安装仅支持 macOS');
    await mkdir(base,{recursive:true,mode:0o700});
    const dest=path.join(base,'app');
    if (root!==dest+path.sep && root!==dest) await cp(root,dest,{recursive:true,filter:p=>!p.includes('/.git')});
    await writeFile(installedConfig,JSON.stringify(c,null,2)+'\n',{mode:0o600});
    const launcher=path.join(base,'ChatGPT Token Speed.app','Contents');
    await mkdir(path.join(launcher,'MacOS'),{recursive:true});
    await writeFile(path.join(launcher,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.chatgpt-token-speed.launcher</string><key>CFBundleName</key><string>ChatGPT Token Speed</string><key>CFBundleExecutable</key><string>launch</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>LSUIElement</key><true/></dict></plist>`);
    const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
    await writeFile(path.join(launcher,'MacOS','launch'),`#!/bin/zsh\nexec ${quote(process.execPath)} ${quote(path.join(dest,'src/cli.mjs'))} launch --config ${quote(installedConfig)} >> ${quote(path.join(base,'launcher.log'))} 2>&1\n`,{mode:0o700});
    await mkdir(path.dirname(plist),{recursive:true});
    const args=[process.execPath,path.join(dest,'src/cli.mjs'),'start','--config',installedConfig];
    const log=path.join(base,'injector.log');
    const doc=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map(a=>'<string>'+xml(a)+'</string>').join('')}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string></dict></plist>\n`;
    await writeFile(plist,doc,{mode:0o600});
    await bootout();
    await exec('/bin/launchctl',['bootstrap','gui/'+process.getuid(),plist]);
    await exec('/bin/launchctl',['kickstart','gui/'+process.getuid()+'/'+label]);
    console.log('已安装登录自动启动。当前 App 不会被退出；若无 CDP，请本轮工作结束后完全退出，再执行启动.command。');
    console.log('专用启动入口：'+path.join(base,'ChatGPT Token Speed.app'));
  } else if (command==='stop' || command==='uninstall') {
    await bootout();
    // Agent SIGTERM removes new-document scripts and UI. A one-shot also cleans stale UI after an abnormal exit.
    try {await run({...c,autoLaunch:false},{remove:true});} catch {}
    if (command==='uninstall') {await rm(plist,{force:true});await rm(base,{recursive:true,force:true});}
    console.log('注入器已关闭。关闭 CDP 端口需完全退出 App，然后从 /Applications 正常启动。');
  } else throw Error('用法：doctor | start | once | launch | install | stop | uninstall');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

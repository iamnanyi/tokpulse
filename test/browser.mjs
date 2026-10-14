import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { CDP, verifyListener, targets } from '../src/cdp.mjs';
import { bundle } from '../src/build.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const profile=await mkdtemp(path.join(tmpdir(),'token-speed-test-'));
const isZcode=process.argv.includes('--zcode');
const fixture=await readFile(new URL(isZcode?'zcode-fixture.html':'fixture.html',import.meta.url));
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(fixture)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port;
const chrome=process.env.TOKEN_SPEED_TEST_BROWSER??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const child=spawn(chrome,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--user-data-dir='+profile,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',url],{stdio:'ignore'});
let cdp, browser, error;
child.on('error',e=>{error=e});
let checks=0;
const check=(name,fn)=>{fn();checks++;console.log('PASS '+name)};
try {
  let port;
  for(let i=0;i<80;i++) {if(error)throw error;try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break}catch{await wait(100)}}
  assert.ok(port,'Chromium did not start');
  await verifyListener(port,{test:true});
  const list=await targets(port),t=list.find(t=>t.type==='page'&&t.url.startsWith(url));
  cdp=await CDP.connect(t.webSocketDebuggerUrl,port);
  await cdp.call('Page.enable');
  for(let i=0;i<50 && !await cdp.evaluate('typeof fixture !== "undefined"');i++) await wait(100);
  const initial=await cdp.evaluate('fixture.geometry()');
  const code=await bundle();
  const {identifier}=await cdp.call('Page.addScriptToEvaluateOnNewDocument',{source:code});
  await cdp.evaluate(code);await wait(100);
  let status=await cdp.evaluate('window.__chatgptTokenSpeed.status()');
  check('idle exact label / existing messages excluded',()=>assert.equal(status.label,'— tok/s'));
  if(isZcode) {
    check('ZCode adapter recognized',()=>assert.equal(status.adapter,'zcode'));
    // Neither a tool Stop nor assistant/history edits can arm an idle composer.
    await cdp.evaluate(`document.querySelector('#messages').insertAdjacentHTML('beforeend','<button aria-label="Stop" data-testid="v4-stop">Stop tool</button>');fixture.append('历史追加');`);
    await wait(650);
    check('tool Stop outside composer and idle edits are excluded',()=>{});
    assert.equal((await cdp.evaluate('window.__chatgptTokenSpeed.status()')).label,'— tok/s');
    await cdp.evaluate('fixture.start()');await wait(100);
    for(let i=0;i<4;i++) {await cdp.evaluate(`document.querySelector('#thinking').append('思考增量');document.querySelector('#tool').append('工具增量');document.querySelector('[contenteditable]').append('用户输入');`);await wait(250)}
    check('ZCode thinking, tool output and user input never count',()=>{});
    assert.equal((await cdp.evaluate('window.__chatgptTokenSpeed.status()')).label,'— tok/s');
    await cdp.evaluate('fixture.stop()');
  }
  const after=await cdp.evaluate('fixture.geometry()');
  check('normal flow, surface/buttons retain size, no overlap',()=>{
    assert.equal(after.surface.height,initial.surface.height);assert.equal(after.surface.width,initial.surface.width);
    assert.deepEqual(after.buttons.map(r=>[r.width,r.height]),initial.buttons.map(r=>[r.width,r.height]));
    assert.ok(after.messages.bottom<=after.surface.y);assert.ok(after.surface.bottom<=after.bar.y);assert.ok(after.bar.bottom<=after.viewport[1]);
  });
  await cdp.evaluate('fixture.start()');await wait(50);
  for(let i=0;i<5;i++){await cdp.evaluate('fixture.append("正在逐字输出一段测试文字。");');await wait(250)}
  status=await cdp.evaluate('window.__chatgptTokenSpeed.status()');
  check((isZcode?'ZCode':'Codex')+' fixture streaming has a positive estimated speed',()=>assert.match(status.label,/≈ [\d.]+ tok\/s/));
  // Reproduce the observed Electron state: a visible chat reports document.hidden=true.
  await cdp.evaluate('Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});');
  for(let i=0;i<4;i++){await cdp.evaluate('fixture.append("可见窗口的输出仍应计速。");');await wait(250)}
  const hiddenPaneStatus=await cdp.evaluate('({hidden:document.hidden,label:window.__chatgptTokenSpeed.status().label})');
  check('visible Electron pane reporting hidden=true still counts output',()=>{assert.equal(hiddenPaneStatus.hidden,true);assert.match(hiddenPaneStatus.label,/≈ [\d.]+ tok\/s/)});
  await cdp.evaluate('delete document.hidden');
  await cdp.evaluate(code);
  check('idempotent reinjection',()=>{});
  assert.equal(await cdp.evaluate('document.querySelectorAll("[data-token-speed-bar]").length'),1);
  await cdp.evaluate('document.body.classList.add("dark")');
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:390,height:700,deviceScaleFactor:1,mobile:false});
  const narrow=await cdp.evaluate('fixture.geometry()');
  check('narrow window and dark theme remain in bounds',()=>{assert.ok(narrow.bar.bottom<=700);assert.ok(narrow.bar.x+narrow.bar.width<=390);assert.ok(narrow.surface.bottom<=narrow.bar.y)});
  const snap=await cdp.call('Page.captureScreenshot',{format:'png'});
  await writeFile(new URL(isZcode?'../verification-zcode-dark-narrow.png':'../verification-dark-narrow.png',import.meta.url),Buffer.from(snap.data,'base64'));
  const beforeStop=(await cdp.evaluate('window.__chatgptTokenSpeed.status()')).label;
  await cdp.evaluate('fixture.stop()');await wait(1600);
  const stopped=await cdp.evaluate('window.__chatgptTokenSpeed.status()');
  check('completed reply retains its measured speed',()=>{assert.equal(stopped.label,beforeStop);assert.equal(stopped.state,'retained');assert.equal(stopped.active,false)});
  await cdp.evaluate('document.querySelector("[contenteditable]").append("很多用户输入");fixture.start()');await wait(650);
  check('next reply waiting and user input keep previous speed',()=>{});assert.equal((await cdp.evaluate('window.__chatgptTokenSpeed.status()')).label,beforeStop);
  await cdp.evaluate('fixture.switch()');await wait(650);
  check('thread switch and user input do not count',()=>{});assert.equal((await cdp.evaluate('window.__chatgptTokenSpeed.status()')).label,'— tok/s');
  await cdp.evaluate('fixture.switchBack()');await wait(350);
  check('returning to the measured conversation restores its speed',()=>{});assert.equal((await cdp.evaluate('window.__chatgptTokenSpeed.status()')).label,beforeStop);
  await cdp.evaluate('fixture.work()');await wait(100);
  for(let i=0;i<5;i++){await cdp.evaluate('fixture.append("Work 输出测试。");');await wait(250)}
  check((isZcode?'ZCode subsequent output':'Work static-marker fixture')+' streams',()=>{});assert.match((await cdp.evaluate('window.__chatgptTokenSpeed.status()')).label,/≈ [\d.]+ tok\/s/);
  const beforePause=(await cdp.evaluate('window.__chatgptTokenSpeed.status()')).label;
  await wait(1500);
  const paused=await cdp.evaluate('window.__chatgptTokenSpeed.status()');
  check('tool pause retains last speed without time decay',()=>{assert.equal(paused.label,beforePause);assert.equal(paused.state,'retained')});
  await cdp.evaluate('document.querySelector("[data-token-speed-bar]").remove()');await wait(300);
  check('React-style removal automatically remounts',()=>{});assert.equal(await cdp.evaluate('document.querySelectorAll("[data-token-speed-bar]").length'),1);
  assert.equal((await cdp.evaluate('window.__chatgptTokenSpeed.status()')).label,beforePause);
  await cdp.call('Page.reload');await wait(500);
  check('reload auto injection',()=>{});assert.equal((await cdp.evaluate('window.__chatgptTokenSpeed.status()')).label,'— tok/s');
  await cdp.call('Page.removeScriptToEvaluateOnNewDocument',{identifier});
  await cdp.evaluate('window.__chatgptTokenSpeed.dispose()');
  check('dispose removes UI and observers',()=>{});assert.equal(await cdp.evaluate('document.querySelectorAll("[data-token-speed-bar],#chatgpt-token-speed-style").length'),0);
  await cdp.call('Page.reload');await wait(350);
  check('removed registration stays removed on reload',()=>{});assert.equal(await cdp.evaluate('!!window.__chatgptTokenSpeed'),false);
  console.log(checks+' browser checks passed');
} finally {
  cdp?.close();child.kill('SIGTERM');await new Promise(r=>server.close(r));await wait(300);await rm(profile,{recursive:true,force:true});
}

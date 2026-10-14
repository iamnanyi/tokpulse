import test from 'node:test';
import assert from 'node:assert/strict';
import { installation, validateConfig } from '../src/config.mjs';
import { appTarget } from '../src/cdp.mjs';

test('ZCode and ChatGPT use isolated ports, services and installation directories',()=>{
  const z=validateConfig({},'zcode'), c=validateConfig({});
  assert.equal(z.port,9334);assert.equal(c.port,9333);
  assert.equal(z.executable,'ZCode');assert.equal(z.adapter,'zcode');
  const zi=installation('zcode','/tmp/test-user'),ci=installation('chatgpt','/tmp/test-user');
  for(const field of ['base','plist','label','installedConfig']) assert.notEqual(zi[field],ci[field]);
  assert.equal(ci.label,'local.chatgpt-token-speed');
  assert.ok(ci.base.endsWith('/ChatGPT Token Speed'));
});

test('Legacy ChatGPT config stays valid and custom ZCode paths retain its adapter',()=>{
  assert.equal(validateConfig({appPath:'/Applications/ChatGPT.app',executable:'ChatGPT',port:9333,autoLaunch:true}).adapter,'chatgpt');
  const z=validateConfig({appPath:'/tmp/My Apps/ZCode.app',port:19334},'zcode');
  assert.equal(z.adapter,'zcode');assert.equal(z.port,19334);
  for(const value of [null,[], 'zcode', {port:9333.5},{appPath:'relative'},{executable:'../ZCode'},{autoLaunch:'true'},{adapter:'chatgpt'}]) assert.throws(()=>validateConfig(value,'zcode'));
  assert.throws(()=>validateConfig({},'unknown'));assert.throws(()=>installation('unknown','/tmp'));
});

test('ZCode only accepts the exact installed renderer, excluding browser guests and auxiliary windows',()=>{
  const config=validateConfig({},'zcode');
  const url='file:///Applications/ZCode.app/Contents/Resources/app.asar/out/renderer/index.html';
  assert.equal(appTarget({type:'page',url:url+'?restoreSession=true'},config),true);
  for(const target of [{type:'webview',url},{type:'page',url:url.replace('index.html','resource-manager.html')},{type:'page',url:url.replace('index.html','plugin-sandbox.html')},{type:'page',url:url.replace('/Applications/ZCode.app','/tmp/ZCode.app')},{type:'page',url:'https://zcode.z.ai/'},{type:'page',url:'app://-/index.html'},{type:'page',url:'file://remote/Applications/ZCode.app/Contents/Resources/app.asar/out/renderer/index.html'}]) assert.equal(appTarget(target,config),false);
  const custom=validateConfig({appPath:'/tmp/My Apps/ZCode.app'},'zcode');
  assert.equal(appTarget({type:'page',url:'file:///tmp/My%20Apps/ZCode.app/Contents/Resources/app.asar/out/renderer/index.html'},custom),true);
});

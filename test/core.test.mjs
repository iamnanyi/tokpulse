import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, appendedText, AppendTracker, SpeedWindow } from '../src/core.js';
import { localWebSocket, appTarget } from '../src/cdp.mjs';
test('Unicode estimate is incremental and handles surrogate pairs',()=>{
  assert.equal(estimateTokens(''),0);
  assert.equal(estimateTokens('test'),1);
  assert.equal(estimateTokens('中文'),2.6);
  assert.equal(estimateTokens('😀'),2);
});
test('Only strict append is charged; replacements and contractions are ignored',()=>{
  assert.equal(appendedText('旧消息','旧消息新输出'),'新输出');
  assert.equal(appendedText('abc','abd'),'');
  assert.equal(appendedText('abcd','abc'),'');
});
test('History, inactive edits, new-node hydration and remounts do not become output',()=>{
  const t=new AppendTracker();
  assert.equal(t.update([{key:'old',text:'已有内容'}],true),'');
  assert.equal(t.update([{key:'old',text:'已有内容'}],true),'');
  assert.equal(t.update([{key:'old',text:'已有内容新增'}],true),'新增');
  assert.equal(t.update([{key:'new',text:'新挂载的整段历史'}],true),'');
  assert.equal(t.update([{key:'new',text:'新挂载的整段历史编辑'}],false),'');
  assert.equal(t.update([{key:'new',text:'新挂载的整段历史编辑'}],true),'');
  t.reset();assert.equal(t.update([{key:'old',text:'另一对话'}],true),'');
});
test('Short rolling rate warms up, expires and resets after tools pause',()=>{
  const w=new SpeedWindow();
  assert.equal(w.speed(0),null);
  w.add('test',100);assert.equal(w.speed(200),null);
  w.add('test',600);assert.equal(w.speed(1100),2);
  assert.equal(w.speed(2000),null);
  w.add('test',4000);assert.equal(w.speed(4100),null);
  w.add('test',4500);assert.equal(w.speed(5000),2);
  w.reset();assert.equal(w.speed(5000),null);
});
test('Refuses remote, credentials, redirects to other ports and other protocols',()=>{
  assert.equal(localWebSocket('ws://127.0.0.1:9333/devtools/page/a',9333),'ws://127.0.0.1:9333/devtools/page/a');
  for(const url of ['ws://192.168.1.2:9333/devtools/page/a','ws://localhost:9333/devtools/page/a','ws://127.0.0.1:9222/devtools/page/a','wss://127.0.0.1:9333/devtools/page/a','ws://u:p@127.0.0.1:9333/devtools/page/a']) assert.throws(()=>localWebSocket(url,9333));
});
test('Only native App windows are eligible; browsers, tools, avatar and prewarms are excluded',()=>{
  assert.equal(appTarget({type:'page',url:'app://-/index.html'}),true);
  assert.equal(appTarget({type:'page',url:'app://-/detached-window.html?initialRoute=x'}),true);
  for(const t of [{type:'webview',url:'https://chatgpt.com/'},{type:'page',url:'https://example.com'},{type:'page',url:'app://-/index.html?initialRoute=/avatar-overlay'},{type:'page',url:'app://-/index.html?prewarm=1'}]) assert.equal(appTarget(t),false);
});

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = '/home/chiharukiryu/cdev/viento-studio', output = '/tmp/viento-event-positions-browser';
const sources = ['web/modules/app-project-event-positions-observation.js', 'web/project-event-observation.css', 'web/i18n/index.js', 'web/i18n/messages.js', 'web/i18n/en.js', 'web/i18n/ja.js', 'web/i18n/languages.js'];
const report = { scope: 'Standalone event position component served from repository; not a full application, Tauri, Godot or installed-build test.', start: new Date().toISOString(), sources: {}, checks: [], errors: [], screenshots: [] };
for (const f of sources) report.sources[f] = createHash('sha256').update(await fs.readFile(path.join(root, f))).digest('hex');
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/web/project-event-observation.css"><style>body{margin:16px;font:16px system-ui,sans-serif;color:#192a25} main{max-width:1200px;margin:auto} .build-hint{color:#536d64;line-height:1.5}</style></head><body><main><div id="panel"></div></main><script type="module">
import {setupProjectEventPositionsObservation} from '/web/modules/app-project-event-positions-observation.js';
import {applyLanguage} from '/web/i18n/index.js';
const context={available:true,visible:true,sessionOwner:'run-1',navigationOwner:'visit-1'};
const origin=n=>({visitIndex:n,sceneId:'00000000-1111-4111-8111-11111111111'+n,bindingId:'00000000-1111-4111-8111-22222222222'+n,instanceId:'00000000-1111-4111-8111-33333333333'+n,objectId:'00000000-1111-4111-8111-44444444444'+n});
const position=(n)=>({executionFrameIndex:n,clock:{idleFrame:n+4,physicsFrame:n+1}});
const value={format:'viento-project-event-positions',schemaVersion:1,phase:'recording',counts:{published:2,settled:1,pending:1,deliveries:3,handled:1,skipped:1,pendingDeliveries:1},retention:{limit:32,total:2,retained:2,dropped:0,pending:1,settled:1,firstSequence:1,lastSequence:2},items:[{sequence:1,name:'<img src=x onerror=alert(1)>',value:'ignored',origin:origin(1),published:position(3),deliveries:[{subscriptionId:1,origin:origin(2),status:'handled',delivered:position(5)},{subscriptionId:2,origin:origin(3),status:'skipped',delivered:position(6)},{subscriptionId:3,origin:origin(4),status:'pending'}]},{sequence:2,name:'无订阅者 / No recipients / 購読者なし',value:null,origin:origin(1),published:position(4),deliveries:[]}]};
const controller=setupProjectEventPositionsObservation({container:document.querySelector('#panel'),getContext:()=>context});controller.setSnapshot(value);
window.fixture={applyLanguage,context,value,controller};window.ready=true;
</script></body></html>`;
const server = http.createServer(async (req,res)=>{ try { const url = new URL(req.url,'http://localhost'); if(url.pathname === '/') {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(html);} const relative=decodeURIComponent(url.pathname).replace(/^\/+/, '');if(!sources.includes(relative)) {res.writeHead(404);return res.end();} const bytes=await fs.readFile(path.join(root,relative));res.writeHead(200,{'Content-Type':relative.endsWith('.css')?'text/css':'text/javascript','Cache-Control':'no-store'});res.end(bytes); } catch {res.writeHead(500);res.end();} });
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=await fs.mkdtemp('/tmp/viento-event-positions-chrome-');
const chrome=spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--window-size=1440,1100',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
let socket;
try {
 let port;for(let i=0;i<150;i++){try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await delay(100);}}if(!port)throw Error('Chrome failed to start');
 const pages=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await once(socket,'open');
 const pending=new Map();let seq=0;const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 socket.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.id){const x=pending.get(msg.id);pending.delete(msg.id);msg.error?x?.reject(Error(msg.error.message)):x?.resolve(msg.result);}else if(msg.method==='Runtime.exceptionThrown')report.errors.push(msg.params.exceptionDetails);else if(msg.method==='Page.javascriptDialogOpening'){report.errors.push({dialog:msg.params.message});void call('Page.handleJavaScriptDialog',{accept:false});}});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression:`(async()=>(${expression}))()`,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(output,name),Buffer.from(r.data,'base64'));report.screenshots.push(name);};
 await call('Runtime.enable');await call('Page.enable');report.browser=(await call('Browser.getVersion')).product;
 await call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 for(let i=0;i<100&&!await evaluate('window.ready===true');i++)await delay(100);assert.equal(await evaluate('window.ready'),true);
 for(const width of [1440,390]){
   await call('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false});
   for(const lang of ['zh-CN','en','ja']){
    await evaluate(`window.fixture.applyLanguage(${JSON.stringify(lang)})`);
    const r=await evaluate(`({viewport:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,title:document.querySelector('#projectEventPositionsTitle').textContent,note:document.querySelector('#projectEventPositionsNote').textContent,literal:document.querySelector('#projectEventPositionsEntries code').textContent,images:document.querySelectorAll('#panel img').length,rows:document.querySelectorAll('.project-event-position-delivery').length,pending:document.querySelector('[data-status="pending"] .project-event-position-status').textContent})`);
    assert.ok(r.scrollWidth<=r.viewport,JSON.stringify(r));assert.equal(r.literal,'<img src=x onerror=alert(1)>');assert.equal(r.images,0);assert.equal(r.rows,3);
    assert.equal(r.title,{'zh-CN':'事件位置观察',en:'Event position observation',ja:'イベント位置の観測'}[lang]);
    assert.equal(r.pending,{'zh-CN':'未确认',en:'Unconfirmed',ja:'未確認'}[lang]);report.checks.push({width,lang,...r});
    await shot(`${width}-${lang}.png`);
   }
 }
 await evaluate(`(()=>{const x=structuredClone(window.fixture.value);x.phase='incomplete';x.items[0].deliveries[2].status='handled';x.items[0].deliveries[2].delivered={executionFrameIndex:12,clock:{idleFrame:16,physicsFrame:13}};window.fixture.controller.setSnapshot(x)})()`);
 const updated=await evaluate(`({phase:document.querySelector('#projectEventPositionsPhase').dataset.phase,last:document.querySelector('[data-subscription-id="3"]').textContent})`);assert.equal(updated.phase,'incomplete');assert.match(updated.last,/12/);assert.match(updated.last,/16/);assert.match(updated.last,/13/);report.checks.push({dynamicUpdate:updated});await shot('390-ja-updated.png');
 await evaluate('window.fixture.controller.setSnapshot(null)');const cleared=await evaluate(`({hidden:document.querySelector('#projectEventPositionsPanel').hidden,items:document.querySelector('#projectEventPositionsEntries').children.length,phase:document.querySelector('#projectEventPositionsPhase').textContent})`);assert.deepEqual(cleared,{hidden:true,items:0,phase:''});report.checks.push({cleared});assert.deepEqual(report.errors,[]);report.ok=true;
} catch(error){report.ok=false;report.failure=String(error?.stack||error);process.exitCode=1;} finally {report.end=new Date().toISOString();await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n');socket?.close();if(chrome.exitCode===null && chrome.signalCode===null){const exited=once(chrome,'exit');chrome.kill();await exited;}await new Promise(resolve=>server.close(resolve));await fs.rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});}

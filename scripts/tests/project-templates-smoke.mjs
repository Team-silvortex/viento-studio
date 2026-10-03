// Chromium library/editor workflow with real native project creation/storage.
// The desktop folder picker/window launch and Android IPC wire are substituted.
// Run after desktop:prepare, mobile:prepare and building the mobile-storage example.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { nativeMobileLibrary } from './mobile-native-harness.mjs';

const binary = process.env.VIENTO_MOBILE_STORE_BIN;
if (!binary) throw new Error('Set VIENTO_MOBILE_STORE_BIN to the mobile-storage example.');
const output = path.resolve(process.env.VIENTO_TEMPLATE_TEST_OUTPUT || 'docs/test-results/oc-templates');
await fs.mkdir(output, { recursive: true });
const report = { browser: '', steps: [], errors: [], limitations: ['System pickers/window launches are substituted; no new APK or device test.'] };
const cleanups = [];
let socket;
let captureFailure;
async function wait(check, label) {
  for (let i = 0; i < 300; i++) { if (await check()) return; await delay(100); }
  throw new Error(`Timed out: ${label}`);
}
try {
  const library = await nativeMobileLibrary(binary); cleanups.push(() => library.close());
  const catalog = await library.invoke('mobile_storage', { action: 'templates' });
  const calls = [], recent = [];
  let language = 'zh-CN';
  const bridge = `const listeners=new Map();window.__TAURI__={core:{async invoke(command,args={}){const result=await fetch('/__invoke',{method:'POST',body:JSON.stringify({command,args})}).then(r=>r.json());if(result.error)throw result.error;if(command==='set_language')listeners.get('language-changed')?.({payload:args.language});return result.data;}},event:{async listen(name,handler){listeners.set(name,handler);return()=>listeners.delete(name);}}};`;
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/__invoke' && req.method === 'POST') {
        let body = ''; for await (const chunk of req) body += chunk;
        const { command, args } = JSON.parse(body); calls.push({ command, args });
        let data;
        if (command === 'library_state') data = { recent, active: null, version: 'test', projectTemplates: catalog };
        else if (command === 'get_language') data = language;
        else if (command === 'set_language') data = language = args.language;
        else if (command === 'new_workspace') {
          const workspace = await library.invoke('mobile_storage', { action: 'create', payload: args });
          data = { id: workspace.id, path: `test/${workspace.id}`, name: workspace.name, lastOpened: Date.now() };
          recent.push(data);
        } else if (command === 'launch_workspace') data = null;
        else throw new Error(`Unexpected command: ${command}`);
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data })); return;
      }
      if (req.url === '/bridge.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bridge); return; }
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const root = path.resolve('desktop/ui'), file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) throw new Error('Bad test path');
      let data = await fs.readFile(file);
      if (file.endsWith('.html')) data = Buffer.from(data.toString().replace('<head>', '<head><script src="/bridge.js"></script>'));
      res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream'); res.end(data);
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: String(error?.message || error) })); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  cleanups.push(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const desktopUrl = `http://127.0.0.1:${server.address().port}`;
  const mobileRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-template-mobile-'));
  cleanups.push(() => fs.rm(mobileRoot, { recursive: true, force: true }));
  const mobile = spawn(process.execPath, ['scripts/tests/mobile-browser.mjs'], { env: { ...process.env,
    VIENTO_MOBILE_STORE_BIN: binary, VIENTO_MOBILE_TEST_ROOT: mobileRoot, VIENTO_MOBILE_TEST_PORT: '0',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  cleanups.push(async () => { if (mobile.exitCode === null && mobile.signalCode === null) { const exited = once(mobile, 'exit'); mobile.kill(); await exited; } });
  let mobileLog = ''; mobile.stdout.on('data', chunk => { mobileLog += chunk; }); mobile.stderr.on('data', chunk => { mobileLog += chunk; });
  await wait(() => mobileLog.match(/\{"url":"(http:\/\/127.0.0.1:\d+)"/), 'mobile host');
  const mobileUrl = mobileLog.match(/\{"url":"(http:\/\/127.0.0.1:\d+)"/)[1];
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-template-chrome-'));
  cleanups.push(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const chrome = spawn(process.argv[2] || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1200,1000', 'about:blank'], { stdio: 'ignore' });
  cleanups.push(async () => { if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; } });
  let port;
  await wait(async () => { try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return !!port; } catch { return false; } }, 'Chrome');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
  const pending = new Map(); let sequence = 0;
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (value.id) { const request = pending.get(value.id); pending.delete(value.id); value.error ? request?.reject(new Error(value.error.message)) : request?.resolve(value.result); }
    else if (value.method === 'Runtime.exceptionThrown') report.errors.push(value.params.exceptionDetails);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  const screenshot = async name => {
    const result = await call('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(output, name), Buffer.from(result.data, 'base64'));
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const input = (selector, value, event = 'input') => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`);
  captureFailure = async () => {
    await screenshot('failure.png');
    report.diagnostic = await evaluate(`({ url: location.href, text: document.body.innerText, source: document.querySelector('#docSourceEditor')?.value })`);
  };
  await call('Runtime.enable'); await call('Page.enable');
  report.browser = (await call('Browser.getVersion')).product;
  await call('Page.navigate', { url: desktopUrl });
  await wait(() => evaluate(`document.querySelector('#createBtn')?.disabled === false`), 'desktop library');
  await click('#createBtn');
  assert.equal(await evaluate(`document.querySelector('#projectTemplate').value`), 'org.viento.blank');
  assert.deepEqual(await evaluate(`Array.from(document.querySelector('#projectTemplate').options, option => option.textContent)`), ['空白工程', '游戏', '文学', '戏剧', '软件设计']);
  await input('#projectTemplate', 'org.viento.oc-game', 'change');
  await evaluate(`window.__TAURI__.core.invoke('set_language', {language:'en'})`);
  assert.deepEqual(await evaluate(`Array.from(document.querySelector('#projectTemplate').options, option => option.textContent)`), ['Blank project', 'Game', 'Literature', 'Drama', 'Software design']);
  await screenshot('desktop-template-en.png');
  await click('#cancelCreateBtn');
  assert.equal(calls.some(item => item.command === 'new_workspace'), false);
  for (const [index, kind] of ['game', 'literature', 'drama'].entries()) {
    await wait(() => evaluate(`document.querySelector('#createBtn')?.disabled === false`), 'desktop idle');
    await click('#createBtn'); await input('#projectTemplate', `org.viento.oc-${kind}`, 'change');
    await input('#workspaceName', `Independent ${kind}`);
    await evaluate(`document.querySelector('#createForm').requestSubmit()`);
    await wait(() => calls.filter(item => item.command === 'launch_workspace').length === index + 1, 'desktop create');
    assert.equal(calls.filter(item => item.command === 'new_workspace').at(-1).args.templateId, `org.viento.oc-${kind}`);
    const created = (await library.invoke('mobile_storage', { action: 'list' })).find(work => work.name === `Independent ${kind}`);
    assert.equal(created.projectTemplate.packageId, `org.viento.oc-${kind}`);
    assert.ok(created.documentTypes.some(type => type.id === { game: 'ability', literature: 'chapter', drama: 'act' }[kind]));
  }
  report.steps.push('Desktop: five choices without legacy OC, translated labels, cancel, and native creation of game/literature/drama projects');

  await call('Emulation.setDeviceMetricsOverride', { width: 430, height: 920, deviceScaleFactor: 1, mobile: true });
  await call('Page.navigate', { url: mobileUrl });
  await wait(() => evaluate(`document.querySelector('#projectTemplate')?.options.length === 5 && !document.querySelector('#projectTemplate').disabled`), 'mobile catalogue');
  assert.equal(await evaluate(`document.querySelector('#projectTemplate').value`), 'org.viento.blank');
  await input('#projectTemplate', 'org.viento.oc-drama', 'change');
  await click('#settingsBtn'); await input('#languageSelect', 'ja', 'change');
  await click('#settingsDialog button[type="submit"]');
  assert.deepEqual(await evaluate(`Array.from(document.querySelector('#projectTemplate').options, option => option.textContent)`), ['空のプロジェクト', 'ゲーム', '文学', '演劇', 'ソフトウェア設計']);
  await screenshot('mobile-template-ja.png');
  assert.equal(await evaluate(`document.documentElement.scrollWidth > innerWidth`), false);
  await input('#workspaceName', 'Drama dialogue');
  await evaluate(`document.querySelector('#createWorkspace').requestSubmit()`);
  await wait(() => evaluate(`location.pathname === '/editor.html' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable && document.querySelector('#docCreateBtn')?.disabled === false`), 'new drama editor');
  await click('#docCreateBtn');
  await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.isCreating && !(await import('/web/modules/app-state.js')).appState.isLoadingTemplate`), 'initial drama template');
  await input('#docCreateTypeSelect', 'scene', 'change');
  await wait(() => evaluate(`document.querySelector('#docSourceEditor').value.includes('台词与舞台提示')`), 'drama scene template');
  assert.deepEqual(await evaluate(`Array.from(document.querySelector('#docCreateTypeSelect').options, option => option.value)`), ['document', 'character', 'act', 'scene', 'stage-direction', 'prop']);
  const dialogue = '# 第一场\n\n（灯光亮起）\n\n人物甲：你是谁？\n\n人物乙：旅人。\n\n人物甲：我也是。\n';
  await input('#docSourceEditor', dialogue);
  await click('#docSaveBtn');
  await wait(() => evaluate(`!(await import('/web/modules/app-state.js')).appState.isCreating && !(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`), 'save drama dialogue');
  const drama = await evaluate(`(() => import('/web/modules/app-state.js').then(({appState}) => ({ id: appState.workspace.id, doc: { id: appState.docs[0].id, raw: appState.docs[0].raw, fields: appState.docs[0].fields } })))()`);
  assert.equal(drama.doc.raw, dialogue);
  assert.deepEqual(Object.keys(drama.doc.fields), ['_header']);
  await call('Page.navigate', { url: `${mobileUrl}/editor.html?mode=edit&workspace=${drama.id}&reopened=drama` });
  await wait(() => evaluate(`location.search.includes('reopened=drama') && (await import('/web/modules/app-state.js')).appState.docs[0]?.id === ${JSON.stringify(drama.doc.id)} && document.querySelector('#docTitle')?.textContent.includes('第一场')`), 'reopen drama dialogue');
  assert.equal(await evaluate(`(await import('/web/modules/app-state.js')).appState.docs[0].raw`), dialogue);
  const stageText = await evaluate(`document.querySelector('#sectionCards').innerText`);
  for (const line of ['（灯光亮起）', '人物甲：你是谁？', '人物乙：旅人。', '人物甲：我也是。']) assert.ok(stageText.includes(line), line);
  await evaluate(`document.querySelector('#sectionCards').scrollIntoView({block: 'center'})`);
  await screenshot('drama-dialogue-ja.png');
  report.steps.push('Mobile: Japanese drama selection, scene template, repeated speakers and stage directions stay prose through save/reopen');
  await call('Page.navigate', { url: `${mobileUrl}/?new=software` });
  await wait(() => evaluate(`location.search.includes('new=software') && document.querySelector('#projectTemplate')?.options.length === 5 && !document.querySelector('#projectTemplate').disabled`), 'return to mobile library');
  await input('#projectTemplate', 'org.viento.software-design', 'change');
  await input('#workspaceName', 'Software workflow');
  await evaluate(`document.querySelector('#createWorkspace').requestSubmit()`);
  await wait(() => evaluate(`location.pathname === '/editor.html' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable && document.querySelector('#docCreateBtn')?.disabled === false`), 'new mobile editor');
  await click('#docCreateBtn');
  await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.isCreating && !(await import('/web/modules/app-state.js')).appState.isLoadingTemplate`), 'initial document template');
  await input('#docCreateTypeSelect', 'component', 'change');
  await wait(() => evaluate(`document.querySelector('#docSourceEditor').value.includes('名称: 新建组件')`), 'YAML component template');
  assert.deepEqual(await evaluate(`Array.from(document.querySelector('#docCreateTypeSelect').options, option => option.value)`), ['document', 'component', 'interface', 'workflow', 'verification']);
  await click('#docEditFieldModeBtn');
  await wait(() => evaluate(`document.querySelectorAll('#docFieldEditor .doc-field-input').length > 1`), 'component fields');
  await input('#docFieldValue-0', 'Independent component');
  await input('#docFieldValue-1', 'Own responsibility');
  await screenshot('software-fields-ja.png');
  await click('#docSaveBtn');
  await wait(() => evaluate(`!(await import('/web/modules/app-state.js')).appState.isCreating && !(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`), 'save YAML');
  const state = await evaluate(`(() => import('/web/modules/app-state.js').then(({appState}) => ({ id: appState.workspace.id, docs: appState.docs.map(doc => ({ id: doc.id, raw: doc.raw, documentType: doc.documentType })) })))()`);
  assert.equal(state.docs[0].documentType, 'component');
  assert.match(state.docs[0].raw, /Independent component/); assert.match(state.docs[0].raw, /Own responsibility/);
  await call('Page.navigate', { url: `${mobileUrl}/editor.html?mode=edit&workspace=${state.id}&reopened=1` });
  await wait(() => evaluate(`location.search.includes('reopened=1') && (await import('/web/modules/app-state.js')).appState.docs[0]?.id === ${JSON.stringify(state.docs[0].id)} && document.querySelector('#docTitle')?.textContent.includes('Independent component')`), 'reopen component');
  const reopened = await evaluate(`(await import('/web/modules/app-state.js')).appState.docs[0].id`);
  assert.equal(reopened, state.docs[0].id);
  report.steps.push('Mobile: software template selection in Japanese, YAML template/field editing, save and reload with stable identity');
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
  await fs.rm(path.join(output, 'failure.png'), { force: true });
} catch (error) {
  await captureFailure?.().catch(() => {});
  report.status = 'failed'; report.failure = String(error.stack || error); process.exitCode = 1;
} finally {
  if (socket) socket.close();
  for (const cleanup of cleanups.reverse()) await cleanup();
  await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

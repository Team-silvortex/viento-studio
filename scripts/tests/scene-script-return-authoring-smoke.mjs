// Real Chrome authoring from three independent official blank workspaces.
// No prepared scene/gameplay manifest or generated runtime is injected.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import '../adapters/node-studio-core.mjs';
import { serve, request } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';
import { readRegistry, registerWorkspace } from '../lib/workspace.mjs';
import { PROJECT_TEMPLATE_CATALOG, WORKSPACE_LAYOUT } from '../lib/project-layout.mjs';
import { listScriptStarters } from '../../engine/script-authoring.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.env.VIENTO_SCRIPT_RETURN_OUTPUT || '/tmp/viento-script-return-browser');
if (!output.startsWith('/tmp/')) throw Error('Evidence must use a new directory below /tmp.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const q = JSON.stringify;
const wait = async (check, label, budget = 45000) => {
  for (const end = Date.now() + budget; Date.now() < end;) { if (await check()) return; await delay(80); }
  throw Error('Timed out: ' + label);
};
async function authorTree(root) {
  const rows = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name), name = path.relative(root, file);
    if (name.split(path.sep).some(part => part.startsWith('.'))) continue;
    rows[name] = hash(await fs.readFile(file));
  }
  return Object.fromEntries(Object.entries(rows).sort());
}
async function sourceHashes() {
  const rows = {};
  for (const folder of ['engine', 'web/modules', 'scripts/lib', 'scripts/adapters', 'scripts/backends']) {
    for (const entry of await fs.readdir(path.join(appRoot, folder), { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:mjs|js)$/.test(entry.name)) continue;
      const name = folder + '/' + entry.name; rows[name] = hash(await fs.readFile(path.join(appRoot, name)));
    }
  }
  for (const name of ['scripts/lib/project-templates.json', 'web/i18n/en.js', 'web/i18n/ja.js', 'web/scene-behavior-create.css', 'web/script-create.css']) rows[name] = hash(await fs.readFile(path.join(appRoot, name)));
  return Object.fromEntries(Object.entries(rows).sort());
}
const cleanups = [], fixture = { after: callback => cleanups.push(callback) };
const report = { startedAt: new Date().toISOString(), cases: [], screenshots: [], errors: [], dialogs: [], limitations: [
  'Each case initializes the official blank template layout with zero authored documents, registered documents or assets; desktop-library folder selection, installed Tauri and Android are outside this browser case.',
  'Definitions, two-instance scenes, official ordinary TXT drafts and behavior manifests are created with real Studio controls. The signal starter and generated Godot source are never edited by the driver.',
  'The changed-source case uses the real ordinary document HTTP API and optimistic version check to simulate another editor, then restores the exact original scene bytes through that same API.',
  'Only the successful case performs one Godot plan, one build and one headless run. This verifies a first-behavior continuation, not a complete game or native input workflow.'
] };
let socket, captureFailure;
try {
  report.driverSha256 = hash(await fs.readFile(fileURLToPath(import.meta.url)));
  report.node = { version: process.version, sha256: hash(await fs.readFile(process.execPath)) };
  if (process.env.VIENTO_GODOT_BIN) report.godot = { path: process.env.VIENTO_GODOT_BIN, sha256: hash(await fs.readFile(process.env.VIENTO_GODOT_BIN)) };
  report.sourcesBefore = await sourceHashes();
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-script-return-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const profile = path.join(temporary, 'chrome'); await fs.mkdir(profile);
  const chrome = spawn(process.argv[2] || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile, '--remote-debugging-port=0', '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore' });
  cleanups.push(async () => { if (chrome.exitCode === null && chrome.signalCode === null) { const ended = once(chrome, 'exit'); chrome.kill(); await ended; } });
  let port;
  await wait(async () => { try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return Boolean(port); } catch { return false; } }, 'Chrome startup');
  const pages = await fetch('http://127.0.0.1:' + port + '/json/list').then(row => row.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
  const requests = new Map(); let sequence = 0;
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; requests.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  socket.addEventListener('message', event => {
    const row = JSON.parse(event.data);
    if (row.id) { const pending = requests.get(row.id); requests.delete(row.id); row.error ? pending?.reject(Error(row.error.message)) : pending?.resolve(row.result); }
    else if (row.method === 'Runtime.exceptionThrown') report.errors.push(row.params.exceptionDetails);
    else if (row.method === 'Page.javascriptDialogOpening') { report.dialogs.push({ type: row.params.type, message: row.params.message, accepted: true }); void call('Page.handleJavaScriptDialog', { accept: true }); }
  });
  const evaluate = async expression => { const row = await call('Runtime.evaluate', { expression: '(async()=>(' + expression + '))()', awaitPromise: true, returnByValue: true, userGesture: true }); if (row.exceptionDetails) throw Error(JSON.stringify(row.exceptionDetails)); return row.result.value; };
  const click = selector => evaluate('document.querySelector(' + q(selector) + ').click()');
  const fill = (selector, value, event = 'input') => evaluate('(()=>{const e=document.querySelector(' + q(selector) + ');e.value=' + q(value) + ';e.dispatchEvent(new Event(' + q(event) + ',{bubbles:true}));})()');
  const value = selector => evaluate('document.querySelector(' + q(selector) + ').value');
  const text = selector => evaluate('document.querySelector(' + q(selector) + ')?.textContent');
  const enabled = selector => wait(() => evaluate('(()=>{const e=document.querySelector(' + q(selector) + ');return e?.disabled===false&&!e.hidden&&e.getClientRects().length>0;})()'), selector + ' enabled');
  const screenshot = async name => { const row = await call('Page.captureScreenshot', { format: 'png' }), bytes = Buffer.from(row.data, 'base64'); await fs.writeFile(path.join(output, name), bytes); report.screenshots.push({ name, bytes: bytes.length, sha256: hash(bytes) }); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Page.addScriptToEvaluateOnNewDocument', { source: "(()=>{window.__returnRequests=[];const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const url=String(input),response=await original(input,init);if(url.includes('/api/scene-behavior-creation')||url.includes('/api/world/commands')||url.startsWith('/api/doc')){let body=null,result=null;try{body=JSON.parse(init?.body||'null')}catch{};try{result=await response.clone().json()}catch{};window.__returnRequests.push({url,method:init?.method||'GET',body,status:response.status,result});}return response;};})()" });

  for (const caseName of ['success', 'cancel', 'changed-source']) {
    const row = { name: caseName, steps: [], stages: [], layouts: {}, jobs: [] }; report.cases.push(row);
    console.log('Starting case: ' + caseName);
    const author = path.join(temporary, caseName); await fs.mkdir(author);
    const blank = PROJECT_TEMPLATE_CATALOG.templates.find(item => item.packageId === 'org.viento.blank'); assert.ok(blank);
    const workspace = { format: 'viento-workspace', version: 3, id: randomUUID(), name: 'Script return ' + caseName, createdAt: 0, ...structuredClone(WORKSPACE_LAYOUT), documentTypes: structuredClone(blank.documentTypes) };
    await fs.writeFile(path.join(author, 'workspace.json'), JSON.stringify(workspace, null, 2) + '\n');
    for (const folder of ['documents', 'assets', 'templates', 'metadata/documents', 'metadata/assets']) await fs.mkdir(path.join(author, folder), { recursive: true });
    for (const [name, content] of Object.entries(blank.templates)) await fs.writeFile(path.join(author, 'templates', name), content);
    await registerWorkspace(author);
    const registry = await readRegistry(author); assert.deepEqual(registry.documents, []); assert.deepEqual(registry.assets, []);
    row.initialization = { templateId: blank.packageId, templateVersion: blank.version, authoredDocuments: 0, registeredDocuments: 0, assets: 0, documentTypes: workspace.documentTypes.map(item => item.id) };
    const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: author, XDG_CACHE_HOME: path.join(temporary, caseName + '-cache'), XDG_CONFIG_HOME: path.join(temporary, caseName + '-config'), XDG_DATA_HOME: path.join(temporary, caseName + '-data') };
    delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
    const initial = await authorTree(author);
    const indexed = await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env }); assert.equal(indexed.code, 0, JSON.stringify(indexed)); assert.deepEqual(await authorTree(author), initial);
    const base = await serve(fixture, appRoot, env);
    let previous = initial;
    const stage = async name => { const after = await authorTree(author), changedPaths = [...new Set([...Object.keys(previous), ...Object.keys(after)])].filter(name => previous[name] !== after[name]).sort(); row.stages.push({ name, changedPaths, hashes: Object.fromEntries(changedPaths.map(name => [name, after[name] || null])) }); previous = after; return after; };
    const record = async sourcePath => { const found = (await readRegistry(author)).documents.find(item => item.sourcePath === sourcePath); assert.ok(found, 'saved registration ' + sourcePath); return found; };
    const idle = () => wait(() => evaluate('!window.__returnState.isSaving&&!window.__returnState.isRebuilding&&!window.__returnState.isLoadingSource&&!window.__returnState.editHasUnsavedChanges'), 'ordinary save idle');
    const save = async sourcePath => { await enabled('#docSaveBtn'); await click('#docSaveBtn'); await wait(async () => (await readRegistry(author)).documents.some(item => item.sourcePath === sourcePath), 'ordinary Save ' + sourcePath); await idle(); };
    const closeBuild = async () => { await click('#projectBuildClose'); await wait(() => evaluate("!document.querySelector('#projectBuildDialog').open"), 'build closed'); };
    const openBuild = async sceneId => { if (!await evaluate("document.querySelector('#projectBuildDialog').open")) { await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); } if (sceneId) { await enabled('#projectBuildScene'); await fill('#projectBuildScene', sceneId, 'change'); } };
    captureFailure = async () => { await screenshot(caseName + '-failure.png'); row.pageFailure = await evaluate("({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,state:window.__returnState,requests:window.__returnRequests})"); };
    await call('Page.navigate', { url: base + '/web/?mode=edit' });
    await wait(() => evaluate("document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable"), 'Studio startup');
    await evaluate("window.__returnState=(await import('/web/modules/app-state.js')).appState");
    await wait(() => evaluate('window.__returnState.workspace?.name===' + q(workspace.name)), 'correct independent blank workspace');

    await enabled('#docCreateBtn'); await click('#docCreateBtn'); await wait(() => evaluate('window.__returnState.isCreating&&!window.__returnState.isLoadingTemplate'), 'ordinary definition draft');
    await fill('#docCreatePathInput', 'documents/definition.md'); await fill('#docSourceEditor', '# Context actor\n\nA generic object authored in Studio from a blank project.\n'); await save('documents/definition.md');
    const definition = await record('documents/definition.md'); await stage('ordinary generic definition');
    await openBuild(); await enabled('#projectBuildCreateScene'); await click('#projectBuildCreateScene'); await enabled('#sceneCreateCheck');
    const scenePath = 'documents/scenes/context.json', manifestPath = 'documents/behaviors/context.json', scriptPath = 'documents/scripts/context.txt';
    await fill('#sceneCreateName', 'Context · 返回 · 戻る'); await fill('#sceneCreatePath', scenePath); await fill('#sceneCreateType', 'document', 'change');
    await fill('#sceneActor0Object', definition.id, 'change'); await fill('#sceneActor0Controls', 'none', 'change'); await fill('#sceneActor0Speed', '0');
    await enabled('#sceneCreateAdd'); await click('#sceneCreateAdd'); await enabled('#sceneActor1Object');
    await fill('#sceneActor1Object', definition.id, 'change'); await fill('#sceneActor1Controls', 'none', 'change'); await fill('#sceneActor1Speed', '0');
    await click('#sceneCreateCheck'); await enabled('#sceneCreateSave');
    const sceneContent = await text('#sceneCreateSource'), sceneModel = JSON.parse(sceneContent);
    assert.equal(sceneModel.actors.length, 2); assert.equal(new Set(sceneModel.actors.map(item => item.instanceId)).size, 2);
    assert.ok(sceneModel.actors.every(item => item.objectId === definition.id));
    const selectedInstance = sceneModel.actors[1].instanceId;
    await click('#sceneCreateSave'); await wait(async () => { try { return await fs.readFile(path.join(author, scenePath), 'utf8') === sceneContent; } catch { return false; } }, 'actual two-instance scene saved');
    await enabled('#sceneCreateClose'); await click('#sceneCreateClose'); await wait(() => evaluate("!document.querySelector('#sceneCreateDialog').open"), 'scene creator closed');
    const scene = await record(scenePath); await stage('two-instance scene created');
    row.scene = { objectId: scene.id, sourcePath: scenePath, sha256: hash(sceneContent), instanceIds: sceneModel.actors.map(item => item.instanceId), selectedInstance };
    await closeBuild(); await openBuild(scene.id); await enabled('#projectBuildCreateBehavior'); await click('#projectBuildCreateBehavior');
    await enabled('#sceneBehaviorCreatePath'); await wait(() => evaluate("!document.querySelector('#sceneBehaviorCreateEmpty').hidden"), 'no registered TXT script');
    const profileId = caseName === 'cancel' ? 'bevy-rust' : 'godot-gdscript';
    await fill('#sceneBehaviorCreateProfile', profileId, 'change'); await fill('#sceneBehaviorCreateType', 'document', 'change'); await fill('#sceneBehaviorCreatePath', manifestPath); await fill('#sceneBehaviorCreateInstance', selectedInstance, 'change');
    assert.equal(await value('#sceneBehaviorCreateSource'), '');
    const configuration = () => evaluate("({profile:document.querySelector('#sceneBehaviorCreateProfile').value,type:document.querySelector('#sceneBehaviorCreateType').value,path:document.querySelector('#sceneBehaviorCreatePath').value,binding:document.querySelector('#sceneBehaviorCreateBindingList').value,instance:document.querySelector('#sceneBehaviorCreateInstance').value,source:document.querySelector('#sceneBehaviorCreateSource').value,identityIds:(document.querySelector('#sceneBehaviorCreateIdentity').textContent.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/g)||[])})");
    const expected = await configuration(); row.localConfiguration = expected;
    assert.equal(expected.identityIds.length, 2); assert.equal(expected.identityIds[1], expected.binding); assert.equal(expected.instance, selectedInstance); assert.equal(await evaluate("document.querySelector('#sceneBehaviorCreateCheck').disabled"), true);
    const beforeSuspension = await authorTree(author), firstReads = await evaluate("window.__returnRequests.filter(item=>item.url==='/api/scene-behavior-creation').length");
    const startScript = async () => { await enabled('#sceneBehaviorCreateNewScript'); await click('#sceneBehaviorCreateNewScript'); await enabled('#scriptCreateApply'); assert.equal(await evaluate("document.querySelector('#sceneBehaviorCreateDialog').open"), false); assert.equal(await evaluate("document.querySelector('#projectBuildDialog').open"), false); };
    const returnContext = async () => { const reads = await evaluate("window.__returnRequests.filter(item=>item.url==='/api/scene-behavior-creation').length"); await enabled('#sceneBehaviorScriptReturn'); await click('#sceneBehaviorScriptReturn'); await enabled('#sceneBehaviorCreatePath'); assert.deepEqual(await configuration(), expected); assert.ok(await evaluate("window.__returnRequests.filter(item=>item.url==='/api/scene-behavior-creation').length") > reads, 'fresh catalog requested during explicit return'); assert.equal(await evaluate("document.querySelector('#sceneBehaviorCreateSave').disabled"), true); assert.equal(await value('#projectBuildScene'), scene.id); assert.equal(await value('#sceneBehaviorCreateSource'), ''); };
    const fillStarter = async () => { const starter = caseName === 'cancel' ? 'bevy-rust-signal' : 'godot-signal'; await fill('#scriptCreateStarter', starter, 'change'); await fill('#scriptCreateType', 'document', 'change'); await fill('#scriptCreatePath', scriptPath); const expectedSource = listScriptStarters().find(item => item.id === starter).content; assert.equal(await text('#scriptCreateSource'), expectedSource); return expectedSource; };
    const narrowCreator = async name => {
      for (const language of ['zh-CN', 'en', 'ja']) {
        await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }); await evaluate("(await import('/web/i18n/index.js')).applyLanguage(" + q(language) + ')');
        await evaluate("document.querySelector('#sceneBehaviorCreateNewScript').scrollIntoView({block:'center'})");
        const layout = await evaluate("(()=>{const d=document.querySelector('#sceneBehaviorCreateDialog'),a=document.querySelector('#sceneBehaviorCreateNewScript').getBoundingClientRect();return {noOverflow:d.scrollWidth<=d.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1,title:document.querySelector('#sceneBehaviorCreateTitle').textContent,newScript:document.querySelector('#sceneBehaviorCreateNewScript').textContent,actionVisible:a.top>=0&&a.bottom<=844&&a.left>=0&&a.right<=390};})()");
        assert.equal(layout.noOverflow, true); assert.equal(layout.actionVisible, true); assert.equal(await evaluate("(()=>{const e=document.querySelector('#sceneBehaviorCreateNewScript'),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return hit===e||e.contains(hit);})()"), true); assert.deepEqual(await configuration(), expected); row.layouts[name + '-' + language] = layout; await screenshot(caseName + '-' + name + '-' + language + '-390.png');
      }
      await call('Emulation.clearDeviceMetricsOverride'); await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");
    };

    const narrowReturn = async name => {
      for (const language of ['zh-CN', 'en', 'ja']) {
        await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }); await evaluate("(await import('/web/i18n/index.js')).applyLanguage(" + q(language) + ')');
        if (await evaluate("document.querySelector('#docSidebarToggleBtn')?.getAttribute('aria-expanded')==='true'")) await click('#docSidebarToggleBtn');
        await evaluate("document.querySelector('#sceneBehaviorScriptTools').scrollIntoView({block:'center'})");
        await wait(() => evaluate("['#sceneBehaviorScriptReturn','#sceneBehaviorScriptDiscard'].every(id=>{const e=document.querySelector(id),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return hit===e||e.contains(hit);})"), 'return actions visibly reachable at 390px');
        const layout = await evaluate("(()=>{const d=document.querySelector('#sceneBehaviorScriptTools'),rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};return {noOverflow:d.scrollWidth<=d.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1,visible:!d.hidden,status:document.querySelector('#sceneBehaviorScriptStatus').textContent,back:rect('#sceneBehaviorScriptReturn'),discard:rect('#sceneBehaviorScriptDiscard')};})()");
        assert.equal(layout.noOverflow, true); assert.equal(layout.visible, true);
        for (const action of ['back', 'discard']) assert.ok(layout[action].top>=0&&layout[action].bottom<=844&&layout[action].left>=0&&layout[action].right<=390, JSON.stringify(layout));
        row.layouts[name + '-' + language] = layout; await screenshot(caseName + '-' + name + '-' + language + '-390.png');
      }
      await call('Emulation.clearDeviceMetricsOverride'); await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");
    };

    if (caseName === 'cancel') {
      await startScript(); await fillStarter(); await click('#scriptCreateCancel'); await wait(() => evaluate("!document.querySelector('#scriptCreateDialog').open"), 'picker cancelled');
      assert.equal(await evaluate('window.__returnState.isCreating'), false); assert.deepEqual(await authorTree(author), beforeSuspension);
      await returnContext(); assert.deepEqual(await authorTree(author), beforeSuspension); row.steps.push('Cancelling the starter picker creates no document; explicit Return restores the same Bevy profile, path, object and binding identities and second instance.');
      await startScript(); const scriptContent = await fillStarter(); await click('#scriptCreateApply'); await wait(() => evaluate('window.__returnState.isCreating'), 'ordinary unsaved script draft');
      assert.equal(await value('#docSourceEditor'), scriptContent); assert.deepEqual(await authorTree(author), beforeSuspension);
      await enabled('#docCancelBtn'); await click('#docCancelBtn'); await wait(() => evaluate('!window.__returnState.isCreating&&!window.__returnState.editHasUnsavedChanges'), 'ordinary script draft cancelled');
      await returnContext(); assert.deepEqual(await authorTree(author), beforeSuspension); await narrowCreator('restored');
      row.steps.push('Creating then cancelling the ordinary Rust TXT draft also writes nothing and preserves the original configuration through explicit Return.');
      await startScript(); await click('#scriptCreateCancel'); await wait(() => evaluate("!document.querySelector('#scriptCreateDialog').open"), 'last picker closed');
      await enabled('#sceneBehaviorScriptDiscard'); await click('#sceneBehaviorScriptDiscard'); await wait(() => evaluate("!document.querySelector('#sceneBehaviorScriptTools')||document.querySelector('#sceneBehaviorScriptTools').hidden"), 'staged continuation explicitly discarded');
      assert.deepEqual(await authorTree(author), beforeSuspension); assert.equal((await readRegistry(author)).documents.length, 2); row.steps.push('Explicitly discarding the final staged continuation clears the return action and leaves all two-document author bytes unchanged.');
    } else {
      await startScript(); const scriptContent = await fillStarter(); assert.deepEqual(await authorTree(author), beforeSuspension); await click('#scriptCreateApply');
      await wait(() => evaluate("!document.querySelector('#scriptCreateDialog').open&&window.__returnState.isCreating"), 'ordinary TXT draft created');
      assert.equal(await value('#docSourceEditor'), scriptContent); assert.deepEqual(await authorTree(author), beforeSuspension); await save(scriptPath);
      assert.equal(await fs.readFile(path.join(author, scriptPath), 'utf8'), scriptContent);
      const script = await record(scriptPath), afterScript = await stage('ordinary official signal TXT saved');
      const changedByScript = Object.keys(afterScript).filter(name => beforeSuspension[name] !== afterScript[name]).sort();
      assert.deepEqual(changedByScript, [scriptPath, 'metadata/documents/' + script.id + '.json'].sort());
      for (const [name, checksum] of Object.entries(beforeSuspension)) assert.equal(afterScript[name], checksum);
      row.script = { objectId: script.id, sourcePath: scriptPath, sha256: hash(scriptContent) };
      row.steps.push('The continuation opens the normal starter picker; Apply creates only an ordinary draft and Save adds exactly the unchanged official signal TXT plus its registration.');
      await narrowReturn('saved-return');
      if (caseName === 'changed-source') {
        const before = await request(base, '/api/doc?path=' + encodeURIComponent(scenePath)); assert.equal(before.status, 200);
        const changed = await request(base, '/api/doc', { path: scenePath, content: before.data.content + '\n', expectedVersion: before.data.version }); assert.equal(changed.status, 200, JSON.stringify(changed));
        const afterExternal = await stage('external ordinary scene edit');
        const editorBeforeRefusal = await evaluate('({path:window.__returnState.activePath,source:window.__returnState.activeEditSource,text:document.querySelector("#docSourceEditor").value})');
        assert.deepEqual(row.stages.at(-1).changedPaths, [scenePath]); await enabled('#sceneBehaviorScriptReturn'); await click('#sceneBehaviorScriptReturn');
        await wait(() => evaluate("!document.querySelector('#sceneBehaviorScriptReturn').disabled"), 'changed source refusal finished');
        const status = await text('#sceneBehaviorScriptStatus'); assert.ok(status); assert.equal(await evaluate("document.querySelector('#sceneBehaviorCreateDialog').open"), false);
        assert.deepEqual(await authorTree(author), afterExternal); assert.equal((await readRegistry(author)).documents.length, 3);
        assert.deepEqual(await evaluate('({path:window.__returnState.activePath,source:window.__returnState.activeEditSource,text:document.querySelector("#docSourceEditor").value})'), editorBeforeRefusal);
        row.rejectedReturn = { status, authorUnchanged: true, scriptPreserved: true, editorUnchanged: true };
        await screenshot('changed-source-refused.png');
        const latest = await request(base, '/api/doc?path=' + encodeURIComponent(scenePath)); assert.equal(latest.status, 200);
        const restored = await request(base, '/api/doc', { path: scenePath, content: sceneContent, expectedVersion: latest.data.version }); assert.equal(restored.status, 200, JSON.stringify(restored));
        await returnContext(); assert.deepEqual(await authorTree(author), afterScript); await narrowCreator('recovered');
        row.steps.push('A genuine concurrent scene save rejects Return without creating or binding a behavior. Restoring those scene bytes through the same ordinary API permits a second explicit Return, proving that every original local field and stable identity survived the refusal.');
        await click('#sceneBehaviorCreateCancel'); await wait(() => evaluate("!document.querySelector('#sceneBehaviorCreateDialog').open"), 'recovered behavior draft cancelled');
        assert.deepEqual(await authorTree(author), afterScript);
      } else {
        await returnContext(); await narrowCreator('returned'); assert.deepEqual(await authorTree(author), afterScript);
        assert.ok(await evaluate("Array.from(document.querySelector('#sceneBehaviorCreateSource').options).some(item=>item.value===" + q(script.id) + ')'), 'fresh catalog contains ordinary saved TXT');
        assert.equal(await evaluate("document.querySelector('#sceneBehaviorCreateCheck').disabled"), false);
        await fill('#sceneBehaviorCreateSource', script.id, 'change'); await click('#sceneBehaviorCreateCheck'); await enabled('#sceneBehaviorCreateSave');
        const preview = JSON.parse(await text('#sceneBehaviorCreateSourceText')); assert.equal(preview.bindings.length, 1); assert.equal(preview.bindings[0].bindingId, expected.binding); assert.equal(preview.bindings[0].instanceId, selectedInstance); assert.equal(preview.bindings[0].implementation.sourceObjectId, script.id);
        assert.deepEqual(preview.bindings[0].parameters, {}); assert.deepEqual(preview.bindings[0].events, []); assert.deepEqual(await authorTree(author), afterScript);
        await click('#sceneBehaviorCreateSave'); await enabled('#sceneBehaviorCreateOpen');
        const behavior = await record(manifestPath); assert.equal(behavior.id, expected.identityIds[0]); const createdContent = await fs.readFile(path.join(author, manifestPath), 'utf8');
        assert.deepEqual(JSON.parse(createdContent), preview); const afterBehavior = await stage('explicit reviewed behavior transaction');
        assert.deepEqual(row.stages.at(-1).changedPaths, [manifestPath, 'metadata/documents/' + behavior.id + '.json', 'metadata/documents/' + scene.id + '.json'].sort());
        assert.equal(await fs.readFile(path.join(author, scenePath), 'utf8'), sceneContent); assert.equal(await fs.readFile(path.join(author, scriptPath), 'utf8'), scriptContent);
        await click('#sceneBehaviorCreateOpen'); await wait(() => evaluate("!document.querySelector('#sceneBehaviorCreateDialog').open&&!document.querySelector('#projectBuildDialog').open"), 'behavior opened in ordinary editor');
        await enabled('#sceneBehaviorsBtn'); await click('#sceneBehaviorsBtn'); await enabled('#sceneBehaviorsAddEvent');
        assert.equal(await value('#sceneBehaviorsBinding'), expected.binding); assert.equal(await value('#sceneBehaviorsInstance'), selectedInstance);
        await click('#sceneBehaviorsAddEvent'); await fill('#sceneBehaviorsEvent0Signal', 'arrived'); await fill('#sceneBehaviorsEvent0Name', 'context_ready'); await click('#sceneBehaviorsCheck'); await enabled('#sceneBehaviorsApply');
        const candidate = await text('#sceneBehaviorsAfter'); await click('#sceneBehaviorsApply'); await wait(() => evaluate("!document.querySelector('#sceneBehaviorsDialog').open"), 'mapped event applied to draft');
        assert.equal(await fs.readFile(path.join(author, manifestPath), 'utf8'), createdContent); await save(manifestPath); assert.equal(await fs.readFile(path.join(author, manifestPath), 'utf8'), candidate);
        const afterMapping = await stage('ordinary event mapping saved'); assert.deepEqual(afterMapping, { ...afterBehavior, [manifestPath]: hash(candidate) });
        row.behavior = { objectId: behavior.id, sourcePath: manifestPath, bindingId: expected.binding, instanceId: selectedInstance, scriptObjectId: script.id, sourceSha256: hash(candidate) };
        row.steps.push('Explicit Return refreshes the catalog after Save while retaining the same staged identities and second instance; no source is automatically selected. Explicit source selection, Review and Save create the first behavior, and ordinary event mapping Save persists only its reviewed manifest.');
        await openBuild(scene.id);
        const buildState = async () => { const response = await fetch(base + '/api/project-build').then(item => item.json()); return response.data || response; };
        const perform = async (selector, kind) => { const previous = (await buildState()).job?.id; await enabled(selector); await click(selector); let job; await wait(async () => { job = (await buildState()).job; return job?.kind === kind && job.id !== previous && job.status !== 'running'; }, kind, 120000); row.jobs.push(job); assert.equal(job.status, 'succeeded', JSON.stringify(job)); return job; };
        const planned = await perform('#projectBuildPlan', 'plan'); assert.equal(planned.plan.behaviorBindingCount, 1); assert.equal(planned.plan.behaviorSourceCount, 1);
        await perform('#projectBuildGenerate', 'build'); const ran = await perform('#projectBuildHeadless', 'run');
        const events = ran.events.filter(event => event.event === 'behavior'); assert.equal(events.length, 1, JSON.stringify(events));
        assert.equal(events[0].bindingId, expected.binding); assert.equal(events[0].instanceId, selectedInstance); assert.equal(events[0].name, 'context_ready'); assert.deepEqual(events[0].arguments, ['dock', 0]);
        row.behaviorEvents = events; await screenshot('success-godot-event.png'); assert.deepEqual(await authorTree(author), afterMapping);
        row.steps.push('The sole real Godot plan, build and headless run emit context_ready from the second actual scene instance with that exact stable binding and unchanged official signal arguments.');
      }
    }
    row.inspectReads = await evaluate("window.__returnRequests.filter(item=>item.url==='/api/scene-behavior-creation').length"); assert.ok(row.inspectReads > firstReads);
    row.requests = await evaluate('window.__returnRequests'); row.authorFinal = await authorTree(author); row.registeredDocuments = (await readRegistry(author)).documents.length;
    assert.equal(Object.keys(row.authorFinal).length, caseName === 'success' ? 10 : caseName === 'cancel' ? 6 : 8);
    await fs.mkdir(path.join(output, caseName, 'author-final'), { recursive: true });
    for (const name of Object.keys(row.authorFinal)) { const destination = path.join(output, caseName, 'author-final', name); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.copyFile(path.join(author, name), destination); }
    row.ok = true; console.log('Passed case: ' + caseName);
  }
  assert.deepEqual(report.errors, []); report.sourcesAfter = await sourceHashes(); assert.deepEqual(report.sourcesAfter, report.sourcesBefore, 'production sources unchanged through the real browser run');
  assert.equal(hash(await fs.readFile(fileURLToPath(import.meta.url))), report.driverSha256, 'driver unchanged during run');
  report.sourceSnapshotUnchanged = true; report.ok = true;
} catch (error) {
  report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1;
  try { await captureFailure?.(); } catch (failure) { report.captureFailure = failure.message; }
} finally {
  socket?.close();
  for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, output, cases: report.cases.map(row => ({ name: row.name, ok: row.ok, steps: row.steps })), failure: report.failure }, null, 2));
}

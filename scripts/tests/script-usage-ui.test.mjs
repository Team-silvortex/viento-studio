import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { captureScriptUsage, isScriptUsage, scriptUsageMatchSource, scriptUsageSource, createScriptUsageOpenSourceRequest, isScriptUsageOpenSourceRequest } from '../../engine/script-usage.mjs';
import { sourceLocationSelection } from '../../web/modules/app-source-location.js';
import { revealSourceOffset } from '../../web/modules/app-source-reveal.js';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const copy = value => JSON.parse(JSON.stringify(value));
const hash = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const serialize = value => '\ufeff' + JSON.stringify(value, null, 2).replaceAll('\n', '\r\n') + '\r\n';
const settle = async () => { await flushDialogs(); await flushDialogs(); };
function behavior(script = id(3)) {
  return { format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(2), bindings: [1, 2].map(n => ({ bindingId: id(10+n), instanceId: id(20+n),
    implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: script },
    parameters: { label: '🙂<script>中文', amount: 0, enabled: false, empty: '' }, events: [] })) };
}
const documents = () => [
  ['bound.json', serialize(behavior())], ['unbound.json', serialize(behavior(id(4)))], ['notes.txt', 'not behavior <script>alert(1)</script>'],
  ['invalid.json', '{"format":"viento-scene-behaviors","schemaVersion":1}'], ['broken.json', '{"invalid":'], ['missing.json', null],
];
async function fixture(t, options = {}) {
  const state = { editable: true, creating: false, available: true, busy: false, sourceTXT: true, sourcePath: 'documents/scripts/plain.txt', sourceToken: 'editor:1', dirty: false, ...options.state };
  let content = options.content || 'extends Node\n', baseline = options.baseline || content, language = 'zh', changeLanguage = () => {}, loads = 0;
  const reads = [], navigationCalls = [], focused = [];
  const snapshot = () => ({ sourcePath: state.sourcePath, token: state.sourceToken, content, sourceRevision: hash(content), baseSourceRevision: hash(baseline) });
  const directory = () => ({ format: 'viento-script-usage', schemaVersion: 1, worldId: 'world:' + 'a'.repeat(64), revision: hash('world'),
    script: { objectId: id(3), sourcePath: state.sourcePath, sourceRevision: hash(baseline) },
    references: (options.documents || documents()).map(([path, content], index) => ({ objectId: id(100+index), sourcePath: 'documents/references/' + path,
      sourceRevision: content === null ? null : hash(content), content, relationKinds: ['uses'] })) });
  const translate = (key, ...args) => ({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? ''));
  const h = await dialogHarness('app-script-usage', { isScriptUsage, scriptUsageSource, createScriptUsageOpenSourceRequest, sourceLocationSelection, revealSourceOffset,
    scriptUsageMatchSource: (catalog, source) => scriptUsageMatchSource(catalog, copy(source)),
    t: translate, translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange: listener => { changeLanguage = listener; return () => { changeLanguage = () => {}; }; },
  });
  const controller = h.runtime.setupScriptUsage({ getContext: () => state,
    getSource: () => options.source ? options.source(snapshot()) : Promise.resolve(snapshot()),
    getUsage: async source => { loads++; reads.push(copy(source)); const catalog = captureScriptUsage(copy(source), directory()); return options.usage ? options.usage(catalog, loads) : catalog; },
    openSource: async (request, ports) => { navigationCalls.push({ request, ports }); return options.navigate ? options.navigate(request, ports, { state, controller, h }) : false; },
  });
  t.after(() => controller.dispose());
  const el = suffix => h.element('scriptUsage' + suffix);
  return { ...h, controller, state, el, reads, navigationCalls, focused, snapshot,
    setContent: value => { content = value; state.dirty = content !== baseline; state.sourceToken += ':changed'; controller.refresh(); },
    open: () => controller.open(), click: async suffix => { el(suffix).click(); await settle(); },
    language: value => { language = value; changeLanguage(); }, loads: () => loads,
  };
}

test('saved TXT usage has a read-only port surface and no script marker, language or backend requirement', async t => {
  for (const content of ['extends Node\n', 'fn ready() {}\n']) {
    const h = await fixture(t, { content }); assert.deepEqual(Object.keys(h.controller).sort(), ['dispose','open','refresh']);
    assert.equal(h.el('Btn').hidden, false); assert.equal(await h.open(), true); assert.equal(h.el('Dialog').dataset.vientoCloseGuard, 'true');
    assert.equal(h.reads[0].content, content); assert.equal(h.navigationCalls.length, 0);
  }
});

test('old services and non-source contexts hide the entry, while busy contexts cannot open it', async t => {
  for (const state of [{ available: false }, { editable: false }, { creating: true }, { sourceTXT: false }, { sourcePath: '' }, { sourceToken: '' }]) {
    const h = await fixture(t, { state }); assert.equal(h.el('Btn').hidden, true); assert.equal(await h.open(), false); assert.equal(h.loads(), 0);
  }
  const h = await fixture(t, { state: { busy: true } }); assert.equal(h.el('Btn').disabled, true); assert.equal(await h.open(), false);
});

test('saved scope labels dirty scripts and keeps typed parameters and every registered-reference outcome visible', async t => {
  const h = await fixture(t, { state: { dirty: true }, content: 'unsaved code', baseline: 'saved code' }); await h.open();
  assert.equal(h.el('Dirty').hidden, false); assert.notEqual(h.reads[0].sourceRevision, h.reads[0].baseSourceRevision);
  const text = h.el('References').textContent;
  for (const expected of ['已绑定到行为', '没有匹配', '不是场景行为', '行为声明无效', 'JSON 无效', '原文暂不可用', '"amount": 0', '"enabled": false', '"empty": ""', '🙂<script>中文']) assert.ok(text.includes(expected), expected);
  assert.equal(h.el('References').querySelectorAll('script').length, 0); assert.equal(h.el('Source6').disabled, true);
  assert.match(h.el('Status').textContent, /6 份引用文档.*2 个行为绑定/);
});

test('binding snapshots preserve exact BOM/CRLF UTF-16 source identity and language refresh preserves the viewport selection', async t => {
  const h = await fixture(t); await h.open(); await h.click('Source1Binding2');
  const text = h.el('Source'), original = documents()[0][1], selected = text.value.slice(text.selectionStart, text.selectionEnd);
  assert.equal(text.value, original.replaceAll('\r\n','\n')); assert.equal(text.value[0], '\ufeff');
  assert.match(selected, new RegExp(id(12))); assert.ok(!selected.includes(id(11))); assert.match(h.el('SourcePath').textContent, /bindings\/1/);
  assert.equal(h.document.activeElement, text); text.scrollTop = 55; text.scrollLeft = 10;
  const selection = [text.selectionStart,text.selectionEnd];
  for (const language of ['en','ja','zh']) { h.language(language); assert.equal(h.el('Source'), text); assert.equal(h.document.activeElement, text);
    assert.deepEqual([text.selectionStart,text.selectionEnd],selection); assert.equal(text.scrollTop,55); assert.equal(text.scrollLeft,10); }
  await h.click('Source1'); assert.equal(text.selectionStart,0); assert.equal(text.selectionEnd,text.value.length);
});

test('non-behavior and damaged documents allow whole-source inspection without inventing binding locations', async t => {
  const h = await fixture(t); await h.open();
  for (const index of [3,4,5]) { await h.click('Source'+index); const text = h.el('Source'); assert.equal(text.selectionStart,0); assert.equal(text.selectionEnd,text.value.length); assert.equal(h.el('Snapshot').hidden,false); }
});

test('empty and failed queries explain the saved-reference boundary without opening anything', async t => {
  const h = await fixture(t,{documents:[]}); assert.equal(await h.open(),true); assert.match(h.el('Status').textContent,/不代表没有动态/); assert.equal(h.el('References').children.length,0);
  const failed = await fixture(t,{usage(){throw Error('offline');}}); assert.equal(await failed.open(),false); assert.match(failed.el('Status').textContent,/无法读取/); assert.equal(failed.el('Refresh').disabled,false); assert.equal(failed.navigationCalls.length,0);
});

test('cancellation while reading or a new refresh discards old replies and stale source buttons', async t => {
  const wait=deferred(); const h=await fixture(t,{usage:async(catalog,n)=>n===1?wait.promise:catalog});
  const opening=h.open(); await settle(); await h.click('Cancel'); await h.open(); const count=h.el('References').children.length;
  wait.resolve(captureScriptUsage(h.snapshot(),{format:'viento-script-usage',schemaVersion:1,worldId:'world:'+'a'.repeat(64),revision:hash('world'),script:{objectId:id(3),sourcePath:h.state.sourcePath,sourceRevision:h.snapshot().baseSourceRevision},references:[]}));
  assert.equal(await opening,false); assert.equal(h.el('References').children.length,count);
  const old=h.el('Source1Binding1'); await h.click('Refresh'); old.disabled=false; old.click(); assert.equal(h.el('Snapshot').hidden,true);
});

test('overlapping refreshes accept only the newest response', async t => {
  const wait=deferred(); const h=await fixture(t,{usage:async(catalog,n)=>n===2?wait.promise:catalog}); await h.open();
  h.el('Refresh').click(); await settle(); await h.click('Refresh'); await h.click('Source1Binding1'); const value=h.el('Source').value;
  wait.resolve(null); await settle(); assert.equal(h.el('Source').value,value); assert.equal(h.el('Snapshot').hidden,false); assert.match(h.el('Status').textContent,/已定位/);
});

test('source, draft and capability changes revoke reads, including capability change-and-return', async t => {
  for (const change of [h=>{h.state.sourceToken='other';},h=>{h.state.sourcePath='documents/elsewhere.txt';},h=>{h.state.available=false;},h=>{h.state.busy=true;}]) {
    const wait=deferred();let saved; const h=await fixture(t,{usage:async catalog=>{saved=catalog;return wait.promise;}}); const reading=h.open(); await settle();
    change(h); h.controller.refresh(); h.state.available=true; h.state.busy=false; h.controller.refresh(); wait.resolve(saved); assert.equal(await reading,false);
    assert.equal(h.el('References').children.length,0); assert.equal(h.el('Refresh').disabled,true); assert.match(h.el('Status').textContent,/已变化/);
  }
  const h=await fixture(t);await h.open();h.setContent('new dirty draft');assert.equal(h.el('References').children.length,0);
});

test('foreign catalogs and source accessor/extra fields are rejected without evaluating getters', async t => {
  for (const kind of ['getter','extra','catalog']) {
    let getters=0; const h=await fixture(t,{source:async source=>{if(kind==='getter')Object.defineProperty(source,'content',{enumerable:true,get(){getters++;return 'bad';}});if(kind==='extra')source.extra=true;return source;},usage:catalog=>kind==='catalog'?copy(catalog):catalog});
    assert.equal(await h.open(),false); assert.equal(getters,0); assert.equal(h.el('References').children.length,0);
  }
});

test('navigation sends the branded exact snapshot; cancelled dirty confirmation retains the dialog and selection', async t => {
  const h=await fixture(t,{state:{dirty:true},content:'unsaved',baseline:'saved'});await h.open();await h.click('Source1Binding1');
  const selected=h.el('Source').value;await h.click('OpenSource');assert.equal(h.el('Dialog').open,true);assert.equal(h.el('Source').value,selected);assert.match(h.el('Status').textContent,/未确认打开/);
  const {request,ports}=h.navigationCalls[0];assert.equal(isScriptUsageOpenSourceRequest(request),true);assert.equal(request.source.content,documents()[0][1]);assert.equal(request.source.propertyPath,'/bindings/0');assert.equal(ports.isCurrent(),false);
});

test('successful navigation owns its transition across source/busy changes and focuses only after the dialog closes', async t => {
  let focused=0;const h=await fixture(t,{navigate:async(request,ports,{state,controller,h})=>{assert.equal(ports.isCurrent(),true);state.sourceTXT=false;state.sourcePath=request.source.sourcePath;state.sourceToken='target';state.busy=true;controller.refresh();assert.equal(ports.isCurrent(),true);
    await settle();return{focus(){assert.equal(h.element('scriptUsageDialog').open,false);focused++;}};}});
  await h.open();await h.click('Source1Binding1');await h.click('OpenSource');assert.equal(h.el('Dialog').open,false);assert.equal(focused,1);
});

test('a true navigation handoff closes the modal without stealing editor focus', async t => {
  const h=await fixture(t,{navigate:async(request,ports,{state,controller,h})=>{state.sourceTXT=false;state.sourcePath=request.source.sourcePath;state.sourceToken='target';controller.refresh();h.element('docEditActions').focus();assert.equal(ports.isCurrent(),true);return true;}});
  h.el('Btn').focus();await h.open();await h.click('Source1');await h.click('OpenSource');assert.equal(h.el('Dialog').open,false);assert.equal(h.document.activeElement,h.element('docEditActions'));
});

test('Escape cancels pending source reads and keyboard shortcuts never write through the dialog', async t => {
  const wait=deferred();const h=await fixture(t,{source:()=>wait.promise}),captured=h.snapshot(),reading=h.open();
  const key=h.el('Dialog').dispatch('keydown',{key:'s',ctrlKey:true});assert.equal(key.defaultPrevented,true);assert.equal(key.stopped,true);
  h.el('Dialog').dispatch('cancel',{isComposing:true});assert.equal(h.el('Dialog').open,true);h.el('Dialog').dispatch('cancel');assert.equal(h.el('Dialog').open,false);
  wait.resolve(captured);assert.equal(await reading,false);assert.equal(h.loads(),0);
});

test('cancel, reopen and dispose revoke pending navigation without stealing focus or closing a newer session', async t => {
  for(const dispose of [false,true]){const wait=deferred();let focused=0;const h=await fixture(t,{navigate:()=>wait.promise});await h.open();await h.click('Source1Binding1');h.el('OpenSource').click();await settle();const guard=h.navigationCalls[0].ports.isCurrent;
    if(dispose)h.controller.dispose();else{await h.click('Cancel');await h.open();}assert.equal(guard(),false);wait.resolve({focus(){focused++;}});await settle();assert.equal(focused,0);if(!dispose)assert.equal(h.el('Dialog').open,true);
  }
});

test('navigation failure and stale returned receipts keep the source dialog usable', async t => {
  for(const navigate of [async()=>{throw Error('changed revision');},async()=>({opened:true})]){const h=await fixture(t,{navigate});await h.open();await h.click('Source1Binding1');await h.click('OpenSource');assert.equal(h.el('Dialog').open,true);assert.equal(h.el('OpenSource').disabled,false);assert.equal(h.el('Snapshot').hidden,false);}
});

test('every script usage message is translated and the dialog has responsive containment', async()=>{
  const source=await fs.readFile(new URL('../../web/modules/app-script-usage.js',import.meta.url),'utf8');
  const keys=new Set([...source.matchAll(/data-i18n="([^"]+)"/g)].map(m=>m[1]));for(const match of source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g))keys.add(match[1]);
  for(const key of keys){assert.ok(en[key],`English: ${key}`);assert.ok(ja[key],`Japanese: ${key}`);}
  const css=await fs.readFile(new URL('../../web/script-usage.css',import.meta.url),'utf8');assert.match(css,/@media\(max-width:600px\)/);assert.match(css,/overflow-wrap:anywhere/);
});

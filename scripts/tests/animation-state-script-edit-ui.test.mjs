import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../engine/godot-animation-state-script.mjs';
import { readAnimationStateScriptSource, generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';
import { createAnimationStateScriptProposal, isAnimationStateScriptProposal } from '../../engine/animation-state-script-edit.mjs';
import { createAnimationStateScriptSourceHost } from '../../web/modules/app-animation-state-script-source.js';
import { setupAnimationStateScript } from '../../web/modules/app-animation-state-script.js';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const copy = value => JSON.parse(JSON.stringify(value));
const digest = value => createHash('sha256').update(value).digest('hex');
const settle = async () => { await flushDialogs(); await flushDialogs(); };
async function fixture(t, settings = {}) {
  const content = generateEditableGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE).content;
  const state = { document: {}, token: 'editor:1', sourcePath: 'documents/scripts/states.txt', content, baseline: content, version: 'sha256:' + digest(content),
    editable: true, creating: false, busy: false, available: true, sourceTXT: true, ...settings.state };
  const writes = [], calls = [], confirms = [], focused = [];
  let language = 'zh', changedLanguage = () => {}, controller;
  const translate = (key, ...args) => ({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? ''));
  const h = await dialogHarness('app-animation-state-script-edit', {
    setupAnimationStateScript, readAnimationStateScriptSource, isAnimationStateScriptProposal,
    ...(settings.conditionSupport ? { supportsStudioCoreAnimationStateConditions: settings.conditionSupport } : {}),
    createAnimationStateScriptProposal: async (source, table) => settings.propose
      ? settings.propose(copy(source), copy(table)) : createAnimationStateScriptProposal(copy(source), copy(table)),
    t: translate, translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange: listener => { changedLanguage = listener; return () => { changedLanguage = () => {}; }; },
  });
  h.runtime.window.confirm = message => { confirms.push(message); return settings.confirm?.() ?? true; };
  const host = createAnimationStateScriptSourceHost({ getState: () => state, digest: async text => digest(text), writeDraft: text => {
    writes.push(text); state.content = text; state.token += ':draft'; controller.refresh();
  }, focus: () => { assert.equal(h.element('animationStateScriptEditDialog').open, false); focused.push(true); } });
  controller = h.runtime.setupAnimationStateScriptEdit({ getContext: host.getContext,
    getSource: () => settings.read ? settings.read(host.getSource) : host.getSource(),
    applyDraft: async (proposal, ports) => { calls.push({ proposal, ports }); return settings.apply ? settings.apply(proposal, ports, host) : host.applyDraft(proposal, ports); },
  });
  t.after(() => controller.dispose());
  const el = suffix => h.element('animationStateScriptEdit' + suffix);
  return { ...h, state, controller, host, writes, calls, confirms, focused, el,
    open: () => controller.open(), click: async suffix => { el(suffix).click(); await settle(); },
    set(suffix, value, event = 'input') { const element = el('Table' + suffix); element.value = value; if (event) element.dispatch(event); },
    language(value) { language = value; changedLanguage(); } };
}

test('state-table editing entry requires a marked existing TXT source and preserves unavailable-core source editing', async t => {
  for (const patch of [{ editable: false }, { creating: true }, { sourceTXT: false }, { content: 'extends Node\n' }]) {
    const h = await fixture(t, { state: patch }); assert.equal(h.el('Btn').hidden, true); assert.equal(await h.open(), false); assert.equal(h.writes.length, 0);
  }
  for (const patch of [{ available: false }, { busy: true }]) {
    const h = await fixture(t, { state: patch }); assert.equal(h.el('Btn').hidden, false); assert.equal(h.el('Btn').disabled, true); assert.equal(await h.open(), false);
  }
  const h = await fixture(t); assert.equal(h.el('Btn').parentElement.id, 'docEditActions'); assert.equal(await h.open(), true);
  assert.equal(h.el('Dialog').dataset.vientoCloseGuard, 'true'); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.el('Apply').disabled, true);
});

test('reopen reads the current unsaved generated draft, and ordinary draft apply keeps its saved baseline and file path', async t => {
  const table = copy(DEFAULT_ANIMATION_STATE_TABLE); table.states[1].key = 'attack'; table.transitions[0].to = table.transitions[1].from = 'attack';
  const dirty = '\uFEFF' + generateEditableGodotAnimationStateScript(table).content.replaceAll('\n', '\r\n');
  const h = await fixture(t, { state: { content: dirty } }); const baseline = h.state.baseline;
  await h.open(); assert.equal(h.el('TableState2Key').value, 'attack'); h.set('Transition1Event', 'hit');
  await h.click('Check'); assert.equal(h.el('Before').textContent, dirty); assert.match(h.el('After').textContent, /^\uFEFF/);
  assert.equal(h.el('Parameters').hidden, true); assert.equal(h.el('Apply').disabled, false);
  const after = h.el('After').textContent; await h.click('Apply'); assert.deepEqual(h.writes, [after]);
  assert.equal(h.el('Dialog').open, false); assert.equal(h.state.baseline, baseline); assert.equal(h.state.sourcePath, 'documents/scripts/states.txt');
  assert.equal(h.state.creating, false); assert.deepEqual(h.focused, [true]); assert.equal(h.calls[0].ports.isCurrent(), false);
});

test('renaming or deleting a state requires source review and exposes added/removed clip parameter names', async t => {
  const h = await fixture(t); await h.open(); h.set('State2Key', 'attack');
  assert.equal(h.el('Dialog').dataset.dirty, 'true'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true);
  await h.click('Check'); assert.equal(h.el('Review').hidden, false); assert.equal(h.el('Parameters').hidden, false);
  assert.equal(h.el('Added').textContent, '新增片段参数：clip_attack'); assert.equal(h.el('Removed').textContent, '移除片段参数：clip_action');
  assert.equal(h.el('Before').textContent, h.state.content); assert.notEqual(h.el('After').textContent, h.state.content);
  assert.equal(h.writes.length, 0); assert.equal(isAnimationStateScriptProposal(h.calls[0]?.proposal), false);
  const after = h.el('After').textContent;
  for (const locale of ['en', 'ja', 'zh']) { h.language(locale); assert.equal(h.el('After').textContent, after); assert.equal(h.el('Apply').disabled, false); }
  await h.click('Apply'); assert.equal(isAnimationStateScriptProposal(h.calls[0].proposal), true); assert.equal(h.writes[0], after);
});

test('no-op checks do not write; invalid inputs retain the local table and revoke previous review', async t => {
  const h = await fixture(t); await h.open(); await h.click('Check'); assert.match(h.el('Status').textContent, /没有变化/);
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true); assert.equal(h.writes.length, 0);
  h.set('Transition1Event', 'hit'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
  h.set('State2Key', ''); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true);
  await h.click('Check'); assert.match(h.el('Status').textContent, /未通过检查/); assert.equal(h.el('TableState2Key').value, '');
  assert.equal(h.el('Before').textContent, ''); assert.equal(h.el('After').textContent, ''); assert.equal(h.writes.length, 0);
});

test('modified, malformed and unsupported declarations explain refusal without entering a table or writing', async t => {
  const content = generateEditableGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE).content;
  for (const [changed, expected] of [[content + '# custom\n', /手动修改/], [content.replace('"schemaVersion":1', '"schemaVersion":9'), /版本暂不支持/], ['# Viento animation state script\n#@viento-animation-state-script {\n', /无法读取/]]) {
    const h = await fixture(t, { state: { content: changed } }); assert.equal(h.el('Btn').hidden, false); assert.equal(await h.open(), false);
    assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Fields').hidden, true); assert.match(h.el('Status').textContent, expected);
    assert.equal(h.el('Check').disabled, true); assert.equal(h.writes.length, 0); await h.click('Cancel'); assert.equal(h.el('Dialog').open, false);
  }
});

test('three-language refresh keeps incomplete edits, focus and selection while cancellation leaves source untouched', async t => {
  let allow = false; const h = await fixture(t, { confirm: () => allow }); await h.open(); const source = h.state.content;
  h.set('State2Key', 'attack_'); const input = h.el('TableState2Key'); input.focus(); input.selectionStart = 1; input.selectionEnd = 4;
  for (const locale of ['en', 'ja', 'zh']) {
    h.language(locale); assert.equal(h.el('TableState2Key'), input); assert.equal(h.document.activeElement, input);
    assert.equal(input.selectionStart, 1); assert.equal(input.selectionEnd, 4); assert.equal(input.value, 'attack_');
  }
  await h.click('Cancel'); assert.equal(h.el('Dialog').open, true); assert.equal(h.confirms.length, 1);
  h.el('Dialog').dispatch('cancel', { isComposing: true }); assert.equal(h.confirms.length, 1);
  allow = true; h.el('Dialog').dispatch('cancel'); await settle(); assert.equal(h.el('Dialog').open, false);
  assert.equal(h.state.content, source); assert.equal(h.writes.length, 0);
});

test('cancel/reopen and source changes discard late reads without touching a newer table', async t => {
  const wait = deferred(); let reads = 0;
  const h = await fixture(t, { read: async normal => ++reads === 1 ? wait.promise : normal() });
  const captured = await h.host.getSource(), opening = h.open(); h.el('Dialog').dispatch('cancel'); await settle();
  assert.equal(await h.open(), true); h.set('State2Key', 'attack'); wait.resolve(captured); assert.equal(await opening, false);
  assert.equal(h.el('Dialog').open, true); assert.equal(h.el('TableState2Key').value, 'attack'); assert.equal(h.writes.length, 0);
  const late = deferred(), other = await fixture(t, { read: () => late.promise }); const source = await other.host.getSource(), pending = other.open();
  other.state.token = 'elsewhere'; other.controller.refresh(); late.resolve(source); await pending;
  assert.equal(other.el('Fields').hidden, true); assert.match(other.el('Status').textContent, /已变化/);
});

test('late proposals cannot approve a changed table or a closed session', async t => {
  const wait = deferred(); let call = 0;
  const h = await fixture(t, { propose: async (source, table) => { const candidate = await createAnimationStateScriptProposal(source, table); if (++call === 1) await wait.promise; return candidate; } });
  await h.open(); h.set('Transition1Event', 'hit'); h.el('Check').click(); await settle();
  h.set('Transition1Event', 'late', null); wait.resolve(); await settle();
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true); assert.equal(h.el('TableTransition1Event').value, 'late');
  await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
  const old = h.el('TableState2Remove'); await h.click('Cancel'); await h.open(); old.disabled = false; old.click();
  assert.equal(h.el('TableState2Key').value, 'action'); assert.equal(h.el('Dialog').dataset.dirty, 'false');
});

test('source, capability and input changes revoke pending applications, including change-and-return', async t => {
  for (const change of [h => { h.state.available = false; h.controller.refresh(); h.state.available = true; h.controller.refresh(); },
    h => { h.state.token = 'other'; h.controller.refresh(); }, h => h.set('Transition1Event', 'late', null)]) {
    const wait = deferred(); const h = await fixture(t, { apply: async (proposal, ports, host) => { await wait.promise; return host.applyDraft(proposal, ports); } });
    await h.open(); h.set('Transition1Event', 'hit'); await h.click('Check'); h.el('Apply').click(); await settle();
    assert.equal(h.calls[0].ports.isCurrent(), true); change(h); assert.equal(h.calls[0].ports.isCurrent(), false);
    wait.resolve(); await settle(); assert.equal(h.writes.length, 0); assert.equal(h.el('Dialog').open, true);
  }
});

test('cancelling a pending application revokes its guard; disposal never steals focus', async t => {
  for (const dispose of [false, true]) {
    const wait = deferred(); const h = await fixture(t, { apply: async (proposal, ports, host) => { await wait.promise; return host.applyDraft(proposal, ports); } });
    await h.open(); h.set('Transition1Event', 'hit'); await h.click('Check'); h.el('Apply').click(); await settle();
    if (dispose) h.controller.dispose(); else await h.click('Cancel');
    assert.equal(h.calls[0].ports.isCurrent(), false); wait.resolve(); await settle(); assert.equal(h.writes.length, 0); assert.equal(h.focused.length, 0);
  }
});

test('source snapshot extra fields and accessors are refused without invoking them', async t => {
  for (const accessor of [false, true]) {
    let reads = 0; const h = await fixture(t, { read: async normal => {
      const source = { ...await normal() }; if (accessor) Object.defineProperty(source, 'content', { enumerable: true, get() { reads++; return ''; } }); else source.extra = 1;
      return source;
    } });
    assert.equal(await h.open(), false); assert.equal(reads, 0); assert.equal(h.el('Fields').hidden, true); assert.equal(h.writes.length, 0);
  }
});

test('all reopened state-table messages have English and Japanese translations', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-animation-state-script-edit.js', import.meta.url), 'utf8');
  const keys = new Set([...source.matchAll(/data-i18n="([^"]+)"/g)].map(match => match[1]));
  for (const match of source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)) keys.add(match[1]);
  for (const key of keys) { assert.ok(en[key], `English: ${key}`); assert.ok(ja[key], `Japanese: ${key}`); }
});


test('state graph inspection preserves an existing source review and applies the same reviewed draft',async t=>{
 const h=await fixture(t);await h.open();h.set('State2Key','attack');await h.click('Check');const before=h.el('Before').textContent,after=h.el('After').textContent;
 const graph=suffix=>h.element('animationStateScriptEditTableGraph'+suffix);graph('Toggle').click();graph('Transition1Select').click();graph('Transition1Locate').click();
 for(const language of['en','ja','zh'])h.language(language);assert.equal(h.el('Before').textContent,before);assert.equal(h.el('After').textContent,after);assert.equal(h.el('Apply').disabled,false);
 graph('Toggle').click();assert.equal(h.writes.length,0);await h.click('Apply');assert.equal(h.writes[0],after);
});


test('a condition invalidates reopened source approval while completed-kind round trips retain its raw input',async t=>{
 const h=await fixture(t);await h.open();h.set('State2Key','attack');await h.click('Check');assert.equal(h.el('Apply').disabled,false);
 const set=(suffix,value,event='change')=>{const node=h.el('TableTransition1Condition'+suffix);node.value=value;node.dispatch(event);};set('Mode','compare');set('Type','number');set('Number','1e-','input');assert.equal(h.el('Apply').disabled,true);await h.click('Check');assert.equal(h.el('After').textContent,'');
 h.set('Transition1Kind','completed','change');h.set('Transition1Kind','event','change');assert.equal(h.el('TableTransition1ConditionNumber').value,'1e-');set('Number','2','input');set('Operator','gte');await h.click('Check');const after=h.el('After').textContent;assert.match(after,/godot-gdscript-v2/);assert.equal(h.el('Apply').disabled,false);
 for(const locale of['en','ja','zh'])h.language(locale);assert.equal(h.el('After').textContent,after);await h.click('Apply');assert.equal(h.writes[0],after);
});

test('condition capability withdrawal and restoration revoke a pending reopened-script apply',async t=>{
 let available=true;const wait=deferred();const h=await fixture(t,{conditionSupport:()=>available,apply:async(proposal,ports,host)=>{await wait.promise;return host.applyDraft(proposal,ports);}});await h.open();const mode=h.el('TableTransition1ConditionMode');mode.value='compare';mode.dispatch('change');await h.click('Check');h.el('Apply').click();await settle();assert.equal(h.calls[0].ports.isCurrent(),true);
 available=false;h.controller.refresh();available=true;h.controller.refresh();assert.equal(h.calls[0].ports.isCurrent(),false);wait.resolve();await settle();assert.equal(h.writes.length,0);assert.equal(h.el('Dialog').open,true);
});

test('conditional source budget errors leave reopened fields and saved source untouched',async t=>{
 const h=await fixture(t,{propose(){throw Object.assign(Error('limit'),{code:'animation_state_script_source_limit'});}});await h.open();h.set('State2Key','attack');await h.click('Check');assert.match(h.el('Status').textContent,/64 KiB/);assert.equal(h.el('TableState2Key').value,'attack');assert.equal(h.el('Apply').disabled,true);assert.equal(h.writes.length,0);
});

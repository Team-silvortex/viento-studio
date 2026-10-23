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
    ...(settings.combinationSupport ? { supportsStudioCoreAnimationStateCombinations: settings.combinationSupport } : {}),
    ...(settings.selectorSupport ? { supportsStudioCoreAnimationStateSelectors: settings.selectorSupport } : {}),
    ...(settings.branchSupport ? { supportsStudioCoreAnimationStateBranches: settings.branchSupport } : {}),
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

test('switching existing source to ordered branches requires review and moving rows revokes the reviewed draft', async t => {
  const h = await fixture(t); await h.open(); h.set('EventSelection', 'firstMatch', 'change'); await h.click('Check');
  assert.match(h.el('After').textContent, /godot-gdscript-v3/); assert.equal(h.el('Apply').disabled, false); const before = h.el('After').textContent;
  h.el('TableTransition2MoveUp').click(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true); assert.equal(h.writes.length, 0);
  await h.click('Check'); const after = h.el('After').textContent; assert.notEqual(after, before); assert.equal(h.el('Apply').disabled, false);
  h.el('TableGraphToggle').click(); h.el('TableGraphTransition1Locate').click(); assert.equal(h.document.activeElement, h.el('TableTransition2From')); assert.equal(h.el('After').textContent, after); assert.equal(h.el('Apply').disabled, false);
  await h.click('Apply'); assert.deepEqual(h.writes, [after]); assert.equal(readAnimationStateScriptSource(after).table.eventSelection, 'firstMatch');
});

test('v3 source reopens with branch mode and cancelling local order changes preserves exact original source', async t => {
  const table = { ...copy(DEFAULT_ANIMATION_STATE_TABLE), eventSelection: 'firstMatch' }, content = generateEditableGodotAnimationStateScript(table).content;
  const h = await fixture(t, { state: { content, baseline: content, version: 'sha256:' + digest(content) } }); assert.equal(await h.open(), true); assert.equal(h.el('TableEventSelection').value, 'firstMatch');
  h.el('TableTransition2MoveUp').click(); await h.click('Cancel'); assert.deepEqual(h.writes, []); assert.equal(h.state.content, content);
  await h.open(); assert.equal(h.el('TableEventSelection').value, 'firstMatch'); assert.equal(h.el('TableTransition1Event').value, 'action');
  h.set('EventSelection', 'unique', 'change'); await h.click('Check'); assert.match(h.el('After').textContent, /godot-gdscript-v1/); await h.click('Apply'); assert.equal(Object.hasOwn(readAnimationStateScriptSource(h.state.content).table, 'eventSelection'), false);
});

test('branch-only capability supports v3 reediting without the older condition marker', async t => {
  const h = await fixture(t, { conditionSupport: () => false, branchSupport: () => true }); await h.open(); h.set('EventSelection', 'firstMatch', 'change'); h.set('Transition1ConditionMode', 'compare', 'change');
  await h.click('Check'); assert.equal(h.el('Apply').disabled, false); assert.match(h.el('After').textContent, /godot-gdscript-v3/);
  h.set('EventSelection', 'unique', 'change'); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true);
});

test('branch capability loss and restoration invalidate an in-flight proposal and preserve local order', async t => {
  let available = true; const wait = deferred(); const h = await fixture(t, { branchSupport: () => available, propose: async (source, table) => { await wait.promise; return createAnimationStateScriptProposal(source, table); } });
  await h.open(); h.set('EventSelection', 'firstMatch', 'change'); h.el('Check').click(); available = false; h.controller.refresh(); assert.match(h.el('Status').textContent, /有序事件分支/);
  available = true; h.controller.refresh(); wait.resolve(); await settle(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true); assert.equal(h.el('TableEventSelection').value, 'firstMatch'); assert.equal(h.writes.length, 0);
  h.set('EventSelection', 'unique', 'change'); available = false; h.controller.refresh(); assert.equal(h.el('Check').disabled, false);
});

test('silent mode changes revoke reviewed edits and invalid selections cannot approve a legacy downgrade', async t => {
  const h = await fixture(t); await h.open(); h.set('Transition1Event', 'hit'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
  h.set('EventSelection', 'firstMatch', null); await h.click('Apply'); assert.equal(h.writes.length, 0); await h.click('Check'); assert.match(h.el('After').textContent, /godot-gdscript-v3/);
  h.set('EventSelection', '', null); await h.click('Apply'); assert.equal(h.writes.length, 0); await h.click('Check'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('After').textContent, '');
});

test('silent mode changes and branch capability loss invalidate pending reopened-script applications', async t => {
  for (const change of ['mode', 'capability']) {
    let available = true; const wait = deferred(); const h = await fixture(t, { branchSupport: () => available, apply: async (proposal, ports, host) => { await wait.promise; return host.applyDraft(proposal, ports); } });
    await h.open(); h.set('EventSelection', 'firstMatch', 'change'); await h.click('Check'); h.el('Apply').click(); await settle(); assert.equal(h.calls[0].ports.isCurrent(), true);
    if (change === 'mode') h.set('EventSelection', 'unique', null); else { available = false; h.controller.refresh(); available = true; h.controller.refresh(); }
    assert.equal(h.calls[0].ports.isCurrent(), false); wait.resolve(); await settle(); assert.equal(h.writes.length, 0); assert.equal(h.el('Dialog').open, true);
  }
});

test('shared-state reediting reviews full source before applying a draft and reopens the exact selector', async t => {
  const h = await fixture(t); await h.open(); const saved = h.state.baseline;
  h.set('Transition1ConditionMode', 'shared', 'change'); h.set('Transition1ConditionKey', 'combat.enabled'); h.set('Transition1ConditionType', 'boolean', 'change'); h.set('Transition1ConditionBoolean', 'true', 'change');
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.writes.length, 0); await h.click('Check'); const after = h.el('After').textContent;
  assert.match(after, /godot-gdscript-v4/); assert.equal(h.el('Before').textContent, saved); assert.equal(h.el('Parameters').hidden, true); h.el('TableGraphToggle').click(); assert.match(h.el('TableGraphTransitions').textContent, /combat.enabled/);
  for (const locale of ['en', 'ja', 'zh']) { h.language(locale); assert.equal(h.el('After').textContent, after); assert.equal(h.el('Apply').disabled, false); }
  await h.click('Apply'); assert.deepEqual(h.writes, [after]); assert.equal(h.state.baseline, saved);
  await h.open(); assert.equal(h.el('TableTransition1ConditionMode').value, 'shared'); assert.equal(h.el('TableTransition1ConditionKey').value, 'combat.enabled'); assert.equal(h.el('TableTransition1ConditionBoolean').value, 'true');
  h.set('Transition1ConditionMode', 'none', 'change'); await h.click('Check'); assert.match(h.el('After').textContent, /godot-gdscript-v1/); await h.click('Cancel'); assert.equal(h.state.content, after);
});

test('shared-state invalid fields preserve input and revoke an existing source review', async t => {
  const h = await fixture(t); await h.open(); h.set('Transition1ConditionMode', 'shared', 'change'); h.set('Transition1ConditionKey', 'combat.enabled'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
  h.set('Transition1ConditionKey', ' combat.enabled '); assert.equal(h.el('Apply').disabled, true); await h.click('Check'); assert.match(h.el('Status').textContent, /共享状态键/); assert.equal(h.el('After').textContent, ''); assert.equal(h.el('TableTransition1ConditionKey').value, ' combat.enabled '); assert.equal(h.writes.length, 0);
  h.set('Transition1ConditionKey', 'combat.enabled'); await h.click('Check'); h.set('Transition1ConditionKey', 'combat.ready', null); await h.click('Apply'); assert.equal(h.writes.length, 0); h.controller.refresh(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true);
});

test('selector-only capability reviews mixed ordered source without old condition or branch markers', async t => {
  const h = await fixture(t, { conditionSupport: () => false, branchSupport: () => false, selectorSupport: () => true }); await h.open();
  h.set('Transition1ConditionMode', 'shared', 'change'); h.set('Transition1ConditionKey', 'combat.enabled'); h.set('EventSelection', 'firstMatch', 'change'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false); assert.match(h.el('After').textContent, /godot-gdscript-v4/);
  h.set('Transition1ConditionMode', 'compare', 'change'); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true);
});

test('selector capability withdrawal revokes pending checks and draft applications after restoration', async t => {
  for (const phase of ['check', 'apply']) {
    let available = true; const wait = deferred(); const h = await fixture(t, { selectorSupport: () => available,
      ...(phase === 'check' ? { propose: async (source, table) => { await wait.promise; return createAnimationStateScriptProposal(source, table); } }
        : { apply: async (proposal, ports, host) => { await wait.promise; return host.applyDraft(proposal, ports); } }) });
    await h.open(); h.set('Transition1ConditionMode', 'shared', 'change'); h.set('Transition1ConditionKey', 'combat.enabled');
    if (phase === 'apply') { await h.click('Check'); h.el('Apply').click(); await settle(); assert.equal(h.calls[0].ports.isCurrent(), true); } else h.el('Check').click();
    available = false; h.controller.refresh(); assert.match(h.el('Status').textContent, /项目共享状态条件/); available = true; h.controller.refresh();
    if (phase === 'apply') assert.equal(h.calls[0].ports.isCurrent(), false); wait.resolve(); await settle(); assert.equal(h.writes.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true); assert.equal(h.el('TableTransition1ConditionKey').value, 'combat.enabled');
    h.set('Transition1ConditionMode', 'compare', 'change'); available = false; h.controller.refresh(); assert.equal(h.el('Check').disabled, false);
  }
});

test('reediting upgrades shared scalar source to an explicitly reviewed group and reopens it without losing leaves', async t => {
  const table = copy(DEFAULT_ANIMATION_STATE_TABLE); table.transitions[0].trigger.condition = { type: 'boolean', operator: 'eq', value: true, selector: { kind: 'projectState', key: 'combat.enabled' } };
  const content = generateEditableGodotAnimationStateScript(table).content, h = await fixture(t, { state: { content, baseline: content, version: 'sha256:' + digest(content) } }); await h.open();
  h.set('Transition1ConditionCombination', 'all', 'change'); h.el('TableTransition1ConditionAddItem').click(); h.set('Transition1ConditionItem2Type', 'number', 'change'); h.set('Transition1ConditionItem2Number', '5'); await h.click('Check');
  assert.equal(h.el('Before').textContent, content); assert.match(h.el('After').textContent, /godot-gdscript-v5/); assert.equal(h.el('Parameters').hidden, true); assert.equal(h.writes.length, 0);
  const beforeMove = h.el('After').textContent; h.el('TableTransition1ConditionItem2MoveUp').click(); assert.equal(h.el('Review').hidden, true); assert.equal(h.el('Apply').disabled, true); await h.click('Check'); const after = h.el('After').textContent; assert.notEqual(after, beforeMove);
  for (const locale of ['en', 'ja', 'zh']) { h.language(locale); assert.equal(h.el('After').textContent, after); assert.equal(h.el('Apply').disabled, false); }
  await h.click('Apply'); assert.deepEqual(h.writes, [after]); assert.equal(h.state.baseline, content);
  await h.open(); assert.equal(h.el('TableTransition1ConditionCombination').value, 'all'); assert.equal(h.el('TableTransition1ConditionItem1Number').value, '5'); assert.equal(h.el('TableTransition1ConditionItem2Key').value, 'combat.enabled');
  h.set('Transition1ConditionCombination', 'single', 'change'); assert.equal(h.el('TableTransition1ConditionMode').value, 'none'); assert.equal(h.el('TableTransition1ConditionSingleNote').hidden, false); await h.click('Check'); assert.match(h.el('After').textContent, /godot-gdscript-v1/);
  await h.click('Cancel'); assert.equal(h.state.content, after);
});

test('empty group edits cannot approve and deleting a reviewed last item retains the empty invalid draft', async t => {
  const h = await fixture(t); await h.open(); h.set('Transition1ConditionCombination', 'any', 'change'); await h.click('Check'); assert.equal(h.el('Apply').disabled, true); assert.match(h.el('Status').textContent, /1–8/); assert.equal(h.writes.length, 0);
  h.el('TableTransition1ConditionAddItem').click(); await h.click('Check'); assert.match(h.el('After').textContent, /godot-gdscript-v5/); h.el('TableTransition1ConditionItem1Remove').click(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true); await h.click('Check');
  assert.equal(h.el('TableTransition1ConditionCombination').value, 'any'); assert.equal(h.el('TableTransition1ConditionItems').children.length, 0); assert.equal(h.writes.length, 0);
});

test('combination-only capability supports source review without legacy payload, selector or branch markers', async t => {
  const h = await fixture(t, { conditionSupport: () => false, selectorSupport: () => false, branchSupport: () => false, combinationSupport: () => true }); await h.open();
  h.set('Transition1ConditionCombination', 'all', 'change'); h.el('TableTransition1ConditionAddItem').click(); h.set('Transition1ConditionItem1Mode', 'shared', 'change'); h.set('Transition1ConditionItem1Key', 'combat.enabled'); h.set('EventSelection', 'firstMatch', 'change');
  await h.click('Check'); assert.equal(h.el('Apply').disabled, false); assert.match(h.el('After').textContent, /godot-gdscript-v5/); h.set('Transition1ConditionCombination', 'single', 'change'); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true);
});

test('combination marker withdrawal revokes pending checks and applications even after restoration', async t => {
  for (const phase of ['check', 'apply']) {
    let available = true; const wait = deferred(); const h = await fixture(t, { combinationSupport: () => available,
      ...(phase === 'check' ? { propose: async (source, table) => { await wait.promise; return createAnimationStateScriptProposal(source, table); } }
        : { apply: async (proposal, ports, host) => { await wait.promise; return host.applyDraft(proposal, ports); } }) });
    await h.open(); h.set('Transition1ConditionMode', 'compare', 'change'); h.set('Transition1ConditionCombination', 'all', 'change');
    if (phase === 'apply') { await h.click('Check'); h.el('Apply').click(); await settle(); assert.equal(h.calls[0].ports.isCurrent(), true); } else h.el('Check').click();
    available = false; h.controller.refresh(); assert.match(h.el('Status').textContent, /不支持组合条件/); available = true; h.controller.refresh(); if (phase === 'apply') assert.equal(h.calls[0].ports.isCurrent(), false);
    wait.resolve(); await settle(); assert.equal(h.writes.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true); assert.equal(h.el('TableTransition1ConditionCombination').value, 'all');
    h.set('Transition1ConditionCombination', 'single', 'change'); available = false; h.controller.refresh(); assert.equal(h.el('Check').disabled, false);
  }
});

test('unknown group modes invalidate reviewed source and returning explicitly requires a fresh check', async t => {
  const h = await fixture(t); await h.open(); h.set('Transition1ConditionMode', 'compare', 'change'); h.set('Transition1ConditionCombination', 'all', 'change'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
  for (const event of ['change', null]) {
    h.set('Transition1ConditionCombination', '', event); await h.click('Apply'); assert.equal(h.writes.length, 0); await h.click('Check'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('After').textContent, '');
    h.set('Transition1ConditionCombination', 'all', 'change'); assert.equal(h.el('Apply').disabled, true); await h.click('Check'); assert.match(h.el('After').textContent, /godot-gdscript-v5/); assert.equal(h.el('Apply').disabled, false);
  }
});

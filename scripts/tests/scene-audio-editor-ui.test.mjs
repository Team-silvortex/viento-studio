import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { readSceneAudioDocument, createSceneAudioTrackProposal, createSceneAudioResourceProposal, isSceneAudioProposal } from '../../engine/scene-audio-edit.mjs';
import { captureSceneAudioResources, isSceneAudioResources, sceneAudioResourcesMatchSource, sceneAudioResourceIdentityIds } from '../../engine/scene-audio-resources.mjs';
import { captureSceneAudioUsage, isSceneAudioUsage, sceneAudioUsageMatchSource, sceneAudioUsageSource } from '../../engine/scene-audio-usage.mjs';
import { sourceLocationSelection } from '../../web/modules/app-source-location.js';
import { sampleSceneAudio } from '../../engine/scene-audio-core.mjs';
import { createStudioModuleRegistry } from '../../engine/studio-modules.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const model = () => ({ format: 'viento-scene-audio', schemaVersion: 1, sceneObjectId: id(1), tracks: [{ id: id(2), resourceId: id(3), role: 'music', volume: 0.5, loop: true }],
  cues: [{ id: id(4), trackId: id(2), atSeconds: 10, action: 'stop' }, { id: id(5), trackId: id(2), atSeconds: 0, action: 'play' }] });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
// The panel only owns the player lifecycle. Real decoding and cancellation
// are covered by the audition adapter tests, without giving this fixture audio.
function auditionMock(settings, record, { load, onChange }) {
  let generation = 0, disposed = false, current = null, state = { status: 'idle', trackId: null, resourceId: null, positionSeconds: 0, durationSeconds: 0 };
  const update = value => { state = Object.freeze(value); onChange(state); };
  const idle = () => update({ status: 'idle', trackId: null, resourceId: null, positionSeconds: 0, durationSeconds: 0 });
  record.snapshot = () => state;
  record.position = seconds => { state = Object.freeze({ ...state, positionSeconds: seconds }); };
  record.pauses = 0; record.resumes = 0; record.seeks = [];
  record.ended = () => { generation++; idle(); };
  const player = {
    available: () => !disposed && typeof load === 'function' && settings.playerAvailable !== false,
    snapshot: () => state,
    async play(value) {
      record.calls.push(value); current = value; const request = ++generation;
      update({ status: 'loading', trackId: value.trackId, resourceId: value.resourceId, positionSeconds: 0, durationSeconds: 0 });
      try {
        await load(value.source, value.catalog, value.resourceId, { isCurrent: value.isCurrent });
        if (request !== generation || disposed) return false;
        if (!value.isCurrent()) { idle(); return false; }
        update({ status: 'playing', trackId: value.trackId, resourceId: value.resourceId, positionSeconds: 0, durationSeconds: settings.durationSeconds || 12.5 }); return true;
      } catch (error) {
        if (request !== generation || disposed) return false;
        if (!value.isCurrent()) { idle(); return false; }
        update({ status: 'error', trackId: value.trackId, resourceId: value.resourceId, positionSeconds: 0, durationSeconds: 0, errorCode: error.errorCode || 'scene_audio_audition_load' }); return false;
      }
    },
    pause() {
      if (settings.pauseThrows) throw Error('device failure');
      if (state.status !== 'playing') return false;
      record.pauses++; update({ ...state, status: 'paused' }); return true;
    },
    async resume() {
      if (state.status !== 'paused') return false;
      record.resumes++; const request = generation, owner = current;
      update({ ...state, status: 'resuming' });
      try {
        await settings.resume?.();
        if (request !== generation || disposed) return false;
        if (!owner.isCurrent()) { idle(); return false; }
        update({ ...state, status: 'playing', positionSeconds: state.positionSeconds === state.durationSeconds ? 0 : state.positionSeconds }); return true;
      } catch (error) {
        if (request !== generation || disposed) return false;
        if (!owner.isCurrent()) { idle(); return false; }
        update({ status: 'error', trackId: state.trackId, resourceId: state.resourceId, positionSeconds: 0, durationSeconds: 0, errorCode: 'scene_audio_audition_device' }); return false;
      }
    },
    seek(seconds) {
      if (settings.seekThrows) throw Error('device failure');
      if (!['playing', 'paused'].includes(state.status) || !Number.isFinite(seconds) || seconds < 0 || seconds > state.durationSeconds) return false;
      record.seeks.push(seconds);
      const tail = seconds === state.durationSeconds;
      update({ ...state, positionSeconds: tail && current.loop ? 0 : seconds, status: tail && !current.loop ? 'paused' : state.status }); return true;
    },
    stop() { generation++; record.stops++; if (state.status !== 'idle') idle(); },
    dispose() { if (disposed) return; disposed = true; record.disposals++; player.stop(); },
  };
  return player;
}
async function fixture(t, settings = {}) {
  const original = settings.content ?? '\ufeff' + JSON.stringify(model(), null, 2).replaceAll('\n', '\r\n') + '\r\n';
  let content = original, language = 'zh', listener = () => {}, disposed = 0, allocated = 100;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, audioSource: true, available: true,
    sourcePath: 'documents/audio/demo.json', sourceToken: 'load:1', resourcesAvailable: settings.resourcesAvailable ?? Boolean(settings.resources),
    auditionAvailable: settings.auditionAvailable ?? Boolean(settings.audition), usageAvailable: settings.usageAvailable ?? Boolean(settings.usage) };
  const usageCalls = [], sourceReveals = [];
  const calls = [], proposals = [], confirms = [], focused = [], loads = [], resourceCalls = [], proposalModes = [];
  const audition = { calls: [], loads: [], stops: 0, disposals: 0 };
  const snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, sourceRevision: hash(content), baseSourceRevision: hash(original) });
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const h = await dialogHarness('app-scene-audio', {
    crypto: settings.crypto ?? { randomUUID: () => id(++allocated) },
    readSceneAudioDocument: async content => { loads.push(content); return settings.read ? settings.read(content) : readSceneAudioDocument(content); },
    createSceneAudioTrackProposal: async (source, edit) => { const value = await createSceneAudioTrackProposal(copy(source), copy(edit)); proposalModes.push('tracks'); proposals.push(value); return settings.proposal ? settings.proposal(value) : value; },
    createSceneAudioResourceProposal: async (source, edit, catalog) => { const value = await createSceneAudioResourceProposal(copy(source), copy(edit), catalog); proposalModes.push('resources'); proposals.push(value); return settings.proposal ? settings.proposal(value) : value; },
    isSceneAudioResources, sceneAudioResourcesMatchSource: (catalog, source) => sceneAudioResourcesMatchSource(catalog, copy(source)), sceneAudioResourceIdentityIds,
    sceneAudioUsageSource, sourceLocationSelection, revealSourceOffset: (textarea, content, offset) => { sourceReveals.push({ textarea, content, offset }); return true; },
    isSceneAudioUsage, sceneAudioUsageMatchSource: (catalog, source) => sceneAudioUsageMatchSource(catalog, copy(source)),
    createSceneAudioAudition: options => auditionMock(settings, audition, options),
    isSceneAudioProposal, t: translate, translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange: value => { listener = value; return () => { disposed++; listener = () => {}; }; },
  });
  const documentListeners = new Map();
  h.document.hidden = false; h.document.visibilityState = 'visible';
  h.document.addEventListener = (type, callback) => { if (!documentListeners.has(type)) documentListeners.set(type, new Set()); documentListeners.get(type).add(callback); };
  h.document.removeEventListener = (type, callback) => documentListeners.get(type)?.delete(callback);
  h.runtime.window.confirm = message => { confirms.push(message); return settings.confirm?.() ?? true; };
  let controller;
  controller = h.runtime.setupSceneAudio({ ...(settings.audition ? { loadAudition: async (...args) => { audition.loads.push(args); return typeof settings.audition === 'function' ? settings.audition(...args) : {}; } } : {}),
    ...(settings.usage ? { getUsage: async source => { usageCalls.push(copy(source)); return typeof settings.usage === 'function' ? settings.usage(copy(source), usageCalls.length) : usageCatalog(copy(source)); } } : {}),
    ...(settings.resources ? { getResources: async source => { resourceCalls.push(copy(source)); return typeof settings.resources === 'function' ? settings.resources(copy(source), resourceCalls.length) : resourceCatalog(copy(source)); } } : {}), getContext: () => context, getSource: async () => settings.source ? settings.source(snapshot()) : snapshot(),
    applyDraft: async (proposal, ports) => {
      calls.push({ proposal, ports }); if (settings.apply) return settings.apply(proposal, ports, context);
      assert.equal(ports.isCurrent(), true); content = proposal.afterContent; context.sourceToken += ':applied'; controller.refresh();
      return { applied: true, content, sourcePath: context.sourcePath, sourceToken: context.sourceToken, focus: () => focused.push(true) };
    } });
  const el = suffix => h.element('sceneAudio' + suffix), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const set = (suffix, value, event = 'input') => { el(suffix).value = value; if (event) el(suffix).dispatch(event); };
  const click = async suffix => { el(suffix).click(); await settle(); };
  t.after(() => controller.dispose());
  return { ...h, controller, context, el, settle, set, click, original, calls, proposals, usageCalls, sourceReveals, resourceCalls, proposalModes, confirms, focused, loads, audition, documentListeners, content: () => content,
    visibility(value) { h.document.hidden = value === 'hidden'; h.document.visibilityState = value; for (const callback of documentListeners.get('visibilitychange') || []) callback(); },
    open: () => controller.open(), check: () => click('Check'), apply: () => click('Apply'), language(value) { language = value; listener(); }, disposed: () => disposed };
}
test('audio entry needs its own existing JSON context and never opens in creation or read-only mode', async t => {
  const h = await fixture(t); assert.deepEqual(Object.keys(h.controller).sort(), ['dispose', 'open', 'refresh']);
  for (const [key, value] of [['editable', false], ['creating', true], ['sourceJSON', false], ['audioSource', false], ['sourcePath', '']]) {
    const previous = h.context[key]; h.context[key] = value; h.controller.refresh(); assert.equal(h.el('Btn').hidden, true); assert.equal(await h.open(), false); h.context[key] = previous;
  }
  for (const [key, value] of [['available', false], ['busy', true]]) { const old = h.context[key]; h.context[key] = value; h.controller.refresh(); assert.equal(h.el('Btn').disabled, true); assert.equal(await h.open(), false); h.context[key] = old; }
  assert.equal(h.loads.length, 0); assert.equal(h.calls.length, 0); assert.equal(await h.open(), true);
});
test('audio editor preserves authored cue order and shows fixed scene and resource identities', async t => {
  const h = await fixture(t); await h.open(); assert.equal(h.el('Cue0Time').value, '10'); assert.equal(h.el('Cue1Time').value, '0');
  assert.match(h.el('Scene').textContent, new RegExp(id(1))); assert.match(h.el('Tracks').children[0].children[0].textContent, new RegExp(id(3)));
  assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true); assert.equal(h.content(), h.original);
});
test('zero volume false looping and cue action changes require review then update only the unsaved source', async t => {
  const h = await fixture(t); await h.open(); h.set('Track0Volume', '0'); h.set('Track0Loop', 'false', 'change'); h.set('Cue0Action', 'play', 'change'); h.set('Cue1Time', '0.25');
  await h.check(); assert.equal(h.el('Apply').disabled, false); assert.equal(h.calls.length, 0); assert.equal(h.el('Before').textContent, h.original);
  assert.equal(h.el('After').textContent, h.proposals[0].afterContent); assert.equal(h.proposals[0].edit.tracks[0].volume, 0); assert.equal(h.proposals[0].edit.tracks[0].loop, false);
  await h.apply(); assert.equal(h.calls.length, 1); assert.equal(h.content(), h.proposals[0].afterContent); assert.equal(h.el('Dialog').open, false); assert.equal(h.focused.length, 1);
});
test('unfinished numbers and domain-invalid values stay visible and never gain apply authority', async t => {
  for (const [field, value] of [['Track0Volume', '1e-'], ['Track0Volume', ''], ['Track0Volume', '-0.1'], ['Track0Volume', '2'], ['Cue0Time', '61'], ['Cue0Time', '-1']]) {
    const h = await fixture(t); await h.open(); h.set(field, value); await h.check(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el(field).value, value); assert.equal(h.calls.length, 0);
  }
});
test('language changes retain unfinished values and checked proposals across Chinese English and Japanese', async t => {
  const h = await fixture(t); await h.open(); h.set('Track0Volume', '1e-');
  for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.equal(h.el('Track0Volume').value, '1e-'); }
  h.set('Track0Volume', '0.2'); await h.check();
  for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Track0Volume').value, '0.2'); }
});
test('silent or eventful form edits revoke prior audio approval', async t => {
  for (const mode of ['event', 'silent', 'language']) {
    const h = await fixture(t); await h.open(); h.set('Track0Volume', '0.2'); await h.check(); h.set('Track0Volume', '0.3', mode === 'event' ? 'input' : false);
    if (mode === 'language') h.language('ja'); await h.apply(); assert.equal(h.calls.length, 0); assert.equal(h.el('Apply').disabled, true);
  }
});
test('cancel and Escape honor dirty confirmation and preserve ordinary source', async t => {
  let accept = false; const h = await fixture(t, { confirm: () => accept }); await h.open(); h.set('Track0Volume', '0.2');
  await h.click('Cancel'); assert.equal(h.el('Dialog').open, true); assert.equal(h.confirms.length, 1); accept = true;
  h.el('Dialog').dispatch('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} }); await h.settle();
  assert.equal(h.el('Dialog').open, false); assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
});
test('late source loads are discarded after closing or switching the document', async t => {
  for (const mode of ['close', 'source']) {
    const gate = deferred(), h = await fixture(t, { source: async value => { await gate.promise; return value; } }), pending = h.open();
    if (mode === 'close') await h.click('Close'); else { h.context.sourceToken += ':other'; h.controller.refresh(); }
    gate.resolve(); assert.equal(await pending, false); assert.equal(h.el('Fields').hidden, true); assert.equal(h.calls.length, 0);
  }
});
test('source changes while Rust checking is pending cannot approve a stale audio patch', async t => {
  const gate = deferred(), h = await fixture(t, { proposal: async value => { await gate.promise; return value; } });
  await h.open(); h.set('Track0Volume', '0.2'); h.el('Check').click(); await h.settle(); h.context.sourceToken += ':changed'; gate.resolve(); await h.settle();
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.calls.length, 0); assert.equal(h.el('Track0Volume').value, '0.2');
});
test('pending apply can be cancelled before host commit and errors keep draft input', async t => {
  const gate = deferred(); let current;
  const h = await fixture(t, { apply: async (proposal, ports) => { await gate.promise; current = ports.isCurrent(); throw Error('cancelled'); } });
  await h.open(); h.set('Track0Volume', '0.2'); await h.check(); h.el('Apply').click(); await h.settle(); await h.click('Cancel'); gate.resolve(); await h.settle();
  assert.equal(current, false); assert.equal(h.content(), h.original); assert.equal(h.el('Dialog').open, false);
});
test('malformed duplicate-key nonaudio documents and mismatched snapshots fail closed', async t => {
  for (const content of ['{}', '{', JSON.stringify(model()).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')]) {
    const h = await fixture(t, { content }); assert.equal(await h.open(), false); assert.equal(h.el('Fields').hidden, true); assert.equal(h.calls.length, 0);
  }
  const h = await fixture(t, { source: value => ({ ...value, token: 'stale' }) }); assert.equal(await h.open(), false); assert.equal(h.loads.length, 0);
});
test('missing Rust core errors remain explicit without inventing a JavaScript validation result', async t => {
  const h = await fixture(t, { read: () => { throw Object.assign(Error('Rust core unavailable'), { errorCode: 'studio_core_unavailable' }); } });
  assert.equal(await h.open(), false); assert.equal(h.el('Fields').hidden, true); assert.equal(h.el('Apply').disabled, true); assert.match(h.el('Diagnostic').textContent, /Rust core/);
});
test('disposing removes only the audio panel and ignores pending language callbacks', async t => {
  const h = await fixture(t); await h.open(); h.controller.dispose(); assert.equal(h.disposed(), 1); h.language('ja'); assert.equal(await h.open(), false);
});
test('audio module receives only its own frozen ports and disabling it leaves siblings untouched', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-studio-system.js', import.meta.url), 'utf8');
  for (const enabled of [true, false]) {
    const calls = [], refreshes = [], registry = createStudioModuleRegistry(), own = () => 'source';
    const context = vm.createContext({ createStudioModuleRegistry: () => ({ plan: (profile, options) => registry.plan(copy(profile), copy(options)) }),
      setupSettings: async () => {}, setupSceneAudio: ports => { calls.push(ports); return { refresh: () => refreshes.push(true) }; },
      setupWorldBrowser: () => ({}), setupProjectBuild: () => ({}), setupProjectSettings: () => ({}), setupExport: () => ({}), setupMediaEditor: () => ({}) });
    vm.runInContext(source.replace(/^import[^\n]*\n/gm, '').replace('export async function', 'async function'), context);
    const system = await context.setupStudioSystem({ features: { sceneAudio: enabled }, ports: { sceneAudio: { getSource: own }, sceneBehaviors: { marker: 'forbidden' } } });
    assert.equal(calls.length, enabled ? 1 : 0); if (enabled) { assert.equal(calls[0].getSource, own); assert.equal(Object.keys(calls[0]).join(','), 'getSource'); assert.ok(Object.isFrozen(calls[0])); }
    system.refreshMedia(); assert.equal(refreshes.length, enabled ? 1 : 0);
    const snapshot = copy(system.snapshot()); assert.equal(snapshot.plan.modules.find(row => row.id === 'org.viento.scene-audio').active, enabled);
    assert.equal(snapshot.plan.modules.find(row => row.id === 'org.viento.scene-behaviors').active, true);
  }
});
test('audio labels have English and Japanese translations and the panel has a narrow-screen layout', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-audio.js', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/data-i18n="([^"]+)"/g)].map(match => match[1]);
  for (const key of keys) { assert.equal(typeof en[key], 'string', `en:${key}`); assert.equal(typeof ja[key], 'string', `ja:${key}`); }
  const css = await fs.readFile(new URL('../../web/scene-audio.css', import.meta.url), 'utf8'); assert.match(css, /@media\(max-width:600px\)/); assert.match(css, /overflow:auto/);
  assert.doesNotMatch(source, /new Audio|fetch\(|getCurrentEditContent|app-scene-behaviors/);
  assert.match(source, /import \{ createSceneAudioAudition \} from '\.\/scene-audio-audition\.js'/);
});

test('tracks without scheduled cues remain editable without inventing a timeline entry', async t => {
  const document=model();document.cues=[];
  const h=await fixture(t,{content:JSON.stringify(document,null,2)+'\n'});assert.equal(await h.open(),true);
  assert.equal(h.el('Cues').children.length,0);h.set('Track0Volume','0.3');await h.check();await h.apply();
  const after=JSON.parse(h.content());assert.deepEqual(after.cues,[]);assert.equal(after.tracks[0].volume,.3);assert.equal(after.tracks[0].id,document.tracks[0].id);
});

test('an empty timeline can add review and apply a cue without playback or saving authority', async t => {
  const value = model(); value.cues = [];
  const h = await fixture(t, { content: JSON.stringify(value, null, 2) + '\n' }); await h.open();
  assert.equal(h.el('EmptyCues').hidden, false); assert.equal(h.el('AddCue').disabled, false);
  await h.click('AddCue'); assert.equal(h.el('EmptyCues').hidden, true);
  assert.equal(h.el('Cue0Time').value, '0'); assert.equal(h.el('Cue0Action').value, 'play');
  assert.equal(h.el('Cue0Track').value, id(2)); assert.equal(h.el('Cue0Track').disabled, false);
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.content(), h.original);
  h.set('Cue0Time', '2'); h.set('Cue0Action', 'stop', 'change'); await h.check();
  assert.equal(h.calls.length, 0); assert.equal(h.el('Before').textContent, h.original);
  assert.deepEqual(h.proposals[0].changedPaths, ['/cues']); assert.equal(h.el('After').textContent, h.proposals[0].afterContent);
  await h.apply(); const after = JSON.parse(h.content());
  assert.deepEqual(after.tracks, value.tracks); assert.deepEqual(after.cues, [{ id: id(101), trackId: id(2), atSeconds: 2, action: 'stop' }]);
  assert.equal(h.calls.length, 1);
});

test('deleting a cue preserves remaining identities while their tracks stay editable', async t => {
  const value = model(); value.tracks.push({ ...value.tracks[0], id: id(6), role: 'effect' });
  value.cues[1].trackId = id(6); value.cues.push({ id: id(7), trackId: id(2), atSeconds: 1, action: 'play' });
  const h = await fixture(t, { content: JSON.stringify(value) }); await h.open(); await h.click('Cue0Remove');
  assert.equal(h.el('Cue0Track').value, id(6)); assert.equal(h.el('Cue0Track').disabled, false);
  assert.equal(h.el('Cue1Track').value, id(2)); assert.equal(h.el('Cue1Time').value, '1');
  h.set('Cue0Track', id(2), 'change'); h.set('Cue0Time', '0.5'); await h.check(); await h.apply();
  assert.deepEqual(JSON.parse(h.content()).cues, [{ ...value.cues[1], trackId: id(2), atSeconds: 0.5 }, value.cues[2]]);
});

test('new cues select current tracks and retain UUID and unfinished values across language changes', async t => {
  const value = model(); value.tracks.push({ ...value.tracks[0], id: id(6), role: 'effect' });
  let allocated = 0;
  const h = await fixture(t, { content: JSON.stringify(value), crypto: { randomUUID: () => { allocated++; return id(101); } } });
  await h.open(); await h.click('AddCue'); h.set('Cue2Track', id(6), 'change'); h.set('Cue2Time', '1e-');
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); assert.equal(h.el('Cue2Track').value, id(6)); assert.equal(h.el('Cue2Time').value, '1e-');
    assert.match(h.el('Cues').children[2].children[0].textContent, new RegExp(id(101)));
  }
  assert.equal(allocated, 1); await h.check(); assert.equal(h.el('Apply').disabled, true);
  h.set('Cue2Time', '1.25'); await h.check();
  for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.equal(h.el('Apply').disabled, false); }
  await h.apply(); assert.equal(JSON.parse(h.content()).cues[2].trackId, id(6)); assert.equal(allocated, 1);
});

test('add then remove returns to a clean form and does not prompt to discard unchanged data', async t => {
  const h = await fixture(t); await h.open(); await h.click('AddCue'); assert.equal(h.el('Dialog').dataset.dirty, 'true');
  await h.click('Cue2Remove'); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.el('Check').disabled, true);
  await h.click('Cancel'); assert.equal(h.confirms.length, 0); assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
});

test('structural controls capture silent unfinished edits before rebuilding cue rows', async t => {
  const h = await fixture(t); await h.open(); h.set('Track0Volume', '1e-', false); h.set('Cue1Time', '2e-', false);
  await h.click('AddCue'); assert.equal(h.el('Track0Volume').value, '1e-'); assert.equal(h.el('Cue1Time').value, '2e-');
  await h.click('Cue0Remove'); assert.equal(h.el('Track0Volume').value, '1e-'); assert.equal(h.el('Cue0Time').value, '2e-');
  h.language('ja'); assert.equal(h.el('Cue0Time').value, '2e-'); await h.check(); assert.equal(h.calls.length, 0); assert.equal(h.el('Apply').disabled, true);
});

test('all cues may be removed and later reopened as an editable empty timeline', async t => {
  const h = await fixture(t); await h.open(); await h.click('Cue0Remove'); await h.click('Cue0Remove');
  assert.equal(h.el('Cues').children.length, 0); assert.equal(h.el('EmptyCues').hidden, false);
  await h.check(); await h.apply(); assert.deepEqual(JSON.parse(h.content().replace(/^\ufeff/, '')).cues, []);
  await h.open(); assert.equal(h.el('Cues').children.length, 0); assert.equal(h.el('Dialog').dataset.dirty, 'false');
  await h.click('AddCue'); await h.check(); await h.apply();
  assert.equal(JSON.parse(h.content().replace(/^\ufeff/, '')).cues.length, 1);
});

test('64 cues disable only addition and deletion opens one new slot without exceeding the limit', async t => {
  const value = model(); value.cues = Array.from({ length: 64 }, (_, index) => ({ id: id(1000 + index), trackId: id(2), atSeconds: index % 60, action: 'play' }));
  let allocations = 0;
  const h = await fixture(t, { content: JSON.stringify(value), crypto: { randomUUID: () => { allocations++; return id(2000); } } });
  await h.open(); assert.equal(h.el('AddCue').disabled, true); assert.equal(h.el('Cue63Remove').disabled, false);
  h.el('AddCue').dispatch('click'); assert.equal(allocations, 0); assert.equal(h.el('Cues').children.length, 64);
  await h.click('Cue63Remove'); assert.equal(h.el('AddCue').disabled, false); await h.click('AddCue');
  assert.equal(h.el('Cues').children.length, 64); assert.equal(h.el('AddCue').disabled, true); assert.equal(allocations, 1);
  await h.check(); await h.apply(); const after = JSON.parse(h.content()); assert.equal(after.cues.length, 64); assert.equal(after.cues.at(-1).id, id(2000));
});

test('cue allocation rejects all existing identities and retries collisions with current new cues', async t => {
  const generated = [id(1), id(2), id(3), id(4), id(5), id(101), id(101), id(102)]; let calls = 0;
  const h = await fixture(t, { crypto: { randomUUID: () => { calls++; return generated.shift(); } } });
  await h.open(); await h.click('AddCue'); await h.click('AddCue'); await h.check();
  assert.equal(calls, 8); assert.deepEqual(h.proposals[0].edit.cues.slice(2).map(cue => cue.id), [id(101), id(102)]);
  assert.equal(h.content(), h.original);
});

test('missing invalid throwing or repeatedly colliding UUID allocation leaves the form intact', async t => {
  for (const crypto of [{}, { randomUUID: () => 'not-a-uuid' }, { randomUUID: () => { throw Error('unavailable'); } }, { randomUUID: () => id(4) }]) {
    const h = await fixture(t, { crypto }); await h.open(); h.set('Cue1Time', '2e-', false); await h.click('Cue0Remove');
    await h.click('AddCue'); assert.equal(h.el('Cues').children.length, 1); assert.equal(h.el('Cue0Time').value, '2e-');
    assert.equal(h.el('Status').textContent, '无法生成新的提示身份，请稍后重试。');
    assert.equal(h.calls.length, 0); assert.equal(h.content(), h.original);
  }
});

test('adding or removing a cue always revokes a prior review even when returning to the reviewed form', async t => {
  const h = await fixture(t); await h.open(); h.set('Track0Volume', '0.25'); await h.check(); assert.equal(h.el('Apply').disabled, false);
  await h.click('AddCue'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true);
  await h.click('Cue2Remove'); assert.equal(h.el('Apply').disabled, true); await h.apply(); assert.equal(h.calls.length, 0);
  await h.check(); assert.equal(h.el('Apply').disabled, false); await h.click('Cue0Remove'); assert.equal(h.el('Apply').disabled, true);
});

test('pending checks and stale sources block structural changes including programmatic click events', async t => {
  const gate = deferred(), h = await fixture(t, { proposal: async value => { await gate.promise; return value; } });
  await h.open(); await h.click('AddCue'); h.el('Check').click(); await h.settle();
  assert.equal(h.el('AddCue').disabled, true); assert.equal(h.el('Cue0Remove').disabled, true);
  h.el('AddCue').dispatch('click'); h.el('Cue0Remove').dispatch('click'); assert.equal(h.el('Cues').children.length, 3);
  h.context.sourceToken += ':changed'; gate.resolve(); await h.settle(); h.controller.refresh();
  h.el('AddCue').dispatch('click'); h.el('Cue0Remove').dispatch('click'); assert.equal(h.el('Cues').children.length, 3);
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.calls.length, 0);
});

test('cancelled structural review never restores approval or writes a draft after its asynchronous result', async t => {
  const gate = deferred(), h = await fixture(t, { proposal: async value => { await gate.promise; return value; } });
  await h.open(); await h.click('Cue0Remove'); h.el('Check').click(); await h.settle(); await h.click('Cancel'); gate.resolve(); await h.settle();
  assert.equal(h.el('Dialog').open, false); assert.equal(h.el('Apply').disabled, true); assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
});

test('existing cue track changes are reviewed as a source leaf edit without changing cue identity', async t => {
  const value = model(); value.tracks.push({ ...value.tracks[0], id: id(6), role: 'effect' });
  const h = await fixture(t, { content: JSON.stringify(value, null, 2) + '\n' }); await h.open();
  assert.equal(h.el('Cue0Track').disabled, false); h.set('Cue0Track', id(6), 'change');
  assert.equal(h.el('Apply').disabled, true); await h.check();
  assert.deepEqual(h.proposals[0].changedPaths, ['/cues/0/trackId']); assert.equal(h.content(), h.original);
  await h.apply(); const after = JSON.parse(h.content());
  assert.deepEqual(after.tracks, value.tracks); assert.deepEqual(after.cues, [{ ...value.cues[0], trackId: id(6) }, value.cues[1]]);
});

test('move boundaries are disabled and programmatic boundary clicks cannot change the cue list', async t => {
  const h = await fixture(t); await h.open();
  assert.equal(h.el('Cue0Up').disabled, true); assert.equal(h.el('Cue0Down').disabled, false);
  assert.equal(h.el('Cue1Up').disabled, false); assert.equal(h.el('Cue1Down').disabled, true);
  h.el('Cue0Up').dispatch('click'); h.el('Cue1Down').dispatch('click');
  assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.el('Cue0Time').value, '10');
  await h.click('Cue0Down'); assert.equal(h.el('Cue0Time').value, '0'); assert.equal(h.el('Cue1Time').value, '10');
  assert.equal(h.el('Cue0Up').disabled, true); assert.equal(h.el('Cue1Down').disabled, true);
  await h.click('Cue1Up'); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.el('Check').disabled, true);
  await h.click('Cue0Remove'); assert.equal(h.el('Cue0Up').disabled, true); assert.equal(h.el('Cue0Down').disabled, true);
});

test('moving same-time cues changes native execution order without changing their times', async t => {
  const value = model(); value.cues[0].atSeconds = 0; value.cues[0].action = 'play'; value.cues[1].action = 'stop';
  assert.equal(sampleSceneAudio(value, 0).states[0].status, 'stopped');
  const h = await fixture(t, { content: JSON.stringify(value) }); await h.open(); await h.click('Cue1Up'); await h.check();
  assert.deepEqual(h.proposals[0].changedPaths, ['/cues']); assert.equal(h.calls.length, 0); await h.apply();
  const after = JSON.parse(h.content()), sampled = sampleSceneAudio(after, 0);
  assert.deepEqual(after.cues, [value.cues[1], value.cues[0]]);
  assert.deepEqual(sampled.commands.map(cue => cue.cueId), [id(5), id(4)]); assert.equal(sampled.states[0].status, 'playing');
});

test('new and existing cues retain identities and selected tracks through move and delete combinations', async t => {
  const value = model(); value.tracks.push({ ...value.tracks[0], id: id(6), role: 'effect' });
  value.cues[1].trackId = id(6); value.cues.push({ id: id(7), trackId: id(2), atSeconds: 1, action: 'play' });
  let allocations = 0;
  const h = await fixture(t, { content: JSON.stringify(value), crypto: { randomUUID: () => { allocations++; return id(101); } } });
  await h.open(); await h.click('AddCue'); h.set('Cue3Track', id(6), 'change'); h.set('Cue3Time', '0.25');
  await h.click('Cue3Up'); await h.click('Cue2Up'); await h.click('Cue0Remove'); await h.click('Cue0Down');
  for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.equal(h.el('Cue1Track').value, id(6)); assert.equal(h.el('Cue1Time').value, '0.25'); }
  assert.equal(allocations, 1); await h.check(); await h.apply();
  assert.deepEqual(JSON.parse(h.content()).cues, [value.cues[1], { id: id(101), trackId: id(6), atSeconds: .25, action: 'play' }, value.cues[2]]);
});

test('moves capture silent unfinished numbers and track selections before rebuilding and changing language', async t => {
  const value = model(); value.tracks.push({ ...value.tracks[0], id: id(6), role: 'effect' });
  const h = await fixture(t, { content: JSON.stringify(value) }); await h.open();
  h.set('Track0Volume', '1e-', false); h.set('Cue0Time', '2e-', false); h.set('Cue0Track', id(6), false);
  await h.click('Cue0Down');
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); assert.equal(h.el('Track0Volume').value, '1e-'); assert.equal(h.el('Cue1Time').value, '2e-'); assert.equal(h.el('Cue1Track').value, id(6));
  }
  await h.check(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.calls.length, 0);
  h.set('Track0Volume', '0.2'); h.set('Cue1Time', '2.5'); await h.check(); await h.apply();
  assert.deepEqual(JSON.parse(h.content()).cues, [value.cues[1], { ...value.cues[0], trackId: id(6), atSeconds: 2.5 }]);
});

test('restoring original track and order returns clean while restored reviewed forms require another check', async t => {
  const value = model(); value.tracks.push({ ...value.tracks[0], id: id(6), role: 'effect' });
  const h = await fixture(t, { content: JSON.stringify(value) }); await h.open();
  h.set('Cue0Track', id(6), 'change'); h.set('Cue0Track', id(2), 'change'); await h.click('Cue0Down'); await h.click('Cue1Up');
  assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.el('Check').disabled, true);
  h.set('Track0Volume', '0.2'); await h.check(); assert.equal(h.el('Apply').disabled, false);
  await h.click('Cue0Down'); await h.click('Cue1Up');
  assert.equal(h.el('Dialog').dataset.dirty, 'true'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true);
  await h.check(); h.set('Cue0Track', id(6), 'change'); h.set('Cue0Track', id(2), 'change');
  assert.equal(h.el('Apply').disabled, true); await h.apply(); assert.equal(h.calls.length, 0);
});

test('silent cue track changes revoke checked authority and unknown tracks cannot be applied', async t => {
  const value = model(); value.tracks.push({ ...value.tracks[0], id: id(6), role: 'effect' });
  const h = await fixture(t, { content: JSON.stringify(value) }); await h.open(); h.set('Track0Volume', '0.2'); await h.check();
  h.set('Cue0Track', id(6), false); await h.apply(); assert.equal(h.calls.length, 0); assert.equal(h.el('Apply').disabled, true);
  h.set('Cue0Track', id(99), 'change'); await h.check(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.calls.length, 0);
});

test('pending checks and source changes disable move and track controls without allowing programmatic rearrangement', async t => {
  const gate = deferred(), h = await fixture(t, { proposal: async value => { await gate.promise; return value; } });
  await h.open(); await h.click('Cue1Up'); h.el('Check').click(); await h.settle();
  for (const field of ['Cue0Up', 'Cue0Down', 'Cue1Up', 'Cue1Down', 'Cue0Track', 'Cue1Track']) assert.equal(h.el(field).disabled, true);
  h.el('Cue0Down').dispatch('click'); h.el('Cue1Up').dispatch('click'); assert.equal(h.el('Cue0Time').value, '0');
  h.context.sourceToken += ':changed'; gate.resolve(); await h.settle(); h.controller.refresh();
  h.el('Cue0Down').dispatch('click'); assert.equal(h.el('Cue0Time').value, '0'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.calls.length, 0);
});

test('cancel while a reordered draft is applying revokes the host ticket and never writes source', async t => {
  const gate = deferred(); let allowed = true;
  const h = await fixture(t, { apply: async (proposal, ports) => { await gate.promise; allowed = ports.isCurrent(); throw Error('cancelled'); } });
  await h.open(); await h.click('Cue1Up'); await h.check(); h.el('Apply').click(); await h.settle();
  assert.equal(h.el('Cue0Down').disabled, true); h.el('Cue0Down').dispatch('click'); assert.equal(h.el('Cue0Time').value, '0');
  await h.click('Cancel'); gate.resolve(); await h.settle();
  assert.equal(allowed, false); assert.equal(h.el('Dialog').open, false); assert.equal(h.content(), h.original);
});

test('copying a track preserves current settings and resource but creates no implicit cue', async t => {
  const h = await fixture(t); await h.open(); h.set('Track0Volume', '0.25', false); h.set('Track0Loop', 'false', false); h.set('Track0Role', 'effect', false);
  await h.click('Track0Clone'); assert.equal(h.el('Tracks').children.length, 2); assert.equal(h.el('Cues').children.length, 2);
  assert.equal(h.el('Track1Volume').value, '0.25'); assert.equal(h.el('Track1Loop').value, 'false'); assert.equal(h.el('Track1Role').value, 'effect');
  assert.match(h.el('Tracks').children[1].children[0].textContent, new RegExp(id(101))); assert.match(h.el('Tracks').children[1].children[0].textContent, new RegExp(id(3)));
  assert.equal(h.el('Apply').disabled, true); await h.check(); assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
  assert.ok(h.proposals[0].changedPaths.includes('/tracks')); assert.equal(h.el('Before').textContent, h.original);
  await h.apply(); const after = JSON.parse(h.content().replace(/^\ufeff/, ''));
  assert.deepEqual(after.tracks, [id(2), id(101)].map(trackId => ({ id: trackId, resourceId: id(3), role: 'effect', volume: .25, loop: false })));
  assert.deepEqual(after.cues, model().cues);
});

test('a copied track becomes selectable for new cues and retains its independent identity', async t => {
  const h = await fixture(t); await h.open(); await h.click('Track0Clone');
  assert.deepEqual(h.el('Cue0Track').children.map(option => option.value), [id(2), id(101)]);
  await h.click('AddCue'); h.set('Cue2Track', id(101), 'change'); h.set('Cue2Time', '0.25');
  assert.equal(h.el('Track1Remove').disabled, true); await h.check(); await h.apply();
  const after = JSON.parse(h.content().replace(/^\ufeff/, ''));
  assert.deepEqual(after.cues[2], { id: id(102), trackId: id(101), atSeconds: .25, action: 'play' });
  assert.deepEqual(after.tracks.map(track => track.resourceId), [id(3), id(3)]);
});

test('removal guards the last track and cue references then uses the surviving draft track for new cues', async t => {
  const h = await fixture(t); await h.open(); assert.equal(h.el('Track0Remove').disabled, true);
  h.el('Track0Remove').dispatch('click'); assert.equal(h.el('Tracks').children.length, 1);
  assert.equal(h.el('Track0RemovalHint').textContent, '至少保留一条音轨。');
  await h.click('Track0Clone'); assert.equal(h.el('Track0Remove').disabled, true); assert.equal(h.el('Track1Remove').disabled, false);
  assert.equal(h.el('Track0RemovalHint').textContent, '先移除引用此音轨的时间提示，或将提示换到其他音轨。');
  h.el('Track0Remove').dispatch('click'); assert.equal(h.el('Tracks').children.length, 2);
  h.set('Cue0Track', id(101), 'change'); h.set('Cue1Track', id(101), 'change'); assert.equal(h.el('Track0Remove').disabled, false);
  await h.click('Track0Remove'); assert.equal(h.el('Tracks').children.length, 1); assert.equal(h.el('Track0Remove').disabled, true);
  await h.click('AddCue'); assert.equal(h.el('Cue2Track').value, id(101));
  assert.deepEqual(h.el('Cue2Track').children.map(option => option.value), [id(101)]);
  await h.check(); await h.apply(); const after = JSON.parse(h.content().replace(/^\ufeff/, ''));
  assert.equal(after.tracks[0].id, id(101)); assert.ok(after.cues.every(cue => cue.trackId === id(101)));
});

test('deleting the first track and copying the survivor uses its resource identity rather than its old index', async t => {
  const value = model(); value.tracks.push({ ...value.tracks[0], id: id(6), resourceId: id(9), role: 'effect' });
  value.cues.forEach(cue => { cue.trackId = id(6); });
  const h = await fixture(t, { content: JSON.stringify(value) }); await h.open(); await h.click('Track0Remove'); await h.click('Track0Clone');
  for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.match(h.el('Tracks').children[1].children[0].textContent, new RegExp(id(9))); }
  await h.check(); await h.apply(); const after = JSON.parse(h.content());
  assert.deepEqual(after.tracks, [value.tracks[1], { ...value.tracks[1], id: id(101) }]); assert.deepEqual(after.cues, value.cues);
});

test('track removal rereads silent cue changes instead of trusting an enabled button', async t => {
  const h = await fixture(t); await h.open(); await h.click('Track0Clone'); assert.equal(h.el('Track1Remove').disabled, false);
  h.set('Cue0Track', id(101), false); h.el('Track1Remove').dispatch('click'); await h.settle();
  assert.equal(h.el('Tracks').children.length, 2); assert.equal(h.el('Cue0Track').value, id(101)); assert.equal(h.el('Track1Remove').disabled, true);
  assert.equal(h.calls.length, 0); assert.equal(h.content(), h.original);
});

test('copy then remove is clean but never revives a previous reviewed proposal', async t => {
  const h = await fixture(t); await h.open(); await h.click('Track0Clone'); await h.click('Track1Remove');
  assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.el('Check').disabled, true);
  h.set('Track0Volume', '0.2'); await h.check(); assert.equal(h.el('Apply').disabled, false);
  await h.click('Track0Clone'); assert.equal(h.el('Apply').disabled, true); await h.click('Track1Remove');
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true); await h.apply(); assert.equal(h.calls.length, 0);
});

test('sixteen tracks disable copying and an unused removal opens one bounded slot', async t => {
  const value = model(); value.tracks = Array.from({ length: 16 }, (_, index) => ({ ...value.tracks[0], id: id(20 + index) }));
  value.cues.forEach(cue => { cue.trackId = id(20); }); let allocations = 0;
  const h = await fixture(t, { content: JSON.stringify(value), crypto: { randomUUID: () => { allocations++; return id(101); } } });
  await h.open(); assert.equal(h.el('Track0Clone').disabled, true); assert.equal(h.el('Track15Clone').disabled, true);
  h.el('Track0Clone').dispatch('click'); assert.equal(allocations, 0); assert.equal(h.el('Tracks').children.length, 16);
  await h.click('Track15Remove'); assert.equal(h.el('Track0Clone').disabled, false); await h.click('Track0Clone');
  assert.equal(allocations, 1); assert.equal(h.el('Tracks').children.length, 16); assert.equal(h.el('Track15Clone').disabled, true);
  await h.check(); await h.apply(); const after = JSON.parse(h.content()); assert.equal(after.tracks.length, 16); assert.equal(after.tracks.at(-1).id, id(101));
  assert.deepEqual(after.cues, value.cues);
});

test('copying and removing tracks preserve unfinished values and language switches do not allocate more identities', async t => {
  let allocations = 0;
  const h = await fixture(t, { crypto: { randomUUID: () => { allocations++; return id(101); } } }); await h.open();
  h.set('Track0Volume', '1e-', false); h.set('Cue0Time', '2e-', false); await h.click('Track0Clone');
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); assert.equal(h.el('Track0Volume').value, '1e-'); assert.equal(h.el('Track1Volume').value, '1e-'); assert.equal(h.el('Cue0Time').value, '2e-');
  }
  assert.equal(allocations, 1); await h.check(); assert.equal(h.el('Apply').disabled, true);
  await h.click('Track1Remove'); assert.equal(h.el('Track0Volume').value, '1e-'); assert.equal(h.el('Cue0Time').value, '2e-');
  assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
});

test('track and cue allocations share collision guards across original and newly created identities', async t => {
  const generated = [id(1), id(2), id(3), id(4), id(5), id(101), id(101), id(102), id(102), id(101), id(103)]; let allocations = 0;
  const h = await fixture(t, { crypto: { randomUUID: () => { allocations++; return generated.shift(); } } }); await h.open();
  await h.click('Track0Clone'); await h.click('AddCue'); await h.click('Track1Clone'); await h.check();
  assert.equal(allocations, 11); assert.deepEqual(h.proposals[0].edit.tracks.map(track => track.id), [id(2), id(101), id(103)]);
  assert.equal(h.proposals[0].edit.cues.at(-1).id, id(102)); assert.equal(h.content(), h.original);
});

test('failed track identity allocation preserves the current form without inventing a fallback', async t => {
  for (const crypto of [{}, { randomUUID: () => 'invalid' }, { randomUUID: () => { throw Error('unavailable'); } }, { randomUUID: () => id(3) }]) {
    const h = await fixture(t, { crypto }); await h.open(); h.set('Track0Volume', '1e-', false); await h.click('Track0Clone');
    assert.equal(h.el('Tracks').children.length, 1); assert.equal(h.el('Track0Volume').value, '1e-'); assert.equal(h.el('Cues').children.length, 2);
    assert.equal(h.el('Status').textContent, '无法生成新的音轨身份，请稍后重试。'); assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
  }
});

test('pending and stale checks disable track controls including direct programmatic actions', async t => {
  const gate = deferred(), h = await fixture(t, { proposal: async value => { await gate.promise; return value; } });
  await h.open(); await h.click('Track0Clone'); h.el('Check').click(); await h.settle();
  assert.equal(h.el('Track0Clone').disabled, true); assert.equal(h.el('Track1Remove').disabled, true);
  h.el('Track0Clone').dispatch('click'); h.el('Track1Remove').dispatch('click'); assert.equal(h.el('Tracks').children.length, 2);
  h.context.sourceToken += ':changed'; gate.resolve(); await h.settle(); h.controller.refresh();
  h.el('Track0Clone').dispatch('click'); h.el('Track1Remove').dispatch('click'); assert.equal(h.el('Tracks').children.length, 2);
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.calls.length, 0);
});

test('cancelling a track-edit apply revokes the draft ticket and keeps the original source', async t => {
  const gate = deferred(); let allowed = true;
  const h = await fixture(t, { apply: async (proposal, ports) => { await gate.promise; allowed = ports.isCurrent(); throw Error('cancelled'); } });
  await h.open(); await h.click('Track0Clone'); await h.check(); h.el('Apply').click(); await h.settle();
  assert.equal(h.el('Track0Clone').disabled, true); assert.equal(h.el('Track1Remove').disabled, true);
  await h.click('Cancel'); gate.resolve(); await h.settle();
  assert.equal(allowed, false); assert.equal(h.el('Dialog').open, false); assert.equal(h.content(), h.original);
});

function resourceCatalog(source, { ids = [id(3), id(9)], bound = [id(3), id(9)], token = source.token, revision = hash('world-revision') } = {}) {
  const audio = JSON.parse(source.content.replace(/^\ufeff/, ''));
  const context = {
    format: 'viento-audio-creation-context', schemaVersion: 1, status: 'ready', worldId: 'world:' + 'a'.repeat(64), baseRevision: revision,
    documentRoot: 'documents', documentTypes: [{ id: 'document', label: 'Document' }],
    scene: { objectId: audio.sceneObjectId, objectRevision: hash('scene-record'), sourcePath: 'documents/scenes/demo.json', sourceRevision: hash('scene-source') },
    manifest: { objectId: id(90), objectRevision: hash('audio-record'), sourcePath: source.sourcePath, sourceRevision: source.baseSourceRevision,
      documentType: 'document', parserProfile: 'structured', content: source.content, relations: [{ kind: 'references', targetId: audio.sceneObjectId, slot: '' }],
      assetBindings: bound.map(assetId => ({ assetId, role: 'audio' })), trackCount: audio.tracks.length },
    resources: ids.map((resourceId, index) => ({ resourceId, resourceRevision: hash(resourceId), name: 'Tone ' + index, sourcePath: `tone-${index}.wav`,
      sha256: 'b'.repeat(64), size: 44, availability: 'unverified' })),
  };
  return captureSceneAudioResources({ ...source, token }, context);
}

test('resource reading is optional and explicit while legacy track and cue editing remains available', async t => {
  for (const settings of [{}, { resourcesAvailable: true }, { resources: true, resourcesAvailable: false }]) {
    const h = await fixture(t, settings); await h.open(); assert.equal(h.el('Resources').hidden, true); assert.equal(h.el('Track0Resource').disabled, true);
    h.el('LoadResources').dispatch('click'); await h.settle(); assert.equal(h.resourceCalls.length, 0);
    h.set('Track0Volume', '0.25'); await h.check(); assert.equal(h.proposalModes[0], 'tracks'); await h.apply(); assert.equal(h.calls.length, 1);
  }
  const h = await fixture(t, { resources: true }); await h.open(); assert.equal(h.el('Resources').hidden, false); assert.equal(h.resourceCalls.length, 0);
  assert.equal(h.el('Track0Resource').disabled, true); await h.click('LoadResources'); assert.equal(h.resourceCalls.length, 1);
  assert.equal(h.el('Track0Resource').disabled, false); assert.equal(h.el('Track0Resource').value, id(3)); assert.equal(h.el('Dialog').dataset.dirty, 'false');
  assert.deepEqual(h.el('Track0Resource').children.map(option => option.value), [id(3), id(9)]);
});

test('a bound WAV replacement uses the resource proposal and changes only the reviewed draft', async t => {
  const h = await fixture(t, { resources: true }); await h.open(); await h.click('LoadResources'); h.set('Track0Resource', id(9), 'change');
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.content(), h.original); await h.check();
  assert.deepEqual(h.proposalModes, ['resources']); assert.deepEqual(h.proposals[0].changedPaths, ['/tracks/0/resourceId']);
  assert.equal(h.calls.length, 0); assert.equal(h.el('Before').textContent, h.original); assert.equal(h.el('After').textContent, h.proposals[0].afterContent);
  await h.apply(); const after = JSON.parse(h.content().replace(/^\ufeff/, '')); assert.equal(after.tracks[0].resourceId, id(9));
  assert.equal(after.tracks[0].id, id(2)); assert.deepEqual(after.cues, model().cues);
});

test('ordinary editing after loading still uses the existing track proposal and unbound resources are not choices', async t => {
  const h = await fixture(t, { resources: source => resourceCatalog(source, { ids: [id(3), id(9), id(12)], bound: [id(3), id(9)] }) });
  await h.open(); await h.click('LoadResources'); assert.deepEqual(h.el('Track0Resource').children.map(option => option.value), [id(3), id(9)]);
  h.set('Track0Volume', '0.2'); await h.check(); assert.deepEqual(h.proposalModes, ['tracks']);
  h.set('Track0Resource', id(12), 'change'); await h.check(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.calls.length, 0);
});

test('resource reads preserve unfinished input and refreshed choices never silently replace a removed selection', async t => {
  const h = await fixture(t, { resources: (source, count) => resourceCatalog(source, { ids: count === 1 ? [id(3), id(9)] : [id(3)] }) });
  await h.open(); h.set('Track0Volume', '1e-', false); h.set('Cue0Time', '2e-', false); await h.click('LoadResources');
  h.set('Track0Resource', id(9), 'change'); await h.click('LoadResources');
  assert.equal(h.el('Track0Volume').value, '1e-'); assert.equal(h.el('Cue0Time').value, '2e-'); assert.equal(h.el('Track0Resource').value, id(9));
  assert.equal(h.el('Track0ResourceHint').hidden, false); assert.match(h.el('Track0Resource').children[0].textContent, /目录中不可用/);
  for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.equal(h.el('Track0Resource').value, id(9)); assert.equal(h.el('Track0Volume').value, '1e-'); }
  h.set('Track0Volume', '0.2'); h.set('Cue0Time', '2'); await h.check(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.calls.length, 0);
  h.set('Track0Resource', id(3), 'change'); await h.check(); assert.equal(h.proposalModes.at(-1), 'tracks');
});

test('failed resource refresh revokes approval without losing choices and allows retry', async t => {
  const h = await fixture(t, { resources: (source, count) => { if (count === 2) throw Error('temporary resource read failure'); return resourceCatalog(source); } });
  await h.open(); await h.click('LoadResources'); h.set('Track0Resource', id(9), 'change'); await h.check(); assert.equal(h.el('Apply').disabled, false);
  await h.click('LoadResources'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Track0Resource').value, id(9)); assert.equal(h.el('Track0Resource').disabled, true);
  assert.equal(h.el('ResourceStatus').textContent, '无法读取已绑定素材；表单和选择已保留，可重试。');
  await h.check(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.calls.length, 0);
  await h.click('LoadResources'); assert.equal(h.el('Track0Resource').value, id(9)); await h.check(); assert.equal(h.el('Apply').disabled, false);
});

test('empty resource catalogs keep the original resource selected and do not disable ordinary edits', async t => {
  const h = await fixture(t, { resources: source => resourceCatalog(source, { ids: [] }) }); await h.open(); await h.click('LoadResources');
  assert.equal(h.el('Track0Resource').value, id(3)); assert.equal(h.el('Track0ResourceHint').hidden, false);
  assert.equal(h.el('ResourceStatus').textContent, '当前没有可用的已绑定 WAV 素材。请先绑定素材，再重新读取。');
  h.set('Track0Volume', '0.2'); await h.check(); assert.equal(h.proposalModes[0], 'tracks'); await h.apply(); assert.equal(h.calls.length, 1);
});

test('a new track using another bound WAV and its new cue remain coupled through language redraws', async t => {
  const h = await fixture(t, { resources: true }); await h.open(); await h.click('LoadResources'); await h.click('Track0Clone');
  h.set('Track1Resource', id(9), 'change'); await h.click('AddCue'); h.set('Cue2Track', id(101), 'change'); h.set('Cue2Time', '0.5');
  for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.equal(h.el('Track1Resource').value, id(9)); assert.equal(h.el('Cue2Track').value, id(101)); }
  await h.check(); assert.equal(h.proposalModes[0], 'resources'); await h.apply();
  const after = JSON.parse(h.content().replace(/^\ufeff/, '')); assert.equal(after.tracks[1].resourceId, id(9)); assert.equal(after.cues[2].trackId, after.tracks[1].id);
});

test('resource catalogs reserve unbound UUIDs for both track and cue allocation even after a failed refresh', async t => {
  const generated = [id(12), id(101), id(9), id(12), id(102)];
  const h = await fixture(t, { resources: (source, count) => { if (count > 1) throw Error('offline'); return resourceCatalog(source, { ids: [id(3), id(9), id(12)] }); }, crypto: { randomUUID: () => generated.shift() } });
  await h.open(); await h.click('LoadResources'); await h.click('Track0Clone'); await h.click('LoadResources'); await h.click('AddCue');
  await h.check(); assert.equal(h.proposals[0].edit.tracks[1].id, id(101)); assert.equal(h.proposals[0].edit.cues.at(-1).id, id(102));
});

test('late resource reads after closing source changes or silent form changes cannot authorize a catalog', async t => {
  for (const scenario of ['close', 'source', 'form']) {
    const gate = deferred(), h = await fixture(t, { resources: async source => { await gate.promise; return resourceCatalog(source); } });
    await h.open(); h.el('LoadResources').click(); await h.settle(); assert.equal(h.el('Track0Clone').disabled, true);
    if (scenario === 'close') await h.click('Cancel');
    else if (scenario === 'source') { h.context.sourceToken += ':changed'; h.controller.refresh(); }
    else h.set('Track0Volume', '0.2', false);
    gate.resolve(); await h.settle(); assert.equal(h.calls.length, 0); assert.equal(h.el('Apply').disabled, true);
    if (scenario === 'close') assert.equal(h.el('Dialog').open, false);
    else { assert.equal(h.el('Track0Resource').disabled, true); if (scenario === 'form') assert.equal(h.el('Track0Volume').value, '0.2'); }
  }
});

test('forged or mismatched resource catalogs are rejected and do not replace the current selected resource', async t => {
  for (const resources of [source => copy(resourceCatalog(source)), source => resourceCatalog(source, { token: 'other-source' })]) {
    const h = await fixture(t, { resources }); await h.open(); await h.click('LoadResources');
    assert.equal(h.el('Track0Resource').value, id(3)); assert.equal(h.el('Track0Resource').disabled, true); assert.equal(h.calls.length, 0);
    assert.equal(h.el('ResourceStatus').textContent, '无法读取已绑定素材；表单和选择已保留，可重试。');
  }
});

test('silent resource selection changes revoke approval and cancelling a replacement apply revokes its ticket', async t => {
  const h = await fixture(t, { resources: true }); await h.open(); await h.click('LoadResources'); h.set('Track0Volume', '0.2'); await h.check();
  h.set('Track0Resource', id(9), false); await h.apply(); assert.equal(h.calls.length, 0); assert.equal(h.el('Apply').disabled, true);
  const gate = deferred(); let allowed = true;
  const pending = await fixture(t, { resources: true, apply: async (proposal, ports) => { await gate.promise; allowed = ports.isCurrent(); throw Error('cancelled'); } });
  await pending.open(); await pending.click('LoadResources'); pending.set('Track0Resource', id(9), 'change'); await pending.check(); pending.el('Apply').click(); await pending.settle();
  assert.equal(pending.el('LoadResources').disabled, true); assert.equal(pending.el('Track0Resource').disabled, true);
  await pending.click('Cancel'); gate.resolve(); await pending.settle(); assert.equal(allowed, false); assert.equal(pending.content(), pending.original);
});

test('withdrawn resource access invalidates review and pending host authority without requiring a redraw', async t => {
  const h = await fixture(t, { resources: true }); await h.open(); await h.click('LoadResources'); h.set('Track0Resource', id(9), 'change'); await h.check();
  h.context.resourcesAvailable = false; await h.apply(); assert.equal(h.calls.length, 0); assert.equal(h.el('Apply').disabled, true);
  const gate = deferred(); let allowed = true;
  const pending = await fixture(t, { resources: true, apply: async (proposal, ports) => { await gate.promise; allowed = ports.isCurrent(); throw Error('resource access changed'); } });
  await pending.open(); await pending.click('LoadResources'); pending.set('Track0Resource', id(9), 'change'); await pending.check(); pending.el('Apply').click(); await pending.settle();
  pending.context.resourcesAvailable = false; gate.resolve(); await pending.settle(); assert.equal(allowed, false); assert.equal(pending.content(), pending.original);
});

async function auditionFixture(t, settings = {}) {
  const h = await fixture(t, { resources: true, audition: true, ...settings });
  await h.open(); await h.click('LoadResources'); return h;
}

test('audition is optional and starts only after an explicit click with a loaded bound resource', async t => {
  for (const settings of [{}, { auditionAvailable: true }, { audition: true, auditionAvailable: false }, { audition: true, playerAvailable: false }]) {
    const h = await fixture(t, { resources: true, ...settings }); await h.open(); await h.click('LoadResources');
    assert.equal(h.el('Track0Preview').hidden, true); assert.equal(h.el('Preview').hidden, true); assert.equal(h.audition.calls.length, 0);
  }
  const h = await fixture(t, { resources: true, audition: true }); await h.open();
  assert.equal(h.el('Track0Preview').hidden, false); assert.equal(h.el('Track0Preview').disabled, true);
  assert.match(h.el('PreviewStatus').textContent, /先读取已绑定素材/); await h.click('Track0Preview'); assert.equal(h.audition.calls.length, 0);
  await h.click('LoadResources'); assert.equal(h.el('Track0Preview').disabled, false); assert.equal(h.audition.calls.length, 0);
  assert.equal(h.el('StopPreview').disabled, true); h.set('Track0Volume', '0.2'); await h.check(); assert.equal(h.audition.calls.length, 0);
  h.set('Track0Resource', id(99), false); h.controller.refresh(); assert.equal(h.el('Track0Preview').disabled, true);
});

test('audition synchronously forwards only the selected track settings and allows unrelated unfinished cues', async t => {
  const h = await auditionFixture(t); h.set('Track0Resource', id(9), 'change'); h.set('Track0Volume', '0'); h.set('Track0Loop', 'false', 'change'); h.set('Cue0Time', '1e-');
  h.el('Track0Preview').click(); assert.equal(h.audition.calls.length, 1); const request = h.audition.calls[0];
  assert.equal(request.volume, 0); assert.equal(request.loop, false); assert.equal(request.trackId, id(2)); assert.equal(request.resourceId, id(9));
  assert.equal(request.source.content, h.original); assert.equal(isSceneAudioResources(request.catalog), true); assert.equal(request.isCurrent(), true);
  assert.equal(h.el('PreviewStatus').dataset.status, 'loading'); assert.equal(h.el('PreviewStatus').dataset.trackId, id(2));
  await h.settle(); assert.equal(h.el('PreviewStatus').dataset.status, 'playing'); assert.equal(h.el('Cue0Time').value, '1e-');
  assert.equal(h.calls.length, 0); assert.equal(h.proposals.length, 0); assert.equal(h.content(), h.original);
});

test('invalid selected volume or loop fails without playing or discarding unfinished input', async t => {
  for (const [field, value] of [['Track0Volume', ''], ['Track0Volume', '1e-'], ['Track0Volume', '-0.1'], ['Track0Volume', '1.1'], ['Track0Volume', '1e999'], ['Track0Loop', 'invalid']]) {
    const h = await auditionFixture(t); h.set(field, value, field.endsWith('Loop') ? 'change' : 'input'); const dirty = h.el('Dialog').dataset.dirty;
    await h.click('Track0Preview'); assert.equal(h.audition.calls.length, 0); assert.equal(h.el(field).value, value);
    assert.equal(h.el('PreviewStatus').dataset.status, 'error'); assert.equal(h.el('PreviewStatus').dataset.errorCode, 'scene_audio_audition_invalid');
    assert.equal(h.el('Dialog').dataset.dirty, dirty); assert.equal(h.content(), h.original);
  }
});

test('loading audition leaves editing and cancellation available and stop prevents a late start', async t => {
  const gate = deferred(), h = await auditionFixture(t, { audition: () => gate.promise });
  h.el('Track0Preview').click(); const ticket = h.audition.calls[0];
  assert.equal(h.el('PreviewStatus').dataset.status, 'loading'); assert.equal(h.el('Dialog').getAttribute('aria-busy'), 'false');
  for (const field of ['Track0Volume', 'Track0Clone', 'Cue0Time', 'AddCue', 'Cancel', 'StopPreview']) assert.equal(h.el(field).disabled, false, field);
  assert.equal(h.el('Track0Preview').disabled, true); await h.click('StopPreview'); assert.equal(ticket.isCurrent(), false);
  gate.resolve(); await h.settle(); assert.equal(h.el('PreviewStatus').dataset.status, 'idle'); assert.equal(h.el('StopPreview').disabled, true);
  assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.calls.length, 0); assert.equal(h.proposals.length, 0);
});

test('audition and natural completion preserve checked changes and never mark a clean form dirty', async t => {
  const h = await auditionFixture(t); await h.click('Track0Preview'); assert.equal(h.el('Dialog').dataset.dirty, 'false'); await h.click('StopPreview');
  h.set('Track0Volume', '0.2'); await h.check(); const before = h.el('Before').textContent, after = h.el('After').textContent;
  await h.click('Track0Preview'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.proposals.length, 1);
  h.audition.ended(); assert.equal(h.el('PreviewStatus').dataset.status, 'idle'); assert.equal(h.el('Apply').disabled, false);
  await h.click('Track0Preview'); await h.click('StopPreview'); assert.equal(h.el('Apply').disabled, false);
  assert.equal(h.el('Before').textContent, before); assert.equal(h.el('After').textContent, after); assert.equal(h.calls.length, 0);
});

test('a second track replaces the first preview and retains cloned track and selected media identities', async t => {
  const first = deferred(), h = await auditionFixture(t, { audition: () => h.audition.loads.length === 1 ? first.promise : {} });
  await h.click('Track0Clone'); h.set('Track1Resource', id(9), 'change'); h.set('Track1Volume', '0.3'); h.set('Track1Loop', 'false', 'change');
  h.el('Track0Preview').click(); const earlier = h.audition.calls[0]; assert.equal(h.el('Track1Preview').disabled, false);
  await h.click('Track1Preview'); assert.equal(earlier.isCurrent(), false); assert.equal(h.audition.calls[1].trackId, id(101));
  assert.equal(h.audition.calls[1].resourceId, id(9)); assert.equal(h.audition.calls[1].volume, 0.3); assert.equal(h.audition.calls[1].loop, false);
  first.resolve(); await h.settle(); assert.equal(h.el('PreviewStatus').dataset.status, 'playing'); assert.equal(h.el('PreviewStatus').dataset.trackId, id(101));
  assert.equal(h.el('PreviewStatus').textContent, '正在试听音轨 2。'); assert.equal(h.el('Cues').children.length, 2); assert.equal(h.calls.length, 0);
});

test('observed field edits and structural edits stop audition without executing cues', async t => {
  const actions = [
    h => h.set('Track0Volume', '0.3'), h => h.set('Track0Loop', 'false', 'change'), h => h.set('Track0Role', 'effect', 'change'),
    h => h.set('Track0Resource', id(9), 'change'), h => h.set('Cue0Time', '3'), h => h.set('Cue0Action', 'play', 'change'),
    h => h.set('Cue0Track', id(101), 'change'), h => h.el('Track0Clone').click(), h => h.el('Track1Remove').click(),
    h => h.el('AddCue').click(), h => h.el('Cue0Remove').click(), h => h.el('Cue0Down').click(),
  ];
  for (const action of actions) {
    const h = await auditionFixture(t); await h.click('Track0Clone'); await h.click('Track0Preview'); const ticket = h.audition.calls[0];
    action(h); await h.settle(); assert.equal(ticket.isCurrent(), false); assert.equal(h.el('PreviewStatus').dataset.status, 'idle');
    assert.equal(h.audition.calls.length, 1); assert.equal(h.calls.length, 0); assert.equal(h.content(), h.original);
  }
});

test('catalog refresh check and apply stop audition through their separate existing workflows', async t => {
  for (const action of ['LoadResources', 'Check', 'Apply']) {
    const h = await auditionFixture(t); h.set('Track0Volume', '0.2'); await h.check(); await h.click('Track0Preview'); const ticket = h.audition.calls[0];
    await h.click(action); assert.equal(ticket.isCurrent(), false); assert.equal(h.el('PreviewStatus').dataset.status, 'idle');
    assert.equal(h.calls.length, action === 'Apply' ? 1 : 0); assert.equal(h.audition.calls.length, 1);
  }
});

test('silent field source capability and visibility changes cannot authorize a late preview', async t => {
  const changes = [
    h => h.set('Track0Volume', '0.3', false), h => h.set('Track0Loop', 'false', false), h => h.set('Track0Resource', id(9), false),
    h => h.set('Cue0Time', '1e-', false), h => { h.context.sourceToken += ':other'; }, h => { h.context.sourcePath = 'documents/audio/other.json'; },
    h => { h.context.available = false; }, h => { h.context.busy = true; }, h => { h.context.auditionAvailable = false; },
    h => { h.context.resourcesAvailable = false; }, h => { h.document.hidden = true; },
  ];
  for (const change of changes) {
    const gate = deferred(), h = await auditionFixture(t, { audition: () => gate.promise }); h.el('Track0Preview').click(); const ticket = h.audition.calls[0];
    change(h); assert.equal(ticket.isCurrent(), false); gate.resolve(); await h.settle();
    assert.equal(h.el('PreviewStatus').dataset.status, 'idle'); assert.equal(h.calls.length, 0); assert.equal(h.content(), h.original);
  }
});

test('source refresh stops a playing audition and revoked audition capability hides its controls', async t => {
  for (const key of ['sourceToken', 'auditionAvailable', 'resourcesAvailable']) {
    const h = await auditionFixture(t); await h.click('Track0Preview');
    h.context[key] = key === 'sourceToken' ? 'load:other' : false; h.controller.refresh();
    assert.equal(h.el('PreviewStatus').dataset.status, 'idle'); assert.equal(h.el('StopPreview').disabled, true);
    if (key === 'auditionAvailable') { assert.equal(h.el('Track0Preview').hidden, true); assert.equal(h.el('Preview').hidden, true); }
  }
});

test('language redraw preserves playing state settings and approval without a second audition', async t => {
  const h = await auditionFixture(t); h.set('Track0Volume', '0.2'); await h.check(); await h.click('Track0Preview'); const ticket = h.audition.calls[0];
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); assert.equal(h.el('Track0Volume').value, '0.2'); assert.equal(ticket.isCurrent(), true);
    assert.equal(h.el('PreviewStatus').dataset.status, 'playing'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.audition.calls.length, 1);
  }
  h.set('Cue0Time', '1e-'); await h.click('Track0Preview'); h.language('ja'); assert.equal(h.el('Cue0Time').value, '1e-');
  assert.equal(h.el('PreviewStatus').dataset.status, 'playing'); assert.equal(h.audition.calls.length, 2); assert.equal(h.calls.length, 0);
});

test('close including declined discard cancels a pending audition and cannot restart it', async t => {
  for (const accept of [false, true]) {
    const gate = deferred(), h = await auditionFixture(t, { audition: () => gate.promise, confirm: () => accept }); h.set('Track0Volume', '0.2');
    h.el('Track0Preview').click(); const ticket = h.audition.calls[0]; await h.click('Cancel'); assert.equal(ticket.isCurrent(), false);
    gate.resolve(); await h.settle(); assert.equal(h.el('Dialog').open, !accept); assert.equal(h.el('PreviewStatus').dataset.status, 'idle');
    assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
  }
});

test('background page lifecycle and disposal stop audition and remove their own listeners', async t => {
  const h = await auditionFixture(t); await h.click('Track0Preview'); h.visibility('hidden'); assert.equal(h.el('PreviewStatus').dataset.status, 'idle');
  h.visibility('visible'); assert.equal(h.audition.calls.length, 1); await h.click('Track0Preview'); h.runtime.window.dispatch('pagehide');
  assert.equal(h.el('PreviewStatus').dataset.status, 'idle'); assert.equal(h.audition.calls.length, 2); await h.click('Track0Preview');
  h.controller.dispose(); assert.equal(h.audition.snapshot().status, 'idle'); assert.equal(h.audition.disposals, 1);
  assert.equal(h.documentListeners.get('visibilitychange').size, 0); assert.equal(h.runtime.window.listeners.get('pagehide').length, 0);
  const stops = h.audition.stops; h.visibility('hidden'); h.runtime.window.dispatch('pagehide'); h.controller.dispose();
  assert.equal(h.audition.stops, stops); assert.equal(h.audition.disposals, 1); assert.equal(h.calls.length, 0);
});

test('audition failures are localized separate from review and retry without changing source', async t => {
  for (const errorCode of ['scene_audio_audition_device', 'scene_audio_audition_decode', 'scene_audio_audition_format', 'scene_audio_audition_decoded_limit',
    'scene_audio_audition_conflict', 'scene_audio_audition_resource_changed', 'scene_audio_audition_size', 'scene_audio_audition_network', 'unknown']) {
    const h = await auditionFixture(t, { audition: () => { if (h.audition.loads.length === 1) throw Object.assign(Error('private-path-or-stack'), { errorCode }); return {}; } });
    h.set('Track0Volume', '0.2'); await h.check(); const review = h.el('After').textContent; await h.click('Track0Preview');
    assert.equal(h.el('PreviewStatus').dataset.status, 'error'); assert.equal(h.el('PreviewStatus').dataset.errorCode, errorCode);
    const chinese = h.el('PreviewStatus').textContent; assert.doesNotMatch(chinese, /private-path-or-stack/);
    if (errorCode.endsWith('decoded_limit')) assert.match(chinese, /128 MiB/);
    for (const language of ['en', 'ja']) { h.language(language); assert.notEqual(h.el('PreviewStatus').textContent, chinese); assert.equal(h.el('Apply').disabled, false); }
    assert.equal(h.el('After').textContent, review); assert.equal(h.proposals.length, 1); assert.equal(h.calls.length, 0);
    await h.click('Track0Preview'); assert.equal(h.el('PreviewStatus').dataset.status, 'playing'); assert.equal(h.el('Apply').disabled, false);
  }
});

test('a missing bound resource disables audition while ordinary track editing remains available', async t => {
  const h = await auditionFixture(t, { resources: source => resourceCatalog(source, { ids: [id(9)] }) });
  assert.equal(h.el('Track0Resource').value, id(3)); assert.equal(h.el('Track0Preview').disabled, true); assert.equal(h.el('Track0Volume').disabled, false);
  await h.click('Track0Preview'); assert.equal(h.audition.calls.length, 0); h.set('Track0Resource', id(9), 'change');
  await h.click('Track0Preview'); assert.equal(h.audition.calls[0].resourceId, id(9)); assert.equal(h.el('PreviewStatus').dataset.status, 'playing');
});

test('audition loading cancellation and document reopen give the new panel independent ownership', async t => {
  const gate = deferred(), h = await auditionFixture(t, { audition: () => h.audition.loads.length === 1 ? gate.promise : {} });
  h.el('Track0Preview').click(); const old = h.audition.calls[0]; await h.click('Close'); await h.open(); await h.click('LoadResources'); await h.click('Track0Preview');
  assert.equal(old.isCurrent(), false); gate.resolve(); await h.settle(); assert.equal(h.el('PreviewStatus').dataset.status, 'playing');
  assert.equal(h.audition.calls[1].isCurrent(), true); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.calls.length, 0);
});


// The lightweight progress clock is separate from form/review refreshes.
function progressTick(h) {
  assert.equal(h.timers.size, 1, 'one progress timer while playing');
  const [key, callback] = h.timers.entries().next().value; h.timers.delete(key); callback();
}

test('audition transport exists only after decoding and never adds authoring authority', async t => {
  const gate = deferred(), h = await auditionFixture(t, { audition: () => gate.promise });
  assert.equal(h.el('PreviewTransport').hidden, true); h.el('Track0Preview').click();
  assert.equal(h.el('PreviewTransport').hidden, true); assert.equal(h.el('StopPreview').disabled, false); assert.equal(h.timers.size, 0);
  gate.resolve(); await h.settle(); assert.equal(h.el('PreviewTransport').hidden, false);
  assert.equal(h.el('PausePreview').hidden, false); assert.equal(h.el('ResumePreview').hidden, true);
  assert.equal(h.el('PreviewPosition').max, '12.5'); assert.equal(h.el('PreviewPosition').min, '0');
  assert.equal(h.el('PreviewTime').textContent, '0:00.00 / 0:12.50');
  assert.equal(h.el('PreviewTime').getAttribute('aria-live'), 'off');
  assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.proposals.length, 0); assert.equal(h.calls.length, 0);
  await h.click('StopPreview'); assert.equal(h.el('PreviewTransport').hidden, true); assert.equal(h.timers.size, 0);
});

test('clock paints only progress while preserving form nodes review nodes and status announcements', async t => {
  const h = await auditionFixture(t); h.set('Track0Volume', '0.25'); await h.check(); await h.click('Track0Preview');
  const field = h.el('Track0Volume'), review = h.el('ChangedPaths').children[0], before = h.el('Before').textContent, after = h.el('After').textContent;
  const status = h.el('PreviewStatus').textContent, proposal = h.proposals[0];
  h.audition.position(1.25); progressTick(h);
  assert.equal(h.el('PreviewPosition').value, '1.25'); assert.equal(h.el('PreviewTime').textContent, '0:01.25 / 0:12.50');
  assert.equal(h.el('Track0Volume'), field); assert.equal(h.el('ChangedPaths').children[0], review); assert.equal(h.el('PreviewStatus').textContent, status);
  assert.equal(h.el('Before').textContent, before); assert.equal(h.el('After').textContent, after); assert.equal(h.proposals[0], proposal);
  assert.equal(h.proposals.length, 1); assert.equal(h.el('Apply').disabled, false); assert.equal(h.audition.calls.length, 1); assert.equal(h.calls.length, 0);
});

test('pause and resume retain position and checked changes without reading media again', async t => {
  const h = await auditionFixture(t); h.set('Track0Volume', '0.25'); await h.check(); await h.click('Track0Preview');
  const review = h.el('ChangedPaths').children[0]; h.audition.position(2.5); await h.click('PausePreview');
  assert.equal(h.el('PreviewStatus').dataset.status, 'paused'); assert.equal(h.el('PreviewStatus').textContent, '已暂停试听音轨 1。');
  assert.equal(h.el('PreviewPosition').value, '2.5'); assert.equal(h.el('PausePreview').hidden, true); assert.equal(h.el('ResumePreview').hidden, false);
  assert.equal(h.el('StopPreview').disabled, false); assert.equal(h.timers.size, 0); assert.equal(h.audition.pauses, 1);
  h.el('ResumePreview').click(); assert.equal(h.audition.resumes, 1); assert.equal(h.el('PreviewStatus').dataset.status, 'resuming');
  assert.equal(h.el('PreviewPosition').disabled, true); assert.equal(h.el('ResumePreview').disabled, true); assert.equal(h.el('StopPreview').disabled, false);
  assert.equal(h.el('Track0Preview').disabled, true); await h.settle();
  assert.equal(h.el('PreviewStatus').dataset.status, 'playing'); assert.equal(h.el('PreviewPosition').value, '2.5'); assert.equal(h.timers.size, 1);
  assert.equal(h.audition.loads.length, 1); assert.equal(h.el('Apply').disabled, false); assert.equal(h.proposals.length, 1);
  assert.equal(h.el('ChangedPaths').children[0], review); assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
});

test('range input holds pointer and keyboard targets until change without seeking or dirtying the form', async t => {
  for (const input of ['pointer', 'keyboard']) {
    const h = await auditionFixture(t); await h.click('Track0Preview'); const range = h.el('PreviewPosition');
    if (input === 'pointer') range.dispatch('pointerdown'); else range.dispatch('keydown', { key: 'ArrowRight' });
    h.audition.position(1); progressTick(h); assert.equal(range.value, '0');
    h.set('PreviewPosition', '4.25'); assert.equal(h.el('PreviewTime').textContent, '0:04.25 / 0:12.50');
    h.audition.position(2); progressTick(h); assert.equal(range.value, '4.25'); assert.equal(h.audition.seeks.length, 0);
    range.dispatch('change'); assert.deepEqual(h.audition.seeks, [4.25]); assert.equal(h.audition.snapshot().status, 'playing');
    if (input === 'pointer') range.dispatch('pointerup'); else range.dispatch('keyup', { key: 'ArrowRight' });
    h.audition.position(4.5); progressTick(h); assert.equal(range.value, '4.5');
    assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.proposals.length, 0); assert.equal(h.calls.length, 0);
  }
});

test('cancelled range interactions restore current playback without applying the uncommitted target', async t => {
  for (const cancel of ['pointercancel', 'blur']) {
    const h = await auditionFixture(t); await h.click('Track0Preview'); const range = h.el('PreviewPosition');
    range.dispatch('pointerdown'); h.set('PreviewPosition', '8'); h.audition.position(3); progressTick(h); range.dispatch(cancel);
    assert.equal(range.value, '3'); assert.equal(h.el('PreviewTime').textContent, '0:03.00 / 0:12.50'); assert.equal(h.audition.seeks.length, 0);
    h.audition.position(3.25); progressTick(h); assert.equal(range.value, '3.25');
  }
});

test('paused seeking and nonloop endpoints remain paused until explicit resume', async t => {
  const h = await auditionFixture(t); h.set('Track0Loop', 'false', 'change'); await h.check(); await h.click('Track0Preview'); await h.click('PausePreview');
  h.set('PreviewPosition', '3'); h.el('PreviewPosition').dispatch('change');
  assert.equal(h.el('PreviewStatus').dataset.status, 'paused'); assert.equal(h.el('PreviewPosition').value, '3'); assert.equal(h.timers.size, 0);
  await h.click('ResumePreview'); h.set('PreviewPosition', '12.5'); h.el('PreviewPosition').dispatch('change');
  assert.equal(h.el('PreviewStatus').dataset.status, 'paused'); assert.equal(h.el('PreviewTime').textContent, '0:12.50 / 0:12.50'); assert.equal(h.timers.size, 0);
  await h.click('ResumePreview'); assert.equal(h.el('PreviewStatus').dataset.status, 'playing'); assert.equal(h.el('PreviewPosition').value, '0');
  assert.deepEqual(h.audition.seeks, [3, 12.5]); assert.equal(h.audition.loads.length, 1); assert.equal(h.el('Apply').disabled, false); assert.equal(h.calls.length, 0);
});

test('loop seek endpoint uses the player snapshot at zero and malformed targets never change the form', async t => {
  const h = await auditionFixture(t); await h.click('Track0Preview'); h.set('PreviewPosition', '12.5'); h.el('PreviewPosition').dispatch('change');
  assert.equal(h.el('PreviewStatus').dataset.status, 'playing'); assert.equal(h.el('PreviewPosition').value, '0'); assert.deepEqual(h.audition.seeks, [12.5]);
  for (const value of ['NaN', '-1', '13']) { h.set('PreviewPosition', value, false); h.el('PreviewPosition').dispatch('change'); assert.equal(h.el('PreviewPosition').value, '0'); }
  assert.deepEqual(h.audition.seeks, [12.5]); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.calls.length, 0);
});

test('three languages retain paused position and review with localized transport labels', async t => {
  const h = await auditionFixture(t); h.set('Track0Volume', '0.25'); await h.check(); await h.click('Track0Preview'); h.audition.position(2.5); await h.click('PausePreview');
  for (const [language, label] of [['en', 'Resume preview'], ['ja', '試聴を再開'], ['zh', '继续试听']]) {
    h.language(language); assert.equal(h.el('ResumePreview').textContent, label); assert.equal(h.el('PreviewStatus').dataset.status, 'paused');
    assert.equal(h.el('PreviewPosition').value, '2.5'); assert.equal(h.el('PreviewTime').textContent, '0:02.50 / 0:12.50'); assert.equal(h.timers.size, 0);
    assert.equal(h.el('Track0Volume').value, '0.25'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.audition.calls.length, 1); assert.equal(h.calls.length, 0);
  }
});

test('stop during pending resume prevents late restart and never locks ordinary editing', async t => {
  const gate = deferred(), h = await auditionFixture(t, { resume: () => gate.promise }); await h.click('Track0Preview'); await h.click('PausePreview');
  h.el('ResumePreview').click(); assert.equal(h.el('PreviewStatus').dataset.status, 'resuming'); assert.equal(h.timers.size, 0);
  for (const field of ['Track0Volume', 'Cue0Time', 'Cancel', 'StopPreview']) assert.equal(h.el(field).disabled, false);
  h.set('PreviewPosition', '4', 'change'); assert.equal(h.audition.seeks.length, 0); await h.click('StopPreview');
  assert.equal(h.el('PreviewTransport').hidden, true); gate.resolve(); await h.settle();
  assert.equal(h.el('PreviewStatus').dataset.status, 'idle'); assert.equal(h.timers.size, 0); assert.equal(h.audition.calls.length, 1); assert.equal(h.calls.length, 0);
});

test('resume device failure removes transport preserves approval and supports explicit retry', async t => {
  const h = await auditionFixture(t, { resume: () => { throw Error('private device failure'); } }); h.set('Track0Volume', '0.25'); await h.check();
  await h.click('Track0Preview'); await h.click('PausePreview'); await h.click('ResumePreview');
  assert.equal(h.el('PreviewStatus').dataset.status, 'error'); assert.equal(h.el('PreviewStatus').dataset.errorCode, 'scene_audio_audition_device');
  assert.doesNotMatch(h.el('PreviewStatus').textContent, /private device/); assert.equal(h.el('PreviewTransport').hidden, true); assert.equal(h.timers.size, 0);
  assert.equal(h.el('Apply').disabled, false); assert.equal(h.proposals.length, 1); await h.click('Track0Preview');
  assert.equal(h.el('PreviewStatus').dataset.status, 'playing'); assert.equal(h.audition.calls.length, 2); assert.equal(h.calls.length, 0);
});

test('paused and pending resume owners stop on edits source changes check refresh apply and lifecycle exit', async t => {
  for (const status of ['paused', 'resuming']) {
    for (const action of ['edit', 'silent-source', 'Check', 'LoadResources', 'Apply', 'Cancel', 'hidden', 'pagehide', 'dispose']) {
      const gate = deferred(), h = await auditionFixture(t, { resume: () => gate.promise }); h.set('Track0Volume', '0.25'); await h.check();
      await h.click('Track0Preview'); await h.click('PausePreview'); if (status === 'resuming') h.el('ResumePreview').click();
      const ticket = h.audition.calls[0];
      if (action === 'edit') h.set('Cue0Time', '3');
      else if (action === 'silent-source') { h.context.sourceToken += ':changed'; h.controller.refresh(); }
      else if (action === 'hidden') h.visibility('hidden');
      else if (action === 'pagehide') h.runtime.window.dispatch('pagehide');
      else if (action === 'dispose') h.controller.dispose();
      else await h.click(action);
      assert.equal(ticket.isCurrent(), false, `${status}:${action}`); assert.equal(h.timers.size, 0);
      gate.resolve(); await h.settle(); assert.equal(h.audition.snapshot().status, 'idle'); assert.equal(h.timers.size, 0);
      assert.equal(h.calls.length, action === 'Apply' ? 1 : 0);
    }
  }
});

test('progress clock detects silently revoked ownership and stale callbacks cannot survive disposal', async t => {
  const h = await auditionFixture(t); await h.click('Track0Preview'); const callback = h.timers.values().next().value;
  h.context.sourceToken += ':changed'; progressTick(h); assert.equal(h.audition.snapshot().status, 'idle'); assert.equal(h.timers.size, 0);
  h.controller.dispose(); callback(); assert.equal(h.timers.size, 0); assert.equal(h.audition.calls.length, 1);
});

test('transport button and seek exceptions are contained without affecting checked source drafts', async t => {
  for (const kind of ['pauseThrows', 'seekThrows']) {
    const h = await auditionFixture(t, { [kind]: true }); h.set('Track0Volume', '0.25'); await h.check(); await h.click('Track0Preview');
    if (kind === 'pauseThrows') await h.click('PausePreview'); else { h.set('PreviewPosition', '3'); h.el('PreviewPosition').dispatch('change'); }
    assert.equal(h.el('PreviewStatus').dataset.status, 'error'); assert.equal(h.el('PreviewTransport').hidden, true); assert.equal(h.timers.size, 0);
    assert.equal(h.el('Apply').disabled, false); assert.equal(h.calls.length, 0); assert.equal(h.content(), h.original);
  }
});


test('range subdivisions include an exact noncentisecond duration as a valid endpoint', async t => {
  const durationSeconds = 1.234567, h = await auditionFixture(t, { durationSeconds });
  h.set('Track0Loop', 'false', 'change'); await h.click('Track0Preview');
  assert.equal(Number(h.el('PreviewPosition').step), durationSeconds / 1000);
  assert.equal(Number(h.el('PreviewPosition').max), durationSeconds);
  h.set('PreviewPosition', String(durationSeconds)); h.el('PreviewPosition').dispatch('change');
  assert.deepEqual(h.audition.seeks, [durationSeconds]); assert.equal(h.el('PreviewStatus').dataset.status, 'paused');
  assert.equal(Number(h.el('PreviewPosition').value), durationSeconds); assert.equal(h.timers.size, 0);
});


test('keyboard pause and resume transfer focus only between their own transport buttons', async t => {
  const gate = deferred(), h = await auditionFixture(t, { resume: () => gate.promise }); await h.click('Track0Preview');
  h.el('PausePreview').focus(); await h.click('PausePreview'); assert.equal(h.document.activeElement, h.el('ResumePreview'));
  h.el('ResumePreview').click(); assert.equal(h.el('PreviewStatus').dataset.status, 'resuming');
  h.document.activeElement = h.document.body; // Browsers blur a newly disabled button.
  gate.resolve(); await h.settle(); assert.equal(h.document.activeElement, h.el('PausePreview'));
});

test('transport changes never steal focus from the position slider or another pending-resume target', async t => {
  const gate = deferred(), h = await auditionFixture(t, { resume: () => gate.promise }); await h.click('Track0Preview');
  h.el('PreviewPosition').focus(); await h.click('PausePreview'); assert.equal(h.document.activeElement, h.el('PreviewPosition'));
  h.el('ResumePreview').focus(); h.el('ResumePreview').click(); h.el('Cancel').focus();
  gate.resolve(); await h.settle(); assert.equal(h.document.activeElement, h.el('Cancel'));
  await h.click('PausePreview'); h.el('PreviewPosition').focus(); h.set('PreviewPosition', '3'); h.el('PreviewPosition').dispatch('change');
  assert.equal(h.document.activeElement, h.el('PreviewPosition')); assert.equal(h.audition.snapshot().status, 'paused');
});


function usageCatalog(source, options = {}) {
  const behavior = { format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(1), bindings: [{
    bindingId: id(201), instanceId: id(202), implementation: { backendId: 'org.example.independent', language: 'custom', sourceObjectId: id(203) },
    parameters: options.parameters || { arbitrary_audio: id(2), future_audio: id(101), track_id: 'plain text', embedded: `play(${id(2)})` }, events: [],
  }] };
  const behaviorContent = options.content ? options.content(behavior) : JSON.stringify(behavior);
  return captureSceneAudioUsage(source, {
    format: 'viento-scene-audio-usage', schemaVersion: 1, worldId: 'world:' + 'a'.repeat(64), revision: hash('world'),
    scene: { objectId: id(1), sourcePath: 'documents/scenes/main.json', sourceRevision: hash('scene') },
    audio: { objectId: id(204), sourcePath: source.sourcePath, sourceRevision: source.baseSourceRevision, content: source.content },
    behavior: options.noBehavior ? null : { objectId: id(205), sourcePath: 'documents/behaviors/main.json', sourceRevision: hash(behaviorContent), content: behaviorContent },
  });
}

test('usage helper needs its separate explicit capability and leaves ordinary audio editing available', async t => {
  for (const settings of [{}, { usage: true, usageAvailable: false }, { usage: true, usageAvailable: 1 }, { usageAvailable: true }]) {
    const h = await fixture(t, settings); await h.open(); assert.equal(h.el('Track0Usage').hidden, true);
    h.el('Track0Usage').dispatch('click'); await h.settle(); assert.equal(h.usageCalls.length, 0); assert.equal(h.el('Usage').hidden, true);
    h.set('Track0Volume', '0.25'); await h.check(); assert.equal(h.el('Apply').disabled, false);
  }
});

test('usage read distinguishes live cue references and exact saved behavior text without dirtying or applying', async t => {
  const h = await fixture(t, { usage: true }); await h.open(); assert.equal(h.usageCalls.length, 0);
  await h.click('Track0Usage'); assert.equal(h.usageCalls.length, 1); assert.equal(h.el('Usage').hidden, false);
  assert.equal(h.el('Usage').dataset.trackId, id(2)); assert.match(h.el('UsageTrack').textContent, new RegExp(id(2)));
  assert.equal(h.el('UsageCueList').children.length, 2); assert.match(h.el('UsageCueList').children[0].textContent, new RegExp(id(4)));
  assert.equal(h.el('UsageStatus').dataset.status, 'ready'); assert.equal(h.el('UsageBehaviorList').children.length, 1);
  assert.match(h.el('UsageBehaviorList').textContent, /arbitrary_audio/); assert.match(h.el('UsageBehaviorList').textContent, /\/bindings\/0\/parameters\/arbitrary_audio/);
  assert.match(h.el('UsageBehaviorPath').textContent, /documents\/behaviors\/main.json/);
  assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.calls.length, 0);
  assert.equal(h.audition.calls.length, 0); assert.equal(h.content(), h.original);
});

test('usage read and explicit refresh preserve reviewed changes and an active audition', async t => {
  const h = await auditionFixture(t, { usage: true }); h.set('Track0Volume', '0.25'); await h.check(); await h.click('Track0Preview');
  const stops = h.audition.stops, input = h.el('Track0Volume'), review = h.el('After').textContent;
  input.focus(); await h.click('Track0Usage'); await h.click('UsageRefresh');
  assert.equal(h.usageCalls.length, 2); assert.equal(h.el('Track0Volume'), input); assert.equal(h.document.activeElement, input);
  assert.equal(h.el('After').textContent, review); assert.equal(h.el('Apply').disabled, false); assert.equal(h.proposals.length, 1);
  assert.equal(h.audition.stops, stops); assert.equal(h.el('PreviewStatus').dataset.status, 'playing'); assert.equal(h.calls.length, 0);
});

test('usage query keeps numeric inputs editable and current cues update while its read is pending', async t => {
  const gate = deferred(); let source;
  const h = await fixture(t, { usage: value => { source = value; return gate.promise; } }); await h.open();
  h.set('Track0Volume', '1e-'); h.el('Track0Usage').click();
  assert.equal(h.el('UsageStatus').dataset.status, 'loading'); assert.equal(h.el('UsageRefresh').disabled, true);
  for (const suffix of ['Track0Volume', 'Cue0Time', 'Cue0Remove', 'AddCue', 'Check']) assert.equal(h.el(suffix).disabled, false);
  await h.click('Cue0Remove'); assert.equal(h.el('UsageCueList').children.length, 1);
  assert.match(h.el('UsageCueList').children[0].textContent, new RegExp(id(5))); assert.match(h.el('UsageCueList').children[0].textContent, /第 1 条/);
  gate.resolve(usageCatalog(source)); await h.settle(); assert.equal(h.el('UsageStatus').dataset.status, 'ready');
  assert.equal(h.el('Track0Volume').value, '1e-'); assert.equal(h.el('UsageCueList').children.length, 1); assert.equal(h.el('Apply').disabled, true);
});

test('changing selected tracks during one usage read filters its result to the latest track', async t => {
  const gate = deferred(); let source; const value = model(); value.tracks.push({ ...value.tracks[0], id: id(6) });
  const h = await fixture(t, { content: JSON.stringify(value), usage: input => { source = input; return gate.promise; } }); await h.open();
  h.el('Track0Usage').click(); h.el('Track1Usage').click();
  assert.equal(h.usageCalls.length, 1); assert.equal(h.el('Usage').dataset.trackId, id(6)); assert.equal(h.el('UsageCueList').children.length, 0);
  gate.resolve(usageCatalog(source)); await h.settle(); assert.equal(h.el('UsageBehaviorList').children.length, 0);
  await h.click('Track0Usage'); assert.equal(h.usageCalls.length, 1); assert.equal(h.el('UsageBehaviorList').children.length, 1);
});

test('new unsaved track identities can be queried without parsing incomplete form numbers', async t => {
  const h = await fixture(t, { usage: true }); await h.open(); await h.click('Track0Clone'); h.set('Track1Volume', '1e-');
  await h.click('Track1Usage'); assert.equal(h.el('Usage').dataset.trackId, id(101)); assert.equal(h.el('UsageBehaviorList').children.length, 1);
  assert.match(h.el('UsageBehaviorList').textContent, /future_audio/); assert.equal(h.el('Track1Volume').value, '1e-');
  assert.equal(h.usageCalls.length, 1); assert.equal(h.usageCalls[0].content, h.original); assert.equal(h.calls.length, 0);
});

test('cue retargeting and order changes recalculate usage against the current form without another read', async t => {
  const h = await fixture(t, { usage: true }); await h.open(); await h.click('Track0Clone'); await h.click('Track0Usage');
  h.set('Cue0Track', id(101), 'change'); assert.equal(h.el('UsageCueList').children.length, 1);
  assert.match(h.el('UsageCueList').children[0].textContent, /第 2 条/);
  await h.click('Cue1Up'); assert.match(h.el('UsageCueList').children[0].textContent, /第 1 条/);
  await h.click('Track1Usage'); assert.equal(h.el('UsageCueList').children.length, 1); assert.match(h.el('UsageCueList').children[0].textContent, new RegExp(id(4)));
  assert.equal(h.usageCalls.length, 1);
});

test('usage remains advisory for deletion and removing the selected track clears the panel', async t => {
  const h = await fixture(t, { usage: true }); await h.open(); await h.click('Track0Clone'); await h.click('Track1Usage');
  assert.equal(h.el('UsageBehaviorList').children.length, 1); assert.equal(h.el('Track1Remove').disabled, false);
  await h.click('Track1Remove'); assert.equal(h.el('Usage').hidden, true); assert.equal(h.el('Usage').dataset.trackId, '');
  assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.el('Track0Remove').disabled, true); assert.equal(h.calls.length, 0);
});

test('missing behavior zero matches and read failure remain distinct and a failed refresh can retry', async t => {
  const none = await fixture(t, { usage: source => usageCatalog(source, { noBehavior: true }) }); await none.open(); await none.click('Track0Usage');
  assert.match(none.el('UsageStatus').textContent, /没有关联/); assert.equal(none.el('UsageBehaviorPath').textContent, '');
  const zero = await fixture(t, { usage: source => usageCatalog(source, { parameters: { track_id: 'ordinary' } }) }); await zero.open(); await zero.click('Track0Usage');
  assert.match(zero.el('UsageStatus').textContent, /未在已保存行为参数中找到/); assert.match(zero.el('UsageBehaviorPath').textContent, /main.json/);
  const h = await fixture(t, { usage: (source, count) => { if (count === 2) throw Error('private storage path'); return usageCatalog(source); } });
  await h.open(); h.set('Track0Volume', '0.25'); await h.check(); await h.click('Track0Usage'); await h.click('UsageRefresh');
  assert.equal(h.el('UsageStatus').dataset.status, 'failed'); assert.equal(h.el('UsageBehaviorList').children.length, 0);
  assert.doesNotMatch(h.el('UsageStatus').textContent, /private storage/); assert.equal(h.el('Apply').disabled, false);
  await h.click('UsageRefresh'); assert.equal(h.el('UsageStatus').dataset.status, 'ready'); assert.equal(h.usageCalls.length, 3);
});

test('unbranded or differently owned usage catalogs are rejected without touching the reviewed form', async t => {
  for (const kind of ['plain', 'other-source']) {
    const h = await fixture(t, { usage: source => kind === 'plain' ? copy(usageCatalog(source)) : usageCatalog({ ...source, token: 'different' }) });
    await h.open(); h.set('Track0Volume', '0.25'); await h.check(); await h.click('Track0Usage');
    assert.equal(h.el('UsageStatus').dataset.status, 'failed'); assert.equal(h.el('UsageBehaviorList').children.length, 0);
    assert.equal(h.el('Apply').disabled, false); assert.equal(h.calls.length, 0);
  }
});

test('late usage reads are discarded after source change close reopen capability withdrawal or disposal', async t => {
  for (const reason of ['source', 'close', 'reopen', 'capability', 'dispose']) {
    const gate = deferred(); let source; const h = await fixture(t, { usage: input => { source = input; return gate.promise; } });
    await h.open(); h.el('Track0Usage').click();
    if (reason === 'source') { h.context.sourceToken += ':changed'; h.controller.refresh(); }
    if (reason === 'close' || reason === 'reopen') { await h.click('Cancel'); if (reason === 'reopen') await h.open(); }
    if (reason === 'capability') { h.context.usageAvailable = false; h.controller.refresh(); h.context.usageAvailable = true; h.controller.refresh(); }
    if (reason === 'dispose') h.controller.dispose();
    gate.resolve(usageCatalog(source)); await h.settle();
    if (reason !== 'dispose') { assert.equal(h.el('Usage').hidden, true, reason); assert.equal(h.el('UsageBehaviorList').children.length, 0, reason); }
    assert.equal(h.calls.length, 0);
  }
});

test('usage capability withdrawal preserves ordinary checked apply and permits a fresh later query', async t => {
  const h = await fixture(t, { usage: true }); await h.open(); h.set('Track0Volume', '0.25'); await h.check(); await h.click('Track0Usage');
  h.context.usageAvailable = false; h.controller.refresh(); assert.equal(h.el('Usage').hidden, true); assert.equal(h.el('Apply').disabled, false);
  h.context.usageAvailable = true; h.controller.refresh(); await h.click('Track0Usage'); assert.equal(h.usageCalls.length, 2); assert.equal(h.el('Apply').disabled, false);
  await h.apply(); assert.equal(h.calls.length, 1); assert.equal(h.el('Dialog').open, false);
});

test('ordinary check and apply stay available while a usage read is pending and late usage cannot reopen', async t => {
  const gate = deferred(); let source; const h = await fixture(t, { usage: input => { source = input; return gate.promise; } });
  await h.open(); h.set('Track0Volume', '0.25'); h.el('Track0Usage').click(); await h.check();
  assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('UsageStatus').dataset.status, 'loading');
  await h.apply(); gate.resolve(usageCatalog(source)); await h.settle();
  assert.equal(h.calls.length, 1); assert.equal(h.el('Dialog').open, false); assert.equal(h.el('Usage').hidden, true);
});

test('language changes localize usage without rebuilding inputs losing focus or refetching', async t => {
  const h = await fixture(t, { usage: true }); await h.open(); await h.click('Track0Usage'); h.set('Track0Volume', '1e-');
  const input = h.el('Track0Volume'); input.focus(); input.selectionStart = 1; input.selectionEnd = 3;
  for (const [language, label] of [['en', 'View usage'], ['ja', '使用箇所を見る'], ['zh', '查看使用位置']]) {
    h.language(language); assert.equal(h.el('Track0Usage').textContent, label); assert.equal(h.el('Track0Volume'), input);
    assert.equal(h.document.activeElement, input); assert.equal(input.selectionStart, 1); assert.equal(input.selectionEnd, 3);
    assert.equal(input.value, '1e-'); assert.equal(h.el('Usage').dataset.trackId, id(2)); assert.equal(h.el('UsageBehaviorList').children.length, 1);
  }
  assert.equal(h.usageCalls.length, 1); assert.equal(h.calls.length, 0);
});

test('dismissal keeps source unchanged and a pending usage result cannot reopen the panel', async t => {
  const gate = deferred(); let source; const h = await fixture(t, { usage: input => { source = input; return gate.promise; } });
  await h.open(); h.el('Track0Usage').click(); await h.click('UsageDismiss'); assert.equal(h.document.activeElement, h.el('Track0Usage'));
  gate.resolve(usageCatalog(source)); await h.settle(); assert.equal(h.el('Usage').hidden, true);
  await h.click('Track0Usage'); assert.equal(h.el('UsageStatus').dataset.status, 'ready'); assert.equal(h.usageCalls.length, 1);
  assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.content(), h.original);
});


test('only explicit usage selection scrolls to results without stealing focus', async t => {
  const gate = deferred(); let source;
  const value = model(); value.tracks.push({ ...value.tracks[0], id: id(6) });
  const h = await fixture(t, { content: JSON.stringify(value), usage: (input, count) => { source = input; return count === 1 ? gate.promise : usageCatalog(input); } });
  await h.open(); const scrolls = []; h.el('Usage').scrollIntoView = options => scrolls.push(copy(options));
  const input = h.el('Track0Volume'); input.focus();
  h.el('Track0Usage').click(); assert.deepEqual(scrolls, [{ block: 'nearest' }]); assert.equal(h.document.activeElement, input);
  gate.resolve(usageCatalog(source)); await h.settle(); assert.equal(scrolls.length, 1); assert.equal(h.document.activeElement, input);
  await h.click('UsageRefresh'); h.language('ja'); h.controller.refresh();
  assert.equal(scrolls.length, 1); assert.equal(h.document.activeElement, input);
  await h.click('Track1Usage'); assert.deepEqual(scrolls, [{ block: 'nearest' }, { block: 'nearest' }]);
  assert.equal(h.document.activeElement, input); assert.equal(h.el('Usage').dataset.trackId, id(6));
});

test('withdrawing usage capability leaves loading playing and paused audition ownership intact', async t => {
  for (const status of ['loading', 'playing', 'paused']) {
    const gate = deferred(), h = await auditionFixture(t, { usage: true, audition: status === 'loading' ? () => gate.promise : true });
    h.set('Track0Volume', '0.25'); await h.check(); await h.click('Track0Usage'); h.el('Track0Preview').click();
    if (status !== 'loading') await h.settle(); if (status === 'paused') await h.click('PausePreview');
    assert.equal(h.el('PreviewStatus').dataset.status, status);
    const stops = h.audition.stops, ticket = h.audition.calls[0];
    h.context.usageAvailable = false; h.controller.refresh();
    assert.equal(h.el('Usage').hidden, true); assert.equal(h.el('Apply').disabled, false);
    assert.equal(h.el('PreviewStatus').dataset.status, status); assert.equal(h.audition.stops, stops); assert.equal(ticket.isCurrent(), true);
    h.context.usageAvailable = true; h.controller.refresh(); await h.click('Track0Usage');
    assert.equal(h.el('PreviewStatus').dataset.status, status); assert.equal(h.audition.stops, stops); assert.equal(h.el('Apply').disabled, false);
    gate.resolve(); await h.settle(); assert.equal(h.el('PreviewStatus').dataset.status, status === 'loading' ? 'playing' : status);
    assert.equal(h.audition.calls.length, 1); assert.equal(h.calls.length, 0);
  }
});

test('usage cue location follows stable current rows and never stale indices after reorder deletion or retarget', async t => {
  const h = await fixture(t, { usage: true }); await h.open(); await h.click('Track0Clone'); await h.click('Track0Usage');
  const first = h.el('UsageCue0Locate'), second = h.el('UsageCue1Locate'), firstTrack = h.el('Cue0Track'), scrolls = [];
  firstTrack.scrollIntoView = options => scrolls.push(copy(options)); await h.click('UsageCue0Locate');
  assert.equal(h.document.activeElement, firstTrack); assert.deepEqual(scrolls, [{ block: 'nearest' }]);
  await h.click('Cue1Up'); const reordered = h.el('Cue0Track');
  h.el('Track0Volume').focus(); first.dispatch('click'); second.dispatch('click');
  assert.equal(h.document.activeElement, h.el('Track0Volume'));
  await h.click('UsageCue0Locate'); assert.equal(h.document.activeElement, reordered);
  assert.equal(h.el('UsageCue0Locate').dataset.cueId, id(5));
  const moved = h.el('UsageCue0Locate'); h.set('Cue0Track', id(101), 'change'); h.el('Track0Volume').focus(); moved.dispatch('click');
  assert.equal(h.document.activeElement, h.el('Track0Volume')); assert.equal(h.el('UsageCueList').children.length, 1);
  const remaining = h.el('UsageCue1Locate'); await h.click('Cue1Remove'); h.el('Track0Volume').focus(); remaining.dispatch('click');
  assert.equal(h.document.activeElement, h.el('Track0Volume')); assert.equal(h.el('UsageCueList').children.length, 0);
  assert.equal(h.usageCalls.length, 1); assert.equal(h.calls.length, 0);
});

test('new unsaved cues have stable usage navigation and silent retargets refuse stale locations', async t => {
  const h = await fixture(t, { usage: true }); await h.open(); await h.click('Track0Clone'); await h.click('Track0Usage'); await h.click('AddCue');
  assert.equal(h.el('UsageCue2Locate').dataset.cueId, id(102)); await h.click('UsageCue2Locate');
  assert.equal(h.document.activeElement, h.el('Cue2Track'));
  const old = h.el('UsageCue2Locate'); h.set('Cue2Track', id(101), false); h.el('Track0Volume').focus(); old.dispatch('click');
  assert.equal(h.document.activeElement, h.el('Track0Volume')); assert.equal(h.usageCalls.length, 1); assert.equal(h.content(), h.original);
});

test('usage source shows readonly saved text with exact BOM CRLF Unicode and duplicate UUID token selection', async t => {
  let saved = '';
  const h = await fixture(t, { usage: source => usageCatalog(source, {
    parameters: { lead: '音🙂', first: id(2), second: id(2) },
    content: behavior => { saved = '\ufeff' + JSON.stringify(behavior, null, 2).replaceAll('\n', '\r\n') + '\r\n';
      const start = saved.lastIndexOf(JSON.stringify(id(2))); saved = saved.slice(0, start) + '"\\u0030' + id(2).slice(1) + '"' + saved.slice(start + id(2).length + 2); return saved; },
  }) });
  await h.open(); await h.click('Track0Usage'); await h.click('UsageMatch0Source');
  const text = h.el('UsageSourceText'), normalized = saved.replaceAll('\r\n', '\n');
  assert.equal(h.el('UsageSource').hidden, false); assert.equal(text.getAttribute('readonly'), ''); assert.equal(text.getAttribute('lang'), ''); assert.equal(text.value, normalized);
  assert.equal(text.value.slice(text.selectionStart, text.selectionEnd), JSON.stringify(id(2))); assert.equal(h.document.activeElement, text);
  const first = text.selectionStart; await h.click('UsageMatch1Source');
  assert.equal(h.el('UsageSourceText'), text); assert.ok(text.selectionStart > first);
  assert.equal(text.value.slice(text.selectionStart, text.selectionEnd), '"\\u0030' + id(2).slice(1) + '"');
  assert.match(h.el('UsageSourceField').textContent, /\/bindings\/0\/parameters\/second/);
  assert.match(h.el('UsageSourcePath').textContent, /documents\/behaviors\/main.json/);
  assert.equal(h.sourceReveals.length, 2); assert.equal(h.sourceReveals[1].offset, text.selectionStart);
  assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0); assert.equal(h.confirms.length, 0); assert.equal(h.usageCalls.length, 1);
});

test('multiple bindings with the same track ID reveal their own exact saved parameters', async t => {
  const h = await fixture(t, { usage: source => usageCatalog(source, { content: behavior => {
    const other = copy(behavior.bindings[0]); other.bindingId = id(301); other.instanceId = id(302); other.parameters = { other: id(2) };
    behavior.bindings.push(other); return JSON.stringify(behavior, null, 2);
  } }) });
  await h.open(); await h.click('Track0Usage'); await h.click('UsageMatch0Source'); const first = h.el('UsageSourceText').selectionStart;
  await h.click('UsageMatch1Source'); const text = h.el('UsageSourceText');
  assert.ok(text.selectionStart > first); assert.equal(text.value.slice(text.selectionStart, text.selectionEnd), JSON.stringify(id(2)));
  assert.match(h.el('UsageSourceField').textContent, /\/bindings\/1\/parameters\/other/); assert.equal(h.usageCalls.length, 1);
});

test('source preview stays the same focused selected viewport across ordinary refresh and three languages', async t => {
  const h = await fixture(t, { usage: true }); await h.open(); h.set('Track0Volume', '1e-'); await h.click('Track0Usage'); await h.click('UsageMatch0Source');
  const text = h.el('UsageSourceText'), input = h.el('Track0Volume'), value = text.value;
  text.selectionStart = 3; text.selectionEnd = 8; text.scrollTop = 79; text.scrollLeft = 12;
  for (const [language, title] of [['en', 'Saved source from the last read'], ['ja', '前回読み込んだ保存済み原文'], ['zh', '上次读取的已保存原文']]) {
    h.language(language); h.controller.refresh(); assert.equal(h.el('UsageSourceTitle').textContent, title);
    assert.equal(h.el('UsageSourceText'), text); assert.equal(text.value, value); assert.equal(h.document.activeElement, text);
    assert.equal(text.selectionStart, 3); assert.equal(text.selectionEnd, 8); assert.equal(text.scrollTop, 79); assert.equal(text.scrollLeft, 12);
    assert.equal(h.el('Track0Volume'), input); assert.equal(input.value, '1e-'); assert.equal(h.el('Apply').disabled, true);
  }
  assert.equal(h.sourceReveals.length, 1); assert.equal(h.usageCalls.length, 1);
  await h.click('UsageSourceLocate'); assert.equal(text.value.slice(text.selectionStart, text.selectionEnd), JSON.stringify(id(2))); assert.equal(h.sourceReveals.length, 2);
  await h.click('UsageSourceDismiss'); assert.equal(h.el('UsageSource').hidden, true); assert.equal(text.value, ''); assert.equal(h.document.activeElement, h.el('UsageRefresh'));
  assert.equal(h.calls.length, 0); assert.equal(h.confirms.length, 0);
});

test('source navigation preserves approval ordinary audio draft and loading playing paused auditions', async t => {
  for (const status of ['loading', 'playing', 'paused']) {
    const gate = deferred(), h = await auditionFixture(t, { usage: true, audition: status === 'loading' ? () => gate.promise : true });
    h.set('Track0Volume', '0.25'); await h.check(); await h.click('Track0Usage'); h.el('Track0Preview').click(); await h.settle();
    if (status === 'paused') await h.click('PausePreview');
    const stops = h.audition.stops, source = h.el('After').textContent;
    await h.click('UsageMatch0Source'); await h.click('UsageSourceLocate'); await h.click('UsageCue0Locate'); h.language('ja'); h.controller.refresh();
    assert.equal(h.audition.snapshot().status, status); assert.equal(h.audition.stops, stops); assert.equal(h.el('Apply').disabled, false);
    assert.equal(h.el('After').textContent, source); assert.equal(h.content(), h.original); assert.equal(h.usageCalls.length, 1); assert.equal(h.calls.length, 0);
    await h.click('UsageSourceDismiss'); assert.equal(h.audition.snapshot().status, status); assert.equal(h.audition.stops, stops);
    gate.resolve({}); await h.settle();
  }
});

test('source previews clear at the beginning of refresh and failed refresh cannot revive old source controls', async t => {
  const gate = deferred();
  const h = await fixture(t, { usage: (source, count) => count === 2 ? gate.promise : usageCatalog(source) });
  await h.open(); h.set('Track0Volume', '0.25'); await h.check(); await h.click('Track0Usage'); await h.click('UsageMatch0Source');
  const old = h.el('UsageMatch0Source'), before = h.sourceReveals.length;
  h.el('UsageRefresh').click(); assert.equal(h.el('UsageSource').hidden, true); assert.equal(h.el('UsageSourceText').value, '');
  h.el('Track0Volume').focus(); old.dispatch('click'); h.el('UsageSourceLocate').dispatch('click');
  assert.equal(h.document.activeElement, h.el('Track0Volume')); assert.equal(h.sourceReveals.length, before);
  gate.resolve(null); await h.settle(); assert.equal(h.el('UsageStatus').dataset.status, 'failed'); old.dispatch('click');
  assert.equal(h.el('UsageSource').hidden, true); assert.equal(h.el('Apply').disabled, false);
  await h.click('UsageRefresh'); old.dispatch('click'); assert.equal(h.el('UsageSource').hidden, true);
  await h.click('UsageMatch0Source'); assert.equal(h.el('UsageSource').hidden, false); assert.equal(h.usageCalls.length, 3);
});

test('stale source buttons cannot reopen after track selection dismissal deletion or parent cancellation', async t => {
  for (const reason of ['track', 'dismiss', 'remove', 'cancel', 'reopen']) {
    const h = await fixture(t, { usage: true }); await h.open(); await h.click('Track0Clone'); await h.click('Track1Usage'); await h.click('UsageMatch0Source');
    const old = h.el('UsageMatch0Source');
    if (reason === 'track') await h.click('Track0Usage');
    if (reason === 'dismiss') await h.click('UsageDismiss');
    if (reason === 'remove') await h.click('Track1Remove');
    if (reason === 'cancel' || reason === 'reopen') await h.click('Cancel');
    if (reason === 'reopen') { await h.open(); await h.click('Track0Clone'); await h.click('Track0Usage'); }
    assert.equal(h.el('UsageSource').hidden, true, reason); assert.equal(h.el('UsageSourceText').value, '', reason);
    old.dispatch('click'); assert.equal(h.el('UsageSource').hidden, true, reason); assert.equal(h.el('UsageSourceText').value, '', reason);
    assert.equal(h.calls.length, 0, reason); assert.equal(h.content(), h.original, reason);
  }
});

test('source and cue navigation reject detached nodes after ordinary refresh language and session changes', async t => {
  for (const reason of ['refresh', 'language', 'source', 'capability', 'reopen']) {
    const h = await fixture(t, { usage: true }); await h.open(); await h.click('Track0Usage');
    const oldSource = h.el('UsageMatch0Source'), oldCue = h.el('UsageCue0Locate'), oldUsage = h.el('Track0Usage');
    if (reason === 'refresh') h.controller.refresh();
    if (reason === 'language') h.language('en');
    if (reason === 'source') { h.context.sourceToken = 'load:2'; h.controller.refresh(); }
    if (reason === 'capability') { h.context.usageAvailable = false; h.controller.refresh(); h.context.usageAvailable = true; h.controller.refresh(); }
    if (reason === 'reopen') { await h.click('Cancel'); await h.open(); }
    h.el('Track0Volume').focus(); oldSource.dispatch('click'); oldCue.dispatch('click');
    if (reason === 'reopen') oldUsage.dispatch('click');
    assert.equal(h.el('UsageSource').hidden, true, reason); assert.equal(h.document.activeElement, h.el('Track0Volume'), reason);
    assert.equal(h.sourceReveals.length, 0, reason); assert.equal(h.usageCalls.length, 1, reason);
  }
});

test('withdrawing only usage capability clears source without stopping audition or revoking review', async t => {
  for (const status of ['loading', 'playing', 'paused']) {
    const gate = deferred(), h = await auditionFixture(t, { usage: true, audition: status === 'loading' ? () => gate.promise : true });
    h.set('Track0Volume', '0.25'); await h.check(); await h.click('Track0Usage'); await h.click('UsageMatch0Source'); h.el('Track0Preview').click(); await h.settle();
    if (status === 'paused') await h.click('PausePreview');
    const old = h.el('UsageMatch0Source'), stops = h.audition.stops;
    h.context.usageAvailable = false; h.controller.refresh(); h.context.usageAvailable = true; h.controller.refresh(); old.dispatch('click');
    assert.equal(h.el('UsageSource').hidden, true); assert.equal(h.el('UsageSourceText').value, ''); assert.equal(h.audition.snapshot().status, status);
    assert.equal(h.audition.stops, stops); assert.equal(h.el('Apply').disabled, false); assert.equal(h.sourceReveals.length, 1);
    gate.resolve({}); await h.settle();
  }
});

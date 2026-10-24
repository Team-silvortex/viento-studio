import { setupSceneAnimationTrackCopy } from '../../web/modules/app-scene-animation-track-copy.js';
import { setupSceneAnimationRetime } from '../../web/modules/app-scene-animation-retime.js';
import { setupSceneAnimationUsage } from '../../web/modules/app-scene-animation-usage.js';
import { captureSceneAnimationUsage } from '../../engine/scene-animation-usage.mjs';
import { setupSceneAnimationClips } from '../../web/modules/app-scene-animation-clips.js';
import { captureSceneAnimationTargets, isSceneAnimationTargets, sceneAnimationTargetsMatchSource, sceneAnimationTargetValue, validateSceneAnimationTargets } from '../../engine/scene-animation-targets.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { readSceneAnimationDocument, createSceneAnimationProposal, isSceneAnimationProposal, retimeSceneAnimationDraft, copySceneAnimationTrackDraft } from '../../engine/scene-animation-edit.mjs';
import { createSceneAnimationPlayer } from '../../web/modules/scene-animation-player.js';
import { renderSceneAnimationSample } from '../../web/modules/scene-animation-preview.js';
import { createStudioModuleRegistry } from '../../engine/studio-modules.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const model = () => ({ format: 'viento-scene-animation', schemaVersion: 1, sceneObjectId: id(1), durationSeconds: 2, loop: false,
  tracks: [{ id: id(2), instanceId: id(3), property: 'offset2d', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: [0, 0] }, { atSeconds: 2, value: [10, 20] }] }] });
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
function catalog(source, { targets, savedContent, revision = '1' } = {}) {
  const content = savedContent ?? '\ufeff' + JSON.stringify(model(), null, 2).replaceAll('\n', '\r\n') + '\r\n';
  return captureSceneAnimationTargets(copy(source), { format: 'viento-scene-animation-targets', schemaVersion: 1, worldId: 'world:' + '0'.repeat(64), revision: 'sha256:' + revision.repeat(64),
    scene: { objectId: id(1), sourcePath: 'documents/scenes/demo.json', sourceRevision: 'sha256:' + '3'.repeat(64) },
    manifest: { objectId: id(9), sourcePath: source.sourcePath, sourceRevision: source.baseSourceRevision, content },
    targets: targets ?? [3, 4].map(n => ({ instanceId: id(n), objectId: id(5), name: '<img src=x> & Same name', sourcePath: 'documents/characters/demo.md' })) });
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t, settings = {}) {
  const original = '\ufeff' + JSON.stringify(settings.model ?? model(), null, 2).replaceAll('\n', '\r\n') + '\r\n'; let content = original, language = 'zh', listener = () => {}, allocated = 10;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, animationSource: true, available: true, sourcePath: 'documents/animations/demo.json', sourceToken: 'host:1', targetsAvailable: settings.targetsAvailable ?? Boolean(settings.targets), targetsToken: 1, usageAvailable: settings.usageAvailable ?? Boolean(settings.usage), usageToken: 'usage:1' };
  const snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, sourceRevision: hash(content), baseSourceRevision: hash(original) });
  const usageCalls = [], sourceClones = new WeakMap();
  const copyCalls = [], retimeCalls = [], frames = [], calls = [], targetCalls = [], appliedTargets = [], confirmations = [], documentListeners = new Map(); let now = 0;
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const h = await dialogHarness('app-scene-animation', {
    supportsStudioCoreSceneAnimationInstances: () => settings.scope !== false,
    setupSceneAnimationTrackCopy, supportsStudioCoreSceneAnimationTrackCopy: () => settings.copyAvailable !== false,
    copySceneAnimationTrackDraft: async (content, edit, sourceTrackId, targetInstanceId, newTrackId) => { copyCalls.push({ content, edit: copy(edit), sourceTrackId, targetInstanceId, newTrackId }); const result = await copySceneAnimationTrackDraft(content, copy(edit), sourceTrackId, targetInstanceId, newTrackId); return settings.copyTrack ? settings.copyTrack(result) : result; },
    setupSceneAnimationRetime, supportsStudioCoreSceneAnimationRetime: () => settings.retimeAvailable !== false,
    retimeSceneAnimationDraft: async (content, edit, duration) => { retimeCalls.push({ content, edit: copy(edit), duration }); const result = await retimeSceneAnimationDraft(content, copy(edit), duration); return settings.retime ? settings.retime(result) : result; },
    setupSceneAnimationUsage: options => setupSceneAnimationUsage({ ...options, getContext: () => { const context = options.getContext(); if (context.source && !sourceClones.has(context.source)) sourceClones.set(context.source, copy(context.source)); return { ...context, source: context.source ? sourceClones.get(context.source) : undefined }; } }),
    crypto: { randomUUID: settings.uuid || (() => id(++allocated)) },
    supportsStudioCoreSceneAnimationSprites: () => settings.sprites !== false,
    supportsStudioCoreSceneAnimationClips: () => settings.clips !== false, setupSceneAnimationClips,
    readSceneAnimationDocument,
    createSceneAnimationProposal: async (source, edit) => { const value = await createSceneAnimationProposal(copy(source), copy(edit)); return settings.proposal ? settings.proposal(value) : value; },
    isSceneAnimationProposal, isSceneAnimationTargets, sceneAnimationTargetsMatchSource: (value, source) => sceneAnimationTargetsMatchSource(value, copy(source)),
    sceneAnimationTargetValue, validateSceneAnimationTargets: (value, document) => validateSceneAnimationTargets(value, copy(document)),
    createSceneAnimationPlayer: options => createSceneAnimationPlayer({ ...options, now: () => now, schedule: callback => { frames.push(callback); return frames.length; }, cancel() {} }),
    renderSceneAnimationSample, t: translate,
    translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange: callback => { listener = callback; return () => { listener = () => {}; }; },
  });
  h.document.addEventListener = (type, callback) => documentListeners.set(type, callback); h.document.removeEventListener = type => documentListeners.delete(type);
  h.runtime.window.confirm = message => { confirmations.push(message); return settings.confirm?.() ?? true; };
  let controller; controller = h.runtime.setupSceneAnimation({ ...(settings.usage ? { getUsage: async source => { usageCalls.push(copy(source)); return typeof settings.usage === 'function' ? settings.usage(copy(source), usageCalls.length) : usageCatalog(copy(source)); } } : {}), ...(settings.targets ? { getTargets: async source => { targetCalls.push(copy(source)); return typeof settings.targets === 'function' ? settings.targets(copy(source), targetCalls.length) : catalog(copy(source)); } } : {}), getContext: () => context, getSource: () => settings.source ? settings.source(snapshot()) : Promise.resolve(snapshot()),
    applyDraft: async (proposal, guards) => {
      calls.push(proposal); appliedTargets.push(guards.targets); if (settings.apply) return settings.apply(proposal, guards);
      assert.equal(guards.isCurrent(), true); content = proposal.afterContent; context.sourceToken += ':draft'; controller.refresh();
      return { applied: true, content, sourcePath: context.sourcePath, sourceToken: context.sourceToken, focus() {} };
    } });
  const el = name => h.element('sceneAnimation' + name), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const click = async name => { el(name).click(); await settle(); };
  t.after(() => controller.dispose());
  return { ...h, controller, el, context, calls, copyCalls, retimeCalls, targetCalls, appliedTargets, usageCalls, snapshot, original, content: () => content, confirmations, frames, settle, click, open: () => controller.open(),
    set(name, value, event = 'input') { el(name).value = value; el(name).dispatch(event); },
    language(value) { language = value; listener(); }, tick(milliseconds) { now = milliseconds; frames.at(-1)(); },
    hide() { h.document.hidden = true; documentListeners.get('visibilitychange')(); } };
}
test('opening and checking legacy animation does not migrate; returning to scene before review stays unchanged',async t=>{
 const h=await fixture(t);assert.equal(await h.open(),true);assert.equal(h.el('PlaybackScope').value,'scene');assert.equal(h.el('PlaybackScopeProjectHint').hidden,true);assert.equal(h.el('Dialog').dataset.dirty,'false');await h.click('Check');assert.equal(h.el('After').textContent,'');h.set('PlaybackScope','instance','change');assert.equal(h.el('Dialog').dataset.dirty,'true');h.set('PlaybackScope','scene','change');assert.equal(h.el('Dialog').dataset.dirty,'false');await h.click('Check');assert.equal(h.el('After').textContent,'');assert.equal(h.content(),h.original);assert.equal(h.calls.length,0);
});
test('explicit scope selection reviews schema4 and only ordinary Apply changes the draft',async t=>{
 const h=await fixture(t);await h.open();h.set('PlaybackScope','instance','change');assert.equal(h.el('PlaybackScopeProjectHint').hidden,false);assert.equal(h.el('Apply').disabled,true);assert.equal(h.content(),h.original);await h.click('Check');const reviewed=await readSceneAnimationDocument(h.el('After').textContent);assert.equal(reviewed.schemaVersion,4);assert.equal(reviewed.playbackScope,'instance');assert.deepEqual(reviewed.clips,[]);assert.equal(h.el('Before').textContent,h.original);assert.equal(h.content(),h.original);await h.click('Apply');assert.equal(h.calls.length,1);assert.equal((await readSceneAnimationDocument(h.content())).playbackScope,'instance');assert.equal(h.el('Dialog').open,false);
});
test('v4 return to scene preserves schema4 and named clips',async t=>{
 const scoped={...model(),schemaVersion:4,playbackScope:'instance',clips:[{id:id(9),name:'Attack',startSeconds:.5,endSeconds:2,loop:false}]};const h=await fixture(t,{model:scoped});await h.open();assert.equal(h.el('PlaybackScope').value,'instance');h.set('PlaybackScope','scene','change');await h.click('Check');const after=await readSceneAnimationDocument(h.el('After').textContent);assert.equal(after.schemaVersion,4);assert.equal(after.playbackScope,'scene');assert.deepEqual(after.clips,scoped.clips);assert.deepEqual(h.el('ChangedPaths').children.map(node=>node.textContent),['/playbackScope']);
});
test('scope changes can be cancelled and do not overwrite incomplete author fields or focus across languages',async t=>{
 const h=await fixture(t);await h.open();h.set('Duration','1e');h.set('PlaybackScope','instance','change');const selector=h.el('PlaybackScope');selector.focus();for(const locale of ['en','ja','zh']){h.language(locale);assert.equal(h.el('PlaybackScope'),selector);assert.equal(h.document.activeElement,selector);assert.equal(selector.value,'instance');assert.equal(h.el('Duration').value,'1e');}await h.click('Check');assert.equal(h.el('Apply').disabled,true);assert.equal(h.el('PlaybackScope').value,'instance');await h.click('Cancel');assert.equal(h.content(),h.original);assert.equal(h.calls.length,0);
});
test('missing scope capability leaves legacy edits available but cannot enable new runtime scope',async t=>{
 const config={scope:false},h=await fixture(t,config);await h.open();assert.equal(h.el('PlaybackScope').disabled,true);assert.equal(h.el('Duration').disabled,false);h.set('PlaybackScope','instance','change');assert.equal(h.el('PlaybackScope').value,'scene');h.set('Duration','3');await h.click('Check');assert.equal(h.el('Apply').disabled,false);assert.equal((await readSceneAnimationDocument(h.el('After').textContent)).schemaVersion,1);config.scope=true;h.controller.refresh();assert.equal(h.el('PlaybackScope').disabled,false);
});
test('observed scope capability loss revokes approval and a pending check even after support returns',async t=>{
 const gate=deferred(),config={scope:true,proposal:async proposal=>{await gate.promise;return proposal;}},h=await fixture(t,config);await h.open();h.set('PlaybackScope','instance','change');h.el('Check').click();await h.settle();config.scope=false;h.controller.refresh();config.scope=true;h.controller.refresh();gate.resolve();await h.settle();assert.equal(h.el('Apply').disabled,true);assert.equal(h.el('After').textContent,'');assert.equal(h.content(),h.original);
 const other={scope:true},j=await fixture(t,other);await j.open();j.set('PlaybackScope','instance','change');await j.click('Check');assert.equal(j.el('Apply').disabled,false);other.scope=false;j.controller.refresh();other.scope=true;j.controller.refresh();assert.equal(j.el('Apply').disabled,true);assert.equal(j.el('PlaybackScope').value,'instance');await j.click('Check');assert.equal(j.el('Apply').disabled,false);
});
test('apply host guard permanently rejects observed capability loss and source changes',async t=>{
 let guard;const gate=deferred(),config={scope:true,apply:async(_proposal,guards)=>{guard=guards.isCurrent;await gate.promise;return {applied:false};}},h=await fixture(t,config);await h.open();h.set('PlaybackScope','instance','change');await h.click('Check');h.el('Apply').click();await h.settle();assert.equal(guard(),true);config.scope=false;assert.equal(guard(),false);config.scope=true;assert.equal(guard(),false);gate.resolve();await h.settle();assert.equal(h.content(),h.original);assert.equal(h.el('Apply').disabled,true);
});
test('unknown scope is never silently normalized into scene or an approved author draft',async t=>{
 const h=await fixture(t);await h.open();h.set('PlaybackScope','all','change');await h.click('Check');assert.equal(h.el('Apply').disabled,true);assert.equal(h.content(),h.original);assert.equal(h.el('PlaybackScope').value,'all');
});

test('scope authoring and explicit runtime target copy are available in English and Japanese',async()=>{
 const text=await fs.readFile(new URL('../../web/modules/app-scene-animation.js',import.meta.url),'utf8');
 const keys=[...text.matchAll(/data-i18n="([^"]+)"/g)].map(row=>row[1]);keys.push('动画目标：整场景','动画目标：实例 {0}','目标最后命令序号 {0} · 全部命令截止 {1}','按场景、实例、动画或片段筛选','当前核心不支持实例运行范围；整场景旧格式仍可编辑。');
 for(const key of keys){assert.equal(typeof en[key],'string',key);assert.equal(typeof ja[key],'string',key);}
});

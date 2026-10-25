import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { readScenePhysics2DDocument, createScenePhysics2DProposal, isScenePhysics2DProposal } from '../../engine/scene-physics2d-edit.mjs';
import { captureScenePhysics2DSpace, isScenePhysics2DSpace, scenePhysics2DSpaceMatchSource, createScenePhysics2DSpaceView } from '../../engine/scene-physics2d-space.mjs';
import { createScenePhysics2DOffsetProposal, isScenePhysics2DOffsetProposal, scenePhysics2DOffsetProposalMatches } from '../../engine/scene-physics2d-space-edit.mjs';
import { createScenePhysics2DResizeProposal, isScenePhysics2DResizeProposal, scenePhysics2DResizeProposalMatches } from '../../engine/scene-physics2d-space-resize.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const model = () => ({ format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: id(1), bodies: [
  { id: id(10), instanceId: id(200), kind: 'character', shape: { kind: 'box', size: [32, 48] }, offset: [7, -3], layer: 1, mask: 1 },
  { id: id(11), instanceId: id(201), kind: 'static', shape: { kind: 'circle', radius: 15 }, offset: [-5, 10], layer: 1, mask: 1 },
  { id: id(12), instanceId: id(202), kind: 'sensor', shape: { kind: 'box', size: [60, 30] }, offset: [0, 0], layer: 1, mask: 1 },
] });
const directory = () => ({ format: 'viento-scene-physics2d-space', schemaVersion: 1, worldId: 'world:' + 'a'.repeat(64), revision: hash('world'),
  scene: { objectId: id(1), sourcePath: 'documents/scenes/demo.json', sourceRevision: hash('scene'), title: 'Saved scene', viewport: [320, 240], background: '#172839' },
  actors: [200, 201, 202].map((n, index) => ({ instanceId: id(n), objectId: id(9000 + index), name: 'Same actor', sourcePath: `documents/actors/${index}.json`, sourceRevision: hash('actor' + index),
    position: [[80, 120], [500, -40], [220, 200]][index], size: [40, 60], color: '#556677' })),
});
const fieldNames = ['Instance', 'Kind', 'Shape', 'Width', 'Height', 'Radius', 'X', 'Y', 'Layer', 'Mask'];
async function fixture(t, settings = {}) {
  const original = settings.content || JSON.stringify(settings.model || model(), null, 2) + '\n'; let oneWayCapability = settings.oneWayCapability !== false; let motionCapability = settings.motionCapability !== false; let capability = settings.capability !== false; let content = original, language = 'zh', listener = () => {}, rendererCallbacks;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, physicsSource: true, available: true,
    sourcePath: 'documents/physics/demo.json', sourceToken: 'host:1', targetsAvailable: false, spaceAvailable: settings.spaceAvailable ?? true, spaceToken: 'space:1' };
  const source = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, sourceRevision: hash(content), baseSourceRevision: hash(original) });
  const calls = [], writes = [], renders = [], state = { view: null, options: null }, reads = [];
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const h = await dialogHarness('app-scene-physics2d', {
    supportsStudioCoreScenePhysics2DOneWay: () => oneWayCapability, supportsStudioCoreScenePhysics2DResponse: () => capability, supportsStudioCoreScenePhysics2DMotion: () => motionCapability,
    readScenePhysics2DDocument, isScenePhysics2DProposal, isScenePhysics2DSpace, isScenePhysics2DOffsetProposal, isScenePhysics2DResizeProposal,
    createScenePhysics2DProposal: async (before, edit) => { await settings.beforeProposal?.(); return createScenePhysics2DProposal(copy(before), copy(edit)); },
    scenePhysics2DSpaceMatchSource: (space, snapshot) => scenePhysics2DSpaceMatchSource(space, copy(snapshot)),
    createScenePhysics2DSpaceView: (space, document) => createScenePhysics2DSpaceView(space, copy(document)),
    scenePhysics2DOffsetProposalMatches: (proposal, view, bodyId, offset) => scenePhysics2DOffsetProposalMatches(proposal, view, bodyId, copy(offset)),
    scenePhysics2DResizeProposalMatches: (proposal, view, bodyId, currentShape) => scenePhysics2DResizeProposalMatches(proposal, view, bodyId, copy(currentShape)),
    setupScenePhysics2DSpace: callbacks => { rendererCallbacks = callbacks; return {
      render(view, options) { state.view = view; state.options = copy(options); renders.push({ view, options: copy(options) }); },
      clear() { state.view = null; },
    }; },
    t: translate, translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange: callback => { listener = callback; return () => { listener = () => {}; }; },
  });
  const controller = h.runtime.setupScenePhysics2D({ getContext: () => context, getSource: async () => { await settings.beforeSource?.(); return source(); },
    getSpace: async snapshot => { reads.push(copy(snapshot)); const raw = directory(); await settings.read?.(copy(snapshot), raw); return captureScenePhysics2DSpace(copy(snapshot), raw); },
    applyDraft: async (proposal, guard) => { calls.push(proposal); await settings.beforeApply?.(); if (!guard.isCurrent()) throw Error('stale');
      content = proposal.afterContent; writes.push(content); context.sourceToken += ':draft'; return { applied: true, content, sourcePath: context.sourcePath, sourceToken: context.sourceToken }; },
  });
  const el = name => h.element('scenePhysics2D' + name), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const click = async name => { el(name).click(); await settle(); };
  t.after(() => controller.dispose());
  return { ...h, el, controller, context, calls, writes, renders, state, reads, original, content: () => content, settle, click,
    open: async () => { const result = await controller.open(); await settle(); return result; },
    set(name, value, event = ['Body', 'Kind', 'Shape', 'Response', 'Motion', 'OneWay'].includes(name) ? 'change' : 'input') { el(name).value = value; el(name).dispatch(event); },
    fields: () => Object.fromEntries(fieldNames.map(name => [name, el(name).value])),
    propose: (delta = [1, 0], bodyId = el('Body').value, view = state.view) => createScenePhysics2DResizeProposal(view, bodyId, delta),
    offer: candidate => rendererCallbacks.onResizeProposal(candidate),
    proposeOffset: (delta = [1, 0], bodyId = el('Body').value, view = state.view) => createScenePhysics2DOffsetProposal(view, bodyId, delta),
    offerOffset: candidate => rendererCallbacks.onOffsetProposal(candidate),
    select: bodyId => rendererCallbacks.onSelect(bodyId),
    oneWayCapability(value) { oneWayCapability = value; controller.refresh(); }, motionCapability(value) { motionCapability = value; controller.refresh(); }, language(value) { language = value; listener(); }, capability(value) { capability = value; controller.refresh(); },
  };
}


const baseModel=()=>{const value=model();value.bodies[1].shape={kind:'box',size:[40,8]};return value;};
const platformModel=()=>{const value=baseModel();value.schemaVersion=4;value.bodies[1].oneWay={margin:1};return value;};
const platform=async h=>{assert.equal(await h.open(),true);h.set('Body',id(11));};
test('legacy static boxes default to solid without changing author data or upgrading schema',async t=>{
  const h=await fixture(t,{model:baseModel()});await platform(h);assert.equal(h.el('OneWaySection').hidden,false);assert.equal(h.el('OneWay').value,'solid');assert.equal(h.el('OneWayMargin').value,'1');assert.equal(h.el('OneWayMarginField').hidden,true);await h.click('Check');assert.equal(h.el('Apply').disabled,true);assert.equal(h.content(),h.original);
});
test('explicit one-way mode reviews schema4 and applies only an ordinary unsaved source draft',async t=>{
  const h=await fixture(t,{model:baseModel()});await platform(h);const before=h.fields();h.set('OneWay','one-way');await h.click('Check');const after=JSON.parse(h.el('After').textContent);assert.equal(after.schemaVersion,4);assert.deepEqual(after.bodies[1].oneWay,{margin:1});assert.deepEqual(h.fields(),before);assert.equal(h.writes.length,0);await h.click('Apply');assert.equal(h.writes.length,1);assert.deepEqual(JSON.parse(h.content()),after);
});
test('disabling one-way removes only its object and retains the upgraded schema',async t=>{
  const h=await fixture(t,{model:platformModel()});await platform(h);h.set('OneWay','solid');await h.click('Check');const after=JSON.parse(h.el('After').textContent);assert.equal(after.schemaVersion,4);assert.equal(Object.hasOwn(after.bodies[1],'oneWay'),false);assert.deepEqual(after.bodies[1].shape,{kind:'box',size:[40,8]});await h.click('Apply');assert.equal(h.writes.length,1);
});
test('margin leaf edits preserve BOM CRLF escaped keys and unrelated numeric spellings',async t=>{
  const original='\ufeff'+JSON.stringify(platformModel(),null,2).replace('"schemaVersion": 4','"schemaVersion": 4e0').replace('"margin": 1','"mar\\u0067in": 1e0').replace('"mask": 1','"mask": 1e0').replace(/\n/g,'\r\n')+'\r\n';const h=await fixture(t,{content:original});await platform(h);h.set('OneWayMargin','2');await h.click('Check');assert.equal(h.el('After').textContent,original.replace('"mar\\u0067in": 1e0','"mar\\u0067in": 2'));assert.deepEqual([...h.el('ChangedPaths').children].map(row=>row.textContent),['/bodies/1/oneWay/margin']);
});
test('kind changes omit forbidden settings and restore the local choice when static box returns',async t=>{
  for(const kind of ['character','sensor']){const h=await fixture(t,{model:platformModel()});await platform(h);h.set('OneWayMargin','2.5');h.set('Kind',kind);assert.equal(h.el('OneWaySection').hidden,true);assert.equal(h.el('OneWayMargin').disabled,true);await h.click('Check');assert.equal(JSON.parse(h.el('After').textContent).bodies[1].oneWay,undefined);h.set('Kind','static');assert.equal(h.el('OneWay').value,'one-way');assert.equal(h.el('OneWayMargin').value,'2.5');await h.click('Check');assert.deepEqual(JSON.parse(h.el('After').textContent).bodies[1].oneWay,{margin:2.5});}
});
test('circle shape hides and omits one-way while returning to box restores its unfinished margin',async t=>{
  const h=await fixture(t,{model:platformModel()});await platform(h);h.set('OneWayMargin','1e-');h.set('Shape','circle');assert.equal(h.el('OneWaySection').hidden,true);await h.click('Check');const after=JSON.parse(h.el('After').textContent);assert.equal(after.schemaVersion,4);assert.equal(after.bodies[1].oneWay,undefined);assert.equal(after.bodies[1].shape.kind,'circle');h.set('Shape','box');assert.equal(h.el('OneWayMargin').value,'1e-');await h.click('Check');assert.equal(h.el('Apply').disabled,true);assert.equal(h.writes.length,0);
});
test('hidden mode and margin values do not dirty character sensor circle or solid declarations',async t=>{
  for(const kind of ['character','sensor','circle','solid']){const value=baseModel();if(kind==='circle')value.bodies[1].shape={kind:'circle',radius:15};else if(kind!=='solid')value.bodies[1].kind=kind;const h=await fixture(t,{model:value});await platform(h);if(kind!=='solid')h.set('OneWay','one-way');h.set('OneWayMargin','1e-');assert.equal(h.el('Dialog').dataset.dirty,'false',kind);await h.click('Check');assert.equal(h.el('Apply').disabled,true);assert.equal(h.content(),h.original);}
});
test('one-way settings remain local to each body selection',async t=>{
  const value=baseModel();value.bodies[2].kind='static';const h=await fixture(t,{model:value});await platform(h);h.set('OneWay','one-way');h.set('OneWayMargin','3');h.set('Body',id(12));assert.equal(h.el('OneWay').value,'solid');h.set('OneWay','one-way');h.set('OneWayMargin','8');h.set('Body',id(11));assert.equal(h.el('OneWayMargin').value,'3');await h.click('Check');assert.deepEqual(JSON.parse(h.el('After').textContent).bodies.map(body=>body.oneWay),[undefined,{margin:3},{margin:8}]);
});
test('margin finite 1 through 64 validates without clamp and incomplete input is retained',async t=>{
  const h=await fixture(t,{model:baseModel()});await platform(h);h.set('OneWay','one-way');for(const margin of ['-1','0','.999','64.1','Infinity','NaN','1e-','']){h.set('OneWayMargin',margin);await h.click('Check');assert.equal(h.el('Apply').disabled,true,margin);assert.equal(h.el('OneWayMargin').value,margin);}for(const margin of ['1','64']){h.set('OneWayMargin',margin);await h.click('Check');assert.deepEqual(JSON.parse(h.el('After').textContent).bodies[1].oneWay,{margin:Number(margin)});}assert.equal(h.writes.length,0);
});
test('equivalent margin spelling creates no source patch or application ticket',async t=>{
  const h=await fixture(t,{model:platformModel()});await platform(h);h.set('OneWayMargin','1e0');await h.click('Check');assert.equal(h.el('Apply').disabled,true);assert.equal(h.el('OneWayMargin').value,'1e0');assert.equal(h.content(),h.original);
});
test('invalid active mode and silent margin changes cannot reuse review approval',async t=>{
  const h=await fixture(t,{model:baseModel()});await platform(h);h.set('OneWay','upside-down');await h.click('Check');assert.equal(h.el('Apply').disabled,true);h.set('OneWay','one-way');await h.click('Check');assert.equal(h.el('Apply').disabled,false);h.el('OneWayMargin').value='2';await h.click('Apply');assert.equal(h.writes.length,0);
});
test('missing one-way marker blocks new features but retains older geometry editing',async t=>{
  const h=await fixture(t,{model:baseModel(),oneWayCapability:false});await platform(h);assert.equal(h.el('OneWay').disabled,true);assert.equal(h.el('Width').disabled,false);h.set('OneWay','one-way');await h.click('Check');assert.equal(h.el('Apply').disabled,true);h.set('OneWay','solid');h.set('Width','42');await h.click('Check');assert.equal(JSON.parse(h.el('After').textContent).schemaVersion,1);
});
test('schema4 checker independently enables platform motion and response without older markers',async t=>{
  const h=await fixture(t,{model:platformModel(),capability:false,motionCapability:false});await platform(h);h.set('OneWayMargin','2');h.set('Body',id(10));assert.equal(h.el('Response').disabled,false);assert.equal(h.el('Motion').disabled,false);h.set('Motion','platformer');assert.equal(h.el('Response').value,'slide');await h.click('Check');const after=JSON.parse(h.el('After').textContent);assert.equal(after.schemaVersion,4);assert.deepEqual(after.bodies[1].oneWay,{margin:2});assert.equal(after.bodies[0].characterMotion.kind,'platformer');await h.click('Apply');assert.equal(h.writes.length,1);
});
test('a new schema4 candidate can carry inherited motion fields with only the new checker available',async t=>{
  const h=await fixture(t,{model:baseModel(),capability:false,motionCapability:false});await platform(h);h.set('OneWay','one-way');h.set('Body',id(10));assert.equal(h.el('Motion').disabled,false);h.set('Motion','platformer');await h.click('Check');const after=JSON.parse(h.el('After').textContent);assert.equal(after.schemaVersion,4);assert.equal(after.bodies[0].collisionResponse,'slide');assert.equal(after.bodies[0].characterMotion.kind,'platformer');
});
test('schema4 without remaining one-way properties still requires the schema4 checker',async t=>{
  const value=platformModel();delete value.bodies[1].oneWay;const h=await fixture(t,{model:value,oneWayCapability:false});assert.equal(await h.open(),false);assert.equal(h.el('Fields').hidden,true);const n=await fixture(t,{model:value});await platform(n);n.set('Width','42');await n.click('Check');n.oneWayCapability(false);assert.equal(n.el('Apply').disabled,true);await n.click('Apply');assert.equal(n.writes.length,0);
});
test('one-way capability withdrawal and ABA reject a schema4 session during asynchronous open',async t=>{
  for(const restore of [false,true]){const gate=deferred(),h=await fixture(t,{model:platformModel(),beforeSource:()=>gate.promise});const opening=h.controller.open();await h.settle();h.oneWayCapability(false);if(restore)h.oneWayCapability(true);gate.resolve();assert.equal(await opening,false);assert.equal(h.el('Fields').hidden,true);}
});
test('one-way capability withdrawal and ABA revoke pending Check and Apply',async t=>{
  for(const phase of ['Check','Apply'])for(const restore of [false,true]){const gate=deferred(),h=await fixture(t,{model:baseModel(),[phase==='Check'?'beforeProposal':'beforeApply']:()=>gate.promise});await platform(h);h.set('OneWay','one-way');if(phase==='Apply')await h.click('Check');h.el(phase).click();await h.settle();h.oneWayCapability(false);if(restore)h.oneWayCapability(true);gate.resolve();await h.settle();assert.equal(h.writes.length,0,phase+restore);if(phase==='Check')assert.equal(h.el('Apply').disabled,true);}
});
test('older marker changes do not invalidate an independently checked schema4 request',async t=>{
  const gate=deferred(),h=await fixture(t,{model:platformModel(),beforeProposal:()=>gate.promise});await platform(h);h.set('OneWayMargin','2');h.el('Check').click();await h.settle();h.motionCapability(false);h.capability(false);gate.resolve();await h.settle();assert.equal(h.el('Apply').disabled,false);await h.click('Apply');assert.equal(h.writes.length,1);
});
test('changes to new marker do not block a pending edit targeting a legacy schema',async t=>{
  const gate=deferred(),h=await fixture(t,{model:baseModel(),beforeProposal:()=>gate.promise});await platform(h);h.set('Width','42');h.el('Check').click();await h.settle();h.oneWayCapability(false);h.oneWayCapability(true);gate.resolve();await h.settle();assert.equal(h.el('Apply').disabled,false);await h.click('Apply');assert.equal(h.writes.length,1);
});
test('late check cannot approve changed margin or a replaced document source',async t=>{
  for(const change of ['margin','source']){const gate=deferred(),h=await fixture(t,{model:baseModel(),beforeProposal:()=>gate.promise});await platform(h);h.set('OneWay','one-way');h.el('Check').click();await h.settle();if(change==='margin')h.el('OneWayMargin').value='4';else h.context.sourceToken='new-source';gate.resolve();await h.settle();assert.equal(h.el('Apply').disabled,true);assert.equal(h.writes.length,0);}
});
test('space offset and resize preserve one-way and motion while changing only geometry leaves',async t=>{
  for(const mode of ['offset','resize']){const value=platformModel();value.bodies[0].collisionResponse='slide';value.bodies[0].characterMotion={kind:'platformer',gravity:980,jumpSpeed:120,maxFallSpeed:1200};const h=await fixture(t,{model:value});await platform(h);await h.click(mode==='offset'?'SpaceEdit':'SpaceResize');assert.equal(mode==='offset'?h.offerOffset(h.proposeOffset([2,0])):h.offer(h.propose([2,0])),true);await h.click('Check');const after=JSON.parse(h.el('After').textContent);assert.equal(after.schemaVersion,4);assert.deepEqual(after.bodies[1].oneWay,{margin:1});assert.deepEqual(after.bodies[0],value.bodies[0]);assert.deepEqual([...h.el('ChangedPaths').children].map(row=>row.textContent),[mode==='offset'?'/bodies/1/offset/0':'/bodies/1/shape/size/0']);}
});
test('three languages preserve mode review and focused incomplete margin input',async t=>{
  const h=await fixture(t,{model:baseModel()});await platform(h);h.set('OneWay','one-way');await h.click('Check');const select=h.el('OneWay'),review=h.el('After').textContent;select.focus();for(const language of ['en','ja','zh']){h.language(language);assert.equal(h.el('OneWay'),select);assert.equal(h.document.activeElement,select);assert.equal(select.value,'one-way');assert.equal(h.el('After').textContent,review);assert.equal(h.el('Apply').disabled,false);}h.set('OneWayMargin','1e-');h.el('OneWayMargin').focus();h.language('ja');assert.equal(h.el('OneWayMargin').value,'1e-');assert.equal(h.document.activeElement,h.el('OneWayMargin'));
});
test('cancelled one-way review preserves old source and reopening returns to solid',async t=>{
  const h=await fixture(t,{model:baseModel()});await platform(h);h.set('OneWay','one-way');await h.click('Check');await h.click('Cancel');assert.equal(h.content(),h.original);assert.equal(h.writes.length,0);await platform(h);assert.equal(h.el('OneWay').value,'solid');
});

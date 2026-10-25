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
  const original = settings.content || JSON.stringify(settings.model || model(), null, 2) + '\n'; let motionCapability = settings.motionCapability !== false; let capability = settings.capability !== false; let content = original, language = 'zh', listener = () => {}, rendererCallbacks;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, physicsSource: true, available: true,
    sourcePath: 'documents/physics/demo.json', sourceToken: 'host:1', targetsAvailable: false, spaceAvailable: settings.spaceAvailable ?? true, spaceToken: 'space:1' };
  const source = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, sourceRevision: hash(content), baseSourceRevision: hash(original) });
  const calls = [], writes = [], renders = [], state = { view: null, options: null }, reads = [];
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const h = await dialogHarness('app-scene-physics2d', {
    supportsStudioCoreScenePhysics2DResponse: () => capability, supportsStudioCoreScenePhysics2DMotion: () => motionCapability,
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
    set(name, value, event = ['Body', 'Kind', 'Shape', 'Response', 'Motion'].includes(name) ? 'change' : 'input') { el(name).value = value; el(name).dispatch(event); },
    fields: () => Object.fromEntries(fieldNames.map(name => [name, el(name).value])),
    propose: (delta = [1, 0], bodyId = el('Body').value, view = state.view) => createScenePhysics2DResizeProposal(view, bodyId, delta),
    offer: candidate => rendererCallbacks.onResizeProposal(candidate),
    proposeOffset: (delta = [1, 0], bodyId = el('Body').value, view = state.view) => createScenePhysics2DOffsetProposal(view, bodyId, delta),
    offerOffset: candidate => rendererCallbacks.onOffsetProposal(candidate),
    select: bodyId => rendererCallbacks.onSelect(bodyId),
    motionCapability(value) { motionCapability = value; controller.refresh(); }, language(value) { language = value; listener(); }, capability(value) { capability = value; controller.refresh(); },
  };
}


const motion = () => ({ kind: 'platformer', gravity: 980, jumpSpeed: 360, maxFallSpeed: 1200 });
const movingModel = () => { const value=model();value.schemaVersion=3;value.bodies[0].collisionResponse='slide';value.bodies[0].characterMotion=motion();return value; };

test('legacy documents default to free planar movement without an automatic schema upgrade or source write',async t=>{
  const h=await fixture(t);await h.open();assert.equal(h.el('Motion').value,'free');assert.equal(h.el('MotionFields').hidden,true);assert.equal(h.el('Response').value,'stop');
  await h.click('Check');assert.equal(h.el('Apply').disabled,true);assert.equal(h.content(),h.original);assert.equal(h.el('Dialog').dataset.dirty,'false');
});
test('explicit gravity mode selects slide and reviews schema3 before ordinary draft application',async t=>{
  const h=await fixture(t);await h.open();h.set('Motion','platformer');assert.equal(h.el('Response').value,'slide');assert.equal(h.el('Response').disabled,true);assert.equal(h.el('MotionFields').hidden,false);
  assert.deepEqual(['Gravity','JumpSpeed','MaxFallSpeed'].map(name=>h.el(name).value),['980','360','1200']);await h.click('Check');
  const value=JSON.parse(h.el('After').textContent);assert.equal(value.schemaVersion,3);assert.deepEqual(value.bodies[0].characterMotion,motion());assert.equal(value.bodies[0].collisionResponse,'slide');
  for(const body of value.bodies.slice(1)){assert.equal(Object.hasOwn(body,'characterMotion'),false);assert.equal(Object.hasOwn(body,'collisionResponse'),false);}
  assert.equal(h.writes.length,0);assert.equal(h.content(),h.original);await h.click('Apply');assert.equal(h.writes.length,1);assert.deepEqual(JSON.parse(h.content()),value);
});
test('disabling motion removes only its object while retaining schema3 and explicit slide',async t=>{
  const h=await fixture(t,{model:movingModel()});await h.open();h.set('Motion','free');assert.equal(h.el('Response').value,'slide');assert.equal(h.el('Response').disabled,false);await h.click('Check');
  const value=JSON.parse(h.el('After').textContent);assert.equal(value.schemaVersion,3);assert.equal(value.bodies[0].collisionResponse,'slide');assert.equal(Object.hasOwn(value.bodies[0],'characterMotion'),false);
  await h.click('Apply');assert.deepEqual(JSON.parse(h.content()),value);
});
test('leaf edits retain schema spelling, unknown-order formatting and unrelated motion number lexemes',async t=>{
  const original='\ufeff'+JSON.stringify(movingModel(),null,2).replace('"schemaVersion": 3','"schemaVersion": 3e0').replace('"gravity": 980','"gravi\\u0074y": 9.8e2').replace('"maxFallSpeed": 1200','"maxFallSpeed": 1.2e3').replace(/\n/g,'\r\n')+'\r\n';
  const h=await fixture(t,{content:original});await h.open();h.set('JumpSpeed','420');await h.click('Check');assert.equal(h.el('After').textContent,original.replace('"jumpSpeed": 360','"jumpSpeed": 420'));
});
test('kind switches omit forbidden motion and response while restoring temporarily hidden values on return',async t=>{
  for(const kind of ['static','sensor']){
    const h=await fixture(t,{model:movingModel()});await h.open();h.set('Gravity','1500');h.set('Kind',kind);assert.equal(h.el('MotionSection').hidden,true);assert.equal(h.el('Gravity').disabled,true);await h.click('Check');
    const body=JSON.parse(h.el('After').textContent).bodies[0];assert.equal(body.characterMotion,undefined);assert.equal(body.collisionResponse,undefined);
    h.set('Kind','character');assert.equal(h.el('Motion').value,'platformer');assert.equal(h.el('Gravity').value,'1500');assert.equal(h.el('Response').value,'slide');await h.click('Check');assert.equal(JSON.parse(h.el('After').textContent).bodies[0].characterMotion.gravity,1500);
  }
});
test('inactive motion parameters are inert while returning to motion restores the unfinished numeric input',async t=>{
  const h=await fixture(t);await h.open();h.set('Gravity','1e-');assert.equal(h.el('Dialog').dataset.dirty,'false');await h.click('Check');assert.equal(h.el('Apply').disabled,true);
  h.set('Motion','platformer');assert.equal(h.el('Gravity').value,'1e-');await h.click('Check');assert.equal(h.el('Apply').disabled,true);assert.equal(h.writes.length,0);
  h.set('Motion','free');await h.click('Check');assert.equal(JSON.parse(h.el('After').textContent).schemaVersion,2);assert.equal(JSON.parse(h.el('After').textContent).bodies[0].characterMotion,undefined);
});
test('motion mode and numeric values stay local to each body',async t=>{
  const h=await fixture(t);await h.open();h.set('Motion','platformer');h.set('Gravity','1200');h.set('Body',id(11));assert.equal(h.el('Motion').value,'free');h.set('Kind','character');h.set('Motion','platformer');h.set('Gravity','600');h.set('Body',id(10));assert.equal(h.el('Gravity').value,'1200');
  await h.click('Check');const after=JSON.parse(h.el('After').textContent);assert.equal(after.bodies[0].characterMotion.gravity,1200);assert.equal(after.bodies[1].characterMotion.gravity,600);
});
test('motion bounds and zero jump speed are validated without clamping',async t=>{
  const h=await fixture(t);await h.open();h.set('Motion','platformer');
  for(const[field,value]of [['Gravity','0'],['Gravity','20001'],['JumpSpeed','-1'],['JumpSpeed','4001'],['MaxFallSpeed','0'],['MaxFallSpeed','4001'],['Gravity','Infinity'],['Gravity','1e-']]){
    h.set('Gravity','980');h.set('JumpSpeed','360');h.set('MaxFallSpeed','1200');h.set(field,value);await h.click('Check');assert.equal(h.el('Apply').disabled,true,field+value);assert.equal(h.el(field).value,value);
  }
  h.set('Gravity','20000');h.set('JumpSpeed','0');h.set('MaxFallSpeed','4000');await h.click('Check');assert.deepEqual(JSON.parse(h.el('After').textContent).bodies[0].characterMotion,{kind:'platformer',gravity:20000,jumpSpeed:0,maxFallSpeed:4000});
});
test('equivalent motion numeric spellings do not produce a rewrite or application ticket',async t=>{
  const h=await fixture(t,{model:movingModel()});await h.open();h.set('Gravity','9.8e2');h.set('JumpSpeed','3.6e2');h.set('MaxFallSpeed','1.2e3');await h.click('Check');assert.equal(h.el('Apply').disabled,true);assert.equal(h.content(),h.original);assert.equal(h.el('Gravity').value,'9.8e2');
});
test('missing optional motion capability preserves old editing and rejects forged platformer mode',async t=>{
  const h=await fixture(t,{motionCapability:false});await h.open();assert.equal(h.el('Motion').disabled,true);assert.equal(h.el('Width').disabled,false);assert.equal(h.el('Response').disabled,false);
  h.set('Motion','platformer');await h.click('Check');assert.equal(h.el('Apply').disabled,true);h.set('Motion','free');h.set('Width','35');await h.click('Check');assert.equal(JSON.parse(h.el('After').textContent).schemaVersion,1);
});
test('invalid mode and forged stop response cannot authorize a motion proposal',async t=>{
  const h=await fixture(t);await h.open();h.set('Motion','fly');await h.click('Check');assert.equal(h.el('Apply').disabled,true);
  h.set('Motion','platformer');h.set('Response','stop');await h.click('Check');assert.equal(h.el('Apply').disabled,true);assert.equal(h.el('Response').value,'stop');assert.equal(h.writes.length,0);
});
test('silent numeric changes and late check completion cannot reuse reviewed motion approval',async t=>{
  const h=await fixture(t);await h.open();h.set('Motion','platformer');await h.click('Check');h.el('Gravity').value='1200';await h.click('Apply');assert.equal(h.writes.length,0);
  const gate=deferred(),n=await fixture(t,{beforeProposal:()=>gate.promise});await n.open();n.set('Motion','platformer');n.el('Check').click();await n.settle();n.el('JumpSpeed').value='240';gate.resolve();await n.settle();assert.equal(n.el('Apply').disabled,true);
});
test('motion capability withdrawal and ABA revoke pending checks and applications',async t=>{
  for(const phase of ['Check','Apply'])for(const restore of [false,true]){
    const gate=deferred(),h=await fixture(t,{[phase==='Check'?'beforeProposal':'beforeApply']:()=>gate.promise});await h.open();h.set('Motion','platformer');if(phase==='Apply')await h.click('Check');h.el(phase).click();await h.settle();h.motionCapability(false);if(restore)h.motionCapability(true);gate.resolve();await h.settle();assert.equal(h.writes.length,0,phase+restore);if(phase==='Check')assert.equal(h.el('Apply').disabled,true);
  }
});
test('space offset and resize alter geometry leaves while preserving all motion settings and schema',async t=>{
  for(const mode of ['offset','resize']){
    const value=movingModel(),h=await fixture(t,{model:value});await h.open();await h.click(mode==='offset'?'SpaceEdit':'SpaceResize');assert.equal(mode==='offset'?h.offerOffset(h.proposeOffset([2,0])):h.offer(h.propose([2,0])),true);
    await h.click('Check');const after=JSON.parse(h.el('After').textContent);assert.equal(after.schemaVersion,3);assert.equal(after.bodies[0].collisionResponse,'slide');assert.deepEqual(after.bodies[0].characterMotion,motion());
    const changed=[...h.el('ChangedPaths').children].map(row=>row.textContent);assert.deepEqual(changed,[mode==='offset'?'/bodies/0/offset/0':'/bodies/0/shape/size/0']);
  }
});
test('three languages preserve motion select, review and incomplete numeric focus',async t=>{
  const h=await fixture(t);await h.open();h.set('Motion','platformer');await h.click('Check');const select=h.el('Motion'),reviewed=h.el('After').textContent;select.focus();
  for(const language of ['en','ja','zh']){h.language(language);assert.equal(h.el('Motion'),select);assert.equal(h.document.activeElement,select);assert.equal(select.value,'platformer');assert.equal(h.el('After').textContent,reviewed);assert.equal(h.el('Apply').disabled,false);assert.equal(h.el('Response').disabled,true);}
  h.set('Gravity','1e-');const number=h.el('Gravity');number.focus();h.language('ja');assert.equal(number.value,'1e-');assert.equal(h.document.activeElement,number);
});
test('cancelling an upgraded review preserves the old author source and reopening begins in free mode',async t=>{
  const h=await fixture(t);await h.open();h.set('Motion','platformer');await h.click('Check');await h.click('Cancel');assert.equal(h.content(),h.original);assert.equal(h.writes.length,0);await h.open();assert.equal(h.el('Motion').value,'free');assert.equal(h.el('Response').value,'stop');
});

test('motion capability independently authorizes schema3 even without the older response marker', async t => {
  const h = await fixture(t, { capability: false }); await h.open();
  assert.equal(h.el('Response').disabled, true); assert.equal(h.el('Motion').disabled, false);
  h.set('Motion', 'platformer'); assert.equal(h.el('Response').value, 'slide'); await h.click('Check');
  assert.equal(h.el('Apply').disabled, false); await h.click('Apply'); assert.equal(JSON.parse(h.content()).schemaVersion, 3);
  await h.open(); h.set('Motion', 'free'); assert.equal(h.el('Response').disabled, false); h.set('Response', 'stop'); await h.click('Check');
  assert.equal(JSON.parse(h.el('After').textContent).schemaVersion, 3); await h.click('Apply'); assert.equal(h.writes.length, 2);
});
test('schema3 without motion still uses its own checker and never falls back to response capability', async t => {
  const value = movingModel(); delete value.bodies[0].characterMotion;
  const h = await fixture(t, { model: value, capability: false }); assert.equal(await h.open(), true);
  h.set('Width', '40'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
  h.motionCapability(false); assert.equal(h.el('Apply').disabled, true); await h.click('Apply'); assert.equal(h.writes.length, 0);
  h.motionCapability(true); await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
  const n = await fixture(t, { model: value, motionCapability: false }); assert.equal(await n.open(), false); assert.equal(n.el('Fields').hidden, true);
});
test('motion capability withdrawal or ABA during source loading cannot admit a schema3 session', async t => {
  for (const restore of [false, true]) {
    const gate = deferred(), h = await fixture(t, { model: movingModel(), beforeSource: () => gate.promise });
    const opening = h.controller.open(); await h.settle(); h.motionCapability(false); if (restore) h.motionCapability(true);
    gate.resolve(); assert.equal(await opening, false); await h.settle(); assert.equal(h.el('Fields').hidden, true); assert.equal(h.writes.length, 0);
  }
});
test('optional marker changes do not revoke pending edits that target an older independent schema', async t => {
  for (const schema of [1, 2]) {
    const value = model(); value.schemaVersion = schema;
    const gate = deferred(), h = await fixture(t, { model: value, beforeProposal: () => gate.promise }); await h.open(); h.set('Width', '40');
    h.el('Check').click(); await h.settle(); h.motionCapability(false); h.motionCapability(true);
    if (schema === 1) h.capability(false);
    gate.resolve(); await h.settle(); assert.equal(h.el('Apply').disabled, false); await h.click('Apply'); assert.equal(h.writes.length, 1);
  }
});

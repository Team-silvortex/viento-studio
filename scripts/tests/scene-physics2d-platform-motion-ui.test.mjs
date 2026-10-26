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
  const original = settings.content || JSON.stringify(settings.model || model(), null, 2) + '\n'; let platformMotionCapability = settings.platformMotionCapability !== false; let oneWayCapability = settings.oneWayCapability !== false; let motionCapability = settings.motionCapability !== false; let capability = settings.capability !== false; let content = original, language = 'zh', listener = () => {}, rendererCallbacks;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, physicsSource: true, available: true,
    sourcePath: 'documents/physics/demo.json', sourceToken: 'host:1', targetsAvailable: false, spaceAvailable: settings.spaceAvailable ?? true, spaceToken: 'space:1' };
  const source = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, sourceRevision: hash(content), baseSourceRevision: hash(original) });
  const calls = [], writes = [], renders = [], state = { view: null, options: null }, reads = [];
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const h = await dialogHarness('app-scene-physics2d', {
    supportsStudioCoreScenePhysics2DPlatformMotion: () => platformMotionCapability, supportsStudioCoreScenePhysics2DOneWay: () => oneWayCapability, supportsStudioCoreScenePhysics2DResponse: () => capability, supportsStudioCoreScenePhysics2DMotion: () => motionCapability,
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
    set(name, value, event = ['Body', 'Kind', 'Shape', 'Response', 'Motion', 'OneWay', 'PlatformMotion'].includes(name) ? 'change' : 'input') { el(name).value = value; el(name).dispatch(event); },
    fields: () => Object.fromEntries(fieldNames.map(name => [name, el(name).value])),
    propose: (delta = [1, 0], bodyId = el('Body').value, view = state.view) => createScenePhysics2DResizeProposal(view, bodyId, delta),
    offer: candidate => rendererCallbacks.onResizeProposal(candidate),
    proposeOffset: (delta = [1, 0], bodyId = el('Body').value, view = state.view) => createScenePhysics2DOffsetProposal(view, bodyId, delta),
    offerOffset: candidate => rendererCallbacks.onOffsetProposal(candidate),
    select: bodyId => rendererCallbacks.onSelect(bodyId),
    platformMotionCapability(value) { platformMotionCapability = value; controller.refresh(); }, oneWayCapability(value) { oneWayCapability = value; controller.refresh(); }, motionCapability(value) { motionCapability = value; controller.refresh(); }, language(value) { language = value; listener(); }, capability(value) { capability = value; controller.refresh(); },
  };
}


const baseModel = () => { const value = model(); value.bodies[1].shape = {kind:'box', size:[40,8]}; return value; };
const movingModel = () => { const value = baseModel(); value.schemaVersion = 5; value.bodies[1].platformMotion = {kind:'horizontal',offsetX:120,speed:60}; return value; };
const platform = async h => { assert.equal(await h.open(),true); h.set('Body',id(11)); };
const changedPaths = h => [...h.el('ChangedPaths').children].map(row=>row.textContent);
const reviewed = h => JSON.parse(h.el('After').textContent.replace(/^\ufeff/,''));

test('legacy static boxes default to stationary without changing source or upgrading schema', async t => {
  const h=await fixture(t,{model:baseModel()}); await platform(h);
  assert.equal(h.el('PlatformMotionSection').hidden,false); assert.equal(h.el('PlatformMotion').value,'none');
  assert.equal(h.el('PlatformMotionX').value,'120'); assert.equal(h.el('PlatformMotionSpeed').value,'60');
  assert.equal(h.el('PlatformMotionFields').hidden,true); await h.click('Check');
  assert.equal(h.el('Apply').disabled,true); assert.equal(h.content(),h.original); assert.equal(h.writes.length,0);
});
test('explicit horizontal mode upgrades to schema5 and applies only an ordinary unsaved draft', async t => {
  const h=await fixture(t,{model:baseModel()}); await platform(h); const before=h.fields();
  h.set('PlatformMotion','horizontal'); await h.click('Check'); const after=reviewed(h);
  assert.equal(after.schemaVersion,5); assert.deepEqual(after.bodies[1].platformMotion,{kind:'horizontal',offsetX:120,speed:60});
  assert.deepEqual(h.fields(),before); assert.equal(h.writes.length,0); assert.equal(h.el('PlatformMotionFields').hidden,false);
  await h.click('Apply'); assert.equal(h.writes.length,1); assert.deepEqual(JSON.parse(h.content()),after);
});
test('disabling motion removes only its object and preserves one-way plus schema5', async t => {
  const source=movingModel(); source.bodies[1].oneWay={margin:3}; const h=await fixture(t,{model:source}); await platform(h);
  h.set('PlatformMotion','none'); await h.click('Check'); const expected=copy(source); delete expected.bodies[1].platformMotion;
  assert.deepEqual(reviewed(h),expected); assert.deepEqual(changedPaths(h),['/bodies/1/platformMotion']);
  await h.click('Apply'); assert.equal(h.writes.length,1);
});
test('signed endpoint leaf edits preserve BOM CRLF escaped keys and unrelated numeric spellings', async t => {
  const original='\ufeff'+JSON.stringify(movingModel(),null,2).replace('"schemaVersion": 5','"schemaVersion": 5e0').replace('"offsetX": 120','"offset\\u0058": 1.2e2').replace('"mask": 1','"mask": 1e0').replace(/\n/g,'\r\n')+'\r\n';
  const h=await fixture(t,{content:original}); await platform(h); h.set('PlatformMotionX','-240'); await h.click('Check');
  assert.equal(h.el('After').textContent,original.replace('"offset\\u0058": 1.2e2','"offset\\u0058": -240'));
  assert.deepEqual(changedPaths(h),['/bodies/1/platformMotion/offsetX']); assert.equal(h.writes.length,0);
});
test('changing only platform speed leaves endpoint, character motion and shape untouched', async t => {
  const source=movingModel(); source.bodies[0].collisionResponse='slide'; source.bodies[0].characterMotion={kind:'platformer',gravity:980,jumpSpeed:120,maxFallSpeed:1200};
  const h=await fixture(t,{model:source}); await platform(h); h.set('PlatformMotionSpeed','85.5'); await h.click('Check');
  const expected=copy(source); expected.bodies[1].platformMotion.speed=85.5; assert.deepEqual(reviewed(h),expected); assert.deepEqual(changedPaths(h),['/bodies/1/platformMotion/speed']);
});
test('kind changes omit forbidden motion and restore the unfinished local choice on return', async t => {
  for(const kind of ['character','sensor']) { const h=await fixture(t,{model:movingModel()}); await platform(h);
    h.set('PlatformMotionX','-240'); h.set('PlatformMotionSpeed','1e-'); h.set('Kind',kind);
    assert.equal(h.el('PlatformMotionSection').hidden,true); assert.equal(h.el('PlatformMotionSpeed').disabled,true);
    await h.click('Check'); assert.equal(reviewed(h).bodies[1].platformMotion,undefined);
    h.set('Kind','static'); assert.equal(h.el('PlatformMotion').value,'horizontal'); assert.equal(h.el('PlatformMotionX').value,'-240'); assert.equal(h.el('PlatformMotionSpeed').value,'1e-');
    await h.click('Check'); assert.equal(h.el('Apply').disabled,true); assert.equal(h.writes.length,0);
  }
});
test('circle shape hides and omits motion without losing the unfinished rectangular settings', async t => {
  const h=await fixture(t,{model:movingModel()}); await platform(h); h.set('PlatformMotionX','1e-'); h.set('Shape','circle');
  assert.equal(h.el('PlatformMotionSection').hidden,true); await h.click('Check'); assert.equal(reviewed(h).schemaVersion,5);
  assert.equal(reviewed(h).bodies[1].platformMotion,undefined); h.set('Shape','box'); assert.equal(h.el('PlatformMotionX').value,'1e-'); await h.click('Check'); assert.equal(h.el('Apply').disabled,true);
});
test('inactive movement values cannot dirty character sensor circle or stationary declarations', async t => {
  for(const kind of ['character','sensor','circle','stationary']) { const source=baseModel(); if(kind==='circle')source.bodies[1].shape={kind:'circle',radius:15}; else if(kind!=='stationary')source.bodies[1].kind=kind;
    const h=await fixture(t,{model:source}); await platform(h); if(kind!=='stationary')h.set('PlatformMotion','horizontal'); h.set('PlatformMotionX','1e-'); h.set('PlatformMotionSpeed','NaN');
    assert.equal(h.el('Dialog').dataset.dirty,'false',kind); await h.click('Check'); assert.equal(h.el('Apply').disabled,true); assert.equal(h.content(),h.original);
  }
});
test('each body retains its own endpoint and speed across selection', async t => {
  const source=baseModel(); source.bodies[2].kind='static'; const h=await fixture(t,{model:source}); await platform(h);
  h.set('PlatformMotion','horizontal'); h.set('PlatformMotionX','-40'); h.set('PlatformMotionSpeed','20'); h.set('Body',id(12)); assert.equal(h.el('PlatformMotion').value,'none');
  h.set('PlatformMotion','horizontal'); h.set('PlatformMotionX','80'); h.set('PlatformMotionSpeed','30'); h.set('Body',id(11));
  assert.equal(h.el('PlatformMotionX').value,'-40'); assert.equal(h.el('PlatformMotionSpeed').value,'20'); await h.click('Check');
  assert.deepEqual(reviewed(h).bodies.map(body=>body.platformMotion),[undefined,{kind:'horizontal',offsetX:-40,speed:20},{kind:'horizontal',offsetX:80,speed:30}]);
});
test('endpoint and speed bounds reject without clamping and retain incomplete numeric input', async t => {
  const h=await fixture(t,{model:baseModel()}); await platform(h); h.set('PlatformMotion','horizontal');
  for(const [name,values,valid] of [['PlatformMotionX',['-8192.1','-.5','0','0.999','8192.1','Infinity','NaN','1e-',''],'120'],['PlatformMotionSpeed',['-1','0','0.999','2000.1','Infinity','NaN','1e-',''],'60']]) {
    for(const value of values) { h.set(name,value); await h.click('Check'); assert.equal(h.el('Apply').disabled,true,name+value); assert.equal(h.el(name).value,value); }
    h.set(name,valid);
  }
  for(const offset of ['-8192','-1','1','8192'])for(const speed of ['1','2000']) { h.set('PlatformMotionX',offset); h.set('PlatformMotionSpeed',speed); await h.click('Check'); assert.deepEqual(reviewed(h).bodies[1].platformMotion,{kind:'horizontal',offsetX:Number(offset),speed:Number(speed)}); }
  assert.equal(h.writes.length,0);
});
test('equivalent endpoint and speed spelling makes no patch or Apply ticket', async t => {
  const h=await fixture(t,{model:movingModel()}); await platform(h); h.set('PlatformMotionX','1.20e2'); h.set('PlatformMotionSpeed','6e1'); await h.click('Check');
  assert.equal(h.el('Apply').disabled,true); assert.equal(h.el('PlatformMotionX').value,'1.20e2'); assert.equal(h.content(),h.original);
});
test('invalid mode and silent endpoint or speed changes cannot reuse review approval', async t => {
  const h=await fixture(t,{model:baseModel()}); await platform(h); h.set('PlatformMotion','vertical'); await h.click('Check'); assert.equal(h.el('Apply').disabled,true);
  h.set('PlatformMotion','horizontal'); for(const [name,value] of [['PlatformMotionX','240'],['PlatformMotionSpeed','80']]) { await h.click('Check'); assert.equal(h.el('Apply').disabled,false); h.el(name).value=value; await h.click('Apply'); assert.equal(h.writes.length,0); }
});
test('missing platform marker blocks schema5 creation while older geometry and one-way edits still work', async t => {
  const h=await fixture(t,{model:baseModel(),platformMotionCapability:false}); await platform(h);
  assert.equal(h.el('PlatformMotion').disabled,true); assert.equal(h.el('Width').disabled,false); assert.equal(h.el('OneWay').disabled,false);
  h.set('PlatformMotion','horizontal'); await h.click('Check'); assert.equal(h.el('Apply').disabled,true);
  h.set('PlatformMotion','none'); h.set('Width','42'); await h.click('Check'); assert.equal(reviewed(h).schemaVersion,1);
  h.set('OneWay','one-way'); await h.click('Check'); assert.equal(reviewed(h).schemaVersion,4); assert.equal(reviewed(h).bodies[1].platformMotion,undefined);
});
test('schema5 checker independently edits inherited one-way motion and response fields', async t => {
  const source=movingModel(); source.bodies[1].oneWay={margin:1}; const h=await fixture(t,{model:source,capability:false,motionCapability:false,oneWayCapability:false}); await platform(h);
  assert.equal(h.el('OneWay').disabled,false); h.set('OneWayMargin','3'); h.set('Body',id(10));
  assert.equal(h.el('Response').disabled,false); assert.equal(h.el('Motion').disabled,false); h.set('Motion','platformer'); await h.click('Check');
  const after=reviewed(h); assert.equal(after.schemaVersion,5); assert.deepEqual(after.bodies[1].oneWay,{margin:3}); assert.deepEqual(after.bodies[1].platformMotion,source.bodies[1].platformMotion);
  assert.equal(after.bodies[0].characterMotion.kind,'platformer'); assert.equal(after.bodies[0].collisionResponse,'slide'); await h.click('Apply'); assert.equal(h.writes.length,1);
});
test('a new schema5 candidate inherits older features even without older markers', async t => {
  const h=await fixture(t,{model:baseModel(),capability:false,motionCapability:false,oneWayCapability:false}); await platform(h); h.set('PlatformMotion','horizontal');
  assert.equal(h.el('OneWay').disabled,false); h.set('OneWay','one-way'); h.set('Body',id(10)); assert.equal(h.el('Motion').disabled,false); h.set('Motion','platformer'); await h.click('Check');
  const after=reviewed(h); assert.equal(after.schemaVersion,5); assert.ok(after.bodies[1].oneWay); assert.ok(after.bodies[1].platformMotion); assert.ok(after.bodies[0].characterMotion);
});
test('schema5 with motion disabled still requires schema5 checker and never silently downgrades', async t => {
  const source=movingModel(); delete source.bodies[1].platformMotion; const h=await fixture(t,{model:source,platformMotionCapability:false}); assert.equal(await h.open(),false); assert.equal(h.el('Fields').hidden,true);
  const n=await fixture(t,{model:source}); await platform(n); n.set('Width','42'); await n.click('Check'); assert.equal(reviewed(n).schemaVersion,5); n.platformMotionCapability(false); assert.equal(n.el('Apply').disabled,true); await n.click('Apply'); assert.equal(n.writes.length,0);
});
test('platform capability withdrawal and ABA reject schema5 during asynchronous open', async t => {
  for(const restore of [false,true]) { const gate=deferred(), h=await fixture(t,{model:movingModel(),beforeSource:()=>gate.promise}); const opening=h.controller.open(); await h.settle(); h.platformMotionCapability(false); if(restore)h.platformMotionCapability(true); gate.resolve(); assert.equal(await opening,false); assert.equal(h.el('Fields').hidden,true); }
});
test('platform capability withdrawal and ABA revoke pending Check and Apply', async t => {
  for(const phase of ['Check','Apply'])for(const restore of [false,true]) { const gate=deferred(),h=await fixture(t,{model:baseModel(),[phase==='Check'?'beforeProposal':'beforeApply']:()=>gate.promise}); await platform(h); h.set('PlatformMotion','horizontal'); if(phase==='Apply')await h.click('Check'); h.el(phase).click(); await h.settle(); h.platformMotionCapability(false); if(restore)h.platformMotionCapability(true); gate.resolve(); await h.settle(); assert.equal(h.writes.length,0,phase+restore); if(phase==='Check')assert.equal(h.el('Apply').disabled,true); }
});
test('older marker changes do not invalidate independently checked schema5 requests', async t => {
  const gate=deferred(),h=await fixture(t,{model:movingModel(),beforeProposal:()=>gate.promise}); await platform(h); h.set('PlatformMotionSpeed','80'); h.el('Check').click(); await h.settle(); h.oneWayCapability(false); h.motionCapability(false); h.capability(false); gate.resolve(); await h.settle(); assert.equal(h.el('Apply').disabled,false); await h.click('Apply'); assert.equal(h.writes.length,1);
});
test('new marker changes do not invalidate pending legacy schema edits', async t => {
  const source=baseModel(); source.schemaVersion=4; source.bodies[1].oneWay={margin:1}; const gate=deferred(),h=await fixture(t,{model:source,beforeProposal:()=>gate.promise}); await platform(h); h.set('OneWayMargin','2'); h.el('Check').click(); await h.settle(); h.platformMotionCapability(false); h.platformMotionCapability(true); gate.resolve(); await h.settle(); assert.equal(h.el('Apply').disabled,false); await h.click('Apply'); assert.equal(h.writes.length,1);
});
test('late checks cannot approve changed endpoint speed or replaced source identity', async t => {
  for(const change of ['PlatformMotionX','PlatformMotionSpeed','source']) { const gate=deferred(),h=await fixture(t,{model:baseModel(),beforeProposal:()=>gate.promise}); await platform(h); h.set('PlatformMotion','horizontal'); h.el('Check').click(); await h.settle(); if(change==='source')h.context.sourceToken='replacement'; else h.el(change).value='240'; gate.resolve(); await h.settle(); assert.equal(h.el('Apply').disabled,true); assert.equal(h.writes.length,0); }
});
test('space offset and resize retain platform motion and one-way while changing only geometry', async t => {
  for(const mode of ['offset','resize']) { const source=movingModel(); source.bodies[1].oneWay={margin:1}; source.bodies[0].collisionResponse='slide'; source.bodies[0].characterMotion={kind:'platformer',gravity:980,jumpSpeed:120,maxFallSpeed:1200}; const h=await fixture(t,{model:source}); await platform(h); await h.click(mode==='offset'?'SpaceEdit':'SpaceResize'); assert.equal(mode==='offset'?h.offerOffset(h.proposeOffset([2,0])):h.offer(h.propose([2,0])),true); await h.click('Check'); const after=reviewed(h); assert.equal(after.schemaVersion,5); assert.deepEqual(after.bodies[1].platformMotion,source.bodies[1].platformMotion); assert.deepEqual(after.bodies[1].oneWay,{margin:1}); assert.deepEqual(after.bodies[0],source.bodies[0]); assert.deepEqual(changedPaths(h),[mode==='offset'?'/bodies/1/offset/0':'/bodies/1/shape/size/0']); }
});
test('three languages preserve focused mode review and incomplete signed endpoint input', async t => {
  const h=await fixture(t,{model:baseModel()}); await platform(h); h.set('PlatformMotion','horizontal'); await h.click('Check'); const select=h.el('PlatformMotion'),review=h.el('After').textContent; select.focus();
  for(const language of ['en','ja','zh']) { h.language(language); assert.equal(h.el('PlatformMotion'),select); assert.equal(h.document.activeElement,select); assert.equal(select.value,'horizontal'); assert.equal(h.el('After').textContent,review); assert.equal(h.el('Apply').disabled,false); }
  h.set('PlatformMotionX','-1e-'); h.el('PlatformMotionX').focus(); h.language('ja'); assert.equal(h.el('PlatformMotionX').value,'-1e-'); assert.equal(h.document.activeElement,h.el('PlatformMotionX'));
});
test('cancel discards a platform review and reopening shows the original stationary declaration', async t => {
  const h=await fixture(t,{model:baseModel()}); await platform(h); h.set('PlatformMotion','horizontal'); await h.click('Check'); await h.click('Cancel'); assert.equal(h.content(),h.original); assert.equal(h.writes.length,0); await platform(h); assert.equal(h.el('PlatformMotion').value,'none');
});

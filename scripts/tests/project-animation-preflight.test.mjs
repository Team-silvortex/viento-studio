import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { preflightProjectAnimationStates, PROJECT_ANIMATION_PREFLIGHT_LIMIT } from '../../engine/project-animation-preflight.mjs';
import { createProjectAnimationStateCatalog } from '../../engine/project-animation-states.mjs';
import { generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../engine/godot-animation-state-script.mjs';
import { completionProject } from './helpers/project-animation-completion-fixture.mjs';
import { runtimeId } from './helpers/project-runtime-fixture.mjs';
const clone = value => structuredClone(value);
const codes = rows => rows.map(row => row.code);
function fixture(table = DEFAULT_ANIMATION_STATE_TABLE) {
  const plan = completionProject(), scene = plan.scenes[0];
  scene.behaviors.sources[0].content = generateEditableGodotAnimationStateScript(table).content;
  scene.behaviors.bindings[0].parameters = {};
  return plan;
}
function capabilities(plan) { plan.requiredCapabilities = [...new Set(['project.scenes', ...plan.scenes.flatMap(scene => scene.requiredCapabilities)])].sort(); }
function addBinding(scene, index) {
  const binding = clone(scene.behaviors.bindings[0]); binding.bindingId = runtimeId(1000 + index);
  binding.declaration.propertyPath = `/bindings/${index}`; scene.behaviors.bindings.push(binding); return binding;
}
function versionTable(version) {
  const table = clone(DEFAULT_ANIMATION_STATE_TABLE), scalar = { type: 'boolean', operator: 'eq', value: true };
  if (version === 2 || version === 3) table.transitions[0].trigger.condition = scalar;
  if (version === 3) table.eventSelection = 'firstMatch';
  if (version === 4) table.transitions[0].trigger.condition = { ...scalar, selector: { kind: 'projectState', key: 'combat.enabled' } };
  if (version === 5) table.transitions[0].trigger.condition = { combine: 'all', conditions: [scalar, { ...scalar, selector: { kind: 'projectState', key: 'combat.enabled' } }] };
  return table;
}

test('fresh preflight accepts exact v1–v5 controllers, default full animation, named clips, BOM and CRLF', () => {
  for (const version of [1, 2, 3, 4, 5]) for (const bom of ['', '\ufeff']) for (const newline of ['\n', '\r\n']) {
    const plan = fixture(versionTable(version)), scene = plan.scenes[0];
    scene.behaviors.sources[0].content = bom + scene.behaviors.sources[0].content.replaceAll('\n', newline);
    scene.behaviors.bindings[0].parameters.clip_action = scene.animation.document.clips[0].id;
    const before = clone(plan), result = preflightProjectAnimationStates(plan);
    assert.deepEqual(result, []); assert.ok(Object.isFrozen(result)); assert.deepEqual(plan, before);
  }
});
test('missing named clips fail only new-build preflight while the frozen runtime catalog retains acceptance', () => {
  const plan = fixture(), binding = plan.scenes[0].behaviors.bindings[0]; binding.parameters.clip_action = runtimeId(999);
  const [row] = preflightProjectAnimationStates(plan);
  assert.equal(row.code, 'build_animation_state_clip_missing'); assert.equal(row.clipId, runtimeId(999));
  assert.equal(row.parameter, 'clip_action'); assert.equal(row.stateKey, 'action');
  assert.equal(row.propertyPath, '/bindings/0/parameters/clip_action'); assert.equal(row.objectId, binding.declaration.objectId);
  assert.equal(row.sourcePath, binding.declaration.sourcePath); assert.equal(row.sourceRevision, binding.declaration.sourceRevision);
  assert.equal(row.bindingId, binding.bindingId); assert.equal(row.instanceId, binding.instanceId);
  assert.equal(row.sceneId, plan.scenes[0].scene.objectId); assert.equal(row.scriptObjectId, binding.implementation.sourceObjectId);
  assert.equal(Object.hasOwn(row, 'sourceRange'), false); assert.ok(Object.isFrozen(row));
  assert.deepEqual(createProjectAnimationStateCatalog(plan).scenes[0].controllers[0].clips, [null, runtimeId(999)]);
});
test('typed, malformed, uppercase and newline-suffixed clip values report each exact author field', () => {
  for (const value of [true, 4, 'WRONG', runtimeId(999).toUpperCase().replace('1111', 'AAAA'), runtimeId(999) + '\n']) {
    const plan = fixture(), scene = plan.scenes[0]; scene.behaviors.bindings[0].parameters = { clip_idle: value, clip_action: value };
    const rows = preflightProjectAnimationStates(plan);
    assert.deepEqual(codes(rows), ['build_animation_state_parameters_invalid', 'build_animation_state_parameters_invalid']);
    assert.deepEqual(rows.map(row => row.parameter), ['clip_idle', 'clip_action']);
  }
});
test('all bindings and states are checked in scene, binding and declaration order', () => {
  const plan = fixture(), scene = plan.scenes[0];
  scene.behaviors.bindings[0].parameters = { clip_action: runtimeId(999), clip_idle: false };
  const second = addBinding(scene, 1); second.parameters = { clip_idle: runtimeId(998) };
  const next = plan.scenes[1]; next.behaviors.sources[0].content = scene.behaviors.sources[0].content;
  next.behaviors.bindings[0].parameters = { clip_idle: runtimeId(997) };
  const rows = preflightProjectAnimationStates(plan);
  assert.deepEqual(rows.map(row => [row.sceneId, row.bindingId, row.stateKey]), [
    [scene.scene.objectId, scene.behaviors.bindings[0].bindingId, 'idle'], [scene.scene.objectId, scene.behaviors.bindings[0].bindingId, 'action'],
    [scene.scene.objectId, second.bindingId, 'idle'], [next.scene.objectId, next.behaviors.bindings[0].bindingId, 'idle']]);
  assert.deepEqual(rows.map(row => row.propertyPath), ['/bindings/0/parameters/clip_idle', '/bindings/0/parameters/clip_action', '/bindings/1/parameters/clip_idle', '/bindings/0/parameters/clip_idle']);
});
test('named clips must belong to the bound scene rather than another assembly member', () => {
  const plan = fixture(), [first, next] = plan.scenes;
  next.behaviors.sources[0].content = first.behaviors.sources[0].content;
  next.behaviors.bindings[0].parameters = { clip_idle: first.animation.document.clips[0].id };
  assert.deepEqual(codes(preflightProjectAnimationStates(plan)), ['build_animation_state_clip_missing']);
});
test('exact generated controllers without scene animation report one binding prerequisite error without invented clip errors', () => {
  const plan = fixture(), scene = plan.scenes[0]; delete scene.animation;
  scene.requiredCapabilities = scene.requiredCapabilities.filter(value => !value.startsWith('animation.')); capabilities(plan);
  scene.behaviors.bindings[0].parameters = { clip_idle: runtimeId(999), clip_action: false };
  const rows = preflightProjectAnimationStates(plan);
  assert.deepEqual(codes(rows), ['build_animation_state_animation_missing', 'build_animation_state_parameters_invalid']);
  assert.equal(rows[0].propertyPath, '/bindings/0');
});
test('instance controllers require tracks on their own instance; scene-wide controllers retain legacy reach', () => {
  const plan = fixture(), scene = plan.scenes[0], second = addBinding(scene, 1);
  second.instanceId = scene.actors[1].instanceId; second.objectId = scene.actors[1].objectId;
  assert.deepEqual(preflightProjectAnimationStates(plan), []);
  scene.animation.schemaVersion = 3; scene.animation.document.schemaVersion = 4; scene.animation.document.playbackScope = 'instance';
  scene.requiredCapabilities.push('animation.instances2d'); capabilities(plan);
  const rows = preflightProjectAnimationStates(plan);
  assert.deepEqual(codes(rows), ['build_animation_state_target_missing']); assert.equal(rows[0].instanceId, second.instanceId);
  assert.equal(rows[0].propertyPath, '/bindings/1/instanceId');
});
test('looped named clips and full animation remain accepted without predicting runtime completion', () => {
  const plan = fixture(), scene = plan.scenes[0]; scene.animation.document.loop = true;
  scene.behaviors.bindings[0].parameters.clip_action = scene.animation.document.clips.find(clip => clip.loop).id;
  assert.deepEqual(preflightProjectAnimationStates(plan), []); scene.behaviors.bindings[0].parameters.clip_action = '';
  assert.deepEqual(preflightProjectAnimationStates(plan), []);
});
test('ordinary, edited, malformed and unsupported generated script sources remain outside static authority', () => {
  for (const transform of [() => 'extends Node\n', source => source + '\n# author edit\n', source => source.replace('godot-gdscript-v1', 'godot-gdscript-v99'),
    source => source.replace('"schemaVersion":1', '"schemaVersion":99'), source => source.replace('"idle"', '"not_present"')]) {
    const plan = fixture(), scene = plan.scenes[0]; scene.behaviors.sources[0].content = transform(scene.behaviors.sources[0].content);
    scene.behaviors.bindings[0].parameters.clip_idle = false; assert.deepEqual(preflightProjectAnimationStates(plan), []);
  }
});
test('other behavior backends and scenes without behaviors do not gain generated-controller restrictions', () => {
  const plan = fixture(), scene = plan.scenes[0]; scene.behaviors.backendId = 'org.viento.bevy'; scene.behaviors.language = 'rust';
  assert.deepEqual(preflightProjectAnimationStates(plan), []); delete scene.behaviors;
  assert.deepEqual(preflightProjectAnimationStates(plan), []);
});
test('preflight does not swallow optional Rust core absence for recognizable declarations', async () => {
  const plan = fixture(), module = new URL('../../engine/project-animation-preflight.mjs', import.meta.url).href;
  const core = new URL('../../engine/studio-core.mjs', import.meta.url).href, wasm = new URL('../../engine/studio-core.wasm', import.meta.url).href;
  const code = `import assert from 'node:assert/strict';import fs from 'node:fs/promises';import{initializeStudioCore}from ${JSON.stringify(core)};const original=await WebAssembly.instantiate(await fs.readFile(new URL(${JSON.stringify(wasm)})),{});const exports={...original.instance.exports};delete exports.viento_core_animation_state_table_version;WebAssembly.instantiate=async()=>({instance:{exports}});await initializeStudioCore(()=>new Uint8Array([1]));import{preflightProjectAnimationStates}from ${JSON.stringify(module)};assert.throws(()=>preflightProjectAnimationStates(${JSON.stringify(plan)}),error=>error.errorCode==='studio_core_unavailable');`;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code]);
});
test('safe project admission rejects getters, serializers, inherited records and sparse arrays without calling user code', () => {
  let called = 0; const getter = { enumerable: true, get() { called++; return []; } };
  for (const edit of [p => Object.defineProperty(p, 'scenes', getter), p => Object.defineProperty(p.scenes[0].behaviors.sources[0], 'content', getter),
    p => Object.defineProperty(p.scenes[0].behaviors.bindings[0].parameters, 'clip_idle', getter), p => { p.toJSON = () => { called++; }; },
    p => Object.setPrototypeOf(p.scenes[0].behaviors, { hidden: true }), p => { delete p.scenes[0].behaviors.bindings[0]; },
    p => { p.scenes[0].behaviors.bindings[0].parameters[Symbol()] = 'x'; }]) {
    const plan = fixture(); edit(plan); assert.throws(() => preflightProjectAnimationStates(plan));
  }
  assert.equal(called, 0);
});
test('malformed behavior admission rejects false provenance, duplicate identities and unbounded sources before diagnostics', () => {
  for (const edit of [s => { s.behaviors.bindings[0].declaration.sourceRange = { start: 0, end: 1, encoding: 'utf-16' }; },
    s => { s.behaviors.bindings[0].declaration.sourcePath = 'forged.json'; }, s => { s.behaviors.bindings[0].declaration.propertyPath = '/bindings/9'; },
    s => { s.behaviors.bindings[0].instanceId = runtimeId(999); }, s => { s.behaviors.bindings.push(clone(s.behaviors.bindings[0])); },
    s => { s.behaviors.sources[0].content = 'x'.repeat(65537); }, s => { s.behaviors.sources[0].sourcePath = '../outside.txt'; },
    s => { s.behaviors.sources.push(clone(s.behaviors.sources[0])); }, s => { s.behaviors.bindings[0].parameters = null; }]) {
    const plan = fixture(); edit(plan.scenes[0]); assert.throws(() => preflightProjectAnimationStates(plan));
  }
});
test('bounded diagnostics preserve first fields and explicitly count omitted errors', () => {
  const table = { initialState: 'state_0', states: Array.from({ length: 16 }, (_, index) => ({ key: `state_${index}` })), transitions: [] };
  const plan = fixture(table), scene = plan.scenes[0];
  scene.behaviors.bindings[0].parameters = Object.fromEntries(table.states.map(({ key }) => [`clip_${key}`, runtimeId(999)]));
  for (let index = 1; index < 17; index++) addBinding(scene, index);
  const rows = preflightProjectAnimationStates(plan);
  assert.equal(rows.length, PROJECT_ANIMATION_PREFLIGHT_LIMIT);
  assert.equal(rows[0].propertyPath, '/bindings/0/parameters/clip_state_0');
  assert.equal(rows[254].propertyPath, '/bindings/15/parameters/clip_state_14');
  assert.equal(rows[255].code, 'build_animation_state_preflight_limit'); assert.equal(rows[255].omittedCount, 17);
  assert.equal(rows[255].objectId, plan.assembly.objectId); assert.equal(rows[255].propertyPath, '/sceneIds');
  assert.deepEqual(preflightProjectAnimationStates(plan), rows);
  scene.behaviors.bindings.pop(); const exact = preflightProjectAnimationStates(plan);
  assert.equal(exact.length, 256); assert.equal(exact[255].code, 'build_animation_state_clip_missing');
});

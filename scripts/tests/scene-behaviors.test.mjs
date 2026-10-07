import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectSceneBehaviors, validateSceneBehaviorDependencies, resolveSceneBehaviors } from '../../engine/scene-behaviors.mjs';

const id = number => `${number.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const revision = 'a'.repeat(64);
function manifest() {
  return { format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(1), bindings: [{
    bindingId: id(5), instanceId: id(4), implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: id(3) },
    parameters: { speed: 3.5, enabled: true, text: '你好 / こんにちは' }, events: [{ signal: 'checkpointArrived', event: 'arrived' }],
  }] };
}
const inspect = value => inspectSceneBehaviors(typeof value === 'string' ? value : JSON.stringify(value));
function fixture() {
  const record = (number, sourcePath, relations = []) => ({ format: 'viento-document', version: 1, id: id(number), sourcePath, relations, assetBindings: [] });
  const scene = { record: record(1, 'documents/scenes/demo.json', [{ kind: 'behavior', targetId: id(2) }, { kind: 'reference', targetId: id(9) }]), sourcePath: 'documents/scenes/demo.json', sourceRevision: revision,
    content: JSON.stringify({ format: 'viento-scene2d', schemaVersion: 2, title: 'test', viewport: [640, 480], background: '#ffffff',
      actors: [{ instanceId: id(4), objectId: id(9), position: [0, 0], size: [10, 10], color: '#ffffff', speed: 0, controls: 'none' }] }) };
  const behavior = { record: record(2, 'documents/behaviors/demo.json', [{ kind: 'reference', targetId: id(1) }, { kind: 'script-source', targetId: id(3) }]),
    sourcePath: 'documents/behaviors/demo.json', sourceRevision: 'b'.repeat(64), content: JSON.stringify(manifest(), null, 2) };
  const script = { record: record(3, 'documents/scripts/move.txt'), sourcePath: 'documents/scripts/move.txt', sourceRevision: 'c'.repeat(64),
    content: '\uFEFFextends Node\r\n@export var speed: float = 0\r\n# Arbitrary source stays data\r\n' };
  const source = { documents: [{ sourcePath: 'documents/unregistered.md', content: '# Unregistered' },
    { record: record(9, 'documents/characters/actor.md'), sourcePath: 'documents/characters/actor.md', content: '# Actor' }, scene, behavior, script], assets: [] };
  const plan = { format: 'viento-build-plan', schemaVersion: 2, kind: 'scene2d', scene: { objectId: id(1), sourcePath: scene.sourcePath, sourceRevision: revision }, actors: [{ instanceId: id(4), objectId: id(9) }] };
  return { source, scene, behavior, script, plan };
}

test('strict manifest is detached, deeply immutable and keeps identifiers and typed parameters', () => {
  const value = manifest(), checked = inspect(value);
  assert.equal(checked.recognized, true); assert.equal(checked.ok, true); assert.deepEqual(checked.value, value);
  assert.ok(Object.isFrozen(checked.value.bindings[0].parameters));
  assert.throws(() => { checked.value.bindings[0].parameters.speed = 10; }, TypeError);
  value.bindings[0].parameters.speed = 99;
  assert.equal(checked.value.bindings[0].parameters.speed, 3.5);
});

test('ordinary and nested format markers do not opt into behavior inspection', () => {
  for (const content of [undefined, '', '# viento-scene-behaviors', '"viento-scene-behaviors"', '[{"format":"viento-scene-behaviors"}]',
    '{"example":{"format":"viento-scene-behaviors"}}', '{"format":"ordinary","text":"viento-scene-behaviors"}',
    '{"example":{"format":"viento-scene-behaviors"},"unfinished":']) {
    assert.deepEqual(inspectSceneBehaviors(content), { recognized: false, ok: true, value: null, diagnostics: [] });
  }
});

test('escaped and unfinished markers stay recognized and oversized marker declarations fail closed', () => {
  const escaped = [...'viento-scene-behaviors'].map(character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
  for (const content of [JSON.stringify(manifest()).replace('viento-scene-behaviors', escaped),
    JSON.stringify(manifest()).replace('"format":', `"format":${' '.repeat(1024)}`)]) {
    assert.equal(inspect(content).recognized, true); assert.equal(inspect(content).ok, true);
  }
  for (const content of ['{"for\\u006dat":"viento-scene-behaviors",', '{"format":"viento-scene-\\u0062ehaviors","unfinished":',
    ' '.repeat(40000) + JSON.stringify(manifest()), JSON.stringify({ ...manifest(), filler: '中'.repeat(12000) })]) {
    const checked = inspect(content); assert.equal(checked.recognized, true); assert.equal(checked.ok, false); assert.equal(checked.value, null);
  }
});

test('duplicate decoded keys, schema drift and every structural unknown field reject', () => {
  const changes = [value => { value.schemaVersion = 2; }, value => { value.extra = 'x'; },
    value => { value.bindings[0].extra = 1; }, value => { value.bindings[0].implementation.path = '/tmp/a.gd'; },
    value => { value.bindings[0].events[0].handler = 'run'; }, value => { delete value.bindings[0].parameters; }];
  for (const change of changes) { const value = manifest(); change(value); assert.equal(inspect(value).ok, false); }
  const duplicate = JSON.stringify(manifest()).replace('"schemaVersion":1', '"schemaVersion":1,"schema\\u0056ersion":1');
  assert.equal(inspect(duplicate).ok, false); assert.equal(inspect(duplicate).diagnostics[0].propertyPath, '/schemaVersion');
});

test('binding and signal uniqueness, instance IDs and homogeneous implementations are explicit gates', () => {
  for (const change of [value => { value.bindings[0].bindingId = id(0xab).toUpperCase(); }, value => { value.bindings[0].instanceId = 'actor'; },
    value => { value.bindings.push(structuredClone(value.bindings[0])); }, value => { value.bindings[0].events.push({ signal: 'checkpointArrived', event: 'different' }); },
    value => { const other = structuredClone(value.bindings[0]); other.bindingId = id(6); other.implementation.backendId = 'org.native.test'; value.bindings.push(other); },
    value => { const other = structuredClone(value.bindings[0]); other.bindingId = id(6); other.implementation.language = 'rust'; value.bindings.push(other); },
    value => { value.bindings[0].implementation.language = 'GDScript'; }]) {
    const value = manifest(); change(value); assert.equal(inspect(value).ok, false);
  }
});

test('bounded scalar parameters reject objects, null, unsafe integers, numeric overflow and invalid Unicode', () => {
  for (const scalar of [null, [], {}, 9007199254740992, 'x'.repeat(4097), '\ud800']) {
    const value = manifest(); value.bindings[0].parameters.speed = scalar; assert.equal(inspect(value).ok, false);
  }
  assert.equal(inspect(JSON.stringify(manifest()).replace('"speed":3.5', '"speed":1e999')).ok, false);
  for (const name of ['constructor', '__proto__', 'prototype']) {
    const value = manifest(); Object.defineProperty(value.bindings[0].parameters, name, { value: 1, enumerable: true });
    assert.equal(inspect(value).ok, false);
  }
  const value = manifest(); value.bindings[0].parameters['bad/name'] = 0;
  assert.equal(inspect(value).diagnostics[0].propertyPath, '/bindings/0/parameters/bad~1name');
});

test('manifest count, source count, parameter count and event count are bounded independently', () => {
  for (const change of [value => { value.bindings = []; }, value => { value.bindings = Array.from({ length: 33 }, (_, i) => ({ ...value.bindings[0], bindingId: id(i + 100) })); },
    value => { value.bindings[0].parameters = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`p${i}`, i])); },
    value => { value.bindings[0].events = Array.from({ length: 9 }, (_, i) => ({ signal: `s${i}`, event: `e${i}` })); },
    value => { value.bindings = Array.from({ length: 9 }, (_, i) => ({ ...value.bindings[0], bindingId: id(i + 100), implementation: { ...value.bindings[0].implementation, sourceObjectId: id(i + 200) } })); }]) {
    const value = manifest(); change(value); assert.equal(inspect(value).ok, false);
  }
});

test('dependency entrypoint rejects accessors and inherited executable values without invoking them', () => {
  let called = 0; const value = manifest(); Object.defineProperty(value.bindings[0].implementation, 'language', { enumerable: true, get() { called++; throw new Error('must not run'); } });
  assert.equal(validateSceneBehaviorDependencies(value).length, 1); assert.equal(called, 0);
  const inherited = Object.assign(Object.create({ run() {} }), manifest());
  assert.equal(validateSceneBehaviorDependencies(inherited).length, 1);
});

test('registered scene and text source dependencies require nonownership metadata edges', () => {
  const f = fixture(), value = inspect(f.behavior.content).value;
  assert.deepEqual(validateSceneBehaviorDependencies(value, f.behavior.record, f.source), []);
  f.behavior.record.relations[0].kind = 'references';
  assert.deepEqual(validateSceneBehaviorDependencies(value, f.behavior.record, f.source), []);
  f.behavior.record.relations[1].kind = 'part-of';
  const errors = validateSceneBehaviorDependencies(value, f.behavior.record, f.source);
  assert.equal(errors[0].code, 'build_behavior_unlinked'); assert.equal(errors[0].relatedObjectId, id(3));
});

test('assets, unregistered paths, wrong source extension and unavailable script bytes are rejected', () => {
  for (const alter of [f => { f.source.documents.pop(); }, f => { f.script.record.format = 'viento-asset'; },
    f => { f.script.sourcePath = 'documents/scripts/run.gd'; }, f => { f.script.content = null; }, f => { f.script.content = '中'.repeat(22000); }]) {
    const f = fixture(); alter(f);
    assert.ok(validateSceneBehaviorDependencies(manifest(), f.behavior.record, f.source).some(item => item.relatedObjectId === id(3)));
  }
});

test('schema2/3 scene instance membership is checked and legacy or ambiguous scenes reject', () => {
  const f = fixture(), value = manifest(); value.bindings[0].instanceId = id(7);
  assert.equal(validateSceneBehaviorDependencies(value, f.behavior.record, f.source)[0].code, 'build_behavior_instance_missing');
  for (const version of [1, 2, 3]) {
    const f = fixture(); f.scene.content = f.scene.content.replace('"schemaVersion":2', `"schemaVersion":${version}`);
    assert.equal(validateSceneBehaviorDependencies(manifest(), f.behavior.record, f.source).length === 0, version !== 1);
  }
  f.scene.content = f.scene.content.replace('"schemaVersion":2', '"schemaVersion":2,"schemaVersion":2');
  assert.ok(validateSceneBehaviorDependencies(manifest(), f.behavior.record, f.source).length);
  for (const actors of [{ find: 1 }, null, [null]]) {
    const malformed = fixture(), scene = JSON.parse(malformed.scene.content); scene.actors = actors; malformed.scene.content = JSON.stringify(scene);
    const result = resolveSceneBehaviors({ source: malformed.source }, malformed.plan);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'build_behavior_scene_invalid'));
  }
});

test('bound actor definitions must remain registered, available and linked from the scene', () => {
  for (const alter of [f => { f.source.documents.splice(1, 1); }, f => { f.source.documents[1].content = null; },
    f => { f.scene.record.relations = f.scene.record.relations.filter(relation => relation.targetId !== id(9)); }]) {
    const f = fixture(); alter(f);
    assert.ok(validateSceneBehaviorDependencies(manifest(), f.behavior.record, f.source).some(diagnostic =>
      diagnostic.relatedObjectId === id(9) && diagnostic.propertyPath === '/bindings/0/instanceId'));
  }
});

test('unlinked manifests and reference-only links leave existing plans behavior-free', () => {
  const f = fixture(); f.behavior.content = '{"format":"viento-scene-behaviors",'; f.scene.record.relations = [];
  assert.deepEqual(resolveSceneBehaviors({ source: f.source }, f.plan), { ok: true, behaviors: null, diagnostics: [] });
  f.scene.record.relations = [{ kind: 'reference', targetId: id(2) }];
  assert.equal(resolveSceneBehaviors({ source: f.source }, f.plan).behaviors, null);
});

test('opt-in to missing or ordinary declarations rejects and never silently removes execution bindings', () => {
  for (const content of [null, '{}', '{"format":"ordinary"}']) {
    const f = fixture(); f.behavior.content = content;
    const resolved = resolveSceneBehaviors({ source: f.source }, f.plan);
    assert.equal(resolved.ok, false); assert.equal(resolved.behaviors, null);
  }
});

test('one scene cannot opt into two recognized manifests', () => {
  const f = fixture(), other = structuredClone(f.behavior); other.record.id = id(8); other.sourcePath = 'documents/behaviors/other.json';
  f.source.documents.push(other); f.scene.record.relations.push({ kind: 'behavior', targetId: id(8) });
  const result = resolveSceneBehaviors({ source: f.source }, f.plan);
  assert.equal(result.ok, false); assert.equal(result.diagnostics.length, 2);
});

test('resolved bindings freeze original source bytes and per-instance plan object identity without execution', () => {
  const f = fixture(); f.script.content = 'throw new Error("executed author data")\r\n';
  const resolved = resolveSceneBehaviors({ source: f.source }, f.plan);
  assert.equal(resolved.ok, true); assert.equal(resolved.behaviors.format, 'viento-behavior-plan');
  assert.deepEqual(resolved.behaviors.sources, [{ objectId: id(3), sourcePath: f.script.sourcePath, sourceRevision: f.script.sourceRevision, language: 'gdscript', content: f.script.content }]);
  assert.equal(resolved.behaviors.bindings[0].objectId, id(9));
  assert.deepEqual(resolved.behaviors.bindings[0].declaration, { objectId: id(2), sourcePath: f.behavior.sourcePath, sourceRevision: f.behavior.sourceRevision, propertyPath: '/bindings/0' });
  assert.ok(Object.isFrozen(resolved.behaviors.sources[0]));
  f.script.content = '# Changed'; assert.equal(resolved.behaviors.sources[0].content, 'throw new Error("executed author data")\r\n');
});

test('forged plan actor pairings and manifest scene claims produce trusted declaration ranges', () => {
  const f = fixture(); f.plan.actors[0].objectId = id(10);
  const result = resolveSceneBehaviors({ source: f.source }, f.plan), diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.code, 'build_behavior_instance_missing');
  assert.equal(diagnostic.objectId, id(2)); assert.equal(diagnostic.sourceRevision, f.behavior.sourceRevision);
  assert.equal(diagnostic.propertyPath, '/bindings/0/instanceId'); assert.equal(diagnostic.sourceRange.exact, true);
  assert.equal(JSON.parse(f.behavior.content.slice(diagnostic.sourceRange.start, diagnostic.sourceRange.end)), id(4));
  const value = manifest(); value.sceneObjectId = id(20); f.behavior.content = JSON.stringify(value);
  assert.ok(resolveSceneBehaviors({ source: f.source }, f.plan).diagnostics.some(item => item.code === 'build_behavior_scene_invalid'));
});

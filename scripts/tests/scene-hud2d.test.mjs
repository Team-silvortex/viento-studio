import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { validateSceneHUD2DDocument as validate, inspectSceneHUD2DDocument as inspect, sceneHUD2DDocumentIds as ids,
  sceneHUD2DCapabilities as capabilities, validateSceneHUD2DDependencies as dependencies, resolveSceneHUD2D as resolve,
  validateSceneHUD2DPlan as plan, stripSceneHUD2DPlan as strip, SCENE_HUD2D_ANCHORS as anchors } from '../../engine/scene-hud2d.mjs';
import { scene2DModelToPlan } from '../../engine/build-plan.mjs';
import { resolveScene2DModel } from '../../engine/scene-model.mjs';
import { hudId, hudLabel, hudBar, hudDocument as document, sceneHUD2DFixture } from './helpers/scene-hud2d-fixture.mjs';
const invalid = fn => assert.throws(fn, { errorCode: 'build_hud2d_invalid' });
test('HUD labels and bars are detached, frozen and independently identified with one scene dependency', () => {
  const raw = document(), checked = validate(raw); assert.deepEqual(checked, raw); assert.notEqual(checked.elements[0], raw.elements[0]);
  for (const value of [checked, checked.elements, checked.elements[0], checked.elements[0].content, checked.elements[1].offset]) assert.ok(Object.isFrozen(value));
  assert.deepEqual(ids(raw), [hudId(1)]); assert.deepEqual(capabilities(raw), ['scene.hud2d']); raw.elements[0].offset[0] = 99; assert.equal(checked.elements[0].offset[0], 12);
  assert.deepEqual(validate(document([])).elements, []);
});
test('all nine anchors and finite integer geometry/color/font boundaries are explicit', () => {
  for (const anchor of anchors) for (const element of [hudLabel(), hudBar()]) assert.doesNotThrow(() => validate(document([{ ...element, anchor, offset: [-8192, 8192], size: [1, 2048] }])));
  for (const patch of [{ anchor: 'left' }, { offset: [0.5, 0] }, { offset: [8193, 0] }, { offset: [0] }, { size: [0, 1] }, { size: [1, 2049] }, { size: [1, NaN] }, { fontSize: 7 }, { fontSize: 72.1 }, { color: '#bad' }, { color: '#ffffff00ff' }]) invalid(() => validate(document([{ ...hudLabel(), ...patch }])));
  assert.doesNotThrow(() => validate(document([{ ...hudLabel(), color: '#ABCDEF10', fontSize: 72 }])));
});
test('element unions, identities, sequence and state keys cannot be inferred or repaired', () => {
  assert.equal(validate(document(Array.from({ length: 32 }, (_, n) => hudLabel(hudId(100 + n))))).elements.length, 32);
  for (const raw of [document([hudLabel(), hudLabel()]), document(Array.from({ length: 33 }, (_, n) => hudLabel(hudId(100 + n)))),
    { ...document(), schemaVersion: 2 }, { ...document(), sceneObjectId: 'scene' }, document([{ ...hudLabel(), kind: 'button' }]),
    document([{ ...hudLabel(), key: 'score' }]), document([{ ...hudBar(), text: 'wrong union' }]),
    ...['__proto__', 'constructor', 'prototype', '9score', '', 'a'.repeat(65)].map(key => document([{ ...hudBar(), key }]))]) invalid(() => validate(raw));
  for (const patch of [{ min: 100 }, { min: 101 }, { max: Infinity }, { fallback: 1e9 + 1 }, { fillColor: 'red' }]) invalid(() => validate(document([{ ...hudBar(), ...patch }])));
});
test('text limits count codepoints and reject malformed Unicode or invisible controls while keeping line breaks', () => {
  assert.doesNotThrow(() => validate(document([{ ...hudLabel(), content: { kind: 'literal', text: '😀'.repeat(256) + '' } }])));
  assert.doesNotThrow(() => validate(document([{ ...hudLabel(), content: { kind: 'literal', text: '\t中\r\n日' } }])));
  for (const text of ['x'.repeat(1000000), '😀'.repeat(257), '\ud800', '\udc00', 'a\0b', '\u0007', '\u007f']) invalid(() => validate(document([{ ...hudLabel(), content: { kind: 'literal', text } }])));
  for (const patch of [{ prefix: '😀'.repeat(65) }, { suffix: '\0' }, { missing: 'a'.repeat(257) }, { unknown: true }]) invalid(() => validate(document([{ ...hudLabel(), content: { ...hudLabel().content, ...patch } }])));
});
test('strict HUD descriptors reject getters, hidden/symbol/inherited fields, serializers and sparse lists without execution', () => {
  let calls = 0;
  const getter = document(); Object.defineProperty(getter.elements[0].content, 'prefix', { enumerable: true, get() { calls++; return ''; } });
  const hidden = document(); Object.defineProperty(hidden.elements[1], 'fallback', { enumerable: false, value: 0 });
  const symbol = document(); symbol.elements[0][Symbol('unsafe')] = 1;
  const inherited = document(); inherited.elements[0] = Object.assign(Object.create({ unsafe: 1 }), hudLabel());
  const sparse = document(); delete sparse.elements[0]; const named = document(); named.elements.extra = 1;
  const serializer = document(); serializer.elements[0].toJSON = () => { calls++; return hudLabel(); };
  for (const raw of [getter, hidden, symbol, inherited, sparse, named, serializer]) invalid(() => validate(raw));
  assert.equal(calls, 0);
});
test('HUD source discovery is top-level only and preserves strict duplicate and UTF8 budget checks', () => {
  const source = JSON.stringify(document()); assert.equal(inspect('\ufeff' + source + '\r\n').ok, true);
  for (const value of [JSON.stringify({ example: document() }), '# viento-scene-hud2d', '{"format":"other"}']) assert.equal(inspect(value).recognized, false);
  for (const value of [source.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'), '{"format":"viento-scene-hud2d",', source + ' '.repeat(65536)]) { assert.equal(inspect(value).recognized, true); assert.equal(inspect(value).ok, false); }
});
for (const schemaVersion of [1, 2, 3]) test(`Scene2D ${schemaVersion} HUD opt-in and frozen strip preserve all other scene data`, async () => {
  const f = await sceneHUD2DFixture({ schemaVersion, enabled: true }), base = scene2DModelToPlan(resolveScene2DModel(f, f.sceneId).model), resolved = resolve(f, base);
  assert.equal(resolved.ok, true, JSON.stringify(resolved.diagnostics)); assert.deepEqual(dependencies(f.value, f.hud.record, f.source), []);
  const combined = { ...base, hud2d: resolved.hud2d, requiredCapabilities: [...base.requiredCapabilities, 'scene.hud2d'], camera2d: { retained: true } };
  assert.deepEqual(plan(combined).document, f.value); const stripped = strip(combined); assert.equal(Object.hasOwn(stripped, 'hud2d'), false); assert.deepEqual(stripped.camera2d, { retained: true });
  delete stripped.camera2d; assert.deepEqual(stripped, base); assert.ok(Object.isFrozen(plan(combined).document.elements));
  const invalidPlan = structuredClone(combined); invalidPlan.requiredCapabilities = base.requiredCapabilities; invalid(() => plan(invalidPlan));
});
test('HUD dependencies reject wrong slots, duplicate forward/reverse links, unavailable scene and wrong owner', async () => {
  for (const change of [f => { f.hud.record.relations[0].slot = 'wrong'; }, f => f.hud.record.relations.push({ ...f.hud.record.relations[0] }),
    f => { f.scene.record.relations.find(row => row.slot === 'hud2d').targetId = hudId(777); }, f => f.scene.record.relations.push({ kind: 'references', slot: 'hud2d', targetId: f.hud.record.id }),
    f => { f.scene.content = null; }, f => { f.value.sceneObjectId = hudId(777); }]) {
    const f = await sceneHUD2DFixture({ enabled: true }); change(f); assert.ok(dependencies(f.value, f.hud.record, f.source).length > 0);
  }
});
test('no-HUD discovery preserves legacy foreign-realm and minimal source DTOs without unrelated getter reads', () => {
  const source = vm.runInNewContext(`({documents:[{record:{id:'${hudId(1)}'}}]})`); assert.equal(resolve({ source }, { scene: { objectId: hudId(1) } }).ok, true);
  let calls = 0; Object.defineProperty(source.documents[0], 'content', { get() { calls++; return 'not relevant'; } });
  assert.deepEqual(resolve({ source }, { scene: { objectId: hudId(1) } }), { ok: true, hud2d: null, diagnostics: [] }); assert.equal(calls, 0);
});

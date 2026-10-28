import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveScene2DModel } from '../../engine/scene-model.mjs';
import { BEVY_EXECUTION_ADAPTER as bevy } from '../backends/bevy-adapter.mjs';
import { generateBevyRustProject } from '../backends/bevy-rust-project.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';

const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v2.json', import.meta.url), 'utf8'));
const legacy = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v1.json', import.meta.url), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const app = fileURLToPath(new URL('../../', import.meta.url));
const tool = process.env.VIENTO_BEVY_BIN;
const goodTitles = ['中文・日本語 — Cafe\u0301 🦊', '界'.repeat(158) + '🦊'];
const badTitles = ['\ud800', '\udc00', '🦊\ud800', '\udc00🦊'];
function plan() {
  const value = structuredClone(fixture.plan);
  value.resources = [];
  value.requiredCapabilities = value.requiredCapabilities.filter(item => item !== 'image');
  value.actors.forEach(actor => { delete actor.imageResourceId; });
  return value;
}
function rustPlan() {
  const value = plan(); value.schemaVersion = 3;
  value.requiredCapabilities = ['scene2d', 'input.arrows', 'state.movement', 'behavior.bindings', 'behavior.rust'];
  const sourceId = '99999999-9999-4999-8999-999999999999';
  const script = 'use crate::runtime::BehaviorContext;\npub fn ready(_: &mut BehaviorContext) -> Result<(), String> { Ok(()) }\n';
  const manifest = { objectId: '88888888-8888-4888-8888-888888888888', sourcePath: 'documents/behaviors.json', sourceRevision: `sha256:${hash('{}')}` };
  const actor = value.actors[0];
  value.behaviors = { format: 'viento-behavior-plan', schemaVersion: 1, backendId: 'org.viento.bevy-rust', language: 'rust', manifest,
    sources: [{ objectId: sourceId, sourcePath: 'documents/behavior.txt', sourceRevision: `sha256:${hash(script)}`, language: 'rust', content: script }],
    bindings: [{ bindingId: '77777777-7777-4777-8777-777777777777', instanceId: actor.instanceId, objectId: actor.objectId,
      implementation: { backendId: 'org.viento.bevy-rust', language: 'rust', sourceObjectId: sourceId },
      parameters: { label: 'e\u0301 日本語 🦊' }, events: [], declaration: { ...manifest, propertyPath: '/bindings/0' } }] };
  return value;
}
function observedWithTitle(title) {
  const observed = structuredClone(legacy.observed), document = observed.source.documents.find(item => item.record.id === legacy.ids.scene);
  const scene = JSON.parse(document.content.replace(/^\uFEFF/, '')); scene.title = title;
  document.content = JSON.stringify(scene, null, 2) + '\n'; document.sourceRevision = `sha256:${hash(document.content)}`;
  return { observed, document };
}
test('scene title Unicode errors point to source without changing registration or author bytes', () => {
  for (const title of badTitles) {
    const { observed, document } = observedWithTitle(title), before = structuredClone(observed);
    const result = resolveScene2DModel(observed, legacy.ids.scene);
    assert.equal(result.ok, false);
    const issue = result.diagnostics.find(item => item.code === 'build_scene_title_unicode' && item.propertyPath === '/title');
    assert.ok(issue, JSON.stringify(result.diagnostics)); assert.match(issue.message, /unpaired Unicode surrogate/);
    assert.equal(issue.sourcePath, document.sourcePath); assert.equal(issue.sourceRange.exact, true);
    assert.equal(JSON.parse(document.content.slice(issue.sourceRange.start, issue.sourceRange.end)), title);
    assert.equal(resolveScene2DModel(observed, legacy.ids.scene, { mode: 'registration' }).ok, true);
    assert.deepEqual(observed, before);
  }
  for (const title of goodTitles) {
    const { observed } = observedWithTitle(title), result = resolveScene2DModel(observed, legacy.ids.scene);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics)); assert.equal(result.model.scene.title, title);
  }
  const { observed } = observedWithTitle('界'.repeat(159) + '🦊');
  assert.ok(resolveScene2DModel(observed, legacy.ids.scene).diagnostics.some(item => item.propertyPath === '/title'));
});

test('both Bevy DTO generators reject lone surrogates but preserve valid multilingual text and parameters', async () => {
  for (const title of badTitles) {
    const scene = plan(), rust = rustPlan(); scene.scene.title = title; rust.scene.title = title;
    await assert.rejects(bevy.generate(scene), { errorCode: 'build_backend_plan_invalid', message: /unpaired Unicode surrogate/ });
    await assert.rejects(generateBevyRustProject(rust), { errorCode: 'build_behavior_invalid', message: /unpaired Unicode surrogate/ });
    assert.equal(scene.scene.title, title); assert.equal(rust.scene.title, title);
  }
  for (const title of goodTitles) {
    const scene = plan(), rust = rustPlan(); scene.scene.title = title; rust.scene.title = title;
    const [a, b] = await Promise.all([bevy.generate(scene), generateBevyRustProject(rust)]);
    assert.equal(JSON.parse(a.files.get('scene-data.json')).scene.title, title);
    const dto = JSON.parse(b.files.get('scene-data.json')); assert.equal(dto.scene.title, title);
    assert.equal(dto.bindings[0].parameters.label, 'e\u0301 日本語 🦊');
  }
});

test('real Bevy rejects invalid author title before output and builds a valid multilingual title', { skip: !tool || process.platform !== 'linux', timeout: 60000 }, async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-bevy-unicode-test-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'workspace'); await fs.cp(path.join(app, 'examples/bevy-headless'), root, { recursive: true });
  const file = path.join(root, 'documents/scenes/demo.json'), source = JSON.parse(await fs.readFile(file, 'utf8'));
  source.title = 'broken \ud800 title'; await fs.writeFile(file, JSON.stringify(source, null, 2) + '\n');
  const before = await fs.readFile(file), output = path.join(temporary, 'output');
  const options = { root, scene: sceneId, backendId: 'org.viento.bevy', tool, output };
  const rejected = await buildProject(options); assert.equal(rejected.status, 'rejected');
  const diagnostic = rejected.diagnostics.find(item => item.propertyPath === '/title');
  assert.ok(diagnostic, JSON.stringify(rejected)); assert.match(diagnostic.message, /unpaired Unicode surrogate/);
  await assert.rejects(fs.lstat(output), { code: 'ENOENT' }); assert.deepEqual(await fs.readFile(file), before);
  source.title = goodTitles[1]; await fs.writeFile(file, JSON.stringify(source, null, 2) + '\n');
  const valid = await buildProject(options); assert.equal(valid.ok, true, JSON.stringify(valid));
  const dto = JSON.parse(await fs.readFile(path.join(output, 'project/scene-data.json'), 'utf8'));
  assert.equal(dto.scene.title, source.title);
});

import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { createProjectAnimationStateCatalog } from '../../engine/project-animation-states.mjs';
import { DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT } from '../../engine/animation-state-script-source.mjs';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
const tool = process.env.VIENTO_GODOT_BIN;
const identify = async () => ({ version: 'fixture', sha256: '1'.repeat(64), platform: 'linux', arch: 'x64' });
async function fixture(t, value = 'WRONG') {
  const f = await projectAnimationClipsAuthor(t);
  await f.script('checkpoint', DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT);
  await f.edit('documents/behaviors/demo.json', document => { document.bindings[0].parameters = { clip_idle: value }; });
  const file = path.join(f.author, 'documents/behaviors/demo.json'), content = await fs.readFile(file, 'utf8');
  return { ...f, file, content, value };
}
function check(result, f) {
  assert.equal(result.ok, false); assert.equal(result.status, 'failed'); assert.equal(result.buildDirectory, undefined);
  assert.equal(result.diagnostics.length, 1); const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.code, 'build_animation_state_parameters_invalid');
  assert.equal(diagnostic.sourcePath, 'documents/behaviors/demo.json'); assert.equal(diagnostic.objectId, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  assert.equal(diagnostic.sourceRevision, 'sha256:' + buildHash(f.content)); assert.equal(diagnostic.bindingId, f.bindingId);
  assert.equal(diagnostic.instanceId, f.instanceId); assert.equal(diagnostic.parameter, 'clip_idle'); assert.equal(diagnostic.propertyPath, '/bindings/0/parameters/clip_idle');
  assert.equal(diagnostic.sourceRange.encoding, 'utf-16');
  assert.equal(JSON.parse(f.content.slice(diagnostic.sourceRange.start, diagnostic.sourceRange.end)), f.value);
}
test('build rejects typed or malformed state clips before output creation and retains exact frozen parameter ranges', async t => {
  for (const value of ['WRONG', true, 42]) {
    const f = await fixture(t, value), backendRegistry = createExecutionBackendRegistry([{ ...adapter, identify }]);
    const result = await buildProject({ root: f.author, targetId: f.assemblyId, backendRegistry }); check(result, f);
    assert.equal(await fs.readFile(f.file, 'utf8'), f.content);
  }
});
test('build diagnostic ignores error-supplied paths/ranges and mutable author edits after capture', async t => {
  const f = await fixture(t), backendRegistry = createExecutionBackendRegistry([{ ...adapter, identify,
    generate: async plan => { try { createProjectAnimationStateCatalog(plan); } catch (error) {
      error.sourcePath = '/tmp/not-author.json'; error.propertyPath = '/invented'; error.sourceRevision = 'sha256:' + 'f'.repeat(64);
      error.sourceRange = { start: 0, end: 1, encoding: 'utf-16' }; throw error;
    } throw new Error('Expected invalid state parameter.'); },
  }]);
  const result = await buildProject({ root: f.author, targetId: f.assemblyId, backendRegistry,
    onProgress: event => { if (event.phase === 'generate') writeFileSync(f.file, '{"changed":"after frozen capture"}\n'); } });
  check(result, f); assert.notEqual(await fs.readFile(f.file, 'utf8'), f.content);
});
test('real Godot tool identification plus build generation reports invalid clip at its author field', { skip: !tool ? 'Set VIENTO_GODOT_BIN for real build validation' : false }, async t => {
  const f = await fixture(t), result = await buildProject({ root: f.author, targetId: f.assemblyId, tool }); check(result, f);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.content);
});

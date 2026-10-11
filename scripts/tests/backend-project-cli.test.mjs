import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildProject } from '../adapters/node-project-build.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { runProjectBuildCommand } from '../project-build.mjs';
import { createRuntimeCaseDocumentService } from '../lib/runtime-case-documents.mjs';
import { createRuntimeCaseSuiteDocumentService } from '../lib/runtime-case-suites.mjs';
import { BEVY_RUNTIME_IDENTITY } from '../backends/bevy-project.mjs';
import { BACKEND_PROJECT_MANIFEST_FILE } from '../adapters/node-backend-project.mjs';
import { validateBackendProjectManifest } from '../../engine/backend-project.mjs';

const app = fileURLToPath(new URL('../../', import.meta.url));
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', backendId = 'org.viento.bevy';
const linux = { skip: process.platform !== 'linux', timeout: 30000 };

async function environment(values, operation) {
  const original = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    return await operation();
  } finally {
    for (const [key, value] of Object.entries(original)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-backend-cli-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'source'), output = path.join(temporary, 'build'), calls = path.join(temporary, 'calls.jsonl');
  await fs.cp(path.join(app, 'examples/bevy-headless'), root, { recursive: true });
  const tool = path.join(temporary, 'tool ; literal $(never-execute)');
  // This bounded executable records actual CLI selection and fixed protocol
  // frames. It does not simulate movement or certify the real Bevy runtime.
  await fs.writeFile(tool, `#!${process.execPath}
const fs = require('node:fs'), args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args)+'\\n');
if (args[0] === '--version') console.log(${JSON.stringify(BEVY_RUNTIME_IDENTITY)});
else {
  const scene = JSON.parse(fs.readFileSync(args[args.indexOf('--scene')+1]));
  if (!args.includes('--check')) {
    const actors = scene.actors.map(actor => ({instanceId:actor.instanceId,objectId:actor.objectId,position:actor.position,state:'idle'}));
    console.log('VIENTO_RUNTIME:'+JSON.stringify({protocol:scene.schemaVersion,event:'ready',sceneObjectId:scene.scene.objectId,actors}));
    let fixedDelta = 0.25;
    if (args.includes('--control-program')) {
      const program = JSON.parse(fs.readFileSync(args[args.indexOf('--control-program')+1])); fixedDelta = program.fixedDelta;
      program.steps.forEach((_,stepIndex) => console.log('VIENTO_TRACE:'+JSON.stringify({format:'viento-runtime-trace',schemaVersion:1,protocolVersion:scene.schemaVersion,event:'sample',stepIndex,actors})));
    }
    console.log('VIENTO_RUNTIME:'+JSON.stringify({protocol:scene.schemaVersion,event:'finished',actors,fixedDelta}));
  }
}
`, { mode: 0o700 });
  const built = await buildProject({ root, scene: sceneId, backendId, tool, output });
  assert.equal(built.ok, true, JSON.stringify(built));
  return { temporary, root, output, tool, calls, built,
    env: { VIENTO_EXECUTION_BACKEND: undefined, VIENTO_BEVY_BIN: tool, VIENTO_GODOT_BIN: path.join(temporary, 'missing-godot'), XDG_CACHE_HOME: path.join(temporary, 'cache') } };
}

async function inventory(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name); result[path.relative(root, file)] = buildHash(await fs.readFile(file));
  }
  return result;
}
const inspect = (h, extra = []) => runProjectBuildCommand(['--command', 'inspect', '--build', h.output, ...extra]);
const callBytes = h => fs.readFile(h.calls, 'utf8');

test('CLI infers the frozen Bevy backend and its separate environment tool while author source is offline', linux, async t => {
  const h = await fixture(t), before = await inventory(h.root);
  await fs.rename(h.root, h.root + '-offline');
  const result = await environment(h.env, () => runProjectBuildCommand(['--command', 'run', '--build', h.output]));
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.record.backendId, backendId);
  assert.equal(result.record.tool.sha256, h.built.record.tool.sha256);
  assert.deepEqual(result.record.events.map(item => item.event), ['ready', 'finished']);
  assert.deepEqual(await inventory(h.root + '-offline'), before);
});

test('CLI infers the same backend tool for suite members without changing saved author documents', linux, async t => {
  const h = await fixture(t), author = createRuntimeCaseDocumentService(h.root), groups = createRuntimeCaseSuiteDocumentService(h.root);
  const scene = JSON.parse(await fs.readFile(path.join(h.root, 'documents/scenes/demo.json'))), actor = scene.actors[0];
  const definition = { format: 'viento-runtime-case', schemaVersion: 1,
    program: { format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: 0.125, steps: [{ inputs: [] }] },
    checks: [{ instanceId: actor.instanceId, stepIndex: 0, position: { value: actor.position, tolerance: 0 }, state: 'idle' }] };
  const catalog = await author.list(sceneId);
  const member = await author.save({ sceneId, sceneVersion: catalog.sceneVersion, sourcePath: 'documents/runtime-cases/idle.json',
    documentType: catalog.defaults.documentType, content: JSON.stringify({ format: 'viento-runtime-case-document', schemaVersion: 1, sceneObjectId: sceneId, case: definition }) });
  const groupCatalog = await groups.list(sceneId);
  const group = await groups.save({ sceneId, sceneVersion: groupCatalog.sceneVersion, sourcePath: 'documents/runtime-suites/idle.json',
    documentType: groupCatalog.defaults.documentType, content: JSON.stringify({ format: 'viento-runtime-case-suite', schemaVersion: 1, sceneObjectId: sceneId, documentIds: [member.id] }) });
  const before = await inventory(h.root);
  const result = await environment(h.env, () => runProjectBuildCommand(['--command', 'run', '--root', h.root, '--build', h.output, '--runtime-suite', group.id]));
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.record.backendId, backendId);
  assert.deepEqual(result.record.suite.entries.map(item => item.state), ['passed']);
  assert.deepEqual(await inventory(h.root), before);
});

test('CLI keeps explicit tool selection and refuses explicit foreign backend and Godot-only alias before a tool starts', linux, async t => {
  const h = await fixture(t), before = await callBytes(h), args = ['--command', 'run', '--build', h.output];
  await environment(h.env, async () => {
    const foreign = await runProjectBuildCommand([...args, '--backend', 'org.viento.godot4']);
    assert.equal(foreign.ok, false); assert.equal(foreign.diagnostics[0].code, 'runtime_backend_changed');
    await assert.rejects(runProjectBuildCommand([...args, '--godot', h.tool]), /Godot-only/);
    assert.equal(await callBytes(h), before);
    const result = await environment({ VIENTO_BEVY_BIN: path.join(h.temporary, 'missing-bevy') }, () => runProjectBuildCommand([...args, '--tool', h.tool]));
    assert.equal(result.ok, true, JSON.stringify(result));
  });
});

test('CLI inspection is source-independent and ignores host backend/tool configuration without executing anything', linux, async t => {
  const h = await fixture(t), before = await inventory(h.output), calls = await callBytes(h);
  await fs.rename(h.root, h.root + '-offline');
  const result = await environment({ VIENTO_EXECUTION_BACKEND: 'org.viento.unregistered', VIENTO_BEVY_BIN: '/missing', VIENTO_GODOT_BIN: '/missing' }, () => inspect(h));
  assert.equal(result.ok, true); assert.equal(result.project.source.sceneId, sceneId);
  assert.equal(result.project.source.workspaceId, '11111111-1111-4111-8111-111111111116');
  assert.equal(result.project.project.entry, 'project/scene-data.json');
  assert.equal(result.inspection.recorded, true); assert.equal(result.inspection.complete, true);
  assert.deepEqual(result.project.files.map(item => item.path), ['project/scene-data.json']);
  assert.deepEqual(await runProjectBuildCommand(['--command', 'inspect', '--build', path.relative(process.cwd(), h.output)]), result);
  assert.deepEqual(await inventory(h.output), before); assert.equal(await callBytes(h), calls);
});

test('CLI inspection rejects execution/source/output flags and a foreign requested backend without altering output', linux, async t => {
  const h = await fixture(t), before = await inventory(h.output), calls = await callBytes(h);
  const forbidden = [['--root', h.root], ['--scene', sceneId], ['--output', path.join(h.temporary, 'new-output')],
    ['--tool', h.tool], ['--godot', h.tool], ['--timeout-ms', '1'], ['--window'], ['--interactive'], ['--capture'],
    ['--control-program', '/missing'], ['--runtime-case', '/missing'], ['--runtime-suite', '/missing']];
  for (const extra of forbidden) await assert.rejects(inspect(h, extra), { errorCode: 'build_request_invalid' });
  await assert.rejects(runProjectBuildCommand(['--command', 'inspect']), { errorCode: 'build_request_invalid' });
  await assert.rejects(inspect(h, ['--backend', 'org.viento.godot4']));
  assert.deepEqual(await inventory(h.output), before); assert.equal(await callBytes(h), calls);
});

test('CLI inspection distinguishes extra manual files from changed registered artifacts and metadata bytes', linux, async t => {
  const h = await fixture(t), calls = await callBytes(h), extraFile = path.join(h.output, 'project/manual.txt');
  await fs.writeFile(extraFile, 'manual author note\n');
  const withExtra = await inventory(h.output), result = await inspect(h);
  assert.equal(result.ok, true); assert.equal(result.inspection.complete, false);
  assert.ok(result.inspection.extraPaths.some(item => item.path === 'project/manual.txt' && item.kind === 'file'));
  assert.deepEqual(await inventory(h.output), withExtra);
  await fs.rm(extraFile);
  for (const relative of ['project/scene-data.json', 'source-map.json', 'snapshot.json', 'build.json']) {
    const file = path.join(h.output, relative), bytes = await fs.readFile(file);
    await fs.appendFile(file, ' ');
    const changed = await inventory(h.output);
    await assert.rejects(inspect(h), error => ['backend_project_changed', 'backend_project_invalid'].includes(error.errorCode), relative);
    assert.deepEqual(await inventory(h.output), changed, relative); await fs.writeFile(file, bytes);
  }
  assert.equal(await callBytes(h), calls);
});

test('CLI inspection never follows a substituted registered artifact symlink and preserves the link and outside target', linux, async t => {
  const h = await fixture(t), file = path.join(h.output, 'project/scene-data.json'), outside = path.join(h.temporary, 'outside.json');
  const bytes = await fs.readFile(file), calls = await callBytes(h);
  await fs.writeFile(outside, bytes); await fs.rm(file); await fs.symlink(outside, file);
  await assert.rejects(inspect(h));
  assert.ok((await fs.lstat(file)).isSymbolicLink()); assert.deepEqual(await fs.readFile(outside), bytes);
  assert.equal(await callBytes(h), calls);
});

test('CLI inspection reports completed runtime sessions as extra ownership scope without rewriting receipts or invoking the tool', linux, async t => {
  const h = await fixture(t);
  assert.equal((await environment(h.env, () => runProjectBuildCommand(['--command', 'run', '--build', h.output]))).ok, true);
  const before = await inventory(h.output), calls = await callBytes(h), result = await inspect(h);
  assert.equal(result.ok, true); assert.equal(result.inspection.complete, false);
  assert.ok(result.inspection.extraPaths.some(item => item.path === 'sessions' && item.kind === 'directory'));
  assert.deepEqual(await inventory(h.output), before); assert.equal(await callBytes(h), calls);
});

test('CLI backend inference preserves missing frozen run diagnostics and cancellation without invoking a tool or writing output', linux, async t => {
  const h = await fixture(t), calls = await callBytes(h), before = await inventory(h.temporary);
  const args = ['--command', 'run', '--build', path.join(h.temporary, 'missing-build')];
  const missing = await environment(h.env, () => runProjectBuildCommand(args));
  assert.equal(missing.ok, false); assert.equal(missing.status, 'failed'); assert.equal(missing.record, undefined);
  const controller = new AbortController(); controller.abort();
  const cancelled = await environment(h.env, () => runProjectBuildCommand(args, { signal: controller.signal }));
  assert.equal(cancelled.ok, false); assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.diagnostics[0].code, 'runtime_cancelled');
  assert.equal(await callBytes(h), calls); assert.deepEqual(await inventory(h.temporary), before);
});

test('CLI inspection derives legacy manifests without adopting or repairing old output and rejects changed legacy source maps', linux, async t => {
  const h = await fixture(t), calls = await callBytes(h), manifest = path.join(h.output, BACKEND_PROJECT_MANIFEST_FILE);
  await fs.rm(manifest); await fs.rename(h.root, h.root + '-offline');
  const before = await inventory(h.output), result = await inspect(h);
  assert.equal(result.ok, true); assert.equal(result.inspection.recorded, false);
  assert.equal(result.inspection.manifestSha256, null); assert.equal(result.inspection.complete, true);
  assert.equal(result.project.buildId, h.built.record.buildId);
  assert.deepEqual(await inventory(h.output), before); await assert.rejects(fs.stat(manifest), { code: 'ENOENT' });
  const file = path.join(h.output, 'source-map.json'), value = JSON.parse(await fs.readFile(file));
  value.objects[0].sourcePath = 'documents/forged.json'; await fs.writeFile(file, JSON.stringify(value));
  const changed = await inventory(h.output);
  await assert.rejects(inspect(h), error => ['backend_project_changed', 'backend_project_invalid'].includes(error.errorCode));
  assert.deepEqual(await inventory(h.output), changed); assert.equal(await callBytes(h), calls);
});

test('CLI portable manifest distinguishes logical audit names from generated filesystem authority', linux, async t => {
  const h = await fixture(t), sourcePath = 'documents/scenes/old:scene\nname.json';
  const calls = await callBytes(h), artifactBefore = await inventory(h.output), result = await inspect(h);
  const model = structuredClone(result.project);
  model.source.sourcePath = sourcePath; model.dependencies.find(item => item.role === 'scene').sourcePath = sourcePath;
  // Audit data can describe legacy names; this does not expand current author
  // registration or the Scene2D planner's separate path admission rules.
  const validated = validateBackendProjectManifest(model);
  assert.equal(validated.source.sourcePath, sourcePath);
  assert.ok(validated.dependencies.some(item => item.sourcePath === sourcePath));
  assert.deepEqual(validated.files.map(item => item.path), ['project/scene-data.json']);
  model.files[0].path = 'project/forged:entry.json'; model.project.entry = model.files[0].path;
  assert.throws(() => validateBackendProjectManifest(model), { errorCode: 'backend_project_invalid' });
  assert.deepEqual(await inventory(h.output), artifactBefore);
  assert.equal(await callBytes(h), calls);
});

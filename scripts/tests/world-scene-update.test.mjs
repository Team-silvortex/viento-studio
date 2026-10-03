import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import { prepareSceneUpdate, updateSceneContent, appendSceneDependencies } from '../../engine/world-scene-update.mjs';
import { worldMutationDescriptors } from '../../engine/world-command-contract.mjs';
import { createScene2DPlan } from '../../engine/build-plan.mjs';
import { getProjectionTemplates, lockProjectionTemplate } from '../../engine/object-projection.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldProjection, readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { recoverWorldTransaction } from '../lib/world-transactions.mjs';
import { readTransactionStatus, transactionHash } from '../lib/world-transaction-state.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { runWorldQuery } from '../world.mjs';
import { runCommand } from '../lib/process.mjs';
import { fixture, write, serve, request } from './helpers.mjs';

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const imageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', objectId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const image2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', projectedId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const recordPath = `metadata/documents/${objectId}.json`, journal = '.viento/world-transactions';
const json = value => JSON.stringify(value, null, 2) + '\n';
const digest = value => transactionHash(value).slice(7), parse = source => JSON.parse(source.replace(/^\uFEFF/, ''));
const actor = (id = actorId) => ({ objectId: id, position: [200, 220], size: [80, 80], color: '#ffffff', speed: 160, controls: 'arrows', imageResourceId: imageId });
const scene = () => ({ format: 'viento-scene2d', schemaVersion: 1, title: '旅人场景', viewport: [800, 480], background: '#0d1829', actors: [actor()] });
async function materialize(t, version = 3, root) {
  if (!root) { root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-update-')); t.after(() => fs.rm(root, { recursive: true, force: true })); }
  const frozen = JSON.parse(await fs.readFile(new URL(`fixtures/predecessor/v${version}.json`, import.meta.url)));
  for (const [name, content] of Object.entries(frozen.files)) await write(root, name, content);
  const image = JSON.parse(frozen.files[`metadata/assets/${imageId}.json`]);
  await write(root, `metadata/assets/${image2}.json`, json({ ...image, id: image2, name: 'replacement.svg', location: { ...image.location, path: 'replacement.svg' }, legacyPaths: [] }));
  await write(root, 'assets/replacement.svg', frozen.files['assets/reference.svg']);
  const sourcePath = `${version === 3 ? 'documents' : 'design-data'}/scenes/edit.json`, value = scene();
  const sourceContent = '\uFEFF' + json(value).replace('"title": "旅人场景"', '"title": "\\u65c5人场景"').replace('"speed": 160', '"speed": 1.6e2').replaceAll('\n', '\r\n');
  const execute = createWorldCommandService(root), view = await readWorldProjection(root);
  await execute({ command: 'scene.create', mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
    actorRef: { kind: 'tool', id: 'scene-update-test' }, objectId, documentType: 'character', sourcePath, content: sourceContent });
  const record = await fs.readFile(path.join(root, recordPath), 'utf8');
  const recordContent = record.replace('"version": 1,', '"version": 1,\n  "extensions": { "large": 900719925474099312345, "literal": "\\u65c5" },').replaceAll('\n', '\r\n');
  await write(root, recordPath, recordContent);
  const f = { root, execute, value, sourcePath, sourceContent, recordContent, files: [sourcePath, recordPath], actorPath: frozen.sourcePath };
  f.candidate = { ...value, title: '旅人 · 更新', viewport: [1024, 720], background: '#ff0000', actors: [{ ...actor(), position: [300, 240], imageResourceId: image2 }, { ...actor(otherId), controls: 'none', imageResourceId: image2 }] };
  f.input = await updateRequest(f, f.candidate); return f;
}
async function updateRequest(f, candidate) {
  const view = await readWorldProjection(f.root), object = view.objects.find(item => item.id === objectId);
  return { command: 'scene.update', mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
    actorRef: { kind: 'tool', id: 'scene-update-test' }, objectId, objectRevision: object.revision,
    sourceRevision: object.documentRefs[0].sourceRevision, content: json(candidate) };
}
async function fingerprint(root) {
  const result = {};
  async function walk(dir, prefix = '') {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`, file = path.join(dir, entry.name);
      if (name === '.viento/registry.lock') continue;
      if (entry.isDirectory()) await walk(file, `${name}/`); else result[name] = transactionHash(await fs.readFile(file));
    }
  }
  await walk(root); return result;
}
async function contents(f) { return Promise.all(f.files.map(file => fs.readFile(path.join(f.root, file), 'utf8'))); }
async function crash(f, point, index = '-', recovery = false) {
  const input = path.join(f.root, '.request.json'); await fs.writeFile(input, json(f.input));
  const child = fork(new URL('./world-transaction-crash-worker.mjs', import.meta.url), [f.root, recovery ? 'recover' : input, point, String(index)], { silent: true, execArgv: [] });
  let stderr = '', timeout; child.stderr.on('data', chunk => { stderr += chunk; }); const exited = once(child, 'exit');
  try {
    const event = await Promise.race([once(child, 'message').then(([value]) => value), exited.then(() => { throw new Error(`Worker exited: ${stderr}`); }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Worker timeout: ${stderr}`)), 15000); })]);
    assert.equal(event.stage, point);
  } finally { clearTimeout(timeout); child.kill('SIGKILL'); await exited; await fs.rm(input, { force: true }); }
}

for (const version of [2, 3]) test(`scene.update v${version} previews exact bytes, preserves identity and appends deduplicated dependencies`, async t => {
  const f = await materialize(t, version), before = await fingerprint(f.root), snapshot = await readWorldSnapshot(f.root), frozen = json(snapshot);
  const plan = await prepareSceneUpdate(snapshot.source, snapshot.projection, f.recordContent, { ...f.input, mode: 'preview' }, { digest });
  assert.equal(json(snapshot), frozen); assert.deepEqual(plan.result, await f.execute({ ...f.input, mode: 'preview' }));
  assert.deepEqual(await fingerprint(f.root), before); assert.equal(plan.plans.length, 2);
  const source = plan.plans[0].afterContent, metadata = appendSceneDependencies(f.recordContent, f.candidate);
  assert.equal(plan.result.changes[0].afterText, source); assert.deepEqual(parse(source), f.candidate);
  assert.equal(source.startsWith('\uFEFF'), true); assert.equal(/(?<!\r)\n/.test(source), false); assert.match(source, /"speed": 1\.6e2/);
  assert.equal(metadata.afterContent, plan.plans[1].afterContent); assert.match(metadata.afterContent, /900719925474099312345/);
  assert.deepEqual(metadata.after.relations.map(item => item.targetId), [actorId, otherId]);
  assert.deepEqual(metadata.after.assetBindings.map(item => item.assetId), [imageId, image2]);
  const descriptor = worldMutationDescriptors().find(item => item.id === 'scene.update'), ajv = new Ajv();
  for (const [name, value] of [['object', plan.result.object], ['command-descriptor', descriptor], ['changeset', plan.result.proposal]]) {
    const validate = ajv.compile(JSON.parse(await fs.readFile(new URL(`../../schemas/${name}-v1.schema.json`, import.meta.url))));
    assert.equal(validate(value), true, json(validate.errors));
  }
  const { command, ...args } = f.input; assert.equal(ajv.compile(descriptor.inputSchema)(args), true);
  assert.equal(ajv.compile(descriptor.outputSchema)(plan.result), true);
  const saved = await f.execute(f.input); assert.equal(saved.status, 'applied'); assert.deepEqual(await contents(f), [source, metadata.afterContent]);
  assert.equal((await readWorldProjection(f.root)).world.revision, saved.revision);
  const after = await fingerprint(f.root);
  for (const [file, hash] of Object.entries(before)) if (![...f.files, `${journal}/head.json`].includes(file)) assert.equal(after[file], hash, file);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
});

test('scene source transformation preserves uneven whitespace, escaped unchanged values and actor fragments through reorder/delete/add', () => {
  const value = scene(); value.actors.push({ ...actor(otherId), speed: 12 });
  const source = '\uFEFF' + JSON.stringify(value).replace(',"title"', ', \r\n\t"title"').replace('旅人场景', '\\u65c5人场景').replace('"speed":160', '"speed":1.6e2');
  const changed = { ...value, background: '#112233', actors: [value.actors[1], { ...value.actors[0], controls: 'none' }] };
  const edited = updateSceneContent(source, json(changed));
  assert.equal(edited.afterContent.includes(', \r\n\t"title"'), true); assert.match(edited.afterContent, /\\u65c5人场景/);
  assert.match(edited.afterContent, /"speed":1.6e2/); assert.deepEqual(parse(edited.afterContent), changed);
  const removed = { ...changed, actors: [{ ...changed.actors[0] }] }; delete removed.actors[0].imageResourceId;
  assert.deepEqual(parse(updateSceneContent(edited.afterContent, json(removed)).afterContent), removed);
  assert.equal(updateSceneContent(source, json(value)).afterContent, source);
});

test('scene.update no-op ignores candidate formatting; removing actors/images retains old registration dependencies', async t => {
  const f = await materialize(t), before = await fingerprint(f.root);
  assert.equal((await f.execute({ ...f.input, content: JSON.stringify(f.value) })).status, 'unchanged');
  assert.deepEqual(await fingerprint(f.root), before);
  await f.execute(f.input);
  const candidate = { ...f.candidate, actors: [{ ...f.candidate.actors[1] }] }; delete candidate.actors[0].imageResourceId;
  const result = await f.execute(await updateRequest(f, candidate)); assert.equal(result.status, 'applied');
  const record = (await readRegistry(f.root)).documents.find(item => item.id === objectId);
  assert.deepEqual(record.relations.map(item => item.targetId), [actorId, otherId]);
  assert.deepEqual(record.assetBindings.map(item => item.assetId), [imageId, image2]);
  const plan = createScene2DPlan(await readWorldSnapshot(f.root), objectId);
  assert.equal(plan.ok, true); assert.deepEqual(plan.plan.actors.map(item => item.objectId), [otherId]); assert.deepEqual(plan.plan.resources, []);
});

test('scene.update accepts existing scenes whose explicit images are bound only to their actor, including recovery', async t => {
  const f = await materialize(t), record = parse(f.recordContent);
  record.assetBindings = []; f.recordContent = json(record); await write(f.root, recordPath, f.recordContent);
  assert.equal(createScene2DPlan(await readWorldSnapshot(f.root), objectId).ok, true);
  const before = await fingerprint(f.root);
  assert.equal((await f.execute(await updateRequest(f, f.value))).status, 'unchanged');
  assert.deepEqual(await fingerprint(f.root), before);
  f.candidate = { ...f.value, title: 'Actor-owned image' }; f.input = await updateRequest(f, f.candidate);
  const preview = await f.execute({ ...f.input, mode: 'preview' });
  assert.equal(preview.changes[0].addedBindings.length, 1);
  await crash(f, 'data', 1); assert.equal((await recoverWorldTransaction(f.root)).status, 'rolled-back');
  assert.deepEqual(await contents(f), [f.sourceContent, f.recordContent]);
  assert.equal((await f.execute(f.input)).status, 'applied');
  assert.equal(createScene2DPlan(await readWorldSnapshot(f.root), objectId).ok, true);
});

test('scene.update validates declaration features, actor identity, ranges, dependencies and matching revisions without writes', async t => {
  const f = await materialize(t), before = await fingerprint(f.root);
  for (const mutate of [value => { value.format = 'other'; }, value => { value.schemaVersion = 2; }, value => { value.extra = 1; },
    value => { value.title = ''; }, value => { value.viewport = [63, 480]; }, value => { value.background = 'red'; },
    value => { value.actors = []; }, value => { value.actors.push(value.actors[0]); }, value => { value.actors[0].objectId = objectId; },
    value => { value.actors[0].objectId = imageId; }, value => { value.actors[0].speed = 2001; }, value => { value.actors[0].controls = 'custom'; },
    value => { value.actors[0].size = [0, 80]; }, value => { value.actors[0].position = [Infinity, 1]; }, value => { value.actors[0].imageResourceId = actorId; },
    value => { value.actors[0].useProjectionDefaults = 'yes'; }, value => { value.actors[0].extra = 1; }]) {
    const value = structuredClone(f.candidate); mutate(value);
    await assert.rejects(f.execute({ ...f.input, content: json(value) }), error => error.errorCode === 'world_scene_invalid');
  }
  for (const key of ['baseRevision', 'objectRevision', 'sourceRevision']) await assert.rejects(f.execute({ ...f.input, [key]: 'sha256:' + '0'.repeat(64) }), error => error.errorCode === 'world_revision_conflict');
  await assert.rejects(f.execute({ ...f.input, sourcePath: 'documents/other.json' }), error => error.errorCode === 'world_command_invalid');
  await assert.rejects(f.execute({ ...f.input, content: '{"format":"viento-scene2d","schemaVersion":1,"title":"a","title":"b"}' }), error => error.errorCode === 'world_scene_invalid');
  await assert.rejects(f.execute({ ...f.input, objectId: imageId }), error => error.errorCode === 'world_object_not_found');
  assert.deepEqual(await fingerprint(f.root), before);
});

async function addProjection(f) {
  const snapshot = getProjectionTemplates()[0], template = await lockProjectionTemplate(snapshot, { digest });
  const value = { format: 'viento-object-projection', schemaVersion: 1, title: 'Runtime projection', sourceObjectId: actorId,
    template, configuration: Object.fromEntries(snapshot.fields.map(field => [field.id, field.default])) };
  value.configuration.image = imageId;
  const view = await readWorldProjection(f.root), sourcePath = 'documents/projections/runtime.json';
  await f.execute({ command: 'projection.create', mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
    actorRef: { kind: 'tool', id: 'scene-update-test' }, objectId: projectedId, documentType: 'character', sourcePath, content: json(value) });
  return { value, sourcePath };
}
test('scene.update distinguishes inherited/explicit/absent values and null image suppression; repairs scene after actor source becomes invalid', async t => {
  const f = await materialize(t), projected = await addProjection(f);
  const candidate = { ...f.value, actors: [{ objectId: projectedId, position: [20, 30], useProjectionDefaults: true, speed: 400, imageResourceId: null }] };
  await f.execute(await updateRequest(f, candidate));
  let plan = createScene2DPlan(await readWorldSnapshot(f.root), objectId);
  assert.equal(plan.ok, true); assert.equal(plan.plan.actors[0].speed, 400); assert.equal(plan.plan.actors[0].imageResourceId, undefined);
  assert.equal(plan.plan.actors[0].fieldSources.speed.objectId, objectId);
  delete candidate.actors[0].speed; delete candidate.actors[0].imageResourceId;
  await f.execute(await updateRequest(f, candidate)); plan = createScene2DPlan(await readWorldSnapshot(f.root), objectId);
  assert.equal(plan.ok, true); assert.equal(plan.plan.actors[0].speed, projected.value.configuration.speed); assert.equal(plan.plan.actors[0].imageResourceId, imageId);
  assert.equal(plan.plan.actors[0].fieldSources.speed.objectId, projectedId);
  const explicit = { ...candidate, actors: [{ ...actor(projectedId), useProjectionDefaults: false }] };
  await f.execute(await updateRequest(f, explicit)); plan = createScene2DPlan(await readWorldSnapshot(f.root), objectId);
  assert.equal(plan.plan.actors[0].fieldSources.speed.objectId, objectId);
  // Registration remains valid even if a referenced projection body is broken.
  await write(f.root, projected.sourcePath, '{"format":"viento-object-projection","schemaVersion":1}');
  const brokenSource = await fs.readFile(path.join(f.root, projected.sourcePath), 'utf8');
  await f.execute(await updateRequest(f, f.value));
  assert.equal(await fs.readFile(path.join(f.root, projected.sourcePath), 'utf8'), brokenSource);
  assert.equal(createScene2DPlan(await readWorldSnapshot(f.root), objectId).ok, true);
});

for (const [point, index, committed] of [['intent', '-', false], ['source-ready', 0, false], ['data', 0, false], ['source-ready', 1, false], ['data', 1, false], ['commit', '-', true], ['head', '-', true]]) {
  test(`scene.update v8 SIGKILL ${point}/${index} restores exact ${committed ? 'after' : 'before'} source and registration`, async t => {
    const f = await materialize(t), preview = await f.execute({ ...f.input, mode: 'preview' }); await crash(f, point, index);
    const intent = JSON.parse(await fs.readFile(path.join(f.root, journal, 'active/intent.json')));
    assert.equal(intent.version, 8); assert.equal(intent.entries.length, 2); assert.ok(intent.entries.every(entry => entry.before));
    await assert.rejects(readWorldProjection(f.root), error => error.errorCode === 'world_recovery_required');
    assert.equal((await recoverWorldTransaction(f.root)).status, committed ? 'committed' : 'rolled-back');
    assert.deepEqual(await contents(f), committed ? [preview.changes[0].afterText, appendSceneDependencies(f.recordContent, f.candidate).afterContent] : [f.sourceContent, f.recordContent]);
    assert.equal((await readWorldProjection(f.root)).world.revision, committed ? preview.revision : f.input.baseRevision);
    assert.equal((await recoverWorldTransaction(f.root)).status, 'idle');
  });
}
test('v8 source-only edit still guards metadata and recovery is restartable in both directions', async t => {
  for (const committed of [false, true]) {
    const f = await materialize(t); f.candidate = { ...f.value, title: 'Title only' }; f.input = await updateRequest(f, f.candidate);
    await crash(f, committed ? 'commit' : 'data', committed ? '-' : 0);
    const intent = JSON.parse(await fs.readFile(path.join(f.root, journal, 'active/intent.json')));
    assert.equal(intent.entries[1].before, intent.entries[1].after);
    if (committed) await write(f.root, f.sourcePath, f.sourceContent);
    await crash(f, 'recovery-file', 0, true); await recoverWorldTransaction(f.root);
    assert.equal((await contents(f))[1], f.recordContent); assert.equal(parse((await contents(f))[0]).title, committed ? 'Title only' : f.value.title);
  }
});
test('v8 ignores external actor source edits, blocks external registry/source/own-record changes, and never overwrites them', async t => {
  for (const committed of [false, true]) {
    const f = await materialize(t); await crash(f, committed ? 'commit' : 'data', committed ? '-' : 1);
    await write(f.root, f.actorPath, '# Author edited actor after crash\n');
    assert.equal((await recoverWorldTransaction(f.root)).status, committed ? 'committed' : 'rolled-back');
    assert.equal(await fs.readFile(path.join(f.root, f.actorPath), 'utf8'), '# Author edited actor after crash\n');
  }
  for (const name of ['registry', 'source', 'record']) {
    const f = await materialize(t); await crash(f, 'data', 0);
    const target = name === 'registry' ? `metadata/assets/${image2}.json` : name === 'source' ? f.sourcePath : recordPath;
    if (name === 'registry') { const value = parse(await fs.readFile(path.join(f.root, target), 'utf8')); value.name = 'External'; await write(f.root, target, json(value)); }
    else await fs.appendFile(path.join(f.root, target), '\n');
    const before = await fingerprint(f.root); await assert.rejects(recoverWorldTransaction(f.root), error => error.errorCode === 'world_recovery_conflict');
    assert.deepEqual(await fingerprint(f.root), before);
  }
});
for (const kind of ['format', 'unknown-feature', 'formatting', 'extra-binding', 'removed-relation', 'extension', 'identity', 'missing-entry', 'downgrade-v7', 'downgrade-v5', 'downgrade-v1']) {
  test(`v8 rejects forged journal ${kind} before recovery publishes bytes`, async t => {
    const f = await materialize(t); await crash(f, 'intent');
    const location = path.join(f.root, journal, 'active'), intent = parse(await fs.readFile(path.join(location, 'intent.json'), 'utf8'));
    let source = await fs.readFile(path.join(location, '0.after'), 'utf8'), record = await fs.readFile(path.join(location, '1.after'), 'utf8');
    if (kind === 'format') source = source.replace('viento-scene2d', 'viento-object-projection');
    if (kind === 'unknown-feature') { const value = parse(source); value.script = 'execute'; source = updateSceneContent(f.sourceContent, json(value)).afterContent; }
    if (kind === 'formatting') source = json(parse(source));
    if (kind === 'extra-binding') { const value = parse(record); value.assetBindings.push({ assetId: image2, role: 'forged' }); record = json(value); }
    if (kind === 'removed-relation') { const value = parse(record); value.relations.shift(); record = json(value); }
    if (kind === 'extension') record = record.replace('900719925474099312345', '900719925474099312346');
    if (kind === 'identity') { const value = parse(record); value.documentType = 'story'; record = json(value); }
    await fs.writeFile(path.join(location, '0.after'), source); intent.entries[0].after = transactionHash(source);
    await fs.writeFile(path.join(location, '1.after'), record); intent.entries[1].after = transactionHash(record);
    if (kind === 'missing-entry') intent.entries.pop();
    if (kind.startsWith('downgrade-v')) intent.version = Number(kind.slice('downgrade-v'.length));
    await fs.writeFile(path.join(location, 'intent.json'), json(intent));
    const before = await fingerprint(f.root); await assert.rejects(recoverWorldTransaction(f.root), error => error.errorCode === 'world_journal_invalid');
    assert.deepEqual(await fingerprint(f.root), before); assert.equal((await readTransactionStatus(f.root)).pending, true);
  });
}
test('scene.update HTTP auth, CLI preview, diagnostics and no-op use one contract', async t => {
  const root = await fixture(t), f = await materialize(t, 3, root), base = await serve(t, root, { DOC_API_TOKEN: 'scene-token', DOC_API_REQUIRE_WRITE_AUTH: '1' });
  assert.ok((await request(base, '/api/capabilities')).data.semanticCommands.includes('scene.update'));
  assert.equal((await request(base, '/api/world/commands', f.input)).status, 401);
  const send = async input => { const response = await fetch(`${base}/api/world/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer scene-token' }, body: json(input) });
    return { status: response.status, data: await response.json() }; };
  const inputFile = path.join(root, '.request.json'); await fs.writeFile(inputFile, json({ ...f.input, mode: 'preview' }));
  const preview = await send({ ...f.input, mode: 'preview' }); assert.equal(preview.status, 200);
  assert.deepEqual(preview.data.data, await runWorldQuery(['--root', root, '--request', inputFile]));
  const invalid = await send({ ...f.input, content: '{}' }); assert.equal(invalid.status, 422); assert.equal(invalid.data.errorCode, 'world_scene_invalid');
  assert.equal((await send(f.input)).status, 200); assert.equal((await send(await updateRequest(f, f.candidate))).data.data.status, 'unchanged');
});
test('scene update planner runs without host APIs', async () => {
  const result = await runCommand(process.execPath, ['--experimental-vm-modules', fileURLToPath(new URL('./world-portable-runtime.mjs', import.meta.url)), '--scene-update']);
  assert.deepEqual(JSON.parse(result.stdout), { unchanged: true, files: 2, title: 'Updated portable scene', metadataUnchanged: true });
});

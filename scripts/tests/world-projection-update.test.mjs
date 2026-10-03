import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import { getProjectionTemplates, lockProjectionTemplate } from '../../engine/object-projection.mjs';
import { prepareProjectionUpdate, updateObjectProjectionContent, appendProjectionImageBindings } from '../../engine/world-projection-update.mjs';
import { worldMutationDescriptors } from '../../engine/world-command-contract.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldProjection, readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { recoverWorldTransaction } from '../lib/world-transactions.mjs';
import { readTransactionStatus, transactionHash } from '../lib/world-transaction-state.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { runWorldQuery } from '../world.mjs';
import { runCommand } from '../lib/process.mjs';
import { fixture, write, serve, request } from './helpers.mjs';

const coreId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', imageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const objectId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', image2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const recordPath = `metadata/documents/${objectId}.json`, journal = '.viento/world-transactions';
const json = value => JSON.stringify(value, null, 2) + '\n';
const digest = value => transactionHash(value).slice(7);
const parse = source => JSON.parse(source.replace(/^\uFEFF/, ''));

async function materialize(t, version = 3, root) {
  if (!root) { root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-projection-update-')); t.after(() => fs.rm(root, { recursive: true, force: true })); }
  const frozen = JSON.parse(await fs.readFile(new URL(`fixtures/predecessor/v${version}.json`, import.meta.url)));
  for (const [name, content] of Object.entries(frozen.files)) await write(root, name, content);
  const image = JSON.parse(frozen.files[`metadata/assets/${imageId}.json`]);
  await write(root, `metadata/assets/${image2}.json`, json({ ...image, id: image2, name: 'replacement.svg', location: { ...image.location, path: 'replacement.svg' }, legacyPaths: [] }));
  await write(root, 'assets/replacement.svg', frozen.files['assets/reference.svg']);
  const snapshot = getProjectionTemplates()[0];
  // Two fields can reference one resource, exercising identity-level dedupe.
  snapshot.fields.push({ id: 'portrait', label: 'Portrait', type: 'image', default: '' });
  const value = { format: 'viento-object-projection', schemaVersion: 1, title: '旅人', sourceObjectId: coreId,
    template: await lockProjectionTemplate(snapshot, { digest }), configuration: Object.fromEntries(snapshot.fields.map(field => [field.id, field.default])) };
  value.configuration.image = imageId;
  const sourcePath = `${version === 3 ? 'documents' : 'design-data'}/projections/rpg.json`;
  const sourceContent = '\uFEFF' + json(value).replace('"title": "旅人"', '"title": "\\u65c5\\u4eba"').replace('"health": 100', '"health": 1e2').replaceAll('\n', '\r\n');
  const execute = createWorldCommandService(root), view = await readWorldProjection(root);
  await execute({ command: 'projection.create', mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
    actorRef: { kind: 'tool', id: 'projection-update-test' }, objectId, documentType: 'character', sourcePath, content: sourceContent });
  const record = await fs.readFile(path.join(root, recordPath), 'utf8');
  const recordContent = record.replace('"version": 1,', '"version": 1,\n  "extensions": { "large": 900719925474099312345, "literal": "\\u65c5" },').replaceAll('\n', '\r\n');
  await write(root, recordPath, recordContent);
  const f = { root, execute, value, sourcePath, sourceContent, recordContent, files: [sourcePath, recordPath], corePath: frozen.sourcePath };
  f.candidate = { ...value, title: '旅人 · 守卫', configuration: { ...value.configuration, health: 180, speed: 240, role: 'line one\nline two', image: image2, portrait: image2 } };
  f.input = await updateRequest(f, f.candidate);
  return f;
}
async function updateRequest(f, candidate) {
  const view = await readWorldProjection(f.root), object = view.objects.find(item => item.id === objectId);
  return { command: 'projection.update', mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
    actorRef: { kind: 'tool', id: 'projection-update-test' }, objectId, objectRevision: object.revision,
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

for (const version of [2, 3]) test(`projection.update v${version} preserves authored bytes and adds only distinct required image bindings`, async t => {
  const f = await materialize(t, version), before = await fingerprint(f.root), snapshot = await readWorldSnapshot(f.root), frozen = json(snapshot);
  const planned = await prepareProjectionUpdate(snapshot.source, snapshot.projection, f.recordContent, { ...f.input, mode: 'preview' }, { digest });
  assert.equal(json(snapshot), frozen); assert.equal(planned.plans.length, 2);
  assert.deepEqual(planned.result, await f.execute({ ...f.input, mode: 'preview' }));
  assert.deepEqual(await fingerprint(f.root), before);
  const expectedSource = f.sourceContent.replace('"\\u65c5\\u4eba"', JSON.stringify(f.candidate.title)).replace('"health": 1e2', '"health": 180')
    .replace('"speed": 160', '"speed": 240').replace('"role": ""', '"role": "line one\\nline two"')
    .replace(`"image": "${imageId}"`, `"image": "${image2}"`).replace('"portrait": ""', `"portrait": "${image2}"`);
  assert.equal(planned.plans[0].afterContent, expectedSource);
  assert.equal(planned.result.changes[0].afterText, expectedSource, 'preview returns the exact source that will be saved');
  const metadata = appendProjectionImageBindings(f.recordContent, f.candidate);
  assert.equal(planned.plans[1].afterContent, metadata.afterContent);
  assert.match(metadata.afterContent, /900719925474099312345/); assert.match(metadata.afterContent, /"literal": "\\u65c5"/);
  assert.deepEqual(metadata.after.assetBindings, [{ assetId: imageId, role: 'image' }, { assetId: image2, role: 'image' }]);
  assert.equal(metadata.afterContent.replace(`, ${JSON.stringify({ assetId: image2, role: 'image' })}`, ''), f.recordContent);
  const ajv = new Ajv(), descriptor = worldMutationDescriptors().find(item => item.id === 'projection.update');
  for (const [name, value] of [['object', planned.result.object], ['command-descriptor', descriptor], ['changeset', planned.result.proposal]]) {
    const validate = ajv.compile(JSON.parse(await fs.readFile(new URL(`../../schemas/${name}-v1.schema.json`, import.meta.url))));
    assert.equal(validate(value), true, json(validate.errors));
  }
  const saved = await f.execute(f.input); assert.equal(saved.status, 'applied'); assert.equal(saved.object.name, f.candidate.title);
  assert.deepEqual(await contents(f), [expectedSource, metadata.afterContent]);
  const after = await fingerprint(f.root);
  for (const [file, hash] of Object.entries(before)) if (![...f.files, `${journal}/head.json`].includes(file)) assert.equal(after[file], hash, file);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  assert.equal((await readWorldProjection(f.root)).world.revision, saved.revision);
});

test('semantic no-op ignores candidate formatting and creates no journal or duplicate binding', async t => {
  const f = await materialize(t), before = await fingerprint(f.root);
  const input = { ...f.input, content: JSON.stringify(f.value) };
  assert.equal((await f.execute(input)).status, 'unchanged');
  assert.deepEqual(await fingerprint(f.root), before); assert.deepEqual(await contents(f), [f.sourceContent, f.recordContent]);
  await f.execute(f.input);
  const saved = await fingerprint(f.root), again = await updateRequest(f, f.candidate);
  assert.equal((await f.execute(again)).status, 'unchanged'); assert.deepEqual(await fingerprint(f.root), saved);
  const clear = { ...f.candidate, configuration: { ...f.candidate.configuration, image: '', portrait: '' } };
  const clearResult = await f.execute(await updateRequest(f, clear)); assert.equal(clearResult.changes[0].addedBindings.length, 0);
  assert.deepEqual((await readRegistry(f.root)).documents.find(item => item.id === objectId).assetBindings,
    [{ assetId: imageId, role: 'image' }, { assetId: image2, role: 'image' }]);
});

test('projection.update rejects identity/template edits, unknown fields, invalid configuration, stale versions and ordinary documents without writes', async t => {
  const f = await materialize(t), before = await fingerprint(f.root);
  for (const mutate of [value => { value.format = 'other'; }, value => { value.schemaVersion = 2; },
    value => { value.sourceObjectId = imageId; }, value => { value.template.snapshot.label = 'New lock'; },
    value => { value.configuration.speed = 2001; }, value => { value.configuration.health = -1; },
    value => { value.configuration.controls = 'custom'; }, value => { value.configuration.extra = 2; },
    value => { value.configuration.image = coreId; }, value => { value.title = ''; }]) {
    const value = structuredClone(f.candidate); mutate(value);
    await assert.rejects(f.execute({ ...f.input, content: json(value) }), error => error.errorCode === 'world_projection_invalid'
      && error.payload.diagnostics.every(item => item.objectId === objectId && item.sourcePath === f.sourcePath));
  }
  const replaced = structuredClone(f.candidate); replaced.template.snapshot.label = 'Resigned lock';
  replaced.template = await lockProjectionTemplate(replaced.template.snapshot, { digest });
  await assert.rejects(f.execute({ ...f.input, content: json(replaced) }), error => error.errorCode === 'world_projection_invalid' && error.payload.diagnostics[0].propertyPath === '/template');
  for (const key of ['baseRevision', 'objectRevision', 'sourceRevision']) await assert.rejects(f.execute({ ...f.input, [key]: 'sha256:' + '0'.repeat(64) }), error => error.errorCode === 'world_revision_conflict');
  await assert.rejects(f.execute({ ...f.input, sourcePath: 'documents/other.json' }), error => error.errorCode === 'world_command_invalid');
  const view = await readWorldProjection(f.root), core = view.objects.find(item => item.id === coreId);
  await assert.rejects(f.execute({ ...f.input, objectId: coreId, objectRevision: core.revision, sourceRevision: core.documentRefs[0].sourceRevision }), error => error.errorCode === 'world_projection_invalid');
  await assert.rejects(f.execute({ ...f.input, objectId: imageId }), error => error.errorCode === 'world_object_not_found');
  assert.deepEqual(await fingerprint(f.root), before);
  const originalRecord = parse(f.recordContent);
  await write(f.root, recordPath, json({ ...originalRecord, documentType: 'unavailable-type' }));
  const unknownInput = await updateRequest(f, f.candidate), unknownBefore = await fingerprint(f.root);
  await assert.rejects(f.execute(unknownInput), error => error.errorCode === 'world_projection_invalid');
  assert.deepEqual(await fingerprint(f.root), unknownBefore);
  await write(f.root, recordPath, f.recordContent);
  await write(f.root, f.sourcePath, '{"format":"viento-object-projection",');
  const brokenInput = await updateRequest(f, f.candidate), broken = await fingerprint(f.root);
  await assert.rejects(f.execute(brokenInput), error => error.errorCode === 'world_projection_invalid');
  assert.deepEqual(await fingerprint(f.root), broken);
});

for (const [point, index, committed] of [['intent', '-', false], ['source-ready', 0, false], ['data', 0, false], ['source-ready', 1, false], ['data', 1, false], ['commit', '-', true], ['head', '-', true]]) {
  test(`projection.update v7 SIGKILL ${point}/${index} restores exact ${committed ? 'after' : 'before'} source and registration`, async t => {
    const f = await materialize(t), preview = await f.execute({ ...f.input, mode: 'preview' });
    await crash(f, point, index);
    const intent = JSON.parse(await fs.readFile(path.join(f.root, journal, 'active/intent.json')));
    assert.equal(intent.version, 7); assert.equal(intent.entries.length, 2); assert.ok(intent.entries.every(entry => entry.before));
    await assert.rejects(readWorldProjection(f.root), error => error.errorCode === 'world_recovery_required');
    assert.equal((await recoverWorldTransaction(f.root)).status, committed ? 'committed' : 'rolled-back');
    const expected = committed ? [(await updateObjectProjectionContent(f.sourceContent, f.input.content, parse(f.recordContent), { digest })).afterContent,
      appendProjectionImageBindings(f.recordContent, f.candidate).afterContent] : [f.sourceContent, f.recordContent];
    assert.deepEqual(await contents(f), expected);
    assert.equal((await readWorldProjection(f.root)).world.revision, committed ? preview.revision : f.input.baseRevision);
    assert.equal((await recoverWorldTransaction(f.root)).status, 'idle');
    assert.equal(Object.keys(await fingerprint(f.root)).some(file => /\/\.viento-[^/]+\.tmp$/.test(file)), false);
  });
}

test('v7 keeps a metadata guard for source-only edits and recovery can be interrupted again in both directions', async t => {
  for (const committed of [false, true]) {
    const f = await materialize(t); f.candidate = { ...f.value, title: 'Title only' }; f.input = await updateRequest(f, f.candidate);
    await crash(f, committed ? 'commit' : 'data', committed ? '-' : 0);
    const intent = JSON.parse(await fs.readFile(path.join(f.root, journal, 'active/intent.json')));
    assert.equal(intent.entries.length, 2); assert.equal(intent.entries[1].before, intent.entries[1].after);
    if (committed) await write(f.root, f.sourcePath, f.sourceContent);
    await crash(f, 'recovery-file', 0, true); await recoverWorldTransaction(f.root);
    assert.equal((await contents(f))[1], f.recordContent);
    assert.equal(parse((await contents(f))[0]).title, committed ? 'Title only' : f.value.title);
  }
});

test('v7 recovery ignores external OC source edits but blocks any external registry, projection source or own-record edit', async t => {
  for (const committed of [false, true]) {
    const f = await materialize(t); await crash(f, committed ? 'commit' : 'data', committed ? '-' : 1);
    await write(f.root, f.corePath, '# Author edited OC after crash\n');
    assert.equal((await recoverWorldTransaction(f.root)).status, committed ? 'committed' : 'rolled-back');
    assert.equal(await fs.readFile(path.join(f.root, f.corePath), 'utf8'), '# Author edited OC after crash\n');
  }
  for (const name of ['registry', 'source', 'record']) {
    const f = await materialize(t); await crash(f, 'data', 0);
    const target = name === 'registry' ? `metadata/assets/${image2}.json` : name === 'source' ? f.sourcePath : recordPath;
    await fs.appendFile(path.join(f.root, target), name === 'registry' ? ' ' : '\n');
    if (name === 'registry') {
      const resource = JSON.parse(await fs.readFile(path.join(f.root, target))); resource.name = 'External rename'; await write(f.root, target, json(resource));
    }
    const before = await fingerprint(f.root);
    await assert.rejects(recoverWorldTransaction(f.root), error => error.errorCode === 'world_recovery_conflict');
    assert.deepEqual(await fingerprint(f.root), before);
  }
});

for (const kind of ['locked-core', 'resigned-template', 'formatting', 'extra-binding', 'removed-old-binding', 'record-extension', 'identity', 'missing-entry', 'downgrade-v6', 'downgrade-v1']) {
  test(`v7 rejects forged journal ${kind} before publishing any recovery bytes`, async t => {
    const f = await materialize(t); await crash(f, 'intent');
    const location = path.join(f.root, journal, 'active'), intent = JSON.parse(await fs.readFile(path.join(location, 'intent.json')));
    let source = await fs.readFile(path.join(location, '0.after'), 'utf8'), record = await fs.readFile(path.join(location, '1.after'), 'utf8');
    if (kind === 'locked-core') source = source.replace(coreId, imageId);
    if (kind === 'resigned-template') {
      const value = parse(source); value.template.snapshot.label = 'Forged lock'; value.template = await lockProjectionTemplate(value.template.snapshot, { digest }); source = json(value);
    }
    if (kind === 'formatting') source = json(parse(source));
    if (kind === 'extra-binding') { const value = parse(record); value.assetBindings.push({ assetId: image2, role: 'forged' }); record = json(value); }
    if (kind === 'removed-old-binding') { const value = parse(record); value.assetBindings.shift(); record = json(value); }
    if (kind === 'record-extension') record = record.replace('900719925474099312345', '900719925474099312346');
    if (kind === 'identity') { const value = parse(record); value.documentType = 'story'; record = json(value); }
    await fs.writeFile(path.join(location, '0.after'), source); intent.entries[0].after = transactionHash(source);
    await fs.writeFile(path.join(location, '1.after'), record); intent.entries[1].after = transactionHash(record);
    if (kind === 'missing-entry') intent.entries.pop();
    if (kind === 'downgrade-v6') intent.version = 6;
    if (kind === 'downgrade-v1') intent.version = 1;
    await fs.writeFile(path.join(location, 'intent.json'), json(intent));
    const before = await fingerprint(f.root);
    await assert.rejects(recoverWorldTransaction(f.root), error => error.errorCode === 'world_journal_invalid');
    assert.deepEqual(await fingerprint(f.root), before); assert.equal((await readTransactionStatus(f.root)).pending, true);
  });
}

test('projection.update HTTP authentication, CLI preview, diagnostics and no-op share one command contract', async t => {
  const root = await fixture(t), f = await materialize(t, 3, root), base = await serve(t, root, { DOC_API_TOKEN: 'projection-token', DOC_API_REQUIRE_WRITE_AUTH: '1' });
  assert.ok((await request(base, '/api/capabilities')).data.semanticCommands.includes('projection.update'));
  assert.equal((await request(base, '/api/world/commands', f.input)).status, 401);
  const send = async input => { const response = await fetch(`${base}/api/world/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer projection-token' }, body: json(input) });
    return { status: response.status, data: await response.json() }; };
  const inputFile = path.join(root, '.request.json'); await fs.writeFile(inputFile, json({ ...f.input, mode: 'preview' }));
  const preview = await send({ ...f.input, mode: 'preview' }); assert.equal(preview.status, 200);
  const snapshot = await readWorldSnapshot(root);
  const plan = await prepareProjectionUpdate(snapshot.source, snapshot.projection, f.recordContent, { ...f.input, mode: 'preview' }, { digest });
  assert.equal(preview.data.data.changes[0].afterText, plan.plans[0].afterContent);
  assert.deepEqual(preview.data.data, await runWorldQuery(['--root', root, '--request', inputFile]));
  const invalid = await send({ ...f.input, content: '{}' }); assert.equal(invalid.status, 422); assert.equal(invalid.data.errorCode, 'world_projection_invalid');
  assert.equal(invalid.data.diagnostics[0].objectId, objectId);
  assert.equal((await send(f.input)).status, 200);
  const again = await send(await updateRequest(f, f.candidate)); assert.equal(again.data.data.status, 'unchanged');
});

test('projection update planning and lossless token replacement execute without host APIs', async () => {
  const result = await runCommand(process.execPath, ['--experimental-vm-modules', fileURLToPath(new URL('./world-portable-runtime.mjs', import.meta.url)), '--projection-update']);
  assert.deepEqual(JSON.parse(result.stdout), { unchanged: true, files: 2, name: 'Updated portable', metadataUnchanged: true });
});

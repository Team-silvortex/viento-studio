import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import { getProjectionTemplates, lockProjectionTemplate, deriveProjectionTemplate, validateProjectionTemplate,
  validateObjectProjection, inspectObjectProjection, renderProjectionRuntime } from '../../engine/object-projection.mjs';
import { worldMutationDescriptors } from '../../engine/world-command-contract.mjs';
import { createDocumentFieldDraft } from '../../engine/fields.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldProjection, readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { recoverWorldTransaction } from '../lib/world-transactions.mjs';
import { readTransactionStatus, transactionHash } from '../lib/world-transaction-state.mjs';
import { prepareProjectionCreate } from '../../engine/world-object-projection.mjs';
import { createScene2DPlan } from '../../engine/build-plan.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { runWorldQuery } from '../world.mjs';
import { runCommand } from '../lib/process.mjs';
import { fixture, write, serve, request } from './helpers.mjs';

const coreId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', imageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const objectId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', secondId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const journal = '.viento/world-transactions', recordPath = `metadata/documents/${objectId}.json`;
const digest = value => transactionHash(value).slice(7);
const json = value => JSON.stringify(value, null, 2) + '\n';
const defaults = snapshot => Object.fromEntries(snapshot.fields.map(field => [field.id, field.default]));

test('browser template entry has a fully relative dependency graph without YAML or host modules', async () => {
  const visited = new Set();
  async function visit(url) {
    if (visited.has(url.href)) return; visited.add(url.href);
    const source = await fs.readFile(url, 'utf8');
    for (const match of source.matchAll(/(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g)) {
      assert.ok(match[1].startsWith('./'), `Browser dependency must be relative: ${match[1]}`);
      await visit(new URL(match[1], url));
    }
  }
  await visit(new URL('../../engine/object-projection-template.mjs', import.meta.url));
  assert.equal(visited.size, 2);
});
async function declaration(snapshot = getProjectionTemplates()[0]) {
  const template = await lockProjectionTemplate(snapshot, { digest });
  return { format: 'viento-object-projection', schemaVersion: 1, title: '旅人 / RPG', sourceObjectId: coreId,
    template, configuration: defaults(snapshot) };
}
async function materialize(t, version = 3, root) {
  if (!root) { root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-projection-test-')); t.after(() => fs.rm(root, { recursive: true, force: true })); }
  const frozen = JSON.parse(await fs.readFile(new URL(`fixtures/predecessor/v${version}.json`, import.meta.url)));
  for (const [name, content] of Object.entries(frozen.files)) await write(root, name, content);
  const view = await readWorldProjection(root), value = await declaration(); value.configuration.image = imageId;
  const sourcePath = `${version === 3 ? 'documents' : 'design-data'}/projections/rpg.json`;
  const input = { command: 'projection.create', mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
    actorRef: { kind: 'tool', id: 'projection-test' }, objectId, documentType: 'character', sourcePath,
    content: '\uFEFF' + json(value).replaceAll('\n', '\r\n') };
  return { root, input, value, files: [sourcePath, recordPath], execute: createWorldCommandService(root) };
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
async function contents(f) { return Promise.all(f.files.map(file => fs.readFile(path.join(f.root, file), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; }))); }
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

test('builtin hierarchy expands independent bounded snapshots; custom derivatives retain settings without copying project image identities', async () => {
  const templates = getProjectionTemplates(); assert.equal(templates.length, 5);
  for (const snapshot of templates) {
    validateProjectionTemplate(snapshot); const value = await declaration(snapshot);
    assert.equal((await validateObjectProjection(json(value), {}, { digest })).ok, true);
    assert.equal(snapshot.lineage[0].id, 'org.viento.projection.character');
  }
  assert.deepEqual(renderProjectionRuntime(await declaration()), { size: [80, 80], color: '#ffffff', speed: 160, controls: 'arrows' });
  assert.equal(renderProjectionRuntime(await declaration(templates[1])).controls, 'none');
  assert.equal(renderProjectionRuntime(await declaration(templates[3])), null);
  const configuration = { ...defaults(templates[0]), health: 150, image: imageId };
  const derived = deriveProjectionTemplate(templates[0], configuration, { id: 'ui.derived.1234abcd', label: 'Author variant' });
  assert.equal(derived.fields.find(field => field.id === 'health').default, 150);
  assert.equal(derived.fields.find(field => field.id === 'image').default, '');
  assert.deepEqual(derived.lineage.at(-1), { id: templates[0].id, version: templates[0].version });
  derived.fields[0].default = 'Changed'; assert.notEqual(getProjectionTemplates()[0].fields[0].default, 'Changed');
});

test('template validation rejects executable extensions, duplicate fields, invalid lineage, options and unbounded values', async () => {
  const source = getProjectionTemplates()[0];
  for (const mutate of [
    template => { template.script = 'run()'; }, template => { template.fields.push(template.fields[0]); },
    template => { template.lineage.push({ id: template.id, version: template.version }); },
    template => { template.fields[0].type = 'javascript'; }, template => { template.fields[1].default = Infinity; },
    template => { template.fields[1].limits = { min: 10, max: 1 }; },
    template => { template.fields.find(field => field.id === 'controls').options = ['arrows', 'arrows']; },
    template => { template.runtime.speed = 'role'; }, template => { template.runtime.kind = 'custom-script'; },
    template => { template.fields = Array.from({ length: 33 }, (_, i) => ({ id: `field${i}`, label: 'x', type: 'boolean', default: false })); delete template.runtime; },
  ]) { const template = structuredClone(source); mutate(template); assert.throws(() => validateProjectionTemplate(template)); }
  const value = await declaration(); value.template.snapshot.label = 'Untrusted replacement';
  assert.equal((await validateObjectProjection(json(value), {}, { digest })).ok, false);
  assert.equal(inspectObjectProjection('{"format":"viento-object-projection",').recognized, true);
  assert.equal(inspectObjectProjection('# Ordinary', { relations: [{ kind: 'references', slot: 'projection-source', targetId: coreId }] }).ok, false);
});

for (const version of [2, 3]) test(`projection.create v${version}: two files, original OC preserved, stable preview and independently editable configurations`, async t => {
  const f = await materialize(t, version), before = await fingerprint(f.root), snapshot = await readWorldSnapshot(f.root), untouched = json(snapshot);
  const pure = await prepareProjectionCreate(snapshot.source, snapshot.projection, { ...f.input, mode: 'preview' }, { digest });
  assert.equal(json(snapshot), untouched); assert.equal(pure.plans.length, 2);
  const preview = await f.execute({ ...f.input, mode: 'preview' }); assert.deepEqual(preview, pure.result);
  assert.deepEqual(await fingerprint(f.root), before); assert.deepEqual(await contents(f), [null, null]);
  const record = preview.changes[0].record;
  assert.deepEqual(record.relations, [{ kind: 'references', targetId: coreId, slot: 'projection-source' }]);
  assert.deepEqual(record.assetBindings, [{ assetId: imageId, role: 'image' }]);
  assert.equal(preview.object.provenance.authoredProjection.sourceObjectId, coreId);
  assert.equal(preview.object.name, f.value.title);
  assert.ok(Object.values(preview.object.properties).some(field => field.label === '生命值'));
  assert.ok(Object.values(preview.object.properties).every(field => !['sourceObjectId', 'digest', '图片'].includes(field.label)));
  const ajv = new Ajv(), descriptor = worldMutationDescriptors().find(item => item.id === 'projection.create');
  for (const [name, value] of [['object', preview.object], ['command-descriptor', descriptor], ['changeset', preview.proposal]]) {
    const validate = ajv.compile(JSON.parse(await fs.readFile(new URL(`../../schemas/${name}-v1.schema.json`, import.meta.url))));
    assert.equal(validate(value), true, json(validate.errors));
  }
  const saved = await f.execute(f.input), fresh = await readWorldProjection(f.root);
  assert.equal(fresh.objects.find(item => item.id === coreId).name, snapshot.projection.objects.find(item => item.id === coreId).name);
  assert.equal(fresh.diagnostics.some(item => item.objectId === coreId && item.severity === 'error'), false);
  assert.equal(saved.revision, preview.revision); assert.equal(fresh.world.revision, preview.revision);
  assert.equal((await contents(f))[0], f.input.content);
  const after = await fingerprint(f.root); for (const [file, hash] of Object.entries(before)) assert.equal(after[file], hash, file);
  assert.deepEqual(Object.keys(after).filter(file => !Object.hasOwn(before, file)).sort(), [...f.files, `${journal}/head.json`].sort());
  await assert.rejects(f.execute(f.input), error => error.errorCode === 'world_revision_conflict');
  const other = await declaration(getProjectionTemplates()[3]);
  const second = await f.execute({ ...f.input, objectId: secondId, sourcePath: f.input.sourcePath.replace('rpg.json', 'literature.json'),
    content: json(other), baseRevision: fresh.world.revision });
  assert.equal(second.object.provenance.authoredProjection.sourceObjectId, coreId);
  assert.notDeepEqual(second.object.provenance.authoredProjection.configuration, saved.object.provenance.authoredProjection.configuration);
});

test('projection creation rejects dangling cores, nested projections, stale inputs, unsafe paths and invalid configuration without writing', async t => {
  const f = await materialize(t), before = await fingerprint(f.root);
  for (const mutate of [
    value => { value.sourceObjectId = objectId; }, value => { value.sourceObjectId = imageId; },
    value => { value.configuration.speed = 2001; }, value => { value.configuration.controls = 'custom'; },
    value => { value.configuration.health = '100'; }, value => { value.configuration.extra = true; },
    value => { delete value.configuration.level; }, value => { value.configuration.image = coreId; },
    value => { value.template.digest = 'sha256:' + '0'.repeat(64); },
  ]) { const value = structuredClone(f.value); mutate(value);
    await assert.rejects(f.execute({ ...f.input, content: json(value) }), error => error.errorCode === 'world_projection_invalid' && error.payload.diagnostics.every(item => item.objectId === objectId)); }
  await assert.rejects(f.execute({ ...f.input, content: f.input.content.replace('"title":', '"title":"duplicate", "title":') }), error => error.errorCode === 'world_projection_invalid');
  await assert.rejects(f.execute({ ...f.input, sourcePath: '../outside.json' }), error => error.errorCode === 'world_create_path_invalid');
  await assert.rejects(f.execute({ ...f.input, force: true }), error => error.errorCode === 'world_command_invalid');
  assert.deepEqual(await fingerprint(f.root), before);
  const first = await f.execute(f.input), nested = { ...f.value, sourceObjectId: objectId };
  await assert.rejects(f.execute({ ...f.input, objectId: secondId, sourcePath: 'documents/nested.json', content: json(nested), baseRevision: first.revision }), error => error.errorCode === 'world_projection_invalid');
  await write(f.root, f.input.sourcePath, '# Broken projection');
  const broken = await readWorldProjection(f.root), object = broken.objects.find(item => item.id === objectId);
  assert.equal(object.provenance.authoredProjection, null);
  assert.ok(broken.diagnostics.some(item => item.objectId === objectId && item.code === 'object-projection-invalid'));
  await assert.rejects(f.execute({ ...f.input, objectId: secondId, sourcePath: 'documents/nested.json', content: json(nested), baseRevision: broken.world.revision }), error => error.errorCode === 'world_projection_invalid');
});

test('property commands edit only valid title/config values, preserve locked source/template and reject image changes without metadata', async t => {
  const f = await materialize(t); await f.execute(f.input);
  let view = await readWorldProjection(f.root), object = view.objects.find(item => item.id === objectId);
  const health = Object.entries(object.properties).find(([, field]) => field.label === '生命值')[0];
  const input = { command: 'property.set', mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
    actorRef: f.input.actorRef, objectId, objectRevision: object.revision, sourceRevision: object.documentRefs[0].sourceRevision,
    propertyPath: `/properties/${health}`, value: '200' };
  const before = await fingerprint(f.root);
  await assert.rejects(f.execute({ ...input, value: '-1' }), error => error.errorCode === 'world_projection_invalid');
  const controls = Object.entries(object.properties).find(([, field]) => field.label === '移动控制')[0];
  await assert.rejects(f.execute({ ...input, propertyPath: `/properties/${controls}`, value: 'custom' }), error => error.errorCode === 'world_projection_invalid');
  assert.deepEqual(await fingerprint(f.root), before);
  const fields = createDocumentFieldDraft(f.input.content, f.input.sourcePath);
  for (const field of fields.fields.filter(item => item.key === 'sourceObjectId' || item.key === 'template' || item.key === 'configuration' && item.label === 'image')) {
    await assert.rejects(f.execute({ ...input, propertyPath: `/properties/field-${field.id}`, value: field.value }), error => error.errorCode === 'world_property_not_found');
  }
  await f.execute(input); view = await readWorldProjection(f.root); object = view.objects.find(item => item.id === objectId);
  assert.equal(object.provenance.authoredProjection.configuration.health, 200);
  assert.deepEqual(object.provenance.authoredProjection.template, f.value.template);
  assert.equal((await readRegistry(f.root)).documents.find(item => item.id === objectId).relations[0].targetId, coreId);
  const title = Object.entries(object.properties).find(([, field]) => field.label === 'title')[0];
  const renamed = '旅人 · 文艺复兴守卫';
  await f.execute({ ...input, baseRevision: view.world.revision, objectRevision: object.revision,
    sourceRevision: object.documentRefs[0].sourceRevision, propertyPath: `/properties/${title}`, value: renamed });
  view = await readWorldProjection(f.root); object = view.objects.find(item => item.id === objectId);
  assert.equal(object.name, renamed);
  assert.equal(JSON.parse((await contents(f))[0].replace(/^\uFEFF/, '')).title, renamed);
  const scene = { format: 'viento-scene2d', schemaVersion: 1, title: '投影名称回归', viewport: [640, 480], background: '#101827',
    actors: [{ objectId, position: [100, 100], useProjectionDefaults: true }] };
  await f.execute({ ...f.input, command: 'scene.create', objectId: secondId, sourcePath: 'documents/scenes/title.json',
    baseRevision: view.world.revision, content: json(scene) });
  const build = createScene2DPlan(await readWorldSnapshot(f.root), secondId);
  assert.equal(build.ok, true, json(build.diagnostics));
  assert.equal(build.plan.actors[0].name, renamed);
});

for (const [point, index, committed] of [['intent', '-', false], ['source-ready', 0, false], ['data', 0, false], ['source-ready', 1, false], ['data', 1, false], ['commit', '-', true], ['head', '-', true]]) {
  test(`projection.create v6 SIGKILL ${point}/${index}: ${committed ? 'commit' : 'roll back'} both files with frozen custom template`, async t => {
    const f = await materialize(t), custom = deriveProjectionTemplate(f.value.template.snapshot, f.value.configuration, { id: 'local.author.custom', label: 'Portable custom' });
    f.input.content = json(await declaration(custom)); const preview = await f.execute({ ...f.input, mode: 'preview' });
    await crash(f, point, index);
    assert.equal(JSON.parse(await fs.readFile(path.join(f.root, journal, 'active/intent.json'))).version, 6);
    await assert.rejects(readWorldProjection(f.root), error => error.errorCode === 'world_recovery_required');
    assert.equal((await recoverWorldTransaction(f.root)).status, committed ? 'committed' : 'rolled-back');
    if (committed) { assert.equal((await contents(f))[0], f.input.content); assert.equal((await readWorldProjection(f.root)).world.revision, preview.revision); }
    else { assert.deepEqual(await contents(f), [null, null]); assert.equal((await readWorldProjection(f.root)).world.revision, f.input.baseRevision); }
    assert.equal((await recoverWorldTransaction(f.root)).status, 'idle');
    assert.equal(Object.keys(await fingerprint(f.root)).some(file => /\/\.viento-[^/]+\.tmp$/.test(file)), false);
  });
}

test('v6 recovery remains restartable after a second crash in either direction', async t => {
  for (const committed of [false, true]) {
    const f = await materialize(t); await crash(f, committed ? 'commit' : 'data', committed ? '-' : 1);
    if (committed) for (const file of f.files) await fs.rm(path.join(f.root, file));
    await crash(f, 'recovery-file', committed ? 0 : 1, true); await recoverWorldTransaction(f.root);
    assert.equal((await contents(f)).every(value => committed ? typeof value === 'string' : value === null), true);
  }
});

test('v6 recovery preserves external OC source edits and does not require the old source bytes', async t => {
  for (const committed of [false, true]) {
    const f = await materialize(t); await crash(f, committed ? 'commit' : 'data', committed ? '-' : 1);
    const corePath = path.join(f.root, 'documents/characters/traveler.md'), content = '# Updated OC\n\nBackground remains authored here.\n';
    await fs.writeFile(corePath, content);
    assert.equal((await recoverWorldTransaction(f.root)).status, committed ? 'committed' : 'rolled-back');
    assert.equal(await fs.readFile(corePath, 'utf8'), content);
    assert.equal((await contents(f)).every(value => committed ? typeof value === 'string' : value === null), true);
    assert.equal((await readTransactionStatus(f.root)).pending, false);
  }
});

for (const kind of ['core-registration', 'image-registration', 'template-lock', 'rehashed-template-forged-registration', 'missing-origin', 'extra-binding', 'foreign-source', 'downgrade-v5', 'downgrade-v2']) {
  test(`v6 recovery preserves all targets and journal on ${kind}`, async t => {
    const f = await materialize(t); await crash(f, 'data', 0);
    const file = path.join(f.root, journal, 'active/intent.json'), intent = JSON.parse(await fs.readFile(file));
    if (kind.endsWith('registration')) {
      const target = kind === 'core-registration' ? `metadata/documents/${coreId}.json` : `metadata/assets/${imageId}.json`;
      const record = JSON.parse(await fs.readFile(path.join(f.root, target))); record.external = true; await write(f.root, target, json(record));
    }
    if (kind === 'missing-origin' || kind === 'extra-binding' || kind === 'rehashed-template-forged-registration') {
      const record = JSON.parse(await fs.readFile(path.join(f.root, journal, 'active/1.after')));
      if (kind === 'missing-origin') record.relations = []; else record.assetBindings.push({ assetId: imageId, role: 'extra' });
      const bytes = json(record); await write(f.root, `${journal}/active/1.after`, bytes); intent.entries[1].after = transactionHash(bytes);
    }
    if (kind === 'template-lock' || kind === 'rehashed-template-forged-registration') {
      const value = structuredClone(f.value); value.template.snapshot.label = 'Replaced';
      if (kind === 'rehashed-template-forged-registration') value.template = await lockProjectionTemplate(value.template.snapshot, { digest });
      const bytes = json(value);
      await write(f.root, `${journal}/active/0.after`, bytes); await write(f.root, f.input.sourcePath, bytes); intent.entries[0].after = transactionHash(bytes);
    }
    if (kind === 'foreign-source') await write(f.root, f.input.sourcePath, 'Do not delete');
    if (kind === 'downgrade-v5') intent.version = 5;
    if (kind === 'downgrade-v2') intent.version = 2;
    await fs.writeFile(file, json(intent)); const before = await fingerprint(f.root);
    await assert.rejects(recoverWorldTransaction(f.root), error => ['world_recovery_conflict', 'world_journal_invalid'].includes(error.errorCode));
    assert.deepEqual(await fingerprint(f.root), before); assert.equal((await readTransactionStatus(f.root)).pending, true);
  });
}

test('projection commands use existing HTTP authentication, preview diagnostics and CLI contract', async t => {
  const root = await fixture(t), f = await materialize(t, 3, root), base = await serve(t, root, { DOC_API_TOKEN: 'projection-token', DOC_API_REQUIRE_WRITE_AUTH: '1' });
  assert.ok((await request(base, '/api/capabilities')).data.semanticCommands.includes('projection.create'));
  assert.equal((await request(base, '/api/world/commands', f.input)).status, 401);
  const send = async input => { const response = await fetch(`${base}/api/world/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer projection-token' }, body: json(input) });
    return { status: response.status, data: await response.json() }; };
  const inputFile = path.join(root, '.request.json'); await fs.writeFile(inputFile, json({ ...f.input, mode: 'preview' }));
  const preview = await send({ ...f.input, mode: 'preview' }); assert.equal(preview.status, 200);
  assert.deepEqual(preview.data.data, await runWorldQuery(['--root', root, '--request', inputFile]));
  const invalid = await send({ ...f.input, content: '{}' }); assert.equal(invalid.status, 422);
  assert.equal(invalid.data.errorCode, 'world_projection_invalid'); assert.equal(invalid.data.diagnostics[0].objectId, objectId);
  assert.equal((await send(f.input)).status, 200);
});

test('authored projection templates and commands run without host APIs', async () => {
  const result = await runCommand(process.execPath, ['--experimental-vm-modules', fileURLToPath(new URL('./world-portable-runtime.mjs', import.meta.url)), '--projection']);
  assert.deepEqual(JSON.parse(result.stdout), { unchanged: true, files: 2, speed: 160, core: coreId });
});

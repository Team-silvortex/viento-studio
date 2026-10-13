import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSceneCompositionMaterialization, buildSceneCompositionMaterializationCommand } from '../../engine/scene-composition-materialize.mjs';
import { expandSceneComposition } from '../../engine/scene-composition.mjs';
import { resolveSceneCompositionPreview } from '../../engine/scene-composition-preview.mjs';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { scene2DModelToPlan } from '../../engine/build-plan.mjs';
import { createSceneStructure } from '../../engine/scene-structure.mjs';
import { prepareSceneCreate } from '../../engine/world-scene-create.mjs';
import { validateWorldCommand } from '../../engine/world-command-contract.mjs';

const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v1.json', import.meta.url), 'utf8'));
const example = JSON.parse(await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url), 'utf8'));
const { ids } = golden;
const hash = value => createHash('sha256').update(value).digest('hex');
const revision = value => `sha256:${hash(value)}`;
const uuid = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const serialize = value => '\ufeff' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
const copy = value => structuredClone(value);
const invalid = error => error?.errorCode === 'scene_composition_materialize_invalid';
const conflict = error => error?.errorCode === 'scene_composition_materialize_conflict';
const destination = error => error?.errorCode === 'scene_composition_materialize_destination';
function recipe() {
  const value = copy(example);
  value.fragments[0].actors[0] = { key: 'leader', objectId: ids.first, groupKey: 'party', position: [120.125, 180.25], useProjectionDefaults: true };
  value.fragments[0].actors[1] = { key: 'companion', objectId: ids.second, groupKey: 'companions', position: [200, 180],
    useProjectionDefaults: true, size: [48, 48], speed: 17, color: '#112233', controls: 'arrows', imageResourceId: null };
  value.fragments.push({ fragmentId: 'unused', actors: [{ key: 'dormant', objectId: ids.first,
    position: [0, 0], useProjectionDefaults: true }], groups: [] });
  return value;
}
async function fixture({ value = recipe(), version = 3 } = {}) {
  const observed = copy(golden.observed);
  observed.source.workspace.version = version;
  observed.source.definition = { paths: { documents: version === 3 ? 'documents' : 'design-data', templates: 'templates', metadata: 'metadata' },
    documentTypes: [{ id: 'document', label: '作品说明', directory: '', parserProfile: 'structured' }] };
  if (version === 2) for (const document of observed.source.documents) {
    document.sourcePath = document.sourcePath.replace(/^documents\//, 'design-data/'); document.record.sourcePath = document.sourcePath;
  }
  const document = observed.source.documents.find(item => item.record.id === ids.scene);
  document.record.relations = []; document.record.assetBindings = [];
  document.content = serialize(value); document.sourceRevision = revision(document.content);
  for (const item of observed.source.documents) item.descriptor = { ...item.record };
  observed.projection = await createWorldProjection(observed.source, { digest: hash });
  const resolved = await resolveSceneCompositionPreview(observed, ids.scene, { digest: hash });
  const plan = resolved.ok ? scene2DModelToPlan(resolved.model) : null;
  const preview = plan ? { ok: true, format: 'viento-scene-preview', schemaVersion: 2,
    previewId: uuid(500), snapshotId: revision('captured preview'), scene: plan.scene, actors: plan.actors,
    resources: plan.resources, diagnostics: resolved.diagnostics, sourceLocations: resolved.model.sourceLocations,
    composition: resolved.composition, sceneStructure: createSceneStructure(resolved.model) }
    : { ok: false, previewId: null, diagnostics: resolved.diagnostics, composition: resolved.composition };
  const input = { projection: observed.projection, confirmedWorld: { id: observed.projection.world.id, revision: observed.projection.world.revision },
    recipeId: ids.scene, content: document.content, preview };
  return { input, observed, resolved };
}
const initial = await fixture();
assert.equal(initial.resolved.ok, true, JSON.stringify(initial.resolved.diagnostics));
const create = (input = copy(initial.input), digest = hash) => createSceneCompositionMaterialization(input, { digest });
const target = overrides => ({ objectId: uuid(900), documentType: 'document', sourcePath: 'documents/scenes/materialized.json', ...overrides });

test('saved recipe materializes from actual Rust expansion and resolved preview without changing author bytes', async () => {
  const input = copy(initial.input), before = copy(input), result = await create(input);
  assert.deepEqual(result.scene, expandSceneComposition(input.content).scene);
  assert.equal(result.content, JSON.stringify(result.scene, null, 2) + '\n');
  assert.equal(result.recipe.sourceRevision, revision(input.content)); assert.equal(result.recipe.objectId, ids.scene);
  assert.equal(result.recipe.title, recipe().scene.title); assert.equal(result.documentRoot, 'documents');
  assert.deepEqual(input, before); assert.equal(Object.hasOwn(result, 'previewId'), false);
  assert.equal(Object.hasOwn(result, 'snapshotId'), false); assert.equal(Object.hasOwn(result, 'sourceMap'), false);
});

test('materialization preserves instance and group identity, offsets, inheritance and explicit null', async () => {
  const result = await create(), expanded = expandSceneComposition(initial.input.content).scene;
  assert.deepEqual(result.scene.actors.map(actor => actor.instanceId), expanded.actors.map(actor => actor.instanceId));
  assert.deepEqual(result.scene.groups, expanded.groups);
  assert.deepEqual(result.scene.actors[2].position, [460, 220]);
  assert.equal(result.scene.actors[0].useProjectionDefaults, true);
  for (const field of ['size', 'speed', 'color', 'controls', 'imageResourceId']) assert.equal(Object.hasOwn(result.scene.actors[0], field), false);
  assert.equal(result.scene.actors[1].imageResourceId, null);
  assert.deepEqual(result.scene.actors[1].size, [48, 48]);
  assert.ok(initial.input.preview.actors[0].size, 'resolved preview has inherited values that must not become author overrides');
});

test('seed and command are detached deeply frozen data with no generated execution authority', async () => {
  const input = copy(initial.input), seed = await create(input), before = copy(seed);
  input.projection.objects[0].documentRefs[0].sourcePath = 'documents/changed.txt'; input.preview.actors[0].position[0] = 99;
  assert.deepEqual(seed, before);
  for (const item of [seed, seed.recipe, seed.scene, seed.scene.actors, seed.scene.actors[0], seed.scene.actors[0].position,
    seed.existingPaths, seed.existingIdentities, seed.documentTypes, seed.documentTypes[0]]) assert.equal(Object.isFrozen(item), true);
  const command = buildSceneCompositionMaterializationCommand(seed, target());
  assert.equal(Object.isFrozen(command), true); assert.equal(Object.isFrozen(command.actorRef), true);
  assert.equal(command.command, 'scene.create'); assert.equal(command.mode, 'preview');
  assert.equal(command.worldId, seed.worldId); assert.equal(command.baseRevision, seed.baseRevision);
  assert.deepEqual(command.actorRef, { kind: 'user', id: 'local-ui' });
  assert.deepEqual(validateWorldCommand(command), command);
});

test('independent scene title changes only title while preview and apply retain one identity and revision', async () => {
  const seed = await create(), preview = buildSceneCompositionMaterializationCommand(seed, target({ title: '新场景 / New scene / 新しいシーン' }));
  const apply = buildSceneCompositionMaterializationCommand(seed, target({ title: '新场景 / New scene / 新しいシーン', mode: 'apply' }));
  assert.deepEqual({ ...apply, mode: 'preview' }, preview);
  assert.deepEqual(JSON.parse(preview.content), { ...seed.scene, title: '新场景 / New scene / 新しいシーン' });
  assert.equal(seed.scene.title, recipe().scene.title);
});

test('ordinary scene.create accepts the declaration and plans only a new scene and dependency registration', async () => {
  const seed = await create(), command = buildSceneCompositionMaterializationCommand(seed, target());
  const before = copy(initial.observed.source);
  const prepared = await prepareSceneCreate(initial.observed.source, initial.observed.projection, command, { digest: hash });
  assert.equal(prepared.kind, 'scene.create'); assert.equal(prepared.plans.length, 2);
  assert.equal(prepared.plans[0].sourcePath, command.sourcePath); assert.equal(prepared.plans[0].afterContent, command.content);
  const record = prepared.result.changes[0].record;
  assert.deepEqual(record.relations.map(item => item.targetId).sort(), [ids.first, ids.second].sort());
  assert.equal(record.relations.some(item => item.targetId === ids.scene), false, 'no persistent recipe synchronization relation');
  assert.equal(prepared.nextSource.documents.find(item => item.record.id === ids.scene).content, initial.input.content);
  assert.deepEqual(initial.observed.source, before);
});

test('registered v2 workspaces retain their existing document root', async () => {
  const { input } = await fixture({ version: 2 }), seed = await create(input);
  assert.equal(seed.documentRoot, 'design-data');
  assert.equal(buildSceneCompositionMaterializationCommand(seed, target({ sourcePath: 'design-data/scenes/new.json' })).sourcePath, 'design-data/scenes/new.json');
  assert.throws(() => buildSceneCompositionMaterializationCommand(seed, target()), destination);
});

test('different World identity or any World revision change during preview rejects the capture', async () => {
  for (const field of ['id', 'revision']) {
    const input = copy(initial.input); input.confirmedWorld[field] = field === 'id' ? 'world:other' : revision('new world');
    await assert.rejects(create(input), conflict);
  }
});

test('saved source verification includes BOM and original newlines and never accepts a stale recipe', async () => {
  for (const mutate of [input => { input.content = input.content.replaceAll('\r\n', '\n'); },
    input => { input.content = input.content.slice(1); }, input => { input.content += ' '; },
    input => { input.projection.objects.find(item => item.id === ids.scene).documentRefs[0].sourceRevision = revision('other source'); }]) {
    const input = copy(initial.input); mutate(input); await assert.rejects(create(input), conflict);
  }
});

test('saved preview must belong to the same registered recipe and source observation', async () => {
  for (const mutate of [input => { input.preview.scene.objectId = uuid(99); }, input => { input.preview.scene.sourcePath = 'documents/other.json'; },
    input => { input.preview.scene.sourceRevision = revision('other'); }, input => { input.preview.composition.recipeObjectId = uuid(99); },
    input => { input.preview.composition.sourceRevision = revision('other'); }, input => { input.preview.composition.sourcePath = 'documents/other.json'; }]) {
    const input = copy(initial.input); mutate(input); await assert.rejects(create(input), conflict);
  }
});

test('draft, failed, ordinary scene and capability-bearing previews cannot authorize materialization', async () => {
  for (const mutate of [input => { input.preview.draft = null; }, input => { input.preview.ok = false; },
    input => { delete input.preview.composition; }, input => { input.preview.sceneEditing = {}; }, input => { input.preview.snapshot = {}; },
    input => { input.preview.schemaVersion = 3; }, input => { input.preview.format = 'viento-build-plan'; },
    input => { input.preview.previewId = 'bad'; }, input => { input.preview.snapshotId = 'bad'; },
    input => { input.preview.diagnostics.push({ severity: 'error', code: 'failed' }); }]) {
    const input = copy(initial.input); mutate(input); await assert.rejects(create(input), error => invalid(error) || conflict(error));
  }
});

test('preview actors, declared values, group structure and recipe provenance must match the expansion', async () => {
  for (const mutate of [input => { input.preview.actors.reverse(); }, input => { input.preview.actors[0].position[0]++; },
    input => { input.preview.actors[1].speed++; }, input => { input.preview.actors[1].imageResourceId = ids.image; },
    input => { input.preview.actors.pop(); }, input => { input.preview.sourceLocations.actors[0].composition.localKey = 'other'; },
    input => { input.preview.sourceLocations.actors[0].declaration.sourceRevision = revision('other'); },
    input => { input.preview.sceneStructure.groups[0].name = 'different'; }, input => { input.preview.sceneStructure.memberships.pop(); },
    input => { input.preview.composition.fragmentCount--; }, input => { input.preview.scene.title = 'different'; }]) {
    const input = copy(initial.input); mutate(input); await assert.rejects(create(input), invalid);
  }
});

test('complete saved preview rejects missing dependencies in unused recipe fragments', async () => {
  const value = recipe(); value.fragments[1].actors[0].objectId = uuid(99);
  const { input, resolved } = await fixture({ value });
  assert.equal(resolved.ok, false); assert.ok(resolved.diagnostics.some(item => item.relatedObjectId === uuid(99)));
  await assert.rejects(create(input), invalid);
});

test('recipe registration, type, source format and workspace support are required', async () => {
  for (const mutate of [input => { input.recipeId = uuid(99); }, input => { input.projection.world.sourceWorkspaceVersion = 1; },
    input => { input.projection.objects.find(item => item.id === ids.scene).provenance.identity = 'path-derived'; },
    input => { input.projection.objects.find(item => item.id === ids.scene).provenance.documentType = 'missing'; },
    input => { input.projection.objects.find(item => item.id === ids.scene).documentRefs[0].sourcePath = 'documents/recipe.txt'; },
    input => { input.projection.objects.find(item => item.id === ids.scene).documentRefs[0].sourceRevision = 'sha256:source'; },
    input => { input.projection.objects.push(input.projection.objects.find(item => item.id === ids.scene)); }]) {
    const input = copy(initial.input); mutate(input); await assert.rejects(create(input), invalid);
  }
});

test('new destination uses project types and rejects collisions, traversal and nonportable paths', async () => {
  const seed = await create();
  for (const value of [target({ objectId: ids.scene }), target({ objectId: ids.image }), target({ objectId: 'bad' }),
    target({ documentType: 'missing' }), target({ sourcePath: seed.recipe.sourcePath }),
    target({ sourcePath: seed.recipe.sourcePath.toUpperCase().replace(/^DOCUMENTS\//, 'documents/') }),
    target({ sourcePath: 'documents/scenes/source.json/child.json' }), target({ sourcePath: 'documents/../bad.json' }),
    target({ sourcePath: 'documents/.cache/a.json' }), target({ sourcePath: 'documents/CON.json' }),
    target({ sourcePath: 'documents/node_modules/a.json' }), target({ sourcePath: 'design-data/a.json' }),
    target({ sourcePath: '/tmp/a.json' }), target({ sourcePath: 'documents/a.txt' }), target({ sourcePath: 'documents/a\\b.json' })]) {
    assert.throws(() => buildSceneCompositionMaterializationCommand(seed, value), destination);
  }
});

test('destination title and mode are validated before constructing a command', async () => {
  const seed = await create();
  for (const title of ['', '   ', '\u3000', 'x'.repeat(161), 'invalid\nname', 3]) {
    assert.throws(() => buildSceneCompositionMaterializationCommand(seed, target({ title })), destination);
  }
  for (const mode of ['save', null, '']) assert.throws(() => buildSceneCompositionMaterializationCommand(seed, target({ mode })), destination);
  assert.equal(JSON.parse(buildSceneCompositionMaterializationCommand(seed, target({ title: '雪😀' })).content).title, '雪😀');
});

test('serialized seed remains usable but mismatched generated source or scope is rejected', async () => {
  const seed = await create(); assert.deepEqual(buildSceneCompositionMaterializationCommand(JSON.parse(JSON.stringify(seed)), target()), buildSceneCompositionMaterializationCommand(seed, target()));
  for (const mutate of [value => { value.content += ' '; }, value => { value.scene.title = 'tampered'; },
    value => { value.worldId = ''; }, value => { value.baseRevision = 'bad'; }, value => { value.documentRoot = '/tmp'; },
    value => { value.recipe.sourceRevision = 'bad'; }, value => { value.documentTypes[0].id = 'INVALID'; },
    value => { value.extra = true; }]) {
    const value = copy(seed); mutate(value); assert.throws(() => buildSceneCompositionMaterializationCommand(value, target()), invalid);
  }
});

test('capture detaches catalogue and preview before an asynchronous digest can change inputs', async () => {
  const input = copy(initial.input), before = copy(input); let release;
  const waiting = create(input, value => new Promise(resolve => { release = () => resolve(hash(value)); }));
  input.projection.world.revision = revision('changed'); input.confirmedWorld.revision = revision('changed');
  input.projection.types[0].label = 'changed'; input.preview.scene.title = 'changed'; input.content = '{}';
  release(); const seed = await waiting;
  assert.equal(seed.baseRevision, before.projection.world.revision); assert.equal(seed.scene.title, before.preview.scene.title);
  assert.equal(seed.documentTypes[0].label, before.projection.types[0].label);
});

test('getters, malformed envelopes and invalid digest outputs fail without invoking authored accessors', async () => {
  let reads = 0;
  for (const mutate of [input => Object.defineProperty(input, 'content', { enumerable: true, get() { reads++; return ''; } }),
    input => Object.defineProperty(input.projection.world, 'revision', { enumerable: true, get() { reads++; return ''; } }),
    input => Object.defineProperty(input.preview.actors[0], 'position', { enumerable: true, get() { reads++; return []; } })]) {
    const input = copy(initial.input); mutate(input); await assert.rejects(create(input), invalid);
  }
  assert.equal(reads, 0);
  await assert.rejects(create({ ...copy(initial.input), extra: true }), invalid);
  await assert.rejects(create(copy(initial.input), () => 'bad hash'), invalid);
  await assert.rejects(create(copy(initial.input), () => { throw Error('digest failed'); }), invalid);
  const seed = await create(), targetWithGetter = target();
  Object.defineProperty(targetWithGetter, 'title', { enumerable: true, get() { reads++; return 'name'; } });
  assert.throws(() => buildSceneCompositionMaterializationCommand(seed, targetWithGetter), invalid);
  assert.equal(reads, 0);
});

test('invalid or oversized recipe source yields no partial scene or command', async () => {
  for (const content of ['{}', '{', ' '.repeat(128 * 1024 + 1), '\ud800']) {
    const input = copy(initial.input); input.content = content; await assert.rejects(create(input), invalid);
  }
});

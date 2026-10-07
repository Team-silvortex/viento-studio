import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolveSceneCompositionPreview } from '../../engine/scene-composition-preview.mjs';
import { overlaySceneDraftPreview } from '../../engine/scene-draft-preview.mjs';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { resolveScene2DModel } from '../../engine/scene-model.mjs';

const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v1.json', import.meta.url), 'utf8'));
const example = JSON.parse(await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url), 'utf8'));
const { ids } = golden;
const hash = text => createHash('sha256').update(text).digest('hex');
const revision = text => `sha256:${hash(text)}`;
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const parse = content => JSON.parse(content.replace(/^\uFEFF/, ''));
const document = (observed, id = ids.scene) => observed.source.documents.find(item => item.record?.id === id);
const setText = (observed, text, id = ids.scene) => Object.assign(document(observed, id), { content: text, sourceRevision: revision(text) });
const preview = observed => resolveSceneCompositionPreview(observed, ids.scene, { digest: hash });
function recipe() {
  const value = structuredClone(example);
  value.scene.title = '配方🦊 / Recipe / レシピ';
  value.fragments[0].actors[0] = { key: 'leader', objectId: ids.first, groupKey: 'party', position: [120, 180], useProjectionDefaults: true };
  value.fragments[0].actors[1] = { key: 'companion', objectId: ids.second, groupKey: 'companions', position: [200, 180],
    useProjectionDefaults: true, size: [48, 48], speed: 17, color: '#112233', controls: 'arrows', imageResourceId: null };
  return value;
}
async function fixture(value = recipe()) {
  const observed = structuredClone(golden.observed);
  observed.source.workspace.version = 3;
  observed.source.definition = { documentTypes: [{ id: 'document', label: 'Document' }] };
  document(observed).record.relations = [];
  document(observed).record.assetBindings = [];
  setText(observed, typeof value === 'string' ? value : serialize(value));
  for (const source of observed.source.documents) source.descriptor = { ...source.record };
  observed.projection = await createWorldProjection(observed.source, { digest: hash });
  return observed;
}
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freeze(nested);
  return Object.freeze(value);
}
function span(location, observed, { pointer = location.propertyPath, anchor = pointer, exact = true, raw } = {}) {
  const source = document(observed, location.objectId);
  assert.equal(location.sourcePath, source.sourcePath);
  assert.equal(location.sourceRevision, source.sourceRevision);
  assert.equal(location.propertyPath, pointer);
  const range = location.sourceRange;
  assert.ok(range, JSON.stringify(location));
  assert.equal(range.encoding, 'utf-16');
  assert.equal(range.propertyPath, anchor);
  assert.equal(range.exact, exact);
  assert.ok(Number.isInteger(range.start) && Number.isInteger(range.end));
  assert.ok(range.start >= 0 && range.end > range.start && range.end <= source.content.length);
  const text = source.content.slice(range.start, range.end);
  if (raw !== undefined) assert.equal(text, raw);
  return text;
}
function noSyntheticLeaks(value, observed) {
  const visit = item => {
    if (!item || typeof item !== 'object') return;
    assert.equal(Object.hasOwn(item, 'snapshot'), false);
    assert.equal(Object.hasOwn(item, 'sceneEditing'), false);
    for (const key of ['content', 'sourceText', 'rawContent', 'cst', 'tokens']) assert.equal(Object.hasOwn(item, key), false);
    if (item.objectId === ids.scene && typeof item.propertyPath === 'string') {
      assert.ok(!/^\/(actors|groups)(?:\/|$)/.test(item.propertyPath), item.propertyPath);
      assert.equal(item.sourceRevision, document(observed).sourceRevision);
      if (item.sourceRange) assert.ok(!/^\/(actors|groups)(?:\/|$)/.test(item.sourceRange.propertyPath), JSON.stringify(item));
    }
    for (const nested of Object.values(item)) visit(nested);
  };
  visit(value);
  assert.ok(!JSON.stringify(value).includes('PRIVATE_AUTHOR_BODY_ONLY_IN_DOCUMENT'));
}
async function valid(observed) {
  const before = structuredClone(observed), result = await preview(freeze(observed));
  assert.equal(result.recognized, true);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(observed, before);
  noSyntheticLeaks(result, observed);
  return result;
}
async function invalid(observed, expected = {}) {
  const before = structuredClone(observed), result = await preview(freeze(observed));
  assert.equal(result.recognized, true);
  assert.equal(result.ok, false);
  assert.equal(result.model, null);
  assert.ok(result.diagnostics.length);
  assert.deepEqual(observed, before);
  noSyntheticLeaks(result, observed);
  if (expected.code) assert.ok(result.diagnostics.some(item => item.code === expected.code), JSON.stringify(result.diagnostics));
  if (expected.pointer) assert.ok(result.diagnostics.some(item => item.propertyPath === expected.pointer), JSON.stringify(result.diagnostics));
  return result;
}

test('recipe preview derives a v3 scene without mutating registered source or returning an executable snapshot', async () => {
  const observed = await fixture(), { model, composition } = await valid(observed);
  assert.equal(model.schemaVersion, 3);
  assert.equal(model.actors.length, 4);
  assert.equal(model.groups.length, 4);
  assert.equal(model.worldRevision, observed.projection.world.revision);
  assert.equal(model.scene.sourceRevision, document(observed).sourceRevision);
  assert.deepEqual(composition, { format: 'viento-scene-composition-preview', schemaVersion: 1, recipeObjectId: ids.scene,
    sourcePath: document(observed).sourcePath, sourceRevision: document(observed).sourceRevision, fragmentCount: 1, placementCount: 2 });
  assert.equal(model.resources.length, 1);
  assert.deepEqual(document(observed).record.relations, []);
  assert.deepEqual(document(observed).record.assetBindings, []);
  const secondPlacement = recipe().placements[1];
  assert.deepEqual(model.actors.map(actor => actor.instanceId), recipe().placements.flatMap(placement => Object.values(placement.actorIds)));
  assert.deepEqual(model.actors[2].position, [460, 220]);
  assert.deepEqual(model.sourceLocations.actors[2].composition, { fragmentId: 'party', placementId: secondPlacement.placementId, localKey: 'leader' });
  assert.deepEqual(model.sourceLocations.groups[3].composition, { fragmentId: 'party', placementId: secondPlacement.placementId, localKey: 'companions' });
  model.actors[0].position[0] = 999;
  assert.deepEqual((await preview(observed)).model.actors[0].position, [120, 180], 'returned model has no shared mutable state');
});

test('recipe title, viewport, background and declarations retain exact BOM, CRLF and UTF-16 author locations', async () => {
  const observed = await fixture(), { model } = await valid(observed), locations = model.sourceLocations;
  assert.equal(locations.scene.sourceRange.start, 1);
  span(locations.sceneFields.title, observed, { pointer: '/scene/title', raw: '"配方🦊 / Recipe / レシピ"' });
  assert.deepEqual(JSON.parse(span(locations.sceneFields.viewport, observed, { pointer: '/scene/viewport' })), [800, 480]);
  span(locations.sceneFields.background, observed, { pointer: '/scene/background', raw: '"#0d1829"' });
  const declaration = locations.actors[0].declaration;
  span(declaration, observed, { pointer: '/fragments/0/actors/0', exact: false });
  assert.ok(declaration.contributors.some(value => value.propertyPath === '/placements/0/actorIds/leader' && value.role === 'identity'));
  for (const contributor of declaration.contributors) span(contributor, observed);
  const position = locations.actors[0].fields.position;
  assert.notEqual(position.sourceRange.start, Buffer.byteLength(document(observed).content.slice(0, position.sourceRange.start)));
  span(position, observed, { pointer: '/fragments/0/actors/0/position' });
});

test('position offsets and overrides expose independently exact contributor navigation', async () => {
  const observed = await fixture(), { model } = await valid(observed);
  const changed = model.sourceLocations.actors[2].fields.position;
  span(changed, observed, { pointer: '/placements/1/overrides/0/values/position', exact: false });
  assert.deepEqual(changed.contributors.map(value => [value.propertyPath, value.role]), [
    ['/placements/1/overrides/0/values/position', 'override'], ['/placements/1/offset', 'offset'],
  ]);
  assert.deepEqual(changed.contributors.map(value => JSON.parse(span(value, observed))), [[100, 140], [360, 80]]);
  const inherited = model.sourceLocations.actors[3].fields.position;
  assert.deepEqual(inherited.contributors.map(value => [value.propertyPath, value.role]), [
    ['/fragments/0/actors/1/position', 'template'], ['/placements/1/offset', 'offset'],
  ]);
  for (const contributor of inherited.contributors) span(contributor, observed);
  assert.deepEqual(model.actors[2].fieldSources.position, changed);
  span(model.sourceLocations.actors[2].fields.color, observed, { pointer: '/placements/1/overrides/0/values/color', raw: '"#f1c46e"' });
});

test('projection dimensions, core origins and inherited images retain their original definition locations', async () => {
  const observed = await fixture(), { model } = await valid(observed), first = model.sourceLocations.actors[0];
  assert.deepEqual(model.actors[0].size, [80, 60]);
  span(first.fields.size, observed, { pointer: '/configuration', exact: false });
  span(first.fields['size/0'], observed, { pointer: '/configuration/width', raw: '80' });
  span(first.fields['size/1'], observed, { pointer: '/configuration/height', raw: '60' });
  span(first.fields.speed, observed, { pointer: '/configuration/speed', raw: '1.6e2' });
  span(first.fields.imageResourceId, observed, { pointer: '/configuration/image', raw: JSON.stringify(ids.image) });
  assert.equal(first.fields.size.objectId, ids.first);
  assert.equal(first.fields.size.contributors, undefined);
  assert.deepEqual(model.actors[0].origin, { objectId: ids.core, sourcePath: document(observed, ids.core).sourcePath,
    sourceRevision: document(observed, ids.core).sourceRevision });
  span(model.sourceLocations.actors[1].fields['size/1'], observed, { pointer: '/fragments/0/actors/1/size/1', raw: '48' });
  span(model.sourceLocations.actors[1].fields.imageResourceId, observed, { pointer: '/fragments/0/actors/1/imageResourceId', raw: 'null' });
  assert.equal(model.actors[1].imageResourceId, undefined);
});

test('group name and parent identity navigate the recipe rather than generated group indices', async () => {
  const observed = await fixture(), { model } = await valid(observed), group = model.sourceLocations.groups[3];
  span(group.fields.name, observed, { pointer: '/fragments/0/groups/1/name', raw: '"Companions / 同行者"' });
  span(group.fields.parentGroupId, observed, { pointer: '/fragments/0/groups/1/parentKey', exact: false, raw: '"party"' });
  assert.deepEqual(group.fields.parentGroupId.contributors.map(value => [value.propertyPath, value.role]), [
    ['/fragments/0/groups/1/parentKey', 'template'], ['/placements/1/groupIds/party', 'identity'],
  ]);
  for (const value of group.fields.parentGroupId.contributors) span(value, observed);
  for (const value of group.declaration.contributors) span(value, observed);
});

test('saved and externally overlaid draft recipes share the resolver while retaining independent raw revisions', async () => {
  const observed = await fixture(), before = structuredClone(observed), value = recipe();
  value.scene.title = '未保存の配方 🎭'; value.placements[1].offset = [400, 90];
  const content = serialize(value), saved = await preview(observed);
  const effective = await overlaySceneDraftPreview(freeze(observed), ids.scene, { sourcePath: document(observed).sourcePath,
    baseSourceRevision: document(observed).sourceRevision, content }, { digest: hash });
  const draft = await valid(effective);
  assert.equal(draft.model.scene.title, value.scene.title);
  assert.deepEqual(draft.model.actors[2].position, [500, 230]);
  assert.equal(draft.composition.sourceRevision, revision(content));
  assert.equal(draft.model.worldRevision, effective.projection.world.revision);
  assert.notEqual(draft.composition.sourceRevision, saved.composition.sourceRevision);
  assert.notEqual(draft.model.worldRevision, saved.model.worldRevision);
  assert.deepEqual(draft.model.sourceLocations.actors[0].definition, saved.model.sourceLocations.actors[0].definition);
  assert.deepEqual(observed, before);
});

test('removing top-level format exits recipe mode regardless of the file name or nested examples', async () => {
  const value = recipe(); delete value.format; value.example = { format: 'viento-scene-composition' };
  for (const content of [serialize(value), document(golden.observed).content, '# viento-scene-composition']) {
    const observed = await fixture(content), before = structuredClone(observed), result = await preview(freeze(observed));
    assert.deepEqual(result, { recognized: false, ok: true, model: null, diagnostics: [], composition: null });
    assert.deepEqual(observed, before);
  }
  assert.equal(resolveScene2DModel(golden.observed, ids.scene).ok, true, 'ordinary scene path is unaffected');
});

test('registered JSON in current workspace versions is required, with exact source revision validation', async () => {
  const v2 = await fixture(); v2.source.workspace.version = 2;
  assert.equal((await valid(v2)).ok, true);
  for (const mutate of [
    observed => { observed.source.workspace.version = 1; },
    observed => { document(observed).sourcePath = 'documents/recipe.md'; },
    observed => { observed.projection.objects = observed.projection.objects.filter(object => object.id !== ids.scene); },
  ]) { const observed = await fixture(); mutate(observed); await invalid(observed, { code: 'composition-document-invalid' }); }
  const mismatch = await fixture(); document(mismatch).sourceRevision = `sha256:${'0'.repeat(64)}`;
  const result = await preview(freeze(mismatch));
  assert.equal(result.ok, false); assert.equal(result.model, null);
  assert.equal(result.diagnostics[0].sourceRevision, revision(document(mismatch).content));
});

test('Rust rejects partial JSON, unknown fields, decoded duplicate keys and unsupported versions without a partial model', async () => {
  const unknown = recipe(); unknown.fragments[0].actors[0].invented = true;
  const version = recipe(); version.schemaVersion = 2;
  const duplicate = serialize(recipe()).replace('"position":', '"posi\\u0074ion": [1,2],\r\n\t\t\t\t"position":');
  for (const content of [serialize(unknown), serialize(version), duplicate, '{"format":"viento-scene-composition","scene":']) {
    const result = await invalid(await fixture(content), { code: 'composition-document-invalid' });
    assert.equal(result.composition, null);
    assert.equal(result.diagnostics[0].propertyPath, '');
    assert.equal(result.diagnostics[0].reasonCode, 'scene_composition_invalid');
  }
});

test('all declared dependencies are validated, including unused fragments, shadowed images, self references and nested recipes', async () => {
  const missingId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  for (const mutate of [
    value => { value.fragments[0].actors[0].objectId = missingId; },
    value => { value.fragments[0].actors[0].objectId = ids.scene; },
    value => { value.fragments.push({ fragmentId: 'unused', groups: [], actors: [{ key: 'unused', objectId: missingId, position: [0, 0], useProjectionDefaults: true }] }); },
    value => { value.fragments[0].actors[0].imageResourceId = missingId; value.placements[0].overrides = [{ actorKey: 'leader', values: { imageResourceId: null } }]; },
  ]) { const value = recipe(); mutate(value); await invalid(await fixture(value), { code: 'composition-document-invalid' }); }
  const nested = await fixture(); setText(nested, '{"format":"viento-scene-composition"}', ids.first);
  await invalid(nested, { code: 'composition-document-invalid', pointer: '/fragments/0/actors/0/objectId' });
  const wrongKind = recipe(); wrongKind.fragments[0].actors[0].imageResourceId = ids.image;
  const observed = await fixture(wrongKind); observed.source.assets[0].record.kind = 'audio';
  await invalid(observed, { code: 'composition-document-invalid', pointer: '/fragments/0/actors/0/imageResourceId' });
});

test('runtime failures remap recipe diagnostics and retain inherited projection failures at their real sources', async () => {
  const value = recipe(); value.fragments[0].actors[0].imageResourceId = ids.image;
  const unsupported = await fixture(value); unsupported.source.assets[0].record.location.path = 'unsupported.gif';
  const result = await invalid(unsupported, { code: 'build_image_unsupported', pointer: '/fragments/0/actors/0/imageResourceId' });
  span(result.diagnostics.find(item => item.propertyPath === '/fragments/0/actors/0/imageResourceId'), unsupported, { raw: JSON.stringify(ids.image) });
  const inherited = await fixture(), definition = parse(document(inherited, ids.first).content);
  definition.configuration.height = 4096; setText(inherited, serialize(definition), ids.first);
  const badProjection = await invalid(inherited, { pointer: '/configuration/height' });
  span(badProjection.diagnostics.find(item => item.propertyPath === '/configuration/height'), inherited, { raw: '4096' });
});

test('deriving references preserves authored relation and binding errors instead of silently discarding them', async () => {
  const missingId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  for (const mutate of [
    record => record.relations.push({ kind: 'references', targetId: missingId, slot: 'authored' }),
    record => record.assetBindings.push({ assetId: missingId, role: 'authored' }),
  ]) {
    const observed = await fixture(); mutate(document(observed).record);
    const result = await invalid(observed);
    assert.ok(result.diagnostics.some(item => ['relation-target-missing', 'resource-target-missing'].includes(item.code)), JSON.stringify(result.diagnostics));
  }
});

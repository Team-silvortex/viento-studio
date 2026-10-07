import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectSceneComposition, validateSceneCompositionDependencies } from '../../engine/scene-composition-document.mjs';

const id = number => `${number.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const run = promisify(execFile);
function recipe() {
  return { format: 'viento-scene-composition', schemaVersion: 1,
    scene: { title: 'Scene / 场景 / 場面', viewport: [640, 480], background: '#000000' },
    fragments: [{ fragmentId: 'cast', actors: [
      { key: 'first', objectId: id(2), position: [10, 20], useProjectionDefaults: true, imageResourceId: id(5) },
      { key: 'second', objectId: id(1), position: [30, 40], useProjectionDefaults: true },
    ], groups: [] }, { fragmentId: 'unused', actors: [
      { key: 'unused', objectId: id(3), position: [50, 60], useProjectionDefaults: true, imageResourceId: id(4) },
    ], groups: [] }], placements: [
      { placementId: id(100), fragmentId: 'cast', actorIds: { first: id(101), second: id(102) }, groupIds: {},
        overrides: [{ actorKey: 'first', values: { imageResourceId: id(6) } }, { actorKey: 'second', values: { imageResourceId: null } }] },
    ] };
}
const inspect = value => inspectSceneComposition(typeof value === 'string' ? value : JSON.stringify(value));
function availableSource() {
  return { documents: [1, 2, 3].map(number => ({ record: { id: id(number), type: 'character' }, content: `# Character ${number}` })),
    assets: [4, 5, 6].map(number => ({ record: { id: id(number), kind: 'image' } })) };
}
function assertOrdinary(content) {
  assert.deepEqual(inspectSceneComposition(content), { recognized: false, ok: true, value: null,
    dependencies: { objectIds: [], imageResourceIds: [] }, diagnostics: [] });
}
function assertInvalid(content, reasonCode) {
  const checked = inspect(content);
  assert.equal(checked.recognized, true);
  assert.equal(checked.ok, false);
  assert.equal(checked.value, null);
  assert.deepEqual(checked.dependencies, { objectIds: [], imageResourceIds: [] });
  assert.equal(checked.diagnostics.length, 1);
  assert.equal(checked.diagnostics[0].severity, 'error');
  assert.equal(checked.diagnostics[0].code, 'composition-document-invalid');
  assert.equal(checked.diagnostics[0].propertyPath, '');
  if (reasonCode) assert.equal(checked.diagnostics[0].reasonCode, reasonCode);
  return checked;
}

test('composition document inspection retains the author declaration and derives all declared dependencies', () => {
  const value = recipe(), content = '\uFEFF' + JSON.stringify(value, null, 2).replaceAll('\n', '\r\n') + '\r\n';
  const checked = inspect(content);
  assert.equal(checked.recognized, true);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.value, value);
  assert.equal(checked.value.scene.title, 'Scene / 场景 / 場面');
  assert.deepEqual(checked.dependencies, { objectIds: [id(1), id(2), id(3)], imageResourceIds: [id(4), id(5), id(6)] });
  assert.deepEqual(checked.diagnostics, []);
  // The unused fragment and a shadowed template image are retained. Placement
  // identities and explicit null are not resource dependencies.
  assert.ok(!checked.dependencies.objectIds.includes(id(101)));
  assert.ok(!checked.dependencies.imageResourceIds.includes(null));
  assert.equal(content.startsWith('\uFEFF'), true);
  assert.equal(content.includes('\r\n'), true);
});

test('composition dependency union is deduplicated, sorted and independent of fragment or placement order', () => {
  const value = recipe();
  value.fragments[1].actors.push({ ...value.fragments[1].actors[0], key: 'repeat' });
  const second = structuredClone(value.placements[0]);
  second.placementId = id(200); second.actorIds = { first: id(201), second: id(202) };
  value.placements.push(second);
  const expected = inspect(value).dependencies;
  value.fragments.reverse(); value.placements.reverse(); value.fragments[0].actors.reverse();
  assert.deepEqual(inspect(value).dependencies, expected);
  assert.deepEqual(expected, { objectIds: [id(1), id(2), id(3)], imageResourceIds: [id(4), id(5), id(6)] });
  const other = inspect(value);
  other.dependencies.objectIds.length = 0;
  other.value.fragments.length = 0;
  assert.deepEqual(inspect(value).dependencies, expected, 'Inspections expose detached state');
});

test('only the current top-level format selects the recipe workflow', () => {
  for (const content of [undefined, null, 42, '', '# A recipe tutorial: viento-scene-composition',
    '"viento-scene-composition"', '[]', '[{"format":"viento-scene-composition"}]',
    '{"example":{"format":"viento-scene-composition"}}',
    '{"format":"ordinary-json","example":{"format":"viento-scene-composition"}}',
    '{"text":"\\\"format\\\":\\\"viento-scene-composition\\\""}',
    '{"example":{"format":"viento-scene-composition"},"unfinished":',
    '{"text":"viento-scene-composition","unfinished":',
  ]) assertOrdinary(content);
  const value = recipe();
  delete value.format;
  assertOrdinary(JSON.stringify(value));
  value.format = 'viento-scene2d';
  assertOrdinary(JSON.stringify(value));
});

test('malformed recipes remain recognized from top-level markers including escaped keys and values', () => {
  for (const content of [
    '{"format":"viento-scene-composition",',
    '\uFEFF {"format":"viento-scene-composition","scene":',
    '{"for\\u006dat":"viento-scene-composition",',
    '{"format":"viento-scene-\\u0063omposition","bad":',
    '{"example":{"value":1},"format":"viento-scene-composition","bad":',
    '{"format":"viento-scene-composition","text":"unfinished',
    '{"format":"viento-scene-composition"}',
  ]) assertInvalid(content, 'scene_composition_invalid');
});

test('Rust validation remains authoritative and failed inspection exposes no partial dependencies', () => {
  const original = JSON.stringify(recipe());
  assertInvalid(original.replace('"scene":', '"sc\\u0065ne":{},"scene":'), 'scene_composition_invalid');
  assertInvalid(original.replace('Scene / 场景 / 場面', '\\ud800'), 'scene_composition_invalid');
  assertInvalid(original.replace('Scene / 场景 / 場面', '\ud800'), 'scene_composition_invalid');
  assertInvalid(original + ' '.repeat(131073), 'scene_composition_limit');
  const invalid = recipe(); invalid.fragments[1].actors[0].position = [100001, 0];
  assertInvalid(invalid, 'scene_composition_invalid');
  invalid.fragments[1].actors[0].position = [0, 0];
  assert.equal(inspect(invalid).ok, true, 'Repair restores dependency inspection');
});

test('composition inspection does not require the Rust core for ordinary source and diagnoses unavailable recipe core', async () => {
  const helper = new URL('../../engine/scene-composition-document.mjs', import.meta.url).href;
  const script = `import {inspectSceneComposition,validateSceneCompositionDependencies} from ${JSON.stringify(helper)};
    const ordinary=inspectSceneComposition('{"format":"ordinary"}');
    const recipe=inspectSceneComposition(${JSON.stringify(JSON.stringify(recipe()))});
    console.log(JSON.stringify({ordinary,recipe,diagnostics:validateSceneCompositionDependencies(recipe,{},{} )}));`;
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], { timeout: 30000, maxBuffer: 65536 });
  const result = JSON.parse(stdout);
  assert.equal(result.ordinary.recognized, false);
  assert.equal(result.ordinary.ok, true);
  assert.equal(result.recipe.recognized, true);
  assert.equal(result.recipe.ok, false);
  assert.equal(result.recipe.diagnostics[0].reasonCode, 'studio_core_unavailable');
  assert.deepEqual(result.recipe.dependencies, { objectIds: [], imageResourceIds: [] });
  assert.deepEqual(result.diagnostics, result.recipe.diagnostics);
});

test('read-only derived references need available records but no authored relation or asset binding', () => {
  const checked = inspect(recipe()), record = { id: id(900), relations: [], assetBindings: [] }, source = availableSource();
  // Projection classification is permitted here. Its closure is validated by
  // the existing projection/package workflow rather than this helper.
  source.documents[0].content = '{"format":"viento-object-projection"}';
  const before = structuredClone({ checked, record, source });
  assert.deepEqual(validateSceneCompositionDependencies(checked, record, source), []);
  assert.deepEqual({ checked, record, source }, before);
  source.documents[0].content = '';
  assert.deepEqual(validateSceneCompositionDependencies(checked, record, source), [], 'An empty registered document still has available source');
});

test('composition object dependencies reject missing source, self and another recipe including marker-only classification', () => {
  const checked = inspect(recipe()), own = { id: id(900) };
  for (const replacement of [undefined, null, 3, '{"format":"viento-scene-composition"}', '{"format":"viento-scene-composition",']) {
    const source = availableSource(); source.documents[0].content = replacement;
    const diagnostics = validateSceneCompositionDependencies(checked, own, source);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].relatedObjectId, id(1));
    assert.equal(diagnostics[0].propertyPath, '/fragments/0/actors/1/objectId');
    assert.equal(diagnostics[0].code, 'composition-document-invalid');
  }
  const source = availableSource(); source.documents.splice(1, 1);
  assert.equal(validateSceneCompositionDependencies(checked, own, source)[0].relatedObjectId, id(2));
  const self = validateSceneCompositionDependencies(checked, { id: id(3) }, availableSource());
  assert.equal(self.length, 1);
  assert.equal(self[0].relatedObjectId, id(3));
  assert.equal(self[0].propertyPath, '/fragments/1/actors/0/objectId');
  // A marker nested inside an ordinary character document is not a recipe.
  const ordinary = availableSource(); ordinary.documents[0].content = '{"example":{"format":"viento-scene-composition"}}';
  assert.deepEqual(validateSceneCompositionDependencies(checked, own, ordinary), []);
});

test('all template and override images are validated as registered images with precise declaration paths', () => {
  const checked = inspect(recipe()), record = { id: id(900) };
  const expected = [
    [4, '/fragments/1/actors/0/imageResourceId'],
    [5, '/fragments/0/actors/0/imageResourceId'],
    [6, '/placements/0/overrides/0/values/imageResourceId'],
  ];
  for (const [number, pointer] of expected) {
    for (const kind of ['audio', 'video', 'document', undefined]) {
      const source = availableSource(); source.assets.find(item => item.record.id === id(number)).record.kind = kind;
      const diagnostics = validateSceneCompositionDependencies(checked, record, source);
      assert.equal(diagnostics.length, 1);
      assert.equal(diagnostics[0].resourceId, id(number));
      assert.equal(diagnostics[0].propertyPath, pointer);
    }
    const source = availableSource(); source.assets = source.assets.filter(item => item.record.id !== id(number));
    assert.equal(validateSceneCompositionDependencies(checked, record, source)[0].resourceId, id(number));
  }
});

test('ordinary and invalid inspected sources produce no invented dependency errors', () => {
  assert.deepEqual(validateSceneCompositionDependencies(inspectSceneComposition('{}'), {}, {}), []);
  assert.deepEqual(validateSceneCompositionDependencies(null, {}, {}), []);
  const checked = assertInvalid('{"format":"viento-scene-composition"}', 'scene_composition_invalid');
  assert.deepEqual(validateSceneCompositionDependencies(checked, {}, {}), checked.diagnostics);
  const diagnostics = validateSceneCompositionDependencies(inspect(recipe()), {}, {});
  assert.deepEqual(diagnostics.map(value => value.relatedObjectId || value.resourceId), [id(1), id(2), id(3), id(4), id(5), id(6)]);
});

import '../adapters/node-studio-core.mjs';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { resolveSceneCompositionPreview } from '../../engine/scene-composition-preview.mjs';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { scene2DModelToPlan } from '../../engine/build-plan.mjs';
import { createSceneStructure } from '../../engine/scene-structure.mjs';

const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v1.json', import.meta.url), 'utf8'));
const example = JSON.parse(await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url), 'utf8'));
export const ids = golden.ids;
export const copy = value => JSON.parse(JSON.stringify(value));
export const hash = text => createHash('sha256').update(text).digest('hex');
export const revision = text => `sha256:${hash(text)}`;
export const decoded = text => JSON.parse(text.replace(/^\uFEFF/, ''));
export async function groupsFixture({ dirty = false, noGroups = false, deep = false } = {}) {
  const observed = copy(golden.observed), recipe = copy(example);
  observed.source.workspace.version = 3; observed.source.definition = { documentTypes: [{ id: 'document', label: 'Document' }] };
  recipe.fragments[0].actors[0].objectId = ids.first; recipe.fragments[0].actors[0].useProjectionDefaults = true;
  recipe.fragments[0].actors[1].objectId = ids.core;
  recipe.placements[0].offset = [0, 0]; recipe.placements[0].overrides = [{ actorKey: 'leader', values: {
    imageResourceId: null, controls: 'none', speed: 0, color: '#aabbcc', size: [30, 40], position: [20, 30],
  } }];
  recipe.placements[1].overrides = [];
  recipe.fragments[0].groups.push({ key: 'spare', name: '  Spare  ', parentKey: 'party' });
  recipe.placements.forEach((placement, index) => { placement.groupIds.spare = `3000000${index + 4}-1111-4111-8111-111111111111`; });
  if (noGroups) { recipe.fragments[0].groups = []; for (const actor of recipe.fragments[0].actors) delete actor.groupKey; for (const placement of recipe.placements) placement.groupIds = {}; }
  if (deep) {
    recipe.fragments[0].groups = Array.from({ length: 16 }, (_, index) => ({ key: `level${index}`, name: `Level ${index}`, ...(index ? { parentKey: `level${index - 1}` } : {}) }));
    for (const actor of recipe.fragments[0].actors) actor.groupKey = 'level0';
    recipe.placements.forEach((placement, p) => { placement.groupIds = Object.fromEntries(recipe.fragments[0].groups.map((group, index) => [group.key, `40000${String(p * 16 + index).padStart(3, '0')}-1111-4111-8111-111111111111`])); });
  }
  const unused = { ...copy(recipe.fragments[0]), fragmentId: 'unused', groups: [{ key: 'lonely', name: 'Unused leaf' }] };
  for (const actor of unused.actors) delete actor.groupKey;
  recipe.fragments.push(unused);
  const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
  const saved = serialize(recipe), content = dirty ? saved.replace('Two parties', '未保存😀') : saved;
  const document = observed.source.documents.find(item => item.record.id === ids.scene);
  document.record.relations = []; document.record.assetBindings = []; document.content = content; document.sourceRevision = revision(content);
  for (const item of observed.source.documents) item.descriptor = { ...item.record };
  observed.projection = await createWorldProjection(observed.source, { digest: hash });
  const result = await resolveSceneCompositionPreview(observed, ids.scene, { digest: hash });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const plan = scene2DModelToPlan(result.model), baseSourceRevision = revision(saved);
  const model = { ok: true, format: 'viento-scene-preview', schemaVersion: 2, previewId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    scene: plan.scene, actors: plan.actors, composition: result.composition, sourceLocations: result.model.sourceLocations,
    sceneStructure: createSceneStructure(result.model), resources: [], diagnostics: [],
    ...(dirty ? { draft: { baseSourceRevision, sourceRevision: revision(content) } } : {}) };
  return { model, recipe: decoded(content), observed, saved, source: { sourcePath: document.sourcePath, content, baseSourceRevision },
    actorId: model.actors[0].instanceId };
}

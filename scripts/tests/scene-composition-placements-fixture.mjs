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
export async function placementsFixture({ dirty = false, single = false, noOffset = false } = {}) {
  const observed = copy(golden.observed), recipe = copy(example);
  observed.source.workspace.version = 3; observed.source.definition = { documentTypes: [{ id: 'document', label: 'Document' }] };
  recipe.fragments[0].actors[0].objectId = ids.first; recipe.fragments[0].actors[0].useProjectionDefaults = true;
  recipe.fragments[0].actors[1].objectId = ids.core;
  recipe.placements[0].offset = [0, 0]; recipe.placements[0].overrides = [{ actorKey: 'leader', values: {
    imageResourceId: null, controls: 'none', speed: 0, color: '#aabbcc', size: [30, 40], position: [20, 30],
  } }];
  recipe.placements[1].overrides = [];
  if (single) recipe.placements.splice(1);
  if (noOffset) delete recipe.placements[0].offset;
  recipe.fragments.push({ ...copy(recipe.fragments[0]), fragmentId: 'unused' });
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

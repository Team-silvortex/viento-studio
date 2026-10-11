// Recipe positions share one Rust geometry history. The source remains an
// author-owned draft; only a fully checked position batch may replace it.
import { createSceneCompositionOverrideDraft } from './scene-composition-overrides.mjs';
import { expandSceneComposition } from './scene-composition.mjs';
import { createSceneGeometryDraft, moveSceneSelection, alignSceneSelection } from './scene-layout.mjs';
import { dispatchStudioCoreCompositionPositions, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
import { canonicalJson } from './canonical-json.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const fail = (code = 'scene_composition_override_invalid') => {
  throw Object.assign(new TypeError('The position batch does not match the current recipe source.'), { errorCode: code });
};
const invalid = () => fail('scene_layout_position_invalid');
const conflict = () => fail('scene_composition_override_conflict');
const unchanged = () => fail('scene_composition_override_unchanged');
function clone(value) { try { return JSON.parse(JSON.stringify(value)); } catch { fail(); } }
function pair(value) {
  if (!Array.isArray(value) || value.length !== 2 || Array.from(value).some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 100000)) invalid();
  return [...value];
}
function sourceSnapshot(source) {
  if (!exact(source, ['sourcePath', 'baseSourceRevision', 'content']) || typeof source.sourcePath !== 'string'
    || !source.sourcePath.length || source.sourcePath.length > 4096 || !source.sourcePath.toLowerCase().endsWith('.json')
    || !revision(source.baseSourceRevision) || typeof source.content !== 'string') fail();
  if (source.content.length > 128 * 1024 || new TextEncoder().encode(source.content).length > 128 * 1024) fail('scene_composition_override_content_limit');
  for (const character of source.content) if (character.codePointAt(0) >= 0xd800 && character.codePointAt(0) <= 0xdfff) fail();
  return { ...source };
}
async function hash(content, digest) {
  if (typeof digest !== 'function') fail();
  const value = await digest(content);
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail();
  return `sha256:${value}`;
}
function sourceTargets(content) {
  const expanded = expandSceneComposition(content), parsed = JSON.parse(content.replace(/^\uFEFF/, ''));
  const placements = new Map(parsed.placements.map((placement, index) => [placement.placementId, { placement, index }]));
  const fragments = new Map(parsed.fragments.map(fragment => [fragment.fragmentId, fragment]));
  return expanded.sourceMap.actors.map(entry => {
    const { placement, index } = placements.get(entry.placementId);
    const actor = fragments.get(entry.fragmentId).actors.find(actor => actor.key === entry.localKey);
    const override = placement.overrides?.find(override => override.actorKey === entry.localKey);
    return { instanceId: entry.instanceId, placementId: entry.placementId, actorKey: entry.localKey,
      fragmentId: entry.fragmentId, placementIndex: index, initialLocal: [...(override?.values.position || actor.position)],
      offset: [...(placement.offset || [0, 0])] };
  });
}
function patch(content, changes) {
  return dispatchStudioCoreCompositionPositions({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'sceneComposition.patchPositions', content,
    changes: changes.map(({ placementId, actorKey, position }) => ({ placementId, actorKey, position: [...position] })) });
}

/** One current-source binding, all recipe instances, one atomic history. */
export async function createSceneCompositionBatchLayoutDraft(model, source, { digest } = {}) {
  const preview = clone(model), before = sourceSnapshot(source);
  // The existing binding checks all actor values/structure and the source
  // revision once. It does not allocate a geometry session or write a file.
  await createSceneCompositionOverrideDraft(preview, before, preview.actors?.[0]?.instanceId, { digest });
  const ordered = sourceTargets(before.content), targets = new Map();
  for (const [index, target] of ordered.entries()) {
    const actor = preview.actors[index], provenance = preview.sourceLocations?.actors?.find(item => item.instanceId === target.instanceId);
    if (!provenance || provenance.objectId !== actor.objectId
      || !exact(provenance.composition, ['fragmentId', 'placementId', 'localKey'])
      || provenance.composition.fragmentId !== target.fragmentId || provenance.composition.placementId !== target.placementId
      || provenance.composition.localKey !== target.actorKey || provenance.declaration?.objectId !== preview.scene.objectId
      || provenance.declaration?.sourcePath !== before.sourcePath || provenance.declaration?.sourceRevision !== preview.composition.sourceRevision) fail();
    target.initialWorld = [...actor.position]; targets.set(target.instanceId, target);
  }
  const geometry = createSceneGeometryDraft(preview.actors, preview.actors);
  const localAt = (target, world) => world.map((coordinate, axis) => coordinate === target.initialWorld[axis]
    ? target.initialLocal[axis] : coordinate - target.offset[axis]);
  function setPositions(input) {
    geometry.assertAlive();
    if (!Array.isArray(input) || input.length > 128) invalid();
    const seen = new Set(), changes = Array.from(input, change => {
      if (!exact(change, ['objectId', 'position']) || !targets.has(change.objectId) || seen.has(change.objectId)) invalid();
      seen.add(change.objectId);
      const position = pair(change.position); pair(localAt(targets.get(change.objectId), position));
      return { objectId: change.objectId, position };
    });
    return geometry.setPositions(changes);
  }
  return {
    actors: geometry.actors, state: geometry.state, currentPosition: geometry.currentPosition,
    setPositions, setPosition(id, position) { return setPositions([{ objectId: id, position }]); },
    move(ids, delta, snap = 0) { geometry.assertAlive(); return setPositions(moveSceneSelection(geometry.actors(), ids, delta, snap)); },
    align(ids, alignment) { geometry.assertAlive(); return setPositions(alignSceneSelection(geometry.actors(), ids, alignment)); },
    undo: geometry.undo, redo: geometry.redo, reset: geometry.reset, dispose: geometry.dispose,
    propose() {
      geometry.assertAlive();
      if (!geometry.state().dirty) unchanged();
      const changes = ordered.flatMap(target => {
        const world = geometry.currentPosition(target.instanceId);
        return same(world, target.initialWorld) ? [] : [{ instanceId: target.instanceId, placementId: target.placementId,
          actorKey: target.actorKey, position: localAt(target, world) }];
      });
      if (!changes.length) unchanged();
      const prepared = patch(before.content, changes);
      if (!prepared.changedPaths.length) unchanged();
      return { sceneId: preview.scene.objectId, sourcePath: before.sourcePath, baseSourceRevision: before.baseSourceRevision,
        sourceRevision: preview.composition.sourceRevision, changes: clone(changes), ...prepared };
    },
  };
}

/** Recompute every target and exact receipt before the host rechecks ownership. */
export async function prepareSceneCompositionBatchLayoutApply(current, proposal, { digest } = {}) {
  const source = sourceSnapshot(current);
  if (!exact(proposal, ['sceneId', 'sourcePath', 'baseSourceRevision', 'sourceRevision', 'changes', 'afterContent', 'changedPaths'])
    || !uuid(proposal.sceneId) || typeof proposal.sourcePath !== 'string' || !revision(proposal.baseSourceRevision)
    || !revision(proposal.sourceRevision) || typeof proposal.afterContent !== 'string' || !Array.isArray(proposal.changedPaths)
    || !Array.isArray(proposal.changes) || !proposal.changes.length || proposal.changes.length > 128) fail();
  const expected = clone(proposal), seen = new Set();
  for (const change of expected.changes) {
    if (!exact(change, ['instanceId', 'placementId', 'actorKey', 'position']) || !uuid(change.instanceId) || !uuid(change.placementId)
      || typeof change.actorKey !== 'string' || seen.has(change.instanceId)) fail();
    seen.add(change.instanceId); pair(change.position);
  }
  if (source.sourcePath !== expected.sourcePath || source.baseSourceRevision !== expected.baseSourceRevision) conflict();
  if (await hash(source.content, digest) !== expected.sourceRevision) conflict();
  const ordered = sourceTargets(source.content), selected = new Map(expected.changes.map(change => [change.instanceId, change]));
  const canonical = ordered.flatMap(target => {
    const change = selected.get(target.instanceId);
    if (!change) return [];
    if (change.placementId !== target.placementId || change.actorKey !== target.actorKey || same(change.position, target.initialLocal)) fail();
    return [change];
  });
  if (canonical.length !== expected.changes.length || !same(canonical, expected.changes)) fail();
  const prepared = patch(source.content, canonical);
  if (!prepared.changedPaths.length || prepared.afterContent !== expected.afterContent || !same(prepared.changedPaths, expected.changedPaths)) fail();
  return prepared;
}

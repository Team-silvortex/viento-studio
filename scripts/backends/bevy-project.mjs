// Data-only generation for the pinned headless Bevy host. Author source text
// never becomes Rust, shell arguments, engine syntax or generated file paths.
import fs from 'node:fs/promises';
import { buildError, buildHash } from '../adapters/node-build-snapshot.mjs';

export const BEVY_RUNTIME_IDENTITY = 'viento-bevy-runtime 0.3.0 bevy 0.19.1';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const number = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const pair = (value, min, max) => Array.isArray(value) && value.length === 2 && value.every(item => number(item, min, max));
const color = value => typeof value === 'string' && /^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(value);
const invalid = () => { throw buildError('build_backend_plan_invalid', 'Invalid Scene2D data for the Bevy runtime.'); };

export async function generateBevyProject(plan) {
  if (plan?.format !== 'viento-build-plan' || plan.kind !== 'scene2d' || ![1, 2].includes(plan.schemaVersion)
    || !uuid(plan.scene?.objectId) || typeof plan.scene.title !== 'string' || !plan.scene.title.trim() || plan.scene.title.length > 160
    || /[\x00-\x1f]/.test(plan.scene.title)
    || !pair(plan.scene.viewport, 64, 4096) || !plan.scene.viewport.every(Number.isInteger) || !color(plan.scene.background)
    || !Array.isArray(plan.actors) || plan.actors.length < 1 || plan.actors.length > 128
    || plan.actors.some(actor => actor === null || typeof actor !== 'object' || Array.isArray(actor))
    || !Array.isArray(plan.resources) || plan.resources.length > 128) invalid();
  // Image admission remains a distinct, unsupported capability in this first
  // headless backend. Removing the plan's capability token cannot bypass it.
  if (plan.resources.length || plan.actors.some(actor => actor.imageResourceId !== undefined)) {
    throw buildError('build_capability_missing', 'Bevy does not yet support the image capability.', { capability: 'image' });
  }
  const resourceFiles = new Map(), resources = [];
  const identities = new Set();
  const actors = plan.actors.map(actor => {
    const paired = plan.schemaVersion === 2, identity = paired ? actor.instanceId : actor.objectId;
    if (!uuid(actor.objectId) || paired && !uuid(actor.instanceId) || !paired && actor.instanceId !== undefined
      || identities.has(identity) || !pair(actor.position, -100000, 100000) || !pair(actor.size, 1, 2048)
      || !color(actor.color) || !number(actor.speed, 0, 2000) || !['arrows', 'none'].includes(actor.controls)) invalid();
    identities.add(identity);
    return { ...(paired ? { instanceId: actor.instanceId } : {}), objectId: actor.objectId,
      position: [...actor.position], size: [...actor.size], color: actor.color, speed: actor.speed, controls: actor.controls };
  });
  const scene = { objectId: plan.scene.objectId, title: plan.scene.title, viewport: [...plan.scene.viewport], background: plan.scene.background };
  const content = Buffer.from(JSON.stringify({ format: 'viento-bevy-scene', schemaVersion: plan.schemaVersion, scene, actors, resources }, null, 2) + '\n');
  const sourceMap = { format: 'viento-runtime-map', schemaVersion: plan.schemaVersion, scene: structuredClone(plan.scene),
    objects: plan.actors.map(actor => ({ ...(actor.instanceId ? { instanceId: actor.instanceId } : {}), objectId: actor.objectId,
      sourcePath: actor.sourcePath, sourceRevision: actor.sourceRevision, declaration: structuredClone(actor.declaration),
      ...(actor.origin ? { origin: structuredClone(actor.origin), fieldSources: structuredClone(actor.fieldSources) } : {}) })),
    resources: [] };
  const implementation = await Promise.all([fs.readFile(new URL('./bevy-project.mjs', import.meta.url)),
    fs.readFile(new URL('../../engine/scene-runtime-events.mjs', import.meta.url))]);
  return { files: new Map([['scene-data.json', content]]), resourceFiles, sourceMap,
    backend: { id: 'org.viento.bevy', version: '0.3.0', protocolVersion: plan.schemaVersion,
      capabilities: ['scene2d', 'input.arrows', 'state.movement', 'runtime.control-replay', 'runtime.control-replay.instances'], artifactKind: 'bevy-scene', platforms: ['linux'],
      execution: { headlessLogic: true, windowPreview: false, embeddedViewport: false, gpuCompute: false },
      sha256: buildHash(Buffer.concat([...implementation, Buffer.from(BEVY_RUNTIME_IDENTITY)])) },
    artifact: { kind: 'bevy-scene', entry: 'scene-data.json', requiresTool: true } };
}

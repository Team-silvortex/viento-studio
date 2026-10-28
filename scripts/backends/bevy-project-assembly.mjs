// Compose every admitted scene as data. The existing headless Bevy host reads
// only scene-data.json: the project manifest is an inventory, not a scene
// switching runtime, and never gives author strings control of paths.
import fs from 'node:fs/promises';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan-contract.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';
import { buildError, buildHash } from '../adapters/node-build-snapshot.mjs';
import { generateBevyProject } from './bevy-project.mjs';

const capabilities = ['scene2d', 'input.arrows', 'state.movement', 'project.scenes', 'runtime.control-replay', 'runtime.control-replay.instances', 'project.control-replay'];
const unsupported = capability => { throw buildError('build_capability_missing', `Bevy does not support ${capability}.`, { capability }); };
const sceneKeys = new Set(['format', 'schemaVersion', 'kind', 'projectId', 'worldId', 'worldRevision', 'scene', 'actors', 'resources', 'requiredCapabilities']);
const sceneDataKeys = new Set(['objectId', 'sourcePath', 'sourceRevision', 'title', 'viewport', 'background']);
const actorKeys = new Set(['objectId', 'instanceId', 'position', 'size', 'color', 'speed', 'controls', 'imageResourceId', 'useProjectionDefaults', 'name', 'sourcePath', 'sourceRevision', 'origin', 'fieldSources', 'declaration']);
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

export async function generateBevyAssemblyProject(input) {
  const plan = validateProjectAssemblyPlan(input);
  if (plan.schemaVersion !== 1) unsupported('project.input-map');
  const missing = plan.requiredCapabilities.find(value => !capabilities.includes(value));
  if (missing) unsupported(missing);
  const files = new Map(), scenes = [], maps = [], hashes = [];
  for (const child of plan.scenes) {
    // Do not let omitted capability tokens silently discard richer scene data.
    for (const [field, capability] of [['behaviors', 'behavior.bindings'], ['audio', 'audio.nonspatial'],
      ['animation', 'animation.visual2d'], ['physics', 'physics.bodies2d']]) {
      if (Object.hasOwn(child, field)) unsupported(capability);
    }
    if (![1, 2].includes(child.schemaVersion)) unsupported('behavior.bindings');
    if (Object.keys(child).some(key => !sceneKeys.has(key))
      || Object.keys(child.scene).some(key => !sceneDataKeys.has(key))
      || child.actors.some(actor => actor && typeof actor === 'object' && Object.keys(actor).some(key => !actorKeys.has(key))))
      throw buildError('build_backend_plan_invalid', 'Bevy cannot discard unknown scene plan fields.');
    const generated = await generateBevyProject(child);
    const bytes = generated.files.get('scene-data.json');
    if (!bytes || generated.files.size !== 1 || generated.resourceFiles.size !== 0)
      throw buildError('build_backend_plan_invalid', 'Invalid Bevy scene output.');
    const entry = `scenes/${child.scene.objectId}/scene-data.json`;
    files.set(entry, bytes);
    if (child.scene.objectId === plan.entrySceneId) files.set('scene-data.json', Buffer.from(bytes));
    scenes.push({ sceneId: child.scene.objectId, entry });
    maps.push({ sceneId: child.scene.objectId, entry, sourceMap: generated.sourceMap });
    hashes.push({ sceneId: child.scene.objectId, sha256: generated.backend.sha256 });
  }
  files.set('assembly.json', json({ format: 'viento-bevy-project', schemaVersion: 1,
    entrySceneId: plan.entrySceneId, scenes }));
  const implementation = await fs.readFile(new URL('./bevy-project-assembly.mjs', import.meta.url));
  return { files, resourceFiles: new Map(), sourceMap: { format: 'viento-project-runtime-map', schemaVersion: 1,
    assembly: plan.assembly, entrySceneId: plan.entrySceneId, scenes: maps, behaviors: [], resources: [] },
  backend: { id: 'org.viento.bevy', version: '0.3.0', protocolVersion: 1, capabilities: [...capabilities],
    artifactKind: 'bevy-scene', platforms: ['linux'],
    execution: { headlessLogic: true, windowPreview: false, embeddedViewport: false, gpuCompute: false },
    sha256: buildHash(Buffer.concat([implementation, Buffer.from(canonicalJson(hashes))])) },
  artifact: { kind: 'bevy-scene', entry: 'scene-data.json', requiresTool: true } };
}

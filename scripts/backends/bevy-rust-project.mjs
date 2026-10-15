// A separately admitted Cargo source project. The legacy data-only Bevy host
// remains unchanged; only this adapter compiles registered author Rust bytes.
import fs from 'node:fs/promises';
import { buildError, buildHash } from '../adapters/node-build-snapshot.mjs';
import { inspectSceneBehaviors } from '../../engine/scene-behaviors.mjs';

export const BEVY_RUST_BACKEND_ID = 'org.viento.bevy-rust';
export const BEVY_RUST_RUNTIME_IDENTITY = 'viento-bevy-behaviors 0.2.0 bevy 0.19.1';
export const BEVY_RUST_TEMPLATE_FILES = Object.freeze(['Cargo.toml', 'Cargo.lock', 'src/main.rs', 'src/runtime.rs']);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const relative = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\\:\x00-\x1f\x7f]/.test(value)
  && value.split('/').every(part => part && part !== '.' && part !== '..') && Buffer.from(value).toString('utf8') === value;
const provenance = value => plain(value) && uuid(value.objectId) && relative(value.sourcePath) && revision(value.sourceRevision);
const number = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const pair = (value, min, max) => Array.isArray(value) && value.length === 2 && value.every(item => number(item, min, max));
const color = value => typeof value === 'string' && /^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(value);
const invalid = message => { throw buildError('build_behavior_invalid', message); };
export const bevyRustSourcePath = objectId => {
  if (!uuid(objectId)) invalid('A Rust source requires a registered UUID.');
  return `src/behaviors/b_${objectId.replaceAll('-', '_')}.rs`;
};

export function validateBevyRustPlan(plan) {
  if (plan?.format !== 'viento-build-plan' || plan.kind !== 'scene2d' || plan.schemaVersion !== 3
    || !provenance(plan.scene) || typeof plan.scene.title !== 'string' || !plan.scene.title.trim() || plan.scene.title.length > 160
    || /[\x00-\x1f]/.test(plan.scene.title) || !pair(plan.scene.viewport, 64, 4096) || !plan.scene.viewport.every(Number.isInteger)
    || !color(plan.scene.background) || !Array.isArray(plan.actors) || plan.actors.length < 1 || plan.actors.length > 128
    || plan.actors.some(actor => !plain(actor)) || !Array.isArray(plan.resources)) invalid('Expected a Scene2D behavior plan using protocol 3.');
  if (plan.resources.length || plan.actors.some(actor => actor.imageResourceId !== undefined)) {
    throw buildError('build_capability_missing', 'Bevy Rust behaviors currently support headless scenes without images.', { capability: 'image' });
  }
  const actors = new Map();
  for (const actor of plan.actors) {
    if (!provenance(actor) || !uuid(actor.instanceId) || actors.has(actor.instanceId)
      || !pair(actor.position, -100000, 100000) || !pair(actor.size, 1, 2048) || !color(actor.color)
      || !number(actor.speed, 0, 2000) || !['arrows', 'none'].includes(actor.controls)) invalid('Invalid paired actor declaration.');
    actors.set(actor.instanceId, actor);
  }
  const value = plan.behaviors;
  if (value?.format !== 'viento-behavior-plan' || value.schemaVersion !== 1 || value.backendId !== BEVY_RUST_BACKEND_ID
    || value.language !== 'rust' || !provenance(value.manifest) || !value.manifest.sourcePath.toLowerCase().endsWith('.json')
    || !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 8
    || !Array.isArray(value.bindings) || value.bindings.length < 1 || value.bindings.length > 32) invalid('Invalid Bevy Rust behavior plan.');
  const declaration = inspectSceneBehaviors(JSON.stringify({ format: 'viento-scene-behaviors', schemaVersion: 1,
    sceneObjectId: plan.scene.objectId, bindings: value.bindings.map(({ objectId, declaration, ...binding }) => binding) }));
  if (!declaration.ok) invalid('Invalid scalar parameters, signal declarations, or binding identities.');
  const sources = new Map(), used = new Set();
  for (const source of value.sources) {
    if (!provenance(source) || sources.has(source.objectId) || source.objectId === value.manifest.objectId || source.objectId === plan.scene.objectId
      || source.language !== 'rust' || !source.sourcePath.toLowerCase().endsWith('.txt') || typeof source.content !== 'string' || !source.content.length
      || Buffer.byteLength(source.content, 'utf8') > 65536 || Buffer.from(source.content).toString('utf8') !== source.content
      || source.sourceRevision !== `sha256:${buildHash(Buffer.from(source.content))}`) invalid('Invalid frozen Rust behavior source.');
    sources.set(source.objectId, source);
  }
  for (const [index, binding] of value.bindings.entries()) {
    if (!actors.has(binding.instanceId) || actors.get(binding.instanceId).objectId !== binding.objectId
      || binding.implementation?.backendId !== BEVY_RUST_BACKEND_ID || binding.implementation.language !== 'rust'
      || !sources.has(binding.implementation.sourceObjectId) || !provenance(binding.declaration)
      || binding.declaration.objectId !== value.manifest.objectId || binding.declaration.sourcePath !== value.manifest.sourcePath
      || binding.declaration.sourceRevision !== value.manifest.sourceRevision || binding.declaration.propertyPath !== `/bindings/${index}`) invalid('Invalid Rust behavior binding or source provenance.');
    used.add(binding.implementation.sourceObjectId);
  }
  if (used.size !== sources.size) invalid('The Rust source inventory must contain exactly the used sources.');
  return value;
}

export async function generateBevyRustProject(input) {
  const plan = structuredClone(input), value = validateBevyRustPlan(plan);
  const files = new Map(await Promise.all(BEVY_RUST_TEMPLATE_FILES.map(async name => [name,
    await fs.readFile(new URL(`./bevy-rust/${name}`, import.meta.url))])));
  const sources = [...value.sources].sort((a, b) => a.objectId.localeCompare(b.objectId));
  const module = source => `b_${source.objectId.replaceAll('-', '_')}`;
  const dispatch = [
    '// Generated UUID-only dispatch. Registered author source bytes remain in separate modules.',
    ...sources.map(source => `#[path = "behaviors/${module(source)}.rs"]\nmod ${module(source)};`),
    'pub const SOURCES: &[(&str, &str)] = &[',
    ...sources.map(source => `    ("${source.objectId}", "${source.sourceRevision.slice(7)}"),`),
    '];', 'pub fn ready(source_id: &str, ctx: &mut crate::runtime::BehaviorContext) -> Result<(), String> {',
    '    match source_id {', ...sources.map(source => `        "${source.objectId}" => ${module(source)}::ready(ctx),`),
    '        _ => Err("No compiled behavior source matches the requested identity.".into()),', '    }', '}', '',
  ].join('\n');
  files.set('src/behavior_sources.rs', Buffer.from(dispatch));
  for (const source of sources) files.set(bevyRustSourcePath(source.objectId), Buffer.from(source.content));
  const scene = { objectId: plan.scene.objectId, title: plan.scene.title, viewport: [...plan.scene.viewport], background: plan.scene.background };
  const actors = plan.actors.map(actor => ({ instanceId: actor.instanceId, objectId: actor.objectId,
    position: [...actor.position], size: [...actor.size], color: actor.color, speed: actor.speed, controls: actor.controls }));
  files.set('scene-data.json', Buffer.from(JSON.stringify({ format: 'viento-bevy-rust-scene', schemaVersion: 1, scene, actors, resources: [],
    sources: sources.map(source => ({ objectId: source.objectId, file: bevyRustSourcePath(source.objectId), sha256: source.sourceRevision.slice(7), size: Buffer.byteLength(source.content) })),
    bindings: value.bindings.map(({ declaration, ...binding }) => binding) }, null, 2) + '\n'));
  files.set('README.md', Buffer.from('# Generated Viento Bevy Rust project\n\n'
    + 'This is a complete Cargo source project for Bevy 0.19.1 and Rust 1.95 or newer. It contains native author Rust code.\n\n'
    + 'Studio uses pinned Cargo and rustc 1.95.0 with `--locked --offline`; their recorded identities belong to that Studio build.\n'
    + 'A recipient may rebuild with another compatible Rust toolchain, but that is a new local build and does not reproduce the original recorded tool identity.\n'
    + 'Build from this directory with `cargo build --locked` (add `--offline` when dependencies are cached).\n'
    + 'Run `target/debug/viento-bevy-behaviors --scene /absolute/path/to/scene-data.json --smoke`.\n'
    + 'Use `--check` instead of `--smoke` to validate generated scene/source integrity without calling author callbacks.\n\n'
    + 'The source files under src/behaviors are exact copies of registered author TXT documents. '
    + 'Each exports `pub fn ready(ctx: &mut crate::runtime::BehaviorContext) -> Result<(), String>`. '
    + 'The API reads typed scalar parameters with string/number/boolean and maps `emit(signal, Vec<Value>)` through each binding\'s declared events. '
    + 'Ready callbacks run once per binding, after the ready frame. Optional `ctx.on_fixed_update(callback)?` registers one function during ready. '
    + 'Its signature is `fn(&mut BehaviorContext, FixedStep) -> Result<(), String>`; steps expose `tick` (starting at zero) and `delta_seconds`. '
    + 'The bounded smoke runs two steps of 0.25 seconds: existing direction movement runs first, then registered callbacks in binding declaration order. '
    + '`position()`, `set_position([x,y])` and `translate([dx,dy])` operate only on the binding instance; writes must remain finite within +/-100000. '
    + 'A successful callback commits its position, registration and events. A failing callback commits none of those pending changes; arbitrary native Rust side effects are outside this guarantee. '
    + 'Bindings share their instance position in declaration order. Each binding may emit at most 64 events across ready and all fixed steps, with zero to four scalar arguments per event.\n\n'
    + 'This headless backend has no image, window, GPU, input replay, or live-reload capability. '
    + 'Studio owns generated copies; edit original source documents and rebuild to retain provenance.\n'));
  const sourceMap = { format: 'viento-runtime-map', schemaVersion: 3, scene: structuredClone(plan.scene),
    objects: plan.actors.map(actor => ({ instanceId: actor.instanceId, objectId: actor.objectId, sourcePath: actor.sourcePath,
      sourceRevision: actor.sourceRevision, declaration: structuredClone(actor.declaration),
      ...(actor.origin ? { origin: structuredClone(actor.origin), fieldSources: structuredClone(actor.fieldSources) } : {}) })), resources: [],
    behaviors: value.bindings.map(binding => ({ bindingId: binding.bindingId, instanceId: binding.instanceId, objectId: binding.objectId,
      sourceObjectId: binding.implementation.sourceObjectId, generatedPath: bevyRustSourcePath(binding.implementation.sourceObjectId),
      declaration: structuredClone(binding.declaration), source: (() => { const { content, language, ...source } = sources.find(item => item.objectId === binding.implementation.sourceObjectId); return source; })() })) };
  const implementation = await fs.readFile(new URL('./bevy-rust-project.mjs', import.meta.url));
  const identity = [implementation, ...BEVY_RUST_TEMPLATE_FILES.map(name => files.get(name)),
    await fs.readFile(new URL('../../engine/scene-behaviors.mjs', import.meta.url))];
  return { files, resourceFiles: new Map(), sourceMap,
    backend: { id: BEVY_RUST_BACKEND_ID, version: '0.2.0', protocolVersion: 3,
      capabilities: ['scene2d', 'input.arrows', 'state.movement', 'behavior.bindings', 'behavior.rust'], artifactKind: 'bevy-rust-project', platforms: ['linux'],
      execution: { headlessLogic: true, windowPreview: false, embeddedViewport: false, gpuCompute: false }, sha256: buildHash(Buffer.concat(identity)) },
    artifact: { kind: 'bevy-rust-project', entry: 'Cargo.toml', requiresTool: true } };
}

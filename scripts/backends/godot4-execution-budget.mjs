// New projects select a shared finite admission policy. Historical generators
// and runtime source bytes remain frozen; only exact generated templates are
// transformed, and the inventory repeats those transforms before execution.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_EXECUTION_BUDGET_POLICY } from '../../engine/project-execution-budget.mjs';
import { generateGodotAssemblyProject, godotAssemblyScripts } from './godot4-project.mjs';
import { hasGodotPhysics } from './godot4-physics.mjs';
import { generateGodotPhysicsPlatformEventsProject, godotPhysicsPlatformEventsAssemblyScripts } from './godot4-physics-platform-events.mjs';
import { buildHash, buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';

const helperName = 'project-execution-budget.gd', inventoryName = 'execution-budget.json';
const sourceURL = name => new URL(`./godot4/${name}`, import.meta.url);
const invalid = () => { throw buildError('build_execution_budget_invalid', 'Invalid generated execution budget inventory.'); };
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const expectOnce = (source, before, after) => {
  if (source.split(before).length !== 2) invalid();
  return source.replace(before, after);
};
const allNames = ['project-runtime.gd', 'project-events.gd', 'project-audio.gd', 'project-animation.gd', 'project-animation-targets.gd'];
function scripts(schema) {
  if (![5, 6, 7, 8, 9, 10, 11, 12].includes(schema)) invalid();
  return allNames.filter(name => name !== 'project-animation.gd' && name !== 'project-animation-targets.gd'
    || name === 'project-animation.gd' && schema >= 6 || name === 'project-animation-targets.gd' && schema === 12);
}
function document(names) {
  return json({ format: 'viento-godot-execution-budget', schemaVersion: 1, policyVersion: 1, scope: 'session',
    limits: PROJECT_EXECUTION_BUDGET_POLICY, scripts: names });
}
function transform(name, source) {
  if (name === 'project-runtime.gd') {
    source = expectOnce(source, 'var event_bus\n', `var execution_budget = preload("res://${helperName}").new()\nvar event_bus\n`);
    source = expectOnce(source, 'if candidate.size() > 64 or state_revision >= 1024:', 'if candidate.size() > 64:');
    // The write and erase paths own separate commit points. Do not reserve in
    // the candidate validator: unchanged writes and missing deletes cost zero.
    for (const start of ['\nfunc write_state(', '\nfunc erase_state(']) {
      const index = source.indexOf(start); if (index < 0) invalid();
      const end = source.indexOf('\nfunc ', index + start.length), tail = end < 0 ? source.length : end;
      const body = source.slice(index, tail);
      source = source.slice(0, index) + expectOnce(body, 'if not state_candidate_valid(candidate):',
        'if not state_candidate_valid(candidate) or not execution_budget.reserve({"stateMutations": 1}):') + source.slice(tail);
    }
  } else if (name === 'project-events.gd') {
    source = expectOnce(source, 'if subscriptions.size() >= 64 or registration_count >= 1024:',
      'if subscriptions.size() >= 64 or not owner.execution_budget.reserve({"eventRegistrations": 1}):');
    source = expectOnce(source,
      'if sequence >= 128 or reserved_deliveries + recipients.size() > 1024 or total_bytes + bytes > 524288 or (not recipients.is_empty() and (queue.size() >= 64 or pending_bytes + bytes > 16384)):',
      'if (not recipients.is_empty() and (queue.size() >= 64 or pending_bytes + bytes > 16384)) or not owner.execution_budget.reserve({"eventPublishes": 1, "eventDeliveries": recipients.size(), "eventBytes": bytes}):');
  } else if (name === 'project-audio.gd') {
    source = expectOnce(source, 'if reserved_count >= 256 or queue.size() >= 64:',
      'if queue.size() >= 64 or not owner.execution_budget.reserve({"audioRequests": 1}):');
  } else if (name === 'project-animation.gd' || name === 'project-animation-targets.gd') {
    source = expectOnce(source, 'if reserved_count >= 256 or queue.size() >= 64:',
      'if queue.size() >= 64 or not owner.execution_budget.reserve({"animationRequests": 1}):');
  } else invalid();
  return Buffer.from(source);
}
async function expectedScripts(schema) {
  const rows = await Promise.all(scripts(schema).map(async name => {
    const template = name === 'project-animation.gd' && schema >= 7 ? 'project-animation-clips.gd' : name;
    const original = await fs.readFile(sourceURL(template));
    return [name, original, transform(name, original.toString())];
  }));
  return rows;
}
export async function generateGodotExecutionBudgetProject(input) {
  const generated = await (hasGodotPhysics(input) ? generateGodotPhysicsPlatformEventsProject : generateGodotAssemblyProject)(input);
  const schema = JSON.parse(generated.files.get('assembly.json')).schemaVersion;
  const rows = await expectedScripts(schema), helper = await fs.readFile(sourceURL(helperName));
  for (const [name, original, changed] of rows) {
    const actual = generated.files.get(name);
    if (!actual || !actual.equals(original)) invalid();
    generated.files.set(name, changed);
  }
  if (generated.files.has(helperName) || generated.files.has(inventoryName)) invalid();
  const inventory = document(rows.map(([name]) => name));
  generated.files.set(helperName, helper); generated.files.set(inventoryName, inventory);
  generated.backend = { ...generated.backend, version: '0.32.0', sha256: buildHash(Buffer.concat([
    Buffer.from(generated.backend.sha256), await fs.readFile(new URL('./godot4-execution-budget.mjs', import.meta.url)),
    await fs.readFile(new URL('../../engine/project-execution-budget.mjs', import.meta.url)), helper, inventory,
    ...rows.map(([, , changed]) => changed),
  ])) };
  return generated;
}
// Only the trusted execution-frame layer uses these bytes and the fixed-file
// override below, after independently checking the actual file and its backup.
export async function godotExecutionBudgetRuntimeBytes() {
  return transform('project-runtime.gd', (await fs.readFile(sourceURL('project-runtime.gd'))).toString());
}
// Only fixed generated animation queues can receive verified original bytes.
// Copy before any asynchronous read; this interface never accepts a file path.
export function copyGodotAnimationOriginals(animationOriginals) {
  if (animationOriginals === undefined) return undefined;
  if (!(animationOriginals instanceof Map) || animationOriginals.size < 1 || animationOriginals.size > 2
    || !animationOriginals.has('project-animation.gd')) invalid();
  const originals = new Map();
  for (const [name, bytes] of animationOriginals) {
    if (!['project-animation.gd', 'project-animation-targets.gd'].includes(name) || !Buffer.isBuffer(bytes)) invalid();
    originals.set(name, Buffer.from(bytes));
  }
  return originals;
}
export async function godotExecutionBudgetAnimationBytes(schema) {
  return new Map((await expectedScripts(schema)).filter(([name]) => ['project-animation.gd', 'project-animation-targets.gd'].includes(name))
    .map(([name, , bytes]) => [name, bytes]));
}
// This final override can only stand for the one generated audio queue.
export function copyGodotAudioOriginal(originalProjectAudio) {
  if (originalProjectAudio === undefined) return undefined;
  if (!Buffer.isBuffer(originalProjectAudio)) invalid();
  return Buffer.from(originalProjectAudio);
}
export async function godotExecutionBudgetAudioBytes() {
  return transform('project-audio.gd', (await fs.readFile(sourceURL('project-audio.gd'))).toString());
}
export async function godotExecutionBudgetAssemblyScripts(directory, signal, originalProjectRuntime, animationOriginals, originalProjectAudio) {
  if (originalProjectRuntime !== undefined && !Buffer.isBuffer(originalProjectRuntime)) invalid();
  const original = originalProjectRuntime === undefined ? undefined : Buffer.from(originalProjectRuntime);
  const animations = copyGodotAnimationOriginals(animationOriginals), audio = copyGodotAudioOriginal(originalProjectAudio);
  const read = async (name, limit = 65536) => {
    const bytes = await readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), limit, signal);
    return name === 'project-runtime.gd' && original !== undefined ? Buffer.from(original)
      : name === 'project-audio.gd' && audio !== undefined ? Buffer.from(audio)
      : animations?.has(name) ? Buffer.from(animations.get(name)) : bytes;
  };
  const optional = async (name, limit) => { try { return await read(name, limit); } catch (error) { if (error.code === 'ENOENT') return null; invalid(); } };
  try {
    const inventory = await optional(inventoryName), helper = await optional(helperName);
    const contents = new Map(await Promise.all(allNames.map(async name => [name, await optional(name)])));
    if (inventory === null) {
      if (original !== undefined || animations !== undefined || audio !== undefined) invalid();
      if (helper !== null || [...contents.values()].some(bytes => bytes?.includes('execution_budget'))) invalid();
      return await godotPhysicsPlatformEventsAssemblyScripts(directory, signal) || await godotAssemblyScripts(directory, signal);
    }
    const assembly = JSON.parse(await read('assembly.json', 4 * 1024 * 1024)), rows = await expectedScripts(assembly.schemaVersion);
    if (!inventory.equals(document(rows.map(([name]) => name))) || helper === null || !helper.equals(await fs.readFile(sourceURL(helperName)))) invalid();
    const names = new Set(rows.map(([name]) => name));
    if (animations !== undefined && ([...names].filter(name => name === 'project-animation.gd' || name === 'project-animation-targets.gd')
      .some(name => !animations.has(name)) || [...animations.keys()].some(name => !names.has(name)))) invalid();
    for (const [name, actual] of contents) {
      if (names.has(name)) { if (actual === null || !actual.equals(rows.find(([key]) => key === name)[2])) invalid(); }
      else if (actual !== null) invalid();
    }
    const previous = await godotPhysicsPlatformEventsAssemblyScripts(directory, signal) || await godotAssemblyScripts(directory, signal);
    if (!previous) invalid();
    return [...previous, helperName];
  } catch (error) { if (error?.name === 'AbortError' || signal?.aborted) throw error; invalid(); }
}

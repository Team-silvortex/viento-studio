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
export async function godotExecutionBudgetAssemblyScripts(directory, signal) {
  const read = async (name, limit = 65536) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), limit, signal);
  const optional = async (name, limit) => { try { return await read(name, limit); } catch (error) { if (error.code === 'ENOENT') return null; invalid(); } };
  try {
    const inventory = await optional(inventoryName), helper = await optional(helperName);
    const contents = new Map(await Promise.all(allNames.map(async name => [name, await optional(name)])));
    if (inventory === null) {
      if (helper !== null || [...contents.values()].some(bytes => bytes?.includes('execution_budget'))) invalid();
      return await godotPhysicsPlatformEventsAssemblyScripts(directory, signal) || await godotAssemblyScripts(directory, signal);
    }
    const assembly = JSON.parse(await read('assembly.json', 4 * 1024 * 1024)), rows = await expectedScripts(assembly.schemaVersion);
    if (!inventory.equals(document(rows.map(([name]) => name))) || helper === null || !helper.equals(await fs.readFile(sourceURL(helperName)))) invalid();
    const names = new Set(rows.map(([name]) => name));
    for (const [name, actual] of contents) {
      if (names.has(name)) { if (actual === null || !actual.equals(rows.find(([key]) => key === name)[2])) invalid(); }
      else if (actual !== null) invalid();
    }
    const previous = await godotPhysicsPlatformEventsAssemblyScripts(directory, signal) || await godotAssemblyScripts(directory, signal);
    if (!previous) invalid();
    return [...previous, helperName];
  } catch (error) { if (error?.name === 'AbortError' || signal?.aborted) throw error; invalid(); }
}

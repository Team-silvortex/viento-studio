// Observe existing audio queue commit points without changing playback, finite
// admission budgets, scheduling, or any historical generated GDScript source.
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateGodotAnimationRequestsProject, godotAnimationRequestsAssemblyScripts } from './godot4-animation-requests.mjs';
import { godotExecutionBudgetAudioBytes } from './godot4-execution-budget.mjs';
import { buildHash, buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';

export const GODOT_AUDIO_REQUESTS_CAPABILITY = 'runtime.audio-requests';
const helperName = 'audio-request-emitter.gd', sidecar = 'audio-requests.json';
const queueName = 'project-audio.gd', backupName = 'audio-requests-original-project-audio.gd.txt';
const helperUidName = `${helperName}.uid`;
const sourceURL = name => new URL(`./godot4/${name}`, import.meta.url);
const invalid = () => { throw buildError('build_audio_requests_invalid', 'Invalid generated audio request inventory.'); };
const once = (source, before, after) => {
  if (source.split(before).length !== 2) invalid();
  return source.replace(before, after);
};
function transform(original) {
  let source = original.toString();
  if (source.includes('audio-request') || source.includes('VIENTO_AUDIO_REQUEST:') || source.includes('"requestId"')) invalid();
  source = once(source, '\tqueue.push_back({"visitIndex":', '\tqueue.push_back({"requestId": reserved_count, "visitIndex":');
  source = once(source, '\towner.schedule_flush()\n', `\tpreload("res://${helperName}").emit_accepted(queue.back())\n\towner.schedule_flush()\n`);
  source = once(source, '\t\tqueue.pop_front()\n', `\t\tpreload("res://${helperName}").emit_applied(request, sequence)\n\t\tqueue.pop_front()\n`);
  source = once(source, '\tqueue.clear()\n', `\twhile not queue.is_empty():\n\t\tpreload("res://${helperName}").emit_discarded(queue[0])\n\t\tqueue.pop_front()\n`);
  return Buffer.from(source);
}
function document(original, changed, helper) {
  return Buffer.from(JSON.stringify({ format: 'viento-godot-audio-requests', schemaVersion: 1,
    protocolVersion: 1, scope: 'session', clock: 'godot-engine-frames',
    helper: { path: helperName, sha256: buildHash(helper) },
    scripts: [{ path: queueName, original: backupName, sha256: buildHash(changed), originalSha256: buildHash(original) }] }, null, 2) + '\n');
}
export async function generateGodotAudioRequestsProject(input) {
  const generated = await generateGodotAnimationRequestsProject(input);
  // This map was derived from the validated frozen plan, so no caller-owned
  // input is consulted after the previous generator's asynchronous reads.
  if (!generated.sourceMap.scenes.some(scene => scene.sourceMap.audio?.tracks.length > 0)) return generated;
  const original = await godotExecutionBudgetAudioBytes(), changed = transform(original), helper = await fs.readFile(sourceURL(helperName));
  for (const name of [sidecar, helperName, backupName]) if (generated.files.has(name)) invalid();
  if (!generated.files.get(queueName)?.equals(original)) invalid();
  const inventory = document(original, changed, helper);
  generated.files.set(backupName, original); generated.files.set(queueName, changed);
  generated.files.set(helperName, helper); generated.files.set(sidecar, inventory);
  generated.backend = { ...generated.backend, version: '0.36.0',
    capabilities: [...generated.backend.capabilities, GODOT_AUDIO_REQUESTS_CAPABILITY],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256),
      await fs.readFile(new URL('./godot4-audio-requests.mjs', import.meta.url)), helper, inventory, original, changed])) };
  return generated;
}

// Only the fixed audio queue's verified original bytes cross into older layers.
// Backups are data, never executed or temporarily written over runtime files.
export async function godotAudioRequestsAssemblyScripts(directory, signal) {
  const read = async (name, limit = 65536) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), limit, signal);
  const optional = async (name, limit) => { try { return await read(name, limit); } catch (error) { if (error.code === 'ENOENT') return null; invalid(); } };
  try {
    signal?.throwIfAborted();
    const reserved = new Set([sidecar, helperName, backupName, helperUidName]);
    if ((await fs.readdir(directory)).some(name => name.startsWith('audio-request') && !reserved.has(name))) invalid();
    // Godot import may create this one script UID file. It is bounded metadata,
    // never executable inventory and never an alternate path to the helper.
    const uid = await optional(helperUidName, 64);
    if (uid !== null && !/^uid:\/\/[a-z0-9]{1,13}\r?\n$/.test(uid.toString())) invalid();
    const inventory = await optional(sidecar), helper = await optional(helperName);
    const actual = await optional(queueName), original = await optional(backupName);
    if (inventory === null) {
      if (uid !== null || helper !== null || original !== null || actual?.includes('audio-request')
        || actual?.includes('VIENTO_AUDIO_REQUEST:') || actual?.includes('"requestId"')) invalid();
      return await godotAnimationRequestsAssemblyScripts(directory, signal);
    }
    const expectedOriginal = await godotExecutionBudgetAudioBytes(), expectedChanged = transform(expectedOriginal);
    const expectedHelper = await fs.readFile(sourceURL(helperName));
    if (helper === null || !helper.equals(expectedHelper) || original === null || !original.equals(expectedOriginal)
      || actual === null || !actual.equals(expectedChanged) || !inventory.equals(document(expectedOriginal, expectedChanged, expectedHelper))) invalid();
    const previous = await godotAnimationRequestsAssemblyScripts(directory, signal, original);
    if (!previous) invalid();
    // The prior inventory has validated these exact scene paths. Empty audio
    // declarations cannot justify a newly installed audio request observer.
    let hasTracks = false;
    for (const name of previous.filter(name => /^scenes\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/audio-runtime\.gd$/.test(name))) {
      const audio = JSON.parse(await read(name.replace('audio-runtime.gd', 'audio.json'), 4 * 1024 * 1024));
      if (audio?.format !== 'viento-godot-audio' || audio.schemaVersion !== 1 || audio.sceneObjectId !== name.split('/')[1] || !Array.isArray(audio.tracks)) invalid();
      hasTracks ||= audio.tracks.length > 0;
    }
    if (!hasTracks) invalid();
    return [...previous, helperName];
  } catch (error) { if (error?.name === 'AbortError' || signal?.aborted) throw error; invalid(); }
}

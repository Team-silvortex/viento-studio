import fs from 'node:fs/promises';
import path from 'node:path';
import { buildHash, buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { buildActorFieldLocation } from '../../engine/build-plan.mjs';

export const GODOT4_BACKEND = {
  id: 'org.viento.godot4', version: '0.1.0', protocolVersion: 1,
  capabilities: ['scene2d', 'input.arrows', 'state.movement', 'image'],
  artifactKind: 'godot-project', platforms: ['linux'],
  execution: { headlessLogic: true, windowPreview: true, embeddedViewport: false, gpuCompute: false },
};

export async function identifyGodot(executable, { signal } = {}) {
  if (process.platform !== 'linux') throw buildError('build_platform_unsupported', 'This experimental backend has only been enabled on Linux.');
  if (!executable || !path.isAbsolute(executable)) throw buildError('build_tool_required', 'Provide an absolute Godot executable path with --godot or VIENTO_GODOT_BIN.');
  let bytes, binary;
  try {
    binary = await fs.realpath(executable);
    bytes = await readBuildFile(binary, 512 * 1024 * 1024, signal);
  } catch (error) {
    signal?.throwIfAborted();
    throw buildError('build_tool_unavailable', 'Cannot read the selected Godot executable.');
  }
  const probe = await runBuildProcess(binary, ['--version'], { cwd: path.dirname(binary), timeoutMs: 10000, signal });
  if (probe.status !== 'succeeded') throw buildError(`build_tool_${probe.status}`, 'Cannot query Godot version.', { processResult: probe });
  const version = probe.stdout.trim();
  if (!/^4\.\d+(?:\.\d+)?\.[\w.-]+$/.test(version)) throw buildError('build_tool_version', 'The selected tool is not a Godot 4 executable.');
  return { executable: binary, version, sha256: buildHash(bytes), platform: process.platform, arch: process.arch };
}

export async function generateGodotProject(plan) {
  const runtime = await fs.readFile(new URL('./godot4/runtime.gd', import.meta.url));
  const generator = await fs.readFile(new URL('./godot4.mjs', import.meta.url));
  const imageFiles = new Map(plan.resources.map(resource => [resource.id, `images/${resource.id}.${resource.extension}`]));
  const scene = { ...plan.scene, actors: plan.actors.map(actor => ({ ...actor,
    ...(actor.imageResourceId ? { imageFile: imageFiles.get(actor.imageResourceId) } : {}) })) };
  // User strings stay in JSON. Only validated numeric dimensions enter config;
  // no author text is interpolated as GDScript, resource syntax or shell code.
  const files = new Map([
    ['project.godot', Buffer.from(`config_version=5\n\n[application]\nconfig/name="Viento scene preview"\nrun/main_scene="res://main.tscn"\n\n[display]\nwindow/size/viewport_width=${scene.viewport[0]}\nwindow/size/viewport_height=${scene.viewport[1]}\n\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n`) ],
    ['main.tscn', Buffer.from('[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://runtime.gd" id="1"]\n\n[node name="VientoScene" type="Node2D"]\nscript = ExtResource("1")\n')],
    ['runtime.gd', runtime], ['scene.json', Buffer.from(JSON.stringify(scene, null, 2) + '\n')],
  ]);
  const sourceMap = { format: 'viento-runtime-map', schemaVersion: 1, scene: plan.scene,
    objects: plan.actors.map(actor => ({ objectId: actor.objectId, sourcePath: actor.sourcePath,
      sourceRevision: actor.sourceRevision, nodePath: `/root/VientoScene/actor_${actor.objectId.replaceAll('-', '_')}`, declaration: actor.declaration,
      ...(actor.origin ? { origin: actor.origin, fieldSources: actor.fieldSources } : {}) })),
    resources: plan.resources.map(resource => ({ resourceId: resource.id, generatedPath: imageFiles.get(resource.id) })) };
  return { files, imageFiles, sourceMap, backend: { ...GODOT4_BACKEND, sha256: buildHash(Buffer.concat([generator, runtime])) } };
}

export function godotDiagnostics(result, plan) {
  const output = `${result.stdout}\n${result.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
  const diagnostics = [];
  for (const line of output.split('\n')) {
    if (!/^\s*(?:SCRIPT ERROR:|ERROR:)/.test(line)) continue;
    const resource = plan.resources.find(item => line.includes(item.id));
    const actor = resource ? plan.actors.find(item => item.imageResourceId === resource.id) : null;
    diagnostics.push({ severity: 'error', code: 'godot_error', message: line.trim(),
      objectId: plan.scene.objectId, sourcePath: plan.scene.sourcePath,
      propertyPath: '', ...(actor ? buildActorFieldLocation(actor, 'imageResourceId') : {}),
      ...(resource ? { resourceId: resource.id, relatedObjectId: actor?.objectId || null } : {}) });
  }
  if (result.status !== 'succeeded') diagnostics.push({ severity: 'error', code: `build_process_${result.status}`,
    message: `Godot process ${result.status}.`, objectId: plan.scene.objectId, sourcePath: plan.scene.sourcePath, propertyPath: '' });
  return diagnostics;
}

// Treat stdout as an untrusted, bounded protocol stream. Only the source plan
// supplies diagnostic locations; runtime frames cannot redirect editor links.
export function createRuntimeEventReader(plan, { onEvent } = {}) {
  const events = [], diagnostics = [];
  const actors = new Map(plan.actors.map(actor => [actor.objectId, actor]));
  const resourceIds = new Set((plan.resources || []).map(resource => resource.id));
  const prefix = 'VIENTO_RUNTIME:';
  const maxLineLength = 64 * 1024, maxEvents = 4096;
  let pending = '', dropping = false, ready = false, finished = false, ended = false, limitReported = false;
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const keys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
  const state = value => value === 'idle' || value === 'moving';
  const position = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
  const invalid = () => {
    if (diagnostics.length >= 128) return;
    diagnostics.push({ severity: 'error', code: 'runtime_protocol_invalid', message: 'Invalid runtime protocol frame.',
      objectId: plan.scene.objectId, sourcePath: plan.scene.sourcePath, propertyPath: '' });
  };
  const states = value => {
    if (!Array.isArray(value) || value.length !== actors.size) return false;
    const seen = new Set();
    for (const actor of value) {
      if (!plain(actor) || !keys(actor, ['objectId', 'position', 'state']) || !actors.has(actor.objectId)
        || seen.has(actor.objectId) || !position(actor.position) || !state(actor.state)) return false;
      seen.add(actor.objectId);
    }
    return true;
  };
  const line = text => {
    if (!text.startsWith(prefix)) return null;
    if (events.length >= maxEvents) { if (!limitReported) { invalid(); limitReported = true; } return null; }
    let frame;
    try { frame = JSON.parse(text.slice(prefix.length)); } catch { invalid(); return null; }
    if (!plain(frame) || frame.protocol !== 1 || finished) { invalid(); return null; }
    let valid = false;
    switch (frame.event) {
      case 'ready':
        valid = !ready && keys(frame, ['protocol', 'event', 'sceneObjectId', 'actors'])
          && frame.sceneObjectId === plan.scene.objectId && states(frame.actors);
        if (valid) ready = true;
        break;
      case 'state':
        valid = ready && keys(frame, ['protocol', 'event', 'objectId', 'state'])
          && actors.has(frame.objectId) && state(frame.state);
        break;
      case 'finished':
        valid = ready && keys(frame, ['protocol', 'event', 'actors', 'fixedDelta']) && states(frame.actors)
          && Number.isFinite(frame.fixedDelta) && frame.fixedDelta > 0;
        if (valid) finished = true;
        break;
      case 'diagnostic': {
        const hasObject = frame.objectId !== undefined && frame.objectId !== '';
        valid = keys(frame, ['protocol', 'event', 'severity', 'code', 'message', 'objectId', 'resourceId'])
          && frame.severity === 'error' && typeof frame.code === 'string' && /^[a-z][a-z0-9_]{0,127}$/.test(frame.code)
          && typeof frame.message === 'string' && frame.message.length > 0 && frame.message.length <= 4096
          && (!hasObject || actors.has(frame.objectId) || frame.objectId === plan.scene.objectId)
          && (frame.resourceId === undefined || frame.resourceId === '' || resourceIds.has(frame.resourceId));
        if (valid) {
          const actor = actors.get(frame.objectId);
          diagnostics.push({ severity: 'error', code: frame.code, message: frame.message,
            objectId: actor?.objectId || plan.scene.objectId, sourcePath: actor?.sourcePath || plan.scene.sourcePath,
            propertyPath: '', ...(actor && frame.resourceId === actor.imageResourceId ? buildActorFieldLocation(actor, 'imageResourceId') : {}),
            ...(frame.resourceId ? { resourceId: frame.resourceId } : {}) });
        }
        break;
      }
    }
    if (!valid) { invalid(); return null; }
    events.push(frame);
    onEvent?.(frame);
    return frame;
  };
  return {
    events, diagnostics,
    push(text) {
      if (ended) return [];
      const accepted = [];
      // Bound the unfinished line even if an engine never writes a newline.
      // Ignore oversized ordinary logs; reject oversized protocol frames.
      for (const part of text.split(/(?<=\n)/)) {
        const complete = part.endsWith('\n');
        if (!dropping) {
          if (pending.length + part.length > maxLineLength) {
            if ((pending + part.slice(0, prefix.length)).startsWith(prefix)) invalid();
            pending = ''; dropping = true;
          } else pending += part;
        }
        if (complete) {
          if (!dropping) { const frame = line(pending.replace(/\r?\n$/, '')); if (frame) accepted.push(frame); }
          pending = ''; dropping = false;
        }
      }
      return accepted;
    },
    finish() {
      if (!ended && pending && !dropping) line(pending);
      pending = ''; ended = true;
      return { events, diagnostics };
    },
  };
}

export function readRuntimeEvents(result, plan) {
  const reader = createRuntimeEventReader(plan);
  reader.push(result.stdout);
  return reader.finish();
}

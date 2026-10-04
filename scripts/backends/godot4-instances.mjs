import fs from 'node:fs/promises';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { buildActorFieldLocation } from '../../engine/build-plan.mjs';

export const GODOT4_BACKEND = {
  id: 'org.viento.godot4', version: '0.2.0', protocolVersion: 2,
  capabilities: ['scene2d', 'input.arrows', 'state.movement', 'image'],
  artifactKind: 'godot-project', platforms: ['linux'],
  execution: { headlessLogic: true, windowPreview: true, embeddedViewport: false, gpuCompute: false },
};

export async function generateGodotProject(plan) {
  const runtime = await fs.readFile(new URL('./godot4/runtime-v2.gd', import.meta.url));
  const generator = await fs.readFile(new URL('./godot4-instances.mjs', import.meta.url));
  const dispatcher = await fs.readFile(new URL('./godot4-dispatch.mjs', import.meta.url));
  const imageFiles = new Map(plan.resources.map(resource => [resource.id, `images/${resource.id}.${resource.extension}`]));
  const scene = { schemaVersion: 2, ...plan.scene, actors: plan.actors.map(actor => ({ ...actor,
    ...(actor.imageResourceId ? { imageFile: imageFiles.get(actor.imageResourceId) } : {}) })) };
  // User strings stay in JSON. Only validated numeric dimensions enter config;
  // no author text is interpolated as GDScript, resource syntax or shell code.
  const files = new Map([
    ['project.godot', Buffer.from(`config_version=5\n\n[application]\nconfig/name="Viento scene preview"\nrun/main_scene="res://main.tscn"\n\n[display]\nwindow/size/viewport_width=${scene.viewport[0]}\nwindow/size/viewport_height=${scene.viewport[1]}\n\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n`) ],
    ['main.tscn', Buffer.from('[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://runtime.gd" id="1"]\n\n[node name="VientoScene" type="Node2D"]\nscript = ExtResource("1")\n')],
    ['runtime.gd', runtime], ['scene.json', Buffer.from(JSON.stringify(scene, null, 2) + '\n')],
  ]);
  const sourceMap = { format: 'viento-runtime-map', schemaVersion: 2, scene: plan.scene,
    objects: plan.actors.map(actor => ({ instanceId: actor.instanceId, objectId: actor.objectId, sourcePath: actor.sourcePath,
      sourceRevision: actor.sourceRevision, nodePath: `/root/VientoScene/actor_${actor.instanceId.replaceAll('-', '_')}`, declaration: actor.declaration,
      ...(actor.origin ? { origin: actor.origin, fieldSources: actor.fieldSources } : {}) })),
    resources: plan.resources.map(resource => ({ resourceId: resource.id, generatedPath: imageFiles.get(resource.id) })) };
  return { files, imageFiles, sourceMap, backend: { ...GODOT4_BACKEND, sha256: buildHash(Buffer.concat([dispatcher, generator, runtime])) } };
}

// Runtime diagnostics identify an instance; author links still use trusted
// declaration/field locations from the frozen plan, never process output.
function actorLocation(actor, field) {
  return { ...(field ? buildActorFieldLocation(actor, field) : actor.declaration)
    || { objectId: actor.objectId, sourcePath: actor.sourcePath, propertyPath: '' },
    instanceId: actor.instanceId, relatedObjectId: actor.objectId };
}

export function godotDiagnostics(result, plan) {
  const output = `${result.stdout}\n${result.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
  const diagnostics = [];
  // One import line can apply to every instance of a shared resource. Bound
  // both cardinality and message size before expanding it into author links.
  const logLimit = result.status === 'succeeded' ? 256 : 255;
  const sceneLocation = { objectId: plan.scene.objectId, sourcePath: plan.scene.sourcePath, propertyPath: '' };
  for (const line of output.split('\n')) {
    if (diagnostics.length >= logLimit) break;
    if (!/^\s*(?:SCRIPT ERROR:|ERROR:)/.test(line)) continue;
    const resource = plan.resources.find(item => line.includes(item.id));
    const affected = resource ? plan.actors.filter(item => item.imageResourceId === resource.id) : [];
    const item = { severity: 'error', code: 'godot_error', message: line.trim().slice(0, 4096), ...sceneLocation,
      ...(resource ? { resourceId: resource.id } : {}) };
    if (affected.length) {
      for (const actor of affected) {
        if (diagnostics.length >= logLimit) break;
        diagnostics.push({ ...item, ...actorLocation(actor, 'imageResourceId') });
      }
    } else diagnostics.push(item);
  }
  if (result.status !== 'succeeded') diagnostics.push({ severity: 'error', code: `build_process_${result.status}`,
    message: `Godot process ${result.status}.`, ...sceneLocation });
  return diagnostics;
}

// Protocol v2 uses a paired instance and definition identity. Repeated objectId
// values are valid; missing, duplicated or mismatched instanceId values are not.
export function createRuntimeEventReader(plan, { onEvent } = {}) {
  const events = [], diagnostics = [];
  const actors = new Map(plan.actors.map(actor => [actor.instanceId, actor]));
  const prefix = 'VIENTO_RUNTIME:';
  const maxLineLength = 64 * 1024, maxEvents = 4096;
  let pending = '', dropping = false, ready = false, finished = false, ended = false, limitReported = false;
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const keys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
  const state = value => value === 'idle' || value === 'moving';
  const position = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
  const identified = value => typeof value.instanceId === 'string' && actors.has(value.instanceId)
    && actors.get(value.instanceId).objectId === value.objectId;
  const invalid = () => {
    if (diagnostics.length >= 128) return;
    diagnostics.push({ severity: 'error', code: 'runtime_protocol_invalid', message: 'Invalid runtime protocol frame.',
      objectId: plan.scene.objectId, sourcePath: plan.scene.sourcePath, propertyPath: '' });
  };
  const states = value => {
    if (!Array.isArray(value) || value.length !== actors.size) return false;
    const seen = new Set();
    for (const actor of value) {
      if (!plain(actor) || !keys(actor, ['instanceId', 'objectId', 'position', 'state']) || !identified(actor)
        || seen.has(actor.instanceId) || !position(actor.position) || !state(actor.state)) return false;
      seen.add(actor.instanceId);
    }
    return true;
  };
  const line = text => {
    if (!text.startsWith(prefix)) return null;
    if (events.length >= maxEvents) { if (!limitReported) { invalid(); limitReported = true; } return null; }
    let frame;
    try { frame = JSON.parse(text.slice(prefix.length)); } catch { invalid(); return null; }
    if (!plain(frame) || frame.protocol !== 2 || finished) { invalid(); return null; }
    let valid = false;
    switch (frame.event) {
      case 'ready':
        valid = !ready && keys(frame, ['protocol', 'event', 'sceneObjectId', 'actors'])
          && frame.sceneObjectId === plan.scene.objectId && states(frame.actors);
        if (valid) ready = true;
        break;
      case 'state':
        valid = ready && keys(frame, ['protocol', 'event', 'instanceId', 'objectId', 'state'])
          && identified(frame) && state(frame.state);
        break;
      case 'finished':
        valid = ready && keys(frame, ['protocol', 'event', 'actors', 'fixedDelta']) && states(frame.actors)
          && Number.isFinite(frame.fixedDelta) && frame.fixedDelta > 0;
        if (valid) finished = true;
        break;
      case 'diagnostic': {
        const hasInstance = frame.instanceId !== undefined && frame.instanceId !== '';
        const hasObject = frame.objectId !== undefined && frame.objectId !== '';
        const hasResource = frame.resourceId !== undefined && frame.resourceId !== '';
        const actor = actors.get(frame.instanceId);
        valid = keys(frame, ['protocol', 'event', 'severity', 'code', 'message', 'instanceId', 'objectId', 'resourceId'])
          && frame.severity === 'error' && typeof frame.code === 'string' && /^[a-z][a-z0-9_]{0,127}$/.test(frame.code)
          && typeof frame.message === 'string' && frame.message.length > 0 && frame.message.length <= 4096
          && (hasInstance ? identified(frame) : !hasObject || frame.objectId === plan.scene.objectId)
          && (!hasResource || hasInstance && frame.resourceId === actor?.imageResourceId);
        if (valid) {
          diagnostics.push({ severity: 'error', code: frame.code, message: frame.message,
            objectId: plan.scene.objectId, sourcePath: plan.scene.sourcePath, propertyPath: '',
            ...(actor ? actorLocation(actor, hasResource ? 'imageResourceId' : null) : {}),
            ...(hasResource ? { resourceId: frame.resourceId } : {}) });
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

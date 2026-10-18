// Visual animation is an opt-in sidecar over the frozen scene runtimes.
import fs from 'node:fs/promises';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { validateSceneAnimationPlan, stripSceneAnimationPlan, SCENE_ANIMATION_CAPABILITIES } from '../../engine/scene-animation.mjs';
import { generateGodotProject, godotDiagnostics } from './godot4-dispatch.mjs';
import { generateGodotBehaviorProject, godotBehaviorDiagnostics } from './godot4-behaviors.mjs';
import { generateGodotAudioProject, godotAudioDiagnostics } from './godot4-audio.mjs';

const doubles = value => { const bytes = Buffer.alloc(8); bytes.writeDoubleLE(value); return [...bytes]; };
export async function generateGodotAnimationProject(input) {
  const plan = structuredClone(input), animation = validateSceneAnimationPlan(plan), base = stripSceneAnimationPlan(plan);
  const generated = await (base.audio ? generateGodotAudioProject : base.schemaVersion === 3 ? generateGodotBehaviorProject : generateGodotProject)(base);
  const sourceRuntime = await fs.readFile(new URL('./godot4/animation-runtime.gd', import.meta.url));
  const baseName = base.audio ? 'audio-runtime' : base.schemaVersion === 3 ? 'behavior-runtime' : 'runtime';
  const runtime = Buffer.from(sourceRuntime.toString().replace('extends "res://runtime.gd"', `extends "res://${baseName}.gd"`));
  generated.files.set('main.tscn', Buffer.from(generated.files.get('main.tscn').toString().replace(`path="res://${baseName}.gd"`, 'path="res://animation-runtime.gd"')));
  generated.files.set('animation-runtime.gd', runtime);
  generated.files.set('animation.json', Buffer.from(JSON.stringify({ ...animation.document, format: 'viento-godot-animation', durationSecondsBytes: doubles(animation.document.durationSeconds),
    tracks: animation.document.tracks.map(track => ({ ...track, keyframes: track.keyframes.map(key => ({ ...key,
      atSecondsBytes: doubles(key.atSeconds), valueBytes: Array.isArray(key.value) ? key.value.map(doubles) : doubles(key.value),
    })) })),
  }, null, 2) + '\n'));
  generated.sourceMap = { ...generated.sourceMap, animation: { manifest: animation.manifest,
    tracks: animation.document.tracks.map(track => ({ trackId: track.id, instanceId: track.instanceId, property: track.property,
      declaration: animation.locations.tracks.find(item => item.id === track.id).declaration })) } };
  const generator = await fs.readFile(new URL('./godot4-animation.mjs', import.meta.url));
  generated.backend = { ...generated.backend, version: '0.12.0',
    capabilities: [...generated.backend.capabilities, ...SCENE_ANIMATION_CAPABILITIES],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), generator, sourceRuntime])) };
  return generated;
}

export function godotAnimationDiagnostics(result, plan) {
  const base = stripSceneAnimationPlan(plan);
  const diagnostics = (base.audio ? godotAudioDiagnostics : base.schemaVersion === 3 ? godotBehaviorDiagnostics : godotDiagnostics)(result, base);
  // Generated script diagnostics may locate the saved declaration, never author
  // paths supplied by an engine log. Ordinary behavior/audio errors keep theirs.
  const lines = `${result.stdout}\n${result.stderr}`.replace(/\x1b\[[0-9;]*m/g, '').split('\n');
  for (const item of diagnostics) {
    const index = lines.findIndex(line => line.trim().slice(0, 4096) === item.message);
    const vicinity = lines.slice(index, index + 3).join('\n');
    const script = vicinity.match(/res:\/\/(?:scenes\/([a-f0-9-]+)\/)?animation-runtime\.gd/);
    if (index >= 0 && script && (!script[1] || script[1] === plan.scene.objectId)) {
      Object.assign(item, plan.animation.manifest, { propertyPath: '' });
    }
  }
  return diagnostics;
}

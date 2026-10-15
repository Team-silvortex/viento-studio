// Audio is an opt-in sidecar. The legacy scene and behavior generators stay frozen.
import fs from 'node:fs/promises';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { generateGodotProject, godotDiagnostics } from './godot4-dispatch.mjs';
import { generateGodotBehaviorProject, godotBehaviorDiagnostics } from './godot4-behaviors.mjs';

import { validateSceneAudioPlan, stripSceneAudioPlan, audioResourceLocation } from '../../engine/scene-audio.mjs';

export const validateGodotAudioPlan = validateSceneAudioPlan;

export async function generateGodotAudioProject(input) {
  const plan = structuredClone(input), audio = validateGodotAudioPlan(plan);
  const base = stripSceneAudioPlan(plan);
  const generated = await (plan.schemaVersion === 3 ? generateGodotBehaviorProject : generateGodotProject)(base);
  const sourceRuntime = await fs.readFile(new URL('./godot4/audio-runtime.gd', import.meta.url));
  const runtime = Buffer.from(sourceRuntime.toString().replace('extends "res://runtime.gd"', `extends "res://${plan.schemaVersion === 3 ? 'behavior-runtime' : 'runtime'}.gd"`));
  const generator = await fs.readFile(new URL('./godot4-audio.mjs', import.meta.url));
  generated.files.set('main.tscn', Buffer.from(generated.files.get('main.tscn').toString().replace(/path="res:\/\/(?:behavior-runtime|runtime)\.gd"/, 'path="res://audio-runtime.gd"')));
  generated.files.set('audio-runtime.gd', runtime);
  const audioFiles = new Map(plan.resources.filter(resource => resource.kind === 'audio').map(resource => [resource.id, `audio/${resource.id}.wav`]));
  generated.files.set('audio.json', Buffer.from(JSON.stringify({ format: 'viento-godot-audio', schemaVersion: 1, sceneObjectId: audio.document.sceneObjectId,
    tracks: audio.document.tracks.map(track => ({ ...track, file: audioFiles.get(track.resourceId) })),
    // Godot's JSON number parser may round by one ULP. Preserve the IEEE-754
    // value explicitly so a cue just after a fixed-step boundary stays after it.
    cues: audio.document.cues.map(cue => { const bytes = Buffer.alloc(8); bytes.writeDoubleLE(cue.atSeconds);
      return { ...cue, atSecondsBytes: [...bytes] }; }) }, null, 2) + '\n'));
  generated.resourceFiles = new Map([...generated.imageFiles, ...audioFiles]);
  generated.sourceMap = { ...generated.sourceMap,
    resources: [...generated.sourceMap.resources, ...[...audioFiles].map(([resourceId, generatedPath]) => ({ resourceId, generatedPath }))],
    audio: { manifest: audio.manifest, tracks: audio.document.tracks.map(track => ({ trackId: track.id, resourceId: track.resourceId,
      declaration: audio.locations.tracks.find(item => item.id === track.id).declaration })),
      cues: audio.document.cues.map(cue => ({ cueId: cue.id, trackId: cue.trackId,
        declaration: audio.locations.cues.find(item => item.id === cue.id).declaration })) } };
  generated.backend = { ...generated.backend, version: '0.6.0',
    capabilities: [...generated.backend.capabilities, 'audio.nonspatial', 'audio.timeline'],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), generator, sourceRuntime])) };
  return generated;
}

export function godotAudioDiagnostics(result, plan) {
  const diagnostics = (plan.schemaVersion === 3 ? godotBehaviorDiagnostics : godotDiagnostics)(result, stripSceneAudioPlan(plan));
  for (const item of diagnostics) {
    const resource = plan.resources.find(resource => resource.kind === 'audio' && item.message.includes(resource.id));
    if (resource) Object.assign(item, audioResourceLocation(plan, resource.id), { resourceId: resource.id });
  }
  return diagnostics;
}

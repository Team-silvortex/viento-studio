// One engine-neutral assembly becomes one visible Godot project. Only known
// host-generated files are relocated; author GDScript bytes remain untouched.
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { createProjectAnimationStateCatalog } from '../../engine/project-animation-states.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';
import { buildHash, buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';
import { generateGodotProject, godotDiagnostics } from './godot4-dispatch.mjs';
import { generateGodotBehaviorProject, godotBehaviorDiagnostics } from './godot4-behaviors.mjs';
import { generateGodotAudioProject, godotAudioDiagnostics } from './godot4-audio.mjs';
import { generateGodotAnimationProject, godotAnimationDiagnostics } from './godot4-clip-animation.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const invalid = () => { throw buildError('build_assembly_invalid', 'Invalid generated project assembly.'); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const sceneFiles = new Set(['main.tscn', 'runtime.gd', 'scene.json', 'behavior-runtime.gd', 'behaviors.json', 'audio-runtime.gd', 'audio.json', 'animation-runtime.gd', 'animation.json']);
function replaceOne(content, from, to) {
  if (content.split(from).length !== 2) invalid();
  return content.replace(from, to);
}
function relocate(name, bytes, prefix) {
  // JSON carries arbitrary author text. Never rewrite JSON strings or scripts
  // outside the exact generated-file allowlist.
  if (name.endsWith('.json')) return bytes;
  let content = bytes.toString('utf8');
  const targets = name === 'runtime.gd' ? ['scene.json'] : name === 'behavior-runtime.gd' ? ['runtime.gd', 'behaviors.json']
    : name === 'audio-runtime.gd' ? [content.startsWith('extends "res://behavior-runtime.gd"') ? 'behavior-runtime.gd' : 'runtime.gd', 'audio.json']
      : name === 'animation-runtime.gd' ? [content.startsWith('extends "res://audio-runtime.gd"') ? 'audio-runtime.gd' : content.startsWith('extends "res://behavior-runtime.gd"') ? 'behavior-runtime.gd' : 'runtime.gd', 'animation.json']
      : name === 'main.tscn' ? [content.includes('res://animation-runtime.gd') ? 'animation-runtime.gd' : content.includes('res://audio-runtime.gd') ? 'audio-runtime.gd' : content.includes('res://behavior-runtime.gd') ? 'behavior-runtime.gd' : 'runtime.gd'] : [];
  if (!targets.length) invalid();
  for (const target of targets) content = replaceOne(content, `"res://${target}"`, `"res://${prefix}/${target}"`);
  if (name === 'behavior-runtime.gd') content = replaceOne(content, '\t\tinstance.set_meta("viento_object_id", binding["objectId"])',
    '\t\tinstance.set_meta("viento_object_id", binding["objectId"])\n\t\tinstance.set_meta("viento_project", call("project_behavior_port", binding, instance))');
  return Buffer.from(content);
}
export async function generateGodotAssemblyProject(input) {
  const plan = validateProjectAssemblyPlan(input), files = new Map(), resourceFiles = new Map(), maps = [], backendHashes = [], rows = [], behaviorSources = new Map(), stateWrappers = new Map();
  const animationControl = plan.scenes.some(scene => scene.animation);
  const clipControl = animationControl;
  const stateCatalog = createProjectAnimationStateCatalog(plan), stateControl = stateCatalog.scenes.length > 0;
  const stateEntryController = stateControl ? await fs.readFile(new URL('./godot4/project-animation-state-entry-runtime.gd', import.meta.url)) : null;
  const stateEntryWrapper = stateControl ? await fs.readFile(new URL('./godot4/project-animation-state-entry-wrapper.gd', import.meta.url)) : null;
  const stateController = stateControl ? await fs.readFile(new URL('./godot4/project-animation-state-runtime.gd', import.meta.url)) : null;
  const completionController = animationControl ? await fs.readFile(new URL('./godot4/project-completion-runtime.gd', import.meta.url)) : null;
  const completionQueue = animationControl ? await fs.readFile(new URL('./godot4/project-animation-completions.gd', import.meta.url)) : null;
  const clipController = clipControl ? await fs.readFile(new URL('./godot4/project-clip-runtime.gd', import.meta.url)) : null;
  const controller = animationControl ? await fs.readFile(new URL('./godot4/project-control-runtime.gd', import.meta.url)) : null;
  const animationQueue = animationControl ? await fs.readFile(new URL(clipControl ? './godot4/project-animation-clips.gd' : './godot4/project-animation.gd', import.meta.url)) : null;
  const animationBridge = animationControl ? await fs.readFile(new URL('./godot4/project-animation-completion-scene.gd', import.meta.url)) : null;
  const coordinator = await fs.readFile(new URL('./godot4/project-runtime.gd', import.meta.url));
  const bridge = await fs.readFile(new URL('./godot4/project-scene.gd', import.meta.url));
  const eventBus = await fs.readFile(new URL('./godot4/project-events.gd', import.meta.url));
  const audioControl = await fs.readFile(new URL('./godot4/project-audio.gd', import.meta.url));
  let project;
  const put = (name, bytes) => { const previous = files.get(name); if (previous && !previous.equals(bytes)) invalid(); files.set(name, bytes); };
  for (const child of plan.scenes) {
    const generated = await (child.animation ? generateGodotAnimationProject : child.audio ? generateGodotAudioProject : child.schemaVersion === 3 ? generateGodotBehaviorProject : generateGodotProject)(child);
    const prefix = `scenes/${child.scene.objectId}`, runtimeScripts = [];
    for (const [name, bytes] of generated.files) {
      if (name === 'project.godot') {
        if (child.scene.objectId === plan.entrySceneId) {
          const selected = replaceOne(bytes.toString(), '"res://main.tscn"', '"res://project.tscn"');
          project = Buffer.from(replaceOne(selected, 'config/name="Viento scene preview"', `config/name=${JSON.stringify(plan.assembly.title)}`));
        }
      } else if (sceneFiles.has(name)) {
        let content = relocate(name, bytes, prefix);
        if (stateControl && name === 'behavior-runtime.gd') content = Buffer.from(replaceOne(content.toString(), '\t\tvar instance = script.new()', '\t\tvar instance = call("project_behavior_instance", binding, script)'));
        if (name === 'main.tscn') content = Buffer.from(replaceOne(content.toString(),
          `"res://${prefix}/${child.animation ? 'animation-runtime' : child.audio ? 'audio-runtime' : child.schemaVersion === 3 ? 'behavior-runtime' : 'runtime'}.gd"`, `"res://${prefix}/project-scene.gd"`));
        put(`${prefix}/${name}`, content);
        if (name.endsWith('.gd')) runtimeScripts.push(`${prefix}/${name}`);
      } else {
        const source = child.behaviors?.sources.find(source => name === `behaviors/${source.objectId}.gd`);
        if (!source || !Buffer.from(source.content).equals(bytes)) invalid();
        put(name, bytes); behaviorSources.set(source.objectId, { objectId: source.objectId, path: name });
      }
    }
    for (const [id, file] of generated.resourceFiles || generated.imageFiles) {
      if (resourceFiles.has(id) && resourceFiles.get(id) !== file) invalid(); resourceFiles.set(id, file);
    }
    if (stateControl) for (const controller of stateCatalog.scenes.find(scene => scene.sceneId === child.scene.objectId)?.controllers || []) {
      const scriptObjectId = controller.scriptObjectId, name = `animation-state-wrappers/${scriptObjectId}.gd`;
      put(name, Buffer.from(replaceOne(stateEntryWrapper.toString(), '__SCRIPT_OBJECT_ID__', scriptObjectId)));
      stateWrappers.set(scriptObjectId, { scriptObjectId, path: name });
    }
    let wrapper = bridge.toString();
    if (stateControl) wrapper += '\nfunc project_behavior_instance(binding: Dictionary, script: Script):\n\treturn project_host.make_behavior_instance(project_visit, binding, script)\n';
    const flags = [child.schemaVersion === 3 ? 'behavior_failed = true' : '', child.audio ? 'audio_failed = true' : '', child.animation ? 'animation_failed = true' : ''].filter(Boolean);
    for (const [token, value] of [
      ['__BASE_RUNTIME__', `res://${prefix}/${child.animation ? 'animation-runtime' : child.audio ? 'audio-runtime' : child.schemaVersion === 3 ? 'behavior-runtime' : 'runtime'}.gd`],
      ['__CHILD_PROTOCOL__', String(child.schemaVersion)], ['__DIAGNOSTIC_FLAGS__', flags.join('\n\t\t') || 'pass'],
      ['__BEHAVIOR_FINISH__', child.schemaVersion === 3 ? 'behavior_finished = true' : 'pass'],
      ['__AUDIO_SHUTDOWN__', child.audio ? 'audio_shutdown()' : 'pass'],
      ['__ANIMATION_SHUTDOWN__', child.animation ? 'animation_shutdown()' : 'pass'],
      ['__AUDIO_TRACKS__', JSON.stringify(Object.fromEntries((child.audio?.document.tracks || []).map(track => [track.id, track.resourceId])))],
      ['__AUDIO_CONTROL__', child.audio ? 'if not project_open or not audio_started or audio_failed or audio_finished or not audio_players.has(track_id):\n\t\treturn false\n\tvar player = audio_players[track_id]\n\tif not is_instance_valid(player) or not player is AudioStreamPlayer:\n\t\treturn false\n\tif action == "play":\n\t\tplayer.play(0.0)\n\telif action == "stop":\n\t\tplayer.stop()\n\telse:\n\t\treturn false\n\treturn true' : 'return false'],
      ['__AUDIO_TIME__', child.audio ? 'return audio_time' : 'return 0.0'],
    ]) wrapper = replaceOne(wrapper, token, value);
    if (animationControl) {
      if (child.animation) {
        const duration = Buffer.alloc(8); duration.writeDoubleLE(child.animation.document.durationSeconds);
        wrapper += animationBridge.toString().replace('__ANIMATION_SCENE__', JSON.stringify(child.scene.objectId))
          .replace('__ANIMATION_DURATION_BYTES__', JSON.stringify([...duration]));
        if (clipControl) {
          const encode = value => { const bytes = Buffer.alloc(8); bytes.writeDoubleLE(value); return [...bytes]; };
          wrapper = wrapper.replace('__ANIMATION_CLIPS__', JSON.stringify(Object.fromEntries((child.animation.document.clips || []).map(clip =>
            [clip.id, { startBytes: encode(clip.startSeconds), endBytes: encode(clip.endSeconds), loop: clip.loop }]))));
        }
      } else wrapper += '\nfunc project_animation_declared() -> bool:\n\treturn false\n\nfunc project_animation_duration() -> float:\n\treturn 0.0\n\nfunc project_animation_execute(_command: Dictionary):\n\treturn null\n';
    }
    put(`${prefix}/project-scene.gd`, Buffer.from(wrapper)); runtimeScripts.push(`${prefix}/project-scene.gd`);
    generated.sourceMap.objects = generated.sourceMap.objects.map(object => ({ ...object, nodePath: object.nodePath.replace('/root/VientoScene/', '/root/VientoProject/VientoScene/') }));
    rows.push({ sceneId: child.scene.objectId, entry: `${prefix}/main.tscn`, runtimeScripts,
      ...(stateControl ? { animationStateControllers: (stateCatalog.scenes.find(scene => scene.sceneId === child.scene.objectId)?.controllers || [])
        .map(({ bindingId, instanceId, objectId, scriptObjectId, states, clips }) => ({ bindingId, instanceId, objectId, scriptObjectId, states, clips })) } : {}) });
    maps.push({ sceneId: child.scene.objectId, entry: `${prefix}/main.tscn`, sourceMap: generated.sourceMap });
    backendHashes.push({ sceneId: child.scene.objectId, sha256: generated.backend.sha256 });
  }
  if (!project) invalid(); put('project.godot', project);
  put('project-runtime.gd', coordinator);
  put('project-events.gd', eventBus);
  put('project-audio.gd', audioControl);
  if (animationControl) { put('project-control-runtime.gd', controller); put('project-animation.gd', animationQueue); }
  if (clipControl) put('project-clip-runtime.gd', clipController);
  if (animationControl) { put('project-completion-runtime.gd', completionController); put('project-animation-completions.gd', completionQueue); }
  if (stateControl) { put('project-animation-state-runtime.gd', stateController); put('project-animation-state-entry-runtime.gd', stateEntryController); }
  put('project.tscn', Buffer.from(`[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://${stateControl ? 'project-animation-state-entry-runtime.gd' : animationControl ? 'project-completion-runtime.gd' : 'project-runtime.gd'}" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\n`));
  put('assembly.json', json({ format: 'viento-godot-project', schemaVersion: stateControl ? 10 : animationControl ? 8 : 5, assembly: plan.assembly, entrySceneId: plan.entrySceneId,
    scenes: rows, ...(stateControl ? { animationStateWrappers: [...stateWrappers.values()].sort((a, b) => a.scriptObjectId.localeCompare(b.scriptObjectId)) } : {}), behaviorSources: [...behaviorSources.values()].sort((a, b) => a.objectId.localeCompare(b.objectId)) }));
  const generator = await fs.readFile(new URL('./godot4-project.mjs', import.meta.url));
  return { files, resourceFiles, sourceMap: { format: 'viento-project-runtime-map', schemaVersion: 1, assembly: plan.assembly,
    entrySceneId: plan.entrySceneId, scenes: maps,
    ...(stateControl ? { animationStateWrappers: [...stateWrappers.values()] } : {}),
    behaviors: maps.flatMap(item => (item.sourceMap.behaviors || []).map(binding => ({ ...binding, sceneId: item.sceneId }))),
    resources: [...resourceFiles].map(([resourceId, generatedPath]) => ({ resourceId, generatedPath })) },
    backend: { id: 'org.viento.godot4', version: stateControl ? '0.18.0' : animationControl ? '0.16.0' : '0.11.0', protocolVersion: stateControl ? 9 : animationControl ? 7 : 4, capabilities: [...plan.requiredCapabilities, 'project.scene-switching', 'project.shared-state', 'project.events', 'project.audio-control', ...(animationControl ? ['project.animation-control', 'project.animation-completion'] : []), ...(stateControl ? ['project.animation-state-snapshots', 'project.animation-state-entries'] : [])],
      artifactKind: 'godot-project', platforms: ['linux'], execution: { headlessLogic: true, windowPreview: true, embeddedViewport: false, gpuCompute: false },
      sha256: buildHash(Buffer.concat([generator, coordinator, bridge, eventBus, audioControl, ...(stateControl ? [stateController, stateEntryController, stateEntryWrapper] : []), ...(animationControl ? [controller, animationQueue, animationBridge, completionController, completionQueue] : []), ...(clipControl ? [clipController] : []), Buffer.from(canonicalJson(backendHashes))])) } };
}

/** Read only a bounded, generated inventory; author text never selects scripts. */
export async function godotAssemblyScripts(directory, signal) {
  let value, bytes;
  try { bytes = await readBuildFile(path.join(directory, 'assembly.json'), 4 * 1024 * 1024, signal); value = JSON.parse(bytes); }
  catch (error) { if (error.code === 'ENOENT') return null; invalid(); }
  if (!exact(value, ['format', 'schemaVersion', 'assembly', 'entrySceneId', 'scenes', 'behaviorSources', ...(value?.schemaVersion === 10 ? ['animationStateWrappers'] : [])])
    || value.schemaVersion < 9 && bytes.length > 128 * 1024
    || value.format !== 'viento-godot-project' || ![5, 6, 7, 8, 9, 10].includes(value.schemaVersion) || !uuid(value.assembly?.objectId)
    || !uuid(value.entrySceneId) || !Array.isArray(value.scenes) || value.scenes.length < 1 || value.scenes.length > 32
    || !Array.isArray(value.behaviorSources) || value.behaviorSources.length > 256) invalid();
  const ids = new Set(), scripts = ['project-runtime.gd', 'project-events.gd', 'project-audio.gd', ...(value.schemaVersion >= 6 ? ['project-control-runtime.gd', 'project-animation.gd'] : []), ...(value.schemaVersion >= 7 ? ['project-clip-runtime.gd'] : []), ...(value.schemaVersion >= 8 ? ['project-completion-runtime.gd', 'project-animation-completions.gd'] : []), ...(value.schemaVersion >= 9 ? ['project-animation-state-runtime.gd'] : []), ...(value.schemaVersion === 10 ? ['project-animation-state-entry-runtime.gd'] : [])];
  for (const row of value.scenes) {
    if (!exact(row, ['sceneId', 'entry', 'runtimeScripts', ...(value.schemaVersion >= 9 ? ['animationStateControllers'] : [])]) || !uuid(row.sceneId) || ids.has(row.sceneId)
      || row.entry !== `scenes/${row.sceneId}/main.tscn` || !Array.isArray(row.runtimeScripts)
      || row.runtimeScripts.length < 2 || row.runtimeScripts.length > 5 || new Set(row.runtimeScripts).size !== row.runtimeScripts.length
      || !row.runtimeScripts.includes(`scenes/${row.sceneId}/runtime.gd`)
      || !row.runtimeScripts.includes(`scenes/${row.sceneId}/project-scene.gd`)
      || row.runtimeScripts.some(file => !['runtime.gd', 'behavior-runtime.gd', 'audio-runtime.gd', 'animation-runtime.gd', 'project-scene.gd'].some(name => file === `scenes/${row.sceneId}/${name}`))) invalid();
    if (value.schemaVersion >= 9) {
      if (!Array.isArray(row.animationStateControllers) || row.animationStateControllers.length > 32
        || row.animationStateControllers.length && !row.runtimeScripts.includes(`scenes/${row.sceneId}/animation-runtime.gd`)) invalid();
      const bindings = new Set();
      for (const controller of row.animationStateControllers) {
        if (!exact(controller, ['bindingId', 'instanceId', 'objectId', 'states', 'clips', ...(value.schemaVersion === 10 ? ['scriptObjectId'] : [])])
          || value.schemaVersion === 10 && !uuid(controller.scriptObjectId)
          || !uuid(controller.bindingId) || !uuid(controller.instanceId) || !uuid(controller.objectId) || bindings.has(controller.bindingId)
          || !Array.isArray(controller.states) || controller.states.length < 1 || controller.states.length > 16
          || controller.states.some(key => typeof key !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(key))
          || new Set(controller.states).size !== controller.states.length || !Array.isArray(controller.clips)
          || controller.clips.length !== controller.states.length || controller.clips.some(id => id !== null && !uuid(id))) invalid();
        bindings.add(controller.bindingId);
      }
    }
    ids.add(row.sceneId); scripts.push(...row.runtimeScripts);
  }
  if (!ids.has(value.entrySceneId) || value.schemaVersion >= 9 && !value.scenes.some(scene => scene.animationStateControllers.length)) invalid();
  const sources = new Set();
  for (const row of value.behaviorSources) {
    if (!exact(row, ['objectId', 'path']) || !uuid(row.objectId) || sources.has(row.objectId) || row.path !== `behaviors/${row.objectId}.gd`) invalid();
    sources.add(row.objectId); scripts.push(row.path);
  }
  if (value.schemaVersion === 10) {
    const expected = new Set(value.scenes.flatMap(scene => scene.animationStateControllers.map(controller => controller.scriptObjectId))), wrappers = new Set();
    if (!Array.isArray(value.animationStateWrappers) || value.animationStateWrappers.length < 1 || value.animationStateWrappers.length > 256) invalid();
    for (const row of value.animationStateWrappers) {
      if (!exact(row, ['scriptObjectId', 'path']) || !uuid(row.scriptObjectId) || wrappers.has(row.scriptObjectId)
        || !sources.has(row.scriptObjectId) || !expected.has(row.scriptObjectId) || row.path !== `animation-state-wrappers/${row.scriptObjectId}.gd`) invalid();
      wrappers.add(row.scriptObjectId); scripts.push(row.path);
    }
    if (wrappers.size !== expected.size) invalid();
  }
  for (const script of scripts) await readBuildFile(await resolveContainedPath(directory, path.join(directory, script)), 65536, signal);
  return scripts;
}

export function godotAssemblyDiagnostics(result, plan) {
  const selected = new Map(), output = `${result.stdout}\n${result.stderr}`.replace(/\x1b\[[0-9;]*m/g, ''), lines = output.split('\n');
  for (const child of plan.scenes) {
    const diagnostics = (child.animation ? godotAnimationDiagnostics : child.audio ? godotAudioDiagnostics : child.schemaVersion === 3 ? godotBehaviorDiagnostics : godotDiagnostics)({ ...result, status: 'succeeded' }, child);
    for (const item of diagnostics) {
      const specific = item.objectId !== child.scene.objectId || item.resourceId;
      const index = lines.findIndex(line => line.trim().slice(0, 4096) === item.message);
      const vicinity = lines.slice(index, index + 4).join('\n');
      const wrapperFailure = /res:\/\/animation-state-wrappers\/[a-f0-9-]+\.gd(?::|\")/.test(vicinity);
      if (wrapperFailure) { Object.assign(item, plan.assembly, { propertyPath: '' }); delete item.sourceLine; delete item.sourceRange; }
      const named = plan.scenes.find(scene => vicinity.includes(`res://scenes/${scene.scene.objectId}/`));
      if (!specific && named && named.scene.objectId !== child.scene.objectId) continue;
      if (!specific && !named) Object.assign(item, plan.assembly, { propertyPath: '' });
      const key = canonicalJson(item); if (!selected.has(key) && selected.size < 255) selected.set(key, item);
    }
  }
  if (result.status !== 'succeeded') selected.set('process', { severity: 'error', code: `build_process_${result.status}`,
    message: `Godot process ${result.status}.`, ...plan.assembly, propertyPath: '' });
  return [...selected.values()];
}

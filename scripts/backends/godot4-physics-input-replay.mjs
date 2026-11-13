// A replay driver exists only for one validated execution and never rewrites
// author files or the frozen generated project.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateProjectPhysics2DInputReplay } from '../../engine/project-physics2d-input-replay.mjs';
import { buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { godotPhysicsPlanarIntentAssemblyScripts } from './godot4-physics-planar-intent.mjs';
import { validateGodotPhysicsReplayTargets, projectGodotPhysicsInstanceReplay } from './godot4-physics-instance-input-replay-projection.mjs';

const unsupported = () => { throw buildError('runtime_physics2d_input_unsupported', 'Physics input replay requires a single physics scene with no behaviors, animation, or audio.'); };
const optional = async file => fs.access(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });

export async function executeGodotPhysicsInputReplay({ directory, tool, signal, options, physicsControlProgram }) {
  let program;
  try { program = validateProjectPhysics2DInputReplay(physicsControlProgram); }
  catch (error) { throw buildError(error.errorCode || 'runtime_physics2d_input_invalid', 'Invalid physics input replay program.'); }
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw buildError('build_output_invalid', 'Physics replay requires an owned generated directory.');
  const scripts = await godotPhysicsPlanarIntentAssemblyScripts(directory, signal);
  if (!scripts) unsupported();
  const read = async (name, limit = 4 * 1024 * 1024) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), limit, signal);
  const assembly = JSON.parse(await read('assembly.json'));
  const physics = JSON.parse(await read('physics-project.json', 8192));
  if (assembly.schemaVersion !== 5 || !Array.isArray(assembly.scenes) || assembly.scenes.length !== 1
      || !Array.isArray(assembly.behaviorSources) || assembly.behaviorSources.length !== 0
      || assembly.entrySceneId !== assembly.scenes[0].sceneId
      || !Array.isArray(physics.sceneIds) || physics.sceneIds.length !== 1 || physics.sceneIds[0] !== assembly.entrySceneId) unsupported();
  const row = assembly.scenes[0], prefix = `scenes/${row.sceneId}`;
  if (!Array.isArray(row.runtimeScripts) || row.runtimeScripts.length !== 2
      || !row.runtimeScripts.includes(`${prefix}/runtime.gd`) || !row.runtimeScripts.includes(`${prefix}/project-scene.gd`)
      || await optional(path.join(directory, prefix, 'behaviors.json')) || await optional(path.join(directory, prefix, 'audio.json'))
      || await optional(path.join(directory, prefix, 'animation.json'))) unsupported();
  const entry = (await read('project.tscn', 8192)).toString();
  const matches = [...entry.matchAll(/path="res:\/\/(project-physics(?:-observation)?-runtime\.gd)"/g)];
  if (matches.length !== 1 || !scripts.includes(matches[0][1])) unsupported();
  if (program.schemaVersion === 2) {
    const [scene, declaration] = await Promise.all([read(`${prefix}/scene.json`), read(`${prefix}/physics.json`, 131072)]);
    try { validateGodotPhysicsReplayTargets(JSON.parse(scene), JSON.parse(declaration), program); }
    catch (error) { throw buildError(error.errorCode || 'runtime_physics2d_input_projection_invalid', error.message); }
    const basename = `viento-physics-replay-${randomUUID()}`;
    let projection;
    try { projection = await projectGodotPhysicsInstanceReplay({ sceneId: row.sceneId,
      main: (await read(`${prefix}/main.tscn`, 65536)).toString(), scripts, read, prefix: basename }); }
    catch (error) {
      if (signal?.aborted || error.name === 'AbortError') throw error;
      throw buildError(error.errorCode || 'runtime_physics2d_input_projection_invalid', 'Unsupported generated physics input inheritance.');
    }
    const [sceneSource, driverSource] = await Promise.all(['scene', 'driver'].map(name => fs.readFile(new URL(`./godot4/physics-instance-input-replay-${name}.gd`, import.meta.url), 'utf8')));
    const sceneScript = `${basename}/scene.gd`, sceneFile = `${basename}/scene.tscn`, driverScript = `${basename}/driver.gd`, driverFile = `${basename}/driver.tscn`;
    const tscn = (name, script) => `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://${script}" id="1"]\n\n[node name="${name}" type="Node2D"]\nscript = ExtResource("1")\n`;
    const files = [...projection.files, [sceneScript, sceneSource.replace('__SCENE_SCRIPT__', projection.entry)],
      [sceneFile, tscn('VientoScene', sceneScript)],
      [driverScript, driverSource.replace('__HOST_SCRIPT__', matches[0][1]).replace('__PROGRAM_JSON__', JSON.stringify(program)).replace('__REPLAY_SCENE__', sceneFile)],
      [driverFile, tscn('VientoProject', driverScript)]];
    const owned = path.join(directory, basename);
    signal?.throwIfAborted();
    await fs.mkdir(owned, { mode: 0o700 });
    try {
      for (const [name, contents] of files) {
        signal?.throwIfAborted();
        await fs.writeFile(path.join(directory, name), contents, { flag: 'wx', mode: 0o600 });
      }
      return await runBuildProcess(tool.executable, ['--path', directory, '--headless', `res://${driverFile}`, '--', '--viento-smoke'], options);
    } finally {
      // Includes Godot-created .gd.uid companions; no original file is removed.
      await fs.rm(owned, { recursive: true, force: true });
    }
  }
  const driver = (await fs.readFile(new URL('./godot4/physics-input-replay-driver.gd', import.meta.url), 'utf8'))
    .replace('__HOST_SCRIPT__', matches[0][1]).replace('__PROGRAM_JSON__', JSON.stringify(program));
  const basename = `viento-physics-replay-${randomUUID()}`, script = `${basename}.gd`, scene = `${basename}.tscn`;
  const files = [[script, driver], [scene, `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://${script}" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\n`]];
  const staged = [];
  try {
    for (const [name, contents] of files) {
      const target = path.join(directory, name);
      await fs.writeFile(target, contents, { flag: 'wx', mode: 0o600 });
      staged.push(target);
    }
    return await runBuildProcess(tool.executable, ['--path', directory, '--headless', `res://${scene}`, '--', '--viento-smoke'], options);
  } finally {
    for (const target of staged.reverse()) await fs.rm(target, { force: true });
  }
}

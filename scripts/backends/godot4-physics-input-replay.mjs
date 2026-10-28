// A replay driver exists only for one validated execution and never rewrites
// author files or the frozen generated project.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateProjectPhysics2DInputReplay } from '../../engine/project-physics2d-input-replay.mjs';
import { buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { godotPhysicsCharacterIntentAssemblyScripts } from './godot4-physics-character-intent.mjs';

const unsupported = () => { throw buildError('runtime_physics2d_input_unsupported', 'Physics input replay requires a single physics scene with no behaviors, animation, or audio.'); };
const optional = async file => fs.access(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });

export async function executeGodotPhysicsInputReplay({ directory, tool, signal, options, physicsControlProgram }) {
  let program;
  try { program = validateProjectPhysics2DInputReplay(physicsControlProgram); }
  catch (error) { throw buildError(error.errorCode || 'runtime_physics2d_input_invalid', 'Invalid physics input replay program.'); }
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw buildError('build_output_invalid', 'Physics replay requires an owned generated directory.');
  const scripts = await godotPhysicsCharacterIntentAssemblyScripts(directory, signal);
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

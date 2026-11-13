import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { hookGodotPhysicsInstanceReplay, godotPhysicsReplayTargets, validateGodotPhysicsReplayTargets,
  projectGodotPhysicsInstanceReplay } from '../backends/godot4-physics-instance-input-replay-projection.mjs';

const id = n => `81818181-8181-4181-8181-${String(n).padStart(12, '0')}`;
const load = name => fs.readFile(new URL(`../backends/godot4/${name}`, import.meta.url), 'utf8');
const error = { errorCode: 'runtime_physics2d_input_projection_invalid' };
const prefix = `viento-physics-replay-${id(100)}`;
const main = script => `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://${script}" id="1"]\n\n[node name="VientoScene" type="Node2D"]\nscript = ExtResource("1")\n`;

test('instance input hook preserves the complete native movement body and replaces only exact input expressions', async () => {
  for (const name of ['runtime-v2.gd', 'physics-runtime.gd', 'physics-response-runtime.gd', 'physics-observation-runtime.gd', 'physics-character-motion-runtime.gd']) {
    const source = await load(name), result = hookGodotPhysicsInstanceReplay(source);
    assert.equal(result.directions, 1, name);
    assert.equal(result.motors, name.includes('character-motion') ? 1 : 0);
    assert.doesNotMatch(result.source, /Input\.(?:get_vector|get_axis|is_action_pressed)\(/);
    const native = source.match(/^.*(?:move_and_collide|physics_observation_move|platform_motion|velocity\.y|character_motion_grounded|character_motion_velocities).*$/gm) || [];
    for (const line of native) if (!line.includes('jump_pressed')) assert.ok(result.source.includes(line), `${name}: ${line}`);
    assert.equal(source, await load(name), 'source files are unchanged');
  }
});

test('instance hooks reject duplicate, partially changed and newly generated input sites', async () => {
  const source = await load('physics-character-motion-runtime.gd');
  for (const altered of [source + source, source.replace('jump_pressed and actor', 'jump_pressed or actor'),
    source.replace('horizontal * actor', 'horizontal + actor'), source.replace('Input.get_axis', 'Input.get_vector'),
    source + '\n# physics_instance_replay_frame\n', source.replace('Input.get_vector("ui_left"', 'Input.get_vector("other"')]) {
    assert.throws(() => hookGodotPhysicsInstanceReplay(altered), error);
  }
});

test('backend eligibility uses stable physical instances, independent of shared object identities', () => {
  const scene = { actors: [1, 2, 3, 4, 5, 6].map(n => ({ instanceId: id(n), objectId: id(50), controls: n === 4 ? 'none' : 'arrows' })) };
  const physics = { bodies: [1, 2, 3, 4, 5].map(n => ({ instanceId: id(n), kind: n === 3 ? 'static' : n === 5 ? 'sensor' : 'character' })) };
  assert.deepEqual(godotPhysicsReplayTargets(scene, physics), [id(1), id(2)]);
  for (const n of [3, 4, 5, 6, 99]) assert.throws(() => validateGodotPhysicsReplayTargets(scene, physics,
    { steps: [{ inputs: [{ instanceId: id(n) }] }] }), { errorCode: 'runtime_physics2d_input_target_invalid' });
  assert.doesNotThrow(() => validateGodotPhysicsReplayTargets(scene, physics, { steps: [{ inputs: [{ instanceId: id(2) }, { instanceId: id(1) }] }, { inputs: [] }] }));
  assert.throws(() => godotPhysicsReplayTargets({ actors: [...scene.actors, scene.actors[0]] }, physics), error);
});

test('bounded inheritance projection follows only admitted scripts and keeps all original resources in place', async () => {
  const sceneId = id(1), top = `scenes/${sceneId}/project-scene.gd`, base = `scenes/${sceneId}/runtime.gd`;
  const sources = new Map([[top, Buffer.from(`extends "res://${base}"\n\nfunc project_step(delta: float) -> void:\n\tsuper._process(delta)\n`)],
    [base, Buffer.from(await load('physics-observation-runtime.gd').then(source => source.replace('extends "__PHYSICS_RUNTIME__"', 'extends Node2D')))]]);
  const before = [...sources].map(([name, bytes]) => [name, Buffer.from(bytes)]), reads = [];
  const result = await projectGodotPhysicsInstanceReplay({ sceneId, main: main(top), prefix, scripts: [...sources.keys()],
    read: async name => { reads.push(name); return sources.get(name); } });
  assert.deepEqual(reads, [top, base]); assert.equal(result.directions, 1); assert.equal(result.motors, 0);
  assert.equal(result.entry, `${prefix}/chain-0.gd`);
  assert.match(result.files[0][1].toString(), new RegExp(`extends "res://${prefix}/chain-1.gd"`));
  assert.match(result.files[1][1].toString(), /res:\/\/__PHYSICS_DOCUMENT__|__PHYSICS_DOCUMENT__/);
  assert.deepEqual([...sources], before);
  for (const scripts of [[top], [], [base]]) await assert.rejects(projectGodotPhysicsInstanceReplay({ sceneId, main: main(top), prefix, scripts, read: async name => sources.get(name) }), error);
  const loop = new Map([[top, Buffer.from(`extends "res://${top}"\n`)]]);
  await assert.rejects(projectGodotPhysicsInstanceReplay({ sceneId, main: main(top), prefix, scripts: [top], read: async name => loop.get(name) }), error);
});

test('inheritance projection rejects script count, byte budget, cross-scene and unrecognized root changes', async () => {
  const sceneId = id(1), names = Array.from({ length: 33 }, (_, n) => `scenes/${sceneId}/chain-${n}.gd`);
  const sources = new Map(names.map((name, n) => [name, Buffer.from(n === 32 ? 'extends Node2D\n' : `extends "res://${names[n + 1]}"\n`)]));
  const run = () => projectGodotPhysicsInstanceReplay({ sceneId, main: main(names[0]), prefix, scripts: [...sources.keys()], read: async name => sources.get(name) });
  await assert.rejects(run(), error);
  sources.set(names[0], Buffer.from('extends Node2D\n' + '#'.repeat(65536))); await assert.rejects(run(), error);
  sources.set(names[0], Buffer.from(`extends "res://scenes/${id(2)}/runtime.gd"\n`)); await assert.rejects(run(), error);
  sources.set(names[0], Buffer.from('extends Node3D\n')); await assert.rejects(run(), error);
  for (const name of names.slice(0, 32)) sources.set(name, Buffer.from((name === names[31] ? 'extends Node2D\n' : `extends "res://${names[names.indexOf(name) + 1]}"\n`) + '#'.repeat(40000)));
  sources.set(names[30], Buffer.from('extends Node2D\n' + '#'.repeat(40000))); await assert.rejects(run(), error);
});

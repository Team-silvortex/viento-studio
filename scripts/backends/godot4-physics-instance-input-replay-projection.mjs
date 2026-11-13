// Execution-only input projection. Reads are restricted to the already admitted
// generated inheritance chain; original files and native movement stay intact.
export const PHYSICS_INSTANCE_INPUT_REPLAY_CAPABILITY = 'physics.input-replay-instances2d';
const invalid = () => { throw Object.assign(new TypeError('Unsupported generated physics input inheritance.'), { errorCode: 'runtime_physics2d_input_projection_invalid' }); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const field = id => `get("physics_instance_replay_frame").get(${id}, {})`;
const direction = '\t\tvar direction := input if actor["controls"] == "arrows" else Vector2.ZERO';
const planarDirection = '\t\tvar direction: Vector2 = input if actor["controls"] == "arrows" else get("planar_intent").take(actor["instanceId"])';
const vector = 'Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")';
const axis = 'Input.get_axis("ui_left", "ui_right")';
const held = 'Input.is_action_pressed("ui_accept")';
const jump = 'jump_pressed and actor["controls"] == "arrows"';
const horizontal = 'horizontal * actor["speed"]';
const moving = 'horizontal != 0.0';
function count(source, token) { return source.split(token).length - 1; }
export function hookGodotPhysicsInstanceReplay(source) {
  if (typeof source !== 'string' || source.includes('physics_instance_replay_frame')) invalid();
  const ordinary = count(source, direction), planar = count(source, planarDirection), vectors = count(source, vector);
  if (ordinary + planar > 1 || vectors > 1 || ordinary + planar !== vectors) invalid();
  let result = source;
  if (ordinary || planar) {
    const suffix = planar ? 'get("planar_intent").take(actor["instanceId"])' : 'Vector2.ZERO';
    result = result.replace(ordinary ? direction : planarDirection,
      `\t\tvar direction: Vector2 = ${field('actor["instanceId"]')}.get("direction", Vector2.ZERO) if actor["controls"] == "arrows" else ${suffix}`);
    result = result.replace(vector, 'Vector2.ZERO');
  }
  const motor = count(source, axis);
  if (motor) {
    if (motor !== 1 || !vectors || count(source, held) !== 2 || count(source, jump) !== 1
      || count(source, horizontal) !== 1 || count(source, moving) !== 1) invalid();
    result = result.replace(axis, '0.0').split(held).join('false')
      .replace(jump, `bool(${field('instance_id')}.get("jump", false)) and actor["controls"] == "arrows"`)
      .replace(horizontal, `float(${field('instance_id')}.get("axis", 0.0)) * actor["speed"]`)
      .replace(moving, `float(${field('instance_id')}.get("axis", 0.0)) != 0.0`);
  } else if (count(source, held) || count(source, jump) || count(source, horizontal) || count(source, moving)) invalid();
  // New or differently generated input sites need their own reviewed hook.
  if (result.includes('Input.get_vector(') || result.includes('Input.get_axis(')
    || result.includes('Input.is_action_pressed(')) invalid();
  return { source: result, directions: ordinary + planar, motors: motor };
}
export function godotPhysicsReplayTargets(scene, physics) {
  if (!Array.isArray(scene?.actors) || !Array.isArray(physics?.bodies)) invalid();
  const actors = new Map();
  for (const actor of scene.actors) {
    if (!uuid(actor?.instanceId) || actors.has(actor.instanceId) || !['none', 'arrows'].includes(actor.controls)) invalid();
    actors.set(actor.instanceId, actor);
  }
  const bodies = new Map();
  for (const body of physics.bodies) {
    if (!uuid(body?.instanceId) || bodies.has(body.instanceId) || !actors.has(body.instanceId)) invalid();
    bodies.set(body.instanceId, body);
  }
  return scene.actors.filter(actor => actor.controls === 'arrows' && bodies.get(actor.instanceId)?.kind === 'character').map(actor => actor.instanceId);
}
export function validateGodotPhysicsReplayTargets(scene, physics, program) {
  const targets = new Set(godotPhysicsReplayTargets(scene, physics));
  for (const step of program.steps) for (const input of step.inputs) if (!targets.has(input.instanceId)) {
    throw Object.assign(new TypeError('Physics replay input must target a frozen arrows-controlled character.'), { errorCode: 'runtime_physics2d_input_target_invalid' });
  }
}
export async function projectGodotPhysicsInstanceReplay({ sceneId, main, scripts, read, prefix }) {
  if (!uuid(sceneId) || typeof prefix !== 'string' || !/^viento-physics-replay-[a-f0-9-]+$/.test(prefix)) invalid();
  const mainPattern = /^\[gd_scene load_steps=2 format=3\]\n\n\[ext_resource type="Script" path="res:\/\/([^"\n]+\.gd)" id="1"\]\n\n\[node name="VientoScene" type="Node2D"\]\nscript = ExtResource\("1"\)\n$/;
  const match = mainPattern.exec(main); if (!match) invalid();
  const allowed = new Set(scripts), rows = [], seen = new Set();
  let name = match[1], totalBytes = 0, directions = 0, motors = 0;
  while (name) {
    if (rows.length >= 32 || seen.has(name) || !allowed.has(name)
      || !name.startsWith(`scenes/${sceneId}/`) || !/^[a-z0-9/-]+\.gd$/.test(name)) invalid();
    seen.add(name);
    const bytes = await read(name), source = bytes.toString();
    totalBytes += Buffer.byteLength(source);
    if (Buffer.byteLength(source) > 65536 || totalBytes > 1024 * 1024) invalid();
    const hooked = hookGodotPhysicsInstanceReplay(source); directions += hooked.directions; motors += hooked.motors;
    const parent = /^extends "res:\/\/([^"\n]+\.gd)"\n/.exec(source);
    if (!parent && !source.startsWith('extends Node2D\n')) invalid();
    rows.push({ name, source: hooked.source, parent: parent?.[1] || null }); name = parent?.[1] || null;
  }
  if (!directions || motors > 1) invalid();
  const copies = new Map(rows.map((row, index) => [row.name, `${prefix}/chain-${index}.gd`]));
  const files = rows.map(row => [copies.get(row.name), Buffer.from(row.parent
    ? row.source.replace(`extends "res://${row.parent}"\n`, `extends "res://${copies.get(row.parent)}"\n`) : row.source)]);
  return { entry: copies.get(match[1]), files, originals: rows.map(row => row.name), directions, motors, totalBytes };
}

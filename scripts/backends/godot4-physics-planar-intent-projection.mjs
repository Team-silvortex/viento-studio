// A bounded derived inheritance chain. Original runtime bytes remain in place;
// no copied resource, author script, extra solver or position mutation is added.
export const PLANAR_INTENT_CAPABILITY = 'physics.planar-intent2d';
export const planarInventoryName = 'planar-intent-project.json';
export const planarHelpers = ['planar-intent-helper.gd', 'planar-intent-port.gd'];
export const planarSourceURL = name => new URL(`./godot4/physics-planar-intent-${name}.gd`, import.meta.url);
export const planarInstanceIds = scene => (scene.physics?.document.bodies || []).filter(body => body.kind === 'character' && !body.characterMotion
  && scene.actors.some(actor => actor.instanceId === body.instanceId && actor.controls === 'none')).map(body => body.instanceId);
const invalid = () => { throw new TypeError('Invalid generated planar intent inheritance projection.'); };
const direction = '\t\tvar direction := input if actor["controls"] == "arrows" else Vector2.ZERO';
const replacement = '\t\tvar direction: Vector2 = input if actor["controls"] == "arrows" else get("planar_intent").take(actor["instanceId"])';
export const planarScenePath = id => `scenes/${id}/planar-intent-scene.gd`;
export const planarBackupPath = id => `scenes/${id}/planar-intent-original.tscn.txt`;
export const planarCopyPath = (id, name) => `scenes/${id}/planar-intent/${name}`;
export const planarMain = id => `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://${planarScenePath(id)}" id="1"]\n\n[node name="VientoScene" type="Node2D"]\nscript = ExtResource("1")\n`;
export function planarOriginalEntry(main, id) {
  const expression = /^\[gd_scene load_steps=2 format=3\]\n\n\[ext_resource type="Script" path="res:\/\/(scenes\/[a-f0-9-]+\/[a-z0-9-]+\.gd)" id="1"\]\n\n\[node name="VientoScene" type="Node2D"\]\nscript = ExtResource\("1"\)\n$/;
  const match = expression.exec(main);
  if (!match || !match[1].startsWith(`scenes/${id}/`) || match[1].includes('/planar-intent')) invalid();
  return match[1];
}
export async function planarInheritanceProjection(id, main, read) {
  const entry = planarOriginalEntry(main, id), sources = new Map(), seen = new Set();
  let name = entry, bytes = 0, hooks = 0;
  while (name) {
    if (seen.has(name) || sources.size >= 32 || !new RegExp(`^scenes/${id}/[a-z0-9-]+\\.gd$`).test(name)) invalid();
    seen.add(name);
    const raw = await read(name), source = raw.toString();
    bytes += Buffer.byteLength(source);
    if (bytes > 1024 * 1024 || Buffer.byteLength(source) > 65536 || source.includes('planar_intent') || source.includes('planar-intent')) invalid();
    let projected = source;
    const count = source.split(direction).length - 1;
    if (count > 1) invalid();
    if (count === 1) { projected = projected.replace(direction, replacement); hooks++; }
    const parent = /^extends "res:\/\/([^"\n]+\.gd)"\n/.exec(source);
    if (parent) {
      const next = parent[1];
      if (!new RegExp(`^scenes/${id}/[a-z0-9-]+\\.gd$`).test(next)) invalid();
      projected = projected.replace(parent[0], `extends "res://${planarCopyPath(id, next.split('/').at(-1))}"\n`);
      sources.set(planarCopyPath(id, name.split('/').at(-1)), Buffer.from(projected)); name = next;
    } else {
      if (!/^extends Node2D\n/.test(source)) invalid();
      sources.set(planarCopyPath(id, name.split('/').at(-1)), Buffer.from(projected)); name = null;
    }
  }
  if (!hooks) invalid();
  return { entry: planarCopyPath(id, entry.split('/').at(-1)), files: sources };
}
export const planarSceneSource = (source, entry, ids) => source.replace('__PLANAR_BASE__', `res://${entry}`).replace('__PLANAR_INSTANCES__', JSON.stringify(ids));

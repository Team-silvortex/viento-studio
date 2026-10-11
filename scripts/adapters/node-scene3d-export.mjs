// Standalone scene3d prototype host. Existing 2D project/build protocols remain
// unchanged; only this session's freshly exported receipt authorizes execution.
import './node-studio-core.mjs';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createScene3DPlan, parseScene3DSource } from '../../engine/scene3d.mjs';
import { generateGodotScene3DProject } from '../backends/godot4-scene3d.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';

export const SCENE3D_PROJECT_MANIFEST = 'scene3d-project.json';
const MAX_SOURCE_BYTES = 128 * 1024;
const receipts = new WeakMap();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { errorCode: code }); };
const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
const identity = stat => ({ dev: stat.dev, ino: stat.ino });
const sameIdentity = (stat, pin) => stat.dev === pin.dev && stat.ino === pin.ino;
const abort = signal => signal?.throwIfAborted();
async function ancestors(candidate) {
  const absolute = path.resolve(candidate), parsed = path.parse(absolute); let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment); const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('scene3d_path_invalid', 'All existing path ancestors must be ordinary directories.');
  }
  return { path: absolute, ...identity(await fs.lstat(absolute)) };
}
async function assertRoot(pin) {
  const parent = await ancestors(path.dirname(pin.directory));
  if (!sameIdentity(parent, pin.parent)) fail('scene3d_output_changed', 'The generated project parent was replaced.');
  const stat = await fs.lstat(pin.directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !sameIdentity(stat, pin.root)) fail('scene3d_output_changed', 'The generated project directory was replaced.');
}
async function regularBytes(file, maximum, expected) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum || expected && (!sameIdentity(before, expected) || before.nlink !== 1)) fail('scene3d_file_invalid', 'Expected a bounded ordinary file with its original identity.');
    const bytes = await handle.readFile(), after = await handle.stat();
    if (bytes.length > maximum || before.size !== bytes.length || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail('scene3d_file_changed', 'The captured file changed while reading.');
    if (expected && (bytes.length !== expected.bytes || hash(bytes) !== expected.sha256)) fail('scene3d_output_changed', 'A generated project file was modified.');
    return { bytes, stat: after };
  } finally { await handle.close(); }
}
export async function readScene3DInput(input, { signal } = {}) {
  abort(signal);
  if (typeof input !== 'string' || !input || input.includes('\0')) fail('scene3d_input_invalid', 'Choose a regular UTF-8 scene3d source file.');
  const file = path.resolve(input), parent = await ancestors(path.dirname(file));
  const { bytes } = await regularBytes(file, MAX_SOURCE_BYTES); abort(signal);
  if (!sameIdentity(await ancestors(path.dirname(file)), parent)) fail('scene3d_input_changed', 'The source parent was replaced.');
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { fail('scene3d_input_invalid', 'The scene3d source must be valid UTF-8.'); }
  const plan = createScene3DPlan(content), model = parseScene3DSource(content);
  return freeze({ content, sourceSha256: hash(bytes), sourceBytes: bytes.length, plan, model });
}
async function writeOwned(pin, name, bytes) {
  await assertRoot(pin);
  const target = path.join(pin.directory, name), handle = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const owned = { path: name, ...identity(await handle.stat()), bytes: 0, sha256: hash(Buffer.alloc(0)) }; pin.files.push(owned);
  try { let offset=0; while(offset<bytes.length) { const written=await handle.write(bytes,offset,bytes.length-offset,offset); if(!written.bytesWritten) fail('scene3d_write_failed','The owned output write made no progress.'); offset+=written.bytesWritten; owned.bytes=offset; owned.sha256=hash(bytes.subarray(0,offset)); } await handle.sync(); } finally { await handle.close(); }
  await assertRoot(pin);
  await regularBytes(target, 1024 * 1024, owned);
}
async function cleanupOwn(pin) {
  // No recursive removal and no adoption: user-added/replaced/modified entries
  // stay intact. Even our directory is removed only if it is still empty.
  const preserved = [];
  for (const file of [...pin.files].reverse()) {
    try { await assertRoot(pin); await regularBytes(path.join(pin.directory, file.path), 1024 * 1024, file); await fs.unlink(path.join(pin.directory, file.path)); }
    catch (error) { if (error.code !== 'ENOENT') preserved.push(file.path); }
  }
  try { await assertRoot(pin); await fs.rmdir(pin.directory); }
  catch (error) { if (error.code !== 'ENOENT') preserved.push('.'); }
  return [...new Set(preserved)];
}
export async function exportScene3DProject({ input, output, signal } = {}) {
  if (typeof output !== 'string' || !output || output.includes('\0')) fail('scene3d_output_invalid', 'Choose a new project directory.');
  const captured = await readScene3DInput(input, { signal }), generated = await generateGodotScene3DProject(captured.plan); abort(signal);
  const directory = path.resolve(output), parent = await ancestors(path.dirname(directory));
  try { await fs.mkdir(directory, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') fail('scene3d_output_exists', 'The output already exists; choose a new empty location.'); throw error; }
  const pin = { directory, parent, root: identity(await fs.lstat(directory)), files: [] };
  try {
    await assertRoot(pin);
    const planBytes = Buffer.from(JSON.stringify(captured.plan, null, 2) + '\n'), sourceBytes = Buffer.from(captured.content, 'utf8');
    const files = new Map([['source.json', sourceBytes], ['plan.json', planBytes], ...generated.files]);
    const inventory = [];
    for (const [name, bytes] of files) { abort(signal); await writeOwned(pin, name, bytes); inventory.push({ path: name, bytes: bytes.length, sha256: hash(bytes), role: name === 'source.json' ? 'author-source' : name === 'plan.json' ? 'neutral-plan' : 'generated-backend' }); }
    const manifest = freeze({ format: 'viento-scene3d-project', schemaVersion: 1,
      backend: { id: 'org.viento.godot4', majorVersion: 4, prototype: true, capabilities: ['scene3d.static-boxes', 'scene3d.camera', 'scene3d.directional-light', 'scene3d.xyz-transforms', 'scene3d.finite-probe'] },
      coordinateSystem: { handedness: 'right', up: '+Y', forward: '-Z', rotation: 'EulerXYZ-degrees' },
      source: { path: 'source.json', bytes: sourceBytes.length, sha256: captured.sourceSha256 }, plan: { path: 'plan.json', bytes: planBytes.length, sha256: hash(planBytes) },
      project: { entry: 'project.godot', scene: 'scene.tscn', runtime: 'runtime.gd' }, files: inventory });
    await writeOwned(pin, SCENE3D_PROJECT_MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
    const receipt = freeze({ format: 'viento-scene3d-export', schemaVersion: 1, directory, manifest, manifestSha256: pin.files.at(-1).sha256 });
    receipts.set(receipt, pin); return receipt;
  } catch (error) { error.preservedPaths = await cleanupOwn(pin); throw error; }
}
async function assertReceipt(receipt) {
  const pin = receipts.get(receipt);
  if (!pin) fail('scene3d_owner_invalid', 'Execution requires this session\'s freshly exported ownership receipt.');
  await assertRoot(pin);
  for (const file of pin.files) await regularBytes(path.join(pin.directory, file.path), 1024 * 1024, file);
  // Godot owns only these explicit cache roots/UID sidecar. Links or arbitrary
  // additional source files never become executable project authority.
  let visited=0;
  const inspect=async(dir)=>{await ancestors(dir);for(const entry of await fs.readdir(dir,{withFileTypes:true})){
    if(++visited>10000) fail('scene3d_output_limit','The generated cache inventory is too large.');
    const candidate=path.join(dir,entry.name),stat=await fs.lstat(candidate);
    if(stat.isSymbolicLink()||!stat.isFile()&&!stat.isDirectory()||stat.isFile()&&stat.nlink!==1) fail('scene3d_output_changed','Generated output contains a link or special file.');
    if(dir===pin.directory&&!pin.files.some(file=>file.path===entry.name)&&!(pin.started&&['.godot','.host'].includes(entry.name)&&stat.isDirectory())&&!(pin.started&&entry.name==='runtime.gd.uid'&&stat.isFile())) fail('scene3d_output_changed','An unregistered source was added to generated output.');
    if(stat.isDirectory()) await inspect(candidate);
  }};
  await inspect(pin.directory);await assertRoot(pin);return pin;
}
function matchesProbe(plan, probe) {
  const record=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
  const approximate=(actual,expected,tolerance=3e-7)=>typeof actual==='number'&&Number.isFinite(actual)&&Math.abs(actual-expected)<=tolerance*Math.max(1,Math.abs(expected));
  const vector=(actual,expected,tolerance)=>Array.isArray(actual)&&actual.length===expected.length&&actual.every((value,index)=>approximate(value,expected[index],tolerance));
  const direction=value=>{const scale=Math.max(...value.map(Math.abs)),scaled=value.map(component=>component/scale),length=Math.hypot(...scaled);return scaled.map(component=>component/length);};
  const rgba=value=>[...([1,3,5].map(start=>parseInt(value.slice(start,start+2),16)/255)),1];
  const basis=angles=>{const[x,y,z]=angles.map(value=>value*Math.PI/180),cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);return [[cy*cz,cx*sz+sx*sy*cz,sx*sz-cx*sy*cz],[-cy*sz,cx*cz-sx*sy*sz,sx*cz+cx*sy*sz],[sy,-sx*cy,cx*cy]];};
  const scene=plan.scene;
  return record(probe,['format','schemaVersion','ok','issues','objectCount','objects','camera','light','coordinateSystem','rotationOrder','scope'])
    &&probe.format==='viento-scene3d-probe'&&probe.schemaVersion===1&&probe.ok===true&&Array.isArray(probe.issues)&&!probe.issues.length
    &&probe.coordinateSystem==='RH-Y-up-negative-Z-forward'&&probe.rotationOrder==='XYZ'&&typeof probe.scope==='string'
    &&probe.objectCount===scene.objects.length&&Array.isArray(probe.objects)&&probe.objects.length===scene.objects.length
    &&record(probe.camera,['position','forward','fovDegrees','near','far'])&&vector(probe.camera.position,scene.camera.position)
    &&vector(probe.camera.forward,direction(scene.camera.target.map((value,index)=>value-scene.camera.position[index])),1e-5)
    &&['fovDegrees','near','far'].every(field=>approximate(probe.camera[field],scene.camera[field]))
    &&record(probe.light,['forward','energy','color'])&&vector(probe.light.forward,direction(scene.light.direction),1e-5)&&approximate(probe.light.energy,scene.light.energy)&&vector(probe.light.color,rgba(scene.light.color))
    &&probe.objects.every((object,index)=>{const expected=scene.objects[index],columns=basis(expected.rotationDegrees);return record(object,['instanceId','name','position','declaredRotationDegrees','basisColumns','size','color','materialColor','rotationOrder'])
      &&object.instanceId===expected.instanceId&&object.name===expected.name&&object.rotationOrder==='XYZ'&&object.color===expected.color
      &&vector(object.position,expected.position)&&vector(object.size,expected.size)&&vector(object.materialColor,rgba(expected.color))
      &&vector(object.declaredRotationDegrees,expected.rotationDegrees,1e-12)&&Array.isArray(object.basisColumns)&&object.basisColumns.length===3&&object.basisColumns.every((column,n)=>vector(column,columns[n],1e-4));});
}
export async function executeScene3DProject(receipt, { godotBin, run = false, signal, timeoutMs = 30000 } = {}) {
  if (typeof run !== 'boolean' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) fail('scene3d_execution_invalid', 'Choose a bounded check or finite headless probe.');
  if (typeof godotBin !== 'string' || !path.isAbsolute(godotBin) || godotBin.includes('\0')) fail('scene3d_tool_required', 'Provide an explicit absolute Godot 4 executable.');
  const tool = path.resolve(godotBin); await ancestors(path.dirname(tool)); const toolStat = await fs.lstat(tool);
  if (!toolStat.isFile() || toolStat.isSymbolicLink()) fail('scene3d_tool_invalid', 'The Godot executable must be an ordinary file.');
  await fs.access(tool, constants.X_OK); const toolPin = { ...identity(toolStat), bytes: toolStat.size, sha256: hash(await fs.readFile(tool)) };
  const pin = await assertReceipt(receipt), phases = [];
  if(pin.started) fail('scene3d_owner_invalid','This export receipt has already authorized its one bounded execution.');
  pin.started=true;
  const env = { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1', XDG_DATA_HOME: path.join(pin.directory, '.host/data'), XDG_CONFIG_HOME: path.join(pin.directory, '.host/config'), XDG_CACHE_HOME: path.join(pin.directory, '.host/cache') };
  const invoke = async (phase, args) => {
    abort(signal); await assertReceipt(receipt); await regularBytes(tool, 256 * 1024 * 1024, toolPin);
    const result = await runBuildProcess(tool, args, { cwd: pin.directory, env, signal, timeoutMs, maxOutputBytes: 1024 * 1024 });
    phases.push({ phase, ...result }); await assertReceipt(receipt); await regularBytes(tool, 256 * 1024 * 1024, toolPin);
    return result.status === 'succeeded' && !/(?:^|\n)\s*(?:SCRIPT ERROR:|ERROR:)/.test(result.stdout + '\n' + result.stderr);
  };
  if (!await invoke('identify', ['--version']) || !/^4\.\d+(?:\.\d+)?\./m.test(phases[0].stdout.trim())) return { ok: false, phases, errorCode: 'scene3d_tool_invalid' };
  const args = ['--path', pin.directory, '--headless'];
  if (!await invoke('import', [...args, '--editor', '--import'])) return { ok: false, phases, errorCode: 'scene3d_import_failed' };
  if (!await invoke('script-check', [...args, '--script', 'res://runtime.gd', '--check-only'])) return { ok: false, phases, errorCode: 'scene3d_script_failed' };
  if (!run) return { ok: true, phases, tool: { path: tool, sha256: toolPin.sha256, version: phases[0].stdout.trim() }, scope: 'Generated project import and script check only.' };
  if (!await invoke('probe', [...args, '--', '--viento-scene3d-probe'])) return { ok: false, phases, errorCode: 'scene3d_probe_failed' };
  const lines = phases.at(-1).stdout.split('\n').filter(line => line.startsWith('VIENTO_SCENE3D_PROBE '));
  let probe; try { if (lines.length === 1) probe = JSON.parse(lines[0].slice('VIENTO_SCENE3D_PROBE '.length)); } catch { /* Invalid receipt fails closed below. */ }
  if (!probe || probe.format !== 'viento-scene3d-probe' || probe.schemaVersion !== 1 || probe.ok !== true || !Array.isArray(probe.issues) || probe.issues.length || !Array.isArray(probe.objects)) return { ok: false, phases, errorCode: 'scene3d_probe_invalid' };
  const plan = JSON.parse((await regularBytes(path.join(pin.directory, 'plan.json'), 1024 * 1024, pin.files.find(file => file.path === 'plan.json'))).bytes);
  if (!matchesProbe(plan,probe)) return { ok: false, phases, errorCode: 'scene3d_probe_invalid' };
  return { ok: true, phases, tool: { path: tool, sha256: toolPin.sha256, version: phases[0].stdout.trim() }, probe, scope: 'Actual headless Godot static tree/transform/material probe; no installed editor, GPU pixel capture or 2D runtime protocol acceptance.' };
}

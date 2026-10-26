import { generateGodotPhysicsPlatformEventsProject } from '../backends/godot4-physics-platform-events.mjs';
import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import yauzl from 'yauzl';
import { buildProject } from '../adapters/node-project-build.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
import { createHash } from 'node:crypto';
import { scenePhysics2DPlatformMotionAuthor } from './helpers/scene-physics2d-platform-motion-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { generateGodotPhysicsDropThroughProject } from '../backends/godot4-physics-drop-through.mjs';
import { godotPhysicsPlatformMotionAssemblyScripts } from '../backends/godot4-physics-platform-motion.mjs';
const tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool ? 'Set VIENTO_GODOT_BIN for native platform verification' : false, timeout: 180000 };
const reportPath = process.env.VIENTO_PHYSICS_PLATFORM_MOTION_REPORT;
const capturePath = process.env.VIENTO_PHYSICS_PLATFORM_MOTION_CAPTURE;
const evidence = [];
const hash = value => createHash('sha256').update(value).digest('hex');
const id = n => `84848484-8484-4848-8848-${String(n).padStart(12, '0')}`;
test.after(async () => { if (reportPath) await fs.writeFile(reportPath, JSON.stringify({ format: 'viento-physics-platform-motion-proof', schemaVersion: 1, tool, cases: evidence }, null, 2) + '\n', { flag: 'wx' }); });
async function hashes(directory, prefix = '') {
  const result = {};
  for (const item of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) Object.assign(result, await hashes(directory, name));
    else { assert.ok(item.isFile()); result[name] = hash(await fs.readFile(path.join(directory, name))); }
  }
  return result;
}
// Keep historical layer byte assertions on the frozen .31 generation chain.
// Current adapter execution and delivered builds are covered independently.
async function captured(f) {
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  return { ...f, captured, generated: await generateGodotPhysicsPlatformEventsProject(captured.plan) };
}
async function stage(f, generated = f.generated) {
  const directory = await fs.mkdtemp(path.join(f.temporary, 'platform-staged-'));
  for (const [name, bytes] of [...generated.files, ...[...generated.resourceFiles].map(([id, name]) => [name, f.captured.resources.get(id)])]) {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await fs.writeFile(path.join(directory, name), bytes);
  }
  return directory;
}
async function execute(f, directory, { scriptCheck = false, mode = 'headlessLogic', capture, smoke = true } = {}) {
  const identified = await adapter.identify(tool);
  for (const phase of scriptCheck ? adapter.buildPhases : adapter.runtimePhases) {
    const result = await adapter.executePhase({ phase, directory, tool: identified, timeoutMs: 60000 });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
    assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
  }
  const result = await adapter.executePhase({ phase: 'run', directory, tool: identified, smoke, mode, ...(capture ? { capturePath: capture } : {}), timeoutMs: 60000 });
  if (reportPath) await fs.appendFile(reportPath.replace(/\.json$/, '-stdout.log'), result.stdout + result.stderr + '\n');
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
  const reader = adapter.createEventReader(f.captured.plan, { smoke, capabilities: f.generated.backend.capabilities });
  reader.push(result.stdout); const ended = reader.finish(); assert.deepEqual(ended.diagnostics, [], result.stdout);
  const snapshot = reader.snapshot?.(); if (snapshot) assert.equal(snapshot.phase, 'finished');
  return { result, reader, snapshot, tool: identified };
}
function samples(output, f) { return output.snapshot.samples.filter(sample => sample.instanceId === f.instanceId); }
function publications(output, bindingId) { return output.reader.events.filter(frame => frame.event === 'event-publish' && (!bindingId || frame.bindingId === bindingId)); }
function exitActors(output) { return output.reader.events.find(frame => frame.event === 'scene-exit').actors; }
function record(name, f, output, before) {
  evidence.push({ name, backend: f.generated.backend, tool: output.tool, samples: output.snapshot?.samples || [], probes: facts(output), publications: publications(output),
    audio: output.reader.events.filter(frame => frame.event === 'audio-command'), animation: output.reader.events.filter(frame => frame.event === 'animation-command'),
    finalActors: output.reader.events.filter(frame => frame.event === 'scene-exit').map(frame => ({ visitIndex: frame.visitIndex, actors: frame.actors })),
    authorFiles: Object.keys(before).length, authorSha256: hash(JSON.stringify(before)) });
}
function carried(output, f, { both = false } = {}) {
  assert.equal(f.generated.backend.version, '0.31.0'); assert.ok(f.generated.backend.capabilities.includes('physics.platform-motion2d'));
  const mine = samples(output, f); assert.equal(mine.length, 30);
  assert.ok(mine.some(sample => sample.requestedMotion[0] > 1)); assert.ok(mine.some(sample => sample.requestedMotion[0] < -1));
  assert.ok(mine.some(sample => sample.positionAfter[0] - sample.positionBefore[0] > 1));
  assert.ok(mine.some(sample => sample.positionAfter[0] - sample.positionBefore[0] < -1));
  assert.ok(mine.slice(3).every(sample => sample.contacts.some(contact => contact.collider?.bodyId === f.platformBodyId && contact.normal[1] <= -.7)));
  assert.ok(mine.slice(3).every(sample => Math.abs(sample.positionAfter[1] - f.expectedSupportY) < .2));
  const other = output.snapshot.samples.filter(sample => sample.instanceId === f.otherInstanceId);
  assert.equal(other.length, 30);
  if (both) assert.deepEqual(other.map(sample => sample.requestedMotion), mine.map(sample => sample.requestedMotion));
  else assert.ok(other.every(sample => Math.abs(sample.positionAfter[0] - sample.positionBefore[0]) < .0001));
}

test('platform generation leaves input/source locations unchanged and empty schema 5 projects use exact historical output', async t => {
  const raw = await scenePhysics2DPlatformMotionAuthor(t, { enabled: false, consumers: false }), f = await captured(raw);
  const legacy = await generateGodotPhysicsDropThroughProject(f.captured.plan);
  assert.deepEqual([...f.generated.files], [...legacy.files]); assert.deepEqual(f.generated.backend, legacy.backend);
  const extended = structuredClone(f.captured.plan);
  for (const scene of extended.scenes) if (scene.physics) scene.physics.document.schemaVersion = 5;
  const frozen = structuredClone(extended), projected = await generateGodotPhysicsPlatformEventsProject(extended);
  assert.deepEqual(extended, frozen); assert.deepEqual([...projected.files], [...legacy.files]); assert.deepEqual(projected.backend, legacy.backend);
});

test('platform generated inventory retains the complete historical validation chain', async t => {
  const f = await captured(await scenePhysics2DPlatformMotionAuthor(t)), before = structuredClone(f.captured.plan), directory = await stage(f);
  assert.deepEqual(f.captured.plan, before);
  const scripts = await godotPhysicsPlatformMotionAssemblyScripts(directory);
  assert.ok(scripts.includes('platform-motion-helper.gd'));
  assert.ok(scripts.some(name => name.endsWith('/platform-motion-original.gd')));
  assert.ok(scripts.includes('drop-through-helper.gd'));
});

for (const mode of ['one-way', 'solid', 'circle-offset', 'both-riders', 'negative-offset']) test(`real horizontal ${mode} platform carries only native supported gravity characters through reversal`, real, async t => {
  const raw = await scenePhysics2DPlatformMotionAuthor(t, { oneWay: mode !== 'solid', circle: mode === 'circle-offset', offset: mode === 'circle-offset' ? [7,-3] : [0,0], bothRiders: mode === 'both-riders', offsetX: mode === 'negative-offset' ? -48 : 48 });
  const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f), { scriptCheck: mode === 'one-way' });
  carried(output, f, { both: mode === 'both-riders' });
  assert.deepEqual(publications(output, f.publisherBindingId).map(frame => frame.name), ['physics.landed']);
  assert.deepEqual(publications(output, f.contactBindingId).map(frame => frame.name), ['physics.contact_started']);
  assert.equal(output.reader.events.filter(frame => frame.event === 'audio-command' && frame.bindingId === f.audioBindingId && frame.action === 'play').length, 1);
  assert.deepEqual(await hashes(f.author), before); record(mode + '-carry-media', f, output, before);
});

function facts(output, tag = 'PLATFORM_PROBE:') { return output.result.stdout.split('\n').filter(line => line.startsWith(tag)).map(line => JSON.parse(line.slice(tag.length))); }
async function probe(f, { ready = '', step = '', exit = '', live = false } = {}) {
  await f.addBehavior(id(1), id(2), 'platform-probe', `extends Node
var ticks := -1
var platform: StaticBody2D
var character: CharacterBody2D
func _ready() -> void:
\tvar scene = get_parent().get_parent()
\tfor actor in scene.actors:
\t\tif actor["instanceId"] == "${f.platformInstanceId}":
\t\t\tplatform = actor["node"]
\t\tif actor["instanceId"] == "${f.instanceId}" and actor["node"] is CharacterBody2D:
\t\t\tcharacter = actor["node"]
\tprint("PLATFORM_READY:" + JSON.stringify({"position":[platform.position.x,platform.position.y],"animatable":platform is AnimatableBody2D,"sync":platform.get("sync_to_physics")}))
${ready || '\tpass'}
func _physics_process(_delta: float) -> void:
\tvar scene = get_parent().get_parent()
${live ? '\tticks += 1' : '\tvar tick: int = scene.get("physics_observation_step")\n\tif tick == ticks:\n\t\treturn\n\tticks = tick'}
${step || '\tpass'}
\tprint("PLATFORM_PROBE:" + JSON.stringify({"step":ticks,"visit":scene.project_visit,"position":[platform.position.x,platform.position.y],"character":[character.position.x,character.position.y] if character != null else null,"grounded":scene.get("character_motion_grounded").get("${f.instanceId}",false) if scene.get("character_motion_grounded") is Dictionary else false,"exception":character.get_collision_exceptions().has(platform) if character != null else false}))
func _exit_tree() -> void:
${exit || '\tpass'}
`);
}

for (const action of ['jump', 'drop']) test(`real ${action} detaches the same accepted step while the other rider keeps moving`, real, async t => {
  const raw = await scenePhysics2DPlatformMotionAuthor(t, { consumers: false, bothRiders: true, jump: action === 'jump', drop: action === 'drop' });
  await probe(raw); const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f));
  const mine = samples(output, f), other = output.snapshot.samples.filter(sample => sample.instanceId === f.otherInstanceId);
  assert.ok(mine.slice(3,10).some(sample => sample.requestedMotion[0] > 1));
  const detached = action === 'jump' ? mine.find(sample => sample.requestedMotion[1] < 0) : mine.find(sample => sample.stepIndex >= 11 && sample.requestedMotion[0] === 0 && sample.requestedMotion[1] > 0);
  assert.ok(detached); assert.equal(detached.requestedMotion[0], 0); assert.ok(Math.abs(detached.positionAfter[0] - detached.positionBefore[0]) < .001);
  const otherAtStep = other.find(sample => sample.stepIndex === detached.stepIndex); assert.ok(Math.abs(otherAtStep.requestedMotion[0]) >= 3.9);
  if (action === 'jump') assert.equal(publications(output, f.publisherBindingId).filter(frame => frame.name === 'physics.jumped').length, 1);
  else {
    assert.ok(facts(output).some(row => row.exception)); assert.ok(mine.at(-1).positionAfter[1] > f.platformTop + 40);
    assert.ok(mine.filter(sample => sample.stepIndex >= detached.stepIndex).every(sample => Math.abs(sample.positionAfter[0] - sample.positionBefore[0]) < .001));
  }
  assert.deepEqual(await hashes(f.author), before); record(action + '-same-step-detach', f, output, before);
});

test('real own horizontal input combines once with platform carry and native walls still stop it', real, async t => {
  const raw = await scenePhysics2DPlatformMotionAuthor(t, { consumers: false });
  await raw.edit('documents/scenes/demo.json', scene => { scene.actors[0].speed = 60; scene.actors[2].position = [140,140]; scene.actors[2].size = [10,100]; });
  await raw.edit(raw.physicsPath, document => { document.bodies[2].shape.size = [10,100]; });
  const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f)), mine = samples(output, f);
  assert.ok(mine.some(sample => Math.abs(sample.requestedMotion[0] - 5) < .001));
  assert.ok(mine.some(sample => sample.requestedMotion[0] > 0 && Math.abs(sample.positionAfter[0] - sample.positionBefore[0]) < .01 && sample.contacts.some(contact => contact.collider?.instanceId === f.wallInstanceId)));
  assert.ok(mine.every(sample => sample.positionAfter[0] < 125.1)); assert.ok(mine.some(sample => sample.positionAfter[0] < sample.positionBefore[0] - 1));
  assert.deepEqual(await hashes(f.author), before); record('input-plus-carry-wall', f, output, before);
});

test('real character walking off a moving platform loses carry without geometric contact synthesis', real, async t => {
  const raw = await scenePhysics2DPlatformMotionAuthor(t, { consumers: false });
  await raw.edit('documents/scenes/demo.json', scene => { scene.actors[0].position[0] = 150; scene.actors.find(actor => actor.instanceId === raw.platformInstanceId).size[0] = 60; });
  await raw.edit(raw.physicsPath, document => { document.bodies.find(body => body.id === raw.platformBodyId).shape.size[0] = 60; });
  await probe(raw, { step: '\tif ticks == 6:\n\t\tscene.actors[0]["speed"] = 600.0\n\tif ticks == 12:\n\t\tscene.actors[0]["speed"] = 0.0' });
  const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f)), mine = samples(output, f);
  assert.ok(mine.some(sample => sample.requestedMotion[0] > 10));
  assert.ok(mine.filter(sample => sample.stepIndex >= 15).every(sample => sample.requestedMotion[0] === 0));
  assert.ok(mine.at(-1).positionAfter[1] > f.expectedSupportY + 20);
  assert.ok(publications(output, f.contactBindingId).some(frame => frame.name === 'physics.contact_ended'));
  assert.deepEqual(await hashes(f.author), before); record('walk-off-no-carry', f, output, before);
});

for (const mode of ['no-characters', 'free-planar', 'mixed-planar', 'masked', 'airborne']) test(`real ${mode} scene moves its platform without inventing a gravity carrier`, real, async t => {
  const raw = await scenePhysics2DPlatformMotionAuthor(t, { consumers: false, noCharacters: mode === 'no-characters' });
  if (mode === 'free-planar' || mode === 'mixed-planar') {
    await raw.edit(raw.physicsPath, document => { for (const body of document.bodies) if (mode === 'free-planar' || body.instanceId === raw.instanceId) delete body.characterMotion; });
    await raw.edit(raw.manifestPath, document => { document.bindings = document.bindings.filter(binding => binding.bindingId !== raw.publisherBindingId); });
  }
  if (mode === 'masked') await raw.edit(raw.physicsPath, document => { document.bodies.find(body => body.id === raw.platformBodyId).layer = 2; });
  if (mode === 'airborne') await raw.edit('documents/scenes/demo.json', scene => { scene.actors[0].position = [100,20]; });
  await probe(raw); const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f));
  const observed = facts(output); assert.ok(observed.some(row => row.position[0] > 170)); assert.ok(observed.some((row,i) => i > 0 && row.position[0] < observed[i-1].position[0]));
  if (mode === 'no-characters') assert.equal(output.snapshot.samples.length, 0);
  else if (mode === 'airborne') assert.ok(samples(output, f).filter(sample => sample.positionAfter[1] < f.expectedSupportY - 2).every(sample => sample.requestedMotion[0] === 0));
  else assert.ok(samples(output, f).every(sample => sample.requestedMotion[0] === 0));
  assert.deepEqual(facts(output,'PLATFORM_READY:'), [{ position:[150,160], animatable:true, sync:false }]);
  assert.deepEqual(await hashes(f.author), before); record(mode + '-no-carrier', f, output, before);
});

test('real live platform movement and event consumers work without smoke trace sampling', real, async t => {
  const raw = await scenePhysics2DPlatformMotionAuthor(t, { live: true }); await probe(raw, { live:true });
  const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f), { smoke:false });
  assert.equal(output.snapshot, undefined); assert.equal(output.result.stdout.includes('VIENTO_PHYSICS2D:'), false);
  const observed = facts(output); assert.ok(observed.some(row => row.position[0] > 170)); assert.ok(observed.some((row,i) => i > 0 && row.position[0] < observed[i-1].position[0]));
  assert.ok(observed.some(row => row.character[0] > 110));
  assert.deepEqual(publications(output,f.publisherBindingId).map(frame => frame.name), ['physics.landed']);
  assert.deepEqual(await hashes(f.author), before); record('live-no-trace', f, output, before);
});

test('real scene reentry resets trajectory and discards prior support ownership before author ready', real, async t => {
  const raw = await scenePhysics2DPlatformMotionAuthor(t, { consumers:false });
  await probe(raw, { ready: '\tif prior != null:\n\t\tprint("PLATFORM_STALE:" + JSON.stringify({"closed":not prior.opened,"empty":prior.supports.is_empty() and prior.platforms.is_empty()}))\n\tprior = scene.platform_motion',
    step: `\tif ticks == 10 and not switched:\n\t\tswitched = true\n\t\tget_meta("viento_project").request_scene("${raw.sceneIds[1]}")` });
  const content = await fs.readFile(path.join(raw.author,'documents/scripts/platform-probe.txt'),'utf8');
  await raw.script('platform-probe',content.replace('var ticks := -1','static var prior\nstatic var switched := false\nvar ticks := -1'));
  await raw.script('second',`extends Node\nfunc _ready() -> void:\n\tget_meta("viento_project").request_scene("${raw.sceneIds[0]}")\n`);
  const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f));
  assert.deepEqual(facts(output,'PLATFORM_READY:').map(row=>row.position),[[150,160],[150,160]]);
  assert.deepEqual(facts(output,'PLATFORM_STALE:'),[{closed:true,empty:true}]);
  assert.deepEqual(publications(output,f.publisherBindingId).map(frame=>[frame.visitIndex,frame.name]),[[1,'physics.landed'],[3,'physics.landed']]);
  assert.deepEqual(await hashes(f.author),before);record('reentry-reset',f,output,before);
});

test('real portable ZIP retains platform carry and media after original paths go offline', real, async t => {
  const f = await captured(await scenePhysics2DPlatformMotionAuthor(t)), before = await hashes(f.author), output = path.join(f.temporary,'build');
  const built = await buildProject({ root:f.author,targetId:f.assemblyId,tool,output }); assert.equal(built.ok,true,JSON.stringify(built.record?.diagnostics||built));
  const inspection=()=>inspectBackendProject({buildDirectory:output}); const delivery=await planBackendProjectDelivery({inspection:await inspection(),assertCurrent:inspection});
  const zip=path.join(f.temporary,'platform-motion.zip');await writeExportZip(delivery,zip);await verifyBackendProjectDelivery(zip);
  const moved=await fs.mkdtemp(path.join(os.tmpdir(),'viento-physics-platform-motion-relocated-'));t.after(()=>fs.rm(moved,{recursive:true,force:true}));
  const archive=await yauzl.openPromise(zip,{lazyEntries:true,autoClose:false});
  try{for await(const entry of archive.eachEntry()){
    assert.ok(!entry.fileName.startsWith('/')&&!entry.fileName.split('/').includes('..'));const chunks=[];
    for await(const chunk of await archive.openReadStreamPromise(entry))chunks.push(chunk);
    const file=path.join(moved,entry.fileName);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,Buffer.concat(chunks));
  }}finally{await new Promise(resolve=>{archive.reader.once('close',resolve);archive.close()});}
  assert.deepEqual(await hashes(f.author),before);await fs.rename(f.author,f.author+'.offline');await fs.rename(output,output+'.offline');
  const observed=await execute(f,path.join(moved,'project'),{scriptCheck:true});carried(observed,f);
  assert.equal(observed.reader.events.filter(frame=>frame.event==='audio-command'&&frame.bindingId===f.audioBindingId).length,1);record('portable-relocation',f,observed,before);
  if(reportPath){const destination=path.join(path.dirname(reportPath),path.basename(reportPath,'.json')+'-platform-motion.zip');await fs.copyFile(zip,destination,fs.constants.COPYFILE_EXCL);evidence.at(-1).zip={path:destination,sha256:hash(await fs.readFile(zip))};}
});

test('real window capture keeps horizontal reversal and the independent stationary character', { ...real,skip:!tool||!capturePath?'Set VIENTO_GODOT_BIN and VIENTO_PHYSICS_PLATFORM_MOTION_CAPTURE for capture verification':false },async t=>{
  const f=await captured(await scenePhysics2DPlatformMotionAuthor(t)),before=await hashes(f.author),output=await execute(f,await stage(f),{mode:'windowCapture',capture:capturePath});
  carried(output,f);assert.ok((await fs.stat(capturePath)).size>100);assert.deepEqual(await hashes(f.author),before);record('window-capture',f,output,before);
});

test('real pre-existing author collision exception cancels carry and remains owned by the author', real, async t => {
  const raw=await scenePhysics2DPlatformMotionAuthor(t,{consumers:false});
  await probe(raw,{step:'\tif ticks == 6:\n\t\tcharacter.add_collision_exception_with(platform)'});
  const f=await captured(raw),before=await hashes(f.author),output=await execute(f,await stage(f)),mine=samples(output,f);
  assert.ok(mine.filter(sample=>sample.stepIndex>=8).every(sample=>sample.requestedMotion[0]===0));
  assert.ok(facts(output).filter(row=>row.step>=6).every(row=>row.exception));
  assert.ok(mine.at(-1).positionAfter[1]>f.platformTop+40);
  assert.deepEqual(await hashes(f.author),before);record('author-exception-preserved',f,output,before);
});

test('real bounded short path at maximum speed remains finite across multiple phase wraps',real,async t=>{
  const raw=await scenePhysics2DPlatformMotionAuthor(t,{consumers:false,noCharacters:true,offsetX:1,speed:2000});await probe(raw);
  const f=await captured(raw),before=await hashes(f.author),output=await execute(f,await stage(f)),observed=facts(output);
  assert.ok(observed.length>=30);assert.ok(observed.every(row=>Number.isFinite(row.position[0])&&row.position[0]>=150&&row.position[0]<=151));
  assert.ok(observed.some(row=>row.position[0]>150.1));assert.ok(observed.every(row=>row.position[1]===160));
  assert.deepEqual(await hashes(f.author),before);record('short-path-max-speed',f,output,before);
});

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
import { scenePhysics2DPlatformEventsAuthor } from './helpers/scene-physics2d-platform-events-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { generateGodotPhysicsPlatformMotionProject } from '../backends/godot4-physics-platform-motion.mjs';
import { generateGodotPhysicsPlatformEventsProject, godotPhysicsPlatformEventsAssemblyScripts } from '../backends/godot4-physics-platform-events.mjs';
const tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool ? 'Set VIENTO_GODOT_BIN for native platform verification' : false, timeout: 180000 };
const reportPath = process.env.VIENTO_PHYSICS_PLATFORM_EVENTS_REPORT;
const capturePath = process.env.VIENTO_PHYSICS_PLATFORM_EVENTS_CAPTURE;
const evidence = [];
const hash = value => createHash('sha256').update(value).digest('hex');
const id = n => `86868686-8686-4868-8868-${String(n).padStart(12, '0')}`;
test.after(async () => { if (reportPath) await fs.writeFile(reportPath, JSON.stringify({ format: 'viento-physics-platform-events-proof', schemaVersion: 1, tool, cases: evidence }, null, 2) + '\n', { flag: 'wx' }); });
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
function facts(output, tag = 'ENDPOINT_PROBE:') { return output.result.stdout.split('\n').filter(line => line.startsWith(tag)).map(line => JSON.parse(line.slice(tag.length))); }
function endpoints(output, f) { return publications(output, f.platformPublisherBindingId); }
function assertEndpoints(output, f) {
  assert.equal(f.generated.backend.version, '0.31.0'); assert.ok(f.generated.backend.capabilities.includes('physics.platform-events2d'));
  assert.deepEqual(endpoints(output, f).map(frame => frame.name), [f.destinationEvent, f.originEvent]);
  assert.ok(endpoints(output, f).every(frame => frame.value === f.platformInstanceId));
}
test('new endpoint generation preserves the frozen motion layer and original plan/source map', async t => {
  const f = await captured(await scenePhysics2DPlatformEventsAuthor(t)), original = structuredClone(f.captured.plan);
  const old = await generateGodotPhysicsPlatformMotionProject(f.captured.plan);
  assert.deepEqual(f.captured.plan, original); assert.deepEqual(f.generated.sourceMap, old.sourceMap);
  for (const [name, bytes] of old.files) {
    const replaced = name.endsWith('/main.tscn') && f.generated.files.has(name.replace('main.tscn','platform-events-original.tscn'));
    assert.deepEqual(f.generated.files.get(replaced ? name.replace('main.tscn','platform-events-original.tscn') : name), bytes, name);
  }
  const inventory = await godotPhysicsPlatformEventsAssemblyScripts(await stage(f));
  for (const name of f.generated.files.keys()) if (name.endsWith('.gd')) assert.ok(inventory.includes(name), name);
  assert.equal(new Set(inventory).size, inventory.length);
});
for (const mode of ['one-way', 'solid-negative', 'no-characters']) test(`real ${mode} endpoints publish ordinary author events and drive media`, real, async t => {
  const f = await captured(await scenePhysics2DPlatformEventsAuthor(t, { oneWay: mode !== 'solid-negative', offsetX: mode === 'solid-negative' ? -48 : 48, noCharacters: mode === 'no-characters' }));
  const before = await hashes(f.author), output = await execute(f, await stage(f), { scriptCheck: mode === 'one-way' });
  assertEndpoints(output, f);
  assert.equal(output.reader.events.filter(frame => frame.event === 'audio-command' && frame.bindingId === f.audioBindingId && frame.action === 'play').length, 1);
  assert.ok(output.reader.events.some(frame => frame.event === 'animation-command' && frame.bindingId === f.animationBindingId && frame.command?.action === 'select' && frame.command.clipId === f.actionClipId));
  if (mode !== 'no-characters') {
    const mine = samples(output, f); assert.equal(mine.length, 30); assert.ok(mine.some(sample => sample.requestedMotion[0] > 1)); assert.ok(mine.some(sample => sample.requestedMotion[0] < -1));
  }
  assert.deepEqual(await hashes(f.author), before); record(mode + '-events-media', f, output, before);
});

async function endpointProbe(f, { index = 1, target = f.platformInstanceId, ready = '', callback = '', step = '', fields = '' } = {}) {
  await f.addBehavior(id(index * 2 - 1), id(index * 2), `endpoint-probe-${index}`, `extends Node
var port
var count := 0
${fields}
func _ready() -> void:
\tprint("ENDPOINT_READY:" + JSON.stringify({"probe":${index},"visit":get_parent().get_parent().project_visit,"port":has_meta("viento_platform_events")}))
\tif has_meta("viento_platform_events"):
\t\tport = get_meta("viento_platform_events")
\t\tport.origin_reached.connect(_endpoint.bind("origin"))
\t\tport.destination_reached.connect(_endpoint.bind("destination"))
${ready || '\tpass'}
func _endpoint(endpoint: String) -> void:
\tcount += 1
\tvar scene = get_parent().get_parent()
\tvar platform = scene.platform_motion.platforms[get_meta("viento_instance_id")]
\tvar position: Vector2 = platform["node"].get_ref().position
\tprint("ENDPOINT_PROBE:" + JSON.stringify({"probe":${index},"visit":scene.project_visit,"count":count,"endpoint":endpoint,"phase":platform["phase"],"position":[position.x,position.y],"time":scene.physics_observation_time}))
${callback || '\tpass'}
func _physics_process(_delta: float) -> void:
${step || '\tpass'}
`, {}, target);
}

test('real short path coalesces each endpoint once per step in first-arrival order with separate behavior ports', real, async t => {
  const raw = await scenePhysics2DPlatformEventsAuthor(t, { enabled:false, consumers:false, noCharacters:true, offsetX:1, speed:2000 });
  await endpointProbe(raw); await endpointProbe(raw, { index:2 });
  await endpointProbe(raw, { index:3, target:raw.stationaryInstanceId });
  await endpointProbe(raw, { index:4, target:raw.instanceId });
  const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f));
  const ready = facts(output,'ENDPOINT_READY:'); assert.deepEqual(ready.map(row=>row.port), [true,true,false,false]);
  for (const index of [1,2]) {
    const rows = facts(output).filter(row=>row.probe===index); assert.equal(rows.length,60);
    let phase=0;
    for(let step=0;step<30;step++) {
      assert.deepEqual(rows.slice(step*2,step*2+2).map(row=>row.endpoint),phase<1?['destination','origin']:['origin','destination']);
      phase=(phase+2000/60)%2; assert.ok(Math.abs(rows[step*2].phase-phase)<1e-9);
    }
  }
  assert.deepEqual(publications(output),[]); assert.deepEqual(await hashes(f.author),before); record('coalesced-multi-crossing-local-ports',f,output,before);
});

test('real exact endpoint arrival has no ready or zero-delta duplicate and cannot reenter motion during callbacks', real, async t => {
  const raw = await scenePhysics2DPlatformEventsAuthor(t,{enabled:false,consumers:false,noCharacters:true,offsetX:8,speed:240});
  await endpointProbe(raw,{ callback:'\tvar before: float = platform["phase"]\n\tscene.project_step(1.0)\n\tassert(before == platform["phase"])',
    step:'\tvar scene = get_parent().get_parent()\n\tvar before: int = count\n\tscene.project_step(0.0)\n\tassert(before == count)' });
  const f=await captured(raw),before=await hashes(f.author),output=await execute(f,await stage(f)),rows=facts(output);
  assert.equal(rows.length,15);
  for(let index=0;index<rows.length;index++){
    assert.equal(rows[index].endpoint,index%2===0?'destination':'origin'); assert.equal(rows[index].phase,index%2===0?8:0);
    assert.ok(Math.abs(rows[index].time-(index+1)/30)<1e-8);
  }
  assert.deepEqual(await hashes(f.author),before);record('exact-boundaries-zero-delta-reentry',f,output,before);
});

test('real queued behavior removal suppresses its remaining callback without removing another binding',real,async t=>{
  const raw=await scenePhysics2DPlatformEventsAuthor(t,{enabled:false,consumers:false,noCharacters:true,offsetX:1,speed:2000});
  await endpointProbe(raw,{callback:'\tqueue_free()'});await endpointProbe(raw,{index:2});
  const f=await captured(raw),before=await hashes(f.author),output=await execute(f,await stage(f));
  assert.equal(facts(output).filter(row=>row.probe===1).length,1);assert.equal(facts(output).filter(row=>row.probe===2).length,60);
  assert.deepEqual(await hashes(f.author),before);record('queued-behavior-removal',f,output,before);
});

test('real endpoint scene request suppresses remaining old-visit callbacks and reentry installs fresh ports',real,async t=>{
  const raw=await scenePhysics2DPlatformEventsAuthor(t,{enabled:false,consumers:false,noCharacters:true,offsetX:1,speed:2000});
  await endpointProbe(raw,{fields:'static var prior\nstatic var switched := false',
    ready:'\tif prior != null:\n\t\tprint("ENDPOINT_STALE:" + JSON.stringify({"origin":prior.get_signal_connection_list("origin_reached").size(),"destination":prior.get_signal_connection_list("destination_reached").size()}))\n\tprior = port',
    callback:`\tif not switched:\n\t\tswitched = true\n\t\tget_meta("viento_project").request_scene("${raw.sceneIds[1]}")`});
  await endpointProbe(raw,{index:2});
  await raw.script('second',`extends Node\nfunc _ready() -> void:\n\tget_meta("viento_project").request_scene("${raw.sceneIds[0]}")\n`);
  const f=await captured(raw),before=await hashes(f.author),output=await execute(f,await stage(f));
  assert.deepEqual(facts(output).filter(row=>row.visit===1).map(row=>[row.probe,row.endpoint]),[[1,'destination']]);
  assert.ok(facts(output).some(row=>row.visit===3&&row.endpoint==='origin'));
  assert.deepEqual(facts(output,'ENDPOINT_STALE:'),[{origin:0,destination:0}]);
  assert.deepEqual(await hashes(f.author),before);record('scene-request-reentry-revocation',f,output,before);
});

test('real direct scene close revokes pending endpoint callbacks before project shutdown',real,async t=>{
  const raw=await scenePhysics2DPlatformEventsAuthor(t,{enabled:false,consumers:false,noCharacters:true,offsetX:1,speed:2000});
  await endpointProbe(raw,{callback:'\tscene.project_close()\n\tscene.project_host.call_deferred("finish_project")'});await endpointProbe(raw,{index:2});
  const f=await captured(raw),before=await hashes(f.author),output=await execute(f,await stage(f),{smoke:false});
  assert.deepEqual(facts(output).map(row=>[row.probe,row.endpoint]),[[1,'destination']]);
  assert.deepEqual(await hashes(f.author),before);record('direct-close-revocation',f,output,before);
});

test('real live native endpoint facts exceed 128 without trace or project publication',real,async t=>{
  const raw=await scenePhysics2DPlatformEventsAuthor(t,{enabled:false,consumers:false,noCharacters:true,offsetX:1,speed:2000});
  await endpointProbe(raw,{callback:'\tif count >= 160:\n\t\tscene.project_host.call_deferred("finish_project")'});
  const f=await captured(raw),before=await hashes(f.author),output=await execute(f,await stage(f),{smoke:false});
  assert.ok(facts(output).length>=160); assert.equal(output.snapshot,undefined); assert.equal(output.result.stdout.includes('VIENTO_PHYSICS2D:'),false);
  assert.deepEqual(publications(output),[]); assert.deepEqual(await hashes(f.author),before);record('native-160-no-trace-no-publish',f,output,before);
});

test('real ordinary publisher retains the existing explicit cumulative 128-event failure boundary',real,async t=>{
  const f=await captured(await scenePhysics2DPlatformEventsAuthor(t,{consumers:false,noCharacters:true,offsetX:1,speed:2000})),before=await hashes(f.author),directory=await stage(f),identified=await adapter.identify(tool);
  const imported=await adapter.executePhase({phase:'import',directory,tool:identified,timeoutMs:60000});assert.equal(imported.status,'succeeded',imported.stdout+imported.stderr);
  const result=await adapter.executePhase({phase:'run',directory,tool:identified,smoke:false,mode:'headlessLogic',timeoutMs:60000});
  assert.notEqual(result.status,'timedOut');assert.ok(result.stdout.includes('runtime_behavior_event_limit'),result.stdout+result.stderr);
  const reader=adapter.createEventReader(f.captured.plan,{smoke:false,capabilities:f.generated.backend.capabilities});reader.push(result.stdout);const ended=reader.finish();
  assert.ok(ended.diagnostics.some(row=>row.code==='runtime_behavior_event_limit'),JSON.stringify(ended));
  assert.equal(reader.events.filter(frame=>frame.event==='event-publish').length,128);
  assert.equal(result.stdout.includes('VIENTO_PHYSICS2D:'),false);assert.deepEqual(await hashes(f.author),before);
  if(reportPath)await fs.appendFile(reportPath.replace(/\.json$/,'-stdout.log'),result.stdout+result.stderr+'\n');
  evidence.push({name:'ordinary-publish-128-explicit-failure',backend:f.generated.backend,tool:identified,diagnostics:ended.diagnostics,publications:reader.events.filter(frame=>frame.event==='event-publish'),authorSha256:hash(JSON.stringify(before))});
});

test('real portable ZIP retains endpoint author events and media after original paths go offline', real, async t => {
  const f = await captured(await scenePhysics2DPlatformEventsAuthor(t)), before = await hashes(f.author), output = path.join(f.temporary,'build');
  const built = await buildProject({ root:f.author,targetId:f.assemblyId,tool,output }); assert.equal(built.ok,true,JSON.stringify(built.record?.diagnostics||built));
  const inspection=()=>inspectBackendProject({buildDirectory:output}); const delivery=await planBackendProjectDelivery({inspection:await inspection(),assertCurrent:inspection});
  const zip=path.join(f.temporary,'platform-events.zip');await writeExportZip(delivery,zip);await verifyBackendProjectDelivery(zip);
  const moved=await fs.mkdtemp(path.join(os.tmpdir(),'viento-physics-platform-events-relocated-'));t.after(()=>fs.rm(moved,{recursive:true,force:true}));
  const archive=await yauzl.openPromise(zip,{lazyEntries:true,autoClose:false});
  try{for await(const entry of archive.eachEntry()){
    assert.ok(!entry.fileName.startsWith('/')&&!entry.fileName.split('/').includes('..'));const chunks=[];
    for await(const chunk of await archive.openReadStreamPromise(entry))chunks.push(chunk);
    const file=path.join(moved,entry.fileName);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,Buffer.concat(chunks));
  }}finally{await new Promise(resolve=>{archive.reader.once('close',resolve);archive.close()});}
  assert.deepEqual(await hashes(f.author),before);await fs.rename(f.author,f.author+'.offline');await fs.rename(output,output+'.offline');
  const observed=await execute(f,path.join(moved,'project'),{scriptCheck:true});assertEndpoints(observed,f);
  assert.equal(observed.reader.events.filter(frame=>frame.event==='audio-command'&&frame.bindingId===f.audioBindingId).length,1);record('portable-relocation',f,observed,before);
  if(reportPath){const destination=path.join(path.dirname(reportPath),path.basename(reportPath,'.json')+'-platform-events.zip');await fs.copyFile(zip,destination,fs.constants.COPYFILE_EXCL);evidence.at(-1).zip={path:destination,sha256:hash(await fs.readFile(zip))};}
});

test('real window capture keeps platform endpoint events and the independent stationary character', { ...real,skip:!tool||!capturePath?'Set VIENTO_GODOT_BIN and VIENTO_PHYSICS_PLATFORM_EVENTS_CAPTURE for capture verification':false },async t=>{
  const f=await captured(await scenePhysics2DPlatformEventsAuthor(t)),before=await hashes(f.author),output=await execute(f,await stage(f),{mode:'windowCapture',capture:capturePath});
  assertEndpoints(output,f);assert.ok((await fs.stat(capturePath)).size>100);assert.deepEqual(await hashes(f.author),before);record('window-capture',f,output,before);
});


test('real endpoint wrapping leaves the frozen .30 character solver and platform carry samples unchanged',real,async t=>{
  const f=await captured(await scenePhysics2DPlatformEventsAuthor(t,{enabled:false,consumers:false})),before=await hashes(f.author);
  const old=await generateGodotPhysicsPlatformMotionProject(f.captured.plan);
  const baseline=await execute(f,await stage(f,old)),current=await execute(f,await stage(f));
  assert.deepEqual(current.snapshot.samples,baseline.snapshot.samples);
  assert.deepEqual(exitActors(current),exitActors(baseline));assert.deepEqual(await hashes(f.author),before);
  record('frozen-030-motion-exact-native-samples',f,current,before);
});

test('real platform queued for deletion in the first callback suppresses all later subscribers',real,async t=>{
  const raw=await scenePhysics2DPlatformEventsAuthor(t,{enabled:false,consumers:false,noCharacters:true,offsetX:1,speed:2000});
  await endpointProbe(raw,{callback:'\tplatform["node"].get_ref().queue_free()\n\tscene.project_host.call_deferred("finish_project")'});await endpointProbe(raw,{index:2});
  const f=await captured(raw),before=await hashes(f.author),output=await execute(f,await stage(f),{smoke:false});
  assert.deepEqual(facts(output).map(row=>[row.probe,row.endpoint]),[[1,'destination']]);
  assert.deepEqual(await hashes(f.author),before);record('queued-platform-revokes-remaining-subscribers',f,output,before);
});

// Real Godot / ordinary author starter / independent planar instances. Separate
// from the default test list; only disposable fixtures and a new proof directory.
import '../adapters/node-studio-core.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { readPackageCatalog } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { GODOT_PLANAR_INTENT_SCRIPT } from '../../engine/godot-planar-intent-script.mjs';
import { validateProjectPhysics2DObservation } from '../../engine/project-physics2d-trace.mjs';
import { scenePhysics2DPlanarIntentAuthor } from './helpers/scene-physics2d-planar-intent-author-fixture.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/scene-physics2d-planar-intent');
const output = path.resolve(process.env.VIENTO_PLANAR_INTENT_OUTPUT || path.join(evidenceRoot, `native-${Date.now()}`));
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted absolute Godot path.');
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a fresh evidence directory in the planar-intent topic.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a fresh empty evidence directory.');
const hash = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => hash(JSON.stringify(value));
const sources = ['engine/godot-planar-intent-script.mjs','engine/script-authoring.mjs','engine/project-physics2d-trace.mjs',
  'engine/scene-physics2d.mjs','scripts/backends/godot4-adapter.mjs','scripts/backends/godot4-physics-planar-intent-projection.mjs','scripts/backends/godot4-physics-planar-intent.mjs','scripts/backends/godot4-physics-planar-intent-inventory.mjs','scripts/backends/godot4-input-map.mjs',
  'scripts/backends/godot4/physics-planar-intent-helper.gd','scripts/backends/godot4/physics-planar-intent-port.gd','scripts/backends/godot4/physics-planar-intent-scene.gd','engine/project-input-map.mjs','scripts/adapters/node-project-build.mjs','scripts/adapters/node-build-snapshot.mjs',
  'scripts/adapters/node-backend-project.mjs','scripts/adapters/node-backend-project-delivery.mjs','scripts/lib/export-package.mjs',
  'scripts/lib/resource-package-reader.mjs','scripts/lib/resource-package-transaction.mjs',
  'scripts/tests/helpers/scene-physics2d-planar-intent-author-fixture.mjs','scripts/tests/scene-physics2d-planar-intent-smoke.mjs'];
const report = { format:'viento-planar-intent-native-proof',schemaVersion:1,startedAt:new Date().toISOString(),
  sources:Object.fromEntries(await Promise.all(sources.map(async name=>[name,hash(await fs.readFile(path.join(appRoot,name)))]))),cases:[],
  limitations:['Real Linux Godot headless run with ordinary saved author TXT; no installed Tauri, Android, window rendering or Bevy claim.',
    'The p2 actions are defined in the saved project input map; a disposable authored test driver injects action states, not real keyboard-device events. No physics or runtime events are synthesized.',
    'Selective resource packages preserve starter bytes, typed parameters and source relationships; destination type/template declarations are explicitly seeded.'] };
const logs = [];
const sanitize = value => value.replaceAll('/home/chiharukiryu/.cache/io.viento.studio/toolchains', '<toolchains>').replaceAll(appRoot, '<app-root>').replace(/\/tmp\/viento-[^\s"'\\]+/g, '<temporary>');
async function hashes(directory, prefix = '') {
  const result = {};
  for (const row of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${row.name}` : row.name;
    if (row.isDirectory()) Object.assign(result, await hashes(directory, name));
    else { assert.ok(row.isFile()); result[name] = hash(await fs.readFile(path.join(directory, name))); }
  }
  return result;
}
function assertClean(result, plan) {
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  assert.deepEqual(adapter.diagnostics(result, plan), [], result.stdout + result.stderr);
  assert.ok(!/Assertion failed|SCRIPT ERROR:|Parse Error:/.test(result.stdout + result.stderr), result.stdout + result.stderr);
}
async function stage(f, captured) {
  const generated = await adapter.generate(captured.plan), directory = await fs.mkdtemp(path.join(f.temporary, 'planar-intent-staged-'));
  for (const [name, bytes] of [...generated.files, ...[...generated.resourceFiles].map(([id, name]) => [name, captured.resources.get(id)])]) {
    const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes);
  }
  return { directory, generated };
}
async function execute(captured, generated, directory, label) {
  const identified = await adapter.identify(tool);
  for (const phase of adapter.runtimePhases) {
    const imported = await adapter.executePhase({ phase, directory, tool: identified, timeoutMs: 60000 });
    logs.push(`CASE ${label} ${phase}\n${imported.stdout}${imported.stderr}`); assertClean(imported, captured.plan);
  }
  const result = await adapter.executePhase({ phase: 'run', directory, tool: identified, timeoutMs: 60000 });
  logs.push(`CASE ${label} run\n${result.stdout}${result.stderr}`); assertClean(result, captured.plan);
  const reader = adapter.createEventReader(captured.plan, { smoke: true, protocolVersion: generated.backend.protocolVersion,
    capabilities: generated.backend.capabilities });
  reader.push(result.stdout); assert.deepEqual(reader.finish().diagnostics, [], result.stdout);
  assert.equal(reader.lifecycle.completed, true);
  return { eventPositions: reader.eventPositions,
    projectEvents: reader.projectEvents, physics: reader.snapshot?.(), events: reader.events, tool: identified };
}
function assertMotion(f, observation) {
  const data=validateProjectPhysics2DObservation(observation);assert.equal(data.phase,'finished');assert.equal(data.limited,false);
  const first=data.samples.filter(row=>row.instanceId===f.instanceId),second=data.samples.filter(row=>row.instanceId===f.otherInstanceId),gravity=data.samples.filter(row=>row.instanceId===f.gravityInstanceId);
  assert.equal(first.length,30);assert.equal(second.length,30);assert.equal(gravity.length,30);
  assert.equal(first[0].objectId,second[0].objectId);assert.notEqual(first[0].bodyId,second[0].bodyId);
  assert.ok(first.every(row=>row.response==='stop')&&second.every(row=>row.response==='slide'));
  const diagonal=rows=>rows.filter(row=>row.requestedMotion[0]>0&&row.requestedMotion[1]>0);
  for(const row of [...diagonal(first),...diagonal(second)]){assert.ok(Math.abs(row.requestedMotion[0]-row.requestedMotion[1])<0.01);assert.ok(Math.hypot(...row.requestedMotion)<=4.01);}
  assert.ok(diagonal(first).length>10&&diagonal(second).length>10,'Both instances submit normalized diagonal movement');
  const wallBodyId=f.wallBodyId||(f.physics.bodies.find(row=>row.instanceId===f.wallInstanceId).id);
  const wallHit=row=>row.contacts.some(contact=>contact.collider?.bodyId===wallBodyId);
  const stops=first.filter(row=>wallHit(row)&&row.requestedMotion[1]>0),slides=second.filter(row=>wallHit(row)&&row.requestedMotion[1]>0);
  assert.ok(stops.length&&slides.length,'Both actors collide with the real wall');
  assert.ok(stops.some(row=>Math.abs(row.displacement[1])<0.1),'Stop response halts the diagonal');
  assert.ok(slides.some(row=>row.displacement[1]>1),'Slide response retains motion along the wall');
  assert.ok(first.some(row=>row.stepIndex>=21&&row.requestedMotion.every(value=>Math.abs(value)<0.001)));
  assert.ok(second.some(row=>row.stepIndex>=21&&row.stepIndex<=25&&row.requestedMotion[0]>0),'Other instance remains independently active');
  assert.ok(gravity.at(-1).positionAfter[1]>gravity[0].positionAfter[1]+1,'The separate existing platformer continues to use gravity');assert.ok(gravity.some(row=>row.requestedMotion[0]>0),'The existing character intent remains active');
  for(const row of [...first,...second,...gravity]){assert.ok(row.source.sourcePath.endsWith('/physics/scene-0.json'));assert.match(row.source.propertyPath,/^\/bodies\/\d+$/);const index=Number(row.source.propertyPath.split('/').at(-1));assert.equal(f.physics.bodies[index]?.id,row.bodyId,'Observed source range must identify the same authored body');assert.equal(f.physics.bodies[index]?.instanceId,row.instanceId);}
  return {first:first.map(row=>({stepIndex:row.stepIndex,requestedMotion:row.requestedMotion,displacement:row.displacement,positionAfter:row.positionAfter,contacts:row.contacts})),
    second:second.map(row=>({stepIndex:row.stepIndex,requestedMotion:row.requestedMotion,displacement:row.displacement,positionAfter:row.positionAfter,contacts:row.contacts})),gravityFirst:gravity[0],gravityLast:gravity.at(-1),wallBodyId};
}
function assertExistingSubsystems(f,result){
  const event=result.events.find(row=>row.event==='event-publish'&&row.bindingId===f.sensorBindingId&&row.value===f.gravityInstanceId);assert.ok(event,'The pre-existing sensor publishes for the gravity character');
  const exit=result.events.find(row=>row.event==='scene-exit'&&row.sceneId===f.sceneIds[0]);assert.ok(exit);const platform=exit.actors.find(row=>row.instanceId===f.platformInstanceId);assert.ok(platform);assert.ok(Math.abs(platform.position[1]-400)>0.1,'The pre-existing vertical platform moves');return {sensorEvent:event,platformExit:platform};
}
async function archiveExtract(zip, target) {
  const archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  try { for await (const entry of archive.eachEntry()) {
    assert.ok(!entry.fileName.startsWith('/') && !entry.fileName.split('/').includes('..'));
    const chunks = []; for await (const bytes of await archive.openReadStreamPromise(entry)) chunks.push(bytes);
    const file = path.join(target, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks));
  } } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
}
async function runCase(name, operation) {
  const cleanups = [], fixture = { after: fn => cleanups.push(fn) };
  try { const value = await operation(fixture); report.cases.push({ name, passed: true, ...value }); console.log(`PASS ${name}`); }
  finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
}
try {
  report.tool=await adapter.identify(tool);report.node={version:process.version,sha256:hash(await fs.readFile(process.execPath))};
  await runCase('shared-source-two-instances-migration-and-offline-delivery',async t=>{
    const f=await scenePhysics2DPlanarIntentAuthor(t);
    const rawManifest='\uFEFF'+JSON.stringify(await f.read(f.manifestPath),null,'\t').replaceAll('\n','\r\n')+'\r\n';
    await fs.writeFile(path.join(f.author,f.manifestPath),rawManifest);const rawScript=GODOT_PLANAR_INTENT_SCRIPT;await f.script('planar-intent',rawScript);const driverPath='documents/scripts/motion-input.txt',rawDriver=(await fs.readFile(path.join(f.author,driverPath),'utf8')).replaceAll('\n','\r\n');await f.script('motion-input',rawDriver);
    const before=await hashes(f.author),registry=await readRegistry(f.author);f.physics=await f.read(f.physicsPath);f.captured=await captureBuildSnapshot(f.author,f.assemblyId);
    assert.equal(f.captured.ok,true,JSON.stringify(f.captured.diagnostics));
    const staged=await stage(f,f.captured);assert.ok(staged.generated.backend.capabilities.includes('physics.planar-intent2d'));assert.ok(staged.generated.backend.capabilities.includes('project.input-map'));assert.match(staged.generated.files.get('project.godot').toString(),/p2_right=\{/);
    const direct=await execute(f.captured,staged.generated,staged.directory,'author-source');const authoredMotion=assertMotion(f,direct.physics),existingSubsystems=assertExistingSubsystems(f,direct);
    assert.deepEqual(await hashes(f.author),before);for(const [name,bytes] of staged.generated.files)assert.deepEqual(await fs.readFile(path.join(staged.directory,name)),bytes,name);
    const catalog=await readPackageCatalog(f.author),plan=await planExport(f.author,{kind:'resources',revision:catalog.revision,ids:[f.assemblyId],includeDependencies:true,includeChildren:false});
    const authorZip=path.join(f.temporary,'planar-intent.viento-package.zip');await writeExportZip(plan,authorZip);const unpacked=path.join(f.temporary,'unpacked');await fs.mkdir(unpacked);
    const pack=await unpackResourcePackage(authorZip,unpacked),transferred=new Set(pack.manifest.documents.map(item=>item.id));
    for(const id of [f.assemblyId,f.sceneIds[0],f.physicsId,f.manifestId,f.starterScriptId,f.driverScriptId,f.legacyScriptId,f.motorScriptId,f.sensorScriptId,f.inputMapId])assert.ok(transferred.has(id),id);
    const target=path.join(f.temporary,'migrated-author');await fs.cp(f.author,target,{recursive:true});
    const workspacePath=path.join(target,'workspace.json'),workspace=JSON.parse(await fs.readFile(workspacePath,'utf8'));workspace.id=randomUUID();workspace.version=2;workspace.paths={documents:'design-data',templates:'data-template',metadata:'metadata'};
    await fs.rename(path.join(target,'templates'),path.join(target,'data-template'));await fs.writeFile(workspacePath,JSON.stringify(workspace,null,2)+'\n');
    for(const name of ['documents','metadata','assets','.viento'])await fs.rm(path.join(target,name),{recursive:true,force:true});
    for(const name of ['design-data','metadata/documents','metadata/assets','assets'])await fs.mkdir(path.join(target,name),{recursive:true});
    const preview=await planPackageImport(target,pack);assert.deepEqual(preview.summary.conflicts,[]);assert.equal((await applyPackageImport(target,pack,preview.revision)).status,'imported');
    const restored=await readRegistry(target);for(const original of registry.documents.filter(item=>transferred.has(item.id))){
      const copy=restored.documents.find(item=>item.id===original.id);assert.equal(copy.sourcePath,original.sourcePath.replace(/^documents\//,'design-data/'));
      assert.deepEqual(await fs.readFile(path.join(target,copy.sourcePath)),await fs.readFile(path.join(f.author,original.sourcePath)));assert.deepEqual(copy.relations,original.relations);assert.deepEqual(copy.assetBindings,original.assetBindings);
    }
    assert.equal(await fs.readFile(path.join(target,'design-data/scripts/planar-intent.txt'),'utf8'),rawScript);assert.equal(await fs.readFile(path.join(target,'design-data/scripts/motion-input.txt'),'utf8'),rawDriver);
    assert.equal(await fs.readFile(path.join(target,'design-data/behaviors/demo.json'),'utf8'),rawManifest);
    const captured=await captureBuildSnapshot(target,f.assemblyId);assert.equal(captured.ok,true,JSON.stringify(captured.diagnostics));assert.deepEqual(captured.plan.requiredCapabilities,f.captured.plan.requiredCapabilities);
    const buildDirectory=path.join(f.temporary,'migrated-build'),built=await buildProject({root:target,targetId:f.assemblyId,tool,output:buildDirectory,timeoutMs:60000});assert.equal(built.ok,true,JSON.stringify(built.record?.diagnostics||built));
    assert.deepEqual(built.record.phases.map(item=>item.phase),adapter.buildPhases);for(const item of built.record.phases){assert.equal(item.status,'succeeded',item.stdout+item.stderr);logs.push(`CASE migrated-build ${item.phase}\n${item.stdout}${item.stderr}`);}const buildPhases=built.record.phases.map(({phase,status})=>({phase,status}));
    const frozenHashes=await hashes(path.join(buildDirectory,'project')),session=await runProjectBuild({buildDirectory,tool,timeoutMs:60000});assert.equal(session.ok,true,JSON.stringify(session.record?.diagnostics||session));
    const restoredMotion=assertMotion(f,session.record.physics),inspect=()=>inspectBackendProject({buildDirectory});assert.deepEqual(await hashes(path.join(buildDirectory,'project')),frozenHashes);
    const delivery=await planBackendProjectDelivery({inspection:await inspect(),assertCurrent:inspect}),zip=path.join(f.temporary,'planar-intent.viento-build.zip');await writeExportZip(delivery,zip);await verifyBackendProjectDelivery(zip);
    const archiveBytes=await fs.readFile(zip),moved=await fs.mkdtemp(path.join(os.tmpdir(),'viento-planar-offline-'));t.after(()=>fs.rm(moved,{recursive:true,force:true}));await archiveExtract(zip,moved);
    assert.equal(await fs.readFile(path.join(moved,'project/behaviors',`${f.starterScriptId}.gd`),'utf8'),rawScript);assert.match(await fs.readFile(path.join(moved,'project/project.godot'),'utf8'),/p2_right=\{/);assert.deepEqual(await hashes(f.author),before);
    const targetHashes=await hashes(target);await fs.rename(f.author,f.author+'.offline');await fs.rename(target,target+'.offline');await fs.rename(buildDirectory,buildDirectory+'.offline');
    const generated=await adapter.generate(captured.plan),offline=await execute(captured,generated,path.join(moved,'project'),'offline-delivered'),offlineMotion=assertMotion(f,offline.physics),offlineExistingSubsystems=assertExistingSubsystems(f,offline);
    assert.deepEqual(await hashes(f.author+'.offline'),before);assert.deepEqual(await hashes(target+'.offline'),targetHashes);
    return {backend:staged.generated.backend,authorFiles:Object.keys(before).length,authorSha256:jsonHash(before),authorUnchanged:true,generatedUnchanged:true,
      sharedActorObjectId:direct.physics.samples.find(row=>row.instanceId===f.instanceId).objectId,instanceIds:[f.instanceId,f.otherInstanceId],gravityInstanceId:f.gravityInstanceId,
      authoredMotion,restoredMotion,offlineMotion,existingSubsystems,offlineExistingSubsystems,buildPhases,importedDocuments:transferred.size,scriptSha256:hash(rawScript),manifestSha256:hash(rawManifest),
      package:{bytes:(await fs.stat(authorZip)).size,sha256:hash(await fs.readFile(authorZip))},delivery:{bytes:archiveBytes.length,sha256:hash(archiveBytes),originalAuthorOffline:true,restoredAuthorOffline:true,originalBuildOffline:true}};
  });
  for(const [name,expected] of Object.entries(report.sources))assert.equal(hash(await fs.readFile(path.join(appRoot,name))),expected,`Source changed: ${name}`);
  report.sourceSnapshotUnchanged=true;report.ok=true;report.passed=report.cases.length;report.failed=0;
}catch(error){report.ok=false;report.failure=sanitize(String(error.stack));console.error(report.failure);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'native.json'),sanitize(JSON.stringify(report,null,2))+'\n');await fs.writeFile(path.join(output,'stdout.log'),sanitize(logs.join('\n')));console.log(`Evidence: ${path.relative(appRoot,output)}`);}

// Consume the exact browser-saved author workspace; no prepared gameplay source.
import '../adapters/node-studio-core.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';
import { buildProject } from '../adapters/node-project-build.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const [browserDirectory, requestedOutput] = process.argv.slice(2);
const executable = process.env.VIENTO_GODOT_BIN;
assert.ok(browserDirectory && requestedOutput && executable && path.isAbsolute(executable));
const output = path.resolve(requestedOutput); assert.ok(output.startsWith('/tmp/'));
await fs.mkdir(output, { recursive: true }); assert.deepEqual(await fs.readdir(output), []);
const browser = JSON.parse(await fs.readFile(path.join(browserDirectory, 'browser.json'), 'utf8')); assert.equal(browser.ok, true);
const originalAuthor = path.join(browserDirectory, 'author-final'), hash = value => createHash('sha256').update(value).digest('hex');
const sourceNames = ['scripts/tests/menu-target-authoring-native-smoke.mjs','scripts/tests/helpers/menu-targets-keyboard.py','scripts/tests/helpers/menu-targets-observer.gd','scripts/backends/godot4-adapter.mjs','scripts/backends/godot4/project-menu-runtime.gd','scripts/backends/godot4/project-menu-input.gd','engine/project-menu.mjs','engine/godot-project-menu-script.mjs','engine/project-menu-item-edit.mjs'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceNames.map(async file => [file, hash(await fs.readFile(path.join(appRoot,file)))])));
async function inventory(root) {
  const value = {};
  for (const row of await fs.readdir(root, { recursive:true, withFileTypes:true })) if (row.isFile()) {
    const file = path.join(row.parentPath || row.path,row.name), relative = path.relative(root,file);
    if (relative.split(path.sep).some(part => part.startsWith('.'))) continue;
    value[relative] = hash(await fs.readFile(file));
  }
  return Object.fromEntries(Object.entries(value).sort());
}
const before = await inventory(originalAuthor), sourcesBefore = await sourceHashes();
assert.deepEqual(before,browser.authorFinal.hashes);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(),'viento-menu-targets-native-'));
const author = path.join(temporary,'author'), buildDirectory = path.join(temporary,'build');
await fs.cp(originalAuthor,author,{recursive:true});
const env = {...process.env,LIBGL_ALWAYS_SOFTWARE:'1',GODOT_SILENCE_ROOT_WARNING:'1',XDG_DATA_HOME:path.join(temporary,'data'),XDG_CONFIG_HOME:path.join(temporary,'config'),XDG_CACHE_HOME:path.join(temporary,'cache')};
const success = result => { assert.equal(result.status,'succeeded',result.stdout+result.stderr); assert.doesNotMatch(result.stdout+result.stderr,/(?:SCRIPT ERROR:|ERROR:)/); };
const flow = {assemblyTitle:browser.plan.title,start:browser.identities.startScene,game:browser.identities.gameScene,result:browser.identities.resultScene};
const results = [];
let generated, snapshot, tool;
async function runWindow(directory,name) {
  const target = path.join(output,name); await fs.mkdir(target);
  const observer = await fs.readFile(path.join(appRoot,'scripts/tests/helpers/menu-targets-observer.gd'));
  await fs.writeFile(path.join(directory,'project-menu-observer.gd'),observer);
  const sceneText=['[gd_scene load_steps=2 format=3]','','[ext_resource type="Script" path="res://project-menu-observer.gd" id="1"]','','[node name="VientoProject" type="Node2D"]','script = ExtResource("1")','sample_directory = '+JSON.stringify(path.join(target,'frames')),''].join('\n');
  await fs.writeFile(path.join(directory,'project-menu-observer.tscn'),sceneText);
  await fs.writeFile(path.join(directory,'menu-targets-flow.json'),JSON.stringify(flow,null,2)+'\n');
  try {
    success(await runBuildProcess('python3',[path.join(appRoot,'scripts/tests/helpers/menu-targets-keyboard.py'),executable,directory,target],{cwd:directory,env,timeoutMs:90000}));
    const stdout=await fs.readFile(path.join(target,'window-output.log'),'utf8'),reader=adapter.createEventReader(snapshot.plan,{capabilities:generated.backend.capabilities});
    reader.push(stdout); const observed=reader.finish();assert.deepEqual(observed.diagnostics,[]);
    const visits=observed.events.filter(row=>row.event==='scene-enter'); assert.deepEqual(visits.map(row=>row.sceneId),[flow.start,flow.result,flow.start,flow.game,flow.start]);assert.equal(observed.events.at(-1).event,'finished');
    const keyboard=JSON.parse(await fs.readFile(path.join(target,'keyboard.json')));assert.equal(keyboard.stages.length,5);
    const captures=Object.fromEntries(await Promise.all((await fs.readdir(path.join(target,'frames'))).filter(name=>name.endsWith('.png')).map(async name=>[name,hash(await fs.readFile(path.join(target,'frames',name)))])));
    assert.ok(Object.keys(captures).length>=5);
    for(const[name,bytes]of generated.files)assert.deepEqual(await fs.readFile(path.join(directory,name)),bytes,name);
    const result={name,ok:true,visits:visits.length,stages:keyboard.stages.length,events:observed.events.length,screenshots:Object.keys(captures).length};
    await fs.writeFile(path.join(target,'verification.json'),JSON.stringify({...result,events:observed.events,captures,flow},null,2)+'\n');results.push(result);
  } finally { for(const file of ['project-menu-observer.gd','project-menu-observer.gd.uid','project-menu-observer.tscn','menu-targets-flow.json'])await fs.rm(path.join(directory,file),{force:true}); }
}
try {
  const built=await buildProject({root:author,targetId:browser.plan.assemblyId,tool:executable,output:buildDirectory,timeoutMs:90000});
  assert.equal(built.ok,true,JSON.stringify(built));
  snapshot=JSON.parse(await fs.readFile(path.join(buildDirectory,'snapshot.json')));generated=await adapter.generate(snapshot.plan);tool=await adapter.identify(executable);
  assert.equal(snapshot.plan.scenes.length,3);
  await runWindow(path.join(buildDirectory,'project'),'original');
  const inspect=()=>inspectBackendProject({buildDirectory});
  const delivery=await planBackendProjectDelivery({inspection:await inspect(),assertCurrent:inspect}),zip=path.join(output,'menu-targets.viento-build.zip');
  await writeExportZip(delivery,zip);const verified=await verifyBackendProjectDelivery(zip),relocated=path.join(temporary,'relocated');await fs.mkdir(relocated);
  const archive=await yauzl.openPromise(zip,{lazyEntries:true,autoClose:false});
  try { for await(const entry of archive.eachEntry()) {
    assert.ok(!entry.fileName.startsWith('/')&&!entry.fileName.split('/').includes('..'));
    const chunks=[];for await(const bytes of await archive.openReadStreamPromise(entry))chunks.push(bytes);
    const file=path.join(relocated,entry.fileName);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,Buffer.concat(chunks));
  }} finally {archive.close();}
  await fs.rename(author,author+'.offline');await fs.rename(buildDirectory,buildDirectory+'.offline');
  await assert.rejects(fs.access(author),{code:'ENOENT'});await assert.rejects(fs.access(buildDirectory),{code:'ENOENT'});
  const phases=[];for(const phase of adapter.buildPhases){const result=await adapter.executePhase({phase,directory:path.join(relocated,'project'),tool,timeoutMs:90000});success(result);phases.push({phase,...result});}
  await runWindow(path.join(relocated,'project'),'offline');
  assert.deepEqual(await inventory(author+'.offline'),before);assert.deepEqual(await inventory(originalAuthor),before);assert.deepEqual(await sourceHashes(),sourcesBefore);
  await fs.copyFile(path.join(appRoot,'scripts/tests/helpers/menu-targets-observer.gd'),path.join(output,'observer.gd'));
  await fs.copyFile(path.join(appRoot,'scripts/tests/helpers/menu-targets-keyboard.py'),path.join(output,'keyboard-driver.py'));
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({ok:true,tool,results,flow,browserDirectory,authorBefore:before,authorAfter:await inventory(originalAuthor),generatedFiles:Object.fromEntries([...generated.files].map(([name,bytes])=>[name,hash(bytes)])),sourcesBefore,sourcesAfter:await sourceHashes(),offline:{originalPathsUnavailable:true,zip:{bytes:(await fs.stat(zip)).size,sha256:hash(await fs.readFile(zip)),verified},phases},limitations:['Xvfb/Mesa with XTest mouse and keyboard, not physical-device or installed-app validation.','The new read-only observer assumes no optional animation/audio/HUD controller, calls the inherited ready once, and adds an independent input/snapshot child. It never calls gameplay ports or advances the project clock. Generated runtime and author source remain unchanged.','Three-scene authoring slice; not a complete game-from-blank claim.']},null,2)+'\n');
  console.log(JSON.stringify({ok:true,results,output}));
} finally { await fs.rm(temporary,{recursive:true,force:true}); }

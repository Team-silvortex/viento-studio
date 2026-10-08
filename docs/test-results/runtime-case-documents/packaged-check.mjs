// Run after final preparation with the pinned embedded Node and existing host tools.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = fileURLToPath(new URL('./', import.meta.url));
const desktop = path.join(root, 'desktop/resources');
const mobile = path.join(root, 'mobile/dist');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const rewrite = source => source.replaceAll("from 'yaml'", "from '/vendor/yaml/index.js'")
  .replaceAll("from '../node_modules/yaml/browser/index.js'", "from '/vendor/yaml/index.js'");
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const configured = [['org.viento.godot4', process.env.VIENTO_GODOT_BIN], ['org.viento.bevy', process.env.VIENTO_BEVY_BIN]];
assert.equal(process.version, 'v24.20.0', 'Use the pinned embedded Node');
assert.ok(configured.every(([, tool]) => typeof tool === 'string' && path.isAbsolute(tool)), 'Provide both existing host tools');

async function fileHash(file) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
}

async function inventory(directory) {
  const files = {};
  const entries = await fs.readdir(directory, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    assert.ok(entry.isFile(), 'Prepared and fixture inventories must contain only regular files and directories');
    const file = path.join(entry.parentPath, entry.name);
    const bytes = await fs.readFile(file);
    const signature = bytes.length >= 4 ? bytes.readUInt32BE(0) : null;
    const nativeExecutable = [0x7f454c46, 0xcafebabe, 0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe].includes(signature)
      || bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;
    files[path.relative(directory, file)] = { bytes: bytes.length, sha256: hash(bytes), ...(nativeExecutable ? { nativeExecutable: true } : {}) };
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b, 'en')));
}

const imported = file => import(pathToFileURL(path.join(desktop, file)));
const sourceImport = file => import(pathToFileURL(path.join(root, file)));
const report = { ok: false, recordedAt: new Date().toISOString(),
  scope: 'Persist and reload exact author case bytes, native full-archive stable identity migration, then final prepared resources under pinned Node execute Godot and Bevy frozen offline runtime cases with separate pass/fail evaluations. Mobile resources only evaluate portable data with admitted desktop samples in an isolated VM; no Android execution or UI acceptance.',
  embeddedNode: { version: process.version, sha256: await fileHash(process.execPath) },
  proofSourceSha256: await fileHash(fileURLToPath(import.meta.url)),
  artifacts: {}, unchangedBackendSources: {}, externalTools: [], desktopChecks: [], mobileChecks: {} };

const shared = [...(await fs.readdir(path.join(root, 'engine'))).filter(file => file.endsWith('.mjs')).map(file => `engine/${file}`),
  'engine/studio-core.wasm', 'engine/studio-core.build.json', 'web/project-build.css', 'favicon.ico',
  ...['app-runtime.js', 'app-project-build.js', 'app-scene-preview.js', 'app-scene-composition-overrides.js','app-runtime-case-documents.js','app-doc-service.js'].map(file => `web/modules/${file}`),
  ...['messages.js', 'en.js', 'ja.js'].map(file => `web/i18n/${file}`)];
const host = ['scripts/adapters/node-execution-backends.mjs', 'scripts/adapters/node-execution-tool.mjs',
  'scripts/adapters/node-execution-tool-probe.mjs', 'scripts/adapters/node-project-build.mjs',
  'scripts/adapters/node-build-snapshot.mjs', 'scripts/adapters/node-world-projection.mjs', 'scripts/adapters/node-studio-core.mjs',
  'scripts/lib/project-build-service.mjs','scripts/lib/runtime-case-documents.mjs','scripts/adapters/node-document-storage.mjs','scripts/lib/doc-file-store.mjs','scripts/lib/project-documents.mjs','scripts/lib/resource-package-catalog.mjs','scripts/lib/resource-package-reader.mjs','scripts/lib/resource-package-import.mjs', 'scripts/lib/build-process.mjs', 'scripts/lib/doc-api-service.mjs', 'scripts/project-build.mjs',
  ...(await fs.readdir(path.join(root, 'scripts/backends'), { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile()).map(entry => path.relative(root, path.join(entry.parentPath, entry.name))),
  ...(await fs.readdir(path.join(root, 'schemas'))).filter(file => file.endsWith('.json')).map(file => `schemas/${file}`)];

for (const [name, extra] of [['desktop/resources', host], ['mobile/dist', ['mobile/platform.mjs']]]) {
  const base = path.join(root, name), files = await inventory(base), checked = {};
  for (const file of [...shared, ...extra]) {
    const source = await fs.readFile(path.join(root, file)), prepared = await fs.readFile(path.join(base, file));
    const expected = name === 'mobile/dist' && file.startsWith('engine/') && file.endsWith('.mjs')
      ? Buffer.from(rewrite(source.toString('utf8'))) : source;
    assert.equal(hash(prepared), hash(expected), `Prepared copy differs: ${name}/${file}`);
    checked[file] = { sourceSha256: hash(source), packagedSha256: hash(prepared), importRewrite: !source.equals(prepared) };
  }
  assert.ok(!Object.keys(files).some(file => /^(?:examples|works|workspaces|crates)\//.test(file)
    || file.startsWith('web/data/') || file.startsWith('scripts/tests/')
    || /(?:^|\/)(?:viento-node[^/]*|viento-bevy-runtime[^/]*|Cargo\.lock)$/.test(file)));
  assert.ok(!Object.values(files).some(file => file.nativeExecutable), 'Execution tools must remain outside prepared resource trees');
  if (name === 'mobile/dist') {
    assert.ok(!Object.keys(files).some(file => file.startsWith('scripts/adapters/') || file.startsWith('scripts/backends/')
      || file === 'scripts/lib/project-build-service.mjs' || file === 'scripts/project-build.mjs'));
  }
  report.artifacts[name] = { manifestFileCount: Object.keys(files).length,
    manifestBytes: Object.values(files).reduce((sum, file) => sum + file.bytes, 0),
    manifestSha256: hash(JSON.stringify(files)), manifest: files,
    checkedSourceFiles: Object.keys(checked).length, checkedSourceSha256: hash(JSON.stringify(checked)), hashes: checked };
}
const libraryTranslations = {};
for (const file of ['messages.js', 'en.js', 'ja.js']) {
  const source = await fs.readFile(path.join(root, 'web/i18n', file)), prepared = await fs.readFile(path.join(root, 'desktop/ui/i18n', file));
  assert.deepEqual(prepared, source); libraryTranslations[file] = hash(prepared);
}
report.desktopLibraryTranslationHashes = libraryTranslations;
report.mobileHasNoHostExecutionModulesOrNativeTool = true;
report.preparedResourcesHaveNoRustCrateOrNativeEngineTool = true;

const frozen = JSON.parse(await fs.readFile(path.join(evidence, 'frozen-backend-baseline.json')));
for (const [file, expected] of Object.entries(frozen)) {
  assert.equal(await fileHash(path.join(root, file)), expected);
  assert.equal(await fileHash(path.join(desktop, file)), expected);
}
report.frozenBackendAndCoreSha256 = frozen;
const previous = JSON.parse(await fs.readFile(path.join(root, 'docs/test-results/runtime-instance-control/packaged-resources.json')));
for (const file of host.filter(file => file.startsWith('scripts/backends/'))) {
  const expected = previous.artifacts['desktop/resources'].hashes[file].sourceSha256;
  assert.equal(await fileHash(path.join(root, file)), expected, `Execution backend changed: ${file}`);
  report.unchangedBackendSources[file] = expected;
}

const { createExecutionBackendRegistry } = await imported('scripts/adapters/node-execution-backends.mjs');
const { createExecutionBackendRegistry: createSourceRegistry } = await sourceImport('scripts/adapters/node-execution-backends.mjs');
const { createProjectBuildService } = await imported('scripts/lib/project-build-service.mjs');
const { runProjectBuildCommand } = await imported('scripts/project-build.mjs');
const registry = createExecutionBackendRegistry(), sourceRegistry = createSourceRegistry();
assert.deepEqual(registry.descriptors(), sourceRegistry.descriptors());
report.registry = plain(registry.descriptors());
report.executionFingerprints = {};
report.legacyGodotGoldens = [];
for (const [backendId] of configured) {
  const actual = await registry.resolve(backendId).fingerprint();
  assert.deepEqual(actual, await sourceRegistry.resolve(backendId).fingerprint());
  report.executionFingerprints[backendId] = actual;
}
for (const version of [1, 2]) {
  const golden = JSON.parse(await fs.readFile(path.join(root, `scripts/tests/fixtures/scene-model/legacy-plan-v${version}.json`)));
  const generated = await registry.resolve('org.viento.godot4').generate(golden.plan);
  assert.deepEqual(Object.fromEntries([...generated.files].map(([file, bytes]) => [file, hash(bytes)])), golden.godotFiles);
  assert.deepEqual(generated.sourceMap, golden.godotSourceMap);
  report.legacyGodotGoldens.push({ planVersion: version, fileHashes: golden.godotFiles, sourceMapUnchanged: true });
}

const { validateRuntimeCase, evaluateRuntimeCase } = await imported('engine/runtime-verification-case.mjs');
const archiveTool = process.env.VIENTO_TEST_ARCHIVE_BINARY;
assert.ok(typeof archiveTool === 'string' && path.isAbsolute(archiveTool), 'Provide the fresh native full-archive helper');
const nativeProof = JSON.parse(await fs.readFile(path.join(evidence, 'native-helpers-proof.json')));
const archiveProof = nativeProof.binaries.find(binary => binary.path === archiveTool);
assert.ok(nativeProof.ok && nativeProof.freshBuild && nativeProof.offlineLocked && archiveProof);
assert.equal(await fileHash(archiveTool), archiveProof.sha256);
assert.equal((await fs.stat(archiveTool)).size, archiveProof.size);
report.nativeArchive = { sha256: archiveProof.sha256, bytes: archiveProof.size, freshOfflineLockedHelper: true };
const temporary = await fs.mkdtemp(path.join(os.tmpdir(),'viento-case-documents-packaged-'));
const services=[], inputs=[];
async function settle(service, expected) {
  for(let i=0;i<3000;i++){
    const state=await service.status();
    assert.equal(state.job?.id, expected.id, 'Observe the newly submitted task');
    assert.equal(state.job?.kind, expected.kind, 'Observe the expected task kind');
    if(state.job.status!=='running')return state;
    await new Promise(r=>setTimeout(r,10));
  }
  throw new Error('Prepared service did not settle');
}
async function runJob(service, payload) {
  const previous = (await service.status()).job?.id;
  const started = await service.command(payload);
  assert.ok(started.job?.id && started.job.id !== previous, 'Each operation must register a new task');
  assert.equal(started.job.kind, payload.action);
  return settle(service, { id: started.job.id, kind: payload.action });
}
// This controlled fixture uses the four standard v3 data roots. Root README
// and local caches are outside the native full-archive author-data contract.
const authorData = files => Object.fromEntries(Object.entries(files).filter(([file]) =>
  /^(?:documents|templates|metadata|assets)\//.test(file) || ['workspace.json', '.viento/workspace.json'].includes(file)));
const first='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', second='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const release={left:false,right:false,up:false,down:false};
const definition=validateRuntimeCase({format:'viento-runtime-case',schemaVersion:1,program:{format:'viento-runtime-control',schemaVersion:2,fixedDelta:.125,steps:[{inputs:[{instanceId:first,...release,right:true}]},{inputs:[]}]},checks:[
 {instanceId:first,stepIndex:0,position:{value:[220,220],tolerance:.0001},state:'moving'},
 {instanceId:first,stepIndex:1,position:{value:[220,220],tolerance:.0001},state:'idle'},
 {instanceId:second,stepIndex:1,position:{value:[500,220],tolerance:.0001},state:'idle'}]});
try {
  for(const [backendId,tool] of configured) {
    const name=backendId.split('.').at(-1),work=path.join(temporary,name),cacheRoot=path.join(temporary,name+'-cache');
    await fs.cp(path.join(root,'examples/bevy-headless'),work,{recursive:true});const before=await inventory(work);
    const service=createProjectBuildService(work,{backendId,tool,cacheRoot});services.push(service);
    const catalog=await service.command({action:'case-list',sceneId});
    const wrapper={format:'viento-runtime-case-document',schemaVersion:1,sceneObjectId:sceneId,case:definition};
    const caseText='\uFEFF'+JSON.stringify(wrapper,null,'\t').replaceAll('\n','\r\n')+'\r\n';
    const authored=await service.command({action:'case-save',sceneId,sceneVersion:catalog.sceneVersion,sourcePath:'documents/runtime-cases/prepared.json',documentType:catalog.defaults.documentType,content:caseText});
    const loaded=await service.command({action:'case-load',documentId:authored.id});assert.equal(loaded.content,caseText);assert.deepEqual(loaded.definition,definition);assert.equal(loaded.valid,true);
    const savedBefore=await inventory(work);for(const [file,value]of Object.entries(before))assert.deepEqual(savedBefore[file],value);
    const addedAuthorFiles=Object.keys(savedBefore).filter(file=>!Object.hasOwn(before,file)).sort();
    assert.deepEqual(addedAuthorFiles,['documents/runtime-cases/prepared.json',`metadata/documents/${authored.id}.json`].sort(),
      'Saving a case adds only its exact source and registration');
    const archive=path.join(temporary,name+'.viento.zip'),parent=path.join(temporary,name+'-restored');await fs.mkdir(parent);
    const exported = JSON.parse((await execute(archiveTool,['export',work,archive],{timeout:30000,maxBuffer:1048576})).stdout);
    const restored=JSON.parse((await execute(archiveTool,['import',archive,parent],{timeout:30000,maxBuffer:1048576})).stdout).root;
    const expectedAuthorData=authorData(savedBefore),restoredFiles=await inventory(restored);
    assert.equal(exported.files,Object.keys(expectedAuthorData).length);
    assert.deepEqual(authorData(restoredFiles),expectedAuthorData,'Full archive preserves the complete author-data file set and bytes');
    assert.equal(JSON.parse(await fs.readFile(path.join(restored,'workspace.json'))).id,JSON.parse(await fs.readFile(path.join(work,'workspace.json'))).id);
    const migrated=createProjectBuildService(restored,{backendId,tool,cacheRoot:path.join(temporary,name+'-restored-cache')});services.push(migrated);
    const reloaded=await migrated.command({action:'case-load',documentId:authored.id});assert.equal(reloaded.content,caseText);assert.equal(reloaded.sceneId,sceneId);assert.equal(reloaded.id,authored.id);assert.equal(reloaded.version,authored.version);assert.deepEqual(reloaded.definition,definition);assert.equal(reloaded.valid,true);await migrated.close();
    const probe=await runProjectBuildCommand(['--command','tool-check','--backend',backendId,'--tool',tool]);assert.equal(probe.ok,true);
    report.externalTools.push({backendId,identity:probe.toolStatus.identity,bytes:(await fs.stat(tool)).size});
    const planned=await runJob(service,{action:'plan',sceneId});assert.equal(planned.job.status,'succeeded');
    const built=await runJob(service,{action:'build',sceneId,expectedSnapshotId:planned.job.plan.snapshotId});assert.equal(built.job.status,'succeeded');
    const buildPaths=Object.keys(await inventory(cacheRoot)).filter(file=>file.endsWith('/build.json'));assert.equal(buildPaths.length,1);
    const directory=path.dirname(path.join(cacheRoot,buildPaths[0]));const build=JSON.parse(await fs.readFile(path.join(directory,'build.json')));const frozen=await inventory(path.join(directory,'project'));
    await fs.rename(work,work+'-offline');await service.status({refresh:true});
    const pass=await runJob(service,{action:'run',buildId:built.latestBuild.id,mode:'headless',runtimeCase:loaded.definition,runtimeCaseSceneId:loaded.sceneId});
    assert.equal(pass.job.status,'succeeded');assert.equal(pass.job.verification.evaluation.status,'passed');
    const wrong=plain(definition);wrong.checks[0].position.value[0]+=1;
    const fail=await runJob(service,{action:'run',buildId:built.latestBuild.id,mode:'headless',runtimeCase:wrong,runtimeCaseSceneId:loaded.sceneId});
    assert.equal(fail.job.status,'succeeded');assert.equal(fail.job.verification.evaluation.status,'failed');assert.equal(fail.job.verification.evaluation.failedChecks,1);
    assert.deepEqual(pass.job.control.program,fail.job.control.program);assert.equal(pass.job.control.sha256,fail.job.control.sha256);
    await assert.rejects(service.command({action:'case-load',documentId:authored.id}));
    const file=path.join(temporary,name+'-case.json');await fs.writeFile(file,caseText);
    const cli=await runProjectBuildCommand(['--command','run','--build',directory,'--backend',backendId,'--tool',tool,'--runtime-case',file]);
    assert.equal(cli.ok,true);assert.equal(cli.status,'succeeded');assert.equal(cli.record.verification.evaluation.status,'passed');
    const sessions=await fs.readdir(path.join(directory,'sessions'));assert.equal(sessions.length,3);
    const sessionStatuses=[];
    for(const id of sessions){const saved=JSON.parse(await fs.readFile(path.join(directory,'sessions',id,'session.json')));assert.equal(saved.status,'succeeded');assert.ok(['passed','failed'].includes(saved.verification.evaluation.status));sessionStatuses.push(saved.verification.evaluation.status);assert.deepEqual(saved.verification.definition,saved.verification.evaluation.status==='passed'?definition:wrong);await assert.rejects(fs.stat(path.join(directory,'sessions',id,'project')),{code:'ENOENT'});}
    assert.deepEqual(sessionStatuses.sort(),['failed','passed','passed']);
    assert.deepEqual(await inventory(work+'-offline'),savedBefore);assert.deepEqual(await inventory(path.join(directory,'project')),frozen);
    inputs.push({plan:null,definition:plain(definition),caseText,samples:pass.job.control.samples,pass:pass.job.verification.evaluation,wrong,fail:fail.job.verification.evaluation});
    // Build snapshots carry their full plan in snapshot.json rather than build.json.
    inputs.at(-1).plan=JSON.parse(await fs.readFile(path.join(directory,'snapshot.json'))).plan;
    assert.deepEqual(evaluateRuntimeCase(inputs.at(-1).plan,definition,pass.job.control.samples,{complete:true}),pass.job.verification.evaluation);
    report.desktopChecks.push({backendId,buildId:built.latestBuild.id,snapshotId:built.latestBuild.snapshotId,
      observedJobs:[planned,built,pass,fail].map(state=>({id:state.job.id,kind:state.job.kind,status:state.job.status})),
      pass:pass.job.verification,fail:fail.job.verification,cli:cli.record.verification,samples:pass.job.control.samples,sessions,originalAuthorFilesUnchanged:true,addedAuthorFiles,savedDocumentId:authored.id,savedSourceVersion:authored.version,
      fullArchiveStableIdentityAndBytes:true,archive:{sha256:await fileHash(archive),authorFileCount:Object.keys(expectedAuthorData).length,authorManifestSha256:hash(JSON.stringify(expectedAuthorData)),rootReadmeOutsideArchive:true},
      cliAcceptedSavedWrapper:true,frozenGeneratedProjectByteIdentical:true,sessionProjectRemoved:true});
    await service.close();
  }
  assert.deepEqual(inputs[0].samples,inputs[1].samples);
  report.counts={backends:2,builds:2,offlineRuntimeSessions:6,servicePasses:2,serviceAssertionFailures:2,cliPasses:2};
  const context=vm.createContext({});const modules=new Map();
  function load(relative){
    assert.equal(relative,path.posix.normalize(relative));
    assert.ok(/^(?:engine\/|vendor\/yaml\/)/.test(relative)&&/\.(?:mjs|js)$/.test(relative)
      &&!/[\\\0?#]/.test(relative),'Only prepared engine and YAML modules may enter the VM');
    if(!modules.has(relative))modules.set(relative,fs.readFile(path.join(mobile,relative),'utf8')
      .then(source=>new vm.SourceTextModule(source,{context,identifier:relative})));
    return modules.get(relative);
  }
  function linker(specifier,referencingModule){
    assert.ok(typeof specifier==='string'&&!/[\\\0?#]/.test(specifier)
      &&(specifier.startsWith('./')||specifier.startsWith('../')||specifier.startsWith('/engine/')||specifier.startsWith('/vendor/yaml/')),
    'No bare, host, network or escaped imports');
    const relative=path.posix.normalize(specifier.startsWith('/')?specifier.slice(1)
      :path.posix.join(path.posix.dirname(referencingModule.identifier),specifier));
    return load(relative);
  }
  // Construct/cache only in the linker. Node links the graph, including YAML
  // cycles, once from this entry rather than recursively linking dependencies.
  const entryModules=['engine/runtime-verification-case.mjs','engine/runtime-case-document.mjs'];
  const entry=new vm.SourceTextModule(entryModules.map(file=>`import '/${file}';`).join('\n'),{context,identifier:'portable-case-entry'});
  await entry.link(linker);await entry.evaluate();
  const module=await load(entryModules[0]),documentsModule=await load(entryModules[1]);
  const valueInVm=value=>{context.inputJson=JSON.stringify(value);return vm.runInContext('JSON.parse(inputJson)',context);};
  let accepted=0,rejected=0;
  for(const input of inputs){const plan=valueInVm(input.plan), samples=valueInVm(input.samples);
    const wrapper={format:'viento-runtime-case-document',schemaVersion:1,sceneObjectId:sceneId,case:input.definition};
    const inspected=documentsModule.namespace.inspectRuntimeCaseDocument(input.caseText);assert.equal(inspected.recognized,true);assert.equal(inspected.ok,true);assert.deepEqual(plain(inspected.value),wrapper);accepted++;
    assert.deepEqual(plain(documentsModule.namespace.validateRuntimeCaseDocument(valueInVm(wrapper))),wrapper);accepted++;
    assert.deepEqual(plain(documentsModule.namespace.validateRuntimeCaseDocumentPlan(plan,valueInVm(wrapper))),wrapper);accepted++;
    assert.throws(()=>documentsModule.namespace.validateRuntimeCaseDocumentPlan(plan,valueInVm({...wrapper,sceneObjectId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'})));rejected++;
    assert.deepEqual(plain(module.namespace.validateRuntimeCase(valueInVm(input.definition))),input.definition);accepted++;
    assert.deepEqual(plain(module.namespace.evaluateRuntimeCase(plan,valueInVm(input.definition),samples,valueInVm({complete:true}))),input.pass);accepted++;
    assert.deepEqual(plain(module.namespace.evaluateRuntimeCase(plan,valueInVm(input.wrong),samples,valueInVm({complete:true}))),input.fail);accepted++;
    assert.equal(module.namespace.evaluateRuntimeCase(plan,valueInVm(input.definition),valueInVm(input.samples.slice(0,1)),valueInVm({complete:false})).status,'incomplete');accepted++;
  }
  for(const bad of [{...plain(definition),tool:'/private'}, {...plain(definition),checks:[]},{...plain(definition),checks:[{...plain(definition.checks[0]),stepIndex:2}]},{...plain(definition),checks:[{...plain(definition.checks[0]),position:{value:[220,220],tolerance:-1}}]}]) {
    assert.throws(()=>module.namespace.validateRuntimeCase(valueInVm(bad)));rejected++;
  }
  assert.equal(vm.runInContext('[typeof process,typeof require,typeof document,typeof fetch,typeof Buffer].join(",")',context),'undefined,undefined,undefined,undefined,undefined');
  report.mobileChecks={entryModuleCount:entryModules.length,entryModules,moduleCount:modules.size,modules:[...modules.keys()].sort(),acceptedCases:accepted,rejectedCases:rejected,noNodeDomOrNetworkGlobals:true,desktopSamplesOnly:true,androidExecutionClaimed:false};report.ok=true;
} finally {await Promise.allSettled(services.map(s=>s.close()));await fs.rm(temporary,{recursive:true,force:true});}
for(const artifact of Object.values(report.artifacts))for(const [file,expected]of Object.entries(artifact.hashes)){
  assert.equal(await fileHash(path.join(root,file)),expected.sourceSha256,`Source changed during prepared acceptance: ${file}`);
}
assert.equal(await fileHash(fileURLToPath(import.meta.url)),report.proofSourceSha256,'Proof source changed during acceptance');
assert.equal(await fileHash(archiveTool),report.nativeArchive.sha256,'Native archive helper changed during acceptance');
report.sourceHashesStayedStable=true;
report.temporaryFixtureAndCacheRemoved=true;
await fs.writeFile(path.join(evidence,'packaged-resources.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:report.ok,artifacts:Object.fromEntries(Object.entries(report.artifacts).map(([key,value])=>[key,{manifestFileCount:value.manifestFileCount,checkedSourceFiles:value.checkedSourceFiles}])),counts:report.counts,mobile:report.mobileChecks}));

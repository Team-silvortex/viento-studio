import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = path.dirname(fileURLToPath(import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const fileSha = async file => sha(await fs.readFile(file));
const json = value => JSON.stringify(value, null, 2) + '\n';
const rewrite = source => source.replaceAll("from 'yaml'", "from '/vendor/yaml/index.js'")
  .replaceAll("from '../node_modules/yaml/browser/index.js'", "from '/vendor/yaml/index.js'");
const nodeSha = '89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7';
assert.equal(process.version, 'v24.20.0'); assert.equal(await fileSha(process.execPath), nodeSha);
const report = { startedAt: new Date().toISOString(), schemaVersion: 1,
  scope: 'Actual prepared desktop/mobile copies: complete byte inventories, portable metadata validation, copied desktop persistent-catalog/service recovery, and explicit mobile rejection of backend host actions. No tool/build process, installation, Android device, GUI or foreign-platform acceptance here.',
  vmScope: 'Standard Node VM without Node/DOM/network globals proves portability of copied pure metadata code; it is not a security sandbox for hostile code.',
  embeddedNode: { version: process.version, sha256: nodeSha }, proofSourceSha256: await fileSha(fileURLToPath(import.meta.url)),
  artifacts: {}, portable: {}, desktopCliChecks: [], sourceHashes: {} };
report.version = (await fs.readFile(path.join(root, 'VERSION'), 'utf8')).trim();
assert.match(report.version, /^\d+\.\d+\.\d+$/);

async function inventory(directory, filter = () => true) {
  const entries = {};
  async function visit(relative) {
    const location = path.join(directory, relative);
    for (const entry of await fs.readdir(location, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (!filter(name, entry)) continue;
      if (entry.isDirectory()) await visit(name);
      else {
        assert.ok(entry.isFile(), `Only regular files may enter inventory: ${directory}/${name}`);
        const bytes = await fs.readFile(path.join(directory, name));
        const signature = bytes.length >= 4 ? bytes.readUInt32BE(0) : null;
        const native = [0x7f454c46,0xcafebabe,0xfeedface,0xcefaedfe,0xfeedfacf,0xcffaedfe].includes(signature)
          || bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;
        entries[name] = { bytes: bytes.length, sha256: sha(bytes), ...(native ? { nativeExecutable: true } : {}) };
      }
    }
  }
  await visit(''); return Object.fromEntries(Object.entries(entries).sort(([a],[b]) => a.localeCompare(b,'en')));
}
const source = async relative => {
  const bytes = await fs.readFile(path.join(root, relative));
  if (Object.hasOwn(report.sourceHashes, relative)) assert.equal(report.sourceHashes[relative], sha(bytes), `Source changed while mapping: ${relative}`);
  report.sourceHashes[relative] = sha(bytes); return bytes;
};
async function expectedTree(prefix, filter = () => true, transform = null) {
  const files = await inventory(path.join(root,prefix), filter), out = {};
  for (const name of Object.keys(files)) {
    const origin = `${prefix}/${name}`, bytes = await source(origin), expected = transform ? transform(origin, bytes) : bytes;
    out[origin] = { source: origin, sourceSha256: sha(bytes), expectedSha256: sha(expected), transformation: bytes.equals(expected) ? null : 'local YAML import rewrite' };
  }
  return out;
}
const desktopExpected = {}, mobileExpected = {};
for (const prefix of ['engine','scripts','web','schemas']) Object.assign(desktopExpected, await expectedTree(prefix,
  (name, entry) => !entry.name.startsWith('.') && !(prefix === 'scripts' && name === 'tests') && !(prefix === 'web' && name === 'data')));
const lock = JSON.parse(await source('package-lock.json'));
for (const [relative, dependency] of Object.entries(lock.packages)) if (relative.startsWith('node_modules/') && !dependency.dev) {
  assert.equal(dependency.link, undefined); assert.ok(!relative.split('/').includes('..'));
  Object.assign(desktopExpected, await expectedTree(relative));
}
async function mapped(out, name, origin, transform = value => value, label = null) {
  const bytes = await source(origin), expected = transform(bytes);
  out[name] = { source: origin, sourceSha256: sha(bytes), expectedSha256: sha(expected), transformation: label };
}
await mapped(desktopExpected, 'VERSION', 'VERSION'); await mapped(desktopExpected, 'favicon.ico', 'favicon.ico');
await mapped(desktopExpected, 'package.json', 'VERSION', () => Buffer.from(JSON.stringify({ private:true,type:'module',version:report.version,displayVersion:report.version })), 'generated package metadata');
const runtime = JSON.parse(await source('desktop/node-runtime.json'));
await mapped(desktopExpected, 'NODE-LICENSE', `desktop/.cache/${runtime.version}-LICENSE`);
assert.equal(desktopExpected['NODE-LICENSE'].expectedSha256, runtime.licenseSha256);
for (const prefix of ['engine','web']) Object.assign(mobileExpected, await expectedTree(prefix,
  (name, entry) => !entry.name.startsWith('.') && !(prefix === 'web' && name === 'data') && !name.endsWith('.md'),
  (origin, bytes) => origin.startsWith('engine/') && origin.endsWith('.mjs') ? Buffer.from(rewrite(bytes.toString())) : bytes));
for (const name of Object.keys(await inventory(path.join(root,'node_modules/yaml/browser')))) await mapped(mobileExpected,`vendor/yaml/${name}`,`node_modules/yaml/browser/${name}`);
await mapped(mobileExpected,'vendor/yaml/LICENSE','node_modules/yaml/LICENSE');
for (const name of ['doc-api-contract.mjs','media-format.mjs','document-values.mjs']) await mapped(mobileExpected,`scripts/lib/${name}`,`scripts/lib/${name}`);
for (const name of ['platform.mjs','library.js','editor.js','drafts.mjs','mobile.css']) await mapped(mobileExpected,`mobile/${name}`,`mobile/${name}`);
await mapped(mobileExpected,'index.html','mobile/index.html', bytes => Buffer.from(bytes.toString().replaceAll('__VIENTO_VERSION__',report.version)), 'release version substitution');
await mapped(mobileExpected,'editor.html','web/index.html', bytes => Buffer.from(bytes.toString().replace(/<title>.*?<\/title>/,'<title>Viento Studio</title>')
  .replace('</head>','<link rel="stylesheet" href="/mobile/mobile.css" /></head>').replace('<body>','<body class="mobile-host">')
  .replace('<script type="module" src="/web/app.js"></script>','<script type="module" src="/mobile/editor.js"></script>')
  .replace('<script type="module" src="/web/modules/desktop-bridge.js"></script>','')), 'mobile shell entry');
await mapped(mobileExpected,'favicon.ico','favicon.ico');
for (const [name,expected] of [['desktop/resources',desktopExpected],['mobile/dist',mobileExpected]]) {
  const actual = await inventory(path.join(root,name));
  assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort(),`Prepared files missing or extra: ${name}`);
  for (const [file,value] of Object.entries(actual)) assert.equal(value.sha256,expected[file].expectedSha256,`Prepared byte mismatch: ${name}/${file}`);
  assert.ok(!Object.values(actual).some(value => value.nativeExecutable));
  assert.ok(!Object.keys(actual).some(file => /^(?:examples|works|workspaces|crates)\//.test(file) || file.startsWith('web/data/') || file.startsWith('scripts/tests/')));
  if (name === 'mobile/dist') assert.ok(!Object.keys(actual).some(file => file.startsWith('scripts/adapters/') || file.startsWith('scripts/backends/') || file === 'scripts/lib/project-build-service.mjs' || file.startsWith('node_modules/')));
  report.artifacts[name] = { manifestFileCount:Object.keys(actual).length, manifestBytes:Object.values(actual).reduce((sum,item)=>sum+item.bytes,0), manifestSha256:sha(JSON.stringify(actual)),
    manifest:actual,fullSourceCopyCount:Object.keys(expected).length,fullSourceCopySha256:sha(JSON.stringify(expected)),fullSourceCopies:expected };
}
{
  const actual = await inventory(path.join(root,'desktop/ui')), expected = {};
  assert.deepEqual(Object.keys(actual).filter(name=>name.startsWith('i18n/')).sort(),Object.keys(await inventory(path.join(root,'web/i18n'))).map(name=>`i18n/${name}`).sort());
  for (const [file,value] of Object.entries(actual)) {
    const origin = file.startsWith('i18n/') ? `web/${file}` : `desktop/ui/${file}`;
    await mapped(expected,file,origin); assert.equal(value.sha256,expected[file].expectedSha256);
  }
  report.artifacts['desktop/ui'] = { manifestFileCount:Object.keys(actual).length,manifestBytes:Object.values(actual).reduce((sum,item)=>sum+item.bytes,0),manifestSha256:sha(JSON.stringify(actual)),
    manifest:actual,fullSourceCopyCount:Object.keys(expected).length,fullSourceCopySha256:sha(JSON.stringify(expected)),fullSourceCopies:expected };
}
const historical = JSON.parse(await fs.readFile(path.join(evidence,'historical-baseline.json')));
for (const [file,digest] of Object.entries(historical)) assert.equal(await fileSha(path.join(root,file)),digest,`Historical report changed: ${file}`);
report.historicalPreservation = { files:Object.keys(historical).length,sha256:await fileSha(path.join(evidence,'historical-baseline.json')),allMatch:true };
const previous = JSON.parse(await fs.readFile(path.join(evidence,'previous-source-hashes.json')));
report.previousSourceManifest = { files:Object.keys(previous).length,sha256:await fileSha(path.join(evidence,'previous-source-hashes.json')),
  scope:'Previous source manifest is immutable evidence; current equality is checked against the actual frozen copies above, including the new host-only recovery catalog and its service/UI wiring.' };

const realRoot = path.join(root,'docs/test-results/backend-project-management/real-backends-final');
const real = JSON.parse(await fs.readFile(path.join(realRoot,'results.json'))); assert.equal(real.ok,true); assert.equal(real.cases.length,4);
const manifests = [];
for (const item of real.cases) {
  const bytes = await fs.readFile(path.join(realRoot,`${item.name}-manifest.json`)); assert.equal(sha(bytes),item.initialInspection.manifestSha256);
  manifests.push({name:item.name,content:bytes.toString(),sha256:sha(bytes)});
}
report.realManifestEvidence = {scope:'Immutable prior actual backend descriptions validate with both current copied pure modules; new catalog code is exercised separately on desktop.',
  resultSha256:await fileSha(path.join(realRoot,'results.json')),manifests:manifests.map(({name,sha256})=>({name,sha256}))};
for (const base of ['desktop/resources','mobile/dist']) {
  const context = vm.createContext({TextEncoder}), code = await fs.readFile(path.join(root,base,'engine/backend-project.mjs'),'utf8');
  const module = new vm.SourceTextModule(code,{context,identifier:`${base}/engine/backend-project.mjs`});
  await module.link(()=>assert.fail('Portable metadata has no host imports.')); await module.evaluate();
  context.validate=module.namespace.validateBackendProjectManifest;context.summarize=module.namespace.summarizeBackendProject;
  const checks=[];
  for (const item of manifests) {
    context.input=item.content;
    const summary=JSON.parse(vm.runInContext('JSON.stringify(summarize(validate(JSON.parse(input))))',context));
    assert.equal(summary.backendId,JSON.parse(item.content).backend.id); assert.equal(summary.buildId,JSON.parse(item.content).buildId);
    checks.push({id:`actual-${item.name}-portable-description`,ok:true,manifestSha256:item.sha256,summary});
  }
  assert.equal(vm.runInContext('[typeof process,typeof require,typeof Buffer,typeof document,typeof window,typeof fetch].join(",")',context),Array(6).fill('undefined').join(','));
  report.portable[base]={moduleSha256:sha(code),noHostImports:true,noNodeDomNetworkGlobals:true,checks};
}
assert.deepEqual(report.portable['desktop/resources'].checks,report.portable['mobile/dist'].checks);

const disposable=await fs.mkdtemp(path.join(os.tmpdir(),'viento-prepared-catalog-proof-'));
report.desktopCatalogChecks=[];
try {
  const copied=relative=>import(pathToFileURL(path.join(root,'desktop/resources',relative)).href);
  const {createProjectBuildService}=await copied('scripts/lib/project-build-service.mjs');
  const {createExecutionBackendRegistry}=await copied('scripts/adapters/node-execution-backends.mjs');
  const {GODOT4_EXECUTION_ADAPTER}=await copied('scripts/backends/godot4-adapter.mjs');
  const {buildHash}=await copied('scripts/adapters/node-build-snapshot.mjs');
  const {createBackendProjectCatalog,assertCatalogProject,BACKEND_PROJECT_CATALOG_FILE}=await copied('scripts/adapters/node-backend-project-catalog.mjs');
  const {runProjectBuildCommand}=await copied('scripts/project-build.mjs');
  const author=path.join(disposable,'author'),cacheRoot=path.join(disposable,'cache'),services=[];
  await fs.cp(path.join(root,'examples/scene2d'),author,{recursive:true}); const authorBefore=await inventory(author);
  let toolIdentifications=0,enginePhaseFixtures=0;
  const backendRegistry=createExecutionBackendRegistry([{...GODOT4_EXECUTION_ADAPTER,
    async identify(executable){toolIdentifications++;return{executable,version:'4.7.2.stable.fixture',sha256:buildHash('copied host lifecycle fixture'),platform:process.platform,arch:process.arch};},
    async executePhase(){enginePhaseFixtures++;return{status:'succeeded',exitCode:0,stdout:'',stderr:''};},
  }]);
  const open=()=>{const service=createProjectBuildService(author,{cacheRoot,tool:process.execPath,backendRegistry});services.push(service);return service;};
  async function build(service){
    await service.command({action:'build',sceneId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'});
    for(let index=0;index<1000;index++){
      const state=await service.status();if(state.job?.status!=='running'){
        assert.equal(state.job.status,'succeeded',JSON.stringify(state));const project=state.projects.find(row=>row.id===state.latestBuild.id);
        const detail=await service.command({action:'inspect-project',buildId:project.id});return{state,project,detail};
      }await new Promise(resolve=>setTimeout(resolve,5));
    }assert.fail('Copied host build did not settle.');
  }
  try {
    const owner=open(),first=await build(owner),second=await build(owner);await owner.close();
    const namespace=path.dirname(first.detail.buildDirectory),index=path.join(namespace,BACKEND_PROJECT_CATALOG_FILE),indexBefore=await fs.readFile(index);
    report.desktopCatalogChecks.push({id:'copied-host-successful-writes-persist-two-exact-catalog-rows',ok:true,entries:2});
    const orphan=path.join(namespace,randomUUID());await fs.mkdir(orphan);await fs.writeFile(path.join(orphan,'notes'),'unindexed owner');
    await fs.rename(author,path.join(disposable,'author-offline'));
    const service=open(),state=await service.status();assert.equal(state.latestBuild,null);assert.equal(state.projects.length,2);
    assert.ok(state.projects.every(row=>row.origin==='previous-session'&&row.availability==='unchecked'&&row.retention==='preserved'));
    assert.ok(state.scenes.some(scene=>scene.id===first.project.sceneId&&scene.frozenOnly===true));
    report.desktopCatalogChecks.push({id:'copied-host-restart-offline-lists-only-recorded-unchecked-preserved-projects',ok:true});
    const counts={toolIdentifications,enginePhaseFixtures};
    const inspected=await service.command({action:'inspect-project',buildId:first.project.id});assert.equal(inspected.project.buildId,first.project.id);
    assert.equal((await service.status()).latestBuild,null);
    report.desktopCatalogChecks.push({id:'copied-host-inspection-remains-read-only-and-does-not-select-runtime-project',ok:true});
    const selected=await service.command({action:'select-project',buildId:first.project.id});assert.equal(selected.latestBuild.id,first.project.id);
    assert.equal(selected.projects.find(row=>row.id===first.project.id).availability,'verified');
    assert.deepEqual({toolIdentifications,enginePhaseFixtures},counts);assert.deepEqual(await fs.readFile(index),indexBefore);
    report.desktopCatalogChecks.push({id:'copied-host-explicit-recovery-validates-frozen-project-without-starting-tools-or-rewriting-index',ok:true});
    const catalog=createBackendProjectCatalog({namespace,backendId:'org.viento.godot4'}),entry=(await catalog.read()).entries.find(item=>item.buildId===first.project.id);
    const guard=await assertCatalogProject(entry);assert.equal(guard.buildDirectory,first.detail.buildDirectory);
    await assert.rejects(assertCatalogProject(JSON.parse(JSON.stringify(entry))),{errorCode:'backend_project_catalog_invalid'});
    assert.equal(Object.hasOwn(entry,'retentionPin'),false);assert.equal(Object.hasOwn(entry,'files'),false);
    report.desktopCatalogChecks.push({id:'copied-catalog-branded-project-guard-cannot-be-reconstructed-from-json-or-used-as-deletion-ledger',ok:true});
    const cliBefore=await inventory(first.detail.buildDirectory),child=await promisify(execFile)(process.execPath,
      [path.join(root,'desktop/resources/scripts/project-build.mjs'),'--command','inspect','--build',first.detail.buildDirectory],{cwd:root,timeout:10000,maxBuffer:4*1024*1024,
        env:{...process.env,VIENTO_EXECUTION_BACKEND:'org.invalid.host',VIENTO_GODOT_BIN:path.join(disposable,'absent-tool')}});
    const cli=JSON.parse(child.stdout);assert.equal(cli.ok,true);assert.equal(cli.project.buildId,first.project.id);assert.deepEqual(await inventory(first.detail.buildDirectory),cliBefore);
    report.desktopCliChecks.push({id:'actual-copied-cli-inspects-host-catalog-output-with-source-offline-and-invalid-host-config',ok:true});
    await assert.rejects(runProjectBuildCommand(['--command','inspect','--build',first.detail.buildDirectory,'--backend','org.viento.bevy']));
    assert.deepEqual(await inventory(first.detail.buildDirectory),cliBefore);
    report.desktopCliChecks.push({id:'copied-cli-refuses-foreign-backend-without-changing-catalog-or-project',ok:true});
    const manifest=path.join(first.detail.buildDirectory,'backend-project.json'),bytes=await fs.readFile(manifest);await fs.appendFile(manifest,'\n');
    await assert.rejects(service.command({action:'select-project',buildId:first.project.id}),{errorCode:'backend_project_changed'});
    assert.deepEqual({toolIdentifications,enginePhaseFixtures},counts);assert.deepEqual(await fs.readFile(index),indexBefore);await fs.writeFile(manifest,bytes);
    report.desktopCatalogChecks.push({id:'copied-host-reselection-rejects-tampered-restored-manifest-without-tools-or-repair',ok:true});
    await service.close();const next=open();assert.equal((await next.status()).latestBuild,null);
    assert.deepEqual(await inventory(path.join(disposable,'author-offline')),authorBefore);assert.equal(await fs.readFile(path.join(orphan,'notes'),'utf8'),'unindexed owner');
    report.desktopCatalogChecks.push({id:'copied-host-new-restart-does-not-auto-select-or-adopt-or-delete-unindexed-files',ok:true});
    report.desktopHostScope={actualToolProcessesStarted:0,injectedToolIdentifications:toolIdentifications,injectedEnginePhases:enginePhaseFixtures,
      scope:'Actual copied service, snapshot/generator, catalog, inspection and CLI execute. Build tool phases are injected fixtures; no actual Godot process or engine runtime is claimed.'};
  } finally {await Promise.all(services.map(service=>service.close()));}
} finally {await fs.rm(disposable,{recursive:true,force:true});}

const mobile=path.join(root,'mobile/dist'),context=vm.createContext({TextEncoder,TextDecoder,URL,Response,Headers,AbortController}),modules=new Map();
function load(relative){
  assert.equal(relative,path.posix.normalize(relative));assert.ok(!/[\\\0?#]/.test(relative));
  assert.ok(relative==='mobile/platform.mjs'||relative.startsWith('engine/')&&relative.endsWith('.mjs')||relative.startsWith('vendor/yaml/')&&relative.endsWith('.js')
    ||['scripts/lib/doc-api-contract.mjs','scripts/lib/media-format.mjs','scripts/lib/document-values.mjs'].includes(relative));
  if(!modules.has(relative))modules.set(relative,fs.readFile(path.join(mobile,relative),'utf8').then(code=>new vm.SourceTextModule(code,{context,identifier:relative})));return modules.get(relative);
}
const entry=new vm.SourceTextModule("export {createMobilePlatform} from '/mobile/platform.mjs';",{context,identifier:'copied-mobile-catalog-unsupported-entry'});
await entry.link((specifier,referencing)=>{
  assert.ok(specifier.startsWith('./')||specifier.startsWith('../')||specifier.startsWith('/vendor/yaml/')||specifier.startsWith('/mobile/'));
  return load(path.posix.normalize(specifier.startsWith('/')?specifier.slice(1):path.posix.join(path.posix.dirname(referencing.identifier),specifier)));
});await entry.evaluate();context.createPlatform=entry.namespace.createMobilePlatform;
context.contextJSON=JSON.stringify({manifest:JSON.parse(await fs.readFile(path.join(root,'examples/scene2d/workspace.json'))),defaults:{},documents:[]});
vm.runInContext(`globalThis.invocations=[];globalThis.platform=createPlatform({workspaceId:'11111111-1111-4111-8111-111111111114',invoke:async(command,args)=>{
 if(command!=='mobile_storage'||args.action!=='context')throw new Error('Only a descriptive storage-context fixture is available.');invocations.push(args.action);return JSON.parse(contextJSON);}});`,context);
const capabilityResponse=await vm.runInContext("platform.request('/api/capabilities')",context),capabilities=await capabilityResponse.json();
assert.equal(capabilityResponse.status,200);assert.equal(capabilities.projectBuild,false);assert.equal(capabilities.capabilities.project,false);
report.mobileUnsupportedChecks=[{id:'copied-mobile-advertises-no-project-build-host-capability',ok:true}];
for(const action of ['inspect-project','select-project','run']){
  context.action=action;
  const response=await vm.runInContext("platform.request('/api/project-build',{method:'POST',body:JSON.stringify({action,buildId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',mode:'headless'})})",context);
  assert.equal(response.status,501);assert.equal((await response.json()).ok,false);
  report.mobileUnsupportedChecks.push({id:`copied-mobile-rejects-${action}-without-backend-host-dispatch`,ok:true});
}
assert.equal(vm.runInContext('[typeof process,typeof require,typeof Buffer,typeof document,typeof window,typeof fetch].join(",")',context),Array(6).fill('undefined').join(','));
assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(invocations)',context)),Array(4).fill('context'));
report.mobileModuleGraph={moduleCount:modules.size,modules:[...modules.keys()].sort(),noNodeBackendImports:true,noNodeDomNetworkGlobals:true,
  scope:'Copied mobile platform and pure module graph execute with a storage-context fixture; backend host actions return unsupported. No device or native storage execution acceptance.'};

for(const [name,artifact]of Object.entries(report.artifacts))assert.deepEqual(await inventory(path.join(root,name)),artifact.manifest,`Copy changed during proof: ${name}`);
for(const[file,digest]of Object.entries(report.sourceHashes))assert.equal(await fileSha(path.join(root,file)),digest,`Source changed during proof: ${file}`);
for(const[file,digest]of Object.entries(historical))assert.equal(await fileSha(path.join(root,file)),digest);
for(const name of ['core-source-hashes.json','frozen-backend-baseline.json','protected-scene-slices.json']){
 const manifest=JSON.parse(await fs.readFile(path.join(evidence,name)));for(const[file,digest]of Object.entries(manifest))assert.equal(await fileSha(path.join(root,file)),digest);
}
report.copiedCore={bytes:(await fs.stat(path.join(root,'engine/studio-core.wasm'))).size,sha256:await fileSha(path.join(root,'engine/studio-core.wasm')),
  scope:'WASM bytes match both prepared copies; actual copied desktop snapshot code initializes core. This slice changes no Rust or engine contract.'};
report.sourceHashes=Object.fromEntries(Object.entries(report.sourceHashes).sort(([a],[b])=>a.localeCompare(b,'en')));report.sourceHashCount=Object.keys(report.sourceHashes).length;
report.counts={desktopPortableGroups:report.portable['desktop/resources'].checks.length,mobilePortableGroups:report.portable['mobile/dist'].checks.length,
 desktopCatalogGroups:report.desktopCatalogChecks.length,desktopCliGroups:report.desktopCliChecks.length,mobileUnsupportedGroups:report.mobileUnsupportedChecks.length,
 totalGroups:report.portable['desktop/resources'].checks.length+report.portable['mobile/dist'].checks.length+report.desktopCatalogChecks.length+report.desktopCliChecks.length+report.mobileUnsupportedChecks.length};
assert.equal(await fileSha(fileURLToPath(import.meta.url)),report.proofSourceSha256);report.ok=true;report.sourceAndCopiesStableDuringProof=true;report.finishedAt=new Date().toISOString();
await fs.writeFile(path.join(evidence,'packaged-resources-final.json'),json(report),{flag:'wx'});
console.log(JSON.stringify({ok:true,counts:report.counts,artifacts:Object.fromEntries(Object.entries(report.artifacts).map(([name,item])=>[name,{files:item.manifestFileCount,bytes:item.manifestBytes,manifestSha256:item.manifestSha256}])),sourceHashCount:report.sourceHashCount,history:report.historicalPreservation.files,mobileModuleCount:modules.size}));

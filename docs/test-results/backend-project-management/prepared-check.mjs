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
  scope: 'Actual prepared desktop/mobile copies: complete byte inventories, portable metadata validation, and copied desktop CLI inspection of a disposable output. No tool/build process, installation, Android device, GUI or foreign-platform acceptance here.',
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
  scope:'Previous source manifest is immutable evidence; current equality is checked against the actual frozen copies above, including the explicitly changed Godot adapter.' };

const realRoot = path.join(evidence,'real-backends-final');
const real = JSON.parse(await fs.readFile(path.join(realRoot,'results.json'))); assert.equal(real.ok,true); assert.equal(real.cases.length,4);
const fixtures = [];
for (const item of real.cases) {
  const filename = `${item.name}-manifest.json`, bytes = await fs.readFile(path.join(realRoot,filename));
  assert.equal(sha(bytes),item.initialInspection.manifestSha256); fixtures.push({ name:item.name,sha256:sha(bytes),content:bytes.toString(),expected:item });
}
report.realManifestEvidence = { resultSha256:await fileSha(path.join(realRoot,'results.json')),manifests:fixtures.map(({name,sha256})=>({name,sha256})) };
for (const base of ['desktop/resources','mobile/dist']) {
  const relative = 'engine/backend-project.mjs', modulePath = path.join(root,base,relative), code = await fs.readFile(modulePath,'utf8');
  const context = vm.createContext({ TextEncoder });
  const module = new vm.SourceTextModule(code,{ context,identifier:`${base}/${relative}` });
  await module.link(() => { assert.fail('Pure project metadata must not import a host or dependency module.'); }); await module.evaluate();
  context.validate = module.namespace.validateBackendProjectManifest; context.summarize = module.namespace.summarizeBackendProject;
  const checks = [];
  for (const fixture of fixtures) {
    context.input = fixture.content;
    const result = JSON.parse(vm.runInContext(`JSON.stringify((()=>{const raw=JSON.parse(input);const value=validate(raw);const before=JSON.stringify(value);raw.files[0].sha256='0'.repeat(64);return{summary:summarize(value),detached:before===JSON.stringify(value),rootFrozen:Object.isFrozen(value),filesFrozen:Object.isFrozen(value.files)&&value.files.every(Object.isFrozen)};})())`,context));
    assert.deepEqual(result.summary,{buildId:fixture.expected.buildId,snapshotId:fixture.expected.snapshotId,backendId:fixture.expected.backendId,
      sceneId:JSON.parse(fixture.content).source.sceneId,sourcePath:JSON.parse(fixture.content).source.sourcePath,kind:fixture.expected.kind,
      entry:JSON.parse(fixture.content).project.entry,fileCount:fixture.expected.files,resourceCount:fixture.expected.resources,dependencyCount:fixture.expected.dependencies,
      totalBytes:JSON.parse(fixture.content).files.reduce((sum,item)=>sum+item.size,0)});
    assert.equal(result.detached,true); assert.equal(result.rootFrozen,true); assert.equal(result.filesFrozen,true);
    checks.push({id:`actual-${fixture.name}-detached-frozen-description`,ok:true,manifestSha256:fixture.sha256,summary:result.summary});
  }
  context.input = fixtures[0].content;
  const mutations = [
    ['foreign-adapter-owner', `value.executionAdapter.id='org.viento.foreign'`],
    ['unsafe-generated-path', `value.files[0].path='project/../escape'`],
    ['duplicate-file-target', `value.files.push({...value.files[0]})`],
    ['resource-byte-mismatch', `value.resources[0].sha256='0'.repeat(64)`],
    ['forged-scene-dependency', `value.dependencies.find(item=>item.role==='scene').sourceRevision='sha256:'+'0'.repeat(64)`],
    ['missing-evidence', `value.evidence.pop()`],
    ['execution-authority-field', `value.command='run untrusted tool'`],
    ['cleanup-authority-field', `value.lifecycle.deleteDirectory=true`],
  ];
  for (const [id,mutation] of mutations) {
    const error = vm.runInContext(`(()=>{const value=JSON.parse(input);${mutation};try{validate(value);return null;}catch(error){return error.errorCode;}})()`,context);
    assert.equal(error,'backend_project_invalid',id); checks.push({id,ok:true,rejected:true});
  }
  assert.equal(vm.runInContext('[typeof process,typeof require,typeof Buffer,typeof document,typeof window,typeof fetch].join(",")',context),Array(6).fill('undefined').join(','));
  checks.push({id:'no-node-dom-network-globals',ok:true});
  report.portable[base] = {modulePath:`${base}/${relative}`,moduleSha256:sha(code),importCount:module.dependencySpecifiers.length,noHostImports:true,noNodeDomNetworkGlobals:true,checks,acceptedManifests:4,rejectedMutations:8};
}
assert.deepEqual(report.portable['desktop/resources'].checks,report.portable['mobile/dist'].checks);

// Generate a small disposable frozen output with copied host modules. Its
// tool identity is data only; no identify/build/run tool is invoked.
const disposable = await fs.mkdtemp(path.join(os.tmpdir(),'viento-prepared-project-proof-'));
report.desktopCliFixture = {scope:'Copied Bevy generator and snapshot host materialize a disposable output; the copied CLI only inspects it. This is not real engine build/runtime acceptance.',toolProcessesStarted:0};
try {
  const copied = relative => import(pathToFileURL(path.join(root,'desktop/resources',relative)).href);
  const {captureBuildSnapshot,buildHash} = await copied('scripts/adapters/node-build-snapshot.mjs');
  const {createExecutionBackendRegistry,validateGeneratedExecutionProject,executionAdapterFingerprint} = await copied('scripts/adapters/node-execution-backends.mjs');
  const {createBackendProjectManifest} = await copied('scripts/adapters/node-backend-project.mjs');
  const {runProjectBuildCommand} = await copied('scripts/project-build.mjs');
  const author = path.join(disposable,'author'), directory = path.join(disposable,'output');
  await fs.cp(path.join(root,'examples/bevy-headless'),author,{recursive:true});
  const authorBefore = await inventory(author), captured = await captureBuildSnapshot(author,'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  assert.equal(captured.ok,true,JSON.stringify(captured.diagnostics));
  const adapter = createExecutionBackendRegistry().resolve('org.viento.bevy');
  const generated = validateGeneratedExecutionProject(adapter,captured.plan,await adapter.generate(captured.plan));
  const build = {format:'viento-build-record',schemaVersion:1,buildId:randomUUID(),snapshotId:captured.snapshotId,status:'succeeded',backend:generated.backend,
    executionAdapter:await executionAdapterFingerprint(adapter),tool:{version:'viento-bevy-runtime 0.3.0 bevy 0.19.1',sha256:buildHash('inspection fixture identity only'),platform:'linux',arch:'x64'},
    artifact:{...generated.artifact,entry:`project/${generated.artifact.entry}`,files:[]},diagnostics:[],phases:[]};
  await fs.mkdir(path.join(directory,'project'),{recursive:true});
  for (const resource of captured.plan.resources) generated.files.set(generated.resourceFiles.get(resource.id),captured.resources.get(resource.id));
  for (const [name,bytes] of generated.files) {
    const target = path.join(directory,'project',name); await fs.mkdir(path.dirname(target),{recursive:true}); await fs.writeFile(target,bytes,{flag:'wx'});
    build.artifact.files.push({path:name,size:bytes.byteLength,sha256:buildHash(bytes)});
  }
  for (const [name,value] of [['build.json',build],['snapshot.json',captured.snapshot],['source-map.json',generated.sourceMap]]) await fs.writeFile(path.join(directory,name),json(value),{flag:'wx'});
  const manifest = createBackendProjectManifest({build,snapshot:captured.snapshot,sourceMap:generated.sourceMap,generated});
  const manifestBytes = json(manifest); await fs.writeFile(path.join(directory,'backend-project.json'),manifestBytes,{flag:'wx'});
  assert.deepEqual(await inventory(author),authorBefore); await fs.rename(author,path.join(disposable,'author-offline'));
  const before = await inventory(directory), inspectArgs = ['--command','inspect','--build',directory];
  const result = await promisify(execFile)(process.execPath,[path.join(root,'desktop/resources/scripts/project-build.mjs'),...inspectArgs],{
    cwd:root,timeout:10000,maxBuffer:4*1024*1024,env:{...process.env,VIENTO_EXECUTION_BACKEND:'org.invalid.host',VIENTO_GODOT_PATH:path.join(disposable,'absent-godot'),VIENTO_BEVY_PATH:path.join(disposable,'absent-bevy')},
  });
  const dto = JSON.parse(result.stdout); assert.equal(dto.ok,true); assert.equal(dto.inspection.complete,true); assert.equal(dto.inspection.recorded,true); assert.deepEqual(dto.project,manifest);
  assert.deepEqual(await inventory(directory),before); report.desktopCliChecks.push({id:'copied-cli-recorded-offline-and-invalid-host-config-read-only',ok:true,manifestSha256:dto.inspection.manifestSha256});
  await fs.rm(path.join(directory,'backend-project.json'));
  const legacyBefore = await inventory(directory), legacy = await runProjectBuildCommand(inspectArgs); assert.equal(legacy.inspection.recorded,false); assert.equal(legacy.inspection.complete,true);
  assert.deepEqual(await inventory(directory),legacyBefore); report.desktopCliChecks.push({id:'copied-cli-legacy-description-without-adoption-or-author',ok:true});
  await fs.writeFile(path.join(directory,'backend-project.json'),manifestBytes,{flag:'wx'});
  await fs.mkdir(path.join(directory,'sessions')); await fs.symlink(path.join(disposable,'author-offline'),path.join(directory,'sessions','outside-tree'),'dir');
  const extraBefore = await inventory(path.join(directory,'project'));
  const extra = await runProjectBuildCommand(inspectArgs); assert.equal(extra.inspection.complete,false); assert.deepEqual(extra.inspection.extraPaths,[{path:'sessions',kind:'directory'}]);
  assert.deepEqual(await inventory(path.join(directory,'project')),extraBefore); report.desktopCliChecks.push({id:'copied-cli-unknown-session-not-traversed-or-owned',ok:true});
  await fs.rm(path.join(directory,'sessions'),{recursive:true,force:true});
  const metadata = path.join(directory,'source-map.json'), originalMap = await fs.readFile(metadata); await fs.appendFile(metadata,'\n');
  await assert.rejects(runProjectBuildCommand(inspectArgs),{errorCode:'backend_project_changed'}); assert.deepEqual(await fs.readFile(metadata),Buffer.concat([originalMap,Buffer.from('\n')])); await fs.writeFile(metadata,originalMap);
  report.desktopCliChecks.push({id:'copied-cli-exact-metadata-byte-tamper-rejected-no-repair',ok:true});
  const registered = path.join(directory,manifest.project.entry), originalFile = await fs.readFile(registered), outside = path.join(disposable,'outside.dat');
  await fs.writeFile(outside,'external owner'); await fs.rm(registered); await fs.symlink(outside,registered);
  await assert.rejects(runProjectBuildCommand(inspectArgs)); assert.equal(await fs.readFile(outside,'utf8'),'external owner'); assert.ok((await fs.lstat(registered)).isSymbolicLink());
  await fs.rm(registered); await fs.writeFile(registered,originalFile); report.desktopCliChecks.push({id:'copied-cli-registered-link-rejected-outside-preserved',ok:true});
  await assert.rejects(runProjectBuildCommand([...inspectArgs,'--root',path.join(disposable,'author-offline')]),{errorCode:'build_request_invalid'});
  await assert.rejects(runProjectBuildCommand([...inspectArgs,'--backend','org.viento.godot4']));
  assert.deepEqual(await inventory(directory),before); assert.deepEqual(await inventory(path.join(disposable,'author-offline')),authorBefore);
  report.desktopCliChecks.push({id:'copied-cli-foreign-backend-and-source-flags-rejected-without-write',ok:true});
  report.desktopCliFixture.copiedModulePaths = ['scripts/adapters/node-build-snapshot.mjs','scripts/adapters/node-execution-backends.mjs','scripts/adapters/node-backend-project.mjs','scripts/project-build.mjs'];
} finally { await fs.rm(disposable,{recursive:true,force:true}); }

for (const [name,artifact] of Object.entries(report.artifacts)) assert.deepEqual(await inventory(path.join(root,name)),artifact.manifest,`Prepared copy changed during proof: ${name}`);
for (const [file,digest] of Object.entries(report.sourceHashes)) assert.equal(await fileSha(path.join(root,file)),digest,`Source changed during proof: ${file}`);
for (const [file,digest] of Object.entries(historical)) assert.equal(await fileSha(path.join(root,file)),digest);
report.copiedCore = {bytes:(await fs.stat(path.join(root,'engine/studio-core.wasm'))).size,sha256:await fileSha(path.join(root,'engine/studio-core.wasm')),scope:'WASM bytes match both prepared environments; this metadata proof does not execute WASM.'};
report.sourceHashes = Object.fromEntries(Object.entries(report.sourceHashes).sort(([a],[b])=>a.localeCompare(b,'en')));
report.sourceHashCount = Object.keys(report.sourceHashes).length;
report.counts = {desktopPortableGroups:report.portable['desktop/resources'].checks.length,mobilePortableGroups:report.portable['mobile/dist'].checks.length,
  desktopCliGroups:report.desktopCliChecks.length,totalGroups:report.portable['desktop/resources'].checks.length+report.portable['mobile/dist'].checks.length+report.desktopCliChecks.length};
assert.equal(await fileSha(fileURLToPath(import.meta.url)),report.proofSourceSha256);
report.ok=true;report.sourceAndCopiesStableDuringProof=true;report.finishedAt=new Date().toISOString();
await fs.writeFile(path.join(evidence,'packaged-resources.json'),json(report),{flag:'wx'});
console.log(JSON.stringify({ok:true,counts:report.counts,artifacts:Object.fromEntries(Object.entries(report.artifacts).map(([name,item])=>[name,{files:item.manifestFileCount,bytes:item.manifestBytes,manifestSha256:item.manifestSha256}])),sourceHashCount:report.sourceHashCount,history:report.historicalPreservation.files,copiedCore:report.copiedCore}));

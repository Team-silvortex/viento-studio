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
  scope: 'Actual prepared desktop/mobile copies: complete inventories and actor-structure plus legacy placement/fragment portable rules using the actual rebuilt WASM. No installed application, Android device or engine execution acceptance.',
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
  scope:'Previous source manifest is immutable evidence; current equality is checked against the actual frozen copies above, including the new structure capability and source/UI wiring.' };

const example = JSON.parse(await fs.readFile(path.join(root,'examples/scene-composition/recipe.json')));
const { fixture, copy, revision } = await import('../scene-composition-placement-offset/boundary-cases.mjs');
const { runPlacementCases } = await import('../scene-composition-placement-offset/boundary-cases.mjs');
const { runInheritanceCases } = await import('../scene-composition-fragment-inheritance/boundary-cases.mjs');
const moduleFiles = ['engine/scene-composition-structure.mjs','engine/scene-composition-placement.mjs','engine/scene-composition-fragments.mjs',
  'engine/scene-composition.mjs','engine/scene-structure.mjs','engine/studio-core.mjs','engine/json-source.mjs'];
async function cases(api) {
  assert.equal(api.supportsStudioCoreCompositionStructure(),true);
  const checks = [], parse = text => JSON.parse(text.replace(/^\uFEFF/,''));
  const actor = { key:'newActor',objectId:example.fragments[0].actors[0].objectId,groupKey:'companions',position:[240.5,100.25],size:[32,32],color:'#aabbcc',speed:0,controls:'none' };
  const edit = {action:'add',fragmentId:'party',actor,instances:example.placements.map((p,i)=>({placementId:p.placementId,instanceId:`9000000${i}-1111-4111-8111-111111111111`}))};
  for(const dirty of [false,true]) {
    const f=fixture(api,example,dirty), before=copy(f), draft=await api.createSceneCompositionStructureDraft(f.model,f.source,{digest:sha});
    const p=copy(draft.propose(copy(edit)));
    assert.deepEqual(copy(await api.prepareSceneCompositionStructureApply(f.source,p,{digest:sha})),{afterContent:p.afterContent,changedPaths:p.changedPaths});
    const expanded=copy(api.expandSceneComposition(p.afterContent)); assert.equal(expanded.scene.actors.length,6);
    assert.deepEqual(expanded.scene.actors.filter(a=>a.instanceId.startsWith('9000000')).map(a=>a.position),[[240.5,100.25],[600.5,180.25]]);
    const after=parse(p.afterContent);assert.deepEqual(after.fragments[0].actors.slice(0,2),example.fragments[0].actors);
    for(const [i,placement]of after.placements.entries()) {
      assert.deepEqual(placement.groupIds,example.placements[i].groupIds); assert.deepEqual(placement.overrides,example.placements[i].overrides);
    }
    assert.equal(p.afterContent.startsWith('\uFEFF'),true); assert.equal(p.afterContent.includes('\r\n'),true); assert.deepEqual(f,before);
    const added=fixture(api,p.afterContent),remove=copy((await api.createSceneCompositionStructureDraft(added.model,added.source,{digest:sha})).propose({action:'remove',fragmentId:'party',actorKey:'newActor'}));
    await api.prepareSceneCompositionStructureApply(added.source,remove,{digest:sha});assert.deepEqual(parse(remove.afterContent),example);
  }
  checks.push({id:'saved-and-dirty-add-remove-stable-identities-full-source-receipts',ok:true,modes:2});
  {
    const f=fixture(api,example), draft=await api.createSceneCompositionStructureDraft(f.model,f.source,{digest:sha});
    const p=copy(draft.propose({action:'remove',fragmentId:'party',actorKey:'leader'}));
    assert.deepEqual(p.targets[1].overrides,['position','color','speed','controls']);
    const after=parse(p.afterContent); assert.deepEqual(after.placements[1].overrides,[]);
    assert.deepEqual(after.fragments[0].groups,example.fragments[0].groups);await api.prepareSceneCompositionStructureApply(f.source,p,{digest:sha});
    checks.push({id:'remove-all-instances-and-owned-overrides-preserves-groups-and-empty-array',ok:true});
  }
  {
    const value=copy(example), alone=copy(actor);delete alone.groupKey;value.fragments.push({fragmentId:'unused',groups:[],actors:[{...alone,key:'alone'}]});
    const f=fixture(api,value),d=await api.createSceneCompositionStructureDraft(f.model,f.source,{digest:sha});
    const p=copy(d.propose({action:'add',fragmentId:'unused',actor:alone,instances:[]}));assert.deepEqual(p.targets,[]);
    assert.deepEqual(copy(api.expandSceneComposition(p.afterContent).scene),copy(api.expandSceneComposition(f.source.content).scene));
    await api.prepareSceneCompositionStructureApply(f.source,p,{digest:sha});
    assert.throws(()=>d.propose({action:'remove',fragmentId:'unused',actorKey:'alone'}));
    checks.push({id:'unused-fragment-with-empty-mapping-and-last-member-guard',ok:true});
  }
  {
    const f=fixture(api,example),d=await api.createSceneCompositionStructureDraft(f.model,f.source,{digest:sha});
    for(const mutate of [e=>{e.instances.pop();},e=>{e.instances.reverse();},e=>{e.instances[0].instanceId=f.model.scene.objectId;},
      e=>{e.instances[0].instanceId=example.placements[0].placementId;},e=>{e.instances[0].instanceId=example.placements[0].groupIds.party;},
      e=>{e.actor.groupKey='absent';},e=>{e.actor.position=[100000,0];},e=>{e.actor.key='leader';}]) {
      const input=copy(edit);mutate(input);assert.throws(()=>d.propose(input));
    }
    const p=copy(d.propose(edit));
    for(const mutate of [v=>{v.targets.reverse();},v=>{v.afterContent+=' ';},v=>{v.changedPaths=[];},v=>{v.edit.instances[0].instanceId=f.model.scene.objectId;}]) {
      const bad=copy(p);mutate(bad);await assert.rejects(api.prepareSceneCompositionStructureApply(f.source,bad,{digest:sha}));
    }
    await assert.rejects(api.prepareSceneCompositionStructureApply({...f.source,content:f.source.content+' '},p,{digest:sha}));
    checks.push({id:'missing-reordered-colliding-mappings-offset-bounds-and-tampered-receipts-rejected',ok:true,rejectedOperations:13});
  }
  return checks;
}
await import(pathToFileURL(path.join(root,'desktop/resources/scripts/adapters/node-studio-core.mjs')));
const desktopApi=Object.assign({},...await Promise.all(moduleFiles.map(file=>import(pathToFileURL(path.join(root,'desktop/resources',file))))));
report.desktopChecks=await cases(desktopApi); report.desktopLegacyChecks=[...await runPlacementCases(desktopApi,example),...await runInheritanceCases(desktopApi,example)];
const mobile=path.join(root,'mobile/dist'),context=vm.createContext({TextEncoder,TextDecoder,WebAssembly}),modules=new Map();
function load(relative) {
  assert.equal(relative,path.posix.normalize(relative));assert.ok((relative.startsWith('engine/')&&relative.endsWith('.mjs')||relative.startsWith('vendor/yaml/')&&relative.endsWith('.js'))&&!/[\\\0?#]/.test(relative));
  if(!modules.has(relative))modules.set(relative,fs.readFile(path.join(mobile,relative),'utf8').then(source=>new vm.SourceTextModule(source,{context,identifier:relative})));return modules.get(relative);
}
function linker(specifier,ref) {
  assert.ok(typeof specifier==='string'&&!/[\\\0?#]/.test(specifier)&&(specifier.startsWith('./')||specifier.startsWith('../')||specifier.startsWith('/engine/')||specifier.startsWith('/vendor/yaml/')));
  return load(path.posix.normalize(specifier.startsWith('/')?specifier.slice(1):path.posix.join(path.posix.dirname(ref.identifier),specifier)));
}
const entry=new vm.SourceTextModule(moduleFiles.map(file=>`export * from '/${file}';`).join('\n'),{context,identifier:'portable-structure-entry'});
await entry.link(linker);await entry.evaluate();const wasm=await fs.readFile(path.join(mobile,'engine/studio-core.wasm'));
await entry.namespace.initializeStudioCore(async()=>wasm);assert.equal(entry.namespace.getStudioCoreMetadata().ready,true);
assert.equal(vm.runInContext('[typeof process,typeof require,typeof Buffer,typeof document,typeof window,typeof fetch].join(",")',context),Array(6).fill('undefined').join(','));
// The harness passes serialized author observations across realms, as an
// actual JSON transport would. Host callbacks supply only deterministic SHA.
const realmJson=vm.runInContext('(text)=>JSON.parse(text)',context),mobileApi={...entry.namespace};
mobileApi.createSceneCompositionStructureDraft=async(model,source,options)=>{
  const draft=await entry.namespace.createSceneCompositionStructureDraft(realmJson(JSON.stringify(model)),realmJson(JSON.stringify(source)),options);
  return {...draft,propose:edit=>draft.propose(realmJson(JSON.stringify(edit)))};
};
mobileApi.prepareSceneCompositionStructureApply=(source,proposal,options)=>entry.namespace.prepareSceneCompositionStructureApply(realmJson(JSON.stringify(source)),realmJson(JSON.stringify(proposal)),options);
report.mobileChecks={new:await cases(mobileApi),legacy:[...await runPlacementCases(entry.namespace,example),...await runInheritanceCases(entry.namespace,example)],moduleCount:modules.size,
  wasmSha256:sha(wasm),noNodeDomNetworkGlobals:true,noHostImports:true,noDeviceAcceptance:true};
assert.deepEqual(report.mobileChecks.new,report.desktopChecks);assert.deepEqual(report.mobileChecks.legacy,report.desktopLegacyChecks);
assert.equal(sha(wasm),await fileSha(path.join(root,'engine/studio-core.wasm')));
for(const [file,digest]of Object.entries(report.sourceHashes))assert.equal(await fileSha(path.join(root,file)),digest,file);
report.ok=true; report.finishedAt=new Date().toISOString(); await fs.writeFile(path.join(evidence,'packaged-resources.json'),json(report));
console.log(JSON.stringify({ok:true,newCasesEach:report.desktopChecks.length,legacyCasesEach:report.desktopLegacyChecks.length,totalCases:2*(report.desktopChecks.length+report.desktopLegacyChecks.length),
  artifacts:Object.fromEntries(Object.entries(report.artifacts).map(([k,v])=>[k,v.manifestFileCount])),mobileModuleCount:modules.size}));

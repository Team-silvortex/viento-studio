// Read-only proof of prepared placement offset source copies; pinned embedded Node.
import { runPlacementCases } from './boundary-cases.mjs';
import { runInheritanceCases } from '../scene-composition-fragment-inheritance/boundary-cases.mjs';
import { runFragmentCases as runLegacySharedSetCases } from '../scene-composition-fragment-editor/boundary-cases.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = fileURLToPath(new URL('./', import.meta.url));
const desktop = path.join(root, 'desktop/resources'), mobile = path.join(root, 'mobile/dist');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const revision = content => `sha256:${sha(content)}`;
const rewrite = source => source.replaceAll("from 'yaml'", "from '/vendor/yaml/index.js'")
  .replaceAll("from '../node_modules/yaml/browser/index.js'", "from '/vendor/yaml/index.js'");
const fileSha = async file => sha(await fs.readFile(file));
const importPrepared = file => import(pathToFileURL(path.join(desktop, file)));
assert.equal(process.version, 'v24.20.0', 'Execute this proof with the pinned embedded Node');
assert.equal(await fileSha(process.execPath), '89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7');
const report = { ok: false, recordedAt: new Date().toISOString(),
  scope: 'Read-only acceptance of prepared desktop placement-offset and legacy shared-SET/RESET/single/batch helpers under the pinned shared Node, and the prepared mobile placement-offset and legacy shared-SET/RESET/single/batch helpers with the rebuilt Rust WASM in an isolated VM. VM supplies standard TextEncoder/TextDecoder/WebAssembly globals and a host deterministic SHA callback; it verifies portability, not adversarial security isolation. This does not accept an installed Tauri application, Android device, author persistence, engine execution, or new standalone Rust tests.',
  embeddedNode: { version: process.version, sha256: await fileSha(process.execPath) },
  proofSourceSha256: await fileSha(fileURLToPath(import.meta.url)), artifacts: {}, desktopChecks: [], mobileChecks: {} };
report.version = (await fs.readFile(path.join(root, 'VERSION'), 'utf8')).trim();
assert.match(report.version, /^\d+\.\d+\.\d+$/);
const sourceHashes = JSON.parse(await fs.readFile(path.join(evidence, 'source-hashes.json'), 'utf8'));
assert.ok(Object.hasOwn(sourceHashes, 'engine/scene-composition-placement.mjs'));
async function verifySources() {
  for (const [file, expected] of Object.entries(sourceHashes)) assert.equal(await fileSha(path.join(root, file)), expected, `Frozen source changed: ${file}`);
}
await verifySources();
report.frozenSourceManifest = { files: Object.keys(sourceHashes).length, sha256: await fileSha(path.join(evidence, 'source-hashes.json')), hashes: sourceHashes };

async function inventory(directory) {
  const files = {};
  for (const entry of await fs.readdir(directory, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    assert.ok(entry.isFile(), 'Prepared resources must contain only regular files');
    const file = path.join(entry.parentPath, entry.name), bytes = await fs.readFile(file);
    const signature = bytes.length >= 4 ? bytes.readUInt32BE(0) : null;
    const nativeExecutable = [0x7f454c46, 0xcafebabe, 0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe].includes(signature)
      || bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;
    files[path.relative(directory, file)] = { bytes: bytes.length, sha256: sha(bytes), ...(nativeExecutable ? { nativeExecutable: true } : {}) };
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b, 'en')));
}
const shared = [...(await fs.readdir(path.join(root, 'engine'))).filter(file => file.endsWith('.mjs')).map(file => `engine/${file}`),
  'engine/studio-core.wasm', 'engine/studio-core.build.json', 'web/project-build.css', 'favicon.ico',
  ...['app-runtime.js', 'app-project-build.js', 'app-scene-preview.js', 'app-scene-preview-canvas.js',
    'app-scene-composition-placement.js', 'app-scene-composition-fragments.js', 'app-scene-composition-overrides.js', 'app-scene-composition-layout.js', 'app-scene-composition-batch-layout.js', 'app-scene-layout.js', 'app-doc-service.js', 'app-studio-core.js'].map(file => `web/modules/${file}`),
  ...['messages.js', 'en.js', 'ja.js'].map(file => `web/i18n/${file}`)];
const host = ['scripts/adapters/node-studio-core.mjs', 'scripts/adapters/node-build-snapshot.mjs', 'scripts/lib/scene-preview-service.mjs',
  'scripts/lib/doc-api-service.mjs', 'scripts/lib/project-build-service.mjs', 'scripts/lib/resource-package-reader.mjs',
  ...(await fs.readdir(path.join(root, 'scripts/backends'), { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile()).map(entry => path.relative(root, path.join(entry.parentPath, entry.name))),
  ...(await fs.readdir(path.join(root, 'schemas'))).filter(file => file.endsWith('.json')).map(file => `schemas/${file}`)];
const runtimeConfiguration = JSON.parse(await fs.readFile(path.join(root, 'desktop/node-runtime.json'), 'utf8'));
for (const [name, extra] of [['desktop/resources', host], ['mobile/dist', ['mobile/platform.mjs']]]) {
  const base = path.join(root, name), files = await inventory(base), focus = {}, allCopies = {};
  for (const file of [...shared, ...extra]) {
    const source = await fs.readFile(path.join(root, file)), bytes = await fs.readFile(path.join(base, file));
    const expected = name === 'mobile/dist' && file.startsWith('engine/') && file.endsWith('.mjs') ? Buffer.from(rewrite(source.toString('utf8'))) : source;
    assert.equal(sha(bytes), sha(expected), `Focused prepared copy differs: ${name}/${file}`);
    focus[file] = { sourceSha256: sha(source), packagedSha256: sha(bytes), importRewrite: !source.equals(bytes) };
  }
  for (const [file, actual] of Object.entries(files)) {
    let origin = file, transformation = null, expected;
    if (name === 'desktop/resources' && file === 'package.json') {
      origin = 'VERSION'; transformation = 'generated package metadata';
      expected = Buffer.from(JSON.stringify({ private: true, type: 'module', version: report.version, displayVersion: report.version }));
    } else if (name === 'desktop/resources' && file === 'NODE-LICENSE') {
      origin = `desktop/.cache/${runtimeConfiguration.version}-LICENSE`;
      expected = await fs.readFile(path.join(root, origin)); assert.equal(sha(expected), runtimeConfiguration.licenseSha256);
    } else if (name === 'mobile/dist' && file.startsWith('vendor/yaml/')) {
      origin = file === 'vendor/yaml/LICENSE' ? 'node_modules/yaml/LICENSE' : file.replace('vendor/yaml/', 'node_modules/yaml/browser/');
      expected = await fs.readFile(path.join(root, origin));
    } else if (name === 'mobile/dist' && file === 'index.html') {
      origin = 'mobile/index.html'; transformation = 'release version substitution';
      expected = Buffer.from((await fs.readFile(path.join(root, origin), 'utf8')).replaceAll('__VIENTO_VERSION__', report.version));
    } else if (name === 'mobile/dist' && file === 'editor.html') {
      origin = 'web/index.html'; transformation = 'mobile shell entry';
      expected = Buffer.from((await fs.readFile(path.join(root, origin), 'utf8')).replace(/<title>.*?<\/title>/, '<title>Viento Studio</title>')
        .replace('</head>', '<link rel="stylesheet" href="/mobile/mobile.css" /></head>').replace('<body>', '<body class="mobile-host">')
        .replace('<script type="module" src="/web/app.js"></script>', '<script type="module" src="/mobile/editor.js"></script>')
        .replace('<script type="module" src="/web/modules/desktop-bridge.js"></script>', ''));
    } else {
      const source = await fs.readFile(path.join(root, origin));
      expected = name === 'mobile/dist' && file.startsWith('engine/') && file.endsWith('.mjs') ? Buffer.from(rewrite(source.toString('utf8'))) : source;
      if (!source.equals(expected)) transformation = 'local YAML import rewrite';
    }
    assert.equal(actual.sha256, sha(expected), `Full prepared inventory differs: ${name}/${file}`);
    allCopies[file] = { source: origin, sourceSha256: await fileSha(path.join(root, origin)), expectedSha256: sha(expected), transformation };
  }
  assert.ok(!Object.keys(files).some(file => /^(?:examples|works|workspaces|crates)\//.test(file) || file.startsWith('web/data/') || file.startsWith('scripts/tests/')));
  assert.ok(!Object.values(files).some(file => file.nativeExecutable));
  if (name === 'mobile/dist') assert.ok(!Object.keys(files).some(file => file.startsWith('scripts/adapters/') || file.startsWith('scripts/backends/') || file === 'scripts/lib/project-build-service.mjs'));
  report.artifacts[name] = { manifestFileCount: Object.keys(files).length, manifestBytes: Object.values(files).reduce((sum, file) => sum + file.bytes, 0),
    manifestSha256: sha(JSON.stringify(files)), manifest: files, checkedSourceFiles: Object.keys(focus).length,
    checkedSourceSha256: sha(JSON.stringify(focus)), hashes: focus, fullSourceCopyCount: Object.keys(allCopies).length,
    fullSourceCopySha256: sha(JSON.stringify(allCopies)), fullSourceCopies: allCopies };
}
report.libraryTranslations = {};
for (const file of ['messages.js', 'en.js', 'ja.js']) {
  const original = await fs.readFile(path.join(root, 'web/i18n', file)), prepared = await fs.readFile(path.join(root, 'desktop/ui/i18n', file));
  assert.deepEqual(prepared, original); report.libraryTranslations[file] = sha(prepared);
}
{
  const files = await inventory(path.join(root,'desktop/ui')), allCopies = {};
  for (const [file, item] of Object.entries(files)) {
    const origin = file.startsWith('i18n/') ? `web/${file}` : `desktop/ui/${file}`;
    assert.equal(item.sha256, await fileSha(path.join(root,origin)));
    allCopies[file] = { source: origin, sourceSha256: item.sha256, expectedSha256: item.sha256, transformation: null };
  }
  report.artifacts['desktop/ui'] = { manifestFileCount: Object.keys(files).length, manifestBytes: Object.values(files).reduce((sum,file) => sum + file.bytes,0),
    manifestSha256: sha(JSON.stringify(files)), manifest: files, checkedSourceFiles: Object.keys(files).length,
    checkedSourceSha256: sha(JSON.stringify(allCopies)), hashes: allCopies, fullSourceCopyCount: Object.keys(files).length,
    fullSourceCopySha256: sha(JSON.stringify(allCopies)), fullSourceCopies: allCopies };
}
report.unchangedFrozenSources = {};
for (const name of ['frozen-backend-baseline.json', 'protected-scene-slices.json', 'historical-baseline.json']) {
  const expected = JSON.parse(await fs.readFile(path.join(evidence, name), 'utf8'));
  for (const [file, digest] of Object.entries(expected)) assert.equal(await fileSha(path.join(root, file)), digest, `Protected source/history changed: ${file}`);
  report.unchangedFrozenSources[name] = { files: Object.keys(expected).length, baselineSha256: await fileSha(path.join(evidence, name)), allMatch: true };
}



const previous = JSON.parse(await fs.readFile(path.join(evidence,'previous-source-hashes.json'),'utf8'));
report.previousSourceManifest = { files:Object.keys(previous).length, sha256:await fileSha(path.join(evidence,'previous-source-hashes.json')),
  scope:'Previous slice manifest preserved as evidence; current equality is checked against the final current manifest above.' };
const core = JSON.parse(await fs.readFile(path.join(evidence,'core-source-hashes.json'),'utf8'));
for(const [file,digest]of Object.entries(core))assert.equal(await fileSha(path.join(root,file)),digest);
report.coreSourceManifest={files:Object.keys(core).length,sha256:await fileSha(path.join(evidence,'core-source-hashes.json')),allMatch:true};
const binaryManifest=JSON.parse(await fs.readFile(path.join(evidence,'native-helpers.json'),'utf8'));
for(const item of binaryManifest.binaries){const bytes=await fs.readFile(item.path);assert.equal(bytes.length,item.bytes);assert.equal(sha(bytes),item.sha256);}
report.freshBinaryManifest={sha256:await fileSha(path.join(evidence,'native-helpers.json')),binaries:binaryManifest.binaries,
  scope:'Byte verification only here; independent boundary-receipt-probe executes the native core, other test logs cover archive/storage execution.'};
report.caseHarnessSha256=await fileSha(path.join(evidence,'boundary-cases.mjs'));
report.legacyInheritanceHarness={path:'docs/test-results/scene-composition-fragment-inheritance/boundary-cases.mjs',sha256:await fileSha(path.join(root,'docs/test-results/scene-composition-fragment-inheritance/boundary-cases.mjs'))};
report.legacySharedSetHarness={path:'docs/test-results/scene-composition-fragment-editor/boundary-cases.mjs',sha256:await fileSha(path.join(root,'docs/test-results/scene-composition-fragment-editor/boundary-cases.mjs'))};
const examplePath=path.join(root,'examples/scene-composition/recipe.json'),exampleBytes=await fs.readFile(examplePath),example=JSON.parse(exampleBytes);
report.exampleSourceSha256=sha(exampleBytes);
function legacyFixture(api){const content='\uFEFF'+JSON.stringify(example,null,'\t').replaceAll('\n','\r\n')+'\r\n \t',expanded=copy(api.expandSceneComposition(content));
 const sourceRevision=revision(content),sceneId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 const source={sourcePath:'documents/prepared-fragment-recipe.json',baseSourceRevision:sourceRevision,content};
 const model={ok:true,format:'viento-scene-preview',schemaVersion:2,
  scene:{objectId:sceneId,sourcePath:source.sourcePath,sourceRevision,viewport:expanded.scene.viewport,background:expanded.scene.background},
  actors:expanded.scene.actors.map(actor=>({...actor,name:actor.instanceId})),
  composition:{format:'viento-scene-composition-preview',schemaVersion:1,recipeObjectId:sceneId,sourcePath:source.sourcePath,sourceRevision,
   fragmentCount:example.fragments.length,placementCount:example.placements.length},
  sourceLocations:{actors:expanded.sourceMap.actors.map((actor,index)=>({instanceId:actor.instanceId,objectId:expanded.scene.actors[index].objectId,
   declaration:{objectId:sceneId,sourcePath:source.sourcePath,sourceRevision},composition:{fragmentId:actor.fragmentId,placementId:actor.placementId,localKey:actor.localKey}}))},
  sceneStructure:copy(api.createSceneStructure(expanded.scene))};
 return{source,model,ids:model.actors.map(actor=>actor.instanceId)};}
async function legacyCases(api){const f=legacyFixture(api),before=copy(f),single=await api.createSceneCompositionLayoutDraft(f.model,f.source,f.ids[2],{digest:sha});
 try{assert.equal(single.setPosition(f.ids[2],[510,250]),true);const proposal=copy(single.propose());assert.deepEqual(proposal.values,{position:[150,170]});
  assert.equal(Object.hasOwn(proposal,'changes'),false);assert.deepEqual(copy(await api.prepareSceneCompositionOverrideApply(f.source,proposal,{digest:sha})),
   {afterContent:proposal.afterContent,changedPaths:proposal.changedPaths});assert.deepEqual(JSON.parse(proposal.afterContent.replace(/^\uFEFF/,'' )).fragments,example.fragments);
 }finally{single.dispose();}
 const batch=await api.createSceneCompositionBatchLayoutDraft(f.model,f.source,{digest:sha});
 try{assert.equal(batch.move([f.ids[0],f.ids[2]],[11,7]),true);const proposal=copy(batch.propose());assert.equal(proposal.changes.length,2);
  assert.deepEqual(copy(await api.prepareSceneCompositionBatchLayoutApply(f.source,proposal,{digest:sha})),{afterContent:proposal.afterContent,changedPaths:proposal.changedPaths});
  assert.deepEqual(JSON.parse(proposal.afterContent.replace(/^\uFEFF/,'' )).fragments,example.fragments);
  assert.equal(batch.undo(),true);assert.equal(batch.state().dirty,false);assert.equal(batch.redo(),true);assert.deepEqual(copy(batch.propose()),proposal);
 }finally{batch.dispose();}assert.deepEqual(f,before);
 return[{id:'old-single-helper-source-receipt-actually-executed',ok:true},{id:'old-batch-helper-atomic-source-and-history-actually-executed',ok:true}];}
await importPrepared('scripts/adapters/node-studio-core.mjs');
const moduleFiles=['engine/scene-composition-placement.mjs','engine/scene-composition-fragments.mjs','engine/scene-composition.mjs','engine/scene-structure.mjs','engine/studio-core.mjs',
 'engine/scene-composition-layout.mjs','engine/scene-composition-overrides.mjs','engine/scene-composition-batch-layout.mjs','engine/scene-layout.mjs','engine/json-source.mjs'];
const desktopApi=Object.assign({},...await Promise.all(moduleFiles.map(importPrepared)));
report.desktopChecks=await runPlacementCases(desktopApi,example);report.desktopLegacyChecks=[...await runInheritanceCases(desktopApi,example),...await runLegacySharedSetCases(desktopApi,example),...await legacyCases(desktopApi)];
console.log(JSON.stringify({phase:'prepared-desktop-placement-and-legacy',newCases:report.desktopChecks.length,legacyCases:report.desktopLegacyChecks.length,ok:true}));
const context=vm.createContext({TextEncoder,TextDecoder,WebAssembly}),modules=new Map();
function load(relative){assert.equal(relative,path.posix.normalize(relative));assert.ok((relative.startsWith('engine/')&&relative.endsWith('.mjs')||relative.startsWith('vendor/yaml/')&&relative.endsWith('.js'))
 && !/[\\\0?#]/.test(relative),'Only prepared pure engine modules and fingerprinted local YAML enter this VM');
 if(!modules.has(relative))modules.set(relative,fs.readFile(path.join(mobile,relative),'utf8').then(source=>new vm.SourceTextModule(source,{context,identifier:relative})));return modules.get(relative);}
function linker(specifier,referencing){assert.ok(typeof specifier==='string'&&!/[\\\0?#]/.test(specifier)
 &&(specifier.startsWith('./')||specifier.startsWith('../')||specifier.startsWith('/engine/')||specifier.startsWith('/vendor/yaml/')));
 return load(path.posix.normalize(specifier.startsWith('/')?specifier.slice(1):path.posix.join(path.posix.dirname(referencing.identifier),specifier)));}
const entry=new vm.SourceTextModule(moduleFiles.map(file=>`export * from '/${file}';`).join('\n'),{context,identifier:'portable-placement-offset-entry'});
await entry.link(linker);await entry.evaluate();const mobileWasm=await fs.readFile(path.join(mobile,'engine/studio-core.wasm'));
await entry.namespace.initializeStudioCore(async()=>mobileWasm);assert.equal(entry.namespace.getStudioCoreMetadata().ready,true);assert.equal(entry.namespace.supportsStudioCoreCompositionFragment(),true);assert.equal(entry.namespace.supportsStudioCoreCompositionFragmentEdit(),true);assert.equal(entry.namespace.supportsStudioCoreCompositionPlacement(),true);
assert.equal(vm.runInContext('[typeof process,typeof require,typeof Buffer,typeof document,typeof window,typeof fetch].join(",")',context),Array(6).fill('undefined').join(','));
const mobileChecks=await runPlacementCases(entry.namespace,example),mobileLegacyChecks=[...await runInheritanceCases(entry.namespace,example),...await runLegacySharedSetCases(entry.namespace,example),...await legacyCases(entry.namespace)];
report.mobileChecks={entryModuleCount:moduleFiles.length,moduleCount:modules.size,modules:[...modules.keys()].sort(),wasmSha256:sha(mobileWasm),
 wasmMetadata:copy(entry.namespace.getStudioCoreMetadata()),checks:mobileChecks,legacyChecks:mobileLegacyChecks,
 acceptedCases:mobileChecks.length,legacyAcceptedCases:mobileLegacyChecks.length,rejectedOperations:mobileChecks.reduce((sum,item)=>sum+(item.rejectedOperations||0),0),
 noNodeDomNetworkGlobals:true,noHostImports:true,noDeviceAcceptance:true};
assert.deepEqual(mobileChecks,report.desktopChecks);assert.deepEqual(mobileLegacyChecks,report.desktopLegacyChecks);assert.equal(sha(mobileWasm),await fileSha(path.join(root,'engine/studio-core.wasm')));
assert.equal(await fileSha(examplePath),sha(exampleBytes));await verifySources();
for(const [name,artifact]of Object.entries(report.artifacts))assert.deepEqual(await inventory(path.join(root,name)),artifact.manifest);
for(const name of ['frozen-backend-baseline.json','protected-scene-slices.json','historical-baseline.json']){
 const baseline=JSON.parse(await fs.readFile(path.join(evidence,name),'utf8'));for(const[file,digest]of Object.entries(baseline))assert.equal(await fileSha(path.join(root,file)),digest);}
for(const item of binaryManifest.binaries)assert.equal(await fileSha(item.path),item.sha256);
assert.equal(report.legacyInheritanceHarness.sha256,await fileSha(path.join(root,report.legacyInheritanceHarness.path)));assert.equal(report.caseHarnessSha256,await fileSha(path.join(evidence,'boundary-cases.mjs')));assert.equal(report.legacySharedSetHarness.sha256,await fileSha(path.join(root,report.legacySharedSetHarness.path)));assert.equal(report.proofSourceSha256,await fileSha(fileURLToPath(import.meta.url)));
report.ok=true;report.sourceAndPreparedManifestsStableDuringAcceptance=true;
report.counts={desktopCases:report.desktopChecks.length,mobileCases:mobileChecks.length,totalCases:report.desktopChecks.length+mobileChecks.length,
 desktopLegacyCases:report.desktopLegacyChecks.length,mobileLegacyCases:mobileLegacyChecks.length,totalLegacyCases:report.desktopLegacyChecks.length+mobileLegacyChecks.length,
 totalGroups:report.desktopChecks.length+mobileChecks.length+report.desktopLegacyChecks.length+mobileLegacyChecks.length};
await fs.writeFile(path.join(evidence,'packaged-resources.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({ok:true,counts:report.counts,artifacts:Object.fromEntries(Object.entries(report.artifacts).map(([name,value])=>[name,
 {manifestFileCount:value.manifestFileCount,checkedSourceFiles:value.checkedSourceFiles,fullSourceCopyCount:value.fullSourceCopyCount}])),mobileModuleCount:modules.size,frozenSourceFiles:Object.keys(sourceHashes).length}));

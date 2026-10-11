import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const directory=path.dirname(fileURLToPath(import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
const fileSha=async relative=>sha(await fs.readFile(path.join(root,relative)));
const read=async name=>JSON.parse(await fs.readFile(path.join(directory,name)));
const prefix='docs/test-results/backend-project-catalog/';
assert.equal(process.version,'v24.20.0');
const source=await read('source-hashes.json'),previous=await read('previous-source-hashes.json'),delta=await read('source-delta.json');
assert.equal(Object.keys(source).length,594);assert.equal(Object.keys(previous).length,586);
for(const[file,digest]of Object.entries(source))assert.equal(await fileSha(file),digest,`Frozen source changed: ${file}`);
const changed=Object.keys(previous).filter(file=>source[file]!==previous[file]);
const added=Object.keys(source).filter(file=>!Object.hasOwn(previous,file));
assert.deepEqual(changed.sort(),[...delta.changedPreviousSource].sort());assert.deepEqual(added.sort(),[...delta.addedSource].sort());
assert.equal(changed.length,8);assert.equal(added.length,8);assert.ok(Object.keys(previous).every(file=>Object.hasOwn(source,file)));
const preservation={};
for(const[name,expected]of [['historical-baseline.json',2588],['core-source-hashes.json',13],['frozen-backend-baseline.json',7],['protected-scene-slices.json',23]]){
 const values=await read(name);assert.equal(Object.keys(values).length,expected);
 for(const[file,digest]of Object.entries(values))assert.equal(await fileSha(file),digest,`Protected source or evidence changed: ${file}`);
 preservation[name]={files:expected,sha256:await fileSha(prefix+name),allMatch:true};
}
const prepared=await read('packaged-resources-frozen.json');assert.equal(prepared.ok,true);assert.equal(prepared.counts.totalGroups,21);
assert.equal(prepared.sourceHashCount,534);assert.equal(prepared.mobileModuleGraph.moduleCount,123);
for(const[file,digest]of Object.entries(prepared.sourceHashes)){
 assert.equal(await fileSha(file),digest);if(Object.hasOwn(source,file))assert.equal(source[file],digest,`Copied product does not match frozen source: ${file}`);
}
for(const[name,artifact]of Object.entries(prepared.artifacts))for(const[file,value]of Object.entries(artifact.manifest))assert.equal(await fileSha(`${name}/${file}`),value.sha256);
const initial=await read('catalog-missing-temp-initial.json'),final=await read('catalog-missing-temp-final.json');
assert.equal(initial.ok,false);assert.equal(initial.originalIndexPreserved,true);assert.equal(initial.ownedLockLeftBehind,true);assert.equal(initial.nextError,'backend_project_catalog_busy');
assert.equal(final.ok,true);assert.equal(final.originalIndexPreserved,true);assert.equal(final.ownedLockLeftBehind,false);assert.equal(final.nextUpsertSucceeded,true);
assert.equal(final.sourceSha256,source['scripts/adapters/node-backend-project-catalog.mjs']);
const parseTest=async(name,count)=>{
 const text=await fs.readFile(path.join(directory,name),'utf8');
 for(const[field,value]of [['tests',count],['pass',count],['fail',0],['cancelled',0],['skipped',0]])assert.ok(text.includes(`ℹ ${field} ${value}\n`),`${name}: ${field}`);
 return {log:prefix+name,sha256:sha(text),tests:count,pass:count,fail:0,cancelled:0,skipped:0,durationMs:Number(/ℹ duration_ms ([\d.]+)/.exec(text)[1])};
};
const boundary=await parseTest('boundary-tests-frozen.log',14),core=await parseTest('catalog-core-lock-repair.log',15);
const reviewed=[
 'scripts/adapters/node-backend-project-catalog.mjs','scripts/lib/project-build-service.mjs',
 'scripts/adapters/node-backend-project-retention.mjs','scripts/adapters/node-backend-project.mjs',
 'scripts/adapters/node-project-build.mjs','scripts/project-build.mjs','engine/backend-project.mjs',
 'web/modules/app-backend-project.js','web/modules/app-project-build.js','engine/README.md',
 'scripts/tests/backend-project-catalog-boundary.test.mjs'
];
const reviewedSources=Object.fromEntries(await Promise.all(reviewed.map(async file=>[file,await fileSha(file)])));
const evidenceNames=['baseline.json','source-hashes.json','source-delta.json','catalog-missing-temp-probe.mjs',
 'catalog-missing-temp-initial.json','catalog-missing-temp-initial.log','catalog-missing-temp-final.json','catalog-missing-temp-final.log',
 'prepared-check.mjs','prepared-check-initial.log','packaged-resources.json','prepared-check-final.mjs','prepared-check-final.log','packaged-resources-final.json',
 'prepared-check-frozen.mjs','prepared-check-frozen.log','packaged-resources-frozen.json','desktop-prepare-frozen.log','mobile-prepare-frozen.log',
 'boundary-tests-initial.log','boundary-tests-second.log','boundary-tests-final.log','boundary-tests-frozen.log','catalog-core-lock-repair.log'];
const evidenceHashes=Object.fromEntries(await Promise.all(evidenceNames.map(async name=>[prefix+name,await fileSha(prefix+name)])));
const report={schemaVersion:1,ok:true,openFindings:[],finishedAt:new Date().toISOString(),
 scope:'Independent bounded source review and fault injection of host-only persistent catalog/selection/lifecycle; all frozen source and protected evidence hashes; exact prepared copy inventories plus copied desktop recovery/CLI and mobile pure-description/unsupported routes. No full app result is independently claimed here.',
 source:{files:594,sha256:await fileSha(prefix+'source-hashes.json'),allMatch:true,previousFiles:586,changedPrevious:changed,added,removed:[],note:delta.oldTestContractUpdate},
 reviewedSources,preservation,
 independentTests:{boundary,publicationMissingTemp:{checks:1,initialReproduced:true,initialIndexBytesPreserved:true,finalPass:true,finalSourceSha256:final.sourceSha256}},
 ownerCoreRegression:core,
 resolvedFindings:[
 {id:'catalog-lock-peer-unlink',result:'EEXIST followed by peer release retries ENOENT within the original bounded deadline; unknown/stale locks are never removed.',proof:'boundary-tests-frozen.log'},
 {id:'catalog-staged-publication-replacement',result:'Temp regular-file identity, single-link status and exact bytes are checked before rename; a foreign replacement cannot overwrite the prior valid index and is retained.',proof:'boundary-tests-frozen.log'},
 {id:'catalog-missing-temp-strands-lock',result:'Independent close-hook deletion reproduced an owned lock left behind and subsequent busy errors; nested finally now always invokes identity-guarded own-lock release even if temp cleanup fails.',initial:'catalog-missing-temp-initial.json',final:'catalog-missing-temp-final.json'},
 {id:'explicit-refresh-author-cache',result:'The explicit Refresh button now requests forced source and persistent-index reconciliation; root/UI own browser and parent-regression evidence.',source:'web/modules/app-project-build.js'}
 ],
 reviewedGuards:[
 'JSON DTOs and foreign catalog instances do not substitute for branded receipts. Capture validates physical ownership and manifest evidence; persisted metadata/read receipts grant no deletion ledger.',
 'No namespace scan or adoption of orphan UUID directories; malformed or foreign index/lock/temp bytes are preserved. Writes are atomic, bounded and cross-process locked.',
 'Restored projects stay preserved and unchecked until explicit inspect/select; inspect alone never selects runtime. Runtime admission still rechecks workspace identity, frozen project, adapter and tool rules.',
 'Delayed selection, competing selection, close and new jobs cannot publish stale runtime ownership. Refresh reconciles missing/changed historical rows only when inactive; current host receipts keep their authority.',
 'Only original current-session write receipts permit pristine-only quarantine cleanup. Restored selection never creates cleanup ownership; engine sessions, extras, modified files and replacement paths are preserved.',
 'Controller and parent bind selection receipts to dialog session, selected scene/backend, row identity and request epoch; lost selection responses reconcile by GET without repeating selection.',
 'Frozen-only history remains excluded from author preview/edit actions; no backend host execution is advertised or dispatched on mobile.'
 ],
 prepared:{report:prefix+'packaged-resources-frozen.json',sha256:await fileSha(prefix+'packaged-resources-frozen.json'),proof:prefix+'prepared-check-frozen.mjs',proofSha256:prepared.proofSourceSha256,
  counts:prepared.counts,artifacts:Object.fromEntries(Object.entries(prepared.artifacts).map(([name,value])=>[name,{files:value.manifestFileCount,bytes:value.manifestBytes,manifestSha256:value.manifestSha256}])),
  sourceCopyMappings:534,mobilePureModules:123,sourceAndCopiesStableDuringProof:true,embeddedNode:prepared.embeddedNode,
  vmScope:prepared.vmScope,desktopHostScope:prepared.desktopHostScope,mobileScope:prepared.mobileModuleGraph.scope,
  predecessors:[{report:prefix+'packaged-resources.json',scope:'Initial catalog products, before forced Refresh and later missing-temp lock repair; scoped checks passed, the new fault was not covered.'},{report:prefix+'packaged-resources-final.json',scope:'Forced Refresh repair applied, before missing-temp lock repair; scoped checks passed, the new fault was not covered.'}],
  realManifestEvidence:prepared.realManifestEvidence},
 observations:[{blocking:false,detail:'After tool-free inspection, detail receipt text reports verified files while the side-row availability can retain the previous GET value until reconciliation; this does not select runtime or grant cleanup authority.'}],
 limitations:[
 'Standard Node VM portability is not a sandbox for hostile code. The host assumes trusted modules and does not promise transaction isolation against every same-user mutation after the final check.',
 'The independent desktop lifecycle fixtures run actual copied service/snapshot/generator/catalog/CLI code with injected engine phases; no actual engine process, installed application, foreign platform or device is claimed by this proof.',
 'Current-round four real backend manifests are input evidence to both pure validators. Their actual engine runtime acceptance is reported separately by the root-owned real-backends-final results.',
 'Mobile executes copied pure modules with a storage-context fixture and verifies unsupported backend-host routes; no Android device or native storage acceptance is claimed.',
 'No original author data, historical reports, protected scene tests or Rust/Godot runtime generators were edited by this reviewer.'
 ],evidenceHashes};
await fs.writeFile(path.join(directory,'boundary-review.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({ok:true,source:report.source.files,history:2588,protected:[13,7,23],boundary:14,publicationFault:1,prepared:21,openFindings:0}));

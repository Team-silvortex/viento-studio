import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import yauzl from '/home/chiharukiryu/cdev/viento-studio/node_modules/yauzl/index.js';
import '/home/chiharukiryu/cdev/viento-studio/scripts/adapters/node-studio-core.mjs';
import { planExport, writeExportZip } from '/home/chiharukiryu/cdev/viento-studio/scripts/lib/export-package.mjs';
import { captureBuildSnapshot } from '/home/chiharukiryu/cdev/viento-studio/scripts/adapters/node-build-snapshot.mjs';
import { readRegistry } from '/home/chiharukiryu/cdev/viento-studio/scripts/lib/workspace.mjs';
const root='/home/chiharukiryu/cdev/viento-studio';
const destination=path.join(root,'docs/test-results/project-menu/browser');
const original=path.join(destination,'author-final');
const reportPath=path.join(destination,'author-archive.json');
const archive=path.join(destination,'author-final.viento.zip');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function inventory(root) {
 const result={};
 for(const row of await fs.readdir(root,{recursive:true,withFileTypes:true})) if(row.isFile()) {
  const file=path.join(row.parentPath||row.path,row.name),name=path.relative(root,file);
  if(name.split(path.sep).some(part=>part.startsWith('.'))) continue;
  result[name]=hash(await fs.readFile(file));
 }
 return Object.fromEntries(Object.entries(result).sort());
}
for(const file of [archive,reportPath]) await assert.rejects(fs.lstat(file),{code:'ENOENT'});
const preserved=['browser.json','evidence-inventory.json'];
const evidenceBefore=Object.fromEntries(await Promise.all(preserved.map(async name=>[name,hash(await fs.readFile(path.join(destination,name)))])));
const browser=JSON.parse(await fs.readFile(path.join(destination,'browser.json'),'utf8'));
const expected=browser.authorFinal.hashes;assert.equal(Object.keys(expected).length,104);
assert.deepEqual(await inventory(original),expected);
const temporary=await fs.mkdtemp('/tmp/viento-project-menu-author-migration-');
const source=path.join(temporary,'source');await fs.cp(original,source,{recursive:true});
const before=await inventory(source),sourcePlan=await captureBuildSnapshot(source,browser.plan.assemblyId);
assert.equal(sourcePlan.ok,true,JSON.stringify(sourcePlan.diagnostics));
const planned=await planExport(source,{kind:'workspace'});await writeExportZip(planned,archive);await planned.dispose?.();
const zip=await yauzl.openPromise(archive,{lazyEntries:true,autoClose:false,strictFileNames:true,validateEntrySizes:true});
const entries=new Map();
try {
 for await(const entry of zip.eachEntry()) {
  assert.ok(!entry.isEncrypted());assert.ok(!entries.has(entry.fileName));
  const chunks=[];for await(const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk);
  const bytes=Buffer.concat(chunks);assert.equal(bytes.length,entry.uncompressedSize);entries.set(entry.fileName,bytes);
 }
} finally {zip.close();}
const manifest=JSON.parse(entries.get('manifest.json'));
assert.equal(manifest.format,'viento-archive');assert.equal(manifest.version,3);assert.equal(manifest.files.length,103);assert.equal(entries.size,104);
const standardExpected=Object.fromEntries(Object.entries(expected).filter(([name])=>name!=='README.md'));
assert.deepEqual(new Set(manifest.files.map(row=>row.path)),new Set(Object.keys(standardExpected)));
for(const file of manifest.files) {
 const bytes=entries.get(file.path);assert.equal(bytes.length,file.size,file.path);assert.equal(hash(bytes),file.sha256,file.path);assert.equal(file.sha256,standardExpected[file.path],file.path);
}
assert.equal(entries.has('README.md'),false);
assert.equal(manifest.files.length,Object.keys(expected).length-1);
assert.equal(Object.keys(expected).filter(name=>name.startsWith('assets/')).length,9);
assert.equal(Object.keys(expected).filter(name=>name.startsWith('metadata/assets/')).length,9);
const parent=path.join(temporary,'restored');await fs.mkdir(parent);
const nativeTool='/tmp/viento-project-menu-workspace-import/target/debug/viento-project-pause-workspace-import';
const result=await promisify(execFile)(nativeTool,[archive,parent],{maxBuffer:1024*1024});
const restored=JSON.parse(result.stdout).restoredRoot;
assert.deepEqual(await inventory(restored),standardExpected);
const registry=await readRegistry(restored);assert.equal(registry.documents.length,36);assert.equal(registry.assets.length,9);
const restoredPlan=await captureBuildSnapshot(restored,browser.plan.assemblyId);
assert.equal(restoredPlan.ok,true,JSON.stringify(restoredPlan.diagnostics));assert.equal(restoredPlan.snapshotId,sourcePlan.snapshotId);
assert.deepEqual(restoredPlan.plan,sourcePlan.plan);
const standardHashes=await inventory(restored);
await fs.copyFile(path.join(original,'README.md'),path.join(restored,'README.md'));
assert.deepEqual(await inventory(restored),expected);assert.deepEqual(await inventory(original),expected);assert.deepEqual(await inventory(source),before);
const evidenceAfter=Object.fromEntries(await Promise.all(preserved.map(async name=>[name,hash(await fs.readFile(path.join(destination,name)))])));assert.deepEqual(evidenceAfter,evidenceBefore);
const assetNames=Object.keys(standardExpected).filter(name=>name.startsWith('assets/'));
const assetRegistryNames=Object.keys(standardExpected).filter(name=>name.startsWith('metadata/assets/'));
const receipts={ok:true,completedAt:new Date().toISOString(),scope:'Existing standard workspace export and actual native workspace import. The archive contains exactly 103 standard author-data files plus manifest.json. The original top-level README.md is an ordinary tracked sidecar, excluded by the existing workspace format; copying this unchanged sidecar after import restores all 104 browser现场 files.',
 archive:{path:'author-final.viento.zip',format:manifest.format,version:manifest.version,entries:entries.size,authorDataFiles:manifest.files.length,bytes:(await fs.stat(archive)).size,sha256:hash(await fs.readFile(archive)),documentCount:registry.documents.length,registeredAssets:registry.assets.length},
 standardImport:{implementation:'src-tauri/src/workspace.rs#import_workspace',implementationSha256:hash(await fs.readFile(path.join(root,'src-tauri/src/workspace.rs'))),parent,restoredRoot:restored,verifiedAuthorDataFiles:103,hashes:standardHashes,buildSnapshot:{ok:restoredPlan.ok,snapshotId:restoredPlan.snapshotId,sourceSnapshotId:sourcePlan.snapshotId,entrySceneId:restoredPlan.plan.entrySceneId,sceneCount:restoredPlan.plan.scenes.length},generatedCompatibilityGuard:{path:'.viento/workspace.json',sha256:hash(await fs.readFile(path.join(restored,'.viento/workspace.json')))}},
 sidecar:{path:'README.md',sha256:expected['README.md'],includedInStandardArchive:false,copiedAfterStandardImport:true,complete现场FileCount:104,all104HashesMatchBrowser:true},
 ignoredAssetCoverage:{scope:'All raw assets/ and metadata/assets/ files are inside the standard workspace ZIP and have matching manifest/source/restored hashes; no gitignore or staging changes.',assetFiles:assetNames.length,assetRegistrationFiles:assetRegistryNames.length,paths:[...assetNames,...assetRegistryNames]},preservedEvidence:{before:evidenceBefore,after:evidenceAfter,unchanged:true},originalAuthorUnchanged:true,sourceCopyUnchanged:true,
 helper:{path:'/tmp/viento-project-menu-author-archive.mjs',sha256:hash(await fs.readFile('/tmp/viento-project-menu-author-archive.mjs')),nativeBinarySha256:hash(await fs.readFile(nativeTool)),wrapperSha256:hash(await fs.readFile('/tmp/viento-project-menu-workspace-import/src/main.rs')),cargoLockSha256:hash(await fs.readFile('/tmp/viento-project-menu-workspace-import/Cargo.lock'))},limitations:['Native import was called through a temporary console wrapper compiled from the unmodified production workspace module; no installed desktop/native file picker was automated.','The existing standard format excludes the top-level README; it remains a separate ordinary tracked sidecar and is not falsely counted among the 103 archived author-data files.']};
await fs.writeFile(reportPath,JSON.stringify(receipts,null,2)+'\n');
console.log(JSON.stringify({ok:true,archive:receipts.archive,ignoredAssetCoverage:receipts.ignoredAssetCoverage,restoredFiles:103,restoredWithSidecar:104,sourceSnapshotId:sourcePlan.snapshotId,restoredSnapshotId:restoredPlan.snapshotId,reportPath,temporary},null,2));

// Read-only final consistency check; writes only this round's final-check.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = fileURLToPath(new URL('./', import.meta.url));
const json = async file => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
const local = name => json('docs/test-results/runtime-case-documents/' + name);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const preservation = {};
for (const name of ['historical-baseline','frozen-backend-baseline','rust-source-baseline','source-hashes']) {
  const expected = await local(name + '.json'), mismatches = [];
  for (const [file, hash] of Object.entries(expected)) if (sha(await fs.readFile(path.join(root, file))) !== hash) mismatches.push(file);
  assert.deepEqual(mismatches, []); preservation[name] = { files:Object.keys(expected).length, mismatches };
}
const old = await local('atlas-baseline.json'), atlas = await json('docs/function-atlas.json');
const oldAtlasPrefixPreserved = {};
for (const name of ['bindings','cells','evidence','dependencies','workflows','legacyCoverage','priorities']) {
  assert.deepEqual(atlas[name].slice(0,old[name].length),old[name]); oldAtlasPrefixPreserved[name] = true;
}
for (const [name, entries] of Object.entries(old.axes)) {
  assert.deepEqual(atlas.axes[name].slice(0,entries.length),entries); oldAtlasPrefixPreserved['axes.' + name] = true;
}
for (const [file, hash] of Object.entries(atlas.sourceSnapshot)) assert.equal(sha(await fs.readFile(path.join(root,file))),hash,file);
const report = await local('results.json'), prepared = await local('packaged-resources.json'), browser = await local('browser/browser.json');
for (const value of [report,prepared,browser,await local('docs-check.json'),await local('atlas-check.json')]) assert.equal(value.ok,true);
assert.equal(report.application.tests,1902); assert.equal(report.application.passed,1902);
for (const name of ['failed','skipped','cancelled']) assert.equal(report.application[name],0);
assert.equal(report.newRegressionTests.total,48);
assert.equal(new Set(browser.jobs.map(job => job.id)).size,6);
assert.deepEqual(browser.jobs.map(job => job.kind),['plan','build','run','run','run','run']);
assert.equal(browser.locales.length,3); assert.deepEqual(browser.errors,[]);
assert.equal(prepared.proofSourceSha256,sha(await fs.readFile(path.join(evidence,'packaged-check.mjs'))));
assert.equal(prepared.counts.offlineRuntimeSessions,6);
assert.equal(prepared.desktopChecks.length,2);
for (const backend of prepared.desktopChecks) {
  assert.equal(new Set(backend.observedJobs.map(job => job.id)).size,4);
  assert.deepEqual(backend.observedJobs.map(job => job.kind),['plan','build','run','run']);
  assert.equal(backend.fullArchiveStableIdentityAndBytes,true);
  assert.equal(backend.originalAuthorFilesUnchanged,true);
  assert.equal(backend.addedAuthorFiles.length,2);
  assert.equal(backend.archive.rootReadmeOutsideArchive,true);
  assert.equal(backend.sessions.length,3);
}
const cleanup = await local('cleanup.json');
assert.equal(cleanup.directories.length,7);
assert.equal(cleanup.freedAllocatedBytes,cleanup.directories.reduce((sum,item) => sum + item.allocatedBytes,0));
for (const item of cleanup.directories) {
  assert.equal(item.initialExists,false); assert.equal(item.removed,true);
  await assert.rejects(fs.stat(path.isAbsolute(item.path) ? item.path : path.join(root,item.path)),{code:'ENOENT'});
}
assert.equal((await json('package.json')).version,'0.0.8');
assert.equal((await fs.readFile(path.join(root,'VERSION'),'utf8')).trim(),'0.0.8');
const result = { ok:true,recordedAt:new Date().toISOString(),sourceVersion:'0.0.8',delivery:'unreleased-working-tree',
  oldAtlasPrefixPreserved,preservation,atlasFingerprintFiles:Object.keys(atlas.sourceSnapshot).length,
  currentApplicationTests:1902,newTestsIncluded:48,browserJobs:6,preparedOfflineSessions:6,
  nativeFullMigrations:2,generatedDirectoriesAbsent:true,freedAllocatedBytes:cleanup.freedAllocatedBytes,
  docsAndAtlasChecksPassed:true,readOnlyVerification:true };
await fs.writeFile(path.join(evidence,'final-check.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({ok:true,tests:1902,fingerprints:result.atlasFingerprintFiles,preservation}));

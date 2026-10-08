// Run after the frozen full check, Chrome and prepared-resource sessions finish.
// Only removes the seven paths recorded as absent at this round's start.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = fileURLToPath(new URL('./', import.meta.url));
const read = name => fs.readFile(path.join(evidence, name), 'utf8');
const json = async name => JSON.parse(await read(name));
const write = (name, value) => fs.writeFile(path.join(evidence, name), JSON.stringify(value, null, 2) + '\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const log = await read('app-check.log');
const stat = name => Number([...log.matchAll(new RegExp(`^ℹ ${name} ([\\d.]+)$`, 'gm'))].at(-1)?.[1]);
assert.ok(stat('tests') >= 1880); assert.equal(stat('pass'), stat('tests'));
for (const name of ['fail', 'skipped', 'cancelled']) assert.equal(stat(name), 0);
const browser = await json('browser/browser.json'), packaged = await json('packaged-resources.json');
assert.equal(browser.ok, true); assert.equal(packaged.ok, true);
assert.equal(new Set(browser.jobs.map(job => job.id)).size, 6);
assert.deepEqual(browser.jobs.map(job => job.kind), ['plan','build','run','run','run','run']);
const checks = {};
for (const name of ['historical-baseline','frozen-backend-baseline','rust-source-baseline','source-hashes']) {
  const entries = await json(name + '.json'), bad = [];
  for (const [file, expected] of Object.entries(entries)) if (hash(await fs.readFile(path.join(root, file))) !== expected) bad.push(file);
  checks[name] = { files: Object.keys(entries).length, mismatches: bad }; assert.deepEqual(bad, []);
}
await write('historical-preservation.json', { ok:true, recordedAt:new Date().toISOString(), checks,
  note:'History includes both prior unreleased tool-check and runtime-case evidence. Product/tests are a new final manifest; old evidence bytes and native/backend/WASM sources are retained.' });
for (const artifact of Object.values(packaged.artifacts)) {
  for (const [file, item] of Object.entries(artifact.hashes)) {
    assert.equal(hash(await fs.readFile(path.join(root, file))), item.sourceSha256, 'Prepared source mismatch: ' + file);
  }
}
const baseline = await json('generated-baseline.json');
const allowed = ['desktop/resources','desktop/ui/i18n','desktop/.cache','src-tauri/binaries','mobile/dist',
  '/tmp/viento-case-documents-native-target','/tmp/viento-case-documents-core-target'];
assert.deepEqual(Object.keys(baseline), allowed); assert.ok(Object.values(baseline).every(value => value === false));
async function allocated(directory) {
  let total = 0; const seen = new Set();
  async function walk(file) {
    const stat = await fs.lstat(file); const key = stat.dev + ':' + stat.ino;
    if (!seen.has(key)) { seen.add(key); total += stat.blocks * 512; }
    if (stat.isDirectory()) for (const name of await fs.readdir(file)) await walk(path.join(file, name));
  }
  await walk(directory); return total;
}
const directories = [];
for (const input of allowed) {
  const directory = path.isAbsolute(input) ? input : path.join(root, input), bytes = await allocated(directory);
  await fs.rm(directory, { recursive:true, force:true });
  await assert.rejects(fs.stat(directory), {code:'ENOENT'});
  directories.push({path:input, initialExists:false, allocatedBytes:bytes, removed:true});
}
const freedAllocatedBytes = directories.reduce((sum, item) => sum + item.allocatedBytes, 0);
await write('cleanup.json', { ok:true, recordedAt:new Date().toISOString(), directories, freedAllocatedBytes,
  freedGiB:freedAllocatedBytes / 2 ** 30, existingToolsUserDataPreferencesAndInstalledAppPreserved:true });
const report = { format:'viento-runtime-case-document-acceptance',schemaVersion:1,ok:true,recordedAt:new Date().toISOString(),
 sourceVersion:'0.0.8',sourceBaseCommit:'d36baad631550a99593efe388cf84aa238b79c5f',delivery:'unreleased-working-tree',
 changes:['Registered exact UTF-8 JSON envelope binds the existing pure runtime case to its stable scene identity.',
 'Fresh author catalog/load and atomic registration/save reuse ordinary document storage with independent scene/document SHA guards and publication rechecks.',
 'Three-language separate author-document controller supports explicit load/discard/new/save/save-copy without losing text, caret or author context.',
 'Selective package closure includes scene, registered definitions and optional scene child cases; reader/import guard checksums, declared requirements, instances and target bytes.',
 'CLI accepts saved envelope or old pure case; shared host and owned service reject mismatched frozen scenes before job/session creation.'],
 application:{tests:stat('tests'),passed:stat('pass'),failed:stat('fail'),skipped:stat('skipped'),cancelled:stat('cancelled'),durationMs:stat('duration_ms'),
 javascriptFiles:Number(log.match(/语法检查通过：(\d+) 个/)?.[1]),apiAndVersionPreflight:true,log:'app-check.log'},
 newRegressionTests:{total:48,portableDocument:11,authorHost:9,resourcePackages:13,documentUi:14,http:1,includedInApplicationTotal:true,
 uiTargeted:{tests:48,passed:48,new:14,existing:34,log:'ui-targeted-check.log',overlapsApplication:true}},
 browser:{browser:browser.browser,scenarios:browser.scenarios.length,localesAt390px:browser.locales.length,jobs:browser.jobs.length,runtimeExceptions:browser.errors.length,
 originalAuthorBytesUnchanged:browser.originalAuthorBytesUnchanged,newCaseFiles:browser.newCaseFiles,draftAndCaretPreserved:browser.draftAndCaretPreserved,
 evidence:'browser/browser.json',reproduction:'browser-check.mjs',visuallyInspected:'browser/zh-CN-390.png'},
 prepared:{embeddedNode:packaged.embeddedNode,desktopFullManifestFiles:packaged.artifacts['desktop/resources'].manifestFileCount,
 desktopFocusedSourceChecks:packaged.artifacts['desktop/resources'].checkedSourceFiles,mobileFullManifestFiles:packaged.artifacts['mobile/dist'].manifestFileCount,
 mobileFocusedSourceChecks:packaged.artifacts['mobile/dist'].checkedSourceFiles,counts:packaged.counts,mobilePortable:packaged.mobileChecks,
 evidence:'packaged-resources.json',reproduction:'packaged-check.mjs'},
 tools:packaged.externalTools,native:{freshBuiltAndUsed:true,offlineLocked:true,rustSourcesUnchanged:checks['rust-source-baseline'].files,standaloneRustTestsRerun:false,proof:'native-helpers-proof.json'},
 archive:{fullNativeMigrations:packaged.desktopChecks.length,standardAuthorDataRootsOnly:true,rootReadmeOutsideArchive:true,authorBytesAndStableIdentitiesPreserved:true},
 preservation:{historicalFiles:checks['historical-baseline'].files,frozenBackendAndWasmFiles:checks['frozen-backend-baseline'].files,rustSources:checks['rust-source-baseline'].files,
 productAndTestHashes:checks['source-hashes'].files,evidence:'historical-preservation.json'},
 cleanup:{directories:directories.length,freedAllocatedBytes,freedGiB:freedAllocatedBytes/2**30,evidence:'cleanup.json'},
 retainedInitialChecks:[
 {log:'author-package-check.log',tests:31,passed:30,failed:1,reason:'An illegal custom-v3 directory fixture was replaced with a legal v3-to-v2 path migration. Production directory validation was retained.'},
 {log:'author-package-http-check.log',tests:40,passed:38,failed:0,skipped:2,reason:'Existing real-Godot tests were environment-gated in this targeted command; the final complete application run supplied actual engines and native helpers and has no skips.'},
 {log:'browser-check-initial.log',result:'failed',reason:'The probe clicked Save before the final job had reached the UI poll. The browser proof now waits for the button to enable; no product change was needed.'},
 {log:'browser-check-second.log',result:'functional-pass',reason:'The intermediate UI still had pending en/ja translations; its three locale screenshots are retained but do not constitute final language acceptance.'},
 {log:'node-download.log',result:'failed',reason:'Direct TLS download failed; proxy download was verified against the pinned archive SHA before normal preparation.'}
 ],
 limits:['Existing pure case/control/trace, author scene/plan versions, adapter fingerprints, native/WASM remain unchanged.',
 'Only stable-ID migration; no clone UUID rewrite, automatic expected-value update, author script assertions or batch suite runner.',
 'Native full archive and prepared desktop actual engines were tested; mobile only pure document/case checks with admitted desktop samples.',
 'No installed Tauri window, Android execution/device, new version, commit/push, installer, tag or Release.'] };
await write('results.json',report);console.log(JSON.stringify({ok:report.ok,application:report.application,freedGiB:report.cleanup.freedGiB}));

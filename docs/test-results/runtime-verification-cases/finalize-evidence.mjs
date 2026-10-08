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
assert.equal(stat('tests'), 1854); assert.equal(stat('pass'), 1854);
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
  note:'History includes the prior unreleased tool-check evidence. Product/tests are a new final manifest; old evidence bytes and native/backend/WASM sources are retained.' });
for (const [file, item] of Object.entries(packaged.artifacts['desktop/resources'].hashes)) {
  assert.equal(hash(await fs.readFile(path.join(root, file))), item.sourceSha256, 'Prepared source mismatch: ' + file);
}
const baseline = await json('generated-baseline.json');
const allowed = ['desktop/resources','desktop/ui/i18n','desktop/.cache','src-tauri/binaries','mobile/dist',
  '/tmp/viento-runtime-cases-native-target','/tmp/viento-runtime-cases-core-target'];
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
const initialLog = await read('app-check-initial.log');
const report = { format:'viento-runtime-case-acceptance', schemaVersion:1, ok:true, recordedAt:new Date().toISOString(),
  sourceVersion:'0.0.8', sourceBaseCommit:'d36baad631550a99593efe388cf84aa238b79c5f', delivery:'unreleased-working-tree',
  changes:['Strict portable finite cases compose existing control programs with per-instance step position/state expectations.',
    'Shared host executes real backends and records case SHA plus separate passed/failed/incomplete evaluations; ordinary control behavior retained.',
    'Owned service/CLI and three-language editor accept explicit cases and sample-derived reference generation.',
    'Late cancellation during final persistence is saved cancelled/incomplete; committed records are not relabelled by a later service cancellation.',
    'Restored the old public instance-capability field condition found during compatibility checks.'],
  application:{tests:stat('tests'),passed:stat('pass'),failed:stat('fail'),skipped:stat('skipped'),cancelled:stat('cancelled'),
    durationMs:stat('duration_ms'),javascriptFiles:Number(log.match(/语法检查通过：(\d+) 个/)?.[1]),apiAndVersionPreflight:true,log:'app-check.log'},
  addedRegressionCases:{total:40,portableCore:13,host:6,service:6,UI:6,CLI:7,commitBoundaries:2,includedInApplicationTotal:true},
  initialChecks:{application:{tests:1854,passed:1854,failed:0,log:'app-check-initial.log',
      note:'Initial whole application passed, but the service changed while it ran. The complete frozen source, browser and prepared resources were checked again; only final proofs are used.'},
    compatibility:{issue:'Public controlTargets was widened to a global-only capability; restored the original instance-capability condition.',
      targetedInitial:{tests:92,passed:88,failed:1,skipped:3},finalTargeted:{tests:59,passed:59,failed:0,skipped:0},
      note:'Targeted figures came from the implementing agent; they overlap full application tests, not additional coverage.'},
    preparation:{logs:['desktop-prepare.log','desktop-prepare-proxy.log','node-download-recovery.log','node-download-resume.log','native-helpers-build-initial.log'],
      note:'Pinned Node downloads encountered network/TLS failures; a resumed download matched the locked archive SHA and normal preparation succeeded. Native helpers were initially started before the sidecar existed, then built offline/locked successfully.'},
    cancellation:{note:'The persistence-window issue was found in code review. The repair preceded the first boundary test run; there is no initial failing-run claim.'}},
  browser:{browser:browser.browser,scenarios:browser.scenarios.length,localesAt390px:browser.locales.length,jobs:browser.jobs.length,
    runtimeExceptions:browser.errors.length,uniqueJobCount:new Set(browser.jobs.map(job=>job.id)).size,
    authorBytesUnchanged:browser.authorBytesUnchanged,draftAndCaretPreserved:browser.draftAndCaretPreserved,
    evidence:'browser/browser.json',reproduction:'browser-check.mjs',visuallyInspected:'browser/zh-CN-390.png'},
  prepared:{embeddedNode:packaged.embeddedNode,desktopFullManifestFiles:packaged.artifacts['desktop/resources'].manifestFileCount,
    desktopFocusedSourceChecks:packaged.artifacts['desktop/resources'].checkedSourceFiles,
    mobileFullManifestFiles:packaged.artifacts['mobile/dist'].manifestFileCount,mobileFocusedSourceChecks:packaged.artifacts['mobile/dist'].checkedSourceFiles,
    counts:packaged.counts,mobilePortable:packaged.mobileChecks,evidence:'packaged-resources.json',reproduction:'packaged-check.mjs'},
  tools:packaged.externalTools,native:{freshBuiltAndUsed:true,offlineLocked:true,rustSourcesUnchanged:checks['rust-source-baseline'].files,
    standaloneRustTestsRerun:false,proof:'native-helpers-proof.json'},
  preservation:{historicalFiles:checks['historical-baseline'].files,frozenBackendAndWasmFiles:checks['frozen-backend-baseline'].files,
    rustSources:checks['rust-source-baseline'].files,productAndTestHashes:checks['source-hashes'].files,evidence:'historical-preservation.json'},
  cleanup:{directories:directories.length,freedAllocatedBytes,freedGiB:freedAllocatedBytes / 2 ** 30,evidence:'cleanup.json'},
  limits:['Only finite headless cases over no-behavior frozen Scene2D plan2; control schema1/2 and existing trace unchanged.',
    'No case registry, author-file persistence/migration, arbitrary script assertions, image comparison or real-time input.',
    'Prepared mobile only evaluates pure data using admitted desktop samples; no Android engine/device or installed Tauri window acceptance.',
    'Godot adapter0.5.0 and Bevy adapter/native0.3.0/Bevy0.19.1 plus author formats and old native/WASM unchanged.',
    'No new application version, commit/push, installer, installation, tag or GitHub Release.'] };
assert.match(initialLog,/ℹ pass 1854/);
await write('results.json',report);
console.log(JSON.stringify({ok:report.ok,application:report.application,freedGiB:report.cleanup.freedGiB}));

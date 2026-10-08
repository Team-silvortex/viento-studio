// Read-only release audit. Only a new review output in this directory is written.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyReleaseVersions, installerVersions } from '../../../desktop/version.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const directory = fileURLToPath(new URL('./', import.meta.url));
const outputName = process.argv[2] ?? 'review-final.json';
if (!/^review-[a-z0-9-]+\.json$/.test(outputName)) throw new Error('Use a new review-*.json output');
const outputFile = path.join(directory, outputName);
try { await fs.access(outputFile); throw new Error('Refusing to overwrite existing review'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const json = async name => JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const problems = [];
const check = (condition, area, message) => { if (!condition) problems.push({ area, message }); };
const run = async (...args) => (await promisify(execFile)('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 })).stdout;
const features = new Set(['execution.tool_identity', 'runtime.verification_cases',
  'runtime.case_documents', 'runtime.case_suites', 'runtime.case_reports']);
const documents = ['README.md', 'docs/README.md', 'docs/STATUS.md', 'docs/TESTING.md',
  'docs/ARCHITECTURE.md', 'docs/ROADMAP.md', 'docs/PROJECT_BUILD.md', 'docs/BACKEND_MIDDLEWARE.md',
  'docs/RUNTIME_CONTROL.md', 'docs/RUNTIME_CASES.md', 'docs/RUNTIME_CASE_SUITES.md',
  'docs/RUNTIME_CASE_REPORTS.md', 'docs/RELEASE_0.0.9.md', 'docs/FUNCTION_ATLAS.md',
  'docs/history/README.md', 'docs/history/VALIDATION.md', 'engine/README.md'];
const mechanicallyFormattedFile = 'engine/runtime-case-suite.mjs';
const originalReleaseSources = await json('source-hashes.json');
const finalReleaseSources = await json('final-source-hashes.json');
const formatting = await json('final-formatting.json');
const formattingBytes = await fs.readFile(path.join(root, mechanicallyFormattedFile));
const formattingBeforeHash = sha256(Buffer.concat([formattingBytes, Buffer.from('\n')]));
const formattingAfterHash = sha256(formattingBytes);
const sourceKeyChanges = !isDeepStrictEqual(Object.keys(originalReleaseSources).sort(), Object.keys(finalReleaseSources).sort());
const changedFinalHashes = Object.keys(originalReleaseSources).filter(file => originalReleaseSources[file] !== finalReleaseSources[file]);
const formattingByteProofValid = formattingBeforeHash === originalReleaseSources[mechanicallyFormattedFile] &&
  formattingAfterHash === finalReleaseSources[mechanicallyFormattedFile] &&
  formattingBytes.at(-1) === 10 && formattingBytes.at(-2) !== 10 && !sourceKeyChanges &&
  isDeepStrictEqual(changedFinalHashes, [mechanicallyFormattedFile]);
check(formattingByteProofValid, 'final-formatting', 'Final source change is not exactly one extra EOF LF removed');
check(formatting.ok === true && formatting.file === mechanicallyFormattedFile &&
  formatting.beforeSha256 === formattingBeforeHash && formatting.afterSha256 === formattingAfterHash &&
  formatting.removedBytes === 1 && formatting.removedByte === 10 && formatting.semanticsChanged === false &&
  formatting.fullAppPreparedAndArchiveBeforeThisFormatting === true,
  'final-formatting', 'Mechanical formatting evidence differs from raw byte proof or claimed scope');

async function hashes(entries, { allowVerifiedMechanicalFormatting = false } = {}) {
  const mismatches = [], mechanicalFormattingExceptions = [];
  for (const [file, expected] of Object.entries(entries)) {
    try {
      const actual = sha256(await fs.readFile(path.join(root, file)));
      if (actual !== expected) {
        if (allowVerifiedMechanicalFormatting && formattingByteProofValid && file === mechanicallyFormattedFile &&
          expected === formattingBeforeHash && actual === formattingAfterHash) {
          mechanicalFormattingExceptions.push({ file, recordedBeforeFormattingSha256: expected, actualFinalSha256: actual,
            difference: 'Exactly one LF byte removed at EOF; original byte proof retained' });
        } else mismatches.push({ file, expected, actual });
      }
    } catch (error) { mismatches.push({ file, expected, error: error.code ?? error.message }); }
  }
  return { files: Object.keys(entries).length, mismatches, mechanicalFormattingExceptions };
}

const version = await verifyReleaseVersions(root);
check(version.version === '0.0.9' && version.buildVersion === '0.0.9', 'version', 'Release version is not 0.0.9');
const counters = installerVersions(version.version);
check(counters.androidVersionCode === 1000009 && counters.macOSBundleVersion === '1.0.9',
  'version', 'Installer counters are inconsistent');
const versionFiles = await json('version-files.json');
check(versionFiles.ok === true && versionFiles.files.length === 9 &&
  versionFiles.version === version.version && versionFiles.androidVersionCode === counters.androidVersionCode &&
  versionFiles.macOSBundleVersion === counters.macOSBundleVersion, 'version', 'Version evidence differs');

const preservation = {};
for (const name of ['historical-baseline', 'frozen-backend-baseline', 'rust-source-baseline']) {
  preservation[name] = await hashes(await json(name + '.json'));
  check(preservation[name].mismatches.length === 0, 'preservation', name + ': changed or missing raw bytes');
}
check(preservation['historical-baseline'].files === 2017 &&
  preservation['frozen-backend-baseline'].files === 9 && preservation['rust-source-baseline'].files === 19,
  'preservation', 'Unexpected baseline counts');

const baseline = await json('atlas-baseline.json');
const atlas = JSON.parse(await fs.readFile(path.join(root, 'docs/function-atlas.json'), 'utf8'));
const prefix = {};
const featureChanges = [];
for (const [axis, entries] of Object.entries(baseline.axes)) {
  const changed = [];
  entries.forEach((before, index) => {
    const after = atlas.axes[axis]?.[index];
    if (axis === 'function' && features.has(before.id)) {
      check(after?.delivery === 'source-release', 'atlas-delivery', before.id + ' is not source-release');
      const a = { ...after }, b = { ...before };
      delete a.delivery; delete b.delivery;
      b.boundary = [...before.boundary];
      b.boundary[0] = '0.0.9源码交付；原0.0.8阶段协议与边界保留。' + before.boundary[0];
      b.platforms = before.platforms.map(value => value.startsWith('未发布版本')
        ? '0.0.9源码交付；未验收新安装/设备。' : value);
      if (!isDeepStrictEqual(a, b)) changed.push({ index, id: before.id, reason: 'Unauthorized feature field change' });
      featureChanges.push({ id: before.id, before: before.delivery, after: after?.delivery,
        preservedOldBoundaryWithReleaseProvenancePrefix: after?.boundary?.[0] === b.boundary[0],
        authorizedOldUnreleasedPlatformTextUpdated: before.platforms.some(value => value.startsWith('未发布版本')) });
    } else if (!isDeepStrictEqual(before, after)) changed.push({ index, id: before.id });
  });
  prefix['axes.' + axis] = { checked: entries.length, changed };
  check(changed.length === 0, 'atlas-prefix', axis + ': unauthorized old axis changes');
}
const bindingIds = [];
const bindingChanges = [];
baseline.bindings.forEach((before, index) => {
  const after = atlas.bindings[index];
  if (features.has(before.function)) {
    bindingIds.push(before.id);
    const a = { ...after }, b = { ...before };
    delete a.evidence; delete b.evidence;
    const same = isDeepStrictEqual(a, b) &&
      isDeepStrictEqual(after?.evidence?.slice(0, before.evidence.length), before.evidence);
    if (!same) bindingChanges.push({ index, id: before.id });
  } else if (!isDeepStrictEqual(before, after)) bindingChanges.push({ index, id: before.id });
});
check(bindingIds.length === 31, 'atlas-delivery', 'Expected exactly 31 newly source-delivered bindings');
check(bindingChanges.length === 0, 'atlas-prefix', 'Old binding definitions/evidence prefix changed');
prefix.bindings = { checked: baseline.bindings.length, changed: bindingChanges };
const deliveryUpgrades = [], cellChanges = [];
baseline.cells.forEach((before, index) => {
  const after = atlas.cells[index];
  if (features.has(before.coordinates[1]) && before.coordinates[3] === 'delivery') {
    if (!isDeepStrictEqual(before.coordinates, after?.coordinates) || before.value !== 2 || after?.value !== 3) {
      cellChanges.push({ index, coordinates: before.coordinates });
    }
    deliveryUpgrades.push({ coordinates: before.coordinates, before: before.value, after: after?.value });
  } else if (!isDeepStrictEqual(before, after)) cellChanges.push({ index, coordinates: before.coordinates });
});
check(deliveryUpgrades.length === 31 && cellChanges.length === 0, 'atlas-maturity', 'Only 31 delivery scores may change 2 to 3');
prefix.cells = { checked: baseline.cells.length, changed: cellChanges };
for (const key of ['evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']) {
  const same = isDeepStrictEqual(atlas[key]?.slice(0, baseline[key].length), baseline[key]);
  prefix[key] = { checked: baseline[key].length, oldPrefixPreserved: same };
  check(same, 'atlas-prefix', key + ': old ordered prefix changed');
}
check(isDeepStrictEqual(atlas.meta.historicalSha256, baseline.meta.historicalSha256),
  'atlas-prefix', 'Historical chain fingerprint changed');
check(atlas.meta.version === '0.0.9', 'atlas-version', 'Current atlas is not version 0.0.9');
const currentAtlasSources = await hashes(atlas.sourceSnapshot);
check(currentAtlasSources.mismatches.length === 0, 'atlas-source', 'Current atlas source fingerprint mismatch');
let generator;
try {
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/function-atlas.mjs', '--check'],
    { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 });
  generator = JSON.parse(stdout.trim());
  check(generator.ok === true, 'atlas-generator', 'Generated atlas failed check');
} catch (error) { generator = { ok: false, error: error.message }; check(false, 'atlas-generator', 'Generated atlas failed check'); }

function withoutFences(text) {
  let fence = null;
  return text.split('\n').map(line => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return '';
    }
    if (marker) { fence = marker[1]; return ''; }
    return line;
  }).join('\n');
}
function anchors(text, extension) {
  const found = new Set();
  for (const match of text.matchAll(/\b(?:id|name)\s*=\s*(["'])(.*?)\1/gi)) found.add(match[2]);
  if (extension !== '.md') return found;
  const counts = new Map();
  for (const match of withoutFences(text).matchAll(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const title = match[1].replace(/<[^>]*>/g, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\\([\\`*_{}\[\]()#+.!-])/g, '$1');
    const slug = title.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-');
    const count = counts.get(slug) ?? 0; counts.set(slug, count + 1);
    found.add(count ? `${slug}-${count}` : slug);
  }
  return found;
}
const broken = [], anchorCache = new Map(), documentHashes = {};
let localReferences = 0, localAnchors = 0;
for (const file of documents) {
  const bytes = await fs.readFile(path.join(root, file)); documentHashes[file] = sha256(bytes);
  const source = withoutFences(bytes.toString('utf8'));
  const matches = [...source.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\s*\)/g),
    ...source.matchAll(/^\s{0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gm)];
  for (const ref of matches) {
    const target = ref[1].replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;
    localReferences++;
    try {
      const hashIndex = target.indexOf('#');
      const fragment = hashIndex < 0 ? '' : decodeURIComponent(target.slice(hashIndex + 1));
      const pathname = decodeURIComponent((hashIndex < 0 ? target : target.slice(0, hashIndex)).split('?')[0])
        .replace(/:\d+(?::\d+)?$/, '');
      const destination = pathname ? path.resolve(path.dirname(path.join(root, file)), pathname) : path.join(root, file);
      const stat = await fs.stat(destination);
      if (fragment) {
        localAnchors++;
        if (!stat.isFile()) throw new Error('Anchor target is not a file');
        if (!anchorCache.has(destination)) anchorCache.set(destination,
          anchors(await fs.readFile(destination, 'utf8'), path.extname(destination).toLowerCase()));
        if (!anchorCache.get(destination).has(fragment)) throw new Error('Missing anchor: ' + fragment);
      }
    } catch (error) { broken.push({ file, target, error: error.code ?? error.message }); }
  }
}
check(broken.length === 0, 'docs-links', 'Broken local document links or anchors');

const result = await json('results.json');
check(result.ok === true && (result.sourceVersion ?? result.version) === '0.0.9',
  'release-result', 'Release result does not confirm 0.0.9');
const appLog = await fs.readFile(path.join(directory, result.application?.log ?? 'app-check.log'), 'utf8');
const appFacts = {};
for (const name of ['tests', 'pass', 'fail', 'skipped', 'cancelled'])
  appFacts[name] = Number([...appLog.matchAll(new RegExp(`^[ℹ#] ${name} (\\d+)$`, 'gm'))].at(-1)?.[1]);
appFacts.javascriptFiles = Number(appLog.match(/语法检查通过：(\d+) 个/)?.[1]);
check(appFacts.tests === 2017 && appFacts.pass === 2017 && appFacts.javascriptFiles === 430 &&
  [appFacts.fail, appFacts.skipped, appFacts.cancelled].every(value => value === 0),
  'application', 'Fresh 0.0.9 application log is not 2017 passed, 430 JS with no fails/skips/cancellations');
if (result.application) {
  for (const [field, name] of Object.entries({ tests: 'tests', passed: 'pass', failed: 'fail', skipped: 'skipped',
    cancelled: 'cancelled', javascriptFiles: 'javascriptFiles' })) {
    check(result.application[field] === appFacts[name], 'application', 'Result and app log differ: ' + field);
  }
}
const currentSourceManifest = originalReleaseSources;
const currentSourceHashes = await hashes(currentSourceManifest, { allowVerifiedMechanicalFormatting: true });
check(currentSourceHashes.mismatches.length === 0 && currentSourceHashes.files >= 520,
  'current-sources', 'Recorded pre-formatting source manifest differs beyond the proven one-byte correction');
const finalSourceHashes = await hashes(finalReleaseSources);
check(finalSourceHashes.mismatches.length === 0, 'final-sources', 'Final source manifest differs from current files');
const focusLog = await fs.readFile(path.join(directory, formatting.focused.log), 'utf8');
const focusFacts = {};
for (const name of ['tests', 'pass', 'fail', 'skipped', 'cancelled'])
  focusFacts[name] = Number([...focusLog.matchAll(new RegExp(`^[ℹ#] ${name} (\\d+)$`, 'gm'))].at(-1)?.[1]);
check(focusFacts.tests > 0 && focusFacts.tests === focusFacts.pass &&
  [focusFacts.fail, focusFacts.skipped, focusFacts.cancelled].every(value => value === 0),
  'final-formatting', 'Affected pure/host tests are not all passed after EOF correction');
for (const [field, name] of Object.entries({ tests: 'tests', passed: 'pass', failed: 'fail', skipped: 'skipped', cancelled: 'cancelled' }))
  check(formatting.focused[field] === focusFacts[name], 'final-formatting', 'Formatting test count differs: ' + field);
const prepared = await json('packaged-resources.json');
check(prepared.ok === true && prepared.version === '0.0.9' &&
  prepared.embeddedNode.version === 'v24.20.0' &&
  prepared.embeddedNode.sha256 === '89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7',
  'prepared', 'Prepared proof is not the new release under the pinned Node');
check(prepared.frozenSourceManifest.files === currentSourceHashes.files &&
  prepared.frozenSourceManifest.sha256 === sha256(await fs.readFile(path.join(directory, 'source-hashes.json'))) &&
  isDeepStrictEqual(prepared.frozenSourceManifest.hashes, currentSourceManifest),
  'prepared', 'Prepared source manifest and final release manifest differ');
check(prepared.proofSourceSha256 === sha256(await fs.readFile(path.join(directory, 'packaged-check.mjs'))),
  'prepared', 'Prepared reproduction source changed');
const preparedSourceChecks = {};
for (const [name, artifact] of Object.entries(prepared.artifacts)) {
  preparedSourceChecks[name] = await hashes(Object.fromEntries(Object.entries(artifact.hashes)
    .map(([file, item]) => [file, item.sourceSha256])), { allowVerifiedMechanicalFormatting: true });
  check(preparedSourceChecks[name].mismatches.length === 0 &&
    artifact.checkedSourceFiles === preparedSourceChecks[name].files &&
    artifact.manifestFileCount === Object.keys(artifact.manifest).length &&
    artifact.fullSourceCopyCount === artifact.manifestFileCount,
    'prepared', name + ': source or full prepared inventory mismatch');
}
const realCounts = { backends: prepared.desktopChecks.length, builds: prepared.desktopChecks.length,
  passedServiceSuites: prepared.desktopChecks.length, failedServiceSuitesWithContinuation: prepared.desktopChecks.length,
  batchReceipts: prepared.desktopChecks.reduce((sum, item) => sum + item.batchReceipts.length, 0),
  runtimeSessions: prepared.desktopChecks.reduce((sum, item) => sum + item.runtimeSessionIdsBeforeBuildPrune.length, 0),
  storedMemberReports: prepared.desktopChecks.reduce((sum, item) => sum + item.batchReceipts
    .reduce((count, receipt) => count + receipt.memberReports.length, 0), 0),
  onlineReportReads: prepared.desktopChecks.reduce((sum, item) => sum + item.onlineReportReads, 0),
  sourceOfflineAndBuildPrunedReportReads: prepared.desktopChecks.reduce((sum, item) => sum + item.offlineBuildPrunedReportReads, 0),
  actualCancellationAttempts: prepared.desktopChecks.filter(item => item.cancellation.attempted).length,
  cancelledNativeSuites: prepared.desktopChecks.filter(item => item.cancellation.nativeCancellationClaimed).length,
  actualPartialCancelledPrefixes: prepared.desktopChecks.filter(item => item.cancellation.partialPrefixObserved).length,
  archivesExportedOrRestoredThisProbe: 0 };
check(isDeepStrictEqual(prepared.counts, realCounts) && realCounts.backends === 2 &&
  prepared.mobileChecks.noNodeDomNetworkOrVendorImports === true &&
  prepared.mobileChecks.androidHostOrDeviceExecutionClaimed === false &&
  prepared.mobileChecks.androidUiAcceptanceClaimed === false &&
  prepared.mobileChecks.validatedActualReports === realCounts.storedMemberReports &&
  prepared.allPreparedManifestFilesVerified === true && prepared.sourceHashesStayedStable === true,
  'prepared', 'Actual prepared engine/report/mobile scope differs');
if (result.prepared?.counts) check(isDeepStrictEqual(result.prepared.counts, realCounts),
  'prepared', 'Release result and prepared actual counts differ');
const archive = await json('source-archive.json');
check(archive.ok === true && archive.archive.version === '0.0.9' &&
  archive.archive.allManifestEntriesVerifiedAgainstArchiveAndCurrentSource === true &&
  archive.archive.noDependenciesGeneratedRuntimeOrUserData === true &&
  archive.archive.bothRustCratesAndLocksIncluded === true &&
  archive.archive.allFourOfficialExamplesIncluded === true &&
  archive.archive.symbolicLinksAndDuplicatePathsAbsent === true &&
  archive.sourceOnlySnapshotBeforeFinalAuditAndCommit === true &&
  archive.temporarySourceArchiveAndOwnDirectoryRemoved === true &&
  archive.installedTauriOrAndroidAcceptanceClaimed === false &&
  archive.archiveMigrationExportOrRestoreClaimed === false &&
  archive.frozenSourceManifestSha256 === prepared.frozenSourceManifest.sha256 &&
  archive.proofSourceSha256 === prepared.proofSourceSha256 &&
  archive.archive.frozenSourceEntriesChecked === currentSourceHashes.files - archive.archive.frozenGeneratedSourcesExcluded.length,
  'source-archive', 'Temporary actual source archive result differs from release source or scope');
const archiveCurrentCriticalHashes = await hashes(Object.fromEntries(Object.entries(archive.archive.requiredFileHashes)
  .filter(([file]) => !file.startsWith('docs/')).map(([file, value]) => [file, value.sha256])),
  { allowVerifiedMechanicalFormatting: true });
check(archiveCurrentCriticalHashes.mismatches.length === 0, 'source-archive', 'Archive product source changed after acceptance');
const candidateFiles = (await run('ls-files', '-z', '--cached', '--others', '--exclude-standard')).split('\0').filter(Boolean);
const prohibited = candidateFiles.filter(file => /^(?:node_modules|workspaces|dist|desktop\/(?:resources|\.cache)|src-tauri\/(?:target|binaries)|mobile\/dist)\//.test(file)
  || /^crates\/[^/]+\/target\//.test(file) || /^(?:viento\.config\.json|engine\/studio-core\.(?:wasm|build\.json))$/.test(file)
  || /(?:^|\/)\.env(?:$|\.)/.test(file) || /(?:^|\/)(?:id_rsa|id_ed25519)(?:$|\.)/.test(file));
check(prohibited.length === 0, 'candidate-files', 'Generated resources/private runtime files present in Git candidate');
let workingDiffCheck, stagedDiffCheck;
try { await run('diff', '--check'); workingDiffCheck = true; }
catch (error) { workingDiffCheck = false; check(false, 'diff-check', error.stdout || error.message); }
try { await run('diff', '--cached', '--check'); stagedDiffCheck = true; }
catch (error) { stagedDiffCheck = false; check(false, 'staged-diff-check', error.stdout || error.message); }
const stagedFiles = (await run('diff', '--cached', '--name-only', '-z')).split('\0').filter(Boolean);

const output = { ok: problems.length === 0, recordedAt: new Date().toISOString(), readOnlyReview: true,
  sourceVersion: version.version, versionFiles: versionFiles.files.length, installerCounters: counters,
  preservation, atlas: { featureChanges, bindingIds, deliveryUpgrades, oldPrefixChecks: prefix,
    sourceFingerprintFiles: currentAtlasSources.files, sourceMismatches: currentAtlasSources.mismatches, generator },
  documents: { count: documents.length, localReferences, localAnchors, broken, sourceHashes: documentHashes },
  freshApplication: { ...appFacts, executionBeforeMechanicalEofCorrection: true },
  recordedReleaseSourceHashes: currentSourceHashes, finalSourceHashes,
  finalMechanicalFormatting: { file: mechanicallyFormattedFile, beforeSha256: formattingBeforeHash,
    afterSha256: formattingAfterHash, removedByte: 10, removedBytes: 1, rawByteProofValid: formattingByteProofValid,
    focusedAfterCorrection: focusFacts, applicationPreparedAndSourceArchiveExecutedBeforeCorrection: true,
    exactFinalCommitBytesClaimedByEarlierAcceptance: false },
  prepared: { version: prepared.version, executedBeforeMechanicalEofCorrection: true,
    sourceChecks: preparedSourceChecks, counts: realCounts, mobilePortable: prepared.mobileChecks },
  sourceArchive: { files: archive.archive.files, bytes: archive.archive.bytes,
    frozenSourceEntriesChecked: archive.archive.frozenSourceEntriesChecked,
    currentCriticalSources: archiveCurrentCriticalHashes, temporarySourceArchiveAndOwnDirectoryRemoved: true,
    finalCommitSnapshotClaimed: false },
  gitCandidate: { files: candidateFiles.length, prohibited, workingDiffCheck,
    stagedDiffCheck, stagedFiles: stagedFiles.length, stagedFileCheckDeferredUntilRootStages: stagedFiles.length === 0 },
  problems };
await fs.writeFile(outputFile, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(output));
if (problems.length) process.exitCode = 1;

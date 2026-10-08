// Read-only source/evidence review. Run after final prose and atlas generation.
// Only the two new audit JSON files below are written; existing files are refused.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const directory = fileURLToPath(new URL('./', import.meta.url));
const documents = [
  'docs/README.md', 'docs/STATUS.md', 'docs/TESTING.md',
  'docs/ARCHITECTURE.md', 'docs/ROADMAP.md', 'docs/PROJECT_BUILD.md',
  'docs/BACKEND_MIDDLEWARE.md', 'docs/RUNTIME_CONTROL.md',
  'docs/RUNTIME_CASES.md', 'docs/RUNTIME_CASE_SUITES.md',
  'docs/FUNCTION_ATLAS.md', 'engine/README.md'
];
const outputs = ['docs-check.json', 'atlas-prefix-check.json'];
for (const name of outputs) {
  try {
    await fs.access(path.join(directory, name));
    throw new Error(`Refusing to overwrite existing audit: ${name}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async name => JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
const problems = [];
const check = (condition, area, message) => {
  if (!condition) problems.push({area, message});
};
const relative = file => path.relative(root, file).split(path.sep).join('/');
const recordedAt = new Date().toISOString();
const result = await json('results.json');
const baseline = await json('atlas-baseline.json');
const atlas = JSON.parse(await fs.readFile(path.join(root, 'docs/function-atlas.json'), 'utf8'));

async function verifyHashes(entries) {
  const mismatches = [];
  for (const [file, expected] of Object.entries(entries)) {
    try {
      const actual = sha256(await fs.readFile(path.join(root, file)));
      if (actual !== expected) mismatches.push({file, expected, actual});
    } catch (error) {
      mismatches.push({file, expected, error: error.code ?? error.message});
    }
  }
  return {checked: Object.keys(entries).length, mismatches};
}

// Source snapshots intentionally change; the historical atlas data must be an
// exact ordered prefix, including old scores, reasons, dependency and evidence IDs.
const prefixes = {};
for (const [name, prior, current] of [
  ...Object.keys(baseline.axes).map(key => [`axis-${key}`, baseline.axes[key], atlas.axes[key]]),
  ...['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']
    .map(key => [key, baseline[key], atlas[key]])
]) {
  const changed = [];
  for (let index = 0; index < prior.length; index++) {
    if (!isDeepStrictEqual(prior[index], current?.[index])) {
      changed.push({index, id: prior[index].id ?? prior[index].coordinates ?? null});
    }
  }
  prefixes[name] = {checked: prior.length, current: current?.length ?? 0, changed};
  check(changed.length === 0, 'atlas-prefix', `${name}: ${changed.length} old entries changed or absent`);
}
check(isDeepStrictEqual(atlas.meta.historicalSha256, baseline.meta.historicalSha256),
  'atlas-prefix', 'Historical chain fingerprint changed');
const sourceFingerprints = await verifyHashes(atlas.sourceSnapshot);
check(sourceFingerprints.mismatches.length === 0, 'atlas-sources', 'Atlas source fingerprints do not match current files');
const atlasCounts = {
  ...Object.fromEntries(Object.entries(atlas.axes).map(([name, values]) => [name, values.length])),
  ...Object.fromEntries(['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']
    .map(name => [name, atlas[name].length])),
  referencedFiles: sourceFingerprints.checked
};
let generatorCheck;
try {
  const {stdout} = await promisify(execFile)(process.execPath,
    ['scripts/function-atlas.mjs', '--check'], {cwd: root, timeout: 30000, maxBuffer: 1024 * 1024});
  generatorCheck = JSON.parse(stdout.trim());
  check(generatorCheck.ok === true, 'atlas-generated', 'Atlas generator did not confirm generated files');
} catch (error) {
  generatorCheck = {ok: false, message: error.message, stdout: error.stdout ?? '', stderr: error.stderr ?? ''};
  check(false, 'atlas-generated', 'Read-only atlas generator check failed');
}
const suiteBindings = atlas.bindings.filter(binding => binding.function === 'runtime.case_suites');
const suiteScores = {};
for (const binding of suiteBindings) {
  suiteScores[binding.id] = Object.fromEntries(atlas.cells
    .filter(cell => isDeepStrictEqual(cell.coordinates.slice(0, 3),
      [binding.architecture, binding.function, binding.implementation]))
    .map(cell => [cell.coordinates[3], cell.value]));
  check(isDeepStrictEqual(suiteScores[binding.id], {
    implementation: 3, verification: 3, decoupling: 4, delivery: 2
  }), 'atlas-maturity', `Unexpected working-tree suite scores: ${binding.id}`);
}
check(suiteBindings.length > 0, 'atlas-maturity', 'Missing runtime.case_suites bindings');

// Preserve line offsets while excluding examples/code from the Markdown scanner.
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
function headingText(value) {
  return value.replace(/<[^>]*>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\\([\\`*_{}\[\]()#+.!-])/g, '$1');
}
function anchors(text, extension) {
  const found = new Set();
  for (const match of text.matchAll(/\b(?:id|name)\s*=\s*(["'])(.*?)\1/gi)) found.add(match[2]);
  if (extension !== '.md') return found;
  const source = withoutFences(text), counts = new Map();
  for (const match of source.matchAll(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const slug = headingText(match[1]).toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-');
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    found.add(count ? `${slug}-${count}` : slug);
  }
  return found;
}
function references(text) {
  const source = withoutFences(text), refs = [];
  const append = match => refs.push({target: match[1], line: source.slice(0, match.index).split('\n').length});
  for (const match of source.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\s*\)/g)) append(match);
  for (const match of source.matchAll(/^\s{0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gm)) append(match);
  return refs;
}
const anchorCache = new Map(), documentHashes = {}, documentText = new Map();
let localReferences = 0, localAnchors = 0, externalReferences = 0, currentEvidenceReferences = 0;
const broken = [];
for (const file of documents) {
  const bytes = await fs.readFile(path.join(root, file));
  documentHashes[file] = sha256(bytes);
  const text = bytes.toString('utf8');
  documentText.set(file, text);
  for (const ref of references(text)) {
    let target = ref.target.replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) { externalReferences++; continue; }
    localReferences++;
    if (target.includes('test-results/runtime-case-suites/')) currentEvidenceReferences++;
    try {
      const hashIndex = target.indexOf('#');
      const fragment = hashIndex < 0 ? '' : decodeURIComponent(target.slice(hashIndex + 1));
      const pathname = decodeURIComponent((hashIndex < 0 ? target : target.slice(0, hashIndex))
        .split('?')[0]).replace(/:\d+(?::\d+)?$/, '');
      const destination = pathname ? path.resolve(path.dirname(path.join(root, file)), pathname) : path.join(root, file);
      const stat = await fs.stat(destination);
      if (fragment) {
        localAnchors++;
        if (!stat.isFile()) throw new Error('Anchor target is not a file');
        if (!anchorCache.has(destination)) anchorCache.set(destination,
          anchors(await fs.readFile(destination, 'utf8'), path.extname(destination).toLowerCase()));
        if (!anchorCache.get(destination).has(fragment)) throw new Error(`Missing anchor: ${fragment}`);
      }
    } catch (error) {
      broken.push({file, line: ref.line, target: ref.target, error: error.code ?? error.message});
    }
  }
}
check(broken.length === 0, 'docs-links', `${broken.length} local links or anchors could not be resolved`);

const preserved = {};
const manifestCounts = {
  'historical-baseline': result.preservation.historicalFiles,
  'frozen-backend-baseline': result.preservation.frozenBackendAndWasmFiles,
  'rust-source-baseline': result.preservation.rustSources,
  'source-hashes': result.preservation.productAndTestHashes
};
for (const [name, expectedCount] of Object.entries(manifestCounts)) {
  const entries = await json(`${name}.json`);
  preserved[name] = await verifyHashes(entries);
  check(preserved[name].checked === expectedCount, 'preservation', `${name}: reported count does not match manifest`);
  check(preserved[name].mismatches.length === 0, 'preservation', `${name}: recorded bytes changed or missing`);
}
const applicationLog = await fs.readFile(path.join(directory, result.application.log), 'utf8');
const stat = name => Number([...applicationLog.matchAll(new RegExp(`^[ℹ#] ${name} ([\\d.]+)$`, 'gm'))].at(-1)?.[1]);
for (const [field, name] of Object.entries({tests: 'tests', passed: 'pass', failed: 'fail', skipped: 'skipped', cancelled: 'cancelled', durationMs: 'duration_ms'})) {
  check(stat(name) === result.application[field], 'application', `${field}: log and results differ`);
}
check(Number(applicationLog.match(/语法检查通过：(\d+) 个/)?.[1]) === result.application.javascriptFiles,
  'application', 'JavaScript preflight count differs from application log');
check(result.ok === true && result.application.tests === result.application.passed &&
  [result.application.failed, result.application.skipped, result.application.cancelled].every(value => value === 0),
  'application', 'Final full application result is not all passed with no skips');
check(result.newRegressionTests.includedInApplicationTotal === true &&
  ['portableSuite', 'authorAndSchedulerHost', 'resourcePackages', 'suiteUi', 'http']
    .reduce((sum, name) => sum + result.newRegressionTests[name], 0) === result.newRegressionTests.total,
  'application', 'New targeted test counts do not sum to the included total');

const browser = await json(result.browser.evidence), packaged = await json(result.prepared.evidence);
check(browser.ok === true && packaged.ok === true, 'acceptance', 'Final browser or prepared acceptance is not successful');
for (const [field, actual] of Object.entries({scenarios: browser.scenarios.length,
  localesAt390px: browser.locales.length, jobs: browser.jobs.length, runtimeExceptions: browser.errors.length})) {
  check(result.browser[field] === actual, 'browser', `${field}: result and browser evidence differ`);
}
check(browser.errors.length === 0 && new Set(browser.jobs.map(job => job.id)).size === browser.jobs.length,
  'browser', 'Browser exceptions or duplicate recorded job IDs');
check(result.browser.originalAuthorBytesUnchanged === true && browser.originalAuthorBytesUnchanged === true &&
  browser.draftAndCaretPreserved === true, 'browser', 'Browser author/draft preservation claim is not backed by final evidence');
const browserFingerprints = await verifyHashes(browser.sourceHashes);
check(browserFingerprints.mismatches.length === 0, 'browser', 'Browser evidence no longer matches source');
check(isDeepStrictEqual(result.prepared.embeddedNode, packaged.embeddedNode) &&
  isDeepStrictEqual(result.prepared.counts, packaged.counts) &&
  isDeepStrictEqual(result.prepared.mobilePortable, packaged.mobileChecks),
  'prepared', 'Prepared Node, counts or portable scope differs from final evidence');
const preparedFingerprints = {};
for (const [name, artifact] of Object.entries(packaged.artifacts)) {
  const entries = Object.fromEntries(Object.entries(artifact.hashes).map(([file, item]) => [file, item.sourceSha256]));
  preparedFingerprints[name] = await verifyHashes(entries);
  const manifestPrefix = name === 'desktop/resources' ? 'desktop' : 'mobile';
  check(artifact.manifestFileCount === result.prepared[`${manifestPrefix}FullManifestFiles`] &&
    artifact.checkedSourceFiles === result.prepared[`${manifestPrefix}FocusedSourceChecks`] &&
    artifact.checkedSourceFiles === Object.keys(entries).length,
    'prepared', `${name}: source or full manifest counts differ`);
  check(preparedFingerprints[name].mismatches.length === 0, 'prepared', `${name}: source fingerprints changed`);
}
check(sha256(await fs.readFile(path.join(directory, result.prepared.reproduction))) === packaged.proofSourceSha256,
  'prepared', 'Prepared reproduction script does not match its recorded fingerprint');
check(packaged.mobileChecks.noNodeDomOrNetworkGlobals === true &&
  packaged.mobileChecks.androidHostOrDeviceExecutionClaimed === false &&
  packaged.mobileChecks.androidUiAcceptanceClaimed === false,
  'delivery', 'Mobile proof scope is not restricted to portable data');
const native = await json(result.native.proof);
check(result.native.standaloneRustTestsRerun === false && native.independentRustTestsRerun === false &&
  native.freshBuild === true && native.offlineLocked === true, 'delivery', 'Native helper scope or standalone Rust claim differs');
check(result.sourceVersion === '0.0.8' && result.delivery === 'unreleased-working-tree',
  'delivery', 'This increment unexpectedly claims a new release');
const cleanup = await json(result.cleanup.evidence);
check(cleanup.ok === true && cleanup.directories.length === result.cleanup.directories &&
  cleanup.freedAllocatedBytes === result.cleanup.freedAllocatedBytes && cleanup.freedGiB === result.cleanup.freedGiB,
  'cleanup', 'Cleanup count/bytes differ from final results');
const cleanupStillPresent = [];
for (const entry of cleanup.directories) {
  try { await fs.lstat(path.isAbsolute(entry.path) ? entry.path : path.join(root, entry.path)); cleanupStillPresent.push(entry.path); }
  catch (error) { if (error.code !== 'ENOENT') cleanupStillPresent.push(entry.path); }
}
check(cleanupStillPresent.length === 0, 'cleanup', 'Reported generated directories remain present');

// These factual strings occur in the new current acceptance paragraphs; older
// acceptance sections intentionally retain their own counts.
for (const file of ['docs/STATUS.md', 'docs/TESTING.md', 'docs/RUNTIME_CASE_SUITES.md']) {
  const text = documentText.get(file);
  for (const value of [result.application.tests, result.application.javascriptFiles, result.newRegressionTests.total,
    result.prepared.desktopFullManifestFiles, result.prepared.mobileFullManifestFiles]) {
    check(text.includes(String(value)), 'docs-facts', `${file}: current acceptance count ${value} is absent`);
  }
  check(text.includes('test-results/runtime-case-suites/results.json'), 'docs-facts', `${file}: missing current evidence link`);
}
const retainedInitial = [];
for (const item of result.retainedInitialChecks) {
  const bytes = await fs.readFile(path.join(directory, item.log));
  retainedInitial.push({log: item.log, sha256: sha256(bytes), reason: item.reason});
}
check(result.retainedInitialChecks.some(item => item.log === 'app-check-initial.log' && item.failed === 1) &&
  result.retainedInitialChecks.some(item => item.log === 'suite-package-check-initial.log' && item.failed === 1),
  'initial-evidence', 'Initial real application/package failures are not separately retained');

const contracts = [
  {area: 'Author contract', finding: 'Exact four-field schema1 suite; 16KiB UTF-8 JSON, stable registered ordered 1–16 members, one scene. Each member is the existing case envelope; self, foreign scene, nested suite and unknown registration reject. Titles, results, paths and metadata relationship mirrors are absent from the author body.'},
  {area: 'Shared admission and budgets', finding: 'Existing no-behavior frozen plan2 and old control schemas1/2 are reused. All members are captured and admitted before a job/tool; aggregate actorCount×sum steps≤4096 and sum checks≤1024. Source/package validation checks known scenes and existing member structure even when other bodies are declared requirements; full aggregate admission waits until all member bodies exist.'},
  {area: 'Browser boundary', finding: 'Import-free suite contract owns the structural validator and summary. The author suite entry re-exports those same functions, adding source/dependency/plan parsing. GUI imports only the lightweight contract; original HTTP private YAML boundary is unchanged. First full/Chrome YAML404 failures and the reader deferred-scene failure are retained separately from final proofs.'},
  {area: 'Host order and cancellation', finding: 'Trusted host uses one captured author snapshot and ordered existing headless sessions. Every member rechecks the frozen build/snapshot/tool; pruned ownership is refused before job allocation. Assertion failure continues, execution/protocol failure or cancel stops remaining members, retains partial observations, reaps the process and releases the slot. The final committed member result survives late cancellation.'},
  {area: 'Result and time semantics', finding: 'Summary completed counts passed/failed/incomplete, excluding not-run. Queued/running means running; incomplete/not-run gives incomplete. Only entirely passed/failed members make complete true. Whole-batch execution deadline is120s; the old30s limit applies per engine phase, with termination/reaping before slot release, rather than a per-member wall-time promise.'},
  {area: 'Author UI, CLI and migration', finding: 'Three-language UI explicitly edits ordered saved membership, retains draft/caret and uses conflict/publication guards. CLI suite UUID/project-relative path mode requires fresh source and owned frozen build, excludes case/control/window/interactive/capture. Cache receipts and individual sessions are separate from author files. Selective closure/declared-requirement target checks and full standard-data-root archives preserve raw bytes and UUIDs; root README is outside archive data.'},
  {area: 'Delivery', finding: 'Unreleased0.0.8 working tree only. Native/backend/WASM and old control/trace/scene formats are preserved. Fresh offline-locked native helpers were used, with no independent Rust tests rerun. Prepared mobile tests portable data only; no new installation, installed Tauri acceptance, Android host/device execution, version, commit/push or Release is claimed.'}
];
const atlasReport = {
  format: 'viento-runtime-suite-atlas-prefix-audit', schemaVersion: 1,
  ok: problems.filter(item => item.area.startsWith('atlas')).length === 0, recordedAt,
  scope: 'Read-only ordered baseline prefixes and final current source fingerprints; no old atlas entry is rescored.',
  baselineSha256: sha256(await fs.readFile(path.join(directory, 'atlas-baseline.json'))),
  currentAtlasSha256: sha256(await fs.readFile(path.join(root, 'docs/function-atlas.json'))),
  counts: atlasCounts, generatorCheck, oldEntriesPreserved: prefixes,
  historicalMetaMatches: isDeepStrictEqual(atlas.meta.historicalSha256, baseline.meta.historicalSha256),
  sourceFingerprints, suiteScores,
  findings: problems.filter(item => item.area.startsWith('atlas'))
};
const report = {
  format: 'viento-runtime-suite-docs-review', schemaVersion: 1, ok: problems.length === 0, recordedAt,
  scope: 'Read-only review of twelve current guides, local links/anchors, atlas prefixes and final recorded acceptance. Only this new audit and atlas-prefix-check.json are written; no product test, native tool, browser or mobile test is rerun.',
  reviewer: 'control_core; implemented portable suite rules/tests earlier and independently reviewed host boundaries. This is not an external audit.',
  sourceVersion: result.sourceVersion, sourceBaseCommit: result.sourceBaseCommit, delivery: result.delivery,
  reviewedDocumentSha256: documentHashes,
  links: {reviewedDocuments: documents.length, localReferences, localAnchors,
    externalReferencesNotFetched: externalReferences, newAcceptanceEvidenceReferences: currentEvidenceReferences,
    broken, scannerScope: 'Markdown inline/reference links outside fenced code; duplicate GFM heading slugs plus explicit HTML id/name anchors. External sites were not fetched.'},
  contractReview: contracts, finalApplication: result.application,
  newRegressions: result.newRegressionTests, browser: {...result.browser, sourceFingerprints: browserFingerprints},
  prepared: {embeddedNode: result.prepared.embeddedNode, counts: result.prepared.counts,
    desktopFullManifestFiles: result.prepared.desktopFullManifestFiles,
    mobileFullManifestFiles: result.prepared.mobileFullManifestFiles,
    desktopFocusedSourceChecks: result.prepared.desktopFocusedSourceChecks,
    mobileFocusedSourceChecks: result.prepared.mobileFocusedSourceChecks,
    portableEntryModules: packaged.mobileChecks.entryModuleCount,
    portableModuleCount: packaged.mobileChecks.moduleCount,
    accepted: packaged.mobileChecks.acceptedCases, rejected: packaged.mobileChecks.rejectedCases,
    sourceFingerprints: preparedFingerprints, androidExecutionClaimed: false},
  preservation: preserved, atlas: {counts: atlasCounts, audit: 'atlas-prefix-check.json'},
  retainedInitialChecks: retainedInitial, cleanup: {...result.cleanup, stillPresent: cleanupStillPresent},
  finalEvidenceSha256: Object.fromEntries(await Promise.all([
    'results.json', result.browser.evidence, result.prepared.evidence,
    result.native.proof, result.preservation.evidence, result.cleanup.evidence
  ].map(async name => [name, sha256(await fs.readFile(path.join(directory, name)))]))),
  findings: problems
};
await fs.writeFile(path.join(directory, outputs[1]), JSON.stringify(atlasReport, null, 2) + '\n', {flag: 'wx'});
await fs.writeFile(path.join(directory, outputs[0]), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({ok: report.ok, documents: documents.length, localReferences, localAnchors,
  atlas: atlasCounts, fingerprints: sourceFingerprints.checked, historicalFiles: preserved['historical-baseline'].checked,
  findings: problems}));
if (!report.ok) process.exitCode = 1;

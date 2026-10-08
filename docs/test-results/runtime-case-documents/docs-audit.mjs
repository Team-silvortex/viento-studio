// Read-only acceptance audit. The only output is this round's docs-check.json.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = fileURLToPath(new URL('./', import.meta.url));
const documents = ['README.md', 'engine/README.md', 'docs/RUNTIME_CASES.md', 'docs/STATUS.md',
  'docs/ARCHITECTURE.md', 'docs/ROADMAP.md', 'docs/PROJECT_BUILD.md', 'docs/BACKEND_MIDDLEWARE.md',
  'docs/TESTING.md', 'docs/FUNCTION_ATLAS.md', 'docs/README.md'];
const problems = [], facts = [], hashes = new Map(), texts = new Map();
const check = (condition, description, detail = null) => { facts.push({ description, ok: Boolean(condition) }); if (!condition) problems.push({ description, detail }); };
const read = file => fs.readFile(path.resolve(root, file), 'utf8');
const json = async file => JSON.parse(await read(`docs/test-results/runtime-case-documents/${file}`));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function sha(file) {
  const absolute = path.resolve(root, file);
  if (!hashes.has(absolute)) hashes.set(absolute, (async () => {
    const hash = createHash('sha256'); for await (const chunk of createReadStream(absolute)) hash.update(chunk); return hash.digest('hex');
  })());
  return hashes.get(absolute);
}
async function text(file) { if (!texts.has(file)) texts.set(file, await read(file)); return texts.get(file); }
function prose(source) {
  let fence = null;
  return source.split('\n').map(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) { if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null; return ''; }
    if (marker) { fence = marker[1]; return ''; }
    return /^ {4}|^\t/.test(line) ? '' : line;
  }).join('\n').replace(/<!--[\s\S]*?-->/g, match => match.replace(/[^\n]/g, ''));
}
function entities(value) {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi, token => {
    const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
    if (named[token.toLowerCase()] !== undefined) return named[token.toLowerCase()];
    const code = token.toLowerCase().startsWith('&#x') ? parseInt(token.slice(3, -1), 16) : Number(token.slice(2, -1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : token;
  });
}
function anchors(source) {
  const body = prose(source), found = new Set(), counts = new Map();
  const heading = content => {
    const base = entities(content.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '').replace(/[`*_~\\]/g, ''))
      .toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').trim().replace(/\s/g, '-');
    let suffix = counts.get(base) || 0, slug = suffix ? `${base}-${suffix}` : base;
    while (found.has(slug)) slug = `${base}-${++suffix}`;
    counts.set(base, suffix + 1); found.add(slug);
  };
  const lines = body.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const atx = lines[index].match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (atx) heading(atx[1]);
    else if (index && /^ {0,3}(?:=+|-+)\s*$/.test(lines[index]) && lines[index - 1].trim()) heading(lines[index - 1].trim());
  }
  for (const match of body.matchAll(/<[^>]*\b(?:id|name)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi)) found.add(entities(match[1] || match[2] || match[3]));
  return found;
}
function references(source) {
  const body = prose(source).replace(/`[^`\n]*`/g, ''), refs = [];
  for (const start of body.matchAll(/\]\(\s*/g)) {
    let index = start.index + start[0].length, value = '', depth = 0;
    if (body[index] === '<') { const end = body.indexOf('>', index + 1); if (end >= 0) value = body.slice(index + 1, end); }
    else for (; index < body.length; index++) {
      const char = body[index];
      if (char === '\\' && index + 1 < body.length) { value += body[++index]; continue; }
      if (char === '(') depth++;
      if (char === ')' && !depth || /\s/.test(char) && !depth) break;
      if (char === ')') depth--; value += char;
    }
    if (value) refs.push({ target: entities(value), line: body.slice(0, start.index).split('\n').length });
  }
  for (const match of body.matchAll(/^ {0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm)) refs.push({ target: entities(match[1].replace(/^<|>$/g, '')), line: body.slice(0, match.index).split('\n').length });
  for (const match of body.matchAll(/<(?:a|img|source)\b[^>]*\b(?:href|src)\s*=\s*["']([^"']+)["'][^>]*>/gi)) refs.push({ target: entities(match[1]), line: body.slice(0, match.index).split('\n').length });
  return refs;
}
const linkSummary = { reviewedGuides: documents.length, localReferences: 0, localAnchors: 0, externalReferencesNotFetched: 0, broken: [] };
const documentSha256 = {};
for (const file of documents) {
  documentSha256[file] = await sha(file);
  for (const ref of references(await text(file))) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(ref.target)) { linkSummary.externalReferencesNotFetched++; continue; }
    linkSummary.localReferences++;
    try {
      const [pathname, fragment] = ref.target.split('#');
      const target = pathname ? path.relative(root, path.resolve(pathname.startsWith('/') ? root : path.dirname(path.resolve(root, file)), decodeURIComponent(pathname.split('?')[0].replace(/^\//, '')))) : file;
      const stat = await fs.stat(path.resolve(root, target));
      if (fragment) {
        linkSummary.localAnchors++;
        const anchor = decodeURIComponent(fragment), source = await text(target);
        const lineAnchor = anchor.match(/^L(\d+)(?:-L(\d+))?$/);
        if (lineAnchor ? Number(lineAnchor[2] || lineAnchor[1]) > source.split('\n').length : !anchors(source).has(anchor.replace(/^user-content-/, ''))) throw new Error(`Missing anchor ${anchor}`);
      }
      if (!stat.isFile() && !stat.isDirectory()) throw new Error('Not a file or directory');
    } catch (error) { linkSummary.broken.push({ file, ...ref, error: error.message }); }
  }
}
check(!linkSummary.broken.length, 'All local references and heading/HTML anchors resolve', linkSummary.broken);

const inventories = {};
async function inventory(name, expectedCount, provided = null) {
  const values = provided || await json(`${name}.json`), mismatches = [], entries = Object.entries(values);
  let cursor = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (cursor < entries.length) {
      const [file, expected] = entries[cursor++];
      try { const actual = await sha(file); if (actual !== expected.replace(/^sha256:/, '')) mismatches.push({ file, expected, actual }); }
      catch (error) { mismatches.push({ file, error: error.message }); }
    }
  }));
  inventories[name] = { checked: entries.length, mismatches };
  check(entries.length === expectedCount && !mismatches.length, `${name} count and bytes match`, inventories[name]);
}
const result = await json('results.json'), browser = await json('browser/browser.json'), prepared = await json('packaged-resources.json');
const ui = await json('ui-targeted-results.json'), cleanup = await json('cleanup.json'), native = await json('native-helpers-proof.json');
const preserved = await json('historical-preservation.json');
await inventory('historical-baseline', result.preservation.historicalFiles);
await inventory('frozen-backend-baseline', result.preservation.frozenBackendAndWasmFiles);
await inventory('rust-source-baseline', result.preservation.rustSources);
await inventory('source-hashes', result.preservation.productAndTestHashes);
for (const [name, item] of Object.entries(preserved.checks)) check(item.files === inventories[name]?.checked && !item.mismatches.length, `Recorded preservation agrees: ${name}`);
const baseline = await json('atlas-baseline.json'), atlas = JSON.parse(await read('docs/function-atlas.json'));
const atlasPrefixes = {};
for (const [name, old] of [...Object.entries(baseline.axes).map(([key, value]) => [`axes.${key}`, value]),
  ...['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities'].map(key => [key, baseline[key]])]) {
  const current = name.startsWith('axes.') ? atlas.axes[name.slice(5)] : atlas[name];
  atlasPrefixes[name] = { checked: old.length, preserved: current.length >= old.length && isDeepStrictEqual(current.slice(0, old.length), old) };
  check(atlasPrefixes[name].preserved, `Original atlas prefix preserved: ${name}`);
}
await inventory('atlas-sourceSnapshot', Object.keys(atlas.sourceSnapshot).length, atlas.sourceSnapshot);
const atlasCounts = { architectures: atlas.axes.architecture.length, functions: atlas.axes.function.length,
  implementations: atlas.axes.implementation.length, bindings: atlas.bindings.length, cells: atlas.cells.length,
  evidence: atlas.evidence.length, dependencies: atlas.dependencies.length, workflows: atlas.workflows.length,
  historicalChains: atlas.legacyCoverage.length, referencedFiles: Object.keys(atlas.sourceSnapshot).length };

const logCounts = log => Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped'].map(key => [key, Number(log.match(new RegExp(`(?:ℹ|#) ${key} (\\d+)`))?.[1])]));
const applicationLog = await text(`docs/test-results/runtime-case-documents/${result.application.log}`), app = logCounts(applicationLog);
check(app.tests === result.application.tests && app.pass === result.application.passed && app.fail === 0 && app.skipped === 0 && app.cancelled === 0, 'Application counts agree with final full log');
check(applicationLog.includes(`语法检查通过：${result.application.javascriptFiles} 个 JavaScript 文件`) && applicationLog.includes('API 契约预检通过') && applicationLog.includes('版本一致性检查通过：0.0.8'), '412 JS, API and source version preflights agree with final log');
check(result.sourceVersion === (await read('VERSION')).trim() && result.delivery === 'unreleased-working-tree' && result.ok, 'Source version/delivery are accurate');
const added = result.newRegressionTests;
check(added.total === added.portableDocument + added.authorHost + added.resourcePackages + added.documentUi + added.http && added.includedInApplicationTotal, 'New regressions sum once inside application total');
const uic = logCounts(await text(`docs/test-results/runtime-case-documents/${ui.log}`));
check(ui.status === 'passed' && uic.tests === ui.counts.tests && uic.pass === ui.counts.passed && !uic.fail && !uic.skipped && !uic.cancelled
  && ui.counts.tests === added.uiTargeted.tests && added.uiTargeted.existing + added.uiTargeted.new === ui.counts.tests && added.uiTargeted.overlapsApplication, '48 UI targeted cases include 14 new and 34 existing; not additive to full total');
check(ui.logSha256 === await sha(`docs/test-results/runtime-case-documents/${ui.log}`), 'UI log checksum matches summary');
await inventory('ui-targeted-source-hashes', Object.keys(ui.sourceHashes).length, ui.sourceHashes);
check(browser.ok && browser.scenarios.length === result.browser.scenarios && browser.jobs.length === result.browser.jobs
  && new Set(browser.jobs.map(job => job.id)).size === browser.jobs.length && browser.jobs.every(job => job.status === 'succeeded')
  && browser.errors.length === result.browser.runtimeExceptions, 'Fresh Chrome has 6 scenarios, 6 unique terminal jobs and no exceptions');
const expectedLabels = { 'zh-CN': ['保存用例', '载入用例'], en: ['Save case', 'Load case'], ja: ['用例を保存', '用例を読み込む'] };
check(browser.locales.length === result.browser.localesAt390px && browser.locales.every(item => item.width === 390 && item.scroll <= 390
  && item.dialog.every(dialog => dialog.scroll <= dialog.width) && item.save === expectedLabels[item.locale]?.[0] && item.load === expectedLabels[item.locale]?.[1]), 'Chrome records translated controls and no horizontal overflow for zh-CN/en/ja at 390px');
check(browser.originalAuthorBytesUnchanged === result.browser.originalAuthorBytesUnchanged && browser.newCaseFiles === result.browser.newCaseFiles
  && browser.draftAndCaretPreserved === result.browser.draftAndCaretPreserved, 'Chrome author bytes, expected new files and draft/caret facts agree');
for (const [name, full, focused] of [['desktop/resources', result.prepared.desktopFullManifestFiles, result.prepared.desktopFocusedSourceChecks],
  ['mobile/dist', result.prepared.mobileFullManifestFiles, result.prepared.mobileFocusedSourceChecks]]) {
  const item = prepared.artifacts[name];
  check(item.manifestFileCount === full && Object.keys(item.manifest).length === full && item.checkedSourceFiles === focused
    && Object.keys(item.hashes).length === focused && digest(JSON.stringify(item.manifest)) === item.manifestSha256
    && digest(JSON.stringify(item.hashes)) === item.checkedSourceSha256, `Prepared full and focused manifests agree: ${name}`);
  await inventory(`${name}-focused`, focused, Object.fromEntries(Object.entries(item.hashes).map(([file, value]) => [file, value.sourceSha256])));
}
check(prepared.ok && isDeepStrictEqual(prepared.embeddedNode, result.prepared.embeddedNode)
  && isDeepStrictEqual(prepared.counts, result.prepared.counts) && isDeepStrictEqual(prepared.mobileChecks, result.prepared.mobilePortable), 'Pinned embedded Node, dual-engine sessions and portable mobile facts agree');
check(prepared.desktopChecks.length === 2 && prepared.desktopChecks.every(item => item.pass.evaluation.status === 'passed'
  && item.fail.evaluation.status === 'failed' && item.fail.evaluation.failedChecks === 1 && item.cli.evaluation.status === 'passed'
  && item.sessions.length === 3 && item.originalAuthorFilesUnchanged && item.fullArchiveStableIdentityAndBytes
  && item.cliAcceptedSavedWrapper && item.frozenGeneratedProjectByteIdentical && item.sessionProjectRemoved), 'Both real backends record offline pass/fail/CLI sessions, native archive identity and immutable generated bytes');
check(native.ok && native.freshBuild && native.offlineLocked && native.independentRustTestsRerun === false
  && result.native.standaloneRustTestsRerun === false && prepared.mobileChecks.androidExecutionClaimed === false
  && prepared.mobileChecks.noNodeDomOrNetworkGlobals, 'Fresh native helpers and portable-only mobile scope do not claim new Rust or Android execution tests');
check(cleanup.ok && cleanup.directories.length === result.cleanup.directories && cleanup.directories.every(item => item.removed && item.initialExists === false)
  && cleanup.directories.reduce((sum, item) => sum + item.allocatedBytes, 0) === result.cleanup.freedAllocatedBytes
  && cleanup.freedAllocatedBytes === result.cleanup.freedAllocatedBytes, 'Cleanup removes only 7 newly-created directories and recorded allocated bytes agree');
for (const item of cleanup.directories) { try { await fs.stat(path.resolve(root, item.path)); check(false, 'Recorded cleanup directory remains absent', item.path); } catch (error) { check(error.code === 'ENOENT', 'Recorded cleanup directory remains absent', item.path); } }

const evidenceSha256 = {};
async function collect(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(file);
    else if (entry.name !== 'docs-check.json') evidenceSha256[path.relative(root, file)] = await sha(file);
  }
}
await collect(evidence);
const atlasSha256 = Object.fromEntries(await Promise.all(['docs/function-atlas.json','docs/FUNCTION_ATLAS.md','docs/function-atlas.html','docs/function-atlas.mmd'].map(async file => [file, await sha(file)])));
const report = { format: 'viento-runtime-case-document-docs-review', schemaVersion: 1, ok: problems.length === 0,
  recordedAt: new Date().toISOString(), sourceVersion: result.sourceVersion, delivery: result.delivery,
  scope: 'Read-only final 11-guide links/anchors, recorded acceptance facts, original bytes and atlas prefix/source audit. Writes only this new report; no product tests or external fetching.',
  reviewer: 'tool_host_ui; author of the GUI slice, then separately reviewed its documentation and evidence. Not an external audit.',
  documentSha256, links: linkSummary, inventories, atlas: { counts: atlasCounts, prefixes: atlasPrefixes, sha256: atlasSha256 }, facts,
  acceptance: { application: result.application, newRegressionTests: added, browser: result.browser, preparedCounts: result.prepared.counts,
    mobile: { entries: prepared.mobileChecks.entryModuleCount, modules: prepared.mobileChecks.moduleCount, accepted: prepared.mobileChecks.acceptedCases, rejected: prepared.mobileChecks.rejectedCases, androidExecutionClaimed: false },
    preservation: result.preservation, cleanup: result.cleanup },
  manualReview: [
    'Previous read-only behavior review identified the loaded scene CAS versus catalog refresh wording. Final RUNTIME_CASES now requires reload/review or explicit save-as; refresh never silently advances a loaded source version.',
    'New keeps current text, detaches the saved association and binds the selected scene. Complete-sample Generate keeps association in the same scene and detaches it across scenes; no automatic polling or expectation learning.',
    'Explicit loading confirms replacement of local edits; cancellation and late responses preserve drafts/caret. Unknown saves or closing a pending save block duplicate writes until explicit read reconciliation. Conflict never uses force.',
    'Bare runtime case execution remains independent of author-document IO. Author guards, offline frozen execution, translated feedback and limited desktop/mobile delivery descriptions match the reviewed controllers.',
    'Final report includes retained initial test/fixture and browser translation checks without promoting them to the final acceptance result. Whole-project, browser, prepared and historic Rust scopes are kept separate.'
  ], evidenceSha256, problems };
await fs.writeFile(path.join(evidence, 'docs-check.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: report.ok, guides: documents.length, links: linkSummary, inventories: Object.fromEntries(Object.entries(inventories).map(([name, value]) => [name, value.checked])), atlasCounts, failed: problems }, null, 2));
if (!report.ok) process.exitCode = 1;

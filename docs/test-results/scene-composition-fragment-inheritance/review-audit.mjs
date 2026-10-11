// Read-only audit of this unreleased mainline slice. Only a new report is written.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const directory = fileURLToPath(new URL('./', import.meta.url));
const output = path.join(directory, 'review-final.json');
try { await fs.access(output); throw new Error('Refusing to overwrite an existing audit'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const json = async name => JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const problems = [];
const check = (condition, area, message) => { if (!condition) problems.push({ area, message }); };
const documents = ['docs/SCENE_COMPOSITION.md', 'docs/STATUS.md', 'docs/ROADMAP.md',
  'docs/ARCHITECTURE.md', 'docs/TESTING.md', 'engine/README.md', 'docs/FUNCTION_ATLAS.md'];
const preservation = {};
for (const name of ['historical-baseline', 'frozen-backend-baseline', 'protected-scene-slices', 'source-hashes']) {
  const entries = await json(name + '.json'), mismatches = [];
  for (const [file, expected] of Object.entries(entries)) {
    try {
      const actual = sha256(await fs.readFile(path.join(root, file)));
      if (actual !== expected) mismatches.push({ file, expected, actual });
    } catch (error) { mismatches.push({ file, error: error.code ?? error.message }); }
  }
  preservation[name] = { files: Object.keys(entries).length, mismatches };
  check(mismatches.length === 0, 'raw-byte-preservation', name);
}
const baseline = await json('atlas-baseline.json');
const atlas = JSON.parse(await fs.readFile(path.join(root, 'docs/function-atlas.json'), 'utf8'));
const prefixes = {};
for (const [axis, entries] of Object.entries(baseline.axes)) {
  const changed = [];
  entries.forEach((before, index) => {
    const after = atlas.axes[axis]?.[index];
    if (axis === 'function' && before.id === 'scene.composition') {
      const expected = structuredClone(before);
      expected.boundary[13] = after.boundary[13]; expected.next = after.next;
      check(after.delivery === 'source-release', 'old-feature-delivery', before.id);
      if (!isDeepStrictEqual(expected, after)) changed.push({ index, id: before.id });
    } else if (axis === 'function' && ['scene.composition_canvas', 'scene.composition_batch_canvas', 'scene.composition_fragment_editor'].includes(before.id)) {
      const expected = structuredClone(before); expected.next = after.next;
      if (!isDeepStrictEqual(expected, after)) changed.push({ index, id: before.id });
    } else if (!isDeepStrictEqual(before, after)) changed.push({ index, id: before.id });
  });
  prefixes['axes.' + axis] = { checked: entries.length, changed };
  check(changed.length === 0, 'old-axis-prefix', axis);
}
for (const key of ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage']) {
  const same = isDeepStrictEqual(atlas[key].slice(0, baseline[key].length), baseline[key]);
  prefixes[key] = { checked: baseline[key].length, orderedPrefixPreserved: same };
  check(same, 'old-atlas-prefix', key);
}
check(isDeepStrictEqual(atlas.priorities.slice(1), baseline.priorities.slice(1)), 'atlas-priorities', 'Only current priority[0] may change');
check(isDeepStrictEqual(atlas.meta.historicalSha256, baseline.meta.historicalSha256), 'old-network', 'Historical fingerprints changed');
check(atlas.meta.version === '0.0.9' && atlas.meta.commit === '9065667363a99a28aa64855f49052f5ee1d6f581', 'atlas-base', 'Wrong source version/base');
check(atlas.axes.architecture.length === 11 && atlas.axes.function.length === 72 &&
  atlas.axes.implementation.length === 151 && atlas.bindings.length === 271 && atlas.cells.length === 1084 &&
  atlas.dependencies.length === 161 && atlas.workflows.length === 35 && atlas.legacyCoverage.length === 50, 'atlas-counts', 'Unexpected coordinates');
const feature = atlas.axes.function.find(item => item.id === 'scene.composition_fragment_inheritance');
check(feature?.delivery === 'working-tree', 'new-feature', 'Shared optional declaration restoration incorrectly claimed released');
const newBindings = atlas.bindings.slice(baseline.bindings.length);
check(newBindings.length === 4 && newBindings.every(item => item.function === feature.id), 'new-bindings', 'Wrong new binding scope');
check(isDeepStrictEqual(newBindings.map(item => item.id), ['b269', 'b270', 'b271', 'b272']), 'new-binding-ids', 'Unexpected stable IDs');
const newCells = atlas.cells.slice(baseline.cells.length);
check(newCells.length === 16 && newCells.every(item => item.coordinates[1] === feature.id), 'new-cells', 'Wrong new cell scope');
for (const binding of newBindings) {
  const values = atlas.axes.maturity.map(dimension => newCells.find(cell => isDeepStrictEqual(cell.coordinates,
    [binding.architecture, binding.function, binding.implementation, dimension.id]))?.value);
  check(isDeepStrictEqual(values, [3, 3, 4, 2]), 'new-maturity', binding.id);
}
const { stdout } = await promisify(execFile)(process.execPath, ['scripts/function-atlas.mjs', '--check'],
  { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 });
const generator = JSON.parse(stdout.trim()); check(generator.ok === true, 'atlas-generator', 'Generated views differ');
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

const result = await json('results.json'), prepared = await json('packaged-resources.json');
check(result.ok && result.sourceVersion === '0.0.9' && result.delivery === 'unreleased-working-tree', 'result', 'Incorrect delivery state');
check(prepared.ok && prepared.version === '0.0.9' && prepared.embeddedNode.version === 'v24.20.0', 'prepared', 'Prepared check failed');
check(sha256(await fs.readFile(path.join(directory, 'prepared-check.mjs'))) === prepared.proofSourceSha256, 'prepared-harness', 'Checked script changed after execution');
const generated = await json('generated-baseline.json'), cleanup = await json('cleanup.json');
check(cleanup.ok && cleanup.entries.length === 9, 'cleanup', 'Generated artifact cleanup incomplete');
for (const [name, before] of Object.entries(generated)) {
  check(before === false, 'cleanup-baseline', name);
  try { await fs.lstat(path.resolve(root, name)); check(false, 'cleanup-leftover', name); }
  catch (error) { check(error.code === 'ENOENT', 'cleanup-access', name); }
}
const unchangedHead = (await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
check(unchangedHead === result.baseCommit, 'git-head', 'Unrequested commit changed');
let diffCheck;
try {
  await promisify(execFile)('git', ['diff', '--check'], { cwd: root }); diffCheck = true;
} catch (error) { diffCheck = false; check(false, 'whitespace', error.stdout ?? error.message); }
const newTextFiles = [
  'crates/viento-studio-core/tests/fragment_inheritance.rs',
  'scripts/tests/scene-composition-fragment-inheritance.test.mjs',
  'scripts/tests/studio-core-composition-fragment-edit.test.mjs',
  'scripts/tests/scene-composition-fragment-inheritance-ui.test.mjs',
  'scripts/tests/scene-composition-fragment-inheritance-host.test.mjs',
  'scripts/tests/scene-composition-fragment-inheritance-bridge.test.mjs',
  'scripts/tests/scene-composition-fragment-inheritance-smoke.mjs',
  'docs/test-results/scene-composition-fragment-inheritance/prepared-check.mjs',
  'docs/test-results/scene-composition-fragment-inheritance/boundary-cases.mjs',
  'docs/test-results/scene-composition-fragment-inheritance/finalize-evidence.py',
  'docs/test-results/scene-composition-fragment-inheritance/review-audit.mjs'];
for (const name of newTextFiles) {
  const text = await fs.readFile(path.join(root, name), 'utf8');
  check(!/[ \t]+$/m.test(text) && !/\n\n$/.test(text), 'new-file-whitespace', name);
}
const audit = { ok: problems.length === 0, recordedAt: new Date().toISOString(),
  scope: 'Read-only final source/evidence/docs/atlas check; no release, installed GUI or device execution.',
  sourceVersion: result.sourceVersion, baseCommit: unchangedHead, preservation, prefixes,
  atlas: generator, docs: { checkedFiles: documents.length, localReferences, localAnchors, broken, documentHashes },
  preparedHarnessVerified: true, cleanupEntries: cleanup.entries.length, gitDiffCheck: diffCheck,
  problems, harnessSha256: sha256(await fs.readFile(fileURLToPath(import.meta.url))) };
await fs.writeFile(output, JSON.stringify(audit, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ok: audit.ok, sourceVersion: audit.sourceVersion, docLinks: localReferences,
  docAnchors: localAnchors, historicalFiles: preservation['historical-baseline'].files,
  sourceHashes: preservation['source-hashes'].files, atlas: generator, problems }));
assert.equal(audit.ok, true, 'Final review failed');

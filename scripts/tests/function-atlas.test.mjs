import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// Exercise the actual CLI on minimal disposable repositories. Never refresh
// production evidence or overwrite the repository's historical snapshots.
const script = fileURLToPath(new URL('../function-atlas.mjs', import.meta.url));
const historicalPaths = ['docs/FUNCTION_NETWORK.md', 'docs/function-network.json', 'docs/function-network.html', 'docs/function-network.mmd'];
const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
async function fixture(t, { evidencePath = 'engine/source.mjs' } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-atlas-cli-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (name, content) => { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), content); };
  const history = {};
  for (const name of historicalPaths) {
    const content = name.endsWith('.json') ? json({ workflows: [{ id: 'F01', label: 'Historical example' }] }) : `Historical fixture: ${name}\n`;
    await write(name, content); history[name] = digest(content);
  }
  await write(evidencePath, 'export const example = true;\n');
  const feature = (id, label) => ({ id, label, group: 'Fixture group', delivery: 'working-tree', entry: 'Test entry', platforms: ['Fixture only'], boundary: ['No production claim'], next: 'Review the next evidence' });
  const maturity = ['implementation', 'verification', 'decoupling', 'delivery'].map(id => ({ id, label: id, levels: ['zero', 'one', 'two', 'three', 'four', 'five'] }));
  const data = {
    schemaVersion: 1, meta: { date: '2026-10-13', version: 'fixture', commit: '1234567', scope: 'Disposable fixture', historicalSha256: history },
    axes: { architecture: [{ id: 'a', label: 'Architecture', responsibility: 'Fixture only' }],
      function: [feature('f.first', 'First'), feature('f.second', 'Second'), feature('f.gap', 'Remaining work')],
      implementation: [{ id: 'i', label: 'Implementation', kind: 'product', language: ['JavaScript'], paths: [evidencePath] }], maturity },
    evidence: [{ id: 'e', kind: 'source', path: evidencePath, note: 'Fixture source only' }],
    bindings: ['f.first', 'f.second', 'f.gap'].map((id, index) => ({ id: `b${index}`, architecture: 'a', function: id, implementation: 'i', role: 'Fixture role', evidence: ['e'] })),
    cells: ['f.first', 'f.second', 'f.gap'].flatMap(id => maturity.map(dimension => ({ coordinates: ['a', id, 'i', dimension.id], value: 1, reason: 'Fixture rationale' }))),
    dependencies: [{ from: 'f.first', to: 'f.second', relation: 'requires', reason: 'First supplies second' }],
    workflows: [{ id: 'W01', label: 'Reviewed path', steps: ['f.first', 'f.second'], boundary: 'Steps are not a completeness assertion' }],
    priorities: [{ label: 'Review remaining work', reason: 'Some work remains', acceptance: 'A scoped acceptance record', functions: ['f.gap'] }],
    legacyCoverage: [{ id: 'F01', label: 'Historical example', functions: ['f.first'], note: 'Mapping only' }], sourceSnapshot: {},
  };
  const dataPath = path.join(root, 'docs/function-atlas.json');
  const save = () => fs.writeFile(dataPath, json(data));
  await save();
  const run = (...flags) => {
    const result = spawnSync(process.execPath, [script, '--root', root, '--data', dataPath, ...flags], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.error, undefined, result.error?.message);
    return { ...result, output: result.stdout + result.stderr };
  };
  const read = name => fs.readFile(path.join(root, 'docs', name), 'utf8');
  const unchangedHistory = async () => {
    for (const name of historicalPaths) assert.equal(digest(await fs.readFile(path.join(root, name))), history[name], name);
  };
  return { root, data, dataPath, save, run, read, unchangedHistory, write };
}
function passed(result) { assert.equal(result.status, 0, result.output); }
function refused(result, message) {
  assert.notEqual(result.status, 0, result.output); assert.match(result.output, message);
  assert.doesNotMatch(result.output, /Cannot read properties|is not iterable|\.map is not a function/);
}

test('older workflows without gaps remain valid and explicitly unreviewed', async t => {
  const f = await fixture(t); passed(f.run('--write', '--refresh-sources')); passed(f.run('--check'));
  const markdown = await f.read('FUNCTION_ATLAS.md');
  assert.match(markdown, /缺口尚未梳理/); assert.match(markdown, /\| 路径 \| 功能步骤 \| 已登记缺口 \| 适用边界 \|/);
  assert.match(markdown, /function-atlas\.html#workflow=W01/);
  assert.equal(Object.hasOwn(JSON.parse(await f.read('function-atlas.json')).workflows[0], 'gaps'), false);
  await f.unchangedHistory();
});

test('explicit empty gaps mean no additional recorded gaps, never completion', async t => {
  const f = await fixture(t); f.data.workflows[0].gaps = []; await f.save(); passed(f.run('--write', '--refresh-sources'));
  assert.match(await f.read('FUNCTION_ATLAS.md'), /本次未登记额外缺口（不表示完成）/);
  assert.deepEqual(JSON.parse(await f.read('function-atlas.json')).workflows[0].gaps, []); passed(f.run('--check')); await f.unchangedHistory();
});

test('registered gaps link to their own function and stay separate from ordered steps', async t => {
  const f = await fixture(t); f.data.workflows[0].gaps = ['f.gap']; await f.save(); passed(f.run('--write', '--refresh-sources'));
  const row = (await f.read('FUNCTION_ATLAS.md')).split('\n').find(line => line.includes('function-atlas.html#workflow=W01'));
  assert.equal(row, '| [Reviewed path](function-atlas.html#workflow=W01) | [First](#f.first) → [Second](#f.second) | [Remaining work](#f.gap) | Steps are not a completeness assertion |');
  passed(f.run('--check'));
});

test('workflow steps reject malformed, short, duplicate and unknown references', async t => {
  const f = await fixture(t);
  for (const [steps, expected] of [[null, /expected function references array/], ['f.first', /expected function references array/], [['f.first'], /at least 2/], [['f.first', 'f.first'], /duplicate function reference f.first/], [['f.first', 'f.typo'], /unknown function reference f.typo/]]) {
    f.data.workflows[0].steps = steps; await f.save(); refused(f.run('--write', '--refresh-sources'), expected);
  }
  await f.unchangedHistory();
});

test('gaps reject malformed, duplicate, unknown and overlapping references', async t => {
  const f = await fixture(t);
  for (const [gaps, expected] of [[null, /W01 gaps: expected/], ['f.gap', /W01 gaps: expected/], [['f.gap', 'f.gap'], /duplicate function reference f.gap/], [['f.typo'], /unknown function reference f.typo/], [['f.first'], /both steps and gaps: f.first/], [[{ id: 'f.gap' }], /unknown function reference/]]) {
    f.data.workflows[0].gaps = gaps; await f.save(); refused(f.run('--write', '--refresh-sources'), expected);
  }
  await f.unchangedHistory();
});

test('workflow records require safe unique IDs, label and boundary text', async t => {
  const f = await fixture(t), original = structuredClone(f.data.workflows[0]);
  for (const workflow of [null, { ...original, id: 'W01&feature=f.gap' }, { ...original, label: '' }, { ...original, boundary: [] }]) {
    f.data.workflows = [workflow]; await f.save(); refused(f.run('--write', '--refresh-sources'), /Invalid workflow id|Incomplete workflow label\/boundary/);
  }
  f.data.workflows = [original, original]; await f.save(); refused(f.run('--write', '--refresh-sources'), /Duplicate workflow: W01/);
  f.data.workflows = {}; await f.save(); refused(f.run('--write', '--refresh-sources'), /Expected workflow array/);
});

test('priorities reject unknown references before Markdown rendering can crash', async t => {
  const f = await fixture(t); f.data.priorities[0].functions = ['f.mistyped']; await f.save();
  refused(f.run('--write', '--refresh-sources'), /Priority 1: unknown function reference f.mistyped/);
  await assert.rejects(f.read('FUNCTION_ATLAS.md'), { code: 'ENOENT' }); await f.unchangedHistory();
});

test('priorities require nonempty label, reason, acceptance and structured records', async t => {
  const f = await fixture(t), original = structuredClone(f.data.priorities[0]);
  for (const priority of [null, [], { ...original, label: '  ' }, { ...original, reason: 7 }, { ...original, acceptance: null }, { label: 'Missing fields' }]) {
    f.data.priorities = [priority]; await f.save(); refused(f.run('--write', '--refresh-sources'), /Priority 1: label\/reason\/acceptance/);
  }
  f.data.priorities = {}; await f.save(); refused(f.run('--write', '--refresh-sources'), /Expected priorities array/);
});

test('priority functions are nonempty arrays with unique known references', async t => {
  const f = await fixture(t);
  for (const [functions, expected] of [[[], /at least 1/], [null, /expected function references array/], ['f.gap', /expected function references array/], [['f.gap', 'f.gap'], /duplicate function reference f.gap/]]) {
    f.data.priorities[0].functions = functions; await f.save(); refused(f.run('--write', '--refresh-sources'), expected);
  }
});

test('the same feature can support separately scoped priorities and workflows', async t => {
  const f = await fixture(t); f.data.priorities.push({ ...f.data.priorities[0], label: 'Another acceptance scope' });
  f.data.workflows.push({ ...f.data.workflows[0], id: 'W02', gaps: ['f.gap'] }); await f.save();
  passed(f.run('--write', '--refresh-sources')); passed(f.run('--check'));
});

test('Markdown escapes workflow/priority labels and encodes unusual evidence link paths', async t => {
  const f = await fixture(t, { evidencePath: 'docs/evidence [x](image).md' });
  const hostile = '[open](javascript:alert(1)) <img src=x onerror=alert(1)> | row\n# heading';
  f.data.workflows[0].label = hostile; f.data.workflows[0].boundary = hostile;
  f.data.priorities[0].label = hostile; f.data.priorities[0].reason = hostile; f.data.priorities[0].acceptance = hostile;
  // Evidence links are included in the generated binding table for report/test evidence.
  f.data.evidence[0].kind = 'test'; await f.save(); passed(f.run('--write', '--refresh-sources'));
  const markdown = await f.read('FUNCTION_ATLAS.md');
  assert.doesNotMatch(markdown, /<img|\]\(javascript:|\n# heading/);
  assert.ok(markdown.includes('&lt;img')); assert.ok(markdown.includes('\\| row \\# heading'));
  assert.ok(markdown.includes('(../docs/evidence%20%5Bx%5D%28image%29.md)'));
  assert.ok(markdown.includes('](function-atlas.html#workflow=W01)')); passed(f.run('--check'));
});

test('dependency orientation explicitly states prerequisite from to consumer to', async t => {
  const f = await fixture(t); passed(f.run('--write', '--refresh-sources'));
  assert.match(await f.read('FUNCTION_ATLAS.md'), /前置能力 `from` → 使用者 `to`/);
  const diagram = await f.read('function-atlas.mmd'); assert.match(diagram, /prerequisite from -> consumer to/); assert.match(diagram, /f0 --> f1/);
});

test('check detects stale generated views without changing history and write repairs only views', async t => {
  const f = await fixture(t); passed(f.run('--write', '--refresh-sources'));
  await fs.appendFile(path.join(f.root, 'docs/FUNCTION_ATLAS.md'), '\nStale fixture edit\n');
  refused(f.run('--check'), /Generated view is stale: FUNCTION_ATLAS.md/); await f.unchangedHistory();
  passed(f.run('--write')); passed(f.run('--check')); await f.unchangedHistory();
});

test('changed source evidence requires explicit reviewed refresh and historical hashes never refresh', async t => {
  const f = await fixture(t); passed(f.run('--write', '--refresh-sources'));
  await f.write('engine/source.mjs', 'export const example = false;\n'); refused(f.run('--check'), /Referenced sources\/evidence changed/);
  passed(f.run('--write', '--refresh-sources')); passed(f.run('--check')); await f.unchangedHistory();
  await fs.appendFile(path.join(f.root, 'docs/FUNCTION_NETWORK.md'), 'Unexpected mutation\n');
  refused(f.run('--write', '--refresh-sources'), /Historical snapshot changed: docs\/FUNCTION_NETWORK.md/);
});

test('existing working-tree delivery and four-dimensional completeness gates remain enforced', async t => {
  const f = await fixture(t), cell = f.data.cells.find(item => item.coordinates[3] === 'delivery'); cell.value = 3; await f.save();
  refused(f.run('--write', '--refresh-sources'), /Unreleased work scored as released/);
  cell.value = 1; f.data.cells.pop(); await f.save(); refused(f.run('--write', '--refresh-sources'), /Missing score \(use explicit null if unassessed\)/);
});

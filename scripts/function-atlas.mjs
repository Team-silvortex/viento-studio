#!/usr/bin/env node
// The catalog is reviewed evidence, not an inferred call graph or test-coverage report.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { renderAtlasHtml } from './function-atlas-view.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let root = path.resolve(here, '..');
let dataPath = path.resolve(here, '../docs/function-atlas.json');
const options = new Set();
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root' || args[i] === '--data') {
    const flag = args[i++];
    if (!args[i] || args[i].startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--root') root = path.resolve(args[i]); else dataPath = path.resolve(args[i]);
  } else if (['--check', '--write', '--refresh-sources'].includes(args[i])) options.add(args[i]);
  else throw new Error(`Unknown option: ${args[i]}`);
}
if (options.size === 0 || (options.has('--check') && options.size > 1)) {
  console.log('Usage: node scripts/function-atlas.mjs --check | --write [--refresh-sources]');
  process.exit(options.size ? 1 : 0);
}
if (options.has('--refresh-sources') && !options.has('--write')) throw new Error('--refresh-sources requires --write after a new review');
const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const unique = (items, name) => {
  const result = new Map();
  for (const item of items) {
    assert(typeof item.id === 'string' && /^[a-zA-Z0-9_.-]+$/.test(item.id), `Invalid ${name} id`);
    assert(!result.has(item.id), `Duplicate ${name}: ${item.id}`);
    result.set(item.id, item);
  }
  return result;
};
assert(data.schemaVersion === 1, 'Unsupported atlas schema');
const dimensions = ['architecture', 'function', 'implementation', 'maturity'];
const axes = Object.fromEntries(dimensions.map(key => [key, unique(data.axes[key], key)]));
assert(JSON.stringify([...axes.maturity.keys()]) === JSON.stringify(['implementation', 'verification', 'decoupling', 'delivery']), 'Scoring axes must be implementation/verification/decoupling/delivery in that order');
for (const item of data.axes.maturity) assert(item.levels.length === 6, `${item.id}: six explicit score levels required`);
const evidence = unique(data.evidence, 'evidence');
const bindings = unique(data.bindings, 'binding');
unique(data.workflows, 'workflow');
const filePaths = new Set();
const relativeFile = async file => {
  assert(typeof file === 'string' && file && !path.isAbsolute(file) && !file.includes('\\') && !file.split('/').some(p => p === '..' || p === '.' || !p), `Unsafe evidence path: ${file}`);
  const realRoot = await fs.realpath(root), realFile = await fs.realpath(path.join(root, file));
  assert(realFile.startsWith(realRoot + path.sep) && (await fs.stat(realFile)).isFile(), `Not a repository file: ${file}`);
  filePaths.add(file);
};
for (const item of evidence.values()) {
  assert(['source', 'test', 'report', 'design'].includes(item.kind), `Unknown evidence kind: ${item.kind}`);
  assert(item.note?.trim(), `${item.id}: evidence scope missing`);
  await relativeFile(item.path);
}
for (const item of axes.implementation.values()) {
  assert(['product', 'prototype', 'planned', 'deferred', 'legacy'].includes(item.kind), `Unknown implementation kind: ${item.id}`);
  for (const file of item.paths) await relativeFile(file);
  assert(item.kind !== 'product' || item.paths.length, `${item.id}: product must have source files`);
}
const tuples = new Map();
for (const binding of bindings.values()) {
  const tuple = dimensions.slice(0, 3).map(d => binding[d]);
  tuple.forEach((id, i) => assert(axes[dimensions[i]].has(id), `${binding.id}: unknown ${dimensions[i]} ${id}`));
  assert(!tuples.has(tuple.join('|')), `Duplicate binding tuple: ${tuple}`);
  tuples.set(tuple.join('|'), binding);
  assert(binding.role?.trim() && binding.evidence.length, `${binding.id}: role/evidence required`);
  for (const id of binding.evidence) assert(evidence.has(id), `${binding.id}: unknown evidence ${id}`);
}
const cells = new Map();
for (const cell of data.cells) {
  assert(Array.isArray(cell.coordinates) && cell.coordinates.length === 4, 'Expected four-dimensional COO coordinate');
  cell.coordinates.forEach((id, i) => assert(axes[dimensions[i]].has(id), `Unknown coordinate ${id}`));
  const key = cell.coordinates.join('|');
  assert(!cells.has(key), `Duplicate cell: ${key}`);
  cells.set(key, cell);
  const binding = tuples.get(cell.coordinates.slice(0, 3).join('|'));
  assert(binding, `Unbound cell: ${key}`);
  assert(cell.value === null || (Number.isInteger(cell.value) && cell.value >= 0 && cell.value <= 5), `Score outside 0–5: ${key}`);
  assert(cell.reason?.trim(), `Missing score rationale: ${key}`);
  const impl = axes.implementation.get(binding.implementation);
  const localEvidence = binding.evidence.map(id => evidence.get(id));
  if (['planned', 'deferred'].includes(impl.kind) && cell.coordinates[3] === 'implementation') assert(cell.value <= 1, `Planned work scored as implemented: ${key}`);
  if (cell.coordinates[3] === 'verification' && cell.value >= 2) assert(localEvidence.some(e => e.kind === 'test' || e.kind === 'report'), `Verification lacks evidence: ${key}`);
  if (cell.coordinates[3] === 'verification' && cell.value >= 4) assert(localEvidence.some(e => e.kind === 'report'), `Runtime verification lacks report: ${key}`);
  if (cell.coordinates[3] === 'delivery' && cell.value >= 4) assert(localEvidence.some(e => e.kind === 'report' && e.installedScope), `Installed score lacks scoped acceptance: ${key}`);
  if (cell.coordinates[3] === 'delivery' && axes.function.get(binding.function).delivery === 'working-tree') assert(cell.value <= 2, `Unreleased work scored as released: ${key}`);
}
for (const binding of bindings.values()) for (const maturity of axes.maturity.keys()) {
  assert(cells.has([binding.architecture, binding.function, binding.implementation, maturity].join('|')), `Missing score (use explicit null if unassessed): ${binding.id}/${maturity}`);
}
for (const feature of axes.function.values()) {
  assert(['source-release', 'working-tree', 'prototype', 'planned', 'deferred', 'legacy'].includes(feature.delivery), `Invalid delivery stage: ${feature.id}`);
  assert(data.bindings.some(b => b.function === feature.id), `Unmapped feature: ${feature.id}`);
  assert(feature.boundary?.length && feature.next?.trim(), `Feature boundary/next missing: ${feature.id}`);
}
const edges = new Set();
for (const edge of data.dependencies) {
  assert(axes.function.has(edge.from) && axes.function.has(edge.to) && edge.from !== edge.to, `Invalid dependency: ${JSON.stringify(edge)}`);
  assert(['requires', 'planned'].includes(edge.relation) && edge.reason, 'Missing dependency semantics');
  const key = [edge.from, edge.to, edge.relation].join('|');
  assert(!edges.has(key), `Duplicate dependency: ${key}`); edges.add(key);
}
for (const workflow of data.workflows) {
  assert(workflow.steps.length > 1 && workflow.boundary, `Incomplete workflow: ${workflow.id}`);
  for (const id of workflow.steps) assert(axes.function.has(id), `Unknown workflow feature: ${id}`);
}
const legacy = JSON.parse(await fs.readFile(path.join(root, 'docs/function-network.json'), 'utf8')).workflows;
const legacyCoverage = unique(data.legacyCoverage, 'legacy chain');
assert(legacyCoverage.size === legacy.length, 'Historical chain mapping must be complete');
for (const old of legacy) {
  const mapped = legacyCoverage.get(old.id);
  assert(mapped && mapped.functions.length, `Unmapped historical chain: ${old.id}`);
  for (const id of mapped.functions) assert(axes.function.has(id), `Invalid historical mapping: ${id}`);
}
const historicalPaths = ['docs/FUNCTION_NETWORK.md', 'docs/function-network.json', 'docs/function-network.html', 'docs/function-network.mmd'];
assert(JSON.stringify(Object.keys(data.meta.historicalSha256).sort()) === JSON.stringify(historicalPaths.sort()), 'All four historical snapshots are required');
for (const [file, expected] of Object.entries(data.meta.historicalSha256)) {
  assert(/^[0-9a-f]{64}$/.test(expected), `Invalid historical hash: ${file}`);
  await relativeFile(file);
  assert(hash(await fs.readFile(path.join(root, file))) === expected, `Historical snapshot changed: ${file}`);
}
const current = {};
for (const file of [...filePaths].sort()) current[file] = hash(await fs.readFile(path.join(root, file)));
if (options.has('--refresh-sources')) data.sourceSnapshot = current;
else {
  assert(JSON.stringify(current) === JSON.stringify(data.sourceSnapshot), 'Referenced sources/evidence changed: review the affected scores, then --write --refresh-sources');
}
const scoreFor = (binding, dimension) => cells.get([binding.architecture, binding.function, binding.implementation, dimension].join('|'));
const md = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const fileLink = file => `[${file}](../${file})`;
const count = { architectures: axes.architecture.size, functions: axes.function.size, implementations: axes.implementation.size, bindings: bindings.size, cells: cells.size, dependencyEdges: edges.size, workflows: data.workflows.length, historicalChains: legacy.length, referencedFiles: filePaths.size };
const guide = `# 当前功能图谱：架构、功能、实现与成熟度

核对日期：**${data.meta.date}**。源码版本 **${data.meta.version}**；审查基线为提交 \`${data.meta.commit}\`，各项交付状态见下文。范围为本仓库已识别的能力与明确规划，不是全部未来功能的穷举，也不是运行时逐函数调用图。各项实测范围与执行条件见对应证据；源码验证不等于新安装包或设备验收。

[离线交互图谱](function-atlas.html) · [稀疏张量 JSON](function-atlas.json) · [依赖图 Mermaid](function-atlas.mmd) · [架构边界](ARCHITECTURE.md) · [当前平台](STATUS.md) · [旧 b.4.3 功能网络](FUNCTION_NETWORK.md)

## 模型与缺省语义

使用四维坐标 **T[架构 A, 功能 F, 实现 I, 评分维度 M] = 0–5 或 null**，按 COO 坐标列表保存。M 包含实现、验证、解耦、交付四项；它们是有序等级，**不计算总平均、完成百分比或测试覆盖率**。一个功能可有多条实现关系，例如布局规则同时关联 Rust 核心、WASM 桥和 JS 草稿视图。

- 只存已审查的架构／功能／实现关系。缺省组合表示未建立关系，不代表分数 0。
- 显式 \`0\` 表示有证据支持的未实现／未交付等状态；\`null\` 表示该项未评估或现阶段不适用。
- 每个已登记实现关系有四个评分单元，分别给出理由。评分只适用于该行范围，语言和代码量本身不能增加成熟度。
- 依赖边 \`requires\` 表示当前语义前置条件，\`planned\` 表示未来接入；均不是静态 import 或性能数据。工作流是业务路径索引，先后关系不保证每次操作调用所有步骤。
- 历史报告保留其日期、平台、跳过与样本边界。测试文件存在不等于此次运行过；旧安装包记录也不能证明未发布代码已交付。

## 规模

| 项目 | 数量 |
| --- | ---: |
${Object.entries(count).map(([k,v]) => `| ${{architectures:'架构区域',functions:'功能',implementations:'实现单元（含规划占位）',bindings:'已审查实现关系',cells:'显式评分单元',dependencyEdges:'语义依赖边',workflows:'工作流切片',historicalChains:'旧链路已映射',referencedFiles:'引用并校验指纹的文件'}[k]} | ${v} |`).join('\n')}

## 评分锚点

${data.axes.maturity.map(d => `### ${d.label}\n\n${d.levels.map((v,i) => `- **${i}**：${v}`).join('\n')}`).join('\n\n')}

最高等级需要额外证据，未使用并不意味着评分表有缺陷。\`delivery\` 中的 Linux 源码交付不能提升 Android／Windows／macOS；每个功能的实际平台限制见详情。

## 架构区域

| 区域 | 职责 |
| --- | --- |
${data.axes.architecture.map(a => `| ${md(a.label)} | ${md(a.responsibility)} |`).join('\n')}

## 当前优先缺口

${data.priorities.map((p,i)=>`${i+1}. **${p.label}**：${p.reason} 验收：${p.acceptance} 涉及 ${p.functions.map(id=>`[${axes.function.get(id).label}](#${id})`).join('、')}。`).join('\n')}

## 业务工作流

| 路径 | 功能步骤 | 适用边界 |
| --- | --- | --- |
${data.workflows.map(w => `| ${md(w.label)} | ${w.steps.map(id=>`[${md(axes.function.get(id).label)}](#${id})`).join(' → ')} | ${md(w.boundary)} |`).join('\n')}

## 功能与实现切片

四项分数按「实现／验证／解耦／交付」排列。详细逐项理由和证据类型可在交互图或 JSON 查询。现有与计划实现并列时，不互相继承成熟度。

${data.axes.function.map(f => {
  const bs = data.bindings.filter(b=>b.function === f.id);
  return `<a id="${f.id}"></a>\n### ${f.label}\n\n\`${f.id}\` · ${f.group} · ${{'source-release':'源码交付','working-tree':'未发布工作树','prototype':'独立原型','planned':'规划中','deferred':'暂缓','legacy':'历史能力'}[f.delivery]}\n\n入口：${f.entry}\n\n| 架构 | 实现／职责 | 四项评分 | 证据入口 |\n| --- | --- | --- | --- |\n${bs.map(b=>`| ${md(axes.architecture.get(b.architecture).label)} | **${md(axes.implementation.get(b.implementation).label)}**；${md(b.role)} | ${data.axes.maturity.map(d=>scoreFor(b,d.id).value ?? '—').join(' / ')} | ${b.evidence.map(id=>evidence.get(id)).filter(e=>e.kind!=='source').sort((a,b)=>(a.kind==='report'?0:1)-(b.kind==='report'?0:1)).slice(0,3).map(e=>fileLink(e.path)).join('、')} |`).join('\n')}\n\n平台：${f.platforms.join('、')}。边界：${f.boundary.join('；')}。\n\n下一步：${f.next}`;
}).join('\n\n')}

## 旧功能链路映射

旧版四份图谱原字节保留；F01–F50 均明确映射，其中遗留维护工具仍标为历史用途。此映射表示主题继承，不表示旧测试自动覆盖新增链路。

| 旧链 | 当前功能 | 备注 |
| --- | --- | --- |
${data.legacyCoverage.map(w=>`| ${w.id} ${md(w.label)} | ${w.functions.map(id=>`[${md(axes.function.get(id).label)}](#${id})`).join('、')} | ${md(w.note)} |`).join('\n')}

## 维护与验证

权威目录为 \`docs/function-atlas.json\`；编辑条目、证据、关系和评分后生成其他三种视图：

\`\`\`sh
node scripts/function-atlas.mjs --check
# 完成受影响条目的重新审查后，显式更新文件指纹和派生视图
node scripts/function-atlas.mjs --write --refresh-sources
\`\`\`

只改说明／评分而来源未变时可用 \`--write\`。检查包括 ID／坐标唯一性、文件路径、已发布／未发布评分门槛、四维完整性、旧 50 链映射、源码及证据指纹、派生视图一致性。它不证明评分正确或产品测试通过，也不能自动发现目录外新增功能；每次新增能力需人工补图并核对 [STATUS](STATUS.md) 与 [ROADMAP](ROADMAP.md)。报告路径是仓库相对路径，不读取作者工程或本机配置。交互页内嵌同一数据，可脱机筛选和点开证据；单独复制 HTML 后仍可浏览，但源码链接需保持仓库相对布局。
`;
const diagram = ['flowchart LR', '  %% Generated semantic dependency graph; dashed edges are planned integrations.'];
const nodeIds = new Map(data.axes.function.map((f, index) => [f.id, `f${index}`]));
const nodeId = id => nodeIds.get(id);
for (const group of new Set(data.axes.function.map(f=>f.group))) {
  diagram.push(`  subgraph g${diagram.length}["${group.replaceAll('"', '&quot;')}"]`);
  for (const feature of data.axes.function.filter(f=>f.group===group)) diagram.push(`    ${nodeId(feature.id)}["${feature.label.replaceAll('"','&quot;')}"]`);
  diagram.push('  end');
}
for (const edge of data.dependencies) diagram.push(`  ${nodeId(edge.from)} ${edge.relation === 'planned' ? '-.->' : '-->'} ${nodeId(edge.to)}`);
const output = { 'FUNCTION_ATLAS.md': guide, 'function-atlas.html': renderAtlasHtml(data), 'function-atlas.mmd': diagram.join('\n')+'\n' };
if (options.has('--write')) {
  if (options.has('--refresh-sources')) await fs.writeFile(dataPath, JSON.stringify(data,null,2)+'\n');
  for (const [file, content] of Object.entries(output)) await fs.writeFile(path.join(path.dirname(dataPath),file),content);
} else for (const [file, content] of Object.entries(output)) {
  assert(await fs.readFile(path.join(path.dirname(dataPath),file),'utf8') === content, `Generated view is stale: ${file}; run --write`);
}
console.log(JSON.stringify({ok:true,mode:options.has('--write')?'write':'check',...count},null,2));

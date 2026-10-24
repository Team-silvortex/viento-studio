// Append only this saved-scene instance preview slice; preserve historical axes,
// bindings, scores and evidence. Run after final browser/source review, then
// regenerate views with scripts/function-atlas.mjs --write --refresh-sources.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const file = 'docs/function-atlas.json';
const data = JSON.parse(await fs.readFile(file, 'utf8'));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const baseline = {
  "axes": {
    "architecture": "c0c162b547a15b34931e5c6483ce0706bb07098d680dcdbfe59e4c3e60dbde5e",
    "function": "78ee251733708b9c70a8d581c6e023e0e2e8b1580cfc45352e032f5bb4a853b6",
    "implementation": "21b6a7f288a561dda9886821201893d56ea01f639e292df44f26859c7e2de605",
    "maturity": "1e3198aa636e8f8b1076746bc7ad933058dfc5eff549f36c6ee52bebccd4dc7a"
  },
  "bindings": "b5a0d5a49612c7b6e8af31b550a533845aa037cac1025659973b8847e6100d30",
  "cells": "603784bf2201bb94463be3a5b728e966dfe843d3950368dabde51ab491faf72d",
  "evidence": "a5f83aca701443c4042dcf0a5f00cee3f9484b94452fd531b871fd1a68cba774",
  "dependencies": "b817d3263b9c40c95d199bb030908cd700656b11b3db611982ec90e58320efe3",
  "workflows": "bd39ff4abc56bf184cee54b9115cb62fc6ba88ed1f6b394327c97b45e34b5e1e",
  "legacyCoverage": "0d965b5d16c48677392f547aa1782f02a553dbc014d7ba234694e9c3279eaf2c",
  "priorities": "f8be10aa8bfd543a02769e811db7eae2d4c636afa458c3e7d8d6412d20d7bbd5"
};
for (const [key, expected] of Object.entries(baseline.axes)) assert.equal(hash(data.axes[key]), expected, `Reviewed axis changed: ${key}`);
for (const [key, expected] of Object.entries(baseline)) if (key !== 'axes') assert.equal(hash(data[key]), expected, `Reviewed history changed: ${key}`);
const browserPath = process.argv[2];
assert.equal(process.argv.length, 3, 'Pass the final reviewed browser.json path.');
assert.match(browserPath, /^docs\/test-results\/scene-animation-instance-preview\/browser-[a-zA-Z0-9_-]+\/browser\.json$/);
const browser = JSON.parse(await fs.readFile(browserPath, 'utf8'));
assert.equal(browser.ok, true); assert.equal(browser.sourceSnapshotUnchanged, true); assert.equal(browser.authorFilesUnchanged, true);
assert.deepEqual(browser.errors, []);
for (const [source, expected] of Object.entries(browser.sources)) {
  assert.equal(createHash('sha256').update(await fs.readFile(source)).digest('hex'), expected.replace(/^sha256:/, ''), `Reviewed browser source changed: ${source}`);
}
const previous = JSON.parse(JSON.stringify(data)), feature = 'scene.animation_instance_preview';
assert.ok(!data.axes.function.some(row => row.id === feature));
data.axes.function.push({ id: feature, label: '已保存场景的独立实例动画预览', group: '场景与构建',
  entry: '已保存场景快照→按实例预览→选择实例/片段→独立播放/暂停/跳转→局部停止或全部恢复静态',
  delivery: 'working-tree', platforms: ['Linux本机服务、Node共享领域与真实Chrome中英日390px', '保存态Canvas图形预览；未更新安装、Android或原生Godot/Bevy实例播放'],
  boundary: [
    '0.2.0之后工作树增量，沿现有场景预览能力增加独立实例会话、独立控件及视觉层；22模块/43能力、作者动画v1–v3、状态脚本v1–v5、Rust/WASM及项目运行协议保持。',
    '只接收既有品牌且ready的保存态动画目录；完整场景/动画来源修订与snapshotId固定在会话中。草稿、配方、伪造目录或跨来源身份不能变成此保存态能力。',
    '以轨道instanceId分组，每场景最多32个动画实例；即使共享同一对象定义、图片或片段UUID，仍分别持有clip/phase/position和active。时钟由宿主显式推进，0–86400秒单调。',
    '初始全部静态；选择、播放、暂停和跳转只改变目标实例控制，已播放兄弟按同一宿主时刻自然推进。暂停保持画面，停止恢复该实例静态，全部停止保留片段选择；自然到尾和重播独立。',
    '每实例过滤原有轨道后复用既有Rust inspect/sample/transport；命名片段和整段null兼容保持。没有JS插值、曲线复制、作者参数改写、后台自动播放或运行事件推断。',
    '每次操作先完成全部目标推进和采样才提交；非法目标/命令/时间、第二目标采样失败或核心不可用都不提交部分会话。快照冻结且逐实例保留原Rust局部时间、finished和sprite grid。',
    '独立视图以owner/generation取消迟到RAF；范围切换、隐藏、来源刷新和关闭撤销旧会话；浏览器后台在最后绘制帧暂停。三语切换保实例/片段/位置与焦点；全部恢复静态后解除布局锁。',
    'Canvas对整层各实例sample原子准入后替换视觉变换，标签、对象列表和作者逻辑位置不变。整场景旧预览继续默认可用，两种范围互斥，不把多个局部时间合并为虚构场景时间。',
    '真实Chrome用临时工程核对同定义两实例的独立片段/像素、单实例停止、自然完成与另一实例循环、三语390px、后台暂停、迟到回调和作者字节保持；未构建或启动行为/声音/物理。',
    '本切片不是运行时独立playhead、动画状态机实际驱动或新后端能力。旧Godot场景共享播放头、完成投递与回执语义保持，正式实例运行需另行设计target所有权与协议。'
  ],
  next: '将独立目标所有权、轨道归属和完成投递接入正式运行中间层，保留旧共享场景播放语义；先验证同片段多实例，再分别接入状态控制器和后端。'
});
for (const item of [
  { id: 'i452', label: '保存态独立实例播放会话与原子视觉层', kind: 'product', language: ['JavaScript'], paths: ['engine/scene-animation-instance-playback.mjs', 'engine/scene-animation-instance-visual-frame.mjs'] },
  { id: 'i453', label: '独立实例动画控件与场景预览范围接线', kind: 'product', language: ['JavaScript', 'CSS'], paths: ['web/modules/app-scene-preview-instance-animation.js', 'web/modules/app-scene-preview-animation.js', 'web/modules/app-scene-preview-canvas.js', 'web/modules/app-scene-preview.js', 'web/scene-preview.css'] }
]) data.axes.implementation.push(item);
const evidence = [
  ['source', 'engine/scene-animation-instance-playback.mjs', '品牌保存态目录、32目标独立状态、显式时钟与全部推进/采样成功后提交。'],
  ['source', 'engine/scene-animation-instance-visual-frame.mjs', '逐实例Rust样本的完整有界视觉层准入，不制造共同局部时间。'],
  ['source', 'engine/scene-animation-core.mjs', '复用既有纯Rust检查/transport/clip采样；本轮未改变桥接或WASM。'],
  ['source', 'web/modules/app-scene-preview-instance-animation.js', '独立时钟/单RAF、目标与片段控件、后台暂停、生命周期清理及三语。'],
  ['source', 'web/modules/app-scene-preview-animation.js', '旧整场景与新增实例范围互斥、保存态目录交接与视觉层撤销。'],
  ['test', 'scripts/tests/scene-animation-instance-playback.test.mjs', '真实WASM的两实例独立时刻/循环/完成/重播、32目标、静态与原子失败、无getter和来源脱离。'],
  ['test', 'scripts/tests/scene-animation-instance-visual-frame.test.mjs', '逐实例样本身份/重复/边界、sprite与整层原子准入。'],
  ['test', 'scripts/tests/scene-animation-preview-canvas.test.mjs', '独立样本的真实Canvas绘制调用与旧图集/逻辑布局边界。'],
  ['test', 'scripts/tests/scene-preview-instance-animation-ui.test.mjs', '真实领域控件、两实例独立操作、迟到RAF、后台暂停、失效撤销和三语保焦点。'],
  ['test', 'scripts/tests/scene-preview-animation-ui.test.mjs', '保存态父面板范围切换、现有整场景入口、静态恢复与来源替换。'],
  ['test', 'scripts/tests/scene-animation-instance-preview-smoke.mjs', '真实Chrome临时工程的像素/实例操作、完成/循环、语言和生命周期验收。'],
  ['report', browserPath, '最终固定源码浏览器验收；同定义两实例视觉独立、三语390px与无作者写入，未运行引擎或更新安装。'],
  ['report', 'docs/test-results/scene-animation-instance-preview/README.md', '本轮限定领域/UI/旧回归与浏览器证据及正式运行尚未接入的边界。']
];
let evidenceNumber = Math.max(...data.evidence.map(row => Number(row.id.slice(1))));
const evidenceIds = [];
for (const [kind, path, note] of evidence) {
  assert.ok((await fs.stat(path)).isFile(), path);
  const id = `e${++evidenceNumber}`; evidenceIds.push(id); data.evidence.push({ id, kind, path, note });
}
for (const [id, architecture, implementation, role, separation, explanation] of [
  ['b659', 'semantic-js', 'i452', '封装独立目标时钟/原子会话，消费既有Rust结果；视觉层完整核验后才交给渲染。', 4, '同一会话与视觉层准入规则已在Node和实际Chrome复用，渲染、时钟来源与作者I/O不进入纯规则。'],
  ['b660', 'ui', 'i453', '只持有保存态预览会话、单RAF和选择控件；父面板持有范围、Canvas与布局入口。', 3, '独立组件以setFrames/context和显式时钟注入协作；正式运行后端或替代渲染端未在此接入。'],
  ['b661', 'rust-core', 'i385', '复用现有目标无关的Rust transport和命名片段采样，JS只提供按实例分组的冻结轨道。', 4, '既有同一WASM规则在Node定向测试和真实Chrome预览复用，本轮无新ABI或核心算法。']
]) {
  data.bindings.push({ id, architecture, function: feature, implementation, role, evidence: evidenceIds });
  for (const [maturity, value, reason] of [
    ['implementation', 4, '声明的保存态实例选择、独立时钟/片段、自然完成、静态恢复及失效清理形成预览闭环；正式运行另列。'],
    ['verification', 4, '真实WASM领域、视图与Canvas回归及真实Chrome像素/操作验证覆盖本次限定预览；不继承安装或Godot运行成绩。'],
    ['decoupling', separation, explanation],
    ['delivery', 2, '0.2.0之后源码工作树；未提交新版本、更新安装或验收其他设备。']
  ]) data.cells.push({ coordinates: [architecture, feature, implementation, maturity], value, reason });
}
for (const [from, reason] of [
  ['scene.saved_preview', '复用保存态场景快照、实例和图像租约；不把未保存原文作为动画运行输入。'],
  ['scene.instances_v2', '稳定instanceId区分同一定义的多个场景对象。'],
  ['scene.animation2d', '复用已保存动画目录、视觉轨道和整场景预览宿主。'],
  ['scene.animation_clips', '沿用已有片段UUID和Rust局部窗口，整段null兼容保留。'],
  ['core.wasm_bridge', '目标独立transport与sample仍由既有Rust/WASM规则执行。']
]) data.dependencies.push({ from, to: feature, relation: 'requires', reason });
data.workflows.push({ id: 'scene-animation-instance-preview', label: '保存态场景→按实例片段/时间预览→局部或全部恢复静态',
  steps: ['scene.instances_v2', 'scene.saved_preview', 'scene.animation2d', 'scene.animation_clips', feature], gaps: [],
  boundary: '保存态图形预览独立纵切；不执行状态脚本、事件、行为、声音或物理，不写作者数据、不构建工程或更新安装，正式后端独立播放仍需新设计。' });
data.meta.date = '2026-10-24';
data.meta.commit = '5e6b92e82b34d035996b0df2b9e3c3a3efacf4c4';
data.meta.scope = `0.2.0之后工作树追加已保存场景独立实例动画预览：${data.axes.function.length}功能/${data.axes.implementation.length}实现/${data.bindings.length}绑定/${data.cells.length}评分/${data.workflows.length}工作流。新增JS独立会话、视觉层和控件，复用既有Rust/WASM；22模块/43能力及作者/后端/运行协议保持。新范围通过限定保存态预览验收，未更新安装或正式后端实例playhead；原${previous.cells.length}评分/${previous.evidence.length}证据及旧前缀全保留。此前范围保留其原时点：` + previous.meta.scope;
for (const [key, entries] of Object.entries(previous.axes)) assert.deepEqual(data.axes[key].slice(0, entries.length), entries);
for (const key of ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']) assert.deepEqual(data[key].slice(0, previous[key].length), previous[key]);
assert.deepEqual(data.meta.historicalSha256, previous.meta.historicalSha256);
await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n');
console.log(JSON.stringify({ feature, functions: data.axes.function.length, implementations: data.axes.implementation.length, bindings: data.bindings.length, cells: data.cells.length, evidence: data.evidence.length, workflows: data.workflows.length, historicalPrefixes: 'unchanged' }, null, 2));

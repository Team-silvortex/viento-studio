// Append the current-binding configuration slice; historical coordinates and evidence remain exact.
// Run once from the reviewed repository root, then refresh generated views only after sources freeze.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const file = 'docs/function-atlas.json';
const data = JSON.parse(await fs.readFile(file, 'utf8'));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const baseline = {
  "axes": {
    "architecture": "c0c162b547a15b34931e5c6483ce0706bb07098d680dcdbfe59e4c3e60dbde5e",
    "function": "45796e540d8e5ed6f87c2db69e83e9dd6186dfad8b8e8054e4e5ee0898ef991e",
    "implementation": "558863355ef3c980facbd8605301442d448a7499b05f35003f7bc40ccd1e70ae",
    "maturity": "1e3198aa636e8f8b1076746bc7ad933058dfc5eff549f36c6ee52bebccd4dc7a"
  },
  "bindings": "5606a287406ada7c8b64947215e78a18bca43f1ffe23bc925966ac206f3c4526",
  "cells": "ed03de0b67384cb6b53b5b968c8c11e5769bf663e9ddd773a1cf63b2c6df4191",
  "evidence": "c95644fdd1c2ee9a273eebc825ead237787be9b81537d7549bacaa64d0e37537",
  "dependencies": "a0e1c007ed4aa27a00e17f0c8470b57e23304a9e6096d17efd0942d938707dbf",
  "workflows": "2086a6f962a7650f61c0dc34cadf2601a2edc4f2150d4ea4527e3dc4cbc4ac6e",
  "legacyCoverage": "0d965b5d16c48677392f547aa1782f02a553dbc014d7ba234694e9c3279eaf2c",
  "priorities": "f8be10aa8bfd543a02769e811db7eae2d4c636afa458c3e7d8d6412d20d7bbd5"
};
for (const [key, expected] of Object.entries(baseline.axes)) assert.equal(hash(data.axes[key]), expected, `Reviewed axis changed: ${key}`);
for (const [key, expected] of Object.entries(baseline)) if (key !== 'axes') assert.equal(hash(data[key]), expected, `Reviewed history changed: ${key}`);
const previous = JSON.parse(JSON.stringify(data));
const feature = 'authoring.animation_state_bindings';
assert.ok(!data.axes.function.some(row => row.id === feature));
data.axes.function.push({ id: feature, label: '当前行为绑定的状态与动画片段配置', group: '内容与作者工具',
  entry: '已保存严格状态脚本→当前行为绑定→读取本场景片段→按状态选择→应用参数表→全文审阅/普通保存→既有Godot运行',
  delivery: 'working-tree', platforms: ['Linux本机服务、Node领域/HTTP与Chrome中英日390px', '真实Godot4.7.2无头读取GUI保存的绑定；本轮未更新安装或验收Android/Bevy动画'],
  boundary: [
    '0.2.0之后工作树增量，仅针对当前单个行为绑定；新纯模型、可选目录元数据与独立选择视图，不增加系统模块、Rust/WASM、作者格式、后端或运行协议。',
    '仅从完整匹配内置v1–v5生成文本的已保存GDScript发现状态、clip参数名和完成边；复用原严格声明读取，手改/未知版本/可选核心不可用时不猜测脚本，普通参数编辑仍保持。',
    '状态映射描述最多16状态，绑定参数仍限32行；源目录仅增加可选animationStateBindings，现有parameterContract与依赖修订语义保持，无脚本执行或源码泄露。',
    '纯review只消费严格描述、已准入动画目录和当前参数行；按稳定clip UUID选择本场景命名片段，空值表示完整动画。未知参数值与顺序保留，缺失状态行显式应用时补齐。',
    '重复目标参数、错误参数类型、非法或缺失片段、无动画及行预算阻止应用；明确重新选择可修正坏字符串。完成边使用循环命名片段只提示警告；完整动画循环设置无目录依据时不猜。',
    '下拉选择和局部重置只改变辅助视图；点击应用才修改当前参数表，随后仍需普通检查、完整原文审阅、应用草稿及Save。取消选择或取消本地参数变更均不改作者文件。',
    '绑定、脚本、实例、参数、会话与忙态持有独立票据；观察到失效后永久撤销，迟到读取不得复活。应用前再次读取完整动画目录，变化或失败不写参数表；语言刷新保留选项节点、焦点与选择。',
    '真实Chrome在临时工程执行选择、重置、两层取消、三语390px和普通保存；保存只修改目标行为清单。随后既有p10 Godot得到idle→attack→idle、事件来源和自然完成回执，作者其他字节保持。',
    '此验证不构成新运行能力、实体游戏窗口、安装包或设备验收；没有跨绑定批量迁移、受保护引用、自动脚本改写或跨文件事务。'
  ],
  next: '继续设计片段删除/更名的引用影响与明确修复、多绑定配置工作流及运行条件诊断；其他后端与安装端分别验收。'
});
for (const item of [
  { id: 'i450', label: '严格状态片段描述与当前参数合并审阅', kind: 'product', language: ['JavaScript'], paths: ['engine/animation-state-bindings.mjs'] },
  { id: 'i451', label: '独立状态片段选择与普通行为草稿宿主', kind: 'product', language: ['JavaScript', 'CSS'], paths: ['web/modules/app-scene-behavior-state-bindings.js', 'web/modules/app-scene-behaviors.js', 'web/scene-behaviors.css'] }
]) data.axes.implementation.push(item);
const evidence = [
  ['source', 'engine/animation-state-bindings.mjs', '完整生成源码识别、严格小描述、现有目录品牌、局部参数合并和诊断。'],
  ['source', 'scripts/lib/scene-behavior-authoring-service.mjs', '保存态来源的可选状态元数据，不改变旧参数接口或普通写入权限。'],
  ['source', 'web/modules/app-scene-behavior-state-bindings.js', '独立目录读取、局部选择、失效票据及应用前重读。'],
  ['test', 'scripts/tests/animation-state-bindings.test.mjs', 'v1–v5严格发现与修改拒绝、完整描述/数组/标量、品牌、参数预算和循环告警。'],
  ['test', 'scripts/tests/scene-behavior-state-bindings-service.test.mjs', '已保存目录、旧响应形状、来源修订、缺核心、认证HTTP与作者字节保持。'],
  ['test', 'scripts/tests/scene-behavior-state-bindings-ui.test.mjs', '选择/重置/应用、迟到请求、永久失效、目录冲突、三语节点和失败保留。'],
  ['test', 'scripts/tests/scene-behaviors-editor-ui.test.mjs', '真实父表单到完整提案、当前绑定隔离、取消及普通来源/依赖守护。'],
  ['test', 'scripts/tests/scene-behavior-state-bindings-smoke.mjs', '临时作者工程的真实Chrome选择到普通Save，再以可信Godot执行同一绑定。'],
  ['report', 'docs/test-results/animation-state-bindings/browser-authoring-1792813246200/browser.json', '最终固定源码Chrome三语390px、11截图、plan/build/run与p10实际事件及自然完成；仅目标清单改变。'],
  ['report', 'docs/test-results/animation-state-bindings/README.md', '本轮领域/服务/UI/完整应用和实际浏览器运行范围，初轮源码变化失败记录单独保留。']
];
let evidenceNumber = Math.max(...data.evidence.map(row => Number(row.id.slice(1))));
const evidenceIds = [];
for (const [kind, path, note] of evidence) {
  assert.ok((await fs.stat(path)).isFile(), path);
  const id = `e${++evidenceNumber}`; evidenceIds.push(id); data.evidence.push({ id, kind, path, note });
}
for (const [id, architecture, implementation, role, separation, explanation] of [
  ['b656', 'semantic-js', 'i450', '严格已保存声明映射与纯参数行合并，目录品牌先验，不读文件或执行脚本。', 4, '同一纯描述/审阅规则由Node与实际Chrome复用；文件读取、作者变更与后端执行独立。'],
  ['b657', 'node-service', 'i269', '复用既有只读行为目录与来源修订，新增可选映射元数据，不取得普通保存权。', 3, '目录服务与纯发现有明确端口，现验收本机Node宿主；替换宿主与设备仍独立。'],
  ['b658', 'ui', 'i451', '辅助选择只以同步应用回交当前表单，继续原检查/审阅/草稿/Save链。', 3, '独立组件只消费来源、目录和参数端口，宿主持有写入；替换渲染端尚未验收。']
]) {
  data.bindings.push({ id, architecture, function: feature, implementation, role, evidence: evidenceIds });
  for (const [maturity, value, reason] of [
    ['implementation', 4, '声明的单绑定状态配置、局部选择/应用、目录变化拒绝与普通保存已形成闭环；跨绑定影响另列。'],
    ['verification', 4, '领域/服务/界面与旧回归，以及真实Chrome保存到Godot自然完成有本轮限定证据；不继承安装成绩。'],
    ['decoupling', separation, explanation],
    ['delivery', 2, '0.2.0之后源码工作树；本轮未制作新版本或更新安装，不向现有安装回填能力。']
  ]) data.cells.push({ coordinates: [architecture, feature, implementation, maturity], value, reason });
}
for (const [from, reason] of [
  ['authoring.animation_state_script', '复用已保存v1–v5严格生成声明及状态clip参数约定。'],
  ['authoring.script_parameter_interface', '映射保持原参数接口和当前参数行职责；普通参数修复继续独立。'],
  ['scene.animation_clips', '使用本场景已保存命名片段目录与稳定UUID，不猜运行资源。'],
  ['behavior.authoring', '明确应用后沿已有当前绑定表单、全文审阅与普通草稿保存。']
]) data.dependencies.push({ from, to: feature, relation: 'requires', reason });
data.workflows.push({ id: 'animation-state-bindings', label: '已保存状态表→当前绑定命名片段→参数表→普通保存→既有事件与自然完成',
  steps: ['authoring.animation_state_script', 'scene.animation_clips', feature, 'behavior.authoring', 'runtime.project_animation_state_entry_triggers'], gaps: [],
  boundary: '单绑定局部配置；实际Godot工作流沿已保存严格v5样例验证，前置场景/脚本/片段由fixture准备，不宣称从空工程全GUI、安装或新后端能力。' });
data.meta.date = '2026-10-24';
data.meta.commit = '5e6b92e82b34d035996b0df2b9e3c3a3efacf4c4';
data.meta.scope = '0.2.0之后工作树补充当前行为绑定的状态与命名片段配置：152功能/451实现/657绑定/2628评分/115工作流。新纯模型和独立视图，既有目录服务可选元数据；普通审阅/Save与Godot运行分别验收，22模块/43能力及作者/后端/Rust/WASM/协议保持。本轮未更新安装，旧2616评分/2758证据和全部既有绑定保持；此前范围保留其原时点：' + previous.meta.scope;
for (const [key, entries] of Object.entries(previous.axes)) assert.deepEqual(data.axes[key].slice(0, entries.length), entries);
for (const key of ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']) assert.deepEqual(data[key].slice(0, previous[key].length), previous[key]);
assert.deepEqual(data.meta.historicalSha256, previous.meta.historicalSha256);
await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n');
console.log(JSON.stringify({ feature, functions: data.axes.function.length, implementations: data.axes.implementation.length, bindings: data.bindings.length, cells: data.cells.length, evidence: data.evidence.length, workflows: data.workflows.length, historicalPrefixes: 'unchanged' }, null, 2));

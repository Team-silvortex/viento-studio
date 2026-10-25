# 2026-10-25 文档整理验证

本轮整理现行指南、文档导航与历史归档。源码发布基线仍为 **0.2.2**，工作树中的物理偏移／尺寸编辑仍未发布，本机安装验收仍为 **0.2.0**。没有增加产品能力、迁移作者工程、更新安装或提交推送。

## 整理范围

- 首页与文档中心按使用、二维创作与交付、工程格式、开发、历史组织，完整路径集中到[项目工作流](../../PROJECT_WORKFLOW.md)。
- 架构、模块、引擎接口按职责和权威来源组织；状态区分源码／工作树／安装，路线删除已实现事项的过期“下一步”，验证指南集中维护方法。
- 构建、动画、物理、行为、声音、事件及 Bevy／中间层专题修正过期“当前未发布”、模块数和后端版本描述。生成器版本与执行适配器版本分开，现行项目协议集中在[构建表](../../PROJECT_BUILD.md#当前项目协议选择)。
- 快速开始补全独立计划检查前的 WASM 准备；移动端区分当前配置与历史设备证据；源码归档说明补回动画样例。
- 原架构、模块、引擎、状态、路线和测试指南全文保存到日期归档；其他专题迁存旧版本前言。全部归档从[历史索引](../../history/README.md#2026-10-25-文档整理归档)进入。旧发布记录、ADR 和测试证据不改写。

## 本轮实际检查

结果与内容保全摘要见 [audit.json](audit.json)，全仓本地文档链接检查见 [links.json](links.json)。

| 检查 | 结果与范围 |
| --- | --- |
| 本地 Markdown 链接、标题和显式锚点 | 核对当前及历史入链；已编辑文档原有标题锚点均保留。外部网站和第三方 rustdoc 符号引用不在文件链接检查范围 |
| 命令与版本 | npm 脚本、18 条测试／原生入口、CLI 参数、后端描述符及 Android versionCode 对照源码；未下载工具或构建新安装包 |
| 快速开始示例 | 实际执行 Scene2D 只读 `plan`，成功且 diagnostics 为空，见[输出](quickstart-plan.json)；既有 WASM 已准备，本轮未重新编译核心 |
| 图谱专项 | [28／28 通过](atlas-tests.log)，无跳过；只验证图谱结构、生成与视图规则 |
| 图谱来源 | 只刷新当前文档的来源指纹，重新检查生成视图；功能、实现、绑定、证据、评分、依赖、工作流和历史摘要与整理前一致 |
| 内容保全 | 11,707 个范围外文件逐字节 SHA-256 不变，包括当前产品实现、测试、既有历史报告及 WASM；没有删除原文件 |
| 格式 | `git diff --check` 通过 |

图谱测试最初在受限沙箱中无法启动子进程，报 `spawnSync EPERM`；[详细日志](atlas-tests-sandbox.log)与两份启动摘要（[默认报告](atlas-tests-sandbox-summary.log)、[TAP](atlas-tests-sandbox-tap.log)）保留。获得工具执行许可后，原测试未修改，复测 28 项通过。该限制不记为产品回归修复。

上一轮物理尺寸编辑的 **7915 项应用检查、Chrome 和 Godot** 证据仍在[原专题](../scene-physics2d-space-resize/README.md)。本轮没有重跑应用全量、真实浏览器／引擎或原生安装验收，也不重新评分。

## 复核入口

在仓库根目录运行（只检查，不改文档或图谱）：

```sh
python3 docs/test-results/docs-refresh-2026-10-25/check-links.py
node scripts/function-atlas.mjs --check
node --test --test-concurrency=1 scripts/tests/function-atlas*.test.mjs
node scripts/project-build.mjs --command plan \
  --root examples/scene2d --scene documents/scenes/demo.json
git diff --check
```

计划命令要求按快速开始先准备共享核心。原文锚点与文件保全比较使用整理开始时的独立快照，结果保存在 audit.json；复核脚本只检查当前仓库的链接，不声称重新构造历史快照或验证外部网址。

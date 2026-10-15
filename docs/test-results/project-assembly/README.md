# 项目级多场景组装验收

2026-10-15，源码仍为 **0.1.3** 的未发布工作树；未更新安装或推送。操作指南见[项目组装](../../PROJECT_ASSEMBLY.md)，机器摘要见[summary.json](summary.json)。此前首次创建声音的未提交改动保持，本报告只新增组装证据。

## 本轮接通

内置窗口维护 1–32 个已登记 Scene2D、成员顺序和启动入口，先审阅再保存独立组装文档。核心声明、冻结计划、作者存储、界面、Godot 适配器与工程交付分层；资源包迁移从组装正文派生成员依赖，不要求重复手写元数据关系。

全部成员形成一个 Godot 工程，资源按身份去重，来源清单分别显示组装和各成员修订。运行只启动已选择入口，并保留对象只读观察、问题回源、窗口任务取消和冻结工程恢复。工程 ZIP 在新目录校验、解压后可用 Godot 启动同一入口。

## 最终验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 完整应用检查 | 5067 项，4948 通过、119 条件跳过、0 失败；851 个 JS 语法及 API／版本预检通过 | [最终日志](application.log) |
| Godot 组装与邻接回归 | 117／117，包含真实工具执行、非入口脚本错误、行为与声音成员、来源清单和迁移 | [日志](godot-backend-tests.log) |
| 作者服务至执行宿主 | 4／4，非入口变更使批准失效、Bevy 拒绝、真实入口运行与离线恢复 | [日志](workflow-real.log) |
| 声明、计划、快照、资源包与模块 | 33／33 核心；59 通过／2 条件跳过的既有链；51／51 模块与系统端口 | [范围与结果](core-results.json) |
| 作者窗口与旧界面 | 分阶段 134／134、104／104、21／21、26／26；含未知保存结果和运行入口身份守护 | [范围与结果](ui-results.json) |
| 实际 Chrome＋Godot | 4 组流程、8 张图，原文和源码指纹保护通过 | [最终记录](browser-1792059497612/browser.json) |
| 桌面／移动资源准备 | 62 次字节一致比对、4 组实际核心调用 | [准备记录](prepared-resources.json)、[桌面](desktop-prepare.log)、[移动](mobile-prepare.log) |
| 原有数据与磁盘 | 7135 份示例／历史／既有证据不变，安装包指纹不变；删除本轮可重建的桌面资源副本 | [保护记录](preservation.json)、[清理记录](cleanup.json) |

各专项与全量检查互相重叠，不能把行数相加为不同测试总数。全量中 119 项因原生归档、移动存储、真实后端等工具条件跳过；本轮另提供真实 Godot 专项，不将这些跳过改记为通过。共享 Rust 与原生 Tauri 宿主没有本轮组装改动，未重跑其安装验收。

## 实际界面与交付

最终环境为 Node.js 24.21.0、Chrome 154.0.8037.97、Godot 4.7.2 stable，Linux AMD Radeon 680M 窗口预览。工具／源码指纹、任务和导出事件均保存在最终浏览器记录中。

- [桌面组装审阅](browser-1792059497612/assembly-review-desktop.png)；[中文](browser-1792059497612/assembly-zh-CN-390.png)、[English](browser-1792059497612/assembly-en-390.png)、[日本語](browser-1792059497612/assembly-ja-390.png) 390px 无横向溢出，关闭、取消、审阅、保存均可见。
- [入口运行对象](browser-1792059497612/assembly-entry-run.png)只显示第二场景实例，结束位置为 (151, 222)；[窗口任务](browser-1792059497612/assembly-window-session.png)经历面板关闭／重开，显式取消停止所属会话。
- [工程来源](browser-1792059497612/assembly-project-inspection.png)展示两份成员及入口；[工程交付](browser-1792059497612/assembly-delivery.png)下载的 ZIP 有 10 个工程文件、1 份共享图片，新目录运行仍回报同一入口及位置。

审阅和取消不增加作者文件；保存仅增加组装正文与一份登记，不改两个成员。浏览器从隔离示例副本的两个已保存场景开始，未把上游 OC／投影创建算作本轮端到端验收。

## 发现和修复

最初浏览器执行分别暴露测试驱动过早填写禁用表单、组装样式引用路径错误，已修正等待条件和真实样式路径。收尾审查补上项目入口的运行对象观察与对应身份守护。首轮完整测试还发现旧断言仍预期 Godot 适配器 0.6.0，已按明确的项目能力版本 0.7.0 更新，并通过最终全量检查。

[首轮应用日志](application-initial.log)及 `browser-1792058656686`、`browser-1792058758152` 的失败记录保留，不作为最终成功证据。`browser-1792058930123`、`browser-1792059303267` 是此前成功检查点；最后一轮另改善截图滚动位置，产品源码未再变化。

## 复现与边界

```sh
node scripts/check-project.mjs --app-only
VIENTO_GODOT_BIN=/absolute/Godot node --test scripts/tests/project-assembly-workflow.test.mjs
VIENTO_GODOT_BIN=/absolute/Godot node scripts/tests/project-assembly-smoke.mjs
```

浏览器脚本需本机 Chrome；图形窗口分支需可用显示环境。每轮证据使用新目录，临时作品、缓存与下载副本会清理。资源准备仅证明分发副本包含对应文件及纯核心可调用，不代表 Tauri／Android 安装执行。

当前仅支持 Scene2D 成员，Bevy 明确拒绝组装。项目内运行时切换、跨场景状态／事件、连续调试、组装级控制回放、直接 Scene3D／配方成员、外部 IDE／LSP 及独立发行程序未包含。旧单场景能力继续使用原有路径。

# 0.3.1 源码发布验证

2026-11-20。本轮将首次行为参数配置、名称连接、音轨选择和 CI 修复纳入 **0.3.1 源码版本**。功能与边界见[发布记录](../../RELEASE_0.3.1.md)。三个开发专题保留原始 0.3.0 工作树的命令、来源和失败现场，不重标为本轮安装或原生重跑。

## 实际执行

- 正式升版后执行 `npm run check -- --app-only`：**9888 项，9188 通过，700 条件跳过，0 失败／取消**。版本、1756 份 JavaScript 语法、API 契约和 900 个测试文件均完成；2341 份应用／示范／测试／CI 来源在执行前后摘要相同。[回执](application-status.json)、[完整日志](application-check.log.gz)、[开始来源](application-sources-before.json.gz)、[结束来源](application-sources-after.json.gz)。跳过项不计作对应后端或设备通过。
- 版本与源码归档专项 **8/8 通过、0 跳过**；覆盖版本、安装计数、数据身份与临时源码包内容。[专项日志](version-source-archive.log)。Android 安装编号 `1003001`，macOS 包编号 `1.3.1`，应用身份保持 `io.viento.studio`。
- 最新旧版 CI 的 application 作业触及 15 分钟上限，compatibility 已通过。预算改为 30 分钟并缓存 Rust 核心；测试 TAP 实时输出，失败退出码保留。[诊断](ci-diagnosis.json)。真实子 CLI 的三项回归通过，旧入口的同一实时输出测试按预期失败：[正向日志](ci-output-regression.log)、[旧入口负对照](ci-output-negative-control.log)。诊断及负对照来自升版前工作树；新回归也已包含在上述 0.3.1 完整检查中。远端运行结果须另以 GitHub Actions 为准。
- 三组功能证据共 **212 文件**，清单、长度与 SHA-256 全部一致。两份被通用 assets 忽略规则挡住的 WAV／侧车已精确补入；暂存区全部 212 个 blob 与冻结证据一致，PNG 保持既有原始 blob 策略，未引入新的 LFS 转换。[证据审计](evidence-preflight.json)、[暂存核对](evidence-index-audit.json)、[完整路径与摘要](evidence-files.json.gz)。

## 图谱与保真

图谱保持 **208 功能、631 实现、846 绑定、3384 评分、658 依赖、173 工作流**。仅将三项首次行为创作功能的九个交付单元从工作树 2 调整为源码交付 3；实现、验证、解耦与所有其他评分保持。新增两份发布证据和一份 CI 回归测试引用。[图谱差异](atlas-review.json)、[图谱检查](atlas-check.json)。

旧作品、示范、历史发布记录及原专题证据保留原字节。[保真审计](preservation.json)、[文档链接审计](doc-links.json.gz)、[最终检查](final-verification.json)分别记录范围，完整目录摘要见[清单](inventory.json)。提交前验证基于 0.3.0 的 `fbaff463` 主线与本次工作树，最终发布提交以 Git 历史为准。

## 验证边界

本轮为源码提交推送，未构建或更新本机安装；最近明确安装验收仍为 **0.2.0**。`--app-only` 没有重跑独立 Rust、Android、桌面打包或新设备验收；旧真实 Chrome、Godot 窗口及 Headless／Dummy 播放器证据按各专题阅读。没有扬声器听测、Bevy 功能对等、整款游戏从空白、跨启动存档、长期持续运行或无引擎工具独立发行的新结论。Godot 描述符、作者格式、运行协议和事务日志保持各自身份。

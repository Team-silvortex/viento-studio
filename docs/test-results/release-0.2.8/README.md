# 0.2.8 发布检查

2026-11-04。此目录记录应用升至 0.2.8 后实际执行的发布检查。升版前开发专题保留原版本、时点和摘要，不改标为本版重跑；安装仍为 0.2.0。

## 本版检查

- 版本与源码归档：Node 24.21.0 实际运行 8/8 通过、零跳过；[日志](version.log)、[版本文件摘要](version-audit.json)。显示与构建版本 0.2.8，Android 安装计数 1002008、macOS 1.2.8，应用标识保持 `io.viento.studio`。
- Rust 共享核心：`cargo test --manifest-path crates/viento-studio-core/Cargo.toml --locked`，420/420 通过、零失败／忽略；[日志](core.log)。复用临时编译缓存，不在项目内恢复大型 target。
- 真实 Godot 平台控制：13/13 通过、零跳过；[日志](godot.log)、[结构化观察](godot.json)、[隔离窗口](godot-window.png)。双轴启停、初始请求、行为身份和竞争、压力板、受阻、端点、场景往返，以及移走原目录后的离线工程运行均在 0.2.8 源码下复验。
- 真实 Bevy 项目入口：2/2 通过、零跳过；[日志](bevy.log)。包含单用例的通过／不符／取消／拒绝及有序验收组和 CLI 成员结果。工具身份与工程 ZIP 摘要见[原生汇总](native-summary.json)。
- 完整应用检查：`npm run check -- --app-only`，8995 项中 8344 通过、651 条件跳过、0 失败／取消；[完整日志](app-check.log)。在 0.2.8 实际版本下完成版本一致性、1517 份 JavaScript 语法和 API 契约预检。条件跳过不计作真实引擎通过。
- 发布图谱及变更源码另核对指纹和本地链接；[变更源码摘要](source-hashes.json)。

本版没有重新编译或更新 Tauri 安装程序；上述检查不视作新版桌面或 Android 安装验收。

## 开发阶段证据

- [平台启停](../scene-physics2d-platform-control/README.md)：升版前完整应用 8995 项，8344 通过、651 条件跳过、0 失败；Godot 主专项 13/13，暂停起跳／下穿 2/2，旧物理回放与预算／调度兼容另行记录。原生模板包含明确预期拒绝，不把条件跳过计为真实工具通过。
- [垂直往返平台](../scene-physics2d-platform-vertical/README.md)：Rust 420 项、三语 Chrome、真实 Godot 升降承载／受阻／下穿／端点、作者迁移和独立工程交付；证据保留添加平台控制层之前的源码摘要。
- Bevy 项目入口[运行用例](../bevy-project-runtime-case/README.md)、[作者文档与迁移](../bevy-project-case-documents/README.md)、[有序验收组](../bevy-project-runtime-suite/README.md)分别保留真实工具与浏览器范围。
- [磁盘清理](../disk-cleanup-2026-11-04/README.md)记录生成物与作者／安装物的边界；未删除作者作品、素材或 Git 历史。

不同专题和完整检查有交集，不相加作覆盖率。Linux 的工具、合成输入及浏览器验证不代表其他系统、实际安装或设备验收。

暂存检查仅清理浏览器烟测脚本空行的两处尾随空格，代码、字符串与注释未变；Acorn 逐 token 比较一致，另行通过语法检查，见[格式复核](format-only-check.json)。历史专题保留格式清理前的来源摘要，Godot／Bevy 与运行代码未改变。

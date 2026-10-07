# 0.0.8 版本记录

2026-10-07。把此前多轮工作树中的场景片段创作、GDScript 行为和双引擎执行链路纳入源码交付。延续 0.0.7 的布局、稳定实例、分组、共享 Rust 编辑核心、草稿预览和精确源码补丁；应用版本更新不自动修改作者工程、元数据或素材。

## 变更

- **场景片段配方**：单文件片段可多次放置，显式分配实例／组 UUID、偏移和局部覆盖，Rust 原生／WASM 展开为既有 Scene2D v3。CLI 可只读输出场景或来源 bundle；配方作为普通登记 JSON 编辑、保存、备份和迁移，选择式资源包从当前正文派生定义／图片依赖。
- **配方预览与局部覆盖**：已保存或当前源码草稿可显示展开画面，并分别定位模板、覆盖、偏移和身份贡献。单实例六类覆盖经完整候选检查后只应用到当前文本草稿，再普通保存；未改字段保留继承。共享模板写回、取消覆盖、跨文件组合和画布拖动回写仍未接入。
- **GDScript 实例行为**：独立登记 JSON 绑定与 TXT 源码，为同一份行为的多实例提供独立参数和类型化信号映射。仅显式行为场景生成 Godot plan／runtime 3；诊断定位到清单或源码，资源包携带完整依赖。界面不执行 GDScript，普通无行为 plan 1／2 保留原规则。
- **执行后端中间层**：纯描述符区分七种执行操作，可信宿主拥有注册、工具身份、冻结输入、产物和会话；具体适配器拥有引擎参数、阶段及布局。独立适配器指纹使过期构建需重建；HTTP 不接受工具、路径或后端代码，工作台保留批准与草稿保护。
- **Bevy 无头第二后端**：固定 Bevy 0.19.1 的可信 Rust 工具消费与 Godot 相同的无图 plan 1／2，用真实 ECS 执行受控输入和移动。当前 Bevy 适配器／工具为 0.3.0，Godot 适配器为 0.5.0；Bevy 工具另行构建并放在本机工具目录，不放进作者工程或自动装入应用包。图片、图形运行和作者 Rust 行为不在 Bevy 当前范围。
- **运行对象只读观察**：从已验证冻结声明取得实例／定义身份和来源，保存启动／结束位置及移动状态，可本地检索或只读 inspect，并返回作者声明。状态变化后旧位置明确标为过期；任务取消或失败保留最近有效样本，不暴露引擎 Entity、节点路径或反射方法。
- **全局与按实例有限控制**：schema 1 保持全局方向输入，schema 2 仅针对冻结 plan 2 的实际实例 UUID；每步未列实例释放，不延续上一步。严格 1–64 步、总时长 8 秒、每步至多 0.25 秒、输入行与实例×步骤分别至多 1024，最后全释放。两引擎输出完整步骤样本，工作台提供目标示例和显式生成；选择目标不改 JSON，轮询、语言与重开保留输入。
- **源码归档完整性**：修复 `desktop/package-source.py` 对 Bevy 可信工具 crate 与四份官方合成样例的遗漏，保留工具源码、Cargo 锁文件及 `scene2d`／`scene-composition`／`scene-behaviors`／`bevy-headless` 样例；各 crate 构建目录、依赖缓存、真实作品和生成产物仍排除。
- **可审阅的功能图谱**：维护 62 项功能、129 个实现、217 个实现绑定和 25 条工作流；架构／功能／实现／成熟度有来源与证据指纹。旧 F01–F50 及历次报告保留原字节。

操作入口见[构建与运行](PROJECT_BUILD.md)、[场景片段](SCENE_COMPOSITION.md)、[行为绑定](SCENE_BEHAVIORS.md)、[Bevy 后端](BEVY_BACKEND.md)和[有限控制](RUNTIME_CONTROL.md)。实现与演进见[当前架构](ARCHITECTURE.md)、[引擎接口](../engine/README.md)及[路线图](ROADMAP.md)。

## 验证与交付范围

本版只交付源码版本提交与推送。[0.0.8 发布候选记录](test-results/release-0.0.8/results.json)在新版本下完成应用 **1774／1774**、0 失败／跳过／取消，**391** 个 JavaScript 语法、API 与版本检查通过；真实 Godot、Bevy、Rust 原生核心及归档／移动存储辅助程序已启用。版本与源码归档专项 **8／8** 与全量重叠，没有增加测试计数；共享编辑核心 Rust **75／75** 及 fmt／clippy 独立通过。应用版本为 0.0.8，Android `versionCode` 为 1000008，macOS 构建编号为 1.0.8，应用标识保持 `io.viento.studio`。

[准备资源全清单](test-results/release-0.0.8/prepared-manifests.json)逐项核对桌面资源 **496**、作品库 **11**、移动资源 **192** 份；[运行模块专项](test-results/release-0.0.8/packaged-resources.json)另核对桌面 **89**／移动 **68** 份，内置 Node 执行 **10 次离线会话**（4 普通＋4 全局控制＋2 实例控制）。移动仅执行 **4 个纯模块**并准入 10 份真实进程输出，不是 Android 引擎或设备验收。Bevy 二进制与 Rust crate 不进入应用安装资源。

实际[源码归档检查](test-results/release-0.0.8/source-archive.json)回读 **2573** 份文件及 **68** 份关键源码，核对两份 Rust crate／锁文件、四份官方合成样例及生成物／作品排除。它验证的是发布审计元数据写入前的**临时源码快照**，检查后已删除，不作为最终提交的压缩包交付。后续文档／图谱／审计文件通过源码提交交付，不反复重建该归档或改写其摘要。

**1733** 份历史与 **9** 份冻结后端／WASM 文件保持原字节，当前 **138** 份源摘要核对，见[保留记录](test-results/release-0.0.8/historical-preservation.json)。只[清理](test-results/release-0.0.8/cleanup.json)本轮原先不存在的 **7** 个生成目录与 **1** 份验证归档，释放 **2058166272 字节，约 1.917 GiB**；既有交付物、用户工程、已安装程序、依赖及三代 Bevy 工具缓存保留。此前浏览器及独立 Bevy Rust 专题维持原版本条件，未重复计为本次新安装或设备验收。

最近的[按实例控制记录](test-results/runtime-instance-control/results.json)在 0.0.7 工作树验证应用 **1774／1774**、0 失败／跳过／取消及 391 JS／API／版本检查；可信 Bevy Rust 25 项与 fmt／clippy、实际 Godot／Bevy、Chrome 8 条流程，以及准备资源 10 次离线会话另计。以下历史记录分别覆盖累计功能，专项与全量有重叠，不相加为覆盖率：

- [片段展开](test-results/scene-composition/results.json)、[配方迁移](test-results/scene-composition-workflow/results.json)、[配方预览](test-results/scene-composition-preview/results.json)及[单实例覆盖](test-results/scene-composition-overrides/results.json)。
- [GDScript 行为](test-results/scene-behavior-runtime/results.json)、[执行中间层](test-results/backend-middleware/results.json)及[Bevy 接入](test-results/bevy-backend/results.json)。
- [运行对象](test-results/runtime-object-inspection/results.json)、[全局有限控制](test-results/runtime-control-replay/results.json)及[按实例控制](test-results/runtime-instance-control/results.json)。

没有新 AppImage、deb 或 APK，没有安装更新、Tauri 新窗口或 Android 设备验收，也不创建 GitHub Release 或版本标签。最近保留的 Linux 安装包验收仍为 [0.0.4](test-results/release-0.0.4/results.json)；旧安装不因源码更新获得新功能。使用 0.0.8 需从对应源码启动或自行构建，Bevy 工具仍单独配置。

作者 Scene2D／workspace 与应用版本分别管理；没有 workspace v4、自动工程迁移或引擎脚本互译。配方预览不授予构建或布局保存权限，直接修改展开场景不回写配方。有限无头回放不表示实时输入、运行组件修改、RPC／反射、渲染／GPU、热更新或任意作者 Rust。Nuislang、ns-nova、yalivia 原生执行及 GUI 迁移仍按路线推进。

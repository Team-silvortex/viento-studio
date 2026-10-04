# 当前功能图谱：架构、功能、实现与成熟度

核对日期：**2026-10-04**。源码版本 **0.0.7**；审查基线为提交 `94e9626fc11c64f61a7391f7b081bc029306345a`，各项交付状态见下文。范围为本仓库已识别的能力与明确规划，不是全部未来功能的穷举，也不是运行时逐函数调用图。各项实测范围与执行条件见对应证据；源码验证不等于新安装包或设备验收。

[离线交互图谱](function-atlas.html) · [稀疏张量 JSON](function-atlas.json) · [依赖图 Mermaid](function-atlas.mmd) · [架构边界](ARCHITECTURE.md) · [当前平台](STATUS.md) · [旧 b.4.3 功能网络](FUNCTION_NETWORK.md)

## 模型与缺省语义

使用四维坐标 **T[架构 A, 功能 F, 实现 I, 评分维度 M] = 0–5 或 null**，按 COO 坐标列表保存。M 包含实现、验证、解耦、交付四项；它们是有序等级，**不计算总平均、完成百分比或测试覆盖率**。一个功能可有多条实现关系，例如布局规则同时关联 Rust 核心、WASM 桥和 JS 草稿视图。

- 只存已审查的架构／功能／实现关系。缺省组合表示未建立关系，不代表分数 0。
- 显式 `0` 表示有证据支持的未实现／未交付等状态；`null` 表示该项未评估或现阶段不适用。
- 每个已登记实现关系有四个评分单元，分别给出理由。评分只适用于该行范围，语言和代码量本身不能增加成熟度。
- 依赖边 `requires` 表示当前语义前置条件，`planned` 表示未来接入；均不是静态 import 或性能数据。工作流是业务路径索引，先后关系不保证每次操作调用所有步骤。
- 历史报告保留其日期、平台、跳过与样本边界。测试文件存在不等于此次运行过；旧安装包记录也不能证明未发布代码已交付。

## 规模

| 项目 | 数量 |
| --- | ---: |
| 架构区域 | 11 |
| 功能 | 56 |
| 实现单元（含规划占位） | 110 |
| 已审查实现关系 | 176 |
| 显式评分单元 | 704 |
| 语义依赖边 | 95 |
| 工作流切片 | 18 |
| 旧链路已映射 | 50 |
| 引用并校验指纹的文件 | 366 |

## 评分锚点

### 实现

- **0**：未实现可执行能力
- **1**：只有设计或明确开发方向
- **2**：隔离原型／探针，尚未接入产品
- **3**：主流程接入，失败分支仍有缺口
- **4**：所声明范围形成闭环，含错误／冲突或恢复处理
- **5**：该范围长期稳定演进，有多轮兼容及变更验收

### 验证

- **0**：无可执行验证证据
- **1**：源码／契约静态核对
- **2**：局部单元或隔离探针验证
- **3**：接口／跨模块集成或真实后端探针
- **4**：真实业务流程与回归证据，环境边界明确
- **5**：当前对应安装产物／目标设备验收且关键失败分支验证

### 解耦

- **0**：无法独立识别规则与副作用边界
- **1**：规则、视图或宿主仍紧密交织
- **2**：有模块分隔，但仍绑定具体视图／宿主／后端
- **3**：有显式接口或可移植规划，领域规则与适配职责可区分
- **4**：同一核心已在不同执行目标复用并有一致性验证
- **5**：第三方/原生新实现替换已完成兼容验收

### 交付

- **0**：尚无产品交付
- **1**：仅设计或独立实验可复现
- **2**：当前工作树或资源准备可用，未进入源码版本交付
- **3**：相应能力纳入源码版本；当前安装产物未验收
- **4**：相应安装产物已在指定目标平台验收
- **5**：多个承诺目标平台安装验收且升级／回退路径验证

最高等级需要额外证据，未使用并不意味着评分表有缺陷。`delivery` 中的 Linux 源码交付不能提升 Android／Windows／macOS；每个功能的实际平台限制见详情。

## 架构区域

| 区域 | 职责 |
| --- | --- |
| 交互与渲染 | Web文档、字段、World、场景和构建视图；只消费领域结果与宿主服务。 |
| 可移植 JS 语义 | 解析、保真字段、World/投影/场景规划与注入式存储流程；仍待逐链迁Rust。 |
| 共享 Rust 核心 | 无宿主依赖的确定性规则、有界布局草稿及无状态源码检查/坐标补丁；原生与WASM共用实现，完整World/构建语义仍在JS。 |
| 本机服务与适配 | HTTP鉴权、索引、资源、任务与Node适配器，连接纯规则和I/O。 |
| 存储与事务 | 正文/UUID/素材权威数据的锁、修订、原子发布与恢复。 |
| 桌面宿主 | Tauri作品库、窗口/进程、原生对话框、偏好和会话。 |
| Android 宿主 | 无Node请求桥、私有存储、草稿恢复和SAF迁移。 |
| 执行后端 | Godot生成物与运行协议、GDScript实验及后续候选。 |
| 工程定义与格式 | 模板包、类型、Schema、作者身份与持久格式。 |
| 构建与分发 | WASM/桌面/移动资源准备、源码归档和生成物清理。 |
| 验证与维护 | 契约检查、回归工具、证据与遗留维护边界。 |

## 当前优先缺口

1. **逻辑分组之上的复用片段与展开来源**：稳定实例与逻辑组已贯通作者原文、导航、布局、事务和迁移；1–128演员/128组/16层限制仍在，尚无片段展开或空间变换。 验收：先以隔离片段组合样例验证确定性v3产物、稳定身份、局部覆盖和展开来源；接入作者工作流前另定登记依赖/迁移和跨文件提交，空间父子变换与规模单独验收。 涉及 [Scene2D v3 逻辑分组、共享大纲与后代选择](#scene.groups_v3)、[文本驱动场景、定义/实例分离与场景树](#scene.text_instances)、[场景来源模型与修订守护的原文定位](#scene.source_model)。
2. **在单源补丁之后继续下沉完整语义**：Rust已承接布局/历史/保存阶段，以及source-only严格JSON结构与数值补丁；完整作者模型、投影继承、来源导航和World规划仍JS。 验收：逐条对照既有JS完整语义与源码/注册/恢复契约，保持BOM/行尾、UUID、来源范围及事务兼容，不把受限source检查冒充完整模型。 涉及 [解析、字段与 World 规划下沉 Rust](#core.semantic_migration)。
3. **把GDScript探针接成作者链**：当前固定runtime.gd不等于作者脚本能力。 验收：脚本身份、参数、动作、事件、依赖快照、错误定位及完整迁移；之后再验证Rust后端。 涉及 [GDScript 行为绑定探针](#behavior.gdscript_binding)、[Bevy/Rust 第二后端候选](#runtime.bevy_rust)。
4. **补真实交付与目标平台证据**：Rust布局、来源/实例/分组、单源草稿预览及坐标回写已纳入0.0.7源码并保留专题证据；对应Tauri安装产物与目标WebView仍需实测。 验收：对对应实际安装包重跑Linux关键流程及Android设备范围；Windows/macOS单独验收。 涉及 [源码、桌面与移动资源交付](#delivery.packaging)、[Android 无 Node 编辑宿主](#host.android-editing)、[Rust布局草稿、原子批次与撤销历史](#core.history_migration)、[布局草稿、多选与显式事务保存](#scene.layout_draft)、[Rust布局检查、保存与未知结果工作流](#core.save_state_migration)、[Scene2D v2 独立实例与定义复用](#scene.instances_v2)、[Scene2D v3 逻辑分组、共享大纲与后代选择](#scene.groups_v3)、[当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview)、[当前源码草稿的布局调整与精确回写](#scene.source_layout)。

## 业务工作流

| 路径 | 功能步骤 | 适用边界 |
| --- | --- | --- |
| 工程创建与日常创作 | [作品库、起始模板与最近工程](#host.library) → [五类独立工程起始模板包](#project.starter-packs) → [工程自定义类型、解析规则与文档模板](#project.type-templates) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [通用解析、静态索引与阅读](#authoring.parse-index) | 桌面与本机编辑；Android支持其中编辑/模板子集。 |
| 字段与语义变更 | [字段表原位保真编辑](#authoring.field-edit) → [World／Object／Resource 观察投影与查询](#world.query) → [单对象单属性语义修改](#world.property-set) → [批量属性提交、读取屏障与崩溃恢复](#world.changeset) → [通用解析、静态索引与阅读](#authoring.parse-index) | 当前批次只改既有对象属性；不是通用混合事务。 |
| 身份、关系和资源 | [新对象正文与登记共同创建](#world.object-create) → [引用／共享归属关系追加](#world.relation-add) → [为对象追加已登记素材用途](#world.resource-bind) → [World／Object／Resource 观察投影与查询](#world.query) | 各命令独立提交；不要把该顺序解释成一个原子批次。 |
| 一个OC的多用途投影 | [新对象正文与登记共同创建](#world.object-create) → [同一 OC 的子模板及多份用途投影创建／编辑](#projection.authoring) → [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) | 投影是独立作者定义；当前工作树v2允许同一投影的多个实例，v1保留原限制与显式升级。 |
| 预览、布局和保真保存 | [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [Scene2D v3 逻辑分组、共享大纲与后代选择](#scene.groups_v3) → [无需引擎的已保存场景预览](#scene.saved_preview) → [共享 Rust 布局规则与原子位置校验](#core.layout_rust) → [Rust布局草稿、原子批次与撤销历史](#core.history_migration) → [Rust 核心 WASM 接入与分发资源](#core.wasm_bridge) → [Rust布局检查、保存与未知结果工作流](#core.save_state_migration) → [布局草稿、多选与显式事务保存](#scene.layout_draft) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) | 逻辑组后代选择映射为既有实例批次；Rust管位置/历史/保存阶段，JS保留作者组结构及实际事务，非组空间变换或设备验收。 只从保存态进入布局；原文只读草稿预览另列独立工作流。 |
| 构建与真实Godot运行 | [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [Godot 4 工程生成与运行协议](#runtime.godot_generated_project) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) | Linux本机服务；v2实例运行与旧v1冻结重放均有证据，固定行为仍不等于任意脚本或独立游戏导出。 |
| 媒体创作与原始资源取回 | [图片／视频／音频导入、引用、草稿预览与播放](#media.embed-play) → [为对象追加已登记素材用途](#world.resource-bind) → [单个登记素材原始字节再导出](#resource.original-export) → [导出准备、下载、原生保存及清理](#export.jobs-delivery) | 原文件导出不转码；登记和媒体播放各有验证范围。 |
| 跨工程复用与完整迁移 | [选择式资源包依赖闭包、冲突预览与追加导入](#resource.package) → [完整工程归档和恢复](#storage.full-archive) → [Android SAF 完整工程迁移](#host.android-transfer) | 选择包是复用，完整包是迁移；Android只接完整包。 |
| 阅读分享与下载生命周期 | [通用解析、静态索引与阅读](#authoring.parse-index) → [文档阅读分享包与受控下载生命周期](#export.document-share) → [导出准备、下载、原生保存及清理](#export.jobs-delivery) | 可取消/清理与原生保存回执；不替代工程备份。 |
| Android离线编辑与恢复 | [Android 无 Node 编辑宿主](#host.android-editing) → [Android 草稿和新建恢复](#host.android-draft-recovery) → [Android SAF 完整工程迁移](#host.android-transfer) | 无Node；未接媒体/World/场景构建；模拟器不等于真机。 |
| 源码验证、打包和清理 | [契约检查、回归与证据保存](#quality.validation-support) → [Rust 核心 WASM 接入与分发资源](#core.wasm_bridge) → [源码、桌面与移动资源交付](#delivery.packaging) → [构建缓存与磁盘清理](#delivery.generated-cleanup) | 构建准备和源码验证不能自动获得安装/多平台成熟度。 |
| 后续文本实例与行为 | [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [Scene2D v3 逻辑分组、共享大纲与后代选择](#scene.groups_v3) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [文本驱动场景、定义/实例分离与场景树](#scene.text_instances) → [GDScript 行为绑定探针](#behavior.gdscript_binding) → [Bevy/Rust 第二后端候选](#runtime.bevy_rust) | 稳定实例、逻辑分组和单源只读草稿预览已有独立工作树切片；共享可写草稿、复用片段、空间变换、作者行为绑定与Rust后端仍为规划。 |
| 共享核心持续下沉 | [共享 Rust 布局规则与原子位置校验](#core.layout_rust) → [Rust布局草稿、原子批次与撤销历史](#core.history_migration) → [Rust布局检查、保存与未知结果工作流](#core.save_state_migration) → [解析、字段与 World 规划下沉 Rust](#core.semantic_migration) | 几何、草稿历史与保存状态已接通；来源模型/解析和World语义规划仍待迁移。 |
| 场景字段到修订匹配的作者原文 | [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [场景来源模型与修订守护的原文定位](#scene.source_model) → [无需引擎的已保存场景预览](#scene.saved_preview) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 保存态来源读取并匹配磁盘修订；显式草稿来源只匹配当前编辑器文本hash。声明/组名与共享定义分别定位，迟到/过期/近似位置不盲跳，来源切换不覆盖草稿。 |
| 共享定义的多实例创作、运行与迁移 | [同一 OC 的子模板及多份用途投影创建／编辑](#projection.authoring) → [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [场景来源模型与修订守护的原文定位](#scene.source_model) → [无需引擎的已保存场景预览](#scene.saved_preview) → [布局草稿、多选与显式事务保存](#scene.layout_draft) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [Godot 4 工程生成与运行协议](#runtime.godot_generated_project) → [选择式资源包依赖闭包、冲突预览与追加导入](#resource.package) | 合成工程贯通独立身份、局部覆盖、冻结执行和资源包导入；定义/素材去重；v3逻辑树另见分组工作流，尚无片段/剧本事件。 |
| 逻辑分组创作、大纲导航与批量布局 | [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [Scene2D v3 逻辑分组、共享大纲与后代选择](#scene.groups_v3) → [场景来源模型与修订守护的原文定位](#scene.source_model) → [无需引擎的已保存场景预览](#scene.saved_preview) → [Rust布局草稿、原子批次与撤销历史](#core.history_migration) → [布局草稿、多选与显式事务保存](#scene.layout_draft) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [Godot 4 工程生成与运行协议](#runtime.godot_generated_project) → [选择式资源包依赖闭包、冲突预览与追加导入](#resource.package) | 启用作者v3后显式保存组与归属；大纲过滤/后代选择沿用稳定实例，位置编辑和迁移保留组，构建剥离组织结构复用plan2。没有空间变换继承、片段或剧本事件。 |
| 场景原文草稿、只读预览与来源往返 | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [场景来源模型与修订守护的原文定位](#scene.source_model) | 单份已登记场景源码经128KiB/磁盘基线校验后只读预览；依赖仍取保存态登记。精确来源回到原编辑器，错误保留有效画面；本地源码布局回写为另一个明确分支，不授予World事务保存。 |
| 场景源码草稿、局部布局与普通保存 | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [Rust布局草稿、原子批次与撤销历史](#core.history_migration) → [当前源码草稿的布局调整与精确回写](#scene.source_layout) | 仅源码模式/单scene：Rust strict inspect→有效预览/hash绑定→Rust几何与局部历史→Rust精确scalar proposal→宿主复核后内存应用→主编辑器普通保存。source操作无状态且不读写磁盘；取消不改文本，应用不重置保存基线，无World命令/构建/统一undo。 |

## 功能与实现切片

四项分数按「实现／验证／解耦／交付」排列。详细逐项理由和证据类型可在交互图或 JSON 查询。现有与计划实现并列时，不互相继承成熟度。

<a id="authoring.parse-index"></a>
### 通用解析、静态索引与阅读

`authoring.parse-index` · 创作与工程 · 源码交付

入口：文档列表／筛选／详情；GET /api/index（轻量目录）；GET data/index.json（解析展示索引）；POST /api/rebuild

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **parse.mjs / parser.mjs 等**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/editor-index-refresh-2026-09-23/results.json](../docs/test-results/editor-index-refresh-2026-09-23/results.json)、[docs/test-results/editor-filtering-2026-09-23/results.json](../docs/test-results/editor-filtering-2026-09-23/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json) |
| 本机服务与适配 | **core.mjs / static-index.mjs 等**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/editor-index-refresh-2026-09-23/results.json](../docs/test-results/editor-index-refresh-2026-09-23/results.json)、[docs/test-results/editor-filtering-2026-09-23/results.json](../docs/test-results/editor-filtering-2026-09-23/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json) |
| 交互与渲染 | **app-render.js / app-runtime.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/editor-index-refresh-2026-09-23/results.json](../docs/test-results/editor-index-refresh-2026-09-23/results.json)、[docs/test-results/editor-filtering-2026-09-23/results.json](../docs/test-results/editor-filtering-2026-09-23/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json) |

平台：桌面／本机浏览器；具体界面与安装验收分开、Android编辑子集；媒体/World另列。边界：原文权威；Markdown/TXT/JSON/YAML；展示索引与轻量目录是独立路径。

下一步：解析、布局与索引规则仍在 JS；Rust 下沉需保持原文范围与数值精度。

<a id="authoring.document-edit"></a>
### 源码／分段草稿、创建、保存与冲突

`authoring.document-edit` · 创作与工程 · 源码交付

入口：开始编辑／新建文档／保存；GET /api/doc；POST /api/doc

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-runtime.js / app-editor-draft.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/save-conflicts-2026-09-23/results.json](../docs/test-results/save-conflicts-2026-09-23/results.json)、[docs/test-results/save-recovery-2026-09-23/results.json](../docs/test-results/save-recovery-2026-09-23/results.json)、[docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json) |
| 可移植 JS 语义 | **source-draft.mjs / document-store.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/save-conflicts-2026-09-23/results.json](../docs/test-results/save-conflicts-2026-09-23/results.json)、[docs/test-results/save-recovery-2026-09-23/results.json](../docs/test-results/save-recovery-2026-09-23/results.json)、[docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json) |
| 存储与事务 | **node-document-storage.mjs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/save-conflicts-2026-09-23/results.json](../docs/test-results/save-conflicts-2026-09-23/results.json)、[docs/test-results/save-recovery-2026-09-23/results.json](../docs/test-results/save-recovery-2026-09-23/results.json)、[docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json) |
| Android 宿主 | **platform.mjs / mobile_storage.rs**；Android请求/存储/迁移适配；只覆盖已声明移动子集。 | 4 / 4 / 3 / 3 | [docs/test-results/save-conflicts-2026-09-23/results.json](../docs/test-results/save-conflicts-2026-09-23/results.json)、[docs/test-results/save-recovery-2026-09-23/results.json](../docs/test-results/save-recovery-2026-09-23/results.json)、[docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json) |

平台：桌面／本机浏览器；具体界面与安装验收分开、Android编辑子集；媒体/World另列。边界：保存与重建分离；冲突及失败保留草稿；Android 私有存储与恢复草稿已接入，桌面草稿不跨重启持久；当前已登记场景的原文草稿可只读预览并按hash定位，具体范围见scene.text_draft_preview；不扩展普通文档保存或多文件草稿事务。。

下一步：桌面持久草稿／永久撤销历史；从界面抽离统一草稿状态机。

<a id="authoring.field-edit"></a>
### 字段表原位保真编辑

`authoring.field-edit` · 创作与工程 · 源码交付

入口：开始编辑 → 字段编辑；POST /api/doc/fields

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-field-editor.js / app-field-draft.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/field-editing-2026-09-24/results.json](../docs/test-results/field-editing-2026-09-24/results.json)、[docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 可移植 JS 语义 | **fields.mjs / field-changes.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/field-editing-2026-09-24/results.json](../docs/test-results/field-editing-2026-09-24/results.json)、[docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **document-field-draft.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/field-editing-2026-09-24/results.json](../docs/test-results/field-editing-2026-09-24/results.json)、[docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面／本机浏览器；具体界面与安装验收分开、Android编辑子集；媒体/World另列。边界：仅编辑可映射的已有标量；保留 BOM/CRLF/注释/未改字节；JSON/YAML 层级编辑、锚点等回源码模式。

下一步：新增／删除字段及结构变更；字段语义下沉 Rust；Android 素材选择未接。

<a id="project.type-templates"></a>
### 工程自定义类型、解析规则与文档模板

`project.type-templates` · 创作与工程 · 源码交付

入口：项目类型与模板；GET/POST /api/project；POST /api/project/preview

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-project-settings.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/project-settings-2026-09-23/results.json](../docs/test-results/project-settings-2026-09-23/results.json)、[docs/test-results/project-snapshot-2026-09-23/results.json](../docs/test-results/project-snapshot-2026-09-23/results.json)、[docs/test-results/template-http-2026-09-23/results.json](../docs/test-results/template-http-2026-09-23/results.json) |
| 可移植 JS 语义 | **project.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/project-settings-2026-09-23/results.json](../docs/test-results/project-settings-2026-09-23/results.json)、[docs/test-results/project-snapshot-2026-09-23/results.json](../docs/test-results/project-snapshot-2026-09-23/results.json)、[docs/test-results/template-http-2026-09-23/results.json](../docs/test-results/template-http-2026-09-23/results.json) |
| 本机服务与适配 | **project-definition.mjs / project-service.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/project-settings-2026-09-23/results.json](../docs/test-results/project-settings-2026-09-23/results.json)、[docs/test-results/project-snapshot-2026-09-23/results.json](../docs/test-results/project-snapshot-2026-09-23/results.json)、[docs/test-results/template-http-2026-09-23/results.json](../docs/test-results/template-http-2026-09-23/results.json) |

平台：桌面／本机编辑服务配置界面、Android可读取导入定义，配置界面未接入。边界：类型与模板属于工程；模板预览复用解析器；新增取消／放弃／返回已实现；Android 只读导入定义。

下一步：Android 配置界面；通用类型插件及模板包升级不是当前能力。

<a id="project.starter-packs"></a>
### 五类独立工程起始模板包

`project.starter-packs` · 创作与工程 · 源码交付

入口：桌面／Android 新建项目模板选择器

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 工程定义与格式 | **project-templates.json / workspace-layout.json**；声明式工程类型/模板或格式；不等于可执行脚本插件。 | 4 / 4 / 3 / 3 | [docs/test-results/project-templates/results.json](../docs/test-results/project-templates/results.json)、[docs/test-results/oc-templates/results.json](../docs/test-results/oc-templates/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json) |
| 存储与事务 | **workspace.rs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/project-templates/results.json](../docs/test-results/project-templates/results.json)、[docs/test-results/oc-templates/results.json](../docs/test-results/oc-templates/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json) |
| 交互与渲染 | **app.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/project-templates/results.json](../docs/test-results/project-templates/results.json)、[docs/test-results/oc-templates/results.json](../docs/test-results/oc-templates/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json) |
| Android 宿主 | **platform.mjs**；Android请求/存储/迁移适配；只覆盖已声明移动子集。 | 4 / 4 / 3 / 3 | [docs/test-results/project-templates/results.json](../docs/test-results/project-templates/results.json)、[docs/test-results/oc-templates/results.json](../docs/test-results/oc-templates/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json) |

平台：桌面／Android源码的新建入口、新选择器有浏览器/原生存储联调，安装窗口/设备待验。边界：空白、游戏、文学、戏剧、软件设计；完整定义副本+来源摘要；旧 OC 默认兼容；新选择器原生存储联调而非新设备验收。

下一步：第三方模板包安装／升级、可执行工程类型插件；Android 新选择器设备实测。

<a id="identity.registration-ownership"></a>
### 稳定身份、登记、归属及历史背景迁移

`identity.registration-ownership` · 创作与工程 · 源码交付

入口：workspace CLI register / verify / migration；文档和资源登记；角色背景附属树

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **document-model.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/document-migration-2026-09-23/results.json](../docs/test-results/document-migration-2026-09-23/results.json)、[docs/test-results/archive-registry-2026-09-23/results.json](../docs/test-results/archive-registry-2026-09-23/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **workspace.mjs / workspace.mjs 等**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/document-migration-2026-09-23/results.json](../docs/test-results/document-migration-2026-09-23/results.json)、[docs/test-results/archive-registry-2026-09-23/results.json](../docs/test-results/archive-registry-2026-09-23/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面/本机服务及Node维护CLI、Android保留身份和归属数据，语义管理入口未全部接入。边界：UUID 作为身份；背景保留角色原文或明确 part-of；共享归属允许多主人，循环拒绝；旧数据显式迁移。

下一步：当前登记与原文同步通过多条适配路径；后续统一可恢复语义命令覆盖剩余旧路径。

<a id="world.query"></a>
### World／Object／Resource 观察投影与查询

`world.query` · 语义与投影 · 源码交付

入口：世界与对象；GET /api/world；scripts/world.mjs

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-world-browser.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/world-m1/results.json](../docs/test-results/world-m1/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 可移植 JS 语义 | **world-projection.mjs / world-query.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/world-m1/results.json](../docs/test-results/world-m1/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **node-world-projection.mjs / world.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/world-m1/results.json](../docs/test-results/world-m1/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面／本机编辑服务GUI及Node语义命令、Android未接入。边界：正文+登记派生只读观察快照，保留来源范围与修订；present-unverified 不代表资源字节已核验；Android 未接。

下一步：World 核心 Rust 化；持久模型/协作权限/Android 适配未实现。

<a id="world.property-set"></a>
### 单对象单属性语义修改

`world.property-set` · 语义与投影 · 源码交付

入口：世界与对象 → 预览修改／应用；POST /api/world/commands: property.set；scripts/world.mjs

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **world-commands.mjs / world-command-contract.mjs 等**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/world-m2/results.json](../docs/test-results/world-m2/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **node-world-commands.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/world-m2/results.json](../docs/test-results/world-m2/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 交互与渲染 | **app-world-browser.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/world-m2/results.json](../docs/test-results/world-m2/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面／本机编辑服务GUI及Node语义命令、Android未接入。边界：预览无写入、修订核对、保真单字段、受基线约束反向命令；与旧文档编辑共享锁。

下一步：任意结构字段变化、通用撤销历史、Android 语义写入未实现。

<a id="world.changeset"></a>
### 批量属性提交、读取屏障与崩溃恢复

`world.changeset` · 语义与投影 · 源码交付

入口：世界与对象 → 待提交修改；POST /api/world/commands: changeset.apply / world.recover；GET /api/world/transaction

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **world-changeset.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/world-m3/results.json](../docs/test-results/world-m3/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **node-world-commands.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/world-m3/results.json](../docs/test-results/world-m3/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 存储与事务 | **world-transactions.mjs / world-transaction-state.mjs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/world-m3/results.json](../docs/test-results/world-m3/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 交互与渲染 | **app-world-browser.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/world-m3/results.json](../docs/test-results/world-m3/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面／本机编辑服务GUI及Node语义命令、Android未接入。边界：最多 32 个现有对象、每对象一个属性；持久意图+镜像+提交标记，全旧／全新恢复；Linux SIGKILL 实测，不等于硬件断电认证。

下一步：混合创建／关系／资源事务、同对象多字段、永久历史、Android 写入适配仍缺。

<a id="world.object-create"></a>
### 新对象正文与登记共同创建

`world.object-create` · 语义与投影 · 源码交付

入口：世界与对象 → 新建对象；POST /api/world/commands: object.create

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **world-object-create.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/world-create/results.json](../docs/test-results/world-create/results.json)、[docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **node-world-commands.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/world-create/results.json](../docs/test-results/world-create/results.json)、[docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 存储与事务 | **world-transactions.mjs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/world-create/results.json](../docs/test-results/world-create/results.json)、[docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 交互与渲染 | **app-world-browser.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/world-create/results.json](../docs/test-results/world-create/results.json)、[docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面／本机编辑服务GUI及Node语义命令、Android未接入。边界：v2 事务意图共同发布两个新文件；与空正文区分；不允许任意附带关系；原生归档互操作已验。

下一步：更多对象类型的组合语义创建、Android 语义入口。

<a id="world.relation-add"></a>
### 引用／共享归属关系追加

`world.relation-add` · 语义与投影 · 源码交付

入口：世界与对象 → 添加关系；POST /api/world/commands: relation.add

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **world-relations.mjs / world-record-edit.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/world-relations/results.json](../docs/test-results/world-relations/results.json)、[docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **node-world-commands.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/world-relations/results.json](../docs/test-results/world-relations/results.json)、[docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 存储与事务 | **world-transactions.mjs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/world-relations/results.json](../docs/test-results/world-relations/results.json)、[docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 交互与渲染 | **app-world-browser.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/world-relations/results.json](../docs/test-results/world-relations/results.json)、[docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面／本机编辑服务GUI及Node语义命令、Android未接入。边界：part-of / references；追加单登记 token、保留未知内容；归属循环拒绝、引用循环允许；v3 日志核对其他登记图。

下一步：关系删除／更换与多关系批次尚无对应命令；Android 未接。

<a id="world.resource-bind"></a>
### 为对象追加已登记素材用途

`world.resource-bind` · 语义与投影 · 源码交付

入口：世界与对象 → 绑定资源；POST /api/world/commands: resource.bind

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **world-resources.mjs / world-record-edit.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/world-resources/results.json](../docs/test-results/world-resources/results.json)、[docs/test-results/release-0.0.5/results.json](../docs/test-results/release-0.0.5/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **node-world-commands.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/world-resources/results.json](../docs/test-results/world-resources/results.json)、[docs/test-results/release-0.0.5/results.json](../docs/test-results/release-0.0.5/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 存储与事务 | **world-transactions.mjs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/world-resources/results.json](../docs/test-results/world-resources/results.json)、[docs/test-results/release-0.0.5/results.json](../docs/test-results/release-0.0.5/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 交互与渲染 | **app-world-browser.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/world-resources/results.json](../docs/test-results/world-resources/results.json)、[docs/test-results/release-0.0.5/results.json](../docs/test-results/release-0.0.5/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面／本机编辑服务GUI及Node语义命令、Android未接入。边界：v4 日志；图片／音视频／字体／文本／其他及自定义 role；离线身份允许、文件不复制；绑定不等于正文播放器或字节验证。

下一步：解绑／更换及混合事务、Android 语义操作。

<a id="projection.authoring"></a>
### 同一 OC 的子模板及多份用途投影创建／编辑

`projection.authoring` · 语义与投影 · 源码交付

入口：世界与对象 → 创建／编辑投影；POST /api/world/commands: projection.create / projection.update

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-object-projection.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/oc-projections/results.json](../docs/test-results/oc-projections/results.json)、[docs/test-results/oc-projection-edit/results.json](../docs/test-results/oc-projection-edit/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json) |
| 可移植 JS 语义 | **object-projection-template.mjs / object-projection.mjs 等**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/oc-projections/results.json](../docs/test-results/oc-projections/results.json)、[docs/test-results/oc-projection-edit/results.json](../docs/test-results/oc-projection-edit/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json) |
| 本机服务与适配 | **node-world-commands.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/oc-projections/results.json](../docs/test-results/oc-projections/results.json)、[docs/test-results/oc-projection-edit/results.json](../docs/test-results/oc-projection-edit/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json) |

平台：桌面／本机浏览器；具体界面与安装验收分开。边界：投影独立 UUID、完整子模板快照、来源 OC 固定；v6/v7 事务；图像追加绑定；场景继承解析有效值；不改写原 OC 背景身份；模板/来源/保存路径改换以及批量投影编辑不在现有表单范围；历史图片绑定保留，可能扩大导出依赖；Android 无创作入口；新版 Tauri 安装窗口未验收。

下一步：任意运行语义／行为契约、第三方模板插件、Android 投影界面与新版 Tauri 窗口验收。

<a id="media.embed-play"></a>
### 图片／视频／音频导入、引用、草稿预览与播放

`media.embed-play` · 素材与迁移 · 源码交付

入口：素材选择器／粘贴／拖入；GET/POST /api/assets；POST /api/assets/insert

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-media-editor.js / app-media-render.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/media-insertion-2026-09-23/results.json](../docs/test-results/media-insertion-2026-09-23/results.json)、[docs/test-results/native-current-2026-09-24/results.json](../docs/test-results/native-current-2026-09-24/results.json)、[docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json) |
| 可移植 JS 语义 | **media-insertion.mjs / media-format.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/media-insertion-2026-09-23/results.json](../docs/test-results/media-insertion-2026-09-23/results.json)、[docs/test-results/native-current-2026-09-24/results.json](../docs/test-results/native-current-2026-09-24/results.json)、[docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json) |
| 本机服务与适配 | **media-assets.mjs / media-insertion.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/media-insertion-2026-09-23/results.json](../docs/test-results/media-insertion-2026-09-23/results.json)、[docs/test-results/native-current-2026-09-24/results.json](../docs/test-results/native-current-2026-09-24/results.json)、[docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json) |

平台：桌面／本机浏览器；具体界面与安装验收分开。边界：稳定引用/旧路径兼容；结构化补丁保真；素材导入先落盘、放弃草稿不自动删素材；本地播放受平台解码器能力限制。

下一步：Android 媒体访问／上传／播放器未接；资源垃圾回收不能以未保存草稿简单判断。

<a id="export.document-share"></a>
### 文档阅读分享包与受控下载生命周期

`export.document-share` · 素材与迁移 · 源码交付

入口：导出 → HTML / Markdown 分享；POST/GET /api/export

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-export.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/export-references-2026-09-23/results.json](../docs/test-results/export-references-2026-09-23/results.json)、[docs/test-results/export-downloads-2026-09-24/results.json](../docs/test-results/export-downloads-2026-09-24/results.json)、[docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json) |
| 本机服务与适配 | **export-package.mjs / export-render.mjs 等**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/export-references-2026-09-23/results.json](../docs/test-results/export-references-2026-09-23/results.json)、[docs/test-results/export-downloads-2026-09-24/results.json](../docs/test-results/export-downloads-2026-09-24/results.json)、[docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json) |

平台：桌面／本机浏览器；具体界面与安装验收分开。边界：选中文档+附属内容+所需素材，通用布局导出 ZIP；取消、流中断、名额和过期回收；共享内容与完整工程迁移分开；分享包不能用作完整项目恢复；Android 未接入；播放取决于阅读软件编解码支持。

下一步：Android 分享导出未接；新打包宿主保存窗口仍需当前安装包验收。

<a id="resource.package"></a>
### 选择式资源包依赖闭包、冲突预览与追加导入

`resource.package` · 素材与迁移 · 源码交付

入口：资源包面板；/api/resource-packages

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-resource-packages.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/resource-packages/results.json](../docs/test-results/resource-packages/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/oc-projections/results.json](../docs/test-results/oc-projections/results.json) |
| 可移植 JS 语义 | **resource-package.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/resource-packages/results.json](../docs/test-results/resource-packages/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/oc-projections/results.json](../docs/test-results/oc-projections/results.json) |
| 本机服务与适配 | **resource-package-service.mjs / resource-package-export.mjs 等**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/resource-packages/results.json](../docs/test-results/resource-packages/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/oc-projections/results.json](../docs/test-results/oc-projections/results.json) |
| 存储与事务 | **resource-package-transaction.mjs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/resource-packages/results.json](../docs/test-results/resource-packages/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/oc-projections/results.json](../docs/test-results/oc-projections/results.json) |

平台：桌面／本机浏览器；具体界面与安装验收分开。边界：选择对象及依赖闭包；验证、冲突预览、独立持久导入事务；保留 UUID、归属和原字节；只读服务只开放清单／导出；Android 未接入资源包 UI；导入恢复中的 fence 不能按缓存清理；外部改动停止恢复；旧功能图 50 条链未包含此能力。

下一步：Android 选择式导入导出未接；无升级覆盖或任意合并语义。

<a id="resource.original-export"></a>
### 单个登记素材原始字节再导出

`resource.original-export` · 素材与迁移 · 源码交付

入口：素材卡／资源包列表 → 导出原始文件；/api/export

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-media-editor.js / app-resource-packages.js 等**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/asset-export/results.json](../docs/test-results/asset-export/results.json)、[docs/test-results/release-0.0.5/results.json](../docs/test-results/release-0.0.5/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **export-package.mjs / export-service.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/asset-export/results.json](../docs/test-results/asset-export/results.json)、[docs/test-results/release-0.0.5/results.json](../docs/test-results/release-0.0.5/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 存储与事务 | **export.rs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/asset-export/results.json](../docs/test-results/asset-export/results.json)、[docs/test-results/release-0.0.5/results.json](../docs/test-results/release-0.0.5/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面／本机浏览器；具体界面与安装验收分开。边界：以登记身份定位图片／视频／音频，保留字节与可携文件名；导出不改草稿和光标；微型视频测试只验证传输不是解码；不带 UUID 或元数据；跨工程保留身份应使用资源包；Android 未接入，新原生选择器窗口待验收；小视频 fixture 仅验证字节传输，不代表解码。

下一步：Android 未接；新版本原生保存对话框实测待补。

<a id="authoring.languages"></a>
### 中英日界面切换及草稿保留

`authoring.languages` · 创作与工程 · 源码交付

入口：设置 → 简体中文 / English / 日本語

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **index.js / en.js 等**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/trilingual-2026-09-24/results.json](../docs/test-results/trilingual-2026-09-24/results.json)、[docs/test-results/translation-refinement-2026-09-24/results.json](../docs/test-results/translation-refinement-2026-09-24/results.json)、[docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json) |
| 桌面宿主 | **preferences.rs**；桌面系统能力和会话；不能替代Web/Android验收。 | 4 / 4 / 3 / 3 | [docs/test-results/trilingual-2026-09-24/results.json](../docs/test-results/trilingual-2026-09-24/results.json)、[docs/test-results/translation-refinement-2026-09-24/results.json](../docs/test-results/translation-refinement-2026-09-24/results.json)、[docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json) |

平台：桌面／本机浏览器／Android各自设置与草稿保留、作品内容维持原文，不作自动翻译。边界：界面与诊断本地化；切换保留草稿／焦点／选择；作者类型名、字段与正文不自动翻译。

下一步：新增功能文案持续覆盖；设备字体/输入法与更多原生平台仍需实测。

<a id="host.library"></a>
### 作品库、起始模板与最近工程

`host.library` · 宿主与存储 · 源码交付

入口：desktop/ui/app.js → library_state / new_workspace / choose_workspace / launch_workspace

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/project-templates/results.json](../docs/test-results/project-templates/results.json)、[docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json) |
| 桌面宿主 | **desktop_host.rs**；桌面系统能力和会话；不能替代Web/Android验收。 | 4 / 4 / 3 / 3 | [docs/test-results/project-templates/results.json](../docs/test-results/project-templates/results.json)、[docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json) |
| 存储与事务 | **workspace.rs / project_templates.rs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/project-templates/results.json](../docs/test-results/project-templates/results.json)、[docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json) |
| 工程定义与格式 | **project-templates.json**；声明式工程类型/模板或格式；不等于可执行脚本插件。 | 4 / 4 / 3 / 3 | [docs/test-results/project-templates/results.json](../docs/test-results/project-templates/results.json)、[docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json) |

平台：Tauri桌面作品库；新选择器尚待实际安装窗口验收、Android作品库入口见移动宿主条目；普通浏览器无原生作品库。边界：新增起始包选择器尚无当前0.0.7 Tauri窗口/安装包验收；打开任意文件夹先验证 v1/v2/v3，旧工程不强制迁移。

下一步：补验新模板选择器在安装包中的创建／重开与最近工程。

<a id="host.desktop-session"></a>
### 桌面会话、服务进程与关闭保护

`host.desktop-session` · 宿主与存储 · 源码交付

入口：launch_workspace → session.lock → Node sidecar ready → token/Cookie → editor；resume_editor / close_editor / __desktop/close-response

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 桌面宿主 | **desktop_host.rs / close_state.rs**；桌面系统能力和会话；不能替代Web/Android验收。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/scene-layout/results.json](../docs/test-results/scene-layout/results.json)、[docs/test-results/build-workbench/results.json](../docs/test-results/build-workbench/results.json) |
| 本机服务与适配 | **desktop-session.mjs / doc-server.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/scene-layout/results.json](../docs/test-results/scene-layout/results.json)、[docs/test-results/build-workbench/results.json](../docs/test-results/build-workbench/results.json) |

平台：Tauri桌面会话、窗口及原生桥、当前实测以Linux历史安装为界；新布局关窗链待Tauri验收。边界：场景布局关闭保护有源码回归，新增界面尚未在新安装包上重新验收；跨重启任务身份与宿主崩溃恢复未实现。

下一步：新布局／Rust增量需要在真实Tauri窗口验收关闭保护。

<a id="storage.full-archive"></a>
### 完整工程归档和恢复

`storage.full-archive` · 宿主与存储 · 源码交付

入口：作品库 backup_workspace / restore_workspace；POST /api/export kind=project；Android 完整包入口

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 存储与事务 | **workspace.rs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/scene-selection/results.json](../docs/test-results/scene-selection/results.json) |
| 本机服务与适配 | **export-package.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/scene-selection/results.json](../docs/test-results/scene-selection/results.json) |
| Android 宿主 | **mobile_archive.rs**；Android请求/存储/迁移适配；只覆盖已声明移动子集。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/scene-selection/results.json](../docs/test-results/scene-selection/results.json) |

平台：Tauri桌面导入／导出、本机浏览器仅完整包导出，恢复使用桌面宿主、Android私有目录与SAF完整包迁移。边界：最新 Rust 核心轮次未提供归档和移动存储辅助程序，该 19 项跳过不能覆盖旧证据；多 GiB 实作容量、空间耗尽和断电未验收；大作品测试按配置忽略。

下一步：每次增加作者数据类型，补齐跨宿主往返与失败恢复。

<a id="export.jobs-delivery"></a>
### 导出准备、下载、原生保存及清理

`export.jobs-delivery` · 素材与迁移 · 源码交付

入口：POST /api/export prepare/release；GET /api/export Range/HEAD；POST /__desktop/export → save_editor_export

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 本机服务与适配 | **export-service.mjs / doc-server-routes.mjs 等**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json)、[docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 存储与事务 | **export.rs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json)、[docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 桌面宿主 | **desktop_host.rs**；桌面系统能力和会话；不能替代Web/Android验收。 | 4 / 4 / 3 / 3 | [docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json)、[docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面／本机浏览器；具体界面与安装验收分开。边界：Windows/macOS 原生对话框和不同文件系统待验收；最新单素材任务扩展没有新原生窗口验收。

下一步：继续按取消、断连、未知原生保存结果做端到端检查。

<a id="storage.workspace-maintenance"></a>
### 工程核验、外置素材绑定和旧登记迁移

`storage.workspace-maintenance` · 宿主与存储 · 源码交付

入口：npm run workspace -- paths|register|verify|check-project|bind-assets|migrate-documents|apply-definition

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 本机服务与适配 | **workspace.mjs / workspace.mjs 等**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/document-migration-2026-09-23/results.json](../docs/test-results/document-migration-2026-09-23/results.json)、[docs/test-results/asset-binding-2026-09-23/results.json](../docs/test-results/asset-binding-2026-09-23/results.json)、[docs/test-results/project-definition-2026-09-23/results.json](../docs/test-results/project-definition-2026-09-23/results.json) |

平台：Node CLI；显式选定工程后运行。边界：本轮只核对源码与旧报告，未对日常作品运行迁移；特定旧作品维护脚本不等同通用工作流。

下一步：维护工具继续限定在显式选择工程，保持旧格式兼容与事务屏障。

<a id="storage.application-isolation"></a>
### 程序/工程/本机数据隔离

`storage.application-isolation` · 宿主与存储 · 源码交付

入口：appStoragePaths、workspace layout、宿主 app_data_dir/app_config_dir

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 本机服务与适配 | **app-storage.mjs / paths.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/project-templates/results.json](../docs/test-results/project-templates/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 工程定义与格式 | **workspace-layout.json**；声明式工程类型/模板或格式；不等于可执行脚本插件。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/project-templates/results.json](../docs/test-results/project-templates/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 存储与事务 | **workspace.rs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/project-templates/results.json](../docs/test-results/project-templates/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| Android 宿主 | **mobile_storage.rs**；Android请求/存储/迁移适配；只覆盖已声明移动子集。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/project-templates/results.json](../docs/test-results/project-templates/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面应用目录及Node本机服务、Android应用私有工程／本机设置／恢复草稿。边界：v4 仍未实现，不能把 World 投影当作权威新格式；Android 私有目录；卸载或清除数据会删除作品。

下一步：构建会话跨重启的派生物清理和归属发现仍待接入。

<a id="host.android-editing"></a>
### Android 无 Node 编辑宿主

`host.android-editing` · 宿主与存储 · 源码交付

入口：mobile/library.js → 编辑器 → mobile/platform.mjs → mobile_storage

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| Android 宿主 | **library.js / editor.js 等**；Android请求/存储/迁移适配；只覆盖已声明移动子集。 | 4 / 4 / 3 / 3 | [docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json)、[docs/test-results/project-templates/results.json](../docs/test-results/project-templates/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json) |

平台：Android源码；旧模拟器证据限定当时版本、真机与新增模板入口待验收。边界：0.0.6 起始模板仅浏览器/真实存储联调，新 APK 未构建；World、媒体访问/管理、配置界面、资源包、场景/构建工作台均未接入；单文本1 MiB、每工程最多20000文档；实体手机待测。

下一步：按能力逐条接入媒体／World，补新模板的设备验收。

<a id="host.android-draft-recovery"></a>
### Android 草稿和新建恢复

`host.android-draft-recovery` · 宿主与存储 · 源码交付

入口：编辑变更/pagehide/visibility → 本机草稿存储 → 重开恢复；新建文档 → .viento/mobile-create 恢复意图

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| Android 宿主 | **drafts.mjs / editor.js 等**；Android请求/存储/迁移适配；只覆盖已声明移动子集。 | 4 / 4 / 3 / 3 | [docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/mobile-drafts.test.mjs](../scripts/tests/mobile-drafts.test.mjs) |

平台：Android源码；旧模拟器证据限定当时版本、真机与新增模板入口待验收。边界：恢复副本不是备份；低内存回收、输入法组合字、设备供应商差异待验收。

下一步：补更多真机/WebView生命周期和输入法恢复组合。

<a id="host.android-transfer"></a>
### Android SAF 完整工程迁移

`host.android-transfer` · 宿主与存储 · 源码交付

入口：作品库 → 系统文件选择器 → 导入/导出完整包

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| Android 宿主 | **mobile_archive.rs / mobile_transfer.rs**；Android请求/存储/迁移适配；只覆盖已声明移动子集。 | 4 / 4 / 3 / 3 | [docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| Android 宿主 | **ArchiveTransferPlugin.kt**；Kotlin插件连接Android系统文件选择器，负责SAF流传输与状态回报。 | 4 / 4 / 3 / 3 | [docs/test-results/workflow-b.4.5/results.json](../docs/test-results/workflow-b.4.5/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：Android源码；旧模拟器证据限定当时版本、真机与新增模板入口待验收。边界：ZIP1 GiB、解包4 GiB、50000条目；v1需先桌面升级；第三方云盘/外置提供方、复制时进程终止/权限撤回、真机未验收；0.0.7 APK 未构建。

下一步：新数据格式必须追加SAF设备往返，区分私有草稿和工程数据。

<a id="delivery.packaging"></a>
### 源码、桌面与移动资源交付

`delivery.packaging` · 验证与交付 · 源码交付

入口：desktop:prepare/build、mobile:prepare、desktop/package-source.py、手动 CI

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 构建与分发 | **prepare.mjs / build.mjs 等**；开发构建或打包资源；不等于实际安装验收。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json) |
| 构建与分发 | **prepare.mjs**；开发时准备移动端离线静态资源及WASM；不提供Android场景运行入口。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json) |
| 验证与维护 | **desktop.yml / check.yml**；开发验证与维护工具；不属于作者运行语义。 | 3 / 1 / 3 / 3 | [docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json) |

平台：开发与CI构建命令；非产品浏览器功能、当前Rust组合完成源码与资源验证，未验新安装包、Linux最近安装实测0.0.4；Windows/macOS与新Android包分别待验。边界：0.0.5/0.0.6/0.0.7均无新安装包；不能以资源准备通过代替运行验收；Windows/macOS原生验收未完成，Android发行签名未配置；CI手动触发只生成构件，不自动GitHub Release；分发机制既有；含共享Rust核心的组合已纳入0.0.7源码交付，尚无新安装包验收。

下一步：对含Rust核心的实际安装包做Linux及Android验收；Windows/macOS待目标机验证。

<a id="delivery.generated-cleanup"></a>
### 构建缓存与磁盘清理

`delivery.generated-cleanup` · 验证与交付 · 源码交付

入口：npm run clean -- --dry-run / npm run clean

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 构建与分发 | **clean.mjs**；开发构建或打包资源；不等于实际安装验收。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/build-cleanup.test.mjs](../scripts/tests/build-cleanup.test.mjs) |

平台：开发者Node清理CLI；实际工程外工具链需独立管理。边界：自定义Cargo target/临时模拟器不在默认清理范围；资源包事务目录不能当缓存；已有清理工具纳入源码发布；Rust目标与WASM清理扩展已纳入0.0.7源码。

下一步：补跨会话构建产物发现与保留策略，恢复日志不作缓存。

<a id="quality.validation-support"></a>
### 契约检查、回归与证据保存

`quality.validation-support` · 验证与交付 · 源码交付

入口：npm run check -- --app-only / core:test / desktop:test / 浏览器及原生专项脚本

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 验证与维护 | **check-project.mjs / verify-doc-api-contract.mjs 等**；开发验证与维护工具；不属于作者运行语义。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/scene-selection/results.json](../docs/test-results/scene-selection/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json) |
| 本机服务与适配 | **doc-api-contract.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/scene-selection/results.json](../docs/test-results/scene-selection/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json) |

平台：开发者CLI、自动化测试与CI配置、本地记录与CI运行结果分别取证。边界：测试总数不表示功能覆盖率；不同工具配置导致不同跳过数；最新轮次19项归档/移动存储跳过，真实Godot和核心native/WASM启用；未验证的平台/尚未实现功能不能列为已测试。

下一步：每次验证记录实际工具与跳过项，持续补原生窗口／设备和大规模性能。

<a id="host.local-service"></a>
### 本机编辑/只读服务与能力边界

`host.local-service` · 宿主与存储 · 源码交付

入口：npm start / npm run browse → scripts/ops/site.mjs；GET /api/capabilities；本机请求鉴权与静态资源白名单

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 本机服务与适配 | **site.mjs / site-launcher.mjs 等**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：Node CLI启动的本机浏览器编辑／只读服务、Tauri内部复用该服务；Android无Node服务。边界：不是公网托管或任意文件访问入口；只读服务不提供语义写入、工程设置、Build或导入；用户浏览器仍依赖本地服务。

下一步：继续区分浏览与编辑能力；新核心资源不得扩大文件访问范围。

<a id="scene.authoring_v1"></a>
### Scene2D v1 创建与来源保真的编辑

`scene.authoring_v1` · 场景与构建 · 源码交付

入口：构建与运行 → 编辑既有v1场景；scene.create / scene.update保留v1兼容

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-scene-create.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/scene-authoring/results.json](../docs/test-results/scene-authoring/results.json)、[docs/test-results/scene-edit/results.json](../docs/test-results/scene-edit/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 可移植 JS 语义 | **world-scene-create.mjs / world-scene-update.mjs 等**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-authoring/results.json](../docs/test-results/scene-authoring/results.json)、[docs/test-results/scene-edit/results.json](../docs/test-results/scene-edit/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 存储与事务 | **world-transactions.mjs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-authoring/results.json](../docs/test-results/scene-authoring/results.json)、[docs/test-results/scene-edit/results.json](../docs/test-results/scene-edit/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：Linux本机编辑服务、新版Tauri窗口和Android未验收/未接入。边界：v1 扁平 actors 1–128 个，同一 objectId 只可出现一次；角色、图片、方向键和 idle/moving，非通用脚本/状态机；跨文件剧本原子提交尚无模型；新版界面新建默认v2；既有v1不会自动迁移，显式启用实例或逻辑分组并预览保存后才升级；增量分别见scene.instances_v2/scene.groups_v3。

下一步：保持v1冻结计划、生成器摘要与原文保真兼容；后续文本结构沿独立版本演进。

<a id="build.snapshot_plan"></a>
### 冻结输入、可移植计划与能力检查

`build.snapshot_plan` · 场景与构建 · 源码交付

入口：构建与运行 → 检查计划；scripts/project-build.mjs

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **build-plan.mjs / project-build-contract.mjs**；场景模型解析后按版本发射v1/v2计划DTO及能力校验；本行源码交付以旧v1为基线，v2的0.0.7源码范围另列独立实例。 | 4 / 4 / 3 / 3 | [docs/test-results/scene2d-build/results.json](../docs/test-results/scene2d-build/results.json)、[docs/test-results/build-workbench/results.json](../docs/test-results/build-workbench/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json) |
| 本机服务与适配 | **node-build-snapshot.mjs / project-build.mjs**；保存输入的本机冻结编排与宿主适配；新增独立只读draft捕获不得改变captureBuildSnapshot旧快照或使构建消费未保存文本。 | 4 / 4 / 3 / 3 | [docs/test-results/scene2d-build/results.json](../docs/test-results/scene2d-build/results.json)、[docs/test-results/build-workbench/results.json](../docs/test-results/build-workbench/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json) |

平台：Linux本机编辑服务、新版Tauri窗口和Android未验收/未接入。边界：JSON范围、场景语义/投影继承与计划发射已分层；v1/v2作者对应plan1/2，v3逻辑组编译为plan2；来源/分组侧带信息不进入构建计划，原文仍进入冻结快照；仅 Scene2D 受限能力；尚未迁 Rust；不从任意故事正文自动推导可执行游戏；v2双身份冻结重放与v3逻辑组已纳入0.0.7源码；旧v1/v2计划、生成文件和后端摘要保持，v3仅使用现有v2运行协议；captureBuildSnapshot仍只读取保存文件且忽略未知draft选项；只读草稿捕获使用独立入口/身份域，不提供可执行快照或污染构建任务缓存。。

下一步：把后续层次、片段和行为依赖接入冻结输入，保留旧格式重放和来源边界。

<a id="runtime.godot_generated_project"></a>
### Godot 4 工程生成与运行协议

`runtime.godot_generated_project` · 场景与构建 · 源码交付

入口：buildProject/runProjectBuild → generateGodotProject → fixed Godot scene/runtime

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 执行后端 | **godot4.mjs / runtime.gd**；冻结v1具体执行后端，原始生成器/脚本字节和后端摘要保留；v2由独立i104适配，作者数据权威不变。 | 4 / 4 / 3 / 3 | [docs/test-results/scene2d-build/results.json](../docs/test-results/scene2d-build/results.json)、[docs/test-results/scene2d-build/window-session.json](../docs/test-results/scene2d-build/window-session.json)、[docs/test-results/build-workbench/results.json](../docs/test-results/build-workbench/results.json) |
| 本机服务与适配 | **node-project-build.mjs**；按冻结计划选择v1/v2后端并严格核对协议/摘要；旧v1源码交付基线保留，v2源码范围另列。 | 4 / 4 / 3 / 3 | [docs/test-results/scene2d-build/results.json](../docs/test-results/scene2d-build/results.json)、[docs/test-results/scene2d-build/window-session.json](../docs/test-results/scene2d-build/window-session.json)、[docs/test-results/build-workbench/results.json](../docs/test-results/build-workbench/results.json) |
| 执行后端 | **godot4-dispatch.mjs / godot4-instances.mjs / runtime-v2.gd**；0.0.7源码交付的v2运行分支；v1仍由i074冻结生成器负责，版本选择及双身份事件不改变作者定义。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/runtime-review-tests.log](../docs/test-results/scene-instances/runtime-review-tests.log)、[docs/test-results/scene-instances/packaged-resources.json](../docs/test-results/scene-instances/packaged-resources.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：Linux本机编辑服务、新版Tauri窗口和Android未验收/未接入。边界：仅 Linux 启用；产物为需要 Godot 的工程，非独立发行程序；runtime.gd 固定；不支持挂载任意作者 GDScript；无嵌入视口/GPU 计算/物理/音频行为；v1与v2生成器/运行脚本字节冻结；v3作者逻辑组编译为既有plan2，运行层不接收groupId或组结构；实例/定义双身份继续沿用v2。

下一步：接入明确的作者行为契约及GDScript薄绑定，保持固定运行边界。

<a id="build.workbench_lifecycle"></a>
### 构建工作台、诊断、取消与进程回收

`build.workbench_lifecycle` · 场景与构建 · 源码交付

入口：web/modules/app-project-build.js → local build API → createProjectBuildService

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-project-build.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/build-workbench/results.json](../docs/test-results/build-workbench/results.json)、[docs/test-results/build-workbench/browser.json](../docs/test-results/build-workbench/browser.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **project-build-service.mjs / build-process.mjs 等**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/build-workbench/results.json](../docs/test-results/build-workbench/results.json)、[docs/test-results/build-workbench/browser.json](../docs/test-results/build-workbench/browser.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：Linux本机编辑服务、新版Tauri窗口和Android未验收/未接入。边界：仅 Linux 本机编辑服务；只读浏览/Android 无入口；单服务单任务；任务身份只属于当前服务会话；SIGKILL/断电恢复及跨重启任务发现未实现；本会话仅保留最近三份自建输出，不自动删以前会话/CLI 产物。

下一步：补跨重启任务与崩溃残留发现，目标系统分别验收。

<a id="scene.saved_preview"></a>
### 无需引擎的已保存场景预览

`scene.saved_preview` · 场景与构建 · 源码交付

入口：构建与运行 → 场景预览 → POST /api/scene-preview

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-scene-preview.js / app-scene-preview-canvas.js**；保存态和草稿预览在同视图显式分支；保存态入口仍只看磁盘，草稿只读能力单列scene.text_draft_preview。 | 4 / 4 / 2 / 3 | [docs/test-results/scene-preview/results.json](../docs/test-results/scene-preview/results.json)、[docs/test-results/scene-preview/browser.json](../docs/test-results/scene-preview/browser.json)、[docs/test-results/scene-source-model/results.json](../docs/test-results/scene-source-model/results.json) |
| 可移植 JS 语义 | **scene-preview-contract.mjs**；既有保存态预览路径的共享JS传输契约；新增草稿源预算另列scene.text_draft_preview源码评分，不据此推断语义已迁Rust。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-preview/results.json](../docs/test-results/scene-preview/results.json)、[docs/test-results/scene-preview/browser.json](../docs/test-results/scene-preview/browser.json)、[docs/test-results/scene-draft-preview/backend.log](../docs/test-results/scene-draft-preview/backend.log) |
| 本机服务与适配 | **scene-preview-service.mjs**；本机保存态预览保持资源冻结/释放及取消边界；新增只读draft分派与无sceneEditing限制另列scene.text_draft_preview源码评分。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-preview/results.json](../docs/test-results/scene-preview/results.json)、[docs/test-results/scene-preview/browser.json](../docs/test-results/scene-preview/browser.json)、[docs/test-results/scene-source-model/results.json](../docs/test-results/scene-source-model/results.json) |

平台：Linux本机编辑服务、新版Tauri窗口和Android未验收/未接入。边界：静态保存态，不推进运行输入/状态机；字体/SVG 不保证和 Godot 像素一致；Linux 本机编辑服务入口，Android 未接入；缓存保留两份/128 MiB/十分钟；这不是大型场景性能验收；0.0.7按v2实例选择与定位，共享定义/图片不合并实例；具体交付见scene.instances_v2；v3逻辑分组通过独立sceneStructure侧带进入共享大纲；树与查询不改变plan2演员顺序或静态画布渲染；当前原文草稿是独立的scene.text_draft_preview源码能力；保存态刷新、图形布局和可执行构建不隐式消费未保存文本。。

下一步：在分组与搜索基础上验证更大场景的导航和按需资源加载，空间变换与可复用片段单独定义。

<a id="scene.layout_draft"></a>
### 布局草稿、多选与显式事务保存

`scene.layout_draft` · 场景与构建 · 源码交付

入口：场景预览 → 编辑场景布局 → 预览布局修改 → 保存布局

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-scene-layout.js / app-scene-preview-canvas.js**；选择、拖拽预览、坐标输入与渲染；只接受保存态sceneEditing，草稿预览无图形写入入口。关闭/初始化失败释放会话，Rust提供保存状态，JS校验回执并执行I/O。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-layout/results.json](../docs/test-results/scene-layout/results.json)、[docs/test-results/scene-selection/results.json](../docs/test-results/scene-selection/results.json)、[docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json) |
| 可移植 JS 语义 | **scene-layout.mjs / world-scene-update.mjs：作者源适配与保存命令**；作者源适配和scene.update命令规划；从Rust快照读位置/dirty，保留源文本、继承/null与修订；没有JS历史栈。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-layout/results.json](../docs/test-results/scene-layout/results.json)、[docs/test-results/scene-selection/results.json](../docs/test-results/scene-selection/results.json)、[docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json) |
| 共享 Rust 核心 | **Cargo.toml / lib.rs 等**；布局编辑复用Rust几何与批次校验；同功能的权威位置/历史另绑定i095，作者源留在JS适配器，保存状态由独立Rust工作流提供，回执正文仍由JS校验。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/rust-studio-core/rust-core.log](../docs/test-results/rust-studio-core/rust-core.log)、[docs/test-results/rust-layout-history/results.json](../docs/test-results/rust-layout-history/results.json) |
| 共享 Rust 核心 | **layout_draft.rs：权威位置与有界历史**；布局界面与JS作者源适配共同消费Rust权威位置/dirty/撤销重做；生命周期结束close释放，不在JS保留第二份历史。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-layout-history/results.json](../docs/test-results/rust-layout-history/results.json)、[docs/test-results/rust-layout-history/selection-browser/browser.json](../docs/test-results/rust-layout-history/selection-browser/browser.json)、[docs/test-results/rust-layout-history/layout-browser/browser.json](../docs/test-results/rust-layout-history/layout-browser/browser.json) |
| 共享 Rust 核心 | **layout_save.rs：保存阶段、错误分类与请求令牌**；位置草稿共享Rust保存状态机；非editable阶段拒绝原生位置变更与历史操作，实际变更失效审阅。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-layout-save/results.json](../docs/test-results/rust-layout-save/results.json)、[docs/test-results/rust-layout-save/layout-browser/browser.json](../docs/test-results/rust-layout-save/layout-browser/browser.json)、[docs/test-results/rust-layout-save/selection-browser/browser.json](../docs/test-results/rust-layout-save/selection-browser/browser.json) |

平台：Linux本机编辑服务、新版Tauri窗口和Android未验收/未接入。边界：布局草稿仅改现有角色position；v3逻辑组的后代多选另见scene.groups_v3，无空间父子变换/框选/旋转/缩放/分布；Rust持有初始/当前位置和100步撤销重做；32个会话、每会话1–128角色，关闭释放；仅内存非崩溃恢复；JS镜像Rust位置与保存快照；作者源适配、scene.update组装、回执正文/摘要及只读核对I/O仍在JS；界面保留选择、拖拽预览、未提交坐标输入、关闭保护和渲染；不是全Rust编辑器；已纳入0.0.7源码；新安装包/Tauri窗口/Android未验收；v2实例键由JS映射到既有Rust布局协议的opaque objectId；作者objectId仍指向定义，该几何操作域不解释完整场景；受限源码检查另列scene.source_layout；草稿预览仍不授予sceneEditing或World布局保存；当前源码草稿的本地坐标应用另列scene.source_layout，保存态事务仍要求先结束文本草稿。。

下一步：保留逻辑分组作者结构与稳定实例键，继续明确复用片段的几何编辑写回；原生安装与目标设备另验。

<a id="core.layout_rust"></a>
### 共享 Rust 布局规则与原子位置校验

`core.layout_rust` · 共享核心 · 源码交付

入口：protocolVersion 1: move / align / validateBatch

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **Cargo.toml / lib.rs 等**；move/align/validateBatch纯几何协议；草稿状态由独立LayoutDraft消费，文件I/O与渲染在宿主。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/rust-studio-core/rust-core.log](../docs/test-results/rust-studio-core/rust-core.log)、[docs/test-results/rust-layout-history/results.json](../docs/test-results/rust-layout-history/results.json) |

平台：Rust原生测试与桌面浏览器WASM、移动资源准备不等于功能接入/设备验收。边界：本项限定确定性几何和位置批次校验；权威草稿/撤销历史另见core.history_migration；不含解析器/World/作者I/O/渲染；保存阶段由独立Rust工作流负责，回执正文校验仍在宿主；原生CLI测试不等于生产编辑器已改用原生进程；无Tauri/Godot/DOM依赖；用户脚本系统是另一层。

下一步：维持原几何、草稿和保存协议兼容；源码结构检查与补丁另列scene.source_layout，完整来源/字段语义按契约迁移，不引入渲染和文件I/O。

<a id="core.wasm_bridge"></a>
### Rust 核心 WASM 接入与分发资源

`core.wasm_bridge` · 共享核心 · 源码交付

入口：app-studio-core.js / node-studio-core.mjs → initializeStudioCore → synchronous dispatchStudioCore / dispatchStudioCoreDraft / dispatchStudioCoreSave / dispatchStudioCoreSource

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **wasm.rs**；原生/WASM共有分派与拥有缓冲；一次input只能run一次，另有可选source能力版本导出，旧核心不伪装支持新操作。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/rust-studio-core/packaged-sources.json](../docs/test-results/rust-studio-core/packaged-sources.json)、[docs/test-results/rust-studio-core/source-archive.log](../docs/test-results/rust-studio-core/source-archive.log) |
| 可移植 JS 语义 | **studio-core.mjs**；显式注入字节的同步桥，分别验证几何/草稿/保存/source域与响应；source有界正文由Rust检查和补丁，无JS规则回退。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/rust-studio-core/packaged-sources.json](../docs/test-results/rust-studio-core/packaged-sources.json)、[docs/test-results/rust-studio-core/source-archive.log](../docs/test-results/rust-studio-core/source-archive.log) |
| 交互与渲染 | **app-studio-core.js**；浏览器受限加载WASM并注入纯桥接器；只处理超时/体积/加载失败，不含草稿或绘制规则。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/rust-studio-core/packaged-sources.json](../docs/test-results/rust-studio-core/packaged-sources.json)、[docs/test-results/rust-studio-core/source-archive.log](../docs/test-results/rust-studio-core/source-archive.log) |
| 本机服务与适配 | **node-studio-core.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/rust-studio-core/packaged-sources.json](../docs/test-results/rust-studio-core/packaged-sources.json)、[docs/test-results/rust-studio-core/source-archive.log](../docs/test-results/rust-studio-core/source-archive.log) |
| 构建与分发 | **build-studio-core.mjs / prepare.mjs 等**；开发构建或打包资源；不等于实际安装验收。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/rust-studio-core/packaged-sources.json](../docs/test-results/rust-studio-core/packaged-sources.json)、[docs/test-results/rust-studio-core/source-archive.log](../docs/test-results/rust-studio-core/source-archive.log) |
| 构建与分发 | **prepare.mjs**；开发时准备移动端离线静态资源及WASM；不提供Android场景运行入口。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/rust-studio-core/packaged-sources.json](../docs/test-results/rust-studio-core/packaged-sources.json)、[docs/test-results/rust-studio-core/source-archive.log](../docs/test-results/rust-studio-core/source-archive.log) |
| 共享 Rust 核心 | **Cargo.toml / lib.rs 等**；同一protocolVersion 1分派旧几何/草稿/保存和新增stateless source操作；source检查与补丁不创建或改变草稿registry。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/rust-studio-core/rust-core.log](../docs/test-results/rust-studio-core/rust-core.log)、[docs/test-results/rust-layout-history/results.json](../docs/test-results/rust-layout-history/results.json) |
| 共享 Rust 核心 | **layout_draft.rs：权威位置与有界历史**；每个WASM实例/原生线程持有有界草稿registry；请求返回位置快照与状态，历史留在核心，close释放槽位。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-layout-history/results.json](../docs/test-results/rust-layout-history/results.json)、[docs/test-results/rust-layout-history/selection-browser/browser.json](../docs/test-results/rust-layout-history/selection-browser/browser.json)、[docs/test-results/rust-layout-history/layout-browser/browser.json](../docs/test-results/rust-layout-history/layout-browser/browser.json) |
| 共享 Rust 核心 | **layout_save.rs：保存阶段、错误分类与请求令牌**；layoutSave协议与layoutDraft共享会话，无第二套registry；每次完成匹配当前阶段和请求令牌。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-layout-save/results.json](../docs/test-results/rust-layout-save/results.json)、[docs/test-results/rust-layout-save/layout-browser/browser.json](../docs/test-results/rust-layout-save/layout-browser/browser.json)、[docs/test-results/rust-layout-save/selection-browser/browser.json](../docs/test-results/rust-layout-save/selection-browser/browser.json) |
| 共享 Rust 核心 | **scene_source.rs：无状态严格JSON与精确坐标token补丁**；sceneSource.inspect/patch独立操作域，原生/WASM运行同一有界源码规则；能力标志隔离旧核心，旧布局协议与源操作互不授权。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-scene-source/results.json](../docs/test-results/rust-scene-source/results.json)、[docs/test-results/rust-scene-source/packaged-resources.json](../docs/test-results/rust-scene-source/packaged-resources.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：Rust原生测试与桌面浏览器WASM、移动资源准备不等于功能接入/设备验收。边界：WASM承载几何、有界位置草稿、保存工作流及独立的stateless源码检查/补丁；每份input仅run一次，草稿/请求双身份拒绝完成重放。；JS严格校验各操作域及返回结构，拒绝跨域调用；布局历史不经JS往返，source操作单独接收有界正文并返回精确候选，不持有来源或保存权限。；缺失或损坏核心保留静态预览；可选viento_core_scene_source_version()===1声明源码能力，旧核心保留旧布局功能但拒绝新source操作；没有JS几何/历史/源码补丁回退。；打包准备通过不等于Android场景功能或新Tauri安装验收；源码开发需Rust/wasm目标，运行成品不需Rust工具链。

下一步：补当前保存工作流对应的真实Tauri安装包与目标WebView验证；移动场景功能仍独立推进。

<a id="behavior.gdscript_binding"></a>
### GDScript 行为绑定探针

`behavior.gdscript_binding` · 运行后端与演进 · 独立原型

入口：node docs/test-results/behavior-binding/run.mjs

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 执行后端 | **run.mjs / probe.gd 等**；独立GDScript绑定探针，尚未进入作者数据、构建或迁移链。 | 2 / 3 / 2 / 1 | [docs/test-results/behavior-binding/results.json](../docs/test-results/behavior-binding/results.json)、[docs/test-results/behavior-binding/probe.gd](../docs/test-results/behavior-binding/probe.gd) |

平台：Linux独立Godot探针。边界：产品无任意脚本挂载入口/快照/迁移/作者诊断；未验证热重载、大场景、持久格式或脚本恢复；独立探针的行为ID仍不是作者行为协议；产品v2场景实例已经独立接入，但尚不能挂载该探针脚本。

下一步：定义作者脚本资源／参数／事件协议，再接快照、诊断、构建与迁移。

<a id="scene.text_instances"></a>
### 文本驱动场景、定义/实例分离与场景树

`scene.text_instances` · 运行后端与演进 · 规划中

入口：开发路线：文本层次、复用片段与剧本事件（非现有产品入口）

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **文本层次、复用片段、剧本事件与场景树（未实现）**；完整文本场景系统的规划占位；稳定实例、逻辑分组和单源只读预览已另列源码切片，片段展开/剧本事件/共享可写草稿/跨文件原子提交仍未实现。 | 1 / 0 / — / 0 | [docs/test-results/scene-draft-preview/results.json](../docs/test-results/scene-draft-preview/results.json)、[docs/ROADMAP.md](../docs/ROADMAP.md)、[docs/NEXT_ARCHITECTURE.zh-CN.md](../docs/NEXT_ARCHITECTURE.zh-CN.md) |

平台：规划未接入产品。边界：Scene2D v2稳定实例和v3持久逻辑分组已分别形成scene.instances_v2与scene.groups_v3切片，不代表完整文本场景系统完成；actors仍为1–128个实例；逻辑组不改变坐标或绘制顺序，空间父子变换、片段展开、剧本事件和跨文件原子提交仍未实现；分组树与查询不等于大规模场景性能验收，也没有自动迁移旧作品；单场景原文草稿预览与坐标回写分别列scene.text_draft_preview、scene.source_layout；没有源码/表单/布局统一undo，也没有复用片段展开或多文件原子提交。。

下一步：以稳定实例、逻辑组和单源Rust精确回写为底座，先验证确定性片段组合与兼容v3产物、稳定身份和来源映射；作者片段的覆盖/跨文件写回、统一历史与空间变换另立契约。

<a id="runtime.bevy_rust"></a>
### Bevy/Rust 第二后端候选

`runtime.bevy_rust` · 运行后端与演进 · 规划中

入口：路线与行为绑定选型（非产品入口）

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 执行后端 | **Bevy/Rust 第二后端候选（未实现）**；规划占位，尚无生产实现；无适配器、运行协议、作者行为目录/来源映射或UI入口 | 1 / 0 / — / 0 | [docs/PROJECT_BUILD.md](../docs/PROJECT_BUILD.md)、[docs/ROADMAP.md](../docs/ROADMAP.md) |

平台：规划未接入产品。边界：无适配器、运行协议、作者行为目录/来源映射或UI入口；已有Rust核心不代表已有Bevy引擎或Rust作者脚本；不承诺行为自动跨语言互译。

下一步：先复用行为/构建契约做独立真实后端探针，再决定产品接入。

<a id="runtime.native_nuis"></a>
### Nuislang/ns-nova/yalivia 原生执行

`runtime.native_nuis` · 运行后端与演进 · 规划中

入口：ADR 0008 与长期架构（非产品入口）

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 执行后端 | **Nuislang/ns-nova/yalivia 原生执行（未实现）**；规划占位，尚无生产实现；无Nuis构建执行、ns-nova/yalivia接入 | 1 / 0 / — / 0 | [docs/adr/0008-native-nuis-and-bootstrap-runtime.md](../docs/adr/0008-native-nuis-and-bootstrap-runtime.md)、[docs/NEXT_ARCHITECTURE.zh-CN.md](../docs/NEXT_ARCHITECTURE.zh-CN.md)、[docs/ROADMAP.md](../docs/ROADMAP.md) |

平台：规划未接入产品。边界：无Nuis构建执行、ns-nova/yalivia接入；当前开发不以Nuislang就绪为前置；不可将项目内共享Rust算法称作ns-nova引擎接入。

下一步：等待原生公开契约并做最小适配器；不阻塞近期场景与行为。

<a id="studio.native_gui_gpu"></a>
### ns-nova GUI 与异构 GPU 扩展

`studio.native_gui_gpu` · 运行后端与演进 · 规划中

入口：长期架构与路线（非产品入口）

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 执行后端 | **ns-nova GUI 与异构 GPU 扩展（未实现）**；规划占位，尚无生产实现；当前GUI仍Web/Canvas/Tauri | 1 / 0 / — / 0 | [docs/adr/0008-native-nuis-and-bootstrap-runtime.md](../docs/adr/0008-native-nuis-and-bootstrap-runtime.md)、[docs/NEXT_ARCHITECTURE.zh-CN.md](../docs/NEXT_ARCHITECTURE.zh-CN.md)、[docs/ROADMAP.md](../docs/ROADMAP.md) |

平台：规划未接入产品。边界：当前GUI仍Web/Canvas/Tauri；无GPU计算/共享资源/嵌入运行视口；Godot GPU渲染不等于Viento拥有原生异构计算接口。

下一步：先明确GUI宿主与计算/资源扩展边界，再做可替换视图验证。

<a id="build.standalone_distribution"></a>
### 独立游戏发行产物

`build.standalone_distribution` · 运行后端与演进 · 规划中

入口：路线：独立发行产物（非产品入口）

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 执行后端 | **独立游戏发行产物（未实现）**；规划占位，尚无生产实现；生成Godot工程不是独立游戏可执行文件 | 1 / 0 / — / 0 | [docs/ROADMAP.md](../docs/ROADMAP.md)、[docs/PROJECT_BUILD.md](../docs/PROJECT_BUILD.md) |

平台：规划未接入产品。边界：生成Godot工程不是独立游戏可执行文件；作品资源包/完整迁移包不是游戏发行；无目标平台导出和独立运行验收。

下一步：增加目标平台导出预设和模板，实测无Godot环境下的产物。

<a id="core.history_migration"></a>
### Rust布局草稿、原子批次与撤销历史

`core.history_migration` · 共享核心 · 源码交付

入口：protocolVersion 1: layoutDraft.create / setPositions / undo / redo / reset / read / close

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **layout_draft.rs：权威位置与有界历史**；权威位置与100步撤销重做；32个有界会话、原子校验、no-op保留redo、基线dirty、reset与显式close；不含保存回执/未知结果判定。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-layout-history/results.json](../docs/test-results/rust-layout-history/results.json)、[docs/test-results/rust-layout-history/selection-browser/browser.json](../docs/test-results/rust-layout-history/selection-browser/browser.json)、[docs/test-results/rust-layout-history/layout-browser/browser.json](../docs/test-results/rust-layout-history/layout-browser/browser.json) |
| 可移植 JS 语义 | **scene-layout.mjs / world-scene-update.mjs：作者源适配与保存命令**；把作者声明适配为Rust草稿，镜像返回位置/状态并显式dispose；源文本、候选scene.update与回读校验仍在JS。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-layout-history/results.json](../docs/test-results/rust-layout-history/results.json)、[docs/test-results/rust-layout-history/selection-browser/browser.json](../docs/test-results/rust-layout-history/selection-browser/browser.json)、[docs/test-results/rust-layout-history/layout-browser/browser.json](../docs/test-results/rust-layout-history/layout-browser/browser.json) |
| 交互与渲染 | **app-scene-layout.js / app-scene-preview-canvas.js**；界面调用Rust历史并显示状态，管理输入/选择/渲染；正常关闭、初始化失败和外部dialog关闭均释放会话。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-layout-history/results.json](../docs/test-results/rust-layout-history/results.json)、[docs/test-results/rust-layout-history/selection-browser/browser.json](../docs/test-results/rust-layout-history/selection-browser/browser.json)、[docs/test-results/rust-layout-history/layout-browser/browser.json](../docs/test-results/rust-layout-history/layout-browser/browser.json) |

平台：Rust原生库/JSON-lines CLI与桌面浏览器WASM、移动资源准备不等于场景功能接入或设备验收。边界：独立LayoutDraft持有权威初始/当前位置、dirty和100步批次撤销重做；不包含作者文本或资源；原生线程/WASM实例各自最多32会话；每会话1–128角色、非空且最多128 UTF-8 bytes的ID；单调u64句柄不复用；无效批次与no-op不改变位置或清除redo；历史截断后仍与最初基线比较dirty；reset清除两个历史方向；JS适配器保留作者源并构造scene.update；保存阶段和错误分类已接独立Rust工作流，回执内容/摘要验证仍在JS；会话仅内存，close或模块销毁释放；不提供跨重启历史，也不改变当前Scene2D格式和actor数量限制；原生与WASM共享实现，产品浏览器走WASM；新版Tauri安装包和Android未验收。

下一步：稳定实例与逻辑分组的后代选择复用opaque key和现有批次历史；片段/空间层级及原生GUI与设备接入单独验收。

<a id="core.save_state_migration"></a>
### Rust布局检查、保存与未知结果工作流

`core.save_state_migration` · 共享核心 · 源码交付

入口：protocolVersion 1: layoutSave.read / invalidate / begin / resolve / refreshed

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **layout_save.rs：保存阶段、错误分类与请求令牌**；Rust独立保存状态机：begin门禁、检查/保存/核对、错误分类、请求归属、刷新终态；随草稿释放。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-layout-save/results.json](../docs/test-results/rust-layout-save/results.json)、[docs/test-results/rust-layout-save/layout-browser/browser.json](../docs/test-results/rust-layout-save/layout-browser/browser.json)、[docs/test-results/rust-layout-save/selection-browser/browser.json](../docs/test-results/rust-layout-save/selection-browser/browser.json) |
| 可移植 JS 语义 | **scene-layout.mjs / world-scene-update.mjs：作者源适配与保存命令**；源适配器缓存Rust保存快照；生成已审阅请求，保留作者源和修订，显式释放。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-layout-save/results.json](../docs/test-results/rust-layout-save/results.json)、[docs/test-results/rust-layout-save/layout-browser/browser.json](../docs/test-results/rust-layout-save/layout-browser/browser.json)、[docs/test-results/rust-layout-save/selection-browser/browser.json](../docs/test-results/rust-layout-save/selection-browser/browser.json) |
| 交互与渲染 | **app-scene-layout.js / app-scene-preview-canvas.js**；输入与提示消费Rust状态，宿主执行HTTP/摘要/回读；每次await及finally检查异步归属，迟到响应无权解锁新操作。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-layout-save/results.json](../docs/test-results/rust-layout-save/results.json)、[docs/test-results/rust-layout-save/layout-browser/browser.json](../docs/test-results/rust-layout-save/layout-browser/browser.json)、[docs/test-results/rust-layout-save/selection-browser/browser.json](../docs/test-results/rust-layout-save/selection-browser/browser.json) |
| 可移植 JS 语义 | **studio-core.mjs**；保存操作独立域分派，严格验证phase/flags/requestId信封，错误核心响应不进入业务。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-layout-save/results.json](../docs/test-results/rust-layout-save/results.json)、[docs/test-results/rust-layout-save/layout-browser/browser.json](../docs/test-results/rust-layout-save/layout-browser/browser.json)、[docs/test-results/rust-layout-save/selection-browser/browser.json](../docs/test-results/rust-layout-save/selection-browser/browser.json) |

平台：Rust原生库/JSON-lines CLI与Linux本机浏览器WASM、新Tauri窗口与Android未验收/未接入。边界：独立LayoutSaveWorkflow与位置草稿共享生命周期，Rust管理阶段、错误分类、请求令牌、审阅失效和重复写入门禁；关闭/重开或新请求的迟到完成不能改变当前会话；确认保存后的刷新失败仍保持已保存；原文/回执内容与摘要校验、World双读与源读取、HTTP和实际scene.update事务仍在JS宿主适配；本地令牌不是服务器幂等键；会话仅内存；没有跨重启恢复，也不迁移作者正文或持久事务到纯核心。

下一步：沿现有来源模型推进语义下沉；独立实例继续复用保存工作流，补原生安装产物与目标WebView验收。

<a id="core.semantic_migration"></a>
### 解析、字段与 World 规划下沉 Rust

`core.semantic_migration` · 共享核心 · 规划中

入口：共享Rust路线：来源模型 → 字段／投影／World规划

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **解析、字段与 World 规划下沉 Rust（未实现）**；规划占位，尚无生产实现；可移植JS接口已存在，但这些规则未迁到Rust | 1 / 0 / — / 0 | [docs/ROADMAP.md](../docs/ROADMAP.md)、[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) |

平台：规划未接入产品。边界：JS来源索引、完整场景模型、投影继承及计划接口已分离；这些完整语义与World规划尚未迁Rust。源码布局所需的严格结构检查与坐标补丁已单独落地为scene.source_layout，不代表本目标完成。；不得新建与作者原文竞争的属性数据库。

下一步：在已有Rust源码检查/数值补丁上继续逐条迁移完整语义，保留源范围、BOM/换行、UUID与事务边界，并删除被替代实现。

<a id="world.mixed_changeset"></a>
### 通用混合 ChangeSet

`world.mixed_changeset` · 语义与投影 · 规划中

入口：未来统一语义事务

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **通用混合 ChangeSet（未实现）**；规划占位，尚无生产实现；当前changeset.apply仅现有对象属性修改 | 1 / 0 / — / 0 | [docs/ROADMAP.md](../docs/ROADMAP.md)、[docs/WORLD_TRANSACTIONS.md](../docs/WORLD_TRANSACTIONS.md) |

平台：规划未接入产品。边界：当前changeset.apply仅现有对象属性修改；创建、关系、资源绑定不能混为一个通用批次。

下一步：先定义混合动作的提交／回滚、预览和读取屏障。

<a id="behavior.csharp_deferred"></a>
### C# 行为后端（暂缓）

`behavior.csharp_deferred` · 运行后端与演进 · 暂缓

入口：近期优先GDScript与Rust，C#暂缓

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 执行后端 | **C# 行为后端（暂缓）（未实现）**；规划占位，尚无生产实现；没有产品C#行为适配器 | 1 / 0 / — / 0 | [docs/PROJECT_BUILD.md](../docs/PROJECT_BUILD.md)、[docs/ROADMAP.md](../docs/ROADMAP.md) |

平台：规划未接入产品。边界：没有产品C#行为适配器；不新增.NET工具链作为Studio运行前提。

下一步：仅在明确需求和工具链成本可接受时重评，不列近期前置依赖。

<a id="maintenance.legacy_tools"></a>
### 旧作品专用维护脚本

`maintenance.legacy_tools` · 验证与交付 · 历史能力

入口：历史CLI工具，非通用工程创建入口

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 验证与维护 | **旧作品专用维护脚本（历史限定）**；历史维护入口，仅静态追溯；不纳入通用编辑核心。 | — / 1 / — / — | [docs/FUNCTION_NETWORK.md](../docs/FUNCTION_NETWORK.md)、[scripts/README.md](../scripts/README.md) |

平台：历史Node/Python/Shell CLI；非新建通用工程入口。边界：保留历史作品专用脚本；不适用于任意新工程；本轮只核对历史目录，不声称新工作流经过运行验收。

下一步：新增通用能力应走项目定义/模板机制，历史脚本仅显式指定样例使用。

<a id="scene.source_model"></a>
### 场景来源模型与修订守护的原文定位

`scene.source_model` · 场景与构建 · 源码交付

入口：场景预览 → 对象属性 → 查看字段来源；resolveScene2DModel

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **json-source.mjs / scene-model.mjs / build-plan.mjs**；严格JSON范围、场景语义与计划分层；不含文件或渲染依赖。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-source-model/results.json](../docs/test-results/scene-source-model/results.json)、[docs/test-results/scene-source-model/packaged-resources.json](../docs/test-results/scene-source-model/packaged-resources.json)、[docs/test-results/scene-instances/browser/browser.json](../docs/test-results/scene-instances/browser/browser.json) |
| 交互与渲染 | **app-source-location.js / app-runtime.js / app-scene-preview.js**；携带位置到真实原文编辑器；保存态读盘核对修订，草稿分支只核对当前编辑文本hash/会话并移动光标，二者都保护dirty内容与异步所有权。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-source-model/results.json](../docs/test-results/scene-source-model/results.json)、[docs/test-results/scene-source-model/browser-verified/browser.json](../docs/test-results/scene-source-model/browser-verified/browser.json)、[docs/test-results/scene-instances/browser/browser.json](../docs/test-results/scene-instances/browser/browser.json) |
| 本机服务与适配 | **node-build-snapshot.mjs / project-build.mjs**；保存态从同一冻结观察返回来源附加信息且旧快照兼容；独立draft观察绑定草稿正文hash，二者不可混用来源与编辑前提。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-source-model/results.json](../docs/test-results/scene-source-model/results.json)、[docs/test-results/scene-instances/browser/browser.json](../docs/test-results/scene-instances/browser/browser.json)、[docs/test-results/scene-instances/results.json](../docs/test-results/scene-instances/results.json) |
| 本机服务与适配 | **scene-preview-service.mjs**；预览转发各自捕获来源；草稿成功/失败带独立修订，资源错误仍指向实际字段；保存态来源/缓存行为保持。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-source-model/results.json](../docs/test-results/scene-source-model/results.json)、[docs/test-results/scene-source-model/browser-verified/browser.json](../docs/test-results/scene-source-model/browser-verified/browser.json)、[docs/test-results/scene-instances/browser/browser.json](../docs/test-results/scene-instances/browser/browser.json) |

平台：Linux本机编辑服务、新版Tauri窗口和Android未验收/未接入。边界：Scene2D v1/v2/v3来源与计划拆分仍在可移植JS；v3逻辑组和组字段来源另见scene.groups_v3，空间层级与剧本语义未实现；JSON值由JSON.parse确定，CST只取UTF-16范围；上限8Mi单元/64层/100000值节点；运行拒绝解码后重复键；仅旧v1事务恢复保留最后键语义且无歧义范围，v2/v3恢复继续严格校验；来源和逻辑组侧带信息不进入冻结构建计划；v3作者文本仍进入快照，过期、近似范围不选择，未保存草稿保留；新Tauri安装产物及Android设备未验收；单场景草稿来源可按原样hash在当前编辑器定位，坏草稿诊断与最后有效画面各保留自己的修订；不是将保存态来源强行映射到未保存文本。。

下一步：为后续层次/片段提供可追溯展开与原文写回位置，保留修订校验及旧冻结快照边界。

<a id="scene.instances_v2"></a>
### Scene2D v2 独立实例与定义复用

`scene.instances_v2` · 场景与构建 · 源码交付

入口：创建场景 → 复制实例/调整顺序；旧场景 → 启用场景实例 → 预览/保存；场景预览、布局与构建

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **json-source.mjs / scene-model.mjs / build-plan.mjs**；解析并验证v2实例唯一性、定义依赖和有效字段；按场景版本发射模型/计划，保持v1兼容。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/results.json](../docs/test-results/scene-instances/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/scene-instances.test.mjs](../scripts/tests/scene-instances.test.mjs) |
| 可移植 JS 语义 | **scene-identity.mjs：实例/定义身份选择**；共享实例身份选择；各宿主以稳定实例为交互/草稿键，定义UUID继续用于登记/资源依赖。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/browser/browser.json](../docs/test-results/scene-instances/browser/browser.json)、[docs/test-results/scene-instances/packaged-resources.json](../docs/test-results/scene-instances/packaged-resources.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 可移植 JS 语义 | **world-scene-create.mjs / world-scene-update.mjs 等**；保真编辑按实例匹配原文，显式v1升级与v2降级保护；定义/资源登记依赖去重。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/results.json](../docs/test-results/scene-instances/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/scene-instances.test.mjs](../scripts/tests/scene-instances.test.mjs) |
| 存储与事务 | **world-transactions.mjs**；复用既有两文件创建/更新事务及恢复守护，不引入实例登记文件或新事务协议。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/results.json](../docs/test-results/scene-instances/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/scene-instances.test.mjs](../scripts/tests/scene-instances.test.mjs) |
| 交互与渲染 | **app-scene-create.js**；新建v2、显式升级旧场景、复制新身份与排序；关联定义可复用，预览保存后才写作者文件。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/browser/browser.json](../docs/test-results/scene-instances/browser/browser.json)、[docs/test-results/scene-instances/results.json](../docs/test-results/scene-instances/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 交互与渲染 | **app-scene-preview.js / app-scene-preview-canvas.js**；预览、画布与来源按钮按实例选择，定义链接保持objectId，拒绝缺失/重复身份的v2响应。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/browser/browser.json](../docs/test-results/scene-instances/browser/browser.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/scene-instances-smoke.mjs](../scripts/tests/scene-instances-smoke.mjs) |
| 交互与渲染 | **app-scene-layout.js / app-scene-preview-canvas.js**；实例多选、位置输入、撤销/重做与显式保存；布局视图不合并共享定义的多个实例。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/browser/browser.json](../docs/test-results/scene-instances/browser/browser.json)、[docs/test-results/scene-instances/results.json](../docs/test-results/scene-instances/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 可移植 JS 语义 | **scene-layout.mjs / world-scene-update.mjs：作者源适配与保存命令**；只在JS到既有Rust协议边界映射实例键；原声明objectId和instanceId原样保留，不宣称新增Rust实例语义。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/browser/browser.json](../docs/test-results/scene-instances/browser/browser.json)、[docs/test-results/scene-instances/packaged-resources.json](../docs/test-results/scene-instances/packaged-resources.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **node-build-snapshot.mjs / project-build.mjs**；同次冻结观察生成v2计划，素材按资源UUID去重；来源侧带信息按实例匹配，外层snapshot仍为1。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/results.json](../docs/test-results/scene-instances/results.json)、[docs/test-results/scene-instances/runtime-review-tests.log](../docs/test-results/scene-instances/runtime-review-tests.log)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **scene-preview-service.mjs**；返回与计划相同的预览版本及每个实例来源；同次捕获按资源UUID去重，预览关闭/取消界限不变。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/browser/browser.json](../docs/test-results/scene-instances/browser/browser.json)、[docs/test-results/scene-instances/results.json](../docs/test-results/scene-instances/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 执行后端 | **godot4-dispatch.mjs / godot4-instances.mjs / runtime-v2.gd**；v2独立节点、protocol2及map2配对实例/定义；旧v1生成器字节冻结，诊断在展开前受容量和长度限制。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/runtime-review-tests.log](../docs/test-results/scene-instances/runtime-review-tests.log)、[docs/test-results/scene-instances/packaged-resources.json](../docs/test-results/scene-instances/packaged-resources.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **node-project-build.mjs**；冻结快照重建后严格匹配计划、适配器协议/摘要和生成文件，再创建独立运行副本。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/runtime-review-tests.log](../docs/test-results/scene-instances/runtime-review-tests.log)、[docs/test-results/scene-instances/results.json](../docs/test-results/scene-instances/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：Linux本机编辑服务、Chrome和真实Godot4、桌面/移动离线资源准备；新Tauri安装包与Android场景功能未验收/未接入。边界：作者Scene2D v2对应模型/构建计划第2版；instanceId是场景内稳定UUID，objectId仍引用已登记定义；演员数组始终为1–128个且决定绘制顺序；新建默认v2；v1显式升级经预览保存，关闭草稿不升级；禁止通过scene.update降级丢弃实例身份；复制生成新UUID，重排/位置覆盖独立；来源、选择、布局历史、事务恢复和迁移保留实例身份，资源/定义依赖去重；Rust几何/历史协议保持不变；JS将实例ID映射为opaque布局键，完整模型/事务写回/关系登记仍JS，source-only严格结构与数值补丁另由Rust执行；旧v1计划、快照、生成文件及后端摘要保持；v2运行协议/来源映射携带实例与定义双身份，导入诊断最多256条、每条4096字符；v3持久逻辑分组另见scene.groups_v3；没有空间父子变换、片段展开、剧本事件或任意作者脚本；源码/资源准备及Linux浏览器/Godot验证不等于Tauri安装或Android设备验收。

下一步：沿已实现的逻辑分组继续定义复用片段，明确展开来源、批量编辑及跨文件提交边界。

<a id="scene.groups_v3"></a>
### Scene2D v3 逻辑分组、共享大纲与后代选择

`scene.groups_v3` · 场景与构建 · 源码交付

入口：编辑场景 → 启用场景分组 → 组名/父组/实例归属；场景预览和布局 → 大纲搜索/折叠/选择后代

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **scene-groups.mjs：逻辑组验证与可查询大纲**；组拓扑、成员和深度/数量规则；按源顺序产生可查询大纲及后代实例选择。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/results.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/scene-groups/browser-final/browser.json](../docs/test-results/scene-groups/browser-final/browser.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 可移植 JS 语义 | **scene-structure.mjs：分组侧带与实例归属校验**；明确sceneStructure侧带契约，校验组与完整实例归属；不向plan2传递编辑器组织字段。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/results.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/scene-groups/packaged-resources.json](../docs/test-results/scene-groups/packaged-resources.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 可移植 JS 语义 | **json-source.mjs / scene-model.mjs / build-plan.mjs**；读取作者v3与组字段来源，model3编译plan2；旧模型、计划和严格恢复规则保持。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/results.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/scene-groups.test.mjs](../scripts/tests/scene-groups.test.mjs) |
| 可移植 JS 语义 | **world-scene-create.mjs / world-scene-update.mjs 等**；无损编辑以groupId匹配组片段，允许显式升级、拒绝降级；组操作不新增定义/素材依赖。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/results.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/scene-groups.test.mjs](../scripts/tests/scene-groups.test.mjs) |
| 存储与事务 | **world-transactions.mjs**；复用创建5/更新8双文件事务，组拓扑与身份参与恢复验证；不创建组元数据文件。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/group-core-tests.log](../docs/test-results/scene-groups/group-core-tests.log)、[docs/test-results/scene-groups/results.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 交互与渲染 | **app-scene-create.js**；显式启用组、组名/父组/归属编辑和空组删除；升级及写入均经预览保存。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/browser-final/browser.json](../docs/test-results/scene-groups/browser-final/browser.json)、[docs/test-results/scene-groups/results.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 交互与渲染 | **app-scene-outline.js：预览和布局共享场景大纲**；预览与布局共享搜索/折叠树，组点击选择完整后代，祖先保留且选择不改变绘制次序。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/browser-final/browser.json](../docs/test-results/scene-groups/browser-final/browser.json)、[docs/test-results/scene-groups/results.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 交互与渲染 | **app-scene-preview.js / app-scene-preview-canvas.js**；保存态或单场景草稿预览消费独立分组侧带；演员/图片按plan2源顺序渲染，草稿仅查看不进入图形编辑。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/browser-final/browser.json](../docs/test-results/scene-groups/browser-final/browser.json)、[docs/test-results/scene-draft-preview/results.json](../docs/test-results/scene-draft-preview/results.json)、[docs/test-results/scene-draft-preview/browser-final-verified/browser.json](../docs/test-results/scene-draft-preview/browser-final-verified/browser.json) |
| 交互与渲染 | **app-scene-layout.js / app-scene-preview-canvas.js**；组后代映射为现有实例多选和一次位置历史批次；保存保留作者组结构。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/browser-final/browser.json](../docs/test-results/scene-groups/browser-final/browser.json)、[docs/test-results/scene-groups/results.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 可移植 JS 语义 | **scene-layout.mjs / world-scene-update.mjs：作者源适配与保存命令**；v3布局核对源声明与分组侧带，位置变化保留groups和groupId；Rust协议与实现未改。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/results.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/scene-groups.test.mjs](../scripts/tests/scene-groups.test.mjs) |
| 本机服务与适配 | **node-build-snapshot.mjs / project-build.mjs**；保存态同次冻结观察返回组侧带和来源，snapshot原文保留v3而可执行计划仍为2；草稿分支只返回独立预览身份，不提供build-snapshot。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/results.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/scene-draft-preview/backend.log](../docs/test-results/scene-draft-preview/backend.log)、[docs/test-results/scene-draft-preview/results.json](../docs/test-results/scene-draft-preview/results.json) |
| 本机服务与适配 | **scene-preview-service.mjs**；预览协议仍为2，独立sceneStructure传递保存态或草稿分组；草稿来源绑定自身hash，图片缓存和关闭限制保持。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/browser-final/browser.json](../docs/test-results/scene-groups/browser-final/browser.json)、[docs/test-results/scene-groups/results.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/scene-draft-preview/backend.log](../docs/test-results/scene-draft-preview/backend.log) |
| 本机服务与适配 | **node-project-build.mjs**；现有冻结重放重建v3作者观察得到plan2，检查既有v2后端摘要及生成文件。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/results.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/scene-group-runtime.test.mjs](../scripts/tests/scene-group-runtime.test.mjs) |
| 执行后端 | **godot4-dispatch.mjs / godot4-instances.mjs / runtime-v2.gd**；v3组结构编译后复用未改动v2生成器/协议，无组节点、空间继承或任意作者脚本。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/results.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/scene-group-runtime.test.mjs](../scripts/tests/scene-group-runtime.test.mjs) |

平台：Linux本机编辑服务、Chrome和真实Godot4、桌面/移动离线资源准备；新安装包和目标设备未验收。边界：作者schema3要求groups数组0–128个，groupId为稳定UUID且与实例身份分离；父组可省略，拒绝空值、循环、孤立引用和超过16层的树；分组只组织编辑器；实例position仍为绝对坐标，actors数组继续决定绘制顺序，没有父子变换、继承可见性或组运行节点；新场景仍默认v2，启用分组为显式草稿升级；保存前不迁移，禁止降级；删除组仅允许空组，重命名/重排/改父组不重建实例身份；共享纯规则构建大纲，搜索保留祖先且命中组包含后代；后代选择按原演员顺序映射为既有Rust布局批次；来源按groupId/instanceId定位；无损源变换、两文件事务恢复和依赖包迁移保留逻辑组，无单独组登记数据库；model3编译为plan2并去除actor.groupId；sceneStructure侧带供编辑器消费，v1/v2后端脚本及摘要、运行协议均保持不变；领域校验、树模型和原文变换仍在JS；不是Rust语义迁移，也不是空间层次/片段/剧本事件；新Tauri安装包及Android场景功能未验收/未接入；单场景v3草稿的组变化可只读预览，组后代位置可通过scene.source_layout应用回源码；不写组登记，组结构仍随普通保存持久化。。

下一步：在逻辑分组和稳定来源之上定义可复用片段及展开/写回边界，空间父子变换与大规模场景性能单独验证。

<a id="scene.text_draft_preview"></a>
### 当前场景原文草稿的只读预览与精确定位

`scene.text_draft_preview` · 场景与构建 · 源码交付

入口：编辑已登记场景原文 → 构建与运行 → 场景预览 → 预览当前草稿；POST /api/scene-preview 的 draft 分支

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **scene-draft-preview.mjs：单场景只读源覆盖与重新投影**；验证单源128KiB请求与已登记路径/磁盘基线；只覆盖克隆正文和SHA-256，再派生投影，保留关系/资源登记并拒绝未登记依赖。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-draft-preview/backend.log](../docs/test-results/scene-draft-preview/backend.log)、[docs/test-results/scene-draft-preview/results.json](../docs/test-results/scene-draft-preview/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 可移植 JS 语义 | **json-source.mjs / scene-model.mjs / build-plan.mjs**；复用v1/v2/v3语义与严格源范围，将草稿来源hash带入诊断与组侧带；不经会改写作者原文的保存规划。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-draft-preview/backend.log](../docs/test-results/scene-draft-preview/backend.log)、[docs/test-results/scene-draft-preview/results.json](../docs/test-results/scene-draft-preview/results.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 可移植 JS 语义 | **scene-preview-contract.mjs**；预览路由与128KiB草稿源预算共用可移植契约；最坏JSON转义仍留在既有HTTP全包限制内，保存态请求保持兼容。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-draft-preview/backend.log](../docs/test-results/scene-draft-preview/backend.log)、[docs/test-results/scene-draft-preview/http.log](../docs/test-results/scene-draft-preview/http.log)、[docs/test-results/scene-draft-preview/results.json](../docs/test-results/scene-draft-preview/results.json) |
| 本机服务与适配 | **node-build-snapshot.mjs / project-build.mjs**；独立captureSceneDraftPreview复用围栏/双读/图片hash冻结；生成域分离预览身份，排除可执行快照和编辑前提；captureBuildSnapshot继续只读磁盘。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-draft-preview/backend.log](../docs/test-results/scene-draft-preview/backend.log)、[docs/test-results/scene-draft-preview/http.log](../docs/test-results/scene-draft-preview/http.log)、[docs/test-results/scene-draft-preview/results.json](../docs/test-results/scene-draft-preview/results.json) |
| 本机服务与适配 | **scene-preview-service.mjs**；区分保存态与严格draft分支；沿用本机鉴权、串行取消及两份/128MiB/TTL资源边界，409基线冲突和诊断保留草稿修订，禁止sceneEditing。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-draft-preview/backend.log](../docs/test-results/scene-draft-preview/backend.log)、[docs/test-results/scene-draft-preview/http.log](../docs/test-results/scene-draft-preview/http.log)、[docs/test-results/scene-draft-preview/results.json](../docs/test-results/scene-draft-preview/results.json) |
| 交互与渲染 | **app-scene-preview.js / app-scene-preview-canvas.js**；显式预览草稿、独立来源提示和图形写入门禁；请求/解码原子替换，失败保留最后画面；同scene关闭编辑重开保留一份有界画面并释放服务器资源。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-draft-preview/results.json](../docs/test-results/scene-draft-preview/results.json)、[docs/test-results/scene-draft-preview/browser-final-verified/browser.json](../docs/test-results/scene-draft-preview/browser-final-verified/browser.json)、[docs/test-results/scene-source-layout/results.json](../docs/test-results/scene-source-layout/results.json) |
| 交互与渲染 | **app-source-location.js / app-runtime.js / app-scene-preview.js**；从当前场景编辑器提取原样草稿和磁盘基线hash；来源导航核对草稿hash、会话与内容后只移动选区，迟到结果/不匹配修订不覆盖编辑内容。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-draft-preview/host-ui.log](../docs/test-results/scene-draft-preview/host-ui.log)、[docs/test-results/scene-draft-preview/results.json](../docs/test-results/scene-draft-preview/results.json)、[docs/test-results/scene-draft-preview/browser-final-verified/browser.json](../docs/test-results/scene-draft-preview/browser-final-verified/browser.json) |

平台：Linux本机编辑服务与Chrome；真实HTTP、宿主编辑器和浏览器验收范围见当前报告、新Tauri安装产物及Android场景预览未验收/未接入。边界：仅当前已登记场景的一份原文草稿，UTF-8最多128 KiB；严格sceneId/sourcePath/baseSourceRevision/content契约，孤立代理字符、额外字段和超限请求拒绝，HTTP整体请求仍受既有1 MiB限制；以磁盘SHA-256修订为基线，替换克隆观察中的场景正文和源修订后重新派生World投影；角色/投影/素材及关系绑定继续使用已保存登记，缺失或未关联依赖只诊断，不写正文或metadata；草稿身份与构建快照分域；来源按原样BOM/CRLF/Unicode正文hash绑定，返回draft修订与v3组织侧带，不返回sceneEditing或可执行build-snapshot，不创建构建任务或缓存；有效结果原子替换；错误、外部基线冲突或迟到响应保留最后有效画面和来源修订。同一场景可关闭预览、编辑原文、重开自动预览草稿；关闭释放服务端资源，仅保留一份有界解码画面，换场景/失去能力/销毁清理；精确来源定位只校验当前编辑器草稿并移动光标；原文变化、近似范围、场景切换和异步所有权失效均保留内容。投影来源继续走保存态来源路径；草稿预览不授予图形场景表单或World布局保存；来源仍与当前源码一致时可进入独立scene.source_layout本地坐标回写。构建只捕获保存输入，即使传入未知draft选项也不会构建草稿。；只读覆盖与重新投影仍是JS；宿主冻结、HTTP和浏览器渲染分别负责I/O与界面。完整场景/投影语义未下沉Rust，没有多文件原子保存或完整剧本系统；单场景源码坐标回写另列scene.source_layout，新Tauri安装产物和Android场景功能未验收/未接入。。

下一步：在已接入的单场景坐标回写上明确跨视图历史、多文件片段来源与提交边界；目标设备另行验收。

<a id="scene.source_layout"></a>
### 当前源码草稿的布局调整与精确回写

`scene.source_layout` · 场景与构建 · 源码交付

入口：源码模式编辑已登记场景 → 预览当前草稿 → 调整草稿布局 → 预览布局修改 → 应用到文本草稿 → 主编辑器普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **scene-source-layout.mjs / scene-layout.mjs：源码桥接、预览守护与共用Rust几何会话**；将源码交给Rust检查并请求精确补丁，JS只解码及匹配有效preview、来源hash/基线与v3侧带；prepare重算候选，宿主仍须await后owner核验。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-source-layout/engine-final.log](../docs/test-results/scene-source-layout/engine-final.log)、[docs/test-results/scene-source-layout/results.json](../docs/test-results/scene-source-layout/results.json)、[docs/test-results/scene-source-layout/app-check-verified.log](../docs/test-results/scene-source-layout/app-check-verified.log) |
| 共享 Rust 核心 | **layout_draft.rs：权威位置与有界历史**；复用未改动LayoutDraft持有位置与100批次undo/redo；本地源码会话与保存态会话隔离，共享有界32槽位与dispose边界。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-source-layout/engine-final.log](../docs/test-results/scene-source-layout/engine-final.log)、[docs/test-results/scene-source-layout/results.json](../docs/test-results/scene-source-layout/results.json)、[docs/test-results/scene-source-layout/app-check-verified.log](../docs/test-results/scene-source-layout/app-check-verified.log) |
| 交互与渲染 | **app-scene-layout.js / app-scene-preview-canvas.js**；共用画布/选择与几何操作，source-mode审阅并应用完整proposal；本地pending不设置World busy，取消保留文本，成功刷新草稿。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-source-layout/results.json](../docs/test-results/scene-source-layout/results.json)、[docs/test-results/scene-source-layout/app-check-verified.log](../docs/test-results/scene-source-layout/app-check-verified.log)、[docs/test-results/scene-source-layout/browser-render/browser.json](../docs/test-results/scene-source-layout/browser-render/browser.json) |
| 交互与渲染 | **app-source-location.js / app-runtime.js / app-scene-preview.js**；源码模式提取并校验当前scene注册/path/session/token/baseline/全文；prepare后再次核验owner，应用到内存且不重置保存版本。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-source-layout/results.json](../docs/test-results/scene-source-layout/results.json)、[docs/test-results/scene-source-layout/app-check-verified.log](../docs/test-results/scene-source-layout/app-check-verified.log)、[docs/test-results/scene-source-layout/browser-render/browser.json](../docs/test-results/scene-source-layout/browser-render/browser.json) |
| 交互与渲染 | **app-scene-preview.js / app-scene-preview-canvas.js**；来源一致的有效草稿显示独立调整入口；旧画面/错误/切scene不能授予写回，应用成功继续草稿刷新而非保存态invalidate。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-source-layout/results.json](../docs/test-results/scene-source-layout/results.json)、[docs/test-results/scene-source-layout/app-check-verified.log](../docs/test-results/scene-source-layout/app-check-verified.log)、[docs/test-results/scene-source-layout/browser-render/browser.json](../docs/test-results/scene-source-layout/browser-render/browser.json) |
| 构建与分发 | **prepare.mjs**；移动离线资源携带同一Rust source核心与桥接；通用解析及完整模型仍JS，保留原YAML vendor与后端json-source重定位，不提供Android场景入口。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-source-layout/results.json](../docs/test-results/scene-source-layout/results.json)、[docs/test-results/scene-source-layout/app-check-verified.log](../docs/test-results/scene-source-layout/app-check-verified.log)、[docs/test-results/scene-source-layout/packaged-resources.json](../docs/test-results/scene-source-layout/packaged-resources.json) |
| 共享 Rust 核心 | **scene_source.rs：无状态严格JSON与精确坐标token补丁**；Rust对源码执行严格JSON/身份/位置/组检查，以原UTF-8 token范围生成仅坐标补丁；无状态、无持久化、无几何会话副作用，完整Scene2DModel另由JS验证。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-scene-source/results.json](../docs/test-results/rust-scene-source/results.json)、[docs/test-results/rust-scene-source/packaged-resources.json](../docs/test-results/rust-scene-source/packaged-resources.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：Linux本机编辑服务与Chrome；真实业务与回归范围见本轮报告、桌面/移动离线资源与隔离模块运行通过；新版Tauri安装窗口和Android场景功能未验收/未接入。边界：仅当前已登记场景的源码模式；v1/v2/v3及1–128实例，原文前后均限128KiB UTF-8，不支持新建未登记文档、字段/分段模式或跨文档写回；草稿预览的path、保存基线、SHA-256、schema、实例身份/顺序/位置与v3侧带必须一致；错误草稿保留的旧画面无回写权限；共用Rust几何与LayoutDraft的100批次历史及32会话表；新增stateless sceneSource.inspect/patch不占用草稿槽位，source-only对象仍不暴露command/beginSave或World保存前提。旧几何/历史/保存操作和场景后端不变。；Rust严格扫描JSON并检查v1/v2/v3身份/坐标与组关系，按UTF-8字节范围仅替换变化position的数值token；前后128KiB、64层/100000值节点、128实例/组及16层组关系。BOM/CRLF、未改指数/负零/转义及其他原文保留，decoded重复键/字面孤立代理字符/伪造候选拒绝。；完整候选审阅后由宿主复查sceneId、path、会话/token、摘要、编辑会话基线和原文，再写编辑器内存；hash返回后再次检查归属，取消/失败保留草稿；应用不读写磁盘，保留原文档保存版本；外部文件变化仍可本地应用，之后预览/普通保存各自按原基线拒绝过期结果或覆盖。dirty按编辑器基线比较；不调用scene.update、不修改metadata/素材/OC/投影或创建构建任务；只有本次布局会话的局部undo；没有跨源码/表单/布局统一历史、跨重启布局恢复、多文件事务或剧本/空间变换。本版为源码交付，新安装产物/设备未验收；JS只负责本切片的解码、预览元数据与hash/owner；完整Scene2DModel、投影继承、依赖/登记、来源导航及事务JSON/CST仍在JS。前端源码布局不再加载YAML，也无JS补丁回退；旧WASM缺少源码能力时保留旧布局操作并拒绝新源操作。。

下一步：在Rust单源准确补丁之上先验证可复用片段的确定性组合、稳定身份、来源和局部覆盖，产出兼容v3场景后再接作者工作流；跨文件提交与跨视图历史须独立契约。

## 旧功能链路映射

旧版四份图谱原字节保留；F01–F50 均明确映射，其中遗留维护工具仍标为历史用途。此映射表示主题继承，不表示旧测试自动覆盖新增链路。

| 旧链 | 当前功能 | 备注 |
| --- | --- | --- |
| F01 启动与最近作品 | [作品库、起始模板与最近工程](#host.library) | 历史主题映射；新增实现需独立验收。 |
| F02 新建空白项目 | [五类独立工程起始模板包](#project.starter-packs)、[作品库、起始模板与最近工程](#host.library) | 历史主题映射；新增实现需独立验收。 |
| F03 选择已有作品 | [作品库、起始模板与最近工程](#host.library) | 历史主题映射；新增实现需独立验收。 |
| F04 打开作品和启动引擎 | [桌面会话、服务进程与关闭保护](#host.desktop-session) | 历史主题映射；新增实现需独立验收。 |
| F05 打开系统文件夹 | [作品库、起始模板与最近工程](#host.library) | 历史主题映射；新增实现需独立验收。 |
| F06 返回作品库与继续编辑 | [桌面会话、服务进程与关闭保护](#host.desktop-session) | 历史主题映射；新增实现需独立验收。 |
| F07 关闭编辑窗口或退出 | [桌面会话、服务进程与关闭保护](#host.desktop-session) | 历史主题映射；新增实现需独立验收。 |
| F08 导入完整项目包 | [完整工程归档和恢复](#storage.full-archive) | 历史主题映射；新增实现需独立验收。 |
| F09 作品库导出备份 | [完整工程归档和恢复](#storage.full-archive) | 历史主题映射；新增实现需独立验收。 |
| F10 探测编辑能力和切换模式 | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit)、[本机编辑/只读服务与能力边界](#host.local-service) | 历史主题映射；新增实现需独立验收。 |
| F11 加载索引与重试 | [通用解析、静态索引与阅读](#authoring.parse-index) | 历史主题映射；新增实现需独立验收。 |
| F12 分类、搜索与列表 | [通用解析、静态索引与阅读](#authoring.parse-index) | 历史主题映射；新增实现需独立验收。 |
| F13 文档详情与卡片 | [通用解析、静态索引与阅读](#authoring.parse-index) | 历史主题映射；新增实现需独立验收。 |
| F14 角色背景与附属故事 | [稳定身份、登记、归属及历史背景迁移](#identity.registration-ownership)、[引用／共享归属关系追加](#world.relation-add) | 历史主题映射；新增实现需独立验收。 |
| F15 读取原文并开始编辑 | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 历史主题映射；新增实现需独立验收。 |
| F16 新建文档并选模板 | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 历史主题映射；新增实现需独立验收。 |
| F17 源码与区块往返 | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit)、[字段表原位保真编辑](#authoring.field-edit) | 历史主题映射；新增实现需独立验收。 |
| F18 保存已有文档 | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit)、[字段表原位保真编辑](#authoring.field-edit) | 历史主题映射；新增实现需独立验收。 |
| F19 保存新文档 | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 历史主题映射；新增实现需独立验收。 |
| F20 处理保存冲突 | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 历史主题映射；新增实现需独立验收。 |
| F21 取消、切换与未保存保护 | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 历史主题映射；新增实现需独立验收。 |
| F22 手动刷新预览与局部重建 | [通用解析、静态索引与阅读](#authoring.parse-index) | 历史主题映射；新增实现需独立验收。 |
| F23 读取项目类型和模板 | [工程自定义类型、解析规则与文档模板](#project.type-templates) | 历史主题映射；新增实现需独立验收。 |
| F24 预览模板解析 | [工程自定义类型、解析规则与文档模板](#project.type-templates) | 历史主题映射；新增实现需独立验收。 |
| F25 保存类型、模板与规则 | [工程自定义类型、解析规则与文档模板](#project.type-templates) | 历史主题映射；新增实现需独立验收。 |
| F26 取消新增、放弃修改与返回 | [工程自定义类型、解析规则与文档模板](#project.type-templates) | 历史主题映射；新增实现需独立验收。 |
| F27 列出、筛选和复用素材 | [图片／视频／音频导入、引用、草稿预览与播放](#media.embed-play) | 历史主题映射；新增实现需独立验收。 |
| F28 导入、粘贴和拖入媒体 | [图片／视频／音频导入、引用、草稿预览与播放](#media.embed-play) | 历史主题映射；新增实现需独立验收。 |
| F29 把媒体引用嵌入草稿 | [图片／视频／音频导入、引用、草稿预览与播放](#media.embed-play) | 历史主题映射；新增实现需独立验收。 |
| F30 草稿预览与播放 | [图片／视频／音频导入、引用、草稿预览与播放](#media.embed-play) | 历史主题映射；新增实现需独立验收。 |
| F31 稳定 ID 与元数据附件 | [稳定身份、登记、归属及历史背景迁移](#identity.registration-ownership)、[为对象追加已登记素材用途](#world.resource-bind)、[图片／视频／音频导入、引用、草稿预览与播放](#media.embed-play) | 历史主题映射；新增实现需独立验收。 |
| F32 导出文档阅读分享包 | [文档阅读分享包与受控下载生命周期](#export.document-share) | 历史主题映射；新增实现需独立验收。 |
| F33 编辑器导出完整项目包 | [完整工程归档和恢复](#storage.full-archive) | 历史主题映射；新增实现需独立验收。 |
| F34 下载与原生保存对话框 | [文档阅读分享包与受控下载生命周期](#export.document-share)、[导出准备、下载、原生保存及清理](#export.jobs-delivery) | 历史主题映射；新增实现需独立验收。 |
| F35 取消导出、释放与过期 | [文档阅读分享包与受控下载生命周期](#export.document-share)、[导出准备、下载、原生保存及清理](#export.jobs-delivery) | 历史主题映射；新增实现需独立验收。 |
| F36 语言切换、记忆与跨窗口同步 | [中英日界面切换及草稿保留](#authoring.languages) | 历史主题映射；新增实现需独立验收。 |
| F37 标准化主链 | [通用解析、静态索引与阅读](#authoring.parse-index) | 历史主题映射；新增实现需独立验收。 |
| F38 构建三份索引 | [通用解析、静态索引与阅读](#authoring.parse-index) | 历史主题映射；新增实现需独立验收。 |
| F39 增量登记作品对象 | [稳定身份、登记、归属及历史背景迁移](#identity.registration-ownership)、[工程核验、外置素材绑定和旧登记迁移](#storage.workspace-maintenance) | 历史主题映射；新增实现需独立验收。 |
| F40 绑定外置素材根 | [工程核验、外置素材绑定和旧登记迁移](#storage.workspace-maintenance)、[程序/工程/本机数据隔离](#storage.application-isolation) | 历史主题映射；新增实现需独立验收。 |
| F41 核验作品、素材和模板 | [稳定身份、登记、归属及历史背景迁移](#identity.registration-ownership)、[工程核验、外置素材绑定和旧登记迁移](#storage.workspace-maintenance) | 历史主题映射；新增实现需独立验收。 |
| F42 旧背景归属迁移 | [稳定身份、登记、归属及历史背景迁移](#identity.registration-ownership)、[引用／共享归属关系追加](#world.relation-add)、[工程核验、外置素材绑定和旧登记迁移](#storage.workspace-maintenance) | 历史主题映射；新增实现需独立验收。 |
| F43 采用官方示范项目定义 | [工程自定义类型、解析规则与文档模板](#project.type-templates)、[五类独立工程起始模板包](#project.starter-packs)、[工程核验、外置素材绑定和旧登记迁移](#storage.workspace-maintenance) | 历史主题映射；新增实现需独立验收。 |
| F50 查询轻量文件目录 | [通用解析、静态索引与阅读](#authoring.parse-index) | 历史主题映射；新增实现需独立验收。 |
| F44 命令行浏览/编辑启动 | [本机编辑/只读服务与能力边界](#host.local-service) | 历史主题映射；新增实现需独立验收。 |
| F45 运行诊断与失败恢复 | [契约检查、回归与证据保存](#quality.validation-support) | 历史主题映射；新增实现需独立验收。 |
| F46 自动检查与原生回归 | [契约检查、回归与证据保存](#quality.validation-support) | 历史主题映射；新增实现需独立验收。 |
| F47 打包与交付 | [程序/工程/本机数据隔离](#storage.application-isolation)、[源码、桌面与移动资源交付](#delivery.packaging) | 历史主题映射；新增实现需独立验收。 |
| F48 清理构建缓存 | [构建缓存与磁盘清理](#delivery.generated-cleanup) | 历史主题映射；新增实现需独立验收。 |
| F49 历史专用维护工具 | [旧作品专用维护脚本](#maintenance.legacy_tools) | 历史主题映射；新增实现需独立验收。 |

## 维护与验证

权威目录为 `docs/function-atlas.json`；编辑条目、证据、关系和评分后生成其他三种视图：

```sh
node scripts/function-atlas.mjs --check
# 完成受影响条目的重新审查后，显式更新文件指纹和派生视图
node scripts/function-atlas.mjs --write --refresh-sources
```

只改说明／评分而来源未变时可用 `--write`。检查包括 ID／坐标唯一性、文件路径、已发布／未发布评分门槛、四维完整性、旧 50 链映射、源码及证据指纹、派生视图一致性。它不证明评分正确或产品测试通过，也不能自动发现目录外新增功能；每次新增能力需人工补图并核对 [STATUS](STATUS.md) 与 [ROADMAP](ROADMAP.md)。报告路径是仓库相对路径，不读取作者工程或本机配置。交互页内嵌同一数据，可脱机筛选和点开证据；单独复制 HTML 后仍可浏览，但源码链接需保持仓库相对布局。

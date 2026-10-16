# 当前功能图谱：架构、功能、实现与成熟度

核对日期：**2026-10-16**。源码版本 **0.1.5**；审查基线为提交 `cc4e5aa3cec993edfb57c77b259722eb6e4c922e`，各项交付状态见下文。范围为本仓库已识别的能力与明确规划，不是全部未来功能的穷举，也不是运行时逐函数调用图。各项实测范围与执行条件见对应证据；源码验证不等于新安装包或设备验收。

[离线交互图谱](function-atlas.html) · [稀疏张量 JSON](function-atlas.json) · [依赖图 Mermaid](function-atlas.mmd) · [二维功能对接表](FUNCTION_MAPPING_2D.md) · [架构边界](ARCHITECTURE.md) · [当前平台](STATUS.md) · [旧 b.4.3 功能网络](FUNCTION_NETWORK.md)

## 模型与缺省语义

使用四维坐标 **T[架构 A, 功能 F, 实现 I, 评分维度 M] = 0–5 或 null**，按 COO 坐标列表保存。M 包含实现、验证、解耦、交付四项；它们是有序等级，**不计算总平均、完成百分比或测试覆盖率**。一个功能可有多条实现关系，例如布局规则同时关联 Rust 核心、WASM 桥和 JS 草稿视图。

- 只存已审查的架构／功能／实现关系。缺省组合表示未建立关系，不代表分数 0。
- 显式 `0` 表示有证据支持的未实现／未交付等状态；`null` 表示该项未评估或现阶段不适用。
- 每个已登记实现关系有四个评分单元，分别给出理由。评分只适用于该行范围，语言和代码量本身不能增加成熟度。
- 依赖边方向为 **前置能力 `from` → 使用者 `to`**；`requires` 表示当前语义前置条件，`planned` 表示未来接入。它们不是静态 import 或性能数据。工作流是业务路径索引，先后关系不保证每次操作调用所有步骤。
- 工作流的 `steps` 是所列路径，`gaps` 是另外登记的缺口功能，二者不重叠。缺少 `gaps` 表示缺口尚未梳理；显式 `[]` 表示本次未登记额外缺口，不能解释为全部完成。每项功能仍须按自己的成熟度与边界阅读。
- 历史报告保留其日期、平台、跳过与样本边界。测试文件存在不等于此次运行过；旧安装包记录也不能证明未发布代码已交付。

## 规模

| 项目 | 数量 |
| --- | ---: |
| 架构区域 | 11 |
| 功能 | 128 |
| 实现单元（含规划占位） | 357 |
| 已审查实现关系 | 541 |
| 显式评分单元 | 2164 |
| 语义依赖边 | 348 |
| 工作流切片 | 90 |
| 旧链路已映射 | 50 |
| 引用并校验指纹的文件 | 1930 |

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
| 共享 Rust 核心 | 无宿主依赖的确定性规则、有界布局草稿、无状态源码检查/坐标补丁及实验性单文件片段组合；原生与WASM共用，完整World/构建语义仍在JS。 |
| 本机服务与适配 | HTTP鉴权、索引、资源、任务与Node适配器，连接纯规则和I/O。 |
| 存储与事务 | 正文/UUID/素材权威数据的锁、修订、原子发布与恢复。 |
| 桌面宿主 | Tauri作品库、窗口/进程、原生对话框、偏好和会话。 |
| Android 宿主 | 无Node请求桥、私有存储、草稿恢复和SAF迁移。 |
| 执行后端 | Godot生成／GDScript绑定、独立Bevy数据程序以及Bevy Rust作者源工程通道；实例、事件与工具分别准入，能力分别声明；原生路线另列。 |
| 工程定义与格式 | 模板包、类型、Schema、作者身份与持久格式。 |
| 构建与分发 | WASM/桌面/移动资源准备、源码归档和生成物清理。 |
| 验证与维护 | 契约检查、回归工具、证据与遗留维护边界。 |

## 当前优先缺口

1. **扩展起始组合与完整创作交付验收**：多演员清单与显式起始排布已接通；更多片段组合、可选局部排布，以及全部上游到行为／ZIP的同轮流程仍需独立推进。 验收：继续保留手调位置和身份；单一临时工程连续完成对象／投影／配方、行为到工程交付，来源失效时拒绝覆盖。 涉及 [直接新建配方的内置助手](#scene.composition_create)、[文件内场景片段、配方预览、单实例覆盖与迁移实验](#scene.composition)、[保存态配方生成独立运行场景](#scene.composition_materialize)、[同一 OC 的子模板及多份用途投影创建／编辑](#projection.authoring)。
2. **在字段与独立结构创作之后推进空间层次和跨视图历史**：0\.0\.10纳入恢复、单/多位置画布、共享声明SET/恢复、offset与演员/放置/组织组/定义结构及重命名；各入口保持独立原文审批，空间层次、其他字段批次与跨视图历史仍需独立合同。 验收：保留原文/稳定身份/localoverrides/ordinarySave；后续空间层次和统一历史须单独定义事务与撤销，不能借组织组隐式施加transform，跨文件和规模独立验收。 涉及 [文件内场景片段、配方预览、单实例覆盖与迁移实验](#scene.composition)、[单实例六字段恢复继承与原子混合补丁](#scene.composition_inheritance)、[配方单实例画布位置与原文草稿写回](#scene.composition_canvas)、[配方多实例画布与原子位置批次](#scene.composition_batch_canvas)、[共享片段演员六字段设置与关联覆盖审阅](#scene.composition_fragment_editor)、[共享片段可选声明恢复与原子设置删除](#scene.composition_fragment_inheritance)、[整组放置偏移与全成员原文审批](#scene.composition_placement_editor)、[Scene2D v3 逻辑分组、共享大纲与后代选择](#scene.groups_v3)、[文本驱动场景、定义/实例分离与场景树](#scene.text_instances)、[场景来源模型与修订守护的原文定位](#scene.source_model)。
3. **在单源补丁之后继续下沉完整语义**：Rust已承接布局/历史/保存阶段，以及source-only严格JSON结构与数值补丁；完整作者模型、投影继承、来源导航和World规划仍JS。 验收：逐条对照既有JS完整语义与源码/注册/恢复契约，保持BOM/行尾、UUID、来源范围及事务兼容，不把受限source检查冒充完整模型。 涉及 [解析、字段与 World 规划下沉 Rust](#core.semantic_migration)。
4. **在已有脚本关联与Rust固定步闭环之后推进生命周期和迁移**：首次多绑定与已有引用管理已接通；独立Rust源工程通道保持ready参数／信号和离线编译，固定步自身实例驱动另立功能与当轮证据。旧数据后端保持；已有声明迁移、解绑／热更新、连续循环及输入回放继续单独设计。 验收：每个新接口核对实例、源码、工具及来源；Godot与Bevy分别用真实输入和运行证据验收，不由引擎原生能力推断接入。 涉及 [内置脚本起始内容与普通TXT草稿保存](#script.authoring)、[从已保存场景首次创建行为声明与关联](#behavior.creation)、[内置行为绑定、参数与信号原文编辑](#behavior.authoring)、[已有行为的脚本引用与独立编辑交接](#behavior.script_links)、[场景实例的GDScript参数、信号与冻结迁移](#behavior.scene_runtime)、[Bevy 作者 Rust 行为接入](#behavior.bevy_rust)、[Bevy Rust 固定步自身实例位置与事件驱动](#behavior.bevy_fixed_step)、[执行后端能力、可信注册与通用编排](#execution.backend_middleware)。
5. **区分可迁移工程交付与独立游戏发行**：项目组装、运行时场景切换与会话共享标量状态由独立坐标记录；生成Godot工程ZIP需相应工具，目标平台独立发行仍需单独定义。 验收：定义目标平台导出预设、工具模板和冻结资源清单，并在没有开发引擎的目标环境运行产物。 涉及 [项目级多场景组装、启动入口与统一工程交付](#build.project_assembly)、[项目内运行时场景切换与逐访问观察](#runtime.project_scene_switching)、[项目会话共享标量状态与历史写入来源](#runtime.project_shared_state)、[已核对生成工程的可移植交付包](#backend.project_delivery)、[独立游戏发行产物](#build.standalone_distribution)。
6. **补真实交付与目标平台证据**：Rust布局、来源/实例/分组、单源草稿预览及坐标回写已纳入0\.0\.7源码并保留专题证据；对应Tauri安装产物与目标WebView仍需实测。 验收：对对应实际安装包重跑Linux关键流程及Android设备范围；Windows/macOS单独验收。 涉及 [源码、桌面与移动资源交付](#delivery.packaging)、[Android 无 Node 编辑宿主](#host.android-editing)、[Rust布局草稿、原子批次与撤销历史](#core.history_migration)、[布局草稿、多选与显式事务保存](#scene.layout_draft)、[Rust布局检查、保存与未知结果工作流](#core.save_state_migration)、[Scene2D v2 独立实例与定义复用](#scene.instances_v2)、[Scene2D v3 逻辑分组、共享大纲与后代选择](#scene.groups_v3)、[当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview)、[当前源码草稿的布局调整与精确回写](#scene.source_layout)。
7. **在已有持久目录之上补删除审阅与缓存迁移**：跨服务工程登记、恢复与显式运行选择已接入，不再将它们写为未来任务；当前缺少手动移除／删除审阅、跨路径迁移及可见容量预算。 验收：只处理应用拥有且经审阅的派生产物；保留作者数据、外部修改、未知文件和旧会话报告，分别验收取消／恢复。 涉及 [后端工程持久列表、冻结选择与旧执行链对接](#backend.project_catalog)、[后端派生工程清单、只读核对与服务回收](#backend.project_management)。

## 业务工作流

工作流名称可打开离线交互页的对应路径。步骤不构成完成声明；已登记缺口与当前步骤分别列出。

| 路径 | 功能步骤 | 已登记缺口 | 适用边界 |
| --- | --- | --- | --- |
| [工程创建与日常创作](function-atlas.html#workflow=W01) | [作品库、起始模板与最近工程](#host.library) → [五类独立工程起始模板包](#project.starter-packs) → [工程自定义类型、解析规则与文档模板](#project.type-templates) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [通用解析、静态索引与阅读](#authoring.parse-index) | 缺口尚未梳理 | 桌面与本机编辑；Android支持其中编辑/模板子集。 |
| [字段与语义变更](function-atlas.html#workflow=W02) | [字段表原位保真编辑](#authoring.field-edit) → [World／Object／Resource 观察投影与查询](#world.query) → [单对象单属性语义修改](#world.property-set) → [批量属性提交、读取屏障与崩溃恢复](#world.changeset) → [通用解析、静态索引与阅读](#authoring.parse-index) | 缺口尚未梳理 | 当前批次只改既有对象属性；不是通用混合事务。 |
| [身份、关系和资源](function-atlas.html#workflow=W03) | [新对象正文与登记共同创建](#world.object-create) → [引用／共享归属关系追加](#world.relation-add) → [为对象追加已登记素材用途](#world.resource-bind) → [World／Object／Resource 观察投影与查询](#world.query) | 缺口尚未梳理 | 各命令独立提交；不要把该顺序解释成一个原子批次。 |
| [一个OC的多用途投影](function-atlas.html#workflow=W04) | [新对象正文与登记共同创建](#world.object-create) → [同一 OC 的子模板及多份用途投影创建／编辑](#projection.authoring) → [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) | 缺口尚未梳理 | 投影是独立作者定义；已纳入源码交付的v2允许同一投影的多个实例，v1保留原限制与显式升级。 |
| [预览、布局和保真保存](function-atlas.html#workflow=W05) | [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [Scene2D v3 逻辑分组、共享大纲与后代选择](#scene.groups_v3) → [无需引擎的已保存场景预览](#scene.saved_preview) → [共享 Rust 布局规则与原子位置校验](#core.layout_rust) → [Rust布局草稿、原子批次与撤销历史](#core.history_migration) → [Rust 核心 WASM 接入与分发资源](#core.wasm_bridge) → [Rust布局检查、保存与未知结果工作流](#core.save_state_migration) → [布局草稿、多选与显式事务保存](#scene.layout_draft) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) | 缺口尚未梳理 | 逻辑组后代选择映射为既有实例批次；Rust管位置/历史/保存阶段，JS保留作者组结构及实际事务，非组空间变换或设备验收。 只从保存态进入布局；原文只读草稿预览另列独立工作流。 |
| [构建与真实Godot运行](function-atlas.html#workflow=W06) | [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [Godot 4 工程生成与运行协议](#runtime.godot_generated_project) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) | 缺口尚未梳理 | Linux本机服务；旧v1/v2冻结重放保持，显式行为plan3另列行为工作流。0\.0\.8源码中间层严格区分能力/可信host/具体Godot；没有独立游戏发行，descriptor变化需重新批准。 |
| [媒体创作与原始资源取回](function-atlas.html#workflow=W07) | [图片／视频／音频导入、引用、草稿预览与播放](#media.embed-play) → [为对象追加已登记素材用途](#world.resource-bind) → [单个登记素材原始字节再导出](#resource.original-export) → [导出准备、下载、原生保存及清理](#export.jobs-delivery) | 缺口尚未梳理 | 原文件导出不转码；登记和媒体播放各有验证范围。 |
| [跨工程复用与完整迁移](function-atlas.html#workflow=W08) | [选择式资源包依赖闭包、冲突预览与追加导入](#resource.package) → [完整工程归档和恢复](#storage.full-archive) → [Android SAF 完整工程迁移](#host.android-transfer) | 缺口尚未梳理 | 选择包是复用，完整包是迁移；Android只接完整包。 |
| [阅读分享与下载生命周期](function-atlas.html#workflow=W09) | [通用解析、静态索引与阅读](#authoring.parse-index) → [文档阅读分享包与受控下载生命周期](#export.document-share) → [导出准备、下载、原生保存及清理](#export.jobs-delivery) | 缺口尚未梳理 | 可取消/清理与原生保存回执；不替代工程备份。 |
| [Android离线编辑与恢复](function-atlas.html#workflow=W10) | [Android 无 Node 编辑宿主](#host.android-editing) → [Android 草稿和新建恢复](#host.android-draft-recovery) → [Android SAF 完整工程迁移](#host.android-transfer) | 缺口尚未梳理 | 无Node；未接媒体/World/场景构建；模拟器不等于真机。 |
| [源码验证、打包和清理](function-atlas.html#workflow=W11) | [契约检查、回归与证据保存](#quality.validation-support) → [Rust 核心 WASM 接入与分发资源](#core.wasm_bridge) → [源码、桌面与移动资源交付](#delivery.packaging) → [构建缓存与磁盘清理](#delivery.generated-cleanup) | 缺口尚未梳理 | 构建准备和源码验证不能自动获得安装/多平台成熟度。 |
| [后续文本实例与行为](function-atlas.html#workflow=W12) | [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [Scene2D v3 逻辑分组、共享大纲与后代选择](#scene.groups_v3) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [文本驱动场景、定义/实例分离与场景树](#scene.text_instances) → [GDScript 行为绑定历史探针](#behavior.gdscript_binding) → [Bevy/Rust 无头第二后端](#runtime.bevy_rust) | 缺口尚未梳理 | 稳定实例/分组、原文预览/回写和GDScript绑定已有切片；Bevy只接无图ECS计划，空间/剧本与Rust作者行为仍规划；历史探针原条件保留。 |
| [共享核心持续下沉](function-atlas.html#workflow=W13) | [共享 Rust 布局规则与原子位置校验](#core.layout_rust) → [Rust布局草稿、原子批次与撤销历史](#core.history_migration) → [Rust布局检查、保存与未知结果工作流](#core.save_state_migration) → [解析、字段与 World 规划下沉 Rust](#core.semantic_migration) | 缺口尚未梳理 | 几何、草稿历史与保存状态已接通；来源模型/解析和World语义规划仍待迁移。 |
| [场景字段到修订匹配的作者原文](function-atlas.html#workflow=scene-source-navigation) | [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [场景来源模型与修订守护的原文定位](#scene.source_model) → [无需引擎的已保存场景预览](#scene.saved_preview) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 缺口尚未梳理 | 保存态来源读取并匹配磁盘修订；显式草稿来源只匹配当前编辑器文本hash。声明/组名与共享定义分别定位，迟到/过期/近似位置不盲跳，来源切换不覆盖草稿。 |
| [共享定义的多实例创作、运行与迁移](function-atlas.html#workflow=scene-instance-sharing) | [同一 OC 的子模板及多份用途投影创建／编辑](#projection.authoring) → [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [场景来源模型与修订守护的原文定位](#scene.source_model) → [无需引擎的已保存场景预览](#scene.saved_preview) → [布局草稿、多选与显式事务保存](#scene.layout_draft) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [Godot 4 工程生成与运行协议](#runtime.godot_generated_project) → [选择式资源包依赖闭包、冲突预览与追加导入](#resource.package) | 缺口尚未梳理 | 合成工程贯通独立身份、局部覆盖、冻结执行和资源包导入；定义/素材去重；v3逻辑树另见分组工作流，尚无片段/剧本事件。 |
| [逻辑分组创作、大纲导航与批量布局](function-atlas.html#workflow=scene-group-organization) | [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [Scene2D v3 逻辑分组、共享大纲与后代选择](#scene.groups_v3) → [场景来源模型与修订守护的原文定位](#scene.source_model) → [无需引擎的已保存场景预览](#scene.saved_preview) → [Rust布局草稿、原子批次与撤销历史](#core.history_migration) → [布局草稿、多选与显式事务保存](#scene.layout_draft) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [Godot 4 工程生成与运行协议](#runtime.godot_generated_project) → [选择式资源包依赖闭包、冲突预览与追加导入](#resource.package) | 缺口尚未梳理 | 启用作者v3后显式保存组与归属；大纲过滤/后代选择沿用稳定实例，位置编辑和迁移保留组，构建剥离组织结构复用plan2。没有空间变换继承、片段或剧本事件。 |
| [场景原文草稿、只读预览与来源往返](function-atlas.html#workflow=scene-text-draft-preview) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [场景来源模型与修订守护的原文定位](#scene.source_model) | 缺口尚未梳理 | 单份已登记场景源码经128KiB/磁盘基线校验后只读预览；依赖仍取保存态登记。精确来源回到原编辑器，错误保留有效画面；本地源码布局回写为另一个明确分支，不授予World事务保存。 |
| [场景源码草稿、局部布局与普通保存](function-atlas.html#workflow=scene-source-layout) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [Rust布局草稿、原子批次与撤销历史](#core.history_migration) → [当前源码草稿的布局调整与精确回写](#scene.source_layout) | 缺口尚未梳理 | 仅源码模式/单scene：Rust strict inspect→有效预览/hash绑定→Rust几何与局部历史→Rust精确scalar proposal→宿主复核后内存应用→主编辑器普通保存。source操作无状态且不读写磁盘；取消不改文本，应用不重置保存基线，无World命令/构建/统一undo。 |
| [配方预览、单实例覆盖原文草稿与保存迁移](function-atlas.html#workflow=scene-composition) | [新对象正文与登记共同创建](#world.object-create) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [文件内场景片段、配方预览、单实例覆盖与迁移实验](#scene.composition) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [场景来源模型与修订守护的原文定位](#scene.source_model) → [选择式资源包依赖闭包、冲突预览与追加导入](#resource.package) | 缺口尚未梳理 | 普通JSON登记/源码保存→Rust展开与依赖→saved/draft预览/贡献导航→当前源的稳定目标六字段set提案→完整候选检查→live复核后内存应用→普通保存→资源包迁移作者字节。预览无snapshot/sceneEditing，不改共享片段/其他放置；CLI输出v3可另行登记构建，生成编辑不回写recipe。 |
| [显式能力到冻结后端执行](function-atlas.html#workflow=execution-backend-admission) | [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [Godot 4 工程生成与运行协议](#runtime.godot_generated_project) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) | 缺口尚未梳理 | 保存态输入→纯descriptor→可信registry→Godot或Bevy独立adapter→指纹与冻结回放；Godot图片/窗口/显式GDScript与Bevy无图headless分别验收，无原生/离屏/内嵌/GPU。 |
| [实例行为从作者原文到事件、诊断与迁移](function-atlas.html#workflow=scene-behavior-runtime) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [引用／共享归属关系追加](#world.relation-add) → [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [场景实例的GDScript参数、信号与冻结迁移](#behavior.scene_runtime) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [选择式资源包依赖闭包、冲突预览与追加导入](#resource.package) | 缺口尚未梳理 | 普通JSON/TXT\+显式关系→严格plan3→冻结构建→Godot独立Node/参数/信号→可信事件/源诊断→选择包或完整迁移。静态预览不校验行为；生成物和事件不回写作者文本，无RPC/热更新/移动执行器。 |
| [同计划双引擎：Bevy数据构建与无头回放](function-atlas.html#workflow=bevy-backend) | [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [Bevy/Rust 无头第二后端](#runtime.bevy_rust) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) | [独立游戏发行产物](#build.standalone_distribution) | Linux宿主显式选择固定Bevy后端；支持无图Scene2D plan1/2、有限移动／控制和只读样本。没有图片、窗口、作者Rust编译或GDScript行为；不是通用游戏引擎能力已全部接入。 独立Rust作者源工程路径另列bevy-rust-author-delivery；这条数据路线不自动获得作者行为。 |
| [运行对象样本→稳定实例检索→冻结声明来源](function-atlas.html#workflow=runtime-object-inspection) | [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [运行对象、位置采样与冻结来源只读观察](#runtime.objects_inspection) | 缺口尚未梳理 | 已验证冻结构建→Godot/Bevy既有准入事件→完整runtime视图与ownedinspect→本地检索/阶段提示/source守护；state使旧位置失效，cancel/error留样本，无RPC/连续采样/作者回写。 |
| [冻结构建→有限方向程序→两引擎步骤采样→只读对象观察](function-atlas.html#workflow=runtime-control-replay) | [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [有限方向程序、跨后端回放与完整步骤采样](#runtime.control_replay) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [运行对象、位置采样与冻结来源只读观察](#runtime.objects_inspection) | 缺口尚未梳理 | 有限headless无行为plan1/2，程序/联合预算与SHA捕获，adapter暂存/清理，runtime原序ready/state/trace/finished与独立对象视图；不能跨译脚本或回写作者数据，无RPC/实时输入/渲染。 |
| [冻结plan2→独立实例输入→每步释放→全体样本观察](function-atlas.html#workflow=runtime-instance-control) | [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [有限方向程序、跨后端回放与完整步骤采样](#runtime.control_replay) → [按实例独立有限输入与稀疏步骤路由](#runtime.instance_control) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [运行对象、位置采样与冻结来源只读观察](#runtime.objects_inspection) | 缺口尚未梳理 | owned冻结实例目标→显式示例或严格JSON→dualcap/版本/输入行/actorssteps预算→Godot/Bevy各自按实例路由且每步未列释放→原schema1完整trace/observer；不回写作者、不接实时或RPC。 |
| [可选显式工具检查→计划批准→运行前重新核对](function-atlas.html#workflow=execution-tool-identity) | [可信工具身份检查、状态DTO与候选失效](#execution.tool_identity) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) | 缺口尚未梳理 | GET无进程→显式固定工具identify→中立只读状态；ready只说明检查时身份，后续用户仍显式批准场景/构建，执行重新识别并核对冻结来源/产物/工具。检查不写作者/生成输出，不覆盖旧job/样本；原专题在0\.0\.8之后、0\.0\.9交付前核验；无新安装/设备。 |
| [有限输入＋预期→冻结实例采样→独立验收结果](function-atlas.html#workflow=runtime-verification-case) | [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [有限方向程序、跨后端回放与完整步骤采样](#runtime.control_replay) → [有限运行验收用例与步骤预期评判](#runtime.verification_cases) → [运行对象、位置采样与冻结来源只读观察](#runtime.objects_inspection) | 缺口尚未梳理 | 显式case或从owned完整采样生成末步预期；host真实完成，pure逐步实例检查，assertion failed与execution failed分开；不完整不判passed，作者和原产物不改。 |
| [验收草稿→明确保存/载入→稳定身份迁移→同场景冻结重跑](function-atlas.html#workflow=runtime-case-documents) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [稳定身份、登记、归属及历史背景迁移](#identity.registration-ownership) → [工程验收用例保存、重用与稳定身份迁移](#runtime.case_documents) → [选择式资源包依赖闭包、冲突预览与追加导入](#resource.package) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [有限运行验收用例与步骤预期评判](#runtime.verification_cases) | 缺口尚未梳理 | 作者文档fresh字节与双修订保护；包/完整迁移保留UUID和正文；frozen场景绑定提前检查，离线仅已有loaded纯case，不做批量或安装/Android引擎。 |
| [保存用例→有序组→全部准入→顺序执行/取消→独立汇总](function-atlas.html#workflow=runtime-case-suites) | [工程验收用例保存、重用与稳定身份迁移](#runtime.case_documents) → [同场景有序验收组与宿主批次调度](#runtime.case_suites) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [有限运行验收用例与步骤预期评判](#runtime.verification_cases) → [选择式资源包依赖闭包、冲突预览与追加导入](#resource.package) | 缺口尚未梳理 | 先fresh捕获全部作者成员再分配owner；assertion fail继续/executionfail或cancel停余项，reap释放；mobile只pure、不升级安装/设备或旧评分。 |
| [当前有序组→committed成员→私有pin回读→逐步详情→显式JSON下载](function-atlas.html#workflow=runtime-case-reports) | [同场景有序验收组与宿主批次调度](#runtime.case_suites) → [有限运行验收用例与步骤预期评判](#runtime.verification_cases) → [当前批次成员详情与独立报告导出](#runtime.case_reports) | 缺口尚未梳理 | 作者来源离线可读owned报告；新job/close使旧owner失效，不扫描历史，不自动改预期，mobile仅pure。 |
| [实例覆盖→恢复选择/混合设置→原子候选→完整预览→原文草稿→普通保存](function-atlas.html#workflow=scene-composition-inheritance) | [文件内场景片段、配方预览、单实例覆盖与迁移实验](#scene.composition) → [单实例六字段恢复继承与原子混合补丁](#scene.composition_inheritance) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 缺口尚未梳理 | 当前源码/预览与稳定目标绑定；六字段恢复只删除当前覆盖，set/reset原子并重验完整候选；GUI不猜继承，live守护内存应用，普通保存保留基线/冲突；不改共享片段/其他实例/身份。 |
| [配方选定实例→场景位置画布/历史→局部覆盖候选→完整检查→原文草稿→普通Save](function-atlas.html#workflow=scene-composition-canvas) | [文件内场景片段、配方预览、单实例覆盖与迁移实验](#scene.composition) → [配方单实例画布位置与原文草稿写回](#scene.composition_canvas) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 缺口尚未梳理 | 固定一个UUID，world/local双范围先验证，未动轴保真；共享Rust历史与旧position-only set，live来源/审批守护内存应用，普通Save保留基线；无multi/align/shared或跨视图历史。 |
| [当前配方→独立多选/位置历史→净目标原子补丁→完整候选/目标检查→整批原文草稿→普通Save](function-atlas.html#workflow=scene-composition-batch-canvas) | [文件内场景片段、配方预览、单实例覆盖与迁移实验](#scene.composition) → [配方多实例画布与原子位置批次](#scene.composition_batch_canvas) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 缺口尚未梳理 | 多放置实例共用Rust位置历史，world/local先验原子拒绝；按作者顺序仅净目标position覆盖，live来源/审批/canonical回执守护内存应用，普通Save保留基线；无shared/offset/其他字段/跨文件或全局历史。 |
| [配方实例→共享raw声明/明确勾选→全部引用掩蔽→完整候选→原文草稿→普通Save](function-atlas.html#workflow=scene-composition-fragment-editor) | [文件内场景片段、配方预览、单实例覆盖与迁移实验](#scene.composition) → [共享片段演员六字段设置与关联覆盖审阅](#scene.composition_fragment_editor) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 缺口尚未梳理 | SET-only现有演员六字段；所有相关placement/masks及source顺序进入canonical审批，局部覆盖仍优先；缺声明显式同effective值新增，全掩蔽仍声明变化；无结构/reset/offset/跨文或统一undo。 |
| [共享raw声明→允许恢复/其他SET→全引用掩蔽→原子candidate/图片检查→原文草稿→普通Save](function-atlas.html#workflow=scene-composition-fragment-inheritance) | [共享片段演员六字段设置与关联覆盖审阅](#scene.composition_fragment_editor) → [共享片段可选声明恢复与原子设置删除](#scene.composition_fragment_inheritance) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 缺口尚未梳理 | 五字段删除条件按source继承开关，position必需；SET/RESET互斥但共用一份原子提案，raw保留/canonical与全targets守护，取消不改草稿，普通Save持久化；无结构/offset/跨文或统一undo。 |
| [配方实例→所属placement rawoffset/restore→全演员/组与差异→完整candidate图片检查→原文草稿→普通Save](function-atlas.html#workflow=scene-composition-placement-offset) | [文件内场景片段、配方预览、单实例覆盖与迁移实验](#scene.composition) → [整组放置偏移与全成员原文审批](#scene.composition_placement_editor) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 缺口尚未梳理 | offset在各演员局部覆盖后相加，group仅组织；pair\|null只改一个现有placement声明，全部目标/源身份/预算与canonical批准守护，普通Save持久化，其他作者值不变；无transform结构/跨文/统一undo。 |
| [作者已保存场景→冻结构建→后端工程清单／列表→只读核对→来源和库存→保留或原样回收](function-atlas.html#workflow=backend-project-audit) | [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [后端派生工程清单、只读核对与服务回收](#backend.project_management) | 缺口尚未梳理 | Godot原生工程／Bevy数据包分别产生但统一管理；只认创建者own IDs，不采纳陌生缓存，改动和报告保留，未接跨服务持久catalog或独立发行。 |
| [成功生成工程→宿主持久登记→重启未选历史→显式选择核验→原运行／控制／验收／报告](function-atlas.html#workflow=backend-project-catalog) | [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [后端派生工程清单、只读核对与服务回收](#backend.project_management) → [后端工程持久列表、冻结选择与旧执行链对接](#backend.project_catalog) → [有限方向程序、跨后端回放与完整步骤采样](#runtime.control_replay) → [同场景有序验收组与宿主批次调度](#runtime.case_suites) → [当前批次成员详情与独立报告导出](#runtime.case_reports) | 缺口尚未梳理 | 历史readonly/preserved，工具与作者离线不自动执行；实际生成／工具规则留adapter，currentwrite删除ledger永不从index复原，无陌生缓存认领或跨路径迁移。 |
| [配方源码→共享演员增删→全放置身份及覆盖→候选预览→内存应用→普通保存重开](function-atlas.html#workflow=scene-composition-member-authoring) | [文件内场景片段、配方预览、单实例覆盖与迁移实验](#scene.composition) → [共享片段演员增删、全放置身份与原文创作](#scene.composition_structure_editor) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [场景来源模型与修订守护的原文定位](#scene.source_model) | 缺口尚未梳理 | 单文件/一次一操作/显式全部放置UUID；unused仅声明和登记依赖，不提供运行/跨文事务或新版安装验收。 |
| [独立编辑区→来源/审阅/应用→中性成功通知→原文普通保存](function-atlas.html#workflow=scene-authoring-host-ports) | [文件内场景片段、配方预览、单实例覆盖与迁移实验](#scene.composition) → [独立场景创作流程、候选验收与宿主接口](#scene.authoring_workflow) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [场景来源模型与修订守护的原文定位](#scene.source_model) | 缺口尚未梳理 | 六入口私有会话与回执；单文件内存草稿，ordinarySave保留；非统一历史、自动保存或新设备交付。 |
| [工程声明→模块规划→宿主装配→独立领域接口](function-atlas.html#workflow=studio-module-profile-boundary) | [五类独立工程起始模板包](#project.starter-packs) → [Studio 系统装配与工程增量能力需求](#studio.system_modules) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [图片／视频／音频导入、引用、草稿预览与播放](#media.embed-play) → [独立场景创作流程、候选验收与宿主接口](#scene.authoring_workflow) | 缺口尚未梳理 | 需求为增量数据；当前2D／执行聚合界面另保留，缺未来能力不封闭普通文字，非热插件或3D交付。 |
| [整份放置意图→独立身份→完整候选→原文草稿→普通保存](function-atlas.html#workflow=scene-composition-whole-placement-source) | [文件内场景片段、配方预览、单实例覆盖与迁移实验](#scene.composition) → [整份片段放置新增、保真复制与移除](#scene.composition_placements_editor) → [独立场景创作流程、候选验收与宿主接口](#scene.authoring_workflow) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 缺口尚未梳理 | 新消费依赖与全actor/group来源验证后只改当前原文内存；最后一份不能移除，旧偏移编辑与执行后端独立。 |
| [组织组意图→全放置身份/名称/父组/归属→完整候选→原文草稿→普通保存](function-atlas.html#workflow=scene-composition-organizational-groups-source) | [文件内场景片段、配方预览、单实例覆盖与迁移实验](#scene.composition) → [共享片段组织组新增、名称／父组编辑、演员归组与空叶组移除](#scene.composition_groups_editor) → [独立场景创作流程、候选验收与宿主接口](#scene.authoring_workflow) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 缺口尚未梳理 | 组织组和有序归属的完整候选/全actor-group来源验证后只改当前原文内存；仅空叶组可删，坐标与旧编辑区/执行后端保持独立。 |
| [定义意图→原始定义/空目标/完整来源→完整候选→原文草稿→普通保存](function-atlas.html#workflow=scene-composition-fragment-definitions-source) | [文件内场景片段、配方预览、单实例覆盖与迁移实验](#scene.composition) → [共享片段定义新增、独立复制与未放置定义移除](#scene.composition_definitions_editor) → [独立场景创作流程、候选验收与宿主接口](#scene.authoring_workflow) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 缺口尚未梳理 | 完整有效场景和actor/group贡献来源验证后只改当前原文内存；仅无放置引用的定义可删，新定义首次放置仍复核投影与图片，旧编辑区/执行后端保持独立。 |
| [原/新片段标识→全部引用审阅→完整候选来源→原文草稿→普通保存](function-atlas.html#workflow=scene-composition-fragment-rename-source) | [文件内场景片段、配方预览、单实例覆盖与迁移实验](#scene.composition) → [共享片段重命名与全部放置引用同步](#scene.composition_definition_rename) → [独立场景创作流程、候选验收与宿主接口](#scene.authoring_workflow) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 缺口尚未梳理 | 同一recipe原子替换定义和全部放置引用；actor/group/placement身份及有效场景保持，普通Save仍是持久权威；能力缺失仅禁用新动作。 |
| [严格 3D 原文→只读视图/独立计划→Godot 工程→有限探针](function-atlas.html#workflow=scene3d-source-preview-export) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [Studio 系统装配与工程增量能力需求](#studio.system_modules) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) | 缺口尚未梳理 | 作者原文和普通 Save 保持权威；两个展示/后端适配消费独立数据，不复用原 2D 行为协议。 |
| [单对象3D变换→完整候选→原文草稿→普通保存](function-atlas.html#workflow=scene3d-transform-source-authoring) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [Studio 系统装配与工程增量能力需求](#studio.system_modules) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) → [独立 3D 对象变换原文创作](#scene.transform_authoring3d) | 缺口尚未梳理 | 审阅不写文件，应用只更新当前原文草稿；旧读取预览与普通Save独立守护。 |
| [3D对象新增/复制/移除→完整原文→草稿→普通保存](function-atlas.html#workflow=scene3d-object-source-authoring) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [Studio 系统装配与工程增量能力需求](#studio.system_modules) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) → [独立 3D 对象新增、复制与移除](#scene.object_authoring3d) | 缺口尚未梳理 | 结构审阅没有写入权限，Apply只改当前内存草稿；新旧两种创作入口独立审批，普通Save保留原外部冲突守护。 |
| [作者环境字段→完整最终候选→原文草稿→普通保存](function-atlas.html#workflow=scene3d-environment-source-authoring) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [Studio 系统装配与工程增量能力需求](#studio.system_modules) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) → [独立3D作者相机、方向光与背景编辑](#scene.environment_authoring3d) | 缺口尚未梳理 | 最终相机/光规则一次原子校验；只改获准值词元及当前内存草稿，临时预览视角不可充当作者参数，普通Save保持持久和冲突权威。 |
| [对象属性→完整最终候选→原文草稿→普通保存](function-atlas.html#workflow=scene3d-properties-source-authoring) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [Studio 系统装配与工程增量能力需求](#studio.system_modules) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) → [独立3D对象名称与颜色编辑](#scene.properties_authoring3d) | 缺口尚未梳理 | 只替换指定稳定实例的净字符串值词元；字段审批不共享，普通Save保持磁盘持久和外部冲突权威。 |
| [3D检索／临时聚焦→稳定UUID→当前原文选择](function-atlas.html#workflow=scene3d-readonly-object-navigation) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [Studio 系统装配与工程增量能力需求](#studio.system_modules) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) → [3D对象检索、临时聚焦与原文定位](#scene.navigation3d) | 缺口尚未梳理 | 检索和临时相机不编辑作者数据；完整当前来源重解析后仅selection/scroll/一次focus，旧raw范围不用于新草稿。 |
| [有效3D绘图→画布命中→稳定选择／临时聚焦→可选原文定位](function-atlas.html#workflow=scene3d-canvas-picking) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [Studio 系统装配与工程增量能力需求](#studio.system_modules) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) → [3D对象检索、临时聚焦与原文定位](#scene.navigation3d) → [3D画布几何选择与双击聚焦](#scene.picking3d) | 缺口尚未梳理 | 输入手势和几何命中只更新视图；原文定位仍使用已有宿主完整来源守护，不添加作者提案或普通保存。 |
| [稳定选择→原实体边缘反馈→同几何双击聚焦／严格原文定位](function-atlas.html#workflow=scene3d-selection-feedback) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [Studio 系统装配与工程增量能力需求](#studio.system_modules) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) → [3D对象检索、临时聚焦与原文定位](#scene.navigation3d) → [3D画布几何选择与双击聚焦](#scene.picking3d) → [3D稳定选择的实体边缘反馈](#scene.selection_feedback3d) | 缺口尚未梳理 | 输入、提示和临时镜头只改变视图；来源定位独立核完整原文，保存与作者提案不进入反馈。 |
| [多选现有方块→共同偏移原子检查→完整审阅→一次内存应用→普通保存／冲突](function-atlas.html#workflow=scene3d-translation-authoring) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [Studio 系统装配与工程增量能力需求](#studio.system_modules) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) → [3D多对象原子整体移动](#scene.translation_authoring3d) | 缺口尚未梳理 | 独立selection与私有brand，Rust一次CST补丁；审批变化撤销，来源并发只有赢家write一次，磁盘仍普通Save。 |
| [显式多选／参照／世界轴→原子位置检查→完整审阅→一次内存应用→普通保存／冲突](function-atlas.html#workflow=scene3d-alignment-authoring) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [Studio 系统装配与工程增量能力需求](#studio.system_modules) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) → [3D多对象参照轴位置对齐](#scene.alignment_authoring3d) | 缺口尚未梳理 | 独立选择和第六私有品牌，原参照坐标只作用于所选position轴；来源和owner并发只允许赢家写一次完整草稿，磁盘仍普通Save。 |
| [独立多选／世界轴→原坐标排序固定两端→原子位置检查→完整审阅→一次内存应用→普通保存／冲突](function-atlas.html#workflow=scene3d-distribution-authoring) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [Studio 系统装配与工程增量能力需求](#studio.system_modules) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) → [3D多对象单轴位置等距分布](#scene.distribution_authoring3d) | 缺口尚未梳理 | 独立选择与第七私有品牌，只改中间对象所选position轴；两端词元保持，非零跨度不足严格精度整批拒绝，来源与owner守护只允许一次完整草稿，磁盘仍普通Save。 |
| [来源选择／新UUID／共同位移→整批检查→完整审阅→一次草稿应用→普通保存／冲突](function-atlas.html#workflow=scene3d-copy-authoring) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [Studio 系统装配与工程增量能力需求](#studio.system_modules) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) → [3D多对象原文保真批量复制](#scene.copy_authoring3d) | 缺口尚未梳理 | 零偏移仍创建副本；所有原声明不变，新副本仅身份和净位置变化。一项失败整批拒绝，来源归属守护只授权草稿。 |
| [显式来源选择→整批移除检查→删除／保留声明与完整原文审阅→一次草稿应用→普通保存／冲突](function-atlas.html#workflow=scene3d-removal-authoring) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [Studio 系统装配与工程增量能力需求](#studio.system_modules) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) → [3D多对象原文保真原子批量移除](#scene.removal_authoring3d) | 缺口尚未梳理 | 至少保留一个对象；全选、重复、未知或空选择整批拒绝。删除路径沿用原声明索引，保留声明与区间外字节不变；来源归属与私牌守护只授权草稿。 |
| [有效预览→全场景取景→筛选与单对象浏览→重置作者相机](function-atlas.html#workflow=scene3d-scene-framing) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) → [3D对象检索、临时聚焦与原文定位](#scene.navigation3d) → [3D全场景临时取景](#scene.framing3d) | 缺口尚未梳理 | 始终只操作临时视角，保留正文、选择和保存基线；无效草稿继续查看最近有效模型。 |
| [有效预览→六方向取景→极点交互与对象选择→恢复作者相机](function-atlas.html#workflow=scene3d-standard-views) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) → [3D对象检索、临时聚焦与原文定位](#scene.navigation3d) → [3D全场景临时取景](#scene.framing3d) → [3D六向标准观察与极点导航](#scene.standard_views3d) | 缺口尚未梳理 | 始终操作临时视图，保留作者原文、元数据、筛选和身份；up不进入作者格式。 |
| [有效预览→旋转／平移模式→镜头平移与选择隔离→恢复作者相机](function-atlas.html#workflow=scene3d-pan) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) → [3D对象检索、临时聚焦与原文定位](#scene.navigation3d) → [3D六向标准观察与极点导航](#scene.standard_views3d) → [3D临时镜头平移与独立手势模式](#scene.pan3d) | 缺口尚未梳理 | 手势只改变临时位置和目标，保留方向、距离、来源与身份；模式不进入作者格式，普通保存不参与。 |
| [有效预览→透视／正交切换→六向聚焦与平移点选→恢复作者相机](function-atlas.html#workflow=scene3d-orthographic) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) → [3D六向标准观察与极点导航](#scene.standard_views3d) → [3D临时镜头平移与独立手势模式](#scene.pan3d) → [3D只读正交观察与模式相关取景](#scene.orthographic3d) | 缺口尚未梳理 | 投影仅属于当前视图，保留来源与身份；目标平面切换尺度一致，其他深度按投影变化，保存和导出不消费模式。 |
| [有效预览→成功绘图回执→三轴朝向提示→失效与关闭隐藏](function-atlas.html#workflow=scene3d-orientation) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) → [3D对象检索、临时聚焦与原文定位](#scene.navigation3d) → [3D坐标方向提示与成功视图观察](#scene.orientation3d) | 缺口尚未梳理 | 被动组件只消费当前有效相机回执与固定词翻译，旋转更新朝向，作者、选择、保存和导出不变。 |
| [有效预览→双指升级→中心锚定平移与缩放→成功绘图→结束不误选](function-atlas.html#workflow=scene3d-touch) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) → [3D对象检索、临时聚焦与原文定位](#scene.navigation3d) → [3D临时镜头平移与独立手势模式](#scene.pan3d) → [3D双指目标平面平移与捏合导航](#scene.touch_navigation3d) | 缺口尚未梳理 | 两触控只改变临时镜头，以真实缩放边界守护目标平面锚点；任意结束不残留单指操作，来源、作者模型和保存不变。 |
| [可选雾→完整审阅→普通保存→只读绘图／Godot属性核对](function-atlas.html#workflow=scene3d-fog) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) → [可组合3D距离雾声明、编辑与引擎适配](#scene.fog3d) | 缺口尚未梳理 | 新增fog显式勾选；作者原文是保存权威，临时镜头只影响当前观察，各引擎独立声明支持。 |
| [粒子参数→完整审阅→普通保存→确定性时间预览／引擎工程](function-atlas.html#workflow=scene3d-particles) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出](#scene.primitives3d) → [通用3D粒子场、雨雪参数与显式时刻预览](#scene.particles3d) | 缺口尚未梳理 | 作者字段是保存权威，播放时刻只属于预览；生成工程和实际引擎验证分别声明。 |
| [普通二维创作→Godot运行→工程交付](function-atlas.html#workflow=author-to-delivery) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [新对象正文与登记共同创建](#world.object-create) → [同一 OC 的子模板及多份用途投影创建／编辑](#projection.authoring) → [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [无需引擎的已保存场景预览](#scene.saved_preview) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [Godot 4 工程生成与运行协议](#runtime.godot_generated_project) → [后端派生工程清单、只读核对与服务回收](#backend.project_management) → [后端工程持久列表、冻结选择与旧执行链对接](#backend.project_catalog) → [已核对生成工程的可移植交付包](#backend.project_delivery) | [独立游戏发行产物](#build.standalone_distribution) | 主路径明确包含普通Scene2D创建／编辑。对象创建、投影与静态预览按需求选择，步骤不是强制逐项调用或原子事务；脚本／行为见独立分支。作者v3逻辑分组不等于运行plan3。接收方需要Godot，独立发行另列缺口。 |
| [已有行为清单→实例／脚本／参数／信号→审阅→草稿→保存→构建交付](function-atlas.html#workflow=scene-behavior-authoring) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [内置行为绑定、参数与信号原文编辑](#behavior.authoring) → [场景实例的GDScript参数、信号与冻结迁移](#behavior.scene_runtime) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [已核对生成工程的可移植交付包](#backend.project_delivery) | 缺口尚未梳理 | 已有绑定JSON可直接进入编辑，不以本轮首次创建为前置。表单核对现有声明及依赖，只应用原文草稿；普通保存后继续构建。首次创建与关联见behavior\.creation，其他后端作者行为及LSP仍待接。 |
| [已保存场景→首次声明与关系→可恢复保存→参数／信号编辑→构建→工程交付](function-atlas.html#workflow=scene-behavior-creation) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [从已保存场景首次创建行为声明与关联](#behavior.creation) → [内置行为绑定、参数与信号原文编辑](#behavior.authoring) → [场景实例的GDScript参数、信号与冻结迁移](#behavior.scene_runtime) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [已核对生成工程的可移植交付包](#backend.project_delivery) | 缺口尚未梳理 | 首次创建只提交新声明／登记及场景opt-in，后续编辑仍先草稿后普通保存；核心中立，首界面Godot/GDScript单绑定，不执行脚本、不生成脚本或获得LSP/3D/Android权限。 |
| [起始脚本→普通草稿保存→首次行为→参数信号→运行→工程交付](function-atlas.html#workflow=script-authoring) | [内置脚本起始内容与普通TXT草稿保存](#script.authoring) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [从已保存场景首次创建行为声明与关联](#behavior.creation) → [内置行为绑定、参数与信号原文编辑](#behavior.authoring) → [场景实例的GDScript参数、信号与冻结迁移](#behavior.scene_runtime) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [已核对生成工程的可移植交付包](#backend.project_delivery) | 缺口尚未梳理 | 脚本草稿与保存分离；先登记TXT再在首次行为界面选择，绑定关系不由脚本助手自动创建。真实Linux浏览器／Godot验证不等于移动实机或新安装包交付。 |
| [普通原文→单位与选区→缩进／原生历史→普通保存](function-atlas.html#workflow=source-indentation) | [内置脚本起始内容与普通TXT草稿保存](#script.authoring) → [通用原文多行缩进与原生撤销](#authoring.source-indentation) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [从已保存场景首次创建行为声明与关联](#behavior.creation) → [内置行为绑定、参数与信号原文编辑](#behavior.authoring) | 缺口尚未梳理 | 可从新脚本或任何既有文本进入，不要求行为关联；本轮实测止于普通保存与脚本创建交接，后续行为运行仍引用其独立历史验收。 |
| [源码→逻辑位置→只读跳转→继续编辑与普通保存](function-atlas.html#workflow=source-position) | [内置脚本起始内容与普通TXT草稿保存](#script.authoring) → [通用原文多行缩进与原生撤销](#authoring.source-indentation) → [通用原文行列位置与只读跳转](#authoring.source-position) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 缺口尚未梳理 | 可从任何普通原文进入，不要求脚本创建或缩进；导航不触发保存，脚本生成与后端运行仍有独立验收。 |
| [显式检查→诊断原文→只读上下文→修改保存→再检查](function-atlas.html#workflow=source-diagnostic) | [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [源码旁的单条诊断上下文与安全定位](#authoring.source-diagnostic) → [通用原文行列位置与只读跳转](#authoring.source-position) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 缺口尚未梳理 | 此次实际静态计划错误；既有引擎执行验收独立。面板保留单条观察，不是全工程问题总表或LSP服务，不自动保存或重新运行。 |
| [普通源码→字面查找／匹配导航→当前或全部替换→原生历史→普通保存](function-atlas.html#workflow=source-search) | [内置脚本起始内容与普通TXT草稿保存](#script.authoring) → [通用原文查找替换与单次原生撤销](#authoring.source-search) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 缺口尚未梳理 | 所有普通文本均可进入，不要求创建脚本；单文档字面操作不执行语言服务或后端，当前或全部替换先进入普通草稿。 |
| [当前任务→问题筛选／详情→来源定位→普通编辑与显式重验](function-atlas.html#workflow=task-problems) | [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [当前构建任务的问题筛选与来源导航](#build.task-problems) → [源码旁的单条诊断上下文与安全定位](#authoring.source-diagnostic) → [通用原文查找替换与单次原生撤销](#authoring.source-search) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 缺口尚未梳理 | 只读筛选与详情不要求导航或编辑；存在来源时复用原文诊断上下文，查找替换可选，普通保存与下一次检查须明确执行。此次浏览器采用静态计划错误，无引擎执行。 |
| [保存配方→独立二维场景→Godot工程交付](function-atlas.html#workflow=composition-to-delivery) | [直接新建配方的内置助手](#scene.composition_create) → [文件内场景片段、配方预览、单实例覆盖与迁移实验](#scene.composition) → [无需引擎的已保存场景预览](#scene.saved_preview) → [保存态配方生成独立运行场景](#scene.composition_materialize) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [Godot 4 工程生成与运行协议](#runtime.godot_generated_project) → [后端派生工程清单、只读核对与服务回收](#backend.project_management) → [已核对生成工程的可移植交付包](#backend.project_delivery) | [独立游戏发行产物](#build.standalone_distribution) | 从已登记配方开始，生成独立v3场景；无行为场景可直接构建，脚本与行为不是必经步骤。保存态配方生成已真实验证，最新完整带行为路径见composition-godot-behaviors；不宣称上游创作全程GUI或配方自动同步。 新配方助手已另轮验收至Godot；这里ZIP与行为证据保留原起点，不能拼接为同轮上游到交付全程。 |
| [配方场景→内置脚本／行为→Godot实测→工程交付](function-atlas.html#workflow=composition-godot-behaviors) | [直接新建配方的内置助手](#scene.composition_create) → [文件内场景片段、配方预览、单实例覆盖与迁移实验](#scene.composition) → [保存态配方生成独立运行场景](#scene.composition_materialize) → [内置脚本起始内容与普通TXT草稿保存](#script.authoring) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [从已保存场景首次创建行为声明与关联](#behavior.creation) → [内置行为绑定、参数与信号原文编辑](#behavior.authoring) → [场景实例的GDScript参数、信号与冻结迁移](#behavior.scene_runtime) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [Godot 4 工程生成与运行协议](#runtime.godot_generated_project) → [已核对生成工程的可移植交付包](#backend.project_delivery) | [独立游戏发行产物](#build.standalone_distribution) | 二维专题真实Chrome从服务夹具准备的OC／素材／已登记配方出发，GUI创建独立场景和TXT脚本，普通保存并绑定行为，Godot无头事件与工程ZIP异地导入通过。不是上游全程GUI、图形游戏或Bevy行为验收。 新配方助手已另轮验收至Godot；这里ZIP与行为证据保留原起点，不能拼接为同轮上游到交付全程。 |
| [无图二维场景→Bevy数据运行→工程交付](function-atlas.html#workflow=bevy-data-delivery) | [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [Bevy/Rust 无头第二后端](#runtime.bevy_rust) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [后端工程持久列表、冻结选择与旧执行链对接](#backend.project_catalog) → [已核对生成工程的可移植交付包](#backend.project_delivery) | [独立游戏发行产物](#build.standalone_distribution) | 已有Bevy专题验证由可信固定运行程序消费scene-data\.json；交付是需该运行程序的数据工程包，不是Cargo工程或独立可执行文件。图片、行为或窗口要求会被准入检查拒绝；Godot专题不能作为Bevy证据。 独立Rust作者源工程路径另列bevy-rust-author-delivery；这条数据路线不自动获得作者行为。 |
| [空工程→OC与投影→多演员配方／起始排布→独立场景→Godot无头](function-atlas.html#workflow=oc-projection-composition-runtime) | [新对象正文与登记共同创建](#world.object-create) → [同一 OC 的子模板及多份用途投影创建／编辑](#projection.authoring) → [直接新建配方的内置助手](#scene.composition_create) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [无需引擎的已保存场景预览](#scene.saved_preview) → [保存态配方生成独立运行场景](#scene.composition_materialize) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [Godot 4 工程生成与运行协议](#runtime.godot_generated_project) | [独立游戏发行产物](#build.standalone_distribution) | 空工程GUI创建OC、游戏投影和三演员配方；起始排布预览／应用／撤销及坐标失效保护另有真实浏览器证据，最终网格生成Scene2D并运行Godot。共享输入使两个投影演员各移动45px、普通OC40px；不代表图形游戏、行为脚本、ZIP或安装验收。 |
| [多实例／多脚本→一次创建→独立参数信号→Godot→工程交付](function-atlas.html#workflow=scene-behavior-multi-creation) | [内置脚本起始内容与普通TXT草稿保存](#script.authoring) → [首次行为清单的多实例与多脚本创建](#behavior.multi_creation) → [内置行为绑定、参数与信号原文编辑](#behavior.authoring) → [场景实例的GDScript参数、信号与冻结迁移](#behavior.scene_runtime) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [Godot 4 工程生成与运行协议](#runtime.godot_generated_project) → [已核对生成工程的可移植交付包](#backend.project_delivery) | [独立游戏发行产物](#build.standalone_distribution) | 实测从两个已有实例和一份已登记脚本开始，GUI创建第二脚本、三绑定、独立参数信号，真实Godot无头事件及工程ZIP异地导入。保留旧场景与脚本原文，不声称上游全程GUI、图形游戏、作者Bevy Rust或安装设备验收。 |
| [已有场景→新脚本→审阅引用→独立绑定编辑→Godot→工程交付](function-atlas.html#workflow=existing-scene-behavior-links) | [内置脚本起始内容与普通TXT草稿保存](#script.authoring) → [已有行为的脚本引用与独立编辑交接](#behavior.script_links) → [内置行为绑定、参数与信号原文编辑](#behavior.authoring) → [场景实例的GDScript参数、信号与冻结迁移](#behavior.scene_runtime) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [Godot 4 工程生成与运行协议](#runtime.godot_generated_project) → [已核对生成工程的可移植交付包](#backend.project_delivery) | [独立游戏发行产物](#build.standalone_distribution) | 实测从已有双实例／双绑定场景起步；在GUI创建第二脚本、关联后编辑第三绑定，经普通保存、Godot三事件和工程ZIP异地导入。引用只改登记，绑定编辑只改正文。不推导空工程同轮全链、图形游戏或安装设备。 |
| [Rust TXT→显式实例绑定→冻结Cargo源码→无头行为→源工程交付](function-atlas.html#workflow=bevy-rust-author-delivery) | [内置脚本起始内容与普通TXT草稿保存](#script.authoring) → [首次行为清单的多实例与多脚本创建](#behavior.multi_creation) → [内置行为绑定、参数与信号原文编辑](#behavior.authoring) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [Bevy 作者 Rust 行为接入](#behavior.bevy_rust) → [后端派生工程清单、只读核对与服务回收](#backend.project_management) → [已核对生成工程的可移植交付包](#backend.project_delivery) | [独立游戏发行产物](#build.standalone_distribution) | 真实Chrome从已有双实例和一份Rust脚本开始：GUI新增第二TXT、显式Rust profile三绑定，普通保存参数／信号；真实编译错误定位TXT第11行并修复，Bevy发出multi\_0/65、multi\_1/20、multi\_2/7。源码ZIP含10份生成文件、锁文件及双脚本而无target，异地离线重建三事件一致。不证明空工程上游全链、图片、窗口、有限输入回放、每帧hook、热更新或安装设备。 |
| [固定步Rust脚本→首次多绑定与参数→自身实例移动→冻结源码交付](function-atlas.html#workflow=bevy-rust-fixed-step-delivery) | [内置脚本起始内容与普通TXT草稿保存](#script.authoring) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [首次行为清单的多实例与多脚本创建](#behavior.multi_creation) → [内置行为绑定、参数与信号原文编辑](#behavior.authoring) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [Bevy 作者 Rust 行为接入](#behavior.bevy_rust) → [Bevy Rust 固定步自身实例位置与事件驱动](#behavior.bevy_fixed_step) → [后端派生工程清单、只读核对与服务回收](#backend.project_management) → [已核对生成工程的可移植交付包](#backend.project_delivery) | [独立游戏发行产物](#build.standalone_distribution) | 真实Chrome从已有无图双实例与一份旧ready Rust源码起步：GUI原样创建motion TXT、首次三绑定／双源码、独立参数信号编辑、编译错误第16行定位修复，再真实Cargo／Bevy四事件与双实例终态。固定目标禁用builtin控制，位置\[506,218\]→\[512,216\]；旧ready实例终态\[220,220\] idle。100094字节Cargo源码ZIP十文件零素材，异地离线重建事件与坐标一致。七组十图errors=\[\]；不证明空工程上游全链、控制回放、图形游戏、二进制发行或安装设备。 |
| [World绑定WAV→声音编辑／可选素材试听控制→PCM冻结→Godot声音→工程交付](function-atlas.html#workflow=scene-audio-to-delivery) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [为对象追加已登记素材用途](#world.resource-bind) → [已有场景声音的素材选择、轨道管理与时间提示编排](#scene.audio_authoring) → [已绑定声音素材的显式就地试听](#scene.audio_audition) → [独立场景音轨与有限时间提示](#scene.audio_timeline) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [Godot非空间声音播放与资源工程交付](#runtime.godot_audio) → [后端派生工程清单、只读核对与服务回收](#backend.project_management) → [已核对生成工程的可移植交付包](#backend.project_delivery) | [独立游戏发行产物](#build.standalone_distribution) | 本轮在既有可选素材试听中增加进度、暂停／继续和定位，保留同一验证快照且不重读磁盘。非循环定位末尾暂停、继续从头，循环末尾归零；停止和来源失效释放快照，控制不改表单或审阅。不执行场景cues／后端、不增加构建前置条件；本轮浏览器与准备副本证据见scene-audio-audition-transport，未重跑旧PCM／Godot／ZIP或设备验收。以下基础试听与旧专题保留各自原时点：本轮在声音编辑后增加可选单素材试听：显式选择、完整fresh目录与本次字节核对、当前volume／loop的单轨WebAudio播放及停止，不执行cues、不保存、不改变目录unverified语义。128MiB重采样解码估算与32MiB文件上限分别限制；本机浏览器输出证据独立存于scene-audio-audition，Godot来源指纹调整回归另列，不推导物理设备或安装。试听不是后续构建／交付必经条件。以下已绑定素材选择与更早专题保留原执行时点：本轮复用World资源绑定为声音文档显式关联WAV，声音编辑器主动读取已绑定目录并选择新resourceId；原轨道身份和提示引用保持，审阅后普通草稿／保存。绑定与正文是独立保存，取消正文保留已保存绑定，无跨文件原子性；目录不验PCM／哈希，实际字节由build检查。完整来源与World／对象／目录修订变化拒绝旧结果，新范围见scene-audio-resource-selection专题。此前轨道及提示证据保留原时点：本轮独立tracks提案支持1–16轨同资源复制／移除，复制当前设置而不复制cue；移除需先处理当前cue引用，动态行为ID由作者检查更新。保留旧轨道资源／相对顺序和metadata绑定超集，不删资产；普通草稿／保存后重建，冻结只含最终使用的去重资源，实际范围见scene-audio-track-authoring专题。新素材替换／登记不在本轮；此前换轨编排及更早证据保留原时点：本轮以独立timeline提案支持提示改到当前已声明轨道及显式上移／下移，身份保持，运行先时间后同刻作者顺序；普通草稿／保存与资源绑定不变，真实流程范围见scene-audio-cue-arrangement专题。此前提示增删切片及更早叶编辑证据保留如下，不改标为本轮换轨／重排重跑：当前0\.1\.4后工作树在同一入口增加0–64提示的移除／追加，保持轨道资源与旧提示绑定、相对顺序，复用普通草稿和保存；结构编辑的同轮浏览器、Godot和工程ZIP范围见scene-audio-cue-authoring专题。下列最初叶编辑时点证据保留，不改标为提示结构编辑重跑：起点是复制示例中已登记并关联的声音JSON，不声称声音新建或资源导入。真实Chrome4组／10图、三语390px，取消无写、应用普通草稿后保存仅改声音文档；Godot无头准入三条提示0/\.125/\.5秒，58450字节ZIP八生成文件／一去重WAV异地导入运行一致。Rust声明、真实PCM混音缓冲和资源准备另列证据；music／effect非总线，没有空间音频、行为事件触发、音频控制回放组合、Bevy播放、物理扬声器或安装设备证明。 |
| [保存场景与登记WAV→定时／行为触发音轨→审阅保存→独立编辑及运行→工程交付](function-atlas.html#workflow=scene-first-audio-to-delivery) | [图片／视频／音频导入、引用、草稿预览与播放](#media.embed-play) → [保存场景首次创建声音与完整登记](#scene.audio_creation) → [已有场景声音的素材选择、轨道管理与时间提示编排](#scene.audio_authoring) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [独立场景音轨与有限时间提示](#scene.audio_timeline) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [Godot非空间声音播放与资源工程交付](#runtime.godot_audio) → [后端派生工程清单、只读核对与服务回收](#backend.project_management) → [已核对生成工程的可移植交付包](#backend.project_delivery) | [独立游戏发行产物](#build.standalone_distribution) | 最初定时分支验收：从准备好的已保存Scene2D与已登记PCM WAV开始；创建界面配置两轨并审阅三文件保存，随后独立字段修改与普通保存、再次入口导航、真实Godot及工程ZIP异地导入。中英日390px取消与保留输入分别实测。素材导入是前置能力，未声称在同轮GUI完成；不证明空工程、Bevy音频、物理扬声器或安装设备。 最终浏览器六组／十二图，声音在0和0\.125秒执行，58542字节ZIP八文件／一去重WAV异地Godot运行一致，41份源指纹不变。 本轮扩展：逐轨定时／行为触发创建：旧输入字节保持，零提示仍校验并登记WAV；107项相关检查、实际项目创建后八条行为声音命令及零定时提示、Chrome六组12图与异地ZIP、准备副本18次对照/3组核心调用通过。应用5307项中5150通过、157条件跳过。 0\.1\.4后工作树在打开已有声音后可继续增删时间提示；此增量复用scene\.audio\_authoring及普通保存，实际同轮范围由scene-audio-cue-authoring专题单独记录。 本轮在已有声音面板继续接入目标轨道选择与上下移动，旧增删API和证据保持；新的运行／保存范围由scene-audio-cue-arrangement专题独立记录。 后续已有声音面板现接通同资源轨道复制／移除，保留原创建事务及metadata绑定，不自动改写动态行为轨道ID；普通保存后重建，当前证据由scene-audio-track-authoring专题单独记录。 已有轨道现可通过World先绑定其他已登记WAV，再在声音编辑器显式读取并选择素材；首次创建事务保持，后续正文仍普通保存，目录不验证实际PCM。此素材选择增量由scene-audio-resource-selection专题单独记录。 |
| [多个已保存Scene2D→项目组装与启动入口→统一Godot工程→入口运行→工程交付](function-atlas.html#workflow=project-assembly-to-delivery) | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [项目级多场景组装、启动入口与统一工程交付](#build.project_assembly) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [后端派生工程清单、只读核对与服务回收](#backend.project_management) → [已核对生成工程的可移植交付包](#backend.project_delivery) | [独立游戏发行产物](#build.standalone_distribution) | 从临时副本中两个已登记Scene2D开始；最终Chrome四组／八图、三语390px审阅取消和两文件保存，统一Godot工程启动第二成员，展示入口对象并完成原生Godot窗口ready／面板关闭重开／明确取消。17030字节ZIP十文件／一共享图像异地导入后仍执行同一入口；81份源指纹保持。独立后端专项另验证行为／声音入口和非入口错误。运行时切换、直接3D／配方成员、物理动画／LSP、无引擎独立发行和安装设备验收未包含。 |
| [项目组装→切换脚本→绑定端口→逐场景访问与观察→工程交付](function-atlas.html#workflow=project-scene-switching-to-delivery) | [内置脚本起始内容与普通TXT草稿保存](#script.authoring) → [已有行为的脚本引用与独立编辑交接](#behavior.script_links) → [项目级多场景组装、启动入口与统一工程交付](#build.project_assembly) → [项目内运行时场景切换与逐访问观察](#runtime.project_scene_switching) → [已核对生成工程的可移植交付包](#backend.project_delivery) | [独立游戏发行产物](#build.standalone_distribution) | 从准备好的两个成员与组装开始，内置切换起始内容仍走普通草稿／保存／既有绑定。最终Chrome五组／九图、98源指纹保持，Godot A→B→A、三语390px当前／历史、真实HTTP当前实例筛选与3访问记录、真实点击打开匹配作者文档、真实窗口取消及92367字节ZIP／23文件／2资源异地同序列通过。无跨场景状态／事件总线、Bevy项目运行、安装或独立发行；不声称空工程全部上游GUI创作。 |
| [项目组装→共享状态脚本→跨场景读写／移除→历史写入来源观察→工程交付](function-atlas.html#workflow=project-shared-state-to-delivery) | [内置脚本起始内容与普通TXT草稿保存](#script.authoring) → [已有行为的脚本引用与独立编辑交接](#behavior.script_links) → [项目级多场景组装、启动入口与统一工程交付](#build.project_assembly) → [项目内运行时场景切换与逐访问观察](#runtime.project_scene_switching) → [项目会话共享标量状态与历史写入来源](#runtime.project_shared_state) → [已核对生成工程的可移植交付包](#backend.project_delivery) | [独立游戏发行产物](#build.standalone_distribution) | 从临时复制的已登记双场景组装出发；共享状态起始脚本在界面可审阅取消，已保存脚本沿普通绑定运行。真实Chrome六组／九图／112源摘要保持，A→B→A共享与删除、新run清空、三语390px、真实窗口取消、写入来源文档及98170字节ZIP／23文件／2资源异地同状态序列通过。无sourceRange不宣称精确选区；不包含空工程上游全部GUI、持久存档、事件总线、安装设备或独立发行。 |
| [项目组装→事件订阅与发布脚本→FIFO投递及跨访问观察→双方来源→工程交付](function-atlas.html#workflow=project-events-to-delivery) | [内置脚本起始内容与普通TXT草稿保存](#script.authoring) → [已有行为的脚本引用与独立编辑交接](#behavior.script_links) → [项目级多场景组装、启动入口与统一工程交付](#build.project_assembly) → [项目内运行时场景切换与逐访问观察](#runtime.project_scene_switching) → [项目会话共享标量状态与历史写入来源](#runtime.project_shared_state) → [项目会话事件发布订阅与有界投递观察](#runtime.project_events) → [已核对生成工程的可移植交付包](#backend.project_delivery) | [独立游戏发行产物](#build.standalone_distribution) | 从临时复制的已登记双场景组装出发；事件起始草稿仍走普通保存／绑定。真实Chrome六组／十图、125源保持，A→B→A六发布／五handled／两skipped及state8、三语390px、窗口取消、真实HTTP query与发布／订阅文档回源、107048字节ZIP／25文件／2媒体异地同序列通过。无sourceRange不宣称精确选区；不包含空工程上游全部GUI、事件持久化、异步回调、安装设备或独立发行。 |
| [已有轨道与事件行为→有界声音请求→实际回执和双方来源→工程交付](function-atlas.html#workflow=project-audio-controls-to-delivery) | [独立场景音轨与有限时间提示](#scene.audio_timeline) → [内置脚本起始内容与普通TXT草稿保存](#script.authoring) → [已有行为的脚本引用与独立编辑交接](#behavior.script_links) → [项目级多场景组装、启动入口与统一工程交付](#build.project_assembly) → [项目会话事件发布订阅与有界投递观察](#runtime.project_events) → [行为驱动项目音轨播放停止与实际命令观察](#runtime.project_audio_controls) → [已核对生成工程的可移植交付包](#backend.project_delivery) | [独立游戏发行产物](#build.standalone_distribution) | 从临时已登记两场景与轨道出发，真实Chrome六组11图验证起始脚本审阅、A→B→A八条实际命令、三语窄屏、第二次运行、窗口取消、行为文档及两个轨道真实范围回源；ZIP含28文件／2媒体，在新目录真实Godot导入后同序列执行。另有13项原生声音专项及混音PCM捕获。非全部上游GUI创作，不声称设备耳听、自然结束、空间声音、安装或独立发行。 |

## 功能与实现切片

四项分数按「实现／验证／解耦／交付」排列。详细逐项理由和证据类型可在交互图或 JSON 查询。现有与计划实现并列时，不互相继承成熟度。

<a id="authoring.parse-index"></a>
### 通用解析、静态索引与阅读

`authoring.parse-index` · 创作与工程 · 源码交付

入口：文档列表／筛选／详情；GET /api/index（轻量目录）；GET data/index.json（解析展示索引）；POST /api/rebuild

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **parse\.mjs / parser\.mjs 等**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/editor-index-refresh-2026-09-23/results\.json](../docs/test-results/editor-index-refresh-2026-09-23/results.json)、[docs/test-results/editor-filtering-2026-09-23/results\.json](../docs/test-results/editor-filtering-2026-09-23/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json) |
| 本机服务与适配 | **core\.mjs / static-index\.mjs 等**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/editor-index-refresh-2026-09-23/results\.json](../docs/test-results/editor-index-refresh-2026-09-23/results.json)、[docs/test-results/editor-filtering-2026-09-23/results\.json](../docs/test-results/editor-filtering-2026-09-23/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json) |
| 交互与渲染 | **app-render\.js / app-runtime\.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/editor-index-refresh-2026-09-23/results\.json](../docs/test-results/editor-index-refresh-2026-09-23/results.json)、[docs/test-results/editor-filtering-2026-09-23/results\.json](../docs/test-results/editor-filtering-2026-09-23/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json) |

平台：桌面／本机浏览器；具体界面与安装验收分开、Android编辑子集；媒体/World另列。边界：原文权威；Markdown/TXT/JSON/YAML；展示索引与轻量目录是独立路径。

下一步：解析、布局与索引规则仍在 JS；Rust 下沉需保持原文范围与数值精度。

<a id="authoring.document-edit"></a>
### 源码／分段草稿、创建、保存与冲突

`authoring.document-edit` · 创作与工程 · 源码交付

入口：开始编辑／新建文档／保存；GET /api/doc；POST /api/doc

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-runtime\.js / app-editor-draft\.js / app-source-history\.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/save-conflicts-2026-09-23/results\.json](../docs/test-results/save-conflicts-2026-09-23/results.json)、[docs/test-results/save-recovery-2026-09-23/results\.json](../docs/test-results/save-recovery-2026-09-23/results.json)、[docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json) |
| 可移植 JS 语义 | **source-draft\.mjs / document-store\.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/save-conflicts-2026-09-23/results\.json](../docs/test-results/save-conflicts-2026-09-23/results.json)、[docs/test-results/save-recovery-2026-09-23/results\.json](../docs/test-results/save-recovery-2026-09-23/results.json)、[docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json) |
| 存储与事务 | **node-document-storage\.mjs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/save-conflicts-2026-09-23/results\.json](../docs/test-results/save-conflicts-2026-09-23/results.json)、[docs/test-results/save-recovery-2026-09-23/results\.json](../docs/test-results/save-recovery-2026-09-23/results.json)、[docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json) |
| Android 宿主 | **platform\.mjs / mobile\_storage\.rs**；Android请求/存储/迁移适配；只覆盖已声明移动子集。 | 4 / 4 / 3 / 3 | [docs/test-results/save-conflicts-2026-09-23/results\.json](../docs/test-results/save-conflicts-2026-09-23/results.json)、[docs/test-results/save-recovery-2026-09-23/results\.json](../docs/test-results/save-recovery-2026-09-23/results.json)、[docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json) |

平台：桌面／本机浏览器；具体界面与安装验收分开、Android编辑子集；媒体/World另列。边界：保存与重建分离；冲突及失败保留草稿；Android 私有存储与恢复草稿已接入，桌面草稿不跨重启持久；当前已登记场景的原文草稿可只读预览并按hash定位，具体范围见scene.text_draft_preview；不扩展普通文档保存或多文件草稿事务。。

下一步：桌面持久草稿／永久撤销历史；从界面抽离统一草稿状态机。

<a id="authoring.field-edit"></a>
### 字段表原位保真编辑

`authoring.field-edit` · 创作与工程 · 源码交付

入口：开始编辑 → 字段编辑；POST /api/doc/fields

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-field-editor\.js / app-field-draft\.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/field-editing-2026-09-24/results\.json](../docs/test-results/field-editing-2026-09-24/results.json)、[docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 可移植 JS 语义 | **fields\.mjs / field-changes\.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/field-editing-2026-09-24/results\.json](../docs/test-results/field-editing-2026-09-24/results.json)、[docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **document-field-draft\.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/field-editing-2026-09-24/results\.json](../docs/test-results/field-editing-2026-09-24/results.json)、[docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面／本机浏览器；具体界面与安装验收分开、Android编辑子集；媒体/World另列。边界：仅编辑可映射的已有标量；保留 BOM/CRLF/注释/未改字节；JSON/YAML 层级编辑、锚点等回源码模式。

下一步：新增／删除字段及结构变更；字段语义下沉 Rust；Android 素材选择未接。

<a id="project.type-templates"></a>
### 工程自定义类型、解析规则与文档模板

`project.type-templates` · 创作与工程 · 源码交付

入口：项目类型与模板；GET/POST /api/project；POST /api/project/preview

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-project-settings\.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/project-settings-2026-09-23/results\.json](../docs/test-results/project-settings-2026-09-23/results.json)、[docs/test-results/project-snapshot-2026-09-23/results\.json](../docs/test-results/project-snapshot-2026-09-23/results.json)、[docs/test-results/template-http-2026-09-23/results\.json](../docs/test-results/template-http-2026-09-23/results.json) |
| 可移植 JS 语义 | **project\.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/project-settings-2026-09-23/results\.json](../docs/test-results/project-settings-2026-09-23/results.json)、[docs/test-results/project-snapshot-2026-09-23/results\.json](../docs/test-results/project-snapshot-2026-09-23/results.json)、[docs/test-results/template-http-2026-09-23/results\.json](../docs/test-results/template-http-2026-09-23/results.json) |
| 本机服务与适配 | **project-definition\.mjs / project-service\.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/project-settings-2026-09-23/results\.json](../docs/test-results/project-settings-2026-09-23/results.json)、[docs/test-results/project-snapshot-2026-09-23/results\.json](../docs/test-results/project-snapshot-2026-09-23/results.json)、[docs/test-results/template-http-2026-09-23/results\.json](../docs/test-results/template-http-2026-09-23/results.json) |

平台：桌面／本机编辑服务配置界面、Android可读取导入定义，配置界面未接入。边界：类型与模板属于工程；模板预览复用解析器；新增取消／放弃／返回已实现；Android 只读导入定义。

下一步：Android 配置界面；通用类型插件及模板包升级不是当前能力。

<a id="project.starter-packs"></a>
### 五类独立工程起始模板包

`project.starter-packs` · 创作与工程 · 源码交付

入口：桌面／Android 新建项目模板选择器

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 工程定义与格式 | **project-templates\.json / workspace-layout\.json**；声明式工程类型/模板或格式；不等于可执行脚本插件。 | 4 / 4 / 3 / 3 | [docs/test-results/project-templates/results\.json](../docs/test-results/project-templates/results.json)、[docs/test-results/oc-templates/results\.json](../docs/test-results/oc-templates/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json) |
| 存储与事务 | **workspace\.rs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/project-templates/results\.json](../docs/test-results/project-templates/results.json)、[docs/test-results/oc-templates/results\.json](../docs/test-results/oc-templates/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json) |
| 交互与渲染 | **app\.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/project-templates/results\.json](../docs/test-results/project-templates/results.json)、[docs/test-results/oc-templates/results\.json](../docs/test-results/oc-templates/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json) |
| Android 宿主 | **platform\.mjs**；Android请求/存储/迁移适配；只覆盖已声明移动子集。 | 4 / 4 / 3 / 3 | [docs/test-results/project-templates/results\.json](../docs/test-results/project-templates/results.json)、[docs/test-results/oc-templates/results\.json](../docs/test-results/oc-templates/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json) |

平台：桌面／Android源码的新建入口、新选择器有浏览器/原生存储联调，安装窗口/设备待验。边界：空白、游戏、文学、戏剧、软件设计；完整定义副本+来源摘要；旧 OC 默认兼容；新选择器原生存储联调而非新设备验收。

下一步：第三方模板包安装／升级、可执行工程类型插件；Android 新选择器设备实测。

<a id="identity.registration-ownership"></a>
### 稳定身份、登记、归属及历史背景迁移

`identity.registration-ownership` · 创作与工程 · 源码交付

入口：workspace CLI register / verify / migration；文档和资源登记；角色背景附属树

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **document-model\.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/document-migration-2026-09-23/results\.json](../docs/test-results/document-migration-2026-09-23/results.json)、[docs/test-results/archive-registry-2026-09-23/results\.json](../docs/test-results/archive-registry-2026-09-23/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **workspace\.mjs / workspace\.mjs 等**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/document-migration-2026-09-23/results\.json](../docs/test-results/document-migration-2026-09-23/results.json)、[docs/test-results/archive-registry-2026-09-23/results\.json](../docs/test-results/archive-registry-2026-09-23/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面/本机服务及Node维护CLI、Android保留身份和归属数据，语义管理入口未全部接入。边界：UUID 作为身份；背景保留角色原文或明确 part-of；共享归属允许多主人，循环拒绝；旧数据显式迁移。

下一步：当前登记与原文同步通过多条适配路径；后续统一可恢复语义命令覆盖剩余旧路径。

<a id="world.query"></a>
### World／Object／Resource 观察投影与查询

`world.query` · 语义与投影 · 源码交付

入口：世界与对象；GET /api/world；scripts/world.mjs

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-world-browser\.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/world-m1/results\.json](../docs/test-results/world-m1/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 可移植 JS 语义 | **world-projection\.mjs / world-query\.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/world-m1/results\.json](../docs/test-results/world-m1/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **node-world-projection\.mjs / world\.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/world-m1/results\.json](../docs/test-results/world-m1/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面／本机编辑服务GUI及Node语义命令、Android未接入。边界：正文+登记派生只读观察快照，保留来源范围与修订；present-unverified 不代表资源字节已核验；Android 未接。

下一步：World 核心 Rust 化；持久模型/协作权限/Android 适配未实现。

<a id="world.property-set"></a>
### 单对象单属性语义修改

`world.property-set` · 语义与投影 · 源码交付

入口：世界与对象 → 预览修改／应用；POST /api/world/commands: property.set；scripts/world.mjs

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **world-commands\.mjs / world-command-contract\.mjs 等**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/world-m2/results\.json](../docs/test-results/world-m2/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **node-world-commands\.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/world-m2/results\.json](../docs/test-results/world-m2/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 交互与渲染 | **app-world-browser\.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/world-m2/results\.json](../docs/test-results/world-m2/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面／本机编辑服务GUI及Node语义命令、Android未接入。边界：预览无写入、修订核对、保真单字段、受基线约束反向命令；与旧文档编辑共享锁。

下一步：任意结构字段变化、通用撤销历史、Android 语义写入未实现。

<a id="world.changeset"></a>
### 批量属性提交、读取屏障与崩溃恢复

`world.changeset` · 语义与投影 · 源码交付

入口：世界与对象 → 待提交修改；POST /api/world/commands: changeset.apply / world.recover；GET /api/world/transaction

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **world-changeset\.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/world-m3/results\.json](../docs/test-results/world-m3/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **node-world-commands\.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/world-m3/results\.json](../docs/test-results/world-m3/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 存储与事务 | **world-transactions\.mjs / world-transaction-state\.mjs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/world-m3/results\.json](../docs/test-results/world-m3/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 交互与渲染 | **app-world-browser\.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/world-m3/results\.json](../docs/test-results/world-m3/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面／本机编辑服务GUI及Node语义命令、Android未接入。边界：最多 32 个现有对象、每对象一个属性；持久意图+镜像+提交标记，全旧／全新恢复；Linux SIGKILL 实测，不等于硬件断电认证。

下一步：混合创建／关系／资源事务、同对象多字段、永久历史、Android 写入适配仍缺。

<a id="world.object-create"></a>
### 新对象正文与登记共同创建

`world.object-create` · 语义与投影 · 源码交付

入口：世界与对象 → 新建对象；POST /api/world/commands: object.create

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **world-object-create\.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/world-create/results\.json](../docs/test-results/world-create/results.json)、[docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **node-world-commands\.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/world-create/results\.json](../docs/test-results/world-create/results.json)、[docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 存储与事务 | **world-transactions\.mjs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/world-create/results\.json](../docs/test-results/world-create/results.json)、[docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 交互与渲染 | **app-world-browser\.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/world-create/results\.json](../docs/test-results/world-create/results.json)、[docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面／本机编辑服务GUI及Node语义命令、Android未接入。边界：v2 事务意图共同发布两个新文件；与空正文区分；不允许任意附带关系；原生归档互操作已验。

下一步：更多对象类型的组合语义创建、Android 语义入口。

<a id="world.relation-add"></a>
### 引用／共享归属关系追加

`world.relation-add` · 语义与投影 · 源码交付

入口：世界与对象 → 添加关系；POST /api/world/commands: relation.add

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **world-relations\.mjs / world-record-edit\.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/world-relations/results\.json](../docs/test-results/world-relations/results.json)、[docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **node-world-commands\.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/world-relations/results\.json](../docs/test-results/world-relations/results.json)、[docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 存储与事务 | **world-transactions\.mjs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/world-relations/results\.json](../docs/test-results/world-relations/results.json)、[docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 交互与渲染 | **app-world-browser\.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/world-relations/results\.json](../docs/test-results/world-relations/results.json)、[docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面／本机编辑服务GUI及Node语义命令、Android未接入。边界：part-of / references；追加单登记 token、保留未知内容；归属循环拒绝、引用循环允许；v3 日志核对其他登记图。

下一步：关系删除／更换与多关系批次尚无对应命令；Android 未接。

<a id="world.resource-bind"></a>
### 为对象追加已登记素材用途

`world.resource-bind` · 语义与投影 · 源码交付

入口：世界与对象 → 绑定资源；POST /api/world/commands: resource.bind

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **world-resources\.mjs / world-record-edit\.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/world-resources/results\.json](../docs/test-results/world-resources/results.json)、[docs/test-results/release-0\.0\.5/results\.json](../docs/test-results/release-0.0.5/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **node-world-commands\.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/world-resources/results\.json](../docs/test-results/world-resources/results.json)、[docs/test-results/release-0\.0\.5/results\.json](../docs/test-results/release-0.0.5/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 存储与事务 | **world-transactions\.mjs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/world-resources/results\.json](../docs/test-results/world-resources/results.json)、[docs/test-results/release-0\.0\.5/results\.json](../docs/test-results/release-0.0.5/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 交互与渲染 | **app-world-browser\.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/world-resources/results\.json](../docs/test-results/world-resources/results.json)、[docs/test-results/release-0\.0\.5/results\.json](../docs/test-results/release-0.0.5/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面／本机编辑服务GUI及Node语义命令、Android未接入。边界：v4 日志；图片／音视频／字体／文本／其他及自定义 role；离线身份允许、文件不复制；绑定不等于正文播放器或字节验证。

下一步：解绑／更换及混合事务、Android 语义操作。

<a id="projection.authoring"></a>
### 同一 OC 的子模板及多份用途投影创建／编辑

`projection.authoring` · 语义与投影 · 源码交付

入口：世界与对象 → 创建／编辑投影；POST /api/world/commands: projection.create / projection.update

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-object-projection\.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/oc-projections/results\.json](../docs/test-results/oc-projections/results.json)、[docs/test-results/oc-projection-edit/results\.json](../docs/test-results/oc-projection-edit/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json) |
| 可移植 JS 语义 | **object-projection-template\.mjs / object-projection\.mjs 等**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/oc-projections/results\.json](../docs/test-results/oc-projections/results.json)、[docs/test-results/oc-projection-edit/results\.json](../docs/test-results/oc-projection-edit/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json) |
| 本机服务与适配 | **node-world-commands\.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/oc-projections/results\.json](../docs/test-results/oc-projections/results.json)、[docs/test-results/oc-projection-edit/results\.json](../docs/test-results/oc-projection-edit/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json) |

平台：桌面／本机浏览器；具体界面与安装验收分开。边界：投影独立 UUID、完整子模板快照、来源 OC 固定；v6/v7 事务；图像追加绑定；场景继承解析有效值；不改写原 OC 背景身份；模板/来源/保存路径改换以及批量投影编辑不在现有表单范围；历史图片绑定保留，可能扩大导出依赖；Android 无创作入口；新版 Tauri 安装窗口未验收。

下一步：任意运行语义／行为契约、第三方模板插件、Android 投影界面与新版 Tauri 窗口验收。

<a id="media.embed-play"></a>
### 图片／视频／音频导入、引用、草稿预览与播放

`media.embed-play` · 素材与迁移 · 源码交付

入口：素材选择器／粘贴／拖入；GET/POST /api/assets；POST /api/assets/insert

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-media-editor\.js / app-media-render\.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/media-insertion-2026-09-23/results\.json](../docs/test-results/media-insertion-2026-09-23/results.json)、[docs/test-results/native-current-2026-09-24/results\.json](../docs/test-results/native-current-2026-09-24/results.json)、[docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json) |
| 可移植 JS 语义 | **media-insertion\.mjs / media-format\.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/media-insertion-2026-09-23/results\.json](../docs/test-results/media-insertion-2026-09-23/results.json)、[docs/test-results/native-current-2026-09-24/results\.json](../docs/test-results/native-current-2026-09-24/results.json)、[docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json) |
| 本机服务与适配 | **media-assets\.mjs / media-insertion\.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/media-insertion-2026-09-23/results\.json](../docs/test-results/media-insertion-2026-09-23/results.json)、[docs/test-results/native-current-2026-09-24/results\.json](../docs/test-results/native-current-2026-09-24/results.json)、[docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json) |

平台：桌面／本机浏览器；具体界面与安装验收分开。边界：稳定引用/旧路径兼容；结构化补丁保真；素材导入先落盘、放弃草稿不自动删素材；本地播放受平台解码器能力限制。

下一步：Android 媒体访问／上传／播放器未接；资源垃圾回收不能以未保存草稿简单判断。

<a id="export.document-share"></a>
### 文档阅读分享包与受控下载生命周期

`export.document-share` · 素材与迁移 · 源码交付

入口：导出 → HTML / Markdown 分享；POST/GET /api/export

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-export\.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/export-references-2026-09-23/results\.json](../docs/test-results/export-references-2026-09-23/results.json)、[docs/test-results/export-downloads-2026-09-24/results\.json](../docs/test-results/export-downloads-2026-09-24/results.json)、[docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json) |
| 本机服务与适配 | **export-package\.mjs / export-render\.mjs 等**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/export-references-2026-09-23/results\.json](../docs/test-results/export-references-2026-09-23/results.json)、[docs/test-results/export-downloads-2026-09-24/results\.json](../docs/test-results/export-downloads-2026-09-24/results.json)、[docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json) |

平台：桌面／本机浏览器；具体界面与安装验收分开。边界：选中文档+附属内容+所需素材，通用布局导出 ZIP；取消、流中断、名额和过期回收；共享内容与完整工程迁移分开；分享包不能用作完整项目恢复；Android 未接入；播放取决于阅读软件编解码支持。

下一步：Android 分享导出未接；新打包宿主保存窗口仍需当前安装包验收。

<a id="resource.package"></a>
### 选择式资源包依赖闭包、冲突预览与追加导入

`resource.package` · 素材与迁移 · 源码交付

入口：资源包面板；/api/resource-packages

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-resource-packages\.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/resource-packages/results\.json](../docs/test-results/resource-packages/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/oc-projections/results\.json](../docs/test-results/oc-projections/results.json) |
| 可移植 JS 语义 | **resource-package\.mjs**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/resource-packages/results\.json](../docs/test-results/resource-packages/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/oc-projections/results\.json](../docs/test-results/oc-projections/results.json) |
| 本机服务与适配 | **resource-package-service\.mjs / resource-package-export\.mjs 等**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/resource-packages/results\.json](../docs/test-results/resource-packages/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/oc-projections/results\.json](../docs/test-results/oc-projections/results.json) |
| 存储与事务 | **resource-package-transaction\.mjs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/resource-packages/results\.json](../docs/test-results/resource-packages/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/oc-projections/results\.json](../docs/test-results/oc-projections/results.json) |

平台：桌面／本机浏览器；具体界面与安装验收分开。边界：选择对象及依赖闭包；验证、冲突预览、独立持久导入事务；保留 UUID、归属和原字节；只读服务只开放清单／导出；Android 未接入资源包 UI；导入恢复中的 fence 不能按缓存清理；外部改动停止恢复；旧功能图 50 条链未包含此能力；0.0.10配方增量按当前原文派生全部模板/覆盖依赖，读包/导入重验类别与清单完整性；不写作者metadata，失效配方可完整备份但不能选择式迁移。；0.1.3之后项目级多Scene2D组装由build.project_assembly单列：新增项目计划／成员来源／闭包适配不改变本功能既有单场景评分和历史验收。。

下一步：Android 选择式导入导出未接；无升级覆盖或任意合并语义。

<a id="resource.original-export"></a>
### 单个登记素材原始字节再导出

`resource.original-export` · 素材与迁移 · 源码交付

入口：素材卡／资源包列表 → 导出原始文件；/api/export

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-media-editor\.js / app-resource-packages\.js 等**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/asset-export/results\.json](../docs/test-results/asset-export/results.json)、[docs/test-results/release-0\.0\.5/results\.json](../docs/test-results/release-0.0.5/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **export-package\.mjs / export-service\.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/asset-export/results\.json](../docs/test-results/asset-export/results.json)、[docs/test-results/release-0\.0\.5/results\.json](../docs/test-results/release-0.0.5/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 存储与事务 | **export\.rs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/asset-export/results\.json](../docs/test-results/asset-export/results.json)、[docs/test-results/release-0\.0\.5/results\.json](../docs/test-results/release-0.0.5/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面／本机浏览器；具体界面与安装验收分开。边界：以登记身份定位图片／视频／音频，保留字节与可携文件名；导出不改草稿和光标；微型视频测试只验证传输不是解码；不带 UUID 或元数据；跨工程保留身份应使用资源包；Android 未接入，新原生选择器窗口待验收；小视频 fixture 仅验证字节传输，不代表解码。

下一步：Android 未接；新版本原生保存对话框实测待补。

<a id="authoring.languages"></a>
### 中英日界面切换及草稿保留

`authoring.languages` · 创作与工程 · 源码交付

入口：设置 → 简体中文 / English / 日本語

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **index\.js / en\.js 等**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/trilingual-2026-09-24/results\.json](../docs/test-results/trilingual-2026-09-24/results.json)、[docs/test-results/translation-refinement-2026-09-24/results\.json](../docs/test-results/translation-refinement-2026-09-24/results.json)、[docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json) |
| 桌面宿主 | **preferences\.rs**；桌面系统能力和会话；不能替代Web/Android验收。 | 4 / 4 / 3 / 3 | [docs/test-results/trilingual-2026-09-24/results\.json](../docs/test-results/trilingual-2026-09-24/results.json)、[docs/test-results/translation-refinement-2026-09-24/results\.json](../docs/test-results/translation-refinement-2026-09-24/results.json)、[docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json) |

平台：桌面／本机浏览器／Android各自设置与草稿保留、作品内容维持原文，不作自动翻译。边界：界面与诊断本地化；切换保留草稿／焦点／选择；作者类型名、字段与正文不自动翻译。

下一步：新增功能文案持续覆盖；设备字体/输入法与更多原生平台仍需实测。

<a id="host.library"></a>
### 作品库、起始模板与最近工程

`host.library` · 宿主与存储 · 源码交付

入口：desktop/ui/app.js → library_state / new_workspace / choose_workspace / launch_workspace

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app\.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/project-templates/results\.json](../docs/test-results/project-templates/results.json)、[docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json) |
| 桌面宿主 | **desktop\_host\.rs**；桌面系统能力和会话；不能替代Web/Android验收。 | 4 / 4 / 3 / 3 | [docs/test-results/project-templates/results\.json](../docs/test-results/project-templates/results.json)、[docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json) |
| 存储与事务 | **workspace\.rs / project\_templates\.rs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/project-templates/results\.json](../docs/test-results/project-templates/results.json)、[docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json) |
| 工程定义与格式 | **project-templates\.json**；声明式工程类型/模板或格式；不等于可执行脚本插件。 | 4 / 4 / 3 / 3 | [docs/test-results/project-templates/results\.json](../docs/test-results/project-templates/results.json)、[docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json) |

平台：Tauri桌面作品库；新选择器尚待实际安装窗口验收、Android作品库入口见移动宿主条目；普通浏览器无原生作品库。边界：新增起始包选择器尚无当前0.0.7 Tauri窗口/安装包验收；打开任意文件夹先验证 v1/v2/v3，旧工程不强制迁移。

下一步：补验新模板选择器在安装包中的创建／重开与最近工程。

<a id="host.desktop-session"></a>
### 桌面会话、服务进程与关闭保护

`host.desktop-session` · 宿主与存储 · 源码交付

入口：launch_workspace → session.lock → Node sidecar ready → token/Cookie → editor；resume_editor / close_editor / __desktop/close-response

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 桌面宿主 | **desktop\_host\.rs / close\_state\.rs**；桌面系统能力和会话；不能替代Web/Android验收。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/scene-layout/results\.json](../docs/test-results/scene-layout/results.json)、[docs/test-results/build-workbench/results\.json](../docs/test-results/build-workbench/results.json) |
| 本机服务与适配 | **desktop-session\.mjs / doc-server\.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/scene-layout/results\.json](../docs/test-results/scene-layout/results.json)、[docs/test-results/build-workbench/results\.json](../docs/test-results/build-workbench/results.json) |

平台：Tauri桌面会话、窗口及原生桥、当前实测以Linux历史安装为界；新布局关窗链待Tauri验收。边界：场景布局关闭保护有源码回归，新增界面尚未在新安装包上重新验收；跨重启任务身份与宿主崩溃恢复未实现。

下一步：新布局／Rust增量需要在真实Tauri窗口验收关闭保护。

<a id="storage.full-archive"></a>
### 完整工程归档和恢复

`storage.full-archive` · 宿主与存储 · 源码交付

入口：作品库 backup_workspace / restore_workspace；POST /api/export kind=project；Android 完整包入口

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 存储与事务 | **workspace\.rs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/scene-selection/results\.json](../docs/test-results/scene-selection/results.json) |
| 本机服务与适配 | **export-package\.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/scene-selection/results\.json](../docs/test-results/scene-selection/results.json) |
| Android 宿主 | **mobile\_archive\.rs**；Android请求/存储/迁移适配；只覆盖已声明移动子集。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/scene-selection/results\.json](../docs/test-results/scene-selection/results.json) |

平台：Tauri桌面导入／导出、本机浏览器仅完整包导出，恢复使用桌面宿主、Android私有目录与SAF完整包迁移。边界：最新 Rust 核心轮次未提供归档和移动存储辅助程序，该 19 项跳过不能覆盖旧证据；多 GiB 实作容量、空间耗尽和断电未验收；大作品测试按配置忽略。

下一步：每次增加作者数据类型，补齐跨宿主往返与失败恢复。

<a id="export.jobs-delivery"></a>
### 导出准备、下载、原生保存及清理

`export.jobs-delivery` · 素材与迁移 · 源码交付

入口：POST /api/export prepare/release；GET /api/export Range/HEAD；POST /__desktop/export → save_editor_export

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 本机服务与适配 | **export-service\.mjs / doc-server-routes\.mjs 等**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json)、[docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 存储与事务 | **export\.rs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json)、[docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 桌面宿主 | **desktop\_host\.rs**；桌面系统能力和会话；不能替代Web/Android验收。 | 4 / 4 / 3 / 3 | [docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json)、[docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面／本机浏览器；具体界面与安装验收分开。边界：Windows/macOS 原生对话框和不同文件系统待验收；最新单素材任务扩展没有新原生窗口验收。

下一步：继续按取消、断连、未知原生保存结果做端到端检查。

<a id="storage.workspace-maintenance"></a>
### 工程核验、外置素材绑定和旧登记迁移

`storage.workspace-maintenance` · 宿主与存储 · 源码交付

入口：npm run workspace -- paths|register|verify|check-project|bind-assets|migrate-documents|apply-definition

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 本机服务与适配 | **workspace\.mjs / workspace\.mjs 等**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/document-migration-2026-09-23/results\.json](../docs/test-results/document-migration-2026-09-23/results.json)、[docs/test-results/asset-binding-2026-09-23/results\.json](../docs/test-results/asset-binding-2026-09-23/results.json)、[docs/test-results/project-definition-2026-09-23/results\.json](../docs/test-results/project-definition-2026-09-23/results.json) |

平台：Node CLI；显式选定工程后运行。边界：本轮只核对源码与旧报告，未对日常作品运行迁移；特定旧作品维护脚本不等同通用工作流。

下一步：维护工具继续限定在显式选择工程，保持旧格式兼容与事务屏障。

<a id="storage.application-isolation"></a>
### 程序/工程/本机数据隔离

`storage.application-isolation` · 宿主与存储 · 源码交付

入口：appStoragePaths、workspace layout、宿主 app_data_dir/app_config_dir

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 本机服务与适配 | **app-storage\.mjs / paths\.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/project-templates/results\.json](../docs/test-results/project-templates/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 工程定义与格式 | **workspace-layout\.json**；声明式工程类型/模板或格式；不等于可执行脚本插件。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/project-templates/results\.json](../docs/test-results/project-templates/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 存储与事务 | **workspace\.rs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/project-templates/results\.json](../docs/test-results/project-templates/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| Android 宿主 | **mobile\_storage\.rs**；Android请求/存储/迁移适配；只覆盖已声明移动子集。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/project-templates/results\.json](../docs/test-results/project-templates/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |

平台：桌面应用目录及Node本机服务、Android应用私有工程／本机设置／恢复草稿。边界：v4 仍未实现，不能把 World 投影当作权威新格式；Android 私有目录；卸载或清除数据会删除作品。

下一步：构建会话跨重启的派生物清理和归属发现仍待接入。

<a id="host.android-editing"></a>
### Android 无 Node 编辑宿主

`host.android-editing` · 宿主与存储 · 源码交付

入口：mobile/library.js → 编辑器 → mobile/platform.mjs → mobile_storage

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| Android 宿主 | **library\.js / editor\.js 等**；Android请求/存储/迁移适配；只覆盖已声明移动子集。 | 4 / 4 / 3 / 3 | [docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json)、[docs/test-results/project-templates/results\.json](../docs/test-results/project-templates/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json) |

平台：Android源码；旧模拟器证据限定当时版本、真机与新增模板入口待验收。边界：0.0.6 起始模板仅浏览器/真实存储联调，新 APK 未构建；World、媒体访问/管理、配置界面、资源包、场景/构建工作台均未接入；单文本1 MiB、每工程最多20000文档；实体手机待测。

下一步：按能力逐条接入媒体／World，补新模板的设备验收。

<a id="host.android-draft-recovery"></a>
### Android 草稿和新建恢复

`host.android-draft-recovery` · 宿主与存储 · 源码交付

入口：编辑变更/pagehide/visibility → 本机草稿存储 → 重开恢复；新建文档 → .viento/mobile-create 恢复意图

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| Android 宿主 | **drafts\.mjs / editor\.js 等**；Android请求/存储/迁移适配；只覆盖已声明移动子集。 | 4 / 4 / 3 / 3 | [docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/mobile-drafts\.test\.mjs](../scripts/tests/mobile-drafts.test.mjs) |

平台：Android源码；旧模拟器证据限定当时版本、真机与新增模板入口待验收。边界：恢复副本不是备份；低内存回收、输入法组合字、设备供应商差异待验收。

下一步：补更多真机/WebView生命周期和输入法恢复组合。

<a id="host.android-transfer"></a>
### Android SAF 完整工程迁移

`host.android-transfer` · 宿主与存储 · 源码交付

入口：作品库 → 系统文件选择器 → 导入/导出完整包

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| Android 宿主 | **mobile\_archive\.rs / mobile\_transfer\.rs**；Android请求/存储/迁移适配；只覆盖已声明移动子集。 | 4 / 4 / 3 / 3 | [docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| Android 宿主 | **ArchiveTransferPlugin\.kt**；Kotlin插件连接Android系统文件选择器，负责SAF流传输与状态回报。 | 4 / 4 / 3 / 3 | [docs/test-results/workflow-b\.4\.5/results\.json](../docs/test-results/workflow-b.4.5/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |

平台：Android源码；旧模拟器证据限定当时版本、真机与新增模板入口待验收。边界：ZIP1 GiB、解包4 GiB、50000条目；v1需先桌面升级；第三方云盘/外置提供方、复制时进程终止/权限撤回、真机未验收；0.0.7 APK 未构建。

下一步：新数据格式必须追加SAF设备往返，区分私有草稿和工程数据。

<a id="delivery.packaging"></a>
### 源码、桌面与移动资源交付

`delivery.packaging` · 验证与交付 · 源码交付

入口：desktop:prepare/build、mobile:prepare、desktop/package-source.py、手动 CI

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 构建与分发 | **prepare\.mjs / build\.mjs 等**；开发构建/资源准备与源码归档：0\.0\.8明确两crate和四官方样例闭包、排除targets/作者数据；临时快照回读不等于最终commit压缩包或安装验收。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/rust-studio-core/results\.json](../docs/test-results/rust-studio-core/results.json) |
| 构建与分发 | **prepare\.mjs**；开发时准备移动端离线静态资源及WASM；不提供Android场景运行入口。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/rust-studio-core/results\.json](../docs/test-results/rust-studio-core/results.json) |
| 验证与维护 | **desktop\.yml / check\.yml**；开发验证与维护工具；不属于作者运行语义。 | 3 / 1 / 3 / 3 | [docs/test-results/release-0\.0\.4/results\.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/rust-studio-core/results\.json](../docs/test-results/rust-studio-core/results.json) |

平台：开发与CI构建命令；非产品浏览器功能、当前Rust组合完成源码与资源验证，未验新安装包、Linux最近安装实测0.0.4；Windows/macOS与新Android包分别待验。边界：0.0.5–0.0.8均源码交付、无新安装包；资源准备或临时sourcearchive通过不能替代安装运行验收。；Windows/macOS原生验收未完成，Android发行签名未配置；CI手动触发只生成构件，不自动GitHub Release；共享Rust与累计场景/后端功能纳入0.0.8源码；本轮源码归档修复两crate与4官方样例闭包、所有crate target/作品排除，验证快照已删除，审计文案之后的最终Git提交不另冒充同一archive。。

下一步：对含Rust核心的实际安装包做Linux及Android验收；Windows/macOS待目标机验证。

<a id="delivery.generated-cleanup"></a>
### 构建缓存与磁盘清理

`delivery.generated-cleanup` · 验证与交付 · 源码交付

入口：npm run clean -- --dry-run / npm run clean

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 构建与分发 | **clean\.mjs**；开发构建或打包资源；不等于实际安装验收。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-studio-core/results\.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/build-cleanup\.test\.mjs](../scripts/tests/build-cleanup.test.mjs) |

平台：开发者Node清理CLI；实际工程外工具链需独立管理。边界：自定义Cargo target/临时模拟器不在默认清理范围；资源包事务目录不能当缓存；已有清理工具纳入源码发布；Rust目标与WASM清理扩展已纳入0.0.7源码。

下一步：补跨会话构建产物发现与保留策略，恢复日志不作缓存。

<a id="quality.validation-support"></a>
### 契约检查、回归与证据保存

`quality.validation-support` · 验证与交付 · 源码交付

入口：npm run check -- --app-only / core:test / desktop:test / 浏览器及原生专项脚本

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 验证与维护 | **check-project\.mjs / verify-doc-api-contract\.mjs 等**；开发验证与维护工具；不属于作者运行语义。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-studio-core/results\.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/scene-selection/results\.json](../docs/test-results/scene-selection/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json) |
| 本机服务与适配 | **doc-api-contract\.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-studio-core/results\.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/scene-selection/results\.json](../docs/test-results/scene-selection/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json) |

平台：开发者CLI、自动化测试与CI配置、本地记录与CI运行结果分别取证。边界：测试总数不表示功能覆盖率；不同工具配置导致不同跳过数；当前轮次的工具、失败和跳过以bevy-backend/results.json为准；历史报告保留当时条件。；未验证的平台/尚未实现功能不能列为已测试。

下一步：每次验证记录实际工具与跳过项，持续补原生窗口／设备和大规模性能。

<a id="host.local-service"></a>
### 本机编辑/只读服务与能力边界

`host.local-service` · 宿主与存储 · 源码交付

入口：npm start / npm run browse → scripts/ops/site.mjs；GET /api/capabilities；本机请求鉴权与静态资源白名单

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 本机服务与适配 | **site\.mjs / site-launcher\.mjs 等**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/rust-studio-core/results\.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |

平台：Node CLI启动的本机浏览器编辑／只读服务、Tauri内部复用该服务；Android无Node服务。边界：不是公网托管或任意文件访问入口；只读服务不提供语义写入、工程设置、Build或导入；用户浏览器仍依赖本地服务。

下一步：继续区分浏览与编辑能力；新核心资源不得扩大文件访问范围。

<a id="scene.authoring_v1"></a>
### Scene2D v1 创建与来源保真的编辑

`scene.authoring_v1` · 场景与构建 · 源码交付

入口：构建与运行 → 编辑既有v1场景；scene.create / scene.update保留v1兼容

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-scene-create\.js**；界面状态、用户输入与结果呈现；不据此推断规则已迁Rust。 | 4 / 4 / 2 / 3 | [docs/test-results/scene-authoring/results\.json](../docs/test-results/scene-authoring/results.json)、[docs/test-results/scene-edit/results\.json](../docs/test-results/scene-edit/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 可移植 JS 语义 | **world-scene-create\.mjs / world-scene-update\.mjs 等**；共享JS契约/领域规划；纯规则与源范围编辑仍在这一层。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-authoring/results\.json](../docs/test-results/scene-authoring/results.json)、[docs/test-results/scene-edit/results\.json](../docs/test-results/scene-edit/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 存储与事务 | **world-transactions\.mjs**；作者数据修订、发布、锁或恢复；遵守现有事务边界。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-authoring/results\.json](../docs/test-results/scene-authoring/results.json)、[docs/test-results/scene-edit/results\.json](../docs/test-results/scene-edit/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |

平台：Linux本机编辑服务、新版Tauri窗口和Android未验收/未接入。边界：v1 扁平 actors 1–128 个，同一 objectId 只可出现一次；角色、图片、方向键和 idle/moving，非通用脚本/状态机；跨文件剧本原子提交尚无模型；新版界面新建默认v2；既有v1不会自动迁移，显式启用实例或逻辑分组并预览保存后才升级；增量分别见scene.instances_v2/scene.groups_v3。

下一步：保持v1冻结计划、生成器摘要与原文保真兼容；后续文本结构沿独立版本演进。

<a id="build.snapshot_plan"></a>
### 冻结输入、可移植计划与能力检查

`build.snapshot_plan` · 场景与构建 · 源码交付

入口：构建与运行 → 检查计划；scripts/project-build.mjs

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **build-plan\.mjs / project-build-contract\.mjs**；场景模型解析后按版本发射v1/v2计划DTO及能力校验；本行源码交付以旧v1为基线，v2的0\.0\.7源码范围另列独立实例。 | 4 / 4 / 3 / 3 | [docs/test-results/scene2d-build/results\.json](../docs/test-results/scene2d-build/results.json)、[docs/test-results/build-workbench/results\.json](../docs/test-results/build-workbench/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json) |
| 本机服务与适配 | **node-build-snapshot\.mjs / project-build\.mjs**；保存输入的本机冻结编排与宿主适配；新增独立只读draft捕获不得改变captureBuildSnapshot旧快照或使构建消费未保存文本。 | 4 / 4 / 3 / 3 | [docs/test-results/scene2d-build/results\.json](../docs/test-results/scene2d-build/results.json)、[docs/test-results/build-workbench/results\.json](../docs/test-results/build-workbench/results.json)、[docs/test-results/release-0\.0\.6/results\.json](../docs/test-results/release-0.0.6/results.json) |

平台：Linux本机编辑服务、新版Tauri窗口和Android未验收/未接入。边界：JSON范围、场景语义/投影继承与计划发射已分层；v1/v2作者对应plan1/2，v3逻辑组编译为plan2；来源/分组侧带信息不进入构建计划，原文仍进入冻结快照；仅 Scene2D 受限能力；尚未迁 Rust；不从任意故事正文自动推导可执行游戏；v2双身份冻结重放与v3逻辑组已纳入0.0.7源码；旧v1/v2计划、生成文件和后端摘要保持，v3仅使用现有v2运行协议；captureBuildSnapshot仍只读取保存文件且忽略未知draft选项；只读草稿捕获使用独立入口/身份域，不提供可执行快照或污染构建任务缓存。；0.0.8已交付行为另列behavior.scene_runtime：已登记v2/v3 scene显式behavior关系才组合plan/runtime3，源码/清单进入冻结原文；旧无行为计划与所有静态预览保持原版本。；0.1.3之后项目级多Scene2D组装由build.project_assembly单列：新增项目计划／成员来源／闭包适配不改变本功能既有单场景评分和历史验收。。

下一步：保留已接行为依赖与旧格式重放，完善后续层次/片段的冻结输入和来源边界。

<a id="execution.backend_middleware"></a>
### 执行后端能力、可信注册与通用编排

`execution.backend_middleware` · 场景与构建 · 源码交付

入口：engine/backend-capabilities.mjs→可信host registry/executor→Godot或Bevy adapter

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **backend-capabilities\.mjs：纯数据描述符和七操作支持检查**；严格分离冻结descriptor；七种执行操作/平台/plan schema/feature分别校验，未知数据不获权；无工具/文件/进程依赖。 | 4 / 4 / 4 / 3 | [docs/test-results/backend-middleware/results\.json](../docs/test-results/backend-middleware/results.json)、[docs/test-results/backend-middleware/packaged-resources\.json](../docs/test-results/backend-middleware/packaged-resources.json)、[docs/test-results/bevy-backend/workflow-real-initial\.log](../docs/test-results/bevy-backend/workflow-real-initial.log) |
| 本机服务与适配 | **node-execution-backends\.mjs / node-project-build\.mjs：可信注册、输出与冻结编排**；固定可信后端与生命周期；中立files/resourceFiles输出先校验再发布，冻结工具/生成物/独立executionAdapter回放；HTTP不注册或选任意代码/路径。 | 4 / 4 / 4 / 3 | [docs/test-results/backend-middleware/results\.json](../docs/test-results/backend-middleware/results.json)、[docs/test-results/backend-middleware/browser/browser\.json](../docs/test-results/backend-middleware/browser/browser.json)、[docs/test-results/backend-middleware/packaged-resources\.json](../docs/test-results/backend-middleware/packaged-resources.json) |
| 执行后端 | **godot4-adapter\.mjs：具体工具、阶段、环境与固定生成分支**；包装旧Godot v1/v2冻结生成器及新增显式行为v3分支；具体命令/环境/阶段/缓存与通用宿主隔离，四operation实装，离屏/内嵌/GPU false；legacy兼容显式声明。 | 4 / 4 / 3 / 3 | [docs/test-results/backend-middleware/results\.json](../docs/test-results/backend-middleware/results.json)、[docs/test-results/backend-middleware/browser/browser\.json](../docs/test-results/backend-middleware/browser/browser.json)、[docs/test-results/backend-middleware/packaged-resources\.json](../docs/test-results/backend-middleware/packaged-resources.json) |
| 交互与渲染 | **app-project-build\.js**；根据完整纯描述符按操作开放任务入口；descriptor/后端变化撤销旧计划和产物批准，保留dirty/会话/异步归属与三语界面。 | 4 / 4 / 3 / 3 | [docs/test-results/backend-middleware/results\.json](../docs/test-results/backend-middleware/results.json)、[docs/test-results/backend-middleware/browser/browser\.json](../docs/test-results/backend-middleware/browser/browser.json)、[docs/test-results/backend-middleware/packaged-resources\.json](../docs/test-results/backend-middleware/packaged-resources.json) |
| 执行后端 | **Bevy Rust 独立适配器：固定工具链、离线编译、诊断与临时回收**；新增可信Rust执行实现消费原七操作契约；仅plan3和无头构建，能力与旧数据实现分开。 | 3 / 3 / 3 / 2 | [docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser\.json](../docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser.json)、[docs/test-results/bevy-rust-behaviors/app-check\.log](../docs/test-results/bevy-rust-behaviors/app-check.log)、[docs/test-results/bevy-rust-behaviors/adapter-final-after-json\.log](../docs/test-results/bevy-rust-behaviors/adapter-final-after-json.log) |

平台：Linux本机编辑服务、移动打包纯能力模块不代表Android执行服务、新版Tauri窗口/新安装和设备未验收。边界：0.0.8源码执行中间层独立于作者、plan和runtime格式；精确纯数据描述符分别声明build/headlessLogic/windowPreview/windowCapture/offscreenRender/embeddedViewport/gpuCompute，未知或不支持请求失败关闭。；宿主固定可信适配器、阶段及工具；HTTP和工程文件不能提交后端代码、可执行文件或输出路径，host固定选择已注册Godot/Bevy，网页没有选择器。；通用执行器消费中立files/resourceFiles/来源/产物契约，发布前检查相对路径、碰撞、入口和预算；Godot参数、环境、文件约定和缓存保留在具体适配器。；新构建/会话增加独立executionAdapter指纹；历史backend生成器摘要与协议不改；仅显式接受legacy的已知Godot允许旧记录缺新字段，其余冻结回放检查仍执行。；Godot4产品仅Linux及四种操作；offscreenRender/embeddedViewport/gpuCompute为false。Bevy另有真实无图headless实现；替代夹具/命名空间扩展不代表Nuis/ns-nova/yalivia/GPU实现。；服务返回platform/full descriptor/job.backendId/latestBuild.backendId；UI按操作判断，描述符或后端变化撤销旧计划/产物批准。没有新安装或设备验收。；Godot descriptor0.5.0 保留显式behavior.bindings/behavior.gdscript与plan3；Bevy adapter/tool0.3.0；两者声明runtime.control-replay与runtime.control-replay.instances，全局仅无行为plan1/2有限headless，按实例仅冻结plan2；可选数据参数不增加RPC/Entity或第八种操作。；0.0.9已交付的显式工具身份检查由execution.tool_identity独立列出；GET无子进程，ready不授予执行权，实际build/run仍fresh identify及冻结工具/adapter/产物守护；本功能既有评分不因该增量提升。；0.1.2后工作树另登记org.viento.bevy-rust0.1.0：显式behavior.rust与plan／runtime3，只build／headlessLogic，不继承旧Bevy有限回放；新增适配行单独计工作树成熟度。；0.1.3之后项目级多Scene2D组装由build.project_assembly单列：新增项目计划／成员来源／闭包适配不改变本功能既有单场景评分和历史验收。。

下一步：已有Rust作者通道独立登记；继续从真实共同需求定义资源、实时生命周期及目标平台接口，保持具体引擎命令和编译环境在适配器内。

<a id="runtime.godot_generated_project"></a>
### Godot 4 工程生成与运行协议

`runtime.godot_generated_project` · 场景与构建 · 源码交付

入口：buildProject/runProjectBuild → generateGodotProject → fixed Godot scene/runtime

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 执行后端 | **godot4\.mjs / runtime\.gd**；冻结v1具体执行后端，原始生成器/脚本字节和后端摘要保留；v2由独立i104适配，作者数据权威不变。 | 4 / 4 / 3 / 3 | [docs/test-results/scene2d-build/results\.json](../docs/test-results/scene2d-build/results.json)、[docs/test-results/scene2d-build/window-session\.json](../docs/test-results/scene2d-build/window-session.json)、[docs/test-results/build-workbench/results\.json](../docs/test-results/build-workbench/results.json) |
| 本机服务与适配 | **node-project-build\.mjs**；通用executor按可信registry固定后端；执行相应plan/protocol并校验冻结输出，具体Godot命令/环境/文件名已从本模块移出；新增中间层交付另列。 | 4 / 4 / 3 / 3 | [docs/test-results/scene2d-build/results\.json](../docs/test-results/scene2d-build/results.json)、[docs/test-results/scene2d-build/window-session\.json](../docs/test-results/scene2d-build/window-session.json)、[docs/test-results/build-workbench/results\.json](../docs/test-results/build-workbench/results.json) |
| 执行后端 | **godot4-dispatch\.mjs / godot4-instances\.mjs / runtime-v2\.gd**；0\.0\.7源码交付的v2运行分支；v1仍由i074冻结生成器负责，版本选择及双身份事件不改变作者定义。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/runtime-review-tests\.log](../docs/test-results/scene-instances/runtime-review-tests.log)、[docs/test-results/scene-instances/packaged-resources\.json](../docs/test-results/scene-instances/packaged-resources.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |

平台：Linux本机编辑服务、新版Tauri窗口和Android未验收/未接入。边界：仅 Linux 启用；产物为需要 Godot 的工程，非独立发行程序；旧runtime.gd保持固定；当前显式GDScript Node参数/信号绑定另列behavior.scene_runtime，不支持任意方法RPC或热重载。；无嵌入视口/GPU 计算/物理/音频行为；v1与v2生成器/运行脚本字节冻结；v3作者逻辑组编译为既有plan2，运行层不接收groupId或组结构；实例/定义双身份继续沿用v2；0.0.8已交付中间层包装原冻结分支，新增executionAdapter指纹独立于历史生成器摘要；Godot参数/环境/缓存留在后端，第二Bevy实现只消费无图plan1/2，Godot原范围保留。。

下一步：保持旧v1/v2生成分支兼容；明确行为分支的作者契约与证据另列behavior.scene_runtime。

<a id="build.workbench_lifecycle"></a>
### 构建工作台、诊断、取消与进程回收

`build.workbench_lifecycle` · 场景与构建 · 源码交付

入口：web/modules/app-project-build.js → local build API → createProjectBuildService

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-project-build\.js**；界面状态、用户输入与结果呈现；按纯描述符分别判断操作并核对任务/产物后端身份，变更撤销旧批准；新增中间层交付另列。 | 4 / 4 / 2 / 3 | [docs/test-results/build-workbench/results\.json](../docs/test-results/build-workbench/results.json)、[docs/test-results/build-workbench/browser\.json](../docs/test-results/build-workbench/browser.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **project-build-service\.mjs / build-process\.mjs 等**；本机服务编排/生命周期，固定host选择的可信backend并返回平台/descriptor和任务/产物后端身份；HTTP不给实现/路径权限。 | 4 / 4 / 3 / 3 | [docs/test-results/build-workbench/results\.json](../docs/test-results/build-workbench/results.json)、[docs/test-results/build-workbench/browser\.json](../docs/test-results/build-workbench/browser.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |

平台：Linux本机编辑服务、新版Tauri窗口和Android未验收/未接入。边界：仅 Linux 本机编辑服务；只读浏览/Android 无入口；单服务单任务；任务身份只属于当前服务会话；SIGKILL/断电恢复及跨重启任务发现未实现；本会话仅保留最近三份自建输出，不自动删以前会话/CLI 产物；已交付界面按完整descriptor分别判断模式；描述符或backend身份变化撤销旧计划/产物批准，不新增第二引擎选择器。。

下一步：补跨重启任务与崩溃残留发现，目标系统分别验收。

<a id="scene.saved_preview"></a>
### 无需引擎的已保存场景预览

`scene.saved_preview` · 场景与构建 · 源码交付

入口：构建与运行 → 场景预览 → POST /api/scene-preview

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-scene-preview\.js / app-scene-preview-canvas\.js**；保存态和草稿预览在同视图显式分支；保存态入口仍只看磁盘，草稿只读能力单列scene\.text\_draft\_preview。 | 4 / 4 / 2 / 3 | [docs/test-results/scene-preview/results\.json](../docs/test-results/scene-preview/results.json)、[docs/test-results/scene-preview/browser\.json](../docs/test-results/scene-preview/browser.json)、[docs/test-results/scene-source-model/results\.json](../docs/test-results/scene-source-model/results.json) |
| 可移植 JS 语义 | **scene-preview-contract\.mjs**；既有保存态预览路径的共享JS传输契约；新增草稿源预算另列scene\.text\_draft\_preview源码评分，不据此推断语义已迁Rust。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-preview/results\.json](../docs/test-results/scene-preview/results.json)、[docs/test-results/scene-preview/browser\.json](../docs/test-results/scene-preview/browser.json)、[docs/test-results/scene-draft-preview/backend\.log](../docs/test-results/scene-draft-preview/backend.log) |
| 本机服务与适配 | **scene-preview-service\.mjs**；本机保存态预览保持资源冻结/释放及取消边界；新增只读draft分派与无sceneEditing限制另列scene\.text\_draft\_preview源码评分。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-preview/results\.json](../docs/test-results/scene-preview/results.json)、[docs/test-results/scene-preview/browser\.json](../docs/test-results/scene-preview/browser.json)、[docs/test-results/scene-source-model/results\.json](../docs/test-results/scene-source-model/results.json) |

平台：Linux本机编辑服务、新版Tauri窗口和Android未验收/未接入。边界：静态保存态，不推进运行输入/状态机；字体/SVG 不保证和 Godot 像素一致；Linux 本机编辑服务入口，Android 未接入；缓存保留两份/128 MiB/十分钟；这不是大型场景性能验收；0.0.7按v2实例选择与定位，共享定义/图片不合并实例；具体交付见scene.instances_v2；v3逻辑分组通过独立sceneStructure侧带进入共享大纲；树与查询不改变plan2演员顺序或静态画布渲染；当前原文草稿是独立的scene.text_draft_preview源码能力；保存态刷新、图形布局和可执行构建不隐式消费未保存文本。；0.0.8已交付配方保存态/当前原文只读预览另列scene.composition；独立预览观察不成为原Scene2D可执行快照。；静态预览仅geometry，不校验或执行行为清单；保存态behavior错误仍可得到有效预览，不视为可构建证明。。

下一步：在分组与搜索基础上验证更大场景的导航和按需资源加载，空间变换与可复用片段单独定义。

<a id="scene.layout_draft"></a>
### 布局草稿、多选与显式事务保存

`scene.layout_draft` · 场景与构建 · 源码交付

入口：场景预览 → 编辑场景布局 → 预览布局修改 → 保存布局

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-scene-layout\.js / app-scene-preview-canvas\.js**；选择、拖拽预览、坐标输入与渲染；只接受保存态sceneEditing，草稿预览无图形写入入口。关闭/初始化失败释放会话，Rust提供保存状态，JS校验回执并执行I/O。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-layout/results\.json](../docs/test-results/scene-layout/results.json)、[docs/test-results/scene-selection/results\.json](../docs/test-results/scene-selection/results.json)、[docs/test-results/rust-studio-core/results\.json](../docs/test-results/rust-studio-core/results.json) |
| 可移植 JS 语义 | **scene-layout\.mjs / world-scene-update\.mjs：作者源适配与保存命令**；作者源适配和scene\.update命令规划；从Rust快照读位置/dirty，保留源文本、继承/null与修订；没有JS历史栈。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-layout/results\.json](../docs/test-results/scene-layout/results.json)、[docs/test-results/scene-selection/results\.json](../docs/test-results/scene-selection/results.json)、[docs/test-results/rust-studio-core/results\.json](../docs/test-results/rust-studio-core/results.json) |
| 共享 Rust 核心 | **Cargo\.toml / lib\.rs 等**；布局编辑复用Rust几何与批次校验；同功能的权威位置/历史另绑定i095，作者源留在JS适配器，保存状态由独立Rust工作流提供，回执正文仍由JS校验。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-studio-core/results\.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/rust-studio-core/rust-core\.log](../docs/test-results/rust-studio-core/rust-core.log)、[docs/test-results/rust-layout-history/results\.json](../docs/test-results/rust-layout-history/results.json) |
| 共享 Rust 核心 | **layout\_draft\.rs：权威位置与有界历史**；布局界面与JS作者源适配共同消费Rust权威位置/dirty/撤销重做；生命周期结束close释放，不在JS保留第二份历史。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-layout-history/results\.json](../docs/test-results/rust-layout-history/results.json)、[docs/test-results/rust-layout-history/selection-browser/browser\.json](../docs/test-results/rust-layout-history/selection-browser/browser.json)、[docs/test-results/rust-layout-history/layout-browser/browser\.json](../docs/test-results/rust-layout-history/layout-browser/browser.json) |
| 共享 Rust 核心 | **layout\_save\.rs：保存阶段、错误分类与请求令牌**；位置草稿共享Rust保存状态机；非editable阶段拒绝原生位置变更与历史操作，实际变更失效审阅。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-layout-save/results\.json](../docs/test-results/rust-layout-save/results.json)、[docs/test-results/rust-layout-save/layout-browser/browser\.json](../docs/test-results/rust-layout-save/layout-browser/browser.json)、[docs/test-results/rust-layout-save/selection-browser/browser\.json](../docs/test-results/rust-layout-save/selection-browser/browser.json) |

平台：Linux本机编辑服务、新版Tauri窗口和Android未验收/未接入。边界：布局草稿仅改现有角色position；v3逻辑组的后代多选另见scene.groups_v3，无空间父子变换/框选/旋转/缩放/分布；Rust持有初始/当前位置和100步撤销重做；32个会话、每会话1–128角色，关闭释放；仅内存非崩溃恢复；JS镜像Rust位置与保存快照；作者源适配、scene.update组装、回执正文/摘要及只读核对I/O仍在JS；界面保留选择、拖拽预览、未提交坐标输入、关闭保护和渲染；不是全Rust编辑器；已纳入0.0.7源码；新安装包/Tauri窗口/Android未验收；v2实例键由JS映射到既有Rust布局协议的opaque objectId；作者objectId仍指向定义，该几何操作域不解释完整场景；受限源码检查另列scene.source_layout；草稿预览仍不授予sceneEditing或World布局保存；当前源码草稿的本地坐标应用另列scene.source_layout，保存态事务仍要求先结束文本草稿。。

下一步：保留逻辑分组作者结构与稳定实例键，继续明确复用片段的几何编辑写回；原生安装与目标设备另验。

<a id="core.layout_rust"></a>
### 共享 Rust 布局规则与原子位置校验

`core.layout_rust` · 共享核心 · 源码交付

入口：protocolVersion 1: move / align / validateBatch

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **Cargo\.toml / lib\.rs 等**；move/align/validateBatch纯几何协议；草稿状态由独立LayoutDraft消费，文件I/O与渲染在宿主。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-studio-core/results\.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/rust-studio-core/rust-core\.log](../docs/test-results/rust-studio-core/rust-core.log)、[docs/test-results/rust-layout-history/results\.json](../docs/test-results/rust-layout-history/results.json) |

平台：Rust原生测试与桌面浏览器WASM、移动资源准备不等于功能接入/设备验收。边界：本项限定确定性几何和位置批次校验；权威草稿/撤销历史另见core.history_migration；不含解析器/World/作者I/O/渲染；保存阶段由独立Rust工作流负责，回执正文校验仍在宿主；原生CLI测试不等于生产编辑器已改用原生进程；无Tauri/Godot/DOM依赖；用户脚本系统是另一层。

下一步：维持原几何、草稿和保存协议兼容；源码结构检查与补丁另列scene.source_layout，完整来源/字段语义按契约迁移，不引入渲染和文件I/O。

<a id="core.wasm_bridge"></a>
### Rust 核心 WASM 接入与分发资源

`core.wasm_bridge` · 共享核心 · 源码交付

入口：app-studio-core.js / node-studio-core.mjs → initializeStudioCore → synchronous dispatchStudioCore / dispatchStudioCoreDraft / dispatchStudioCoreSave / dispatchStudioCoreSource

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **wasm\.rs**；原生/WASM共有分派与拥有缓冲；一次input只能run一次，另有可选source能力版本导出，旧核心不伪装支持新操作。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-studio-core/results\.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/rust-studio-core/packaged-sources\.json](../docs/test-results/rust-studio-core/packaged-sources.json)、[docs/test-results/rust-studio-core/source-archive\.log](../docs/test-results/rust-studio-core/source-archive.log) |
| 可移植 JS 语义 | **studio-core\.mjs**；显式注入字节的同步桥，分别验证几何/草稿/保存/source域与响应；source有界正文由Rust检查和补丁，无JS规则回退。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-studio-core/results\.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/rust-studio-core/packaged-sources\.json](../docs/test-results/rust-studio-core/packaged-sources.json)、[docs/test-results/rust-studio-core/source-archive\.log](../docs/test-results/rust-studio-core/source-archive.log) |
| 交互与渲染 | **app-studio-core\.js**；浏览器受限加载WASM并注入纯桥接器；只处理超时/体积/加载失败，不含草稿或绘制规则。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-studio-core/results\.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/rust-studio-core/packaged-sources\.json](../docs/test-results/rust-studio-core/packaged-sources.json)、[docs/test-results/rust-studio-core/source-archive\.log](../docs/test-results/rust-studio-core/source-archive.log) |
| 本机服务与适配 | **node-studio-core\.mjs**；本机服务编排及宿主适配；领域计算与持久化按对应模块分工。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-studio-core/results\.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/rust-studio-core/packaged-sources\.json](../docs/test-results/rust-studio-core/packaged-sources.json)、[docs/test-results/rust-studio-core/source-archive\.log](../docs/test-results/rust-studio-core/source-archive.log) |
| 构建与分发 | **build-studio-core\.mjs / prepare\.mjs 等**；开发构建或打包资源；不等于实际安装验收。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-studio-core/results\.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/rust-studio-core/packaged-sources\.json](../docs/test-results/rust-studio-core/packaged-sources.json)、[docs/test-results/rust-studio-core/source-archive\.log](../docs/test-results/rust-studio-core/source-archive.log) |
| 构建与分发 | **prepare\.mjs**；开发时准备移动端离线静态资源及WASM；不提供Android场景运行入口。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-studio-core/results\.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/rust-studio-core/packaged-sources\.json](../docs/test-results/rust-studio-core/packaged-sources.json)、[docs/test-results/rust-studio-core/source-archive\.log](../docs/test-results/rust-studio-core/source-archive.log) |
| 共享 Rust 核心 | **Cargo\.toml / lib\.rs 等**；同一protocolVersion 1分派旧几何/草稿/保存和新增stateless source操作；source检查与补丁不创建或改变草稿registry。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-studio-core/results\.json](../docs/test-results/rust-studio-core/results.json)、[docs/test-results/rust-studio-core/rust-core\.log](../docs/test-results/rust-studio-core/rust-core.log)、[docs/test-results/rust-layout-history/results\.json](../docs/test-results/rust-layout-history/results.json) |
| 共享 Rust 核心 | **layout\_draft\.rs：权威位置与有界历史**；每个WASM实例/原生线程持有有界草稿registry；请求返回位置快照与状态，历史留在核心，close释放槽位。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-layout-history/results\.json](../docs/test-results/rust-layout-history/results.json)、[docs/test-results/rust-layout-history/selection-browser/browser\.json](../docs/test-results/rust-layout-history/selection-browser/browser.json)、[docs/test-results/rust-layout-history/layout-browser/browser\.json](../docs/test-results/rust-layout-history/layout-browser/browser.json) |
| 共享 Rust 核心 | **layout\_save\.rs：保存阶段、错误分类与请求令牌**；layoutSave协议与layoutDraft共享会话，无第二套registry；每次完成匹配当前阶段和请求令牌。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-layout-save/results\.json](../docs/test-results/rust-layout-save/results.json)、[docs/test-results/rust-layout-save/layout-browser/browser\.json](../docs/test-results/rust-layout-save/layout-browser/browser.json)、[docs/test-results/rust-layout-save/selection-browser/browser\.json](../docs/test-results/rust-layout-save/selection-browser/browser.json) |
| 共享 Rust 核心 | **scene\_source\.rs：无状态严格JSON与精确坐标token补丁**；sceneSource\.inspect/patch独立操作域，原生/WASM运行同一有界源码规则；能力标志隔离旧核心，旧布局协议与源操作互不授权。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-scene-source/results\.json](../docs/test-results/rust-scene-source/results.json)、[docs/test-results/rust-scene-source/packaged-resources\.json](../docs/test-results/rust-scene-source/packaged-resources.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |

平台：Rust原生测试与桌面浏览器WASM、移动资源准备不等于功能接入/设备验收。边界：WASM承载几何、有界位置草稿、保存工作流及独立的stateless源码检查/补丁；每份input仅run一次，草稿/请求双身份拒绝完成重放。；JS严格校验各操作域及返回结构，拒绝跨域调用；布局历史不经JS往返，source操作单独接收有界正文并返回精确候选，不持有来源或保存权限。；缺失或损坏核心保留静态预览；可选viento_core_scene_source_version()===1声明源码能力，旧核心保留旧布局功能但拒绝新source操作；没有JS几何/历史/源码补丁回退。；打包准备通过不等于Android场景功能或新Tauri安装验收；源码开发需Rust/wasm目标，运行成品不需Rust工具链。

下一步：补当前保存工作流对应的真实Tauri安装包与目标WebView验证；移动场景功能仍独立推进。

<a id="behavior.gdscript_binding"></a>
### GDScript 行为绑定历史探针

`behavior.gdscript_binding` · 运行后端与演进 · 独立原型

入口：node docs/test-results/behavior-binding/run.mjs

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 执行后端 | **run\.mjs / probe\.gd 等**；历史独立GDScript探针；不承担当前作者协议或其构建/迁移验证。 | 2 / 3 / 2 / 1 | [docs/test-results/behavior-binding/results\.json](../docs/test-results/behavior-binding/results.json)、[docs/test-results/behavior-binding/probe\.gd](../docs/test-results/behavior-binding/probe.gd) |

平台：Linux独立Godot探针。边界：仅2026-10-03独立探针，未验证产品快照/包迁移/UI；历史结果原字节保留。；该探针的实验身份/方法调用不是持久作者协议，也未覆盖热重载或大量对象。；当前产品受限绑定使用独立behavior.scene_runtime实现与新证据，不提升本探针成熟度。。

下一步：保留选型证据；当前作者链路参见behavior.scene_runtime，不用旧探针代替新产品验收。

<a id="scene.text_instances"></a>
### 文本驱动场景、定义/实例分离与场景树

`scene.text_instances` · 运行后端与演进 · 规划中

入口：开发路线：文本层次、复用片段与剧本事件（非现有产品入口）

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **文本层次、复用片段、剧本事件与场景树（未实现）**；完整文本场景系统的规划占位；稳定实例、逻辑分组和单源只读预览已另列源码切片，嵌套/跨文件片段、剧本事件、共享可写草稿和跨文件原子提交仍未实现。 | 1 / 0 / — / 0 | [docs/test-results/scene-draft-preview/results\.json](../docs/test-results/scene-draft-preview/results.json)、[docs/ROADMAP\.md](../docs/ROADMAP.md)、[docs/NEXT\_ARCHITECTURE\.zh-CN\.md](../docs/NEXT_ARCHITECTURE.zh-CN.md) |

平台：规划未接入产品。边界：Scene2D v2稳定实例和v3持久逻辑分组已分别形成scene.instances_v2与scene.groups_v3切片，不代表完整文本场景系统完成；actors仍为1–128个实例；逻辑组不改变坐标或绘制顺序，空间父子变换、剧本事件和跨文件原子提交仍未实现；单文件片段展开另列实验scene.composition；分组树与查询不等于大规模场景性能验收，也没有自动迁移旧作品；单场景原文草稿预览与坐标回写、配方六字段覆盖及恢复、共享片段字段与结构、放置、组织组和片段定义管理已有独立功能切片；scene.composition_materialize可把保存态配方生成独立运行场景。这里的规划缺口是空间父子变换、统一历史、剧本事件及嵌套／跨文件提交，不能将已实现子能力重复列为未接入。。

下一步：沿已实现实例／分组及配方创作分别推进空间层次、跨视图历史、剧本事件和跨文件事务；现有组织分组不会隐式施加空间变换。

<a id="runtime.bevy_rust"></a>
### Bevy/Rust 无头第二后端

`runtime.bevy_rust` · 运行后端与演进 · 源码交付

入口：已登记无图Scene2D→显式CLI或host选择→冻结构建→可信Bevy ECS程序→事件与离线回放

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 执行后端 | **viento-bevy-runtime：锁定Bevy的可信无头ECS程序**；预编译可信Bevy程序检查数据并用真实ECS移动/状态，两个实例保留定义配对；无作者Rust编译或渲染能力。 | 4 / 4 / 3 / 3 | [docs/test-results/bevy-backend/runtime-proof\.json](../docs/test-results/bevy-backend/runtime-proof.json)、[docs/test-results/bevy-backend/adapter-real-final\.log](../docs/test-results/bevy-backend/adapter-real-final.log)、[docs/test-results/bevy-backend/workflow-real-initial\.log](../docs/test-results/bevy-backend/workflow-real-initial.log) |
| 可移植 JS 语义 | **scene-runtime-events\.mjs：中立Scene2D身份与生命周期准入**；中立runtime1/2身份/完整集合/数值/状态/生命周期校验，无引擎或宿主依赖。 | 4 / 4 / 4 / 3 | [docs/test-results/bevy-backend/adapter-real-final\.log](../docs/test-results/bevy-backend/adapter-real-final.log)、[docs/test-results/bevy-backend/workflow-real-initial\.log](../docs/test-results/bevy-backend/workflow-real-initial.log)、[docs/test-results/bevy-backend/packaged-resources\.json](../docs/test-results/bevy-backend/packaged-resources.json) |
| 执行后端 | **bevy-adapter\.mjs / bevy-project\.mjs：工具、阶段与数据产物**；Bevy精确工具识别、noimage准入、数据工程生成与scene-check/headless阶段，不导入Godot模块。 | 4 / 4 / 3 / 3 | [docs/test-results/bevy-backend/adapter-real-final\.log](../docs/test-results/bevy-backend/adapter-real-final.log)、[docs/test-results/bevy-backend/workflow-real-initial\.log](../docs/test-results/bevy-backend/workflow-real-initial.log)、[docs/test-results/bevy-backend/packaged-resources\.json](../docs/test-results/bevy-backend/packaged-resources.json) |
| 本机服务与适配 | **node-execution-tool\.mjs / project-build\.mjs：可信host和CLI后端选择**；CLI显式backend/tool和host环境固定选择，沿用通用冻结executor；HTTP不选择可执行代码或路径。 | 4 / 4 / 4 / 3 | [docs/test-results/bevy-backend/workflow-real-initial\.log](../docs/test-results/bevy-backend/workflow-real-initial.log)、[docs/test-results/bevy-backend/packaged-resources\.json](../docs/test-results/bevy-backend/packaged-resources.json)、[docs/test-results/bevy-backend/results\.json](../docs/test-results/bevy-backend/results.json) |
| 交互与渲染 | **app-project-build\.js**；复用构建工作台观察host固定的Bevy，按descriptor开放plan/build/headless并禁window；三语/390px/dirty/caret保持，没有引擎选择下拉框。 | 4 / 4 / 3 / 3 | [docs/test-results/bevy-backend/browser/browser\.json](../docs/test-results/bevy-backend/browser/browser.json)、[docs/test-results/bevy-backend/packaged-resources\.json](../docs/test-results/bevy-backend/packaged-resources.json)、[docs/test-results/bevy-backend/results\.json](../docs/test-results/bevy-backend/results.json) |

平台：Linux可信本机CLI/编辑服务；源码与新安装验收分开、Android仅portable事件规则，无执行器/UI。边界：0.0.8源码交付；org.viento.bevy adapter/runtime0.3.0锁Bevy0.19.1；Linux plan/runtime1/2，仅build/headlessLogic，以及scene2d/input.arrows/state.movement/runtime.control-replay/runtime.control-replay.instances。旧0.1.0/0.2.0工具和记录需按精确身份重新构建。；同定义双实例保留instanceId/objectId配对；受控固定步方向输入只移动arrows实例，无实体键盘/图片/窗口或GPU验收。 按实例schema2仅冻结plan2，每步未列实例释放；完整trace仍返回全体演员。；Rust运行程序是独立可信本机工具，作者工程只生成scene-data.json；不动态运行Cargo或编译作者Rust源码。；中立事件模块无Node/DOM/Godot/Bevy imports；原Godot5文件保持字节，适配器各自负责命令/生成布局/工具身份。；host环境固定单backend，CLI可显式backend/tool；HTTP不接新代码/路径，原界面无引擎选择器；desktop资源带adapter但不带Bevybin，Android不带执行器。；不承诺作者Rust/GDScript跨语言互译；无BRP/反射/RPC/热更新/任意状态机/新安装包。。

下一步：该旧数据通道保持无行为计划与有限控制；作者源码另见独立behavior.bevy_rust，不要求把数据运行程序升级成编译器。连续实时采样、资源、图片／窗口与规模继续分别验收。

<a id="runtime.native_nuis"></a>
### Nuislang/ns-nova/yalivia 原生执行

`runtime.native_nuis` · 运行后端与演进 · 规划中

入口：ADR 0008 与长期架构（非产品入口）

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 执行后端 | **Nuislang/ns-nova/yalivia 原生执行（未实现）**；规划占位，尚无生产实现；无Nuis构建执行、ns-nova/yalivia接入 | 1 / 0 / — / 0 | [docs/adr/0008-native-nuis-and-bootstrap-runtime\.md](../docs/adr/0008-native-nuis-and-bootstrap-runtime.md)、[docs/NEXT\_ARCHITECTURE\.zh-CN\.md](../docs/NEXT_ARCHITECTURE.zh-CN.md)、[docs/ROADMAP\.md](../docs/ROADMAP.md) |

平台：规划未接入产品。边界：无Nuis构建执行、ns-nova/yalivia接入；当前开发不以Nuislang就绪为前置；不可将项目内共享Rust算法称作ns-nova引擎接入；已实现描述符和host中间层只是接入起点；命名空间native extension身份/版本不代表原生代码或GPU可执行。。

下一步：等待原生公开契约并做最小适配器；不阻塞近期场景与行为。

<a id="studio.native_gui_gpu"></a>
### ns-nova GUI 与异构 GPU 扩展

`studio.native_gui_gpu` · 运行后端与演进 · 规划中

入口：长期架构与路线（非产品入口）

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 执行后端 | **ns-nova GUI 与异构 GPU 扩展（未实现）**；规划占位，尚无生产实现；当前GUI仍Web/Canvas/Tauri | 1 / 0 / — / 0 | [docs/adr/0008-native-nuis-and-bootstrap-runtime\.md](../docs/adr/0008-native-nuis-and-bootstrap-runtime.md)、[docs/NEXT\_ARCHITECTURE\.zh-CN\.md](../docs/NEXT_ARCHITECTURE.zh-CN.md)、[docs/ROADMAP\.md](../docs/ROADMAP.md) |

平台：规划未接入产品。边界：当前GUI仍Web/Canvas/Tauri；无GPU计算/共享资源/嵌入运行视口；Godot GPU渲染不等于Viento拥有原生异构计算接口。

下一步：先明确GUI宿主与计算/资源扩展边界，再做可替换视图验证。

<a id="build.standalone_distribution"></a>
### 独立游戏发行产物

`build.standalone_distribution` · 运行后端与演进 · 规划中

入口：路线：独立发行产物（非产品入口）

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 执行后端 | **独立游戏发行产物（未实现）**；规划占位，尚无生产实现；生成Godot工程不是独立游戏可执行文件 | 1 / 0 / — / 0 | [docs/ROADMAP\.md](../docs/ROADMAP.md)、[docs/PROJECT\_BUILD\.md](../docs/PROJECT_BUILD.md) |

平台：规划未接入产品。边界：生成Godot工程不是独立游戏可执行文件；作品资源包/完整迁移包不是游戏发行；无目标平台导出和独立运行验收。

下一步：增加目标平台导出预设和模板，实测无Godot环境下的产物。

<a id="core.history_migration"></a>
### Rust布局草稿、原子批次与撤销历史

`core.history_migration` · 共享核心 · 源码交付

入口：protocolVersion 1: layoutDraft.create / setPositions / undo / redo / reset / read / close

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **layout\_draft\.rs：权威位置与有界历史**；权威位置与100步撤销重做；32个有界会话、原子校验、no-op保留redo、基线dirty、reset与显式close；不含保存回执/未知结果判定。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-layout-history/results\.json](../docs/test-results/rust-layout-history/results.json)、[docs/test-results/rust-layout-history/selection-browser/browser\.json](../docs/test-results/rust-layout-history/selection-browser/browser.json)、[docs/test-results/rust-layout-history/layout-browser/browser\.json](../docs/test-results/rust-layout-history/layout-browser/browser.json) |
| 可移植 JS 语义 | **scene-layout\.mjs / world-scene-update\.mjs：作者源适配与保存命令**；把作者声明适配为Rust草稿，镜像返回位置/状态并显式dispose；源文本、候选scene\.update与回读校验仍在JS。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-layout-history/results\.json](../docs/test-results/rust-layout-history/results.json)、[docs/test-results/rust-layout-history/selection-browser/browser\.json](../docs/test-results/rust-layout-history/selection-browser/browser.json)、[docs/test-results/rust-layout-history/layout-browser/browser\.json](../docs/test-results/rust-layout-history/layout-browser/browser.json) |
| 交互与渲染 | **app-scene-layout\.js / app-scene-preview-canvas\.js**；界面调用Rust历史并显示状态，管理输入/选择/渲染；正常关闭、初始化失败和外部dialog关闭均释放会话。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-layout-history/results\.json](../docs/test-results/rust-layout-history/results.json)、[docs/test-results/rust-layout-history/selection-browser/browser\.json](../docs/test-results/rust-layout-history/selection-browser/browser.json)、[docs/test-results/rust-layout-history/layout-browser/browser\.json](../docs/test-results/rust-layout-history/layout-browser/browser.json) |

平台：Rust原生库/JSON-lines CLI与桌面浏览器WASM、移动资源准备不等于场景功能接入或设备验收。边界：独立LayoutDraft持有权威初始/当前位置、dirty和100步批次撤销重做；不包含作者文本或资源；原生线程/WASM实例各自最多32会话；每会话1–128角色、非空且最多128 UTF-8 bytes的ID；单调u64句柄不复用；无效批次与no-op不改变位置或清除redo；历史截断后仍与最初基线比较dirty；reset清除两个历史方向；JS适配器保留作者源并构造scene.update；保存阶段和错误分类已接独立Rust工作流，回执内容/摘要验证仍在JS；会话仅内存，close或模块销毁释放；不提供跨重启历史，也不改变当前Scene2D格式和actor数量限制；原生与WASM共享实现，产品浏览器走WASM；新版Tauri安装包和Android未验收。

下一步：稳定实例与逻辑分组的后代选择复用opaque key和现有批次历史；片段/空间层级及原生GUI与设备接入单独验收。

<a id="core.save_state_migration"></a>
### Rust布局检查、保存与未知结果工作流

`core.save_state_migration` · 共享核心 · 源码交付

入口：protocolVersion 1: layoutSave.read / invalidate / begin / resolve / refreshed

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **layout\_save\.rs：保存阶段、错误分类与请求令牌**；Rust独立保存状态机：begin门禁、检查/保存/核对、错误分类、请求归属、刷新终态；随草稿释放。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-layout-save/results\.json](../docs/test-results/rust-layout-save/results.json)、[docs/test-results/rust-layout-save/layout-browser/browser\.json](../docs/test-results/rust-layout-save/layout-browser/browser.json)、[docs/test-results/rust-layout-save/selection-browser/browser\.json](../docs/test-results/rust-layout-save/selection-browser/browser.json) |
| 可移植 JS 语义 | **scene-layout\.mjs / world-scene-update\.mjs：作者源适配与保存命令**；源适配器缓存Rust保存快照；生成已审阅请求，保留作者源和修订，显式释放。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-layout-save/results\.json](../docs/test-results/rust-layout-save/results.json)、[docs/test-results/rust-layout-save/layout-browser/browser\.json](../docs/test-results/rust-layout-save/layout-browser/browser.json)、[docs/test-results/rust-layout-save/selection-browser/browser\.json](../docs/test-results/rust-layout-save/selection-browser/browser.json) |
| 交互与渲染 | **app-scene-layout\.js / app-scene-preview-canvas\.js**；输入与提示消费Rust状态，宿主执行HTTP/摘要/回读；每次await及finally检查异步归属，迟到响应无权解锁新操作。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-layout-save/results\.json](../docs/test-results/rust-layout-save/results.json)、[docs/test-results/rust-layout-save/layout-browser/browser\.json](../docs/test-results/rust-layout-save/layout-browser/browser.json)、[docs/test-results/rust-layout-save/selection-browser/browser\.json](../docs/test-results/rust-layout-save/selection-browser/browser.json) |
| 可移植 JS 语义 | **studio-core\.mjs**；保存操作独立域分派，严格验证phase/flags/requestId信封，错误核心响应不进入业务。 | 4 / 4 / 3 / 3 | [docs/test-results/rust-layout-save/results\.json](../docs/test-results/rust-layout-save/results.json)、[docs/test-results/rust-layout-save/layout-browser/browser\.json](../docs/test-results/rust-layout-save/layout-browser/browser.json)、[docs/test-results/rust-layout-save/selection-browser/browser\.json](../docs/test-results/rust-layout-save/selection-browser/browser.json) |

平台：Rust原生库/JSON-lines CLI与Linux本机浏览器WASM、新Tauri窗口与Android未验收/未接入。边界：独立LayoutSaveWorkflow与位置草稿共享生命周期，Rust管理阶段、错误分类、请求令牌、审阅失效和重复写入门禁；关闭/重开或新请求的迟到完成不能改变当前会话；确认保存后的刷新失败仍保持已保存；原文/回执内容与摘要校验、World双读与源读取、HTTP和实际scene.update事务仍在JS宿主适配；本地令牌不是服务器幂等键；会话仅内存；没有跨重启恢复，也不迁移作者正文或持久事务到纯核心。

下一步：沿现有来源模型推进语义下沉；独立实例继续复用保存工作流，补原生安装产物与目标WebView验收。

<a id="core.semantic_migration"></a>
### 解析、字段与 World 规划下沉 Rust

`core.semantic_migration` · 共享核心 · 规划中

入口：共享Rust路线：来源模型 → 字段／投影／World规划

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **解析、字段与 World 规划下沉 Rust（未实现）**；规划占位，尚无生产实现；可移植JS接口已存在，但这些规则未迁到Rust | 1 / 0 / — / 0 | [docs/ROADMAP\.md](../docs/ROADMAP.md)、[docs/ARCHITECTURE\.md](../docs/ARCHITECTURE.md) |

平台：规划未接入产品。边界：JS来源索引、完整场景模型、投影继承及计划接口已分离；这些完整语义与World规划尚未迁Rust。源码布局所需的严格结构检查与坐标补丁已单独落地为scene.source_layout，不代表本目标完成。；不得新建与作者原文竞争的属性数据库。

下一步：在已有Rust源码检查/数值补丁上继续逐条迁移完整语义，保留源范围、BOM/换行、UUID与事务边界，并删除被替代实现。

<a id="world.mixed_changeset"></a>
### 通用混合 ChangeSet

`world.mixed_changeset` · 语义与投影 · 规划中

入口：未来统一语义事务

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **通用混合 ChangeSet（未实现）**；规划占位，尚无生产实现；当前changeset\.apply仅现有对象属性修改 | 1 / 0 / — / 0 | [docs/ROADMAP\.md](../docs/ROADMAP.md)、[docs/WORLD\_TRANSACTIONS\.md](../docs/WORLD_TRANSACTIONS.md) |

平台：规划未接入产品。边界：当前changeset.apply仅现有对象属性修改；创建、关系、资源绑定不能混为一个通用批次。

下一步：先定义混合动作的提交／回滚、预览和读取屏障。

<a id="behavior.csharp_deferred"></a>
### C# 行为后端（暂缓）

`behavior.csharp_deferred` · 运行后端与演进 · 暂缓

入口：近期优先GDScript与Rust，C#暂缓

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 执行后端 | **C\# 行为后端（暂缓）（未实现）**；规划占位，尚无生产实现；没有产品C\#行为适配器 | 1 / 0 / — / 0 | [docs/PROJECT\_BUILD\.md](../docs/PROJECT_BUILD.md)、[docs/ROADMAP\.md](../docs/ROADMAP.md) |

平台：规划未接入产品。边界：没有产品C#行为适配器；不新增.NET工具链作为Studio运行前提。

下一步：仅在明确需求和工具链成本可接受时重评，不列近期前置依赖。

<a id="maintenance.legacy_tools"></a>
### 旧作品专用维护脚本

`maintenance.legacy_tools` · 验证与交付 · 历史能力

入口：历史CLI工具，非通用工程创建入口

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 验证与维护 | **旧作品专用维护脚本（历史限定）**；历史维护入口，仅静态追溯；不纳入通用编辑核心。 | — / 1 / — / — | [docs/FUNCTION\_NETWORK\.md](../docs/FUNCTION_NETWORK.md)、[scripts/README\.md](../scripts/README.md) |

平台：历史Node/Python/Shell CLI；非新建通用工程入口。边界：保留历史作品专用脚本；不适用于任意新工程；本轮只核对历史目录，不声称新工作流经过运行验收。

下一步：新增通用能力应走项目定义/模板机制，历史脚本仅显式指定样例使用。

<a id="scene.source_model"></a>
### 场景来源模型与修订守护的原文定位

`scene.source_model` · 场景与构建 · 源码交付

入口：场景预览 → 对象属性 → 查看字段来源；resolveScene2DModel

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **json-source\.mjs / scene-model\.mjs / build-plan\.mjs**；严格JSON范围、场景语义与计划分层；不含文件或渲染依赖。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-source-model/results\.json](../docs/test-results/scene-source-model/results.json)、[docs/test-results/scene-source-model/packaged-resources\.json](../docs/test-results/scene-source-model/packaged-resources.json)、[docs/test-results/scene-instances/browser/browser\.json](../docs/test-results/scene-instances/browser/browser.json) |
| 交互与渲染 | **app-source-location\.js / app-runtime\.js / app-scene-preview\.js**；携带位置到真实原文编辑器；保存态读盘核对修订，草稿分支只核对当前编辑文本hash/会话并移动光标，二者都保护dirty内容与异步所有权。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-source-model/results\.json](../docs/test-results/scene-source-model/results.json)、[docs/test-results/scene-source-model/browser-verified/browser\.json](../docs/test-results/scene-source-model/browser-verified/browser.json)、[docs/test-results/scene-instances/browser/browser\.json](../docs/test-results/scene-instances/browser/browser.json) |
| 本机服务与适配 | **node-build-snapshot\.mjs / project-build\.mjs**；保存态从同一冻结观察返回来源附加信息且旧快照兼容；独立draft观察绑定草稿正文hash，二者不可混用来源与编辑前提。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-source-model/results\.json](../docs/test-results/scene-source-model/results.json)、[docs/test-results/scene-instances/browser/browser\.json](../docs/test-results/scene-instances/browser/browser.json)、[docs/test-results/scene-instances/results\.json](../docs/test-results/scene-instances/results.json) |
| 本机服务与适配 | **scene-preview-service\.mjs**；预览转发各自捕获来源；草稿成功/失败带独立修订，资源错误仍指向实际字段；保存态来源/缓存行为保持。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-source-model/results\.json](../docs/test-results/scene-source-model/results.json)、[docs/test-results/scene-source-model/browser-verified/browser\.json](../docs/test-results/scene-source-model/browser-verified/browser.json)、[docs/test-results/scene-instances/browser/browser\.json](../docs/test-results/scene-instances/browser/browser.json) |

平台：Linux本机编辑服务、新版Tauri窗口和Android未验收/未接入。边界：Scene2D v1/v2/v3来源与计划拆分仍在可移植JS；v3逻辑组和组字段来源另见scene.groups_v3，空间层级与剧本语义未实现；JSON值由JSON.parse确定，CST只取UTF-16范围；上限8Mi单元/64层/100000值节点；运行拒绝解码后重复键；仅旧v1事务恢复保留最后键语义且无歧义范围，v2/v3恢复继续严格校验；来源和逻辑组侧带信息不进入冻结构建计划；v3作者文本仍进入快照，过期、近似范围不选择，未保存草稿保留；新Tauri安装产物及Android设备未验收；单场景草稿来源可按原样hash在当前编辑器定位，坏草稿诊断与最后有效画面各保留自己的修订；不是将保存态来源强行映射到未保存文本。；0.0.8已交付配方预览复用来源模型并将生成位置重映射到recipe真实贡献项；仅导航，不授予覆盖或布局写入，具体范围见scene.composition。。

下一步：为共享模板与单次放置覆盖明确写回目标和历史边界，保持已有来源修订守护及旧冻结构建快照。

<a id="scene.instances_v2"></a>
### Scene2D v2 独立实例与定义复用

`scene.instances_v2` · 场景与构建 · 源码交付

入口：创建场景 → 复制实例/调整顺序；旧场景 → 启用场景实例 → 预览/保存；场景预览、布局与构建

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **json-source\.mjs / scene-model\.mjs / build-plan\.mjs**；解析并验证v2实例唯一性、定义依赖和有效字段；按场景版本发射模型/计划，保持v1兼容。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/results\.json](../docs/test-results/scene-instances/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/scene-instances\.test\.mjs](../scripts/tests/scene-instances.test.mjs) |
| 可移植 JS 语义 | **scene-identity\.mjs：实例/定义身份选择**；共享实例身份选择；各宿主以稳定实例为交互/草稿键，定义UUID继续用于登记/资源依赖。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/browser/browser\.json](../docs/test-results/scene-instances/browser/browser.json)、[docs/test-results/scene-instances/packaged-resources\.json](../docs/test-results/scene-instances/packaged-resources.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 可移植 JS 语义 | **world-scene-create\.mjs / world-scene-update\.mjs 等**；保真编辑按实例匹配原文，显式v1升级与v2降级保护；定义/资源登记依赖去重。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/results\.json](../docs/test-results/scene-instances/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/scene-instances\.test\.mjs](../scripts/tests/scene-instances.test.mjs) |
| 存储与事务 | **world-transactions\.mjs**；复用既有两文件创建/更新事务及恢复守护，不引入实例登记文件或新事务协议。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/results\.json](../docs/test-results/scene-instances/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/scene-instances\.test\.mjs](../scripts/tests/scene-instances.test.mjs) |
| 交互与渲染 | **app-scene-create\.js**；新建v2、显式升级旧场景、复制新身份与排序；关联定义可复用，预览保存后才写作者文件。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/browser/browser\.json](../docs/test-results/scene-instances/browser/browser.json)、[docs/test-results/scene-instances/results\.json](../docs/test-results/scene-instances/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 交互与渲染 | **app-scene-preview\.js / app-scene-preview-canvas\.js**；预览、画布与来源按钮按实例选择，定义链接保持objectId，拒绝缺失/重复身份的v2响应。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/browser/browser\.json](../docs/test-results/scene-instances/browser/browser.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/scene-instances-smoke\.mjs](../scripts/tests/scene-instances-smoke.mjs) |
| 交互与渲染 | **app-scene-layout\.js / app-scene-preview-canvas\.js**；实例多选、位置输入、撤销/重做与显式保存；布局视图不合并共享定义的多个实例。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/browser/browser\.json](../docs/test-results/scene-instances/browser/browser.json)、[docs/test-results/scene-instances/results\.json](../docs/test-results/scene-instances/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 可移植 JS 语义 | **scene-layout\.mjs / world-scene-update\.mjs：作者源适配与保存命令**；只在JS到既有Rust协议边界映射实例键；原声明objectId和instanceId原样保留，不宣称新增Rust实例语义。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/browser/browser\.json](../docs/test-results/scene-instances/browser/browser.json)、[docs/test-results/scene-instances/packaged-resources\.json](../docs/test-results/scene-instances/packaged-resources.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **node-build-snapshot\.mjs / project-build\.mjs**；同次冻结观察生成v2计划，素材按资源UUID去重；来源侧带信息按实例匹配，外层snapshot仍为1。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/results\.json](../docs/test-results/scene-instances/results.json)、[docs/test-results/scene-instances/runtime-review-tests\.log](../docs/test-results/scene-instances/runtime-review-tests.log)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **scene-preview-service\.mjs**；返回与计划相同的预览版本及每个实例来源；同次捕获按资源UUID去重，预览关闭/取消界限不变。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/browser/browser\.json](../docs/test-results/scene-instances/browser/browser.json)、[docs/test-results/scene-instances/results\.json](../docs/test-results/scene-instances/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 执行后端 | **godot4-dispatch\.mjs / godot4-instances\.mjs / runtime-v2\.gd**；v2独立节点、protocol2及map2配对实例/定义；旧v1生成器字节冻结，诊断在展开前受容量和长度限制。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/runtime-review-tests\.log](../docs/test-results/scene-instances/runtime-review-tests.log)、[docs/test-results/scene-instances/packaged-resources\.json](../docs/test-results/scene-instances/packaged-resources.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **node-project-build\.mjs**；冻结快照重建后严格匹配计划、适配器协议/摘要和生成文件，再创建独立运行副本。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/runtime-review-tests\.log](../docs/test-results/scene-instances/runtime-review-tests.log)、[docs/test-results/scene-instances/results\.json](../docs/test-results/scene-instances/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |

平台：Linux本机编辑服务、Chrome和真实Godot4、桌面/移动离线资源准备；新Tauri安装包与Android场景功能未验收/未接入。边界：作者Scene2D v2对应模型/构建计划第2版；instanceId是场景内稳定UUID，objectId仍引用已登记定义；演员数组始终为1–128个且决定绘制顺序；新建默认v2；v1显式升级经预览保存，关闭草稿不升级；禁止通过scene.update降级丢弃实例身份；复制生成新UUID，重排/位置覆盖独立；来源、选择、布局历史、事务恢复和迁移保留实例身份，资源/定义依赖去重；Rust几何/历史协议保持不变；JS将实例ID映射为opaque布局键，完整模型/事务写回/关系登记仍JS，source-only严格结构与数值补丁另由Rust执行；旧v1计划、快照、生成文件及后端摘要保持；v2运行协议/来源映射携带实例与定义双身份，导入诊断最多256条、每条4096字符；v3持久逻辑分组另见scene.groups_v3；没有空间父子变换、片段展开、剧本事件或任意作者脚本；源码/资源准备及Linux浏览器/Godot验证不等于Tauri安装或Android设备验收。

下一步：沿已实现的逻辑分组继续定义复用片段，明确展开来源、批量编辑及跨文件提交边界。

<a id="scene.groups_v3"></a>
### Scene2D v3 逻辑分组、共享大纲与后代选择

`scene.groups_v3` · 场景与构建 · 源码交付

入口：编辑场景 → 启用场景分组 → 组名/父组/实例归属；场景预览和布局 → 大纲搜索/折叠/选择后代

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **scene-groups\.mjs：逻辑组验证与可查询大纲**；组拓扑、成员和深度/数量规则；按源顺序产生可查询大纲及后代实例选择。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/results\.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/scene-groups/browser-final/browser\.json](../docs/test-results/scene-groups/browser-final/browser.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 可移植 JS 语义 | **scene-structure\.mjs：分组侧带与实例归属校验**；明确sceneStructure侧带契约，校验组与完整实例归属；不向plan2传递编辑器组织字段。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/results\.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/scene-groups/packaged-resources\.json](../docs/test-results/scene-groups/packaged-resources.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 可移植 JS 语义 | **json-source\.mjs / scene-model\.mjs / build-plan\.mjs**；读取作者v3与组字段来源，model3编译plan2；旧模型、计划和严格恢复规则保持。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/results\.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/scene-groups\.test\.mjs](../scripts/tests/scene-groups.test.mjs) |
| 可移植 JS 语义 | **world-scene-create\.mjs / world-scene-update\.mjs 等**；无损编辑以groupId匹配组片段，允许显式升级、拒绝降级；组操作不新增定义/素材依赖。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/results\.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/scene-groups\.test\.mjs](../scripts/tests/scene-groups.test.mjs) |
| 存储与事务 | **world-transactions\.mjs**；复用创建5/更新8双文件事务，组拓扑与身份参与恢复验证；不创建组元数据文件。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/group-core-tests\.log](../docs/test-results/scene-groups/group-core-tests.log)、[docs/test-results/scene-groups/results\.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 交互与渲染 | **app-scene-create\.js**；显式启用组、组名/父组/归属编辑和空组删除；升级及写入均经预览保存。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/browser-final/browser\.json](../docs/test-results/scene-groups/browser-final/browser.json)、[docs/test-results/scene-groups/results\.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 交互与渲染 | **app-scene-outline\.js：预览和布局共享场景大纲**；预览与布局共享搜索/折叠树，组点击选择完整后代，祖先保留且选择不改变绘制次序。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/browser-final/browser\.json](../docs/test-results/scene-groups/browser-final/browser.json)、[docs/test-results/scene-groups/results\.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 交互与渲染 | **app-scene-preview\.js / app-scene-preview-canvas\.js**；保存态或单场景草稿预览消费独立分组侧带；演员/图片按plan2源顺序渲染，草稿仅查看不进入图形编辑。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/browser-final/browser\.json](../docs/test-results/scene-groups/browser-final/browser.json)、[docs/test-results/scene-draft-preview/results\.json](../docs/test-results/scene-draft-preview/results.json)、[docs/test-results/scene-draft-preview/browser-final-verified/browser\.json](../docs/test-results/scene-draft-preview/browser-final-verified/browser.json) |
| 交互与渲染 | **app-scene-layout\.js / app-scene-preview-canvas\.js**；组后代映射为现有实例多选和一次位置历史批次；保存保留作者组结构。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/browser-final/browser\.json](../docs/test-results/scene-groups/browser-final/browser.json)、[docs/test-results/scene-groups/results\.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 可移植 JS 语义 | **scene-layout\.mjs / world-scene-update\.mjs：作者源适配与保存命令**；v3布局核对源声明与分组侧带，位置变化保留groups和groupId；Rust协议与实现未改。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/results\.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/scene-groups\.test\.mjs](../scripts/tests/scene-groups.test.mjs) |
| 本机服务与适配 | **node-build-snapshot\.mjs / project-build\.mjs**；保存态同次冻结观察返回组侧带和来源，snapshot原文保留v3而可执行计划仍为2；草稿分支只返回独立预览身份，不提供build-snapshot。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/results\.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/scene-draft-preview/backend\.log](../docs/test-results/scene-draft-preview/backend.log)、[docs/test-results/scene-draft-preview/results\.json](../docs/test-results/scene-draft-preview/results.json) |
| 本机服务与适配 | **scene-preview-service\.mjs**；预览协议仍为2，独立sceneStructure传递保存态或草稿分组；草稿来源绑定自身hash，图片缓存和关闭限制保持。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/browser-final/browser\.json](../docs/test-results/scene-groups/browser-final/browser.json)、[docs/test-results/scene-groups/results\.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/scene-draft-preview/backend\.log](../docs/test-results/scene-draft-preview/backend.log) |
| 本机服务与适配 | **node-project-build\.mjs**；现有冻结重放重建v3作者观察得到plan2，检查既有v2后端摘要及生成文件。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/results\.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/scene-group-runtime\.test\.mjs](../scripts/tests/scene-group-runtime.test.mjs) |
| 执行后端 | **godot4-dispatch\.mjs / godot4-instances\.mjs / runtime-v2\.gd**；v3组结构编译后复用未改动v2生成器/协议，无组节点、空间继承或任意作者脚本。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-groups/results\.json](../docs/test-results/scene-groups/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json)、[scripts/tests/scene-group-runtime\.test\.mjs](../scripts/tests/scene-group-runtime.test.mjs) |

平台：Linux本机编辑服务、Chrome和真实Godot4、桌面/移动离线资源准备；新安装包和目标设备未验收。边界：作者schema3要求groups数组0–128个，groupId为稳定UUID且与实例身份分离；父组可省略，拒绝空值、循环、孤立引用和超过16层的树；分组只组织编辑器；实例position仍为绝对坐标，actors数组继续决定绘制顺序，没有父子变换、继承可见性或组运行节点；新场景仍默认v2，启用分组为显式草稿升级；保存前不迁移，禁止降级；删除组仅允许空组，重命名/重排/改父组不重建实例身份；共享纯规则构建大纲，搜索保留祖先且命中组包含后代；后代选择按原演员顺序映射为既有Rust布局批次；来源按groupId/instanceId定位；无损源变换、两文件事务恢复和依赖包迁移保留逻辑组，无单独组登记数据库；model3编译为plan2并去除actor.groupId；sceneStructure侧带供编辑器消费，v1/v2后端脚本及摘要、运行协议均保持不变；领域校验、树模型和原文变换仍在JS；不是Rust语义迁移，也不是空间层次/片段/剧本事件；新Tauri安装包及Android场景功能未验收/未接入；单场景v3草稿的组变化可只读预览，组后代位置可通过scene.source_layout应用回源码；不写组登记，组结构仍随普通保存持久化。。

下一步：实验scene.composition已用稳定组身份展开现有v3；后续接配方来源/覆盖编辑，空间父子变换与大规模场景性能单独验证。

<a id="scene.text_draft_preview"></a>
### 当前场景原文草稿的只读预览与精确定位

`scene.text_draft_preview` · 场景与构建 · 源码交付

入口：编辑已登记场景原文 → 构建与运行 → 场景预览 → 预览当前草稿；POST /api/scene-preview 的 draft 分支

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **scene-draft-preview\.mjs：单场景只读源覆盖与重新投影**；验证单源128KiB请求与已登记路径/磁盘基线；只覆盖克隆正文和SHA-256，再派生投影，保留关系/资源登记并拒绝未登记依赖。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-draft-preview/backend\.log](../docs/test-results/scene-draft-preview/backend.log)、[docs/test-results/scene-draft-preview/results\.json](../docs/test-results/scene-draft-preview/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 可移植 JS 语义 | **json-source\.mjs / scene-model\.mjs / build-plan\.mjs**；复用v1/v2/v3语义与严格源范围，将草稿来源hash带入诊断与组侧带；不经会改写作者原文的保存规划。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-draft-preview/backend\.log](../docs/test-results/scene-draft-preview/backend.log)、[docs/test-results/scene-draft-preview/results\.json](../docs/test-results/scene-draft-preview/results.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |
| 可移植 JS 语义 | **scene-preview-contract\.mjs**；预览路由与128KiB草稿源预算共用可移植契约；最坏JSON转义仍留在既有HTTP全包限制内，保存态请求保持兼容。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-draft-preview/backend\.log](../docs/test-results/scene-draft-preview/backend.log)、[docs/test-results/scene-draft-preview/http\.log](../docs/test-results/scene-draft-preview/http.log)、[docs/test-results/scene-draft-preview/results\.json](../docs/test-results/scene-draft-preview/results.json) |
| 本机服务与适配 | **node-build-snapshot\.mjs / project-build\.mjs**；独立captureSceneDraftPreview复用围栏/双读/图片hash冻结；生成域分离预览身份，排除可执行快照和编辑前提；captureBuildSnapshot继续只读磁盘。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-draft-preview/backend\.log](../docs/test-results/scene-draft-preview/backend.log)、[docs/test-results/scene-draft-preview/http\.log](../docs/test-results/scene-draft-preview/http.log)、[docs/test-results/scene-draft-preview/results\.json](../docs/test-results/scene-draft-preview/results.json) |
| 本机服务与适配 | **scene-preview-service\.mjs**；区分保存态与严格draft分支；沿用本机鉴权、串行取消及两份/128MiB/TTL资源边界，409基线冲突和诊断保留草稿修订，禁止sceneEditing。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-draft-preview/backend\.log](../docs/test-results/scene-draft-preview/backend.log)、[docs/test-results/scene-draft-preview/http\.log](../docs/test-results/scene-draft-preview/http.log)、[docs/test-results/scene-draft-preview/results\.json](../docs/test-results/scene-draft-preview/results.json) |
| 交互与渲染 | **app-scene-preview\.js / app-scene-preview-canvas\.js**；显式预览草稿、独立来源提示和图形写入门禁；请求/解码原子替换，失败保留最后画面；同scene关闭编辑重开保留一份有界画面并释放服务器资源。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-draft-preview/results\.json](../docs/test-results/scene-draft-preview/results.json)、[docs/test-results/scene-draft-preview/browser-final-verified/browser\.json](../docs/test-results/scene-draft-preview/browser-final-verified/browser.json)、[docs/test-results/scene-source-layout/results\.json](../docs/test-results/scene-source-layout/results.json) |
| 交互与渲染 | **app-source-location\.js / app-runtime\.js / app-scene-preview\.js**；从当前场景编辑器提取原样草稿和磁盘基线hash；来源导航核对草稿hash、会话与内容后只移动选区，迟到结果/不匹配修订不覆盖编辑内容。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-draft-preview/host-ui\.log](../docs/test-results/scene-draft-preview/host-ui.log)、[docs/test-results/scene-draft-preview/results\.json](../docs/test-results/scene-draft-preview/results.json)、[docs/test-results/scene-draft-preview/browser-final-verified/browser\.json](../docs/test-results/scene-draft-preview/browser-final-verified/browser.json) |

平台：Linux本机编辑服务与Chrome；真实HTTP、宿主编辑器和浏览器验收范围见当前报告、新Tauri安装产物及Android场景预览未验收/未接入。边界：仅当前已登记场景的一份原文草稿，UTF-8最多128 KiB；严格sceneId/sourcePath/baseSourceRevision/content契约，孤立代理字符、额外字段和超限请求拒绝，HTTP整体请求仍受既有1 MiB限制；以磁盘SHA-256修订为基线，替换克隆观察中的场景正文和源修订后重新派生World投影；角色/投影/素材及关系绑定继续使用已保存登记，缺失或未关联依赖只诊断，不写正文或metadata；草稿身份与构建快照分域；来源按原样BOM/CRLF/Unicode正文hash绑定，返回draft修订与v3组织侧带，不返回sceneEditing或可执行build-snapshot，不创建构建任务或缓存；有效结果原子替换；错误、外部基线冲突或迟到响应保留最后有效画面和来源修订。同一场景可关闭预览、编辑原文、重开自动预览草稿；关闭释放服务端资源，仅保留一份有界解码画面，换场景/失去能力/销毁清理；精确来源定位只校验当前编辑器草稿并移动光标；原文变化、近似范围、场景切换和异步所有权失效均保留内容。投影来源继续走保存态来源路径；草稿预览不授予图形场景表单或World布局保存；来源仍与当前源码一致时可进入独立scene.source_layout本地坐标回写。构建只捕获保存输入，即使传入未知draft选项也不会构建草稿。；只读覆盖与重新投影仍是JS；宿主冻结、HTTP和浏览器渲染分别负责I/O与界面。完整场景/投影语义未下沉Rust，没有多文件原子保存或完整剧本系统；单场景源码坐标回写另列scene.source_layout，新Tauri安装产物和Android场景功能未验收/未接入。；当前草稿为配方时走scene.composition的专用只读模型；来源贡献可导航，仍不允许scene.source_layout回写生成坐标。。

下一步：在已接入的单场景坐标回写上明确跨视图历史、多文件片段来源与提交边界；目标设备另行验收。

<a id="scene.source_layout"></a>
### 当前源码草稿的布局调整与精确回写

`scene.source_layout` · 场景与构建 · 源码交付

入口：源码模式编辑已登记场景 → 预览当前草稿 → 调整草稿布局 → 预览布局修改 → 应用到文本草稿 → 主编辑器普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **scene-source-layout\.mjs / scene-layout\.mjs：源码桥接、预览守护与共用Rust几何会话**；将源码交给Rust检查并请求精确补丁，JS只解码及匹配有效preview、来源hash/基线与v3侧带；prepare重算候选，宿主仍须await后owner核验。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-source-layout/engine-final\.log](../docs/test-results/scene-source-layout/engine-final.log)、[docs/test-results/scene-source-layout/results\.json](../docs/test-results/scene-source-layout/results.json)、[docs/test-results/scene-source-layout/app-check-verified\.log](../docs/test-results/scene-source-layout/app-check-verified.log) |
| 共享 Rust 核心 | **layout\_draft\.rs：权威位置与有界历史**；复用未改动LayoutDraft持有位置与100批次undo/redo；本地源码会话与保存态会话隔离，共享有界32槽位与dispose边界。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-source-layout/engine-final\.log](../docs/test-results/scene-source-layout/engine-final.log)、[docs/test-results/scene-source-layout/results\.json](../docs/test-results/scene-source-layout/results.json)、[docs/test-results/scene-source-layout/app-check-verified\.log](../docs/test-results/scene-source-layout/app-check-verified.log) |
| 交互与渲染 | **app-scene-layout\.js / app-scene-preview-canvas\.js**；共用画布/选择与几何操作，source-mode审阅并应用完整proposal；本地pending不设置World busy，取消保留文本，成功刷新草稿。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-source-layout/results\.json](../docs/test-results/scene-source-layout/results.json)、[docs/test-results/scene-source-layout/app-check-verified\.log](../docs/test-results/scene-source-layout/app-check-verified.log)、[docs/test-results/scene-source-layout/browser-render/browser\.json](../docs/test-results/scene-source-layout/browser-render/browser.json) |
| 交互与渲染 | **app-source-location\.js / app-runtime\.js / app-scene-preview\.js**；源码模式提取并校验当前scene注册/path/session/token/baseline/全文；prepare后再次核验owner，应用到内存且不重置保存版本。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-source-layout/results\.json](../docs/test-results/scene-source-layout/results.json)、[docs/test-results/scene-source-layout/app-check-verified\.log](../docs/test-results/scene-source-layout/app-check-verified.log)、[docs/test-results/scene-source-layout/browser-render/browser\.json](../docs/test-results/scene-source-layout/browser-render/browser.json) |
| 交互与渲染 | **app-scene-preview\.js / app-scene-preview-canvas\.js**；来源一致的有效草稿显示独立调整入口；旧画面/错误/切scene不能授予写回，应用成功继续草稿刷新而非保存态invalidate。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-source-layout/results\.json](../docs/test-results/scene-source-layout/results.json)、[docs/test-results/scene-source-layout/app-check-verified\.log](../docs/test-results/scene-source-layout/app-check-verified.log)、[docs/test-results/scene-source-layout/browser-render/browser\.json](../docs/test-results/scene-source-layout/browser-render/browser.json) |
| 构建与分发 | **prepare\.mjs**；移动离线资源携带同一Rust source核心与桥接；通用解析及完整模型仍JS，保留原YAML vendor与后端json-source重定位，不提供Android场景入口。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-source-layout/results\.json](../docs/test-results/scene-source-layout/results.json)、[docs/test-results/scene-source-layout/app-check-verified\.log](../docs/test-results/scene-source-layout/app-check-verified.log)、[docs/test-results/scene-source-layout/packaged-resources\.json](../docs/test-results/scene-source-layout/packaged-resources.json) |
| 共享 Rust 核心 | **scene\_source\.rs：无状态严格JSON与精确坐标token补丁**；Rust对源码执行严格JSON/身份/位置/组检查，以原UTF-8 token范围生成仅坐标补丁；无状态、无持久化、无几何会话副作用，完整Scene2DModel另由JS验证。 | 4 / 4 / 4 / 3 | [docs/test-results/rust-scene-source/results\.json](../docs/test-results/rust-scene-source/results.json)、[docs/test-results/rust-scene-source/packaged-resources\.json](../docs/test-results/rust-scene-source/packaged-resources.json)、[docs/test-results/release-0\.0\.7/results\.json](../docs/test-results/release-0.0.7/results.json) |

平台：Linux本机编辑服务与Chrome；真实业务与回归范围见本轮报告、桌面/移动离线资源与隔离模块运行通过；新版Tauri安装窗口和Android场景功能未验收/未接入。边界：仅当前已登记场景的源码模式；v1/v2/v3及1–128实例，原文前后均限128KiB UTF-8，不支持新建未登记文档、字段/分段模式或跨文档写回；草稿预览的path、保存基线、SHA-256、schema、实例身份/顺序/位置与v3侧带必须一致；错误草稿保留的旧画面无回写权限；共用Rust几何与LayoutDraft的100批次历史及32会话表；新增stateless sceneSource.inspect/patch不占用草稿槽位，source-only对象仍不暴露command/beginSave或World保存前提。旧几何/历史/保存操作和场景后端不变。；Rust严格扫描JSON并检查v1/v2/v3身份/坐标与组关系，按UTF-8字节范围仅替换变化position的数值token；前后128KiB、64层/100000值节点、128实例/组及16层组关系。BOM/CRLF、未改指数/负零/转义及其他原文保留，decoded重复键/字面孤立代理字符/伪造候选拒绝。；完整候选审阅后由宿主复查sceneId、path、会话/token、摘要、编辑会话基线和原文，再写编辑器内存；hash返回后再次检查归属，取消/失败保留草稿；应用不读写磁盘，保留原文档保存版本；外部文件变化仍可本地应用，之后预览/普通保存各自按原基线拒绝过期结果或覆盖。dirty按编辑器基线比较；不调用scene.update、不修改metadata/素材/OC/投影或创建构建任务；只有本次布局会话的局部undo；没有跨源码/表单/布局统一历史、跨重启布局恢复、多文件事务或剧本/空间变换。本版为源码交付，新安装产物/设备未验收；JS只负责本切片的解码、预览元数据与hash/owner；完整Scene2DModel、投影继承、依赖/登记、来源导航及事务JSON/CST仍在JS。前端源码布局不再加载YAML，也无JS补丁回退；旧WASM缺少源码能力时保留旧布局操作并拒绝新源操作。。

下一步：复用片段已另列scene.composition实验；源码补丁仍只改当前普通场景，配方覆盖写回、跨文件提交与跨视图历史须独立契约。

<a id="scene.composition"></a>
### 文件内场景片段、配方预览、单实例覆盖与迁移实验

`scene.composition` · 场景与构建 · 源码交付

入口：普通已登记JSON源码编辑/保存与资源包；保存/草稿配方预览、贡献导航及当前源码的单实例覆盖对话框；scene:compose只读CLI

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **scene\_composition\.rs：无状态文件内片段组合**；纯Rust检查并展开recipe，明确声明/展开上限及稳定映射，输出既有v3和无宿主来源指针；不接World或文件。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition/results\.json](../docs/test-results/scene-composition/results.json)、[docs/test-results/scene-composition/packaged-resources\.json](../docs/test-results/scene-composition/packaged-resources.json)、[docs/test-results/scene-composition-workflow/results\.json](../docs/test-results/scene-composition-workflow/results.json) |
| 可移植 JS 语义 | **scene-composition\.mjs / studio-core\.mjs：可移植组合调用与响应守护**；同步调用Rust组合/独立可选覆盖补丁；校验来源归属、唯一目标语义与真实有序changedPaths，并重新严格展开回执。坏回执关闭runtime；缺patch能力保留旧域，无JS算法回退。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition/results\.json](../docs/test-results/scene-composition/results.json)、[docs/test-results/scene-composition/packaged-resources\.json](../docs/test-results/scene-composition/packaged-resources.json)、[docs/test-results/scene-composition-workflow/results\.json](../docs/test-results/scene-composition-workflow/results.json) |
| 本机服务与适配 | **scene-compose\.mjs：独立文件/已登记快照的只读JSON输出**；有界独立文件或已登记World快照，核对可选源修订与全部声明依赖；输出scene或带原字节摘要/origin的bundle，不写/注册/构建作品。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition/results\.json](../docs/test-results/scene-composition/results.json)、[docs/test-results/scene-composition/packaged-resources\.json](../docs/test-results/scene-composition/packaged-resources.json)、[docs/test-results/scene-composition-workflow/results\.json](../docs/test-results/scene-composition-workflow/results.json) |
| 可移植 JS 语义 | **scene-composition-document\.mjs：配方文档识别与源码派生依赖**；普通文档顶层格式识别，复用Rust校验并从全部模板/覆盖只读派生对象与图片依赖；分类和引用检查不写元数据、不复制组合算法。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-workflow/results\.json](../docs/test-results/scene-composition-workflow/results.json)、[docs/test-results/scene-composition-workflow/packaged-resources\.json](../docs/test-results/scene-composition-workflow/packaged-resources.json)、[docs/test-results/scene-composition-workflow/browser/browser\.json](../docs/test-results/scene-composition-workflow/browser/browser.json) |
| 本机服务与适配 | **resource-package-service\.mjs / resource-package-export\.mjs 等**；资源包目录合并源码派生边和原文指纹；读包/导入重新检查真实recipe与分类/requirements完整性、目标现存来源；保留已有持久导入机制。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-workflow/results\.json](../docs/test-results/scene-composition-workflow/results.json)、[docs/test-results/scene-composition-workflow/packaged-resources\.json](../docs/test-results/scene-composition-workflow/packaged-resources.json)、[docs/test-results/scene-composition-workflow/browser/browser\.json](../docs/test-results/scene-composition-workflow/browser/browser.json) |
| 可移植 JS 语义 | **scene-composition-preview\.mjs：只读展开模型与贡献来源映射**；合并临时派生与作者依赖，复用v3模型并把场景/诊断/字段映射配方原字节；保留投影来源，不输出synthetic观察或写权限。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-preview/browser/browser\.json](../docs/test-results/scene-composition-preview/browser/browser.json)、[docs/test-results/scene-composition-preview/results\.json](../docs/test-results/scene-composition-preview/results.json)、[docs/test-results/scene-composition-preview/packaged-resources\.json](../docs/test-results/scene-composition-preview/packaged-resources.json) |
| 本机服务与适配 | **node-build-snapshot\.mjs / project-build\.mjs**；保存/草稿配方捕获使用原源fence及冻结图片，独立预览身份无build snapshot；原captureBuildSnapshot继续只处理已登记Scene2D。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-preview/browser/browser\.json](../docs/test-results/scene-composition-preview/browser/browser.json)、[docs/test-results/scene-composition-preview/results\.json](../docs/test-results/scene-composition-preview/results.json)、[docs/test-results/scene-composition-preview/packaged-resources\.json](../docs/test-results/scene-composition-preview/packaged-resources.json) |
| 本机服务与适配 | **scene-preview-service\.mjs**；HTTP预览保留配方元数据、真实来源和组织大纲，资源缓存/摘要/释放沿旧规则；拒绝把配方响应变成sceneEditing。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-preview/browser/browser\.json](../docs/test-results/scene-composition-preview/browser/browser.json)、[docs/test-results/scene-composition-preview/results\.json](../docs/test-results/scene-composition-preview/results.json)、[docs/test-results/scene-composition-preview/packaged-resources\.json](../docs/test-results/scene-composition-preview/packaged-resources.json) |
| 本机服务与适配 | **project-build-service\.mjs / build-process\.mjs 等**；状态分别列可构建Scene2D与可预览配方；不因普通recipe文档启动后端任务，缺Godot时仍提供本机静态预览。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-preview/browser/browser\.json](../docs/test-results/scene-composition-preview/browser/browser.json)、[docs/test-results/scene-composition-preview/results\.json](../docs/test-results/scene-composition-preview/results.json)、[docs/test-results/scene-composition-preview/packaged-resources\.json](../docs/test-results/scene-composition-preview/packaged-resources.json) |
| 交互与渲染 | **app-source-location\.js / app-runtime\.js / app-scene-preview\.js**；画布/大纲与贡献导航保留dirty/修订；普通Scene2D写入和构建入口关闭，独立覆盖入口需当前源码身份/能力。父控制器验证候选并传live守护，主编辑器复核提案后仅替换同一原文草稿。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-preview/browser/browser\.json](../docs/test-results/scene-composition-preview/browser/browser.json)、[docs/test-results/scene-composition-preview/results\.json](../docs/test-results/scene-composition-preview/results.json)、[docs/test-results/scene-composition-preview/packaged-resources\.json](../docs/test-results/scene-composition-preview/packaged-resources.json) |
| 共享 Rust 核心 | **scene\_composition\_patch\.rs：稳定目标的六字段保真覆盖补丁**；严格校验整份配方后按稳定目标生成保真六字段set补丁，前后展开/预算均检查；不改共享片段/其他放置/身份，不创建会话或执行I/O。 | 4 / 3 / 4 / 3 | [docs/test-results/scene-composition-overrides/core-bridge\.log](../docs/test-results/scene-composition-overrides/core-bridge.log)、[docs/test-results/scene-composition-overrides/results\.json](../docs/test-results/scene-composition-overrides/results.json)、[docs/test-results/scene-composition-overrides/packaged-resources\.json](../docs/test-results/scene-composition-overrides/packaged-resources.json) |
| 可移植 JS 语义 | **scene-composition-overrides\.mjs：绑定原文与预览的覆盖提案及复核**；从当前源与真实预览派生局部编辑状态；提案只包含实际改值，prepare重验hash/目标与精确核心输出，异步前分离输入，无保存副作用。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-overrides/results\.json](../docs/test-results/scene-composition-overrides/results.json)、[docs/test-results/scene-composition-overrides/packaged-resources\.json](../docs/test-results/scene-composition-overrides/packaged-resources.json)、[docs/test-results/scene-composition-overrides/browser/browser\.json](../docs/test-results/scene-composition-overrides/browser/browser.json) |
| 交互与渲染 | **app-scene-composition-overrides\.js：实例覆盖检查与草稿应用对话框**；单实例表单→完整候选检查/审阅→live守护的显式内存应用；原文/保存基线保持，普通保存负责磁盘；取消/过期/迟到不写。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-overrides/results\.json](../docs/test-results/scene-composition-overrides/results.json)、[docs/test-results/scene-composition-overrides/packaged-resources\.json](../docs/test-results/scene-composition-overrides/packaged-resources.json)、[docs/test-results/scene-composition-overrides/browser/browser\.json](../docs/test-results/scene-composition-overrides/browser/browser.json) |

平台：Linux本机编辑服务与Chrome配方预览/局部覆盖原文草稿；Node只读CLI/资源包；共享Rust原生/WASM展开与保真补丁、实际打包资源隔离检查与安装/Android设备范围按本轮报告区分。边界：0.0.8源码实验性功能：recipe v1复用普通已登记.json文档与原编辑/保存/冲突；workspace v2/v3配方可只读预览，不新增项目类型、World/journal命令、workspace/Scene2D/运行协议。；配方1–32片段，各含演员及逻辑组；1–128次放置，显式local key→UUID完整映射；声明与展开分别限128演员/128组及16层，重排不改身份。；放置先合并白名单覆盖再应用位置偏移，越界整批拒绝；继承字段省略与imageResourceId:null区分，覆盖不改变定义/身份/分组/继承开关。；Rust严格JSON/重复键/形状/引用/身份/覆盖/预算检查；无状态无I/O，不使用32槽布局会话。原生和WASM共用，不分配或散列生成UUID。；来源sidecar记录模板/放置/身份及贡献JSON Pointer；CLI保留原字节SHA-256，登记模式增加objectId/sourcePath/worldId/worldRevision来源；不授予World/sceneEditing权限。；当前顶层format选择配方工作流，删除后回归普通JSON；Rust校验后从全部模板/覆盖派生对象/图片依赖，含unused/被覆盖项，null忽略；不按文件名猜、不自动写metadata。；配方依赖合并作者已有关系，导出闭包与读包/导入重验实际字节；依赖必须正确列入documents/assets或有指纹requirements，目标同UUID不能补清单漏项；投影闭包沿旧规则。；未完成原文可普通保存和完整备份，无效配方不能展开/选择式打包；生成v3经已有scene.create单独登记，编辑它不会回写配方。；保存态与当前单文档草稿先复用原观察/修订守护，内部克隆展开为v3并合并派生和手工依赖；完整模型/投影/图片规则共用，内部观察不返回、不持久化。；配方标题/画布/背景、演员/组声明和诊断映射实际原文；多贡献主位置近似，template/override/offset/identity各可精确导航。继承尺寸/图片继续指向投影，旧revision不能误选新文本。；独立预览身份绑定配方原文/World修订与冻结图片，不返回sceneEditing或执行snapshot；配方从构建Scene2D清单分离，Scene2D表单/拖动/草稿布局不接生成坐标。；单实例覆盖仅对当前同路径/摘要/保存基线源码会话开放；独立Rust可选操作按placementId+actorKey设置六字段，前后128KiB/完整展开校验，保留其余原始字节，未改字段保留继承。；提案与准备应用分离异步输入，桥接拒绝非目标语义/伪造路径/重复键回执；宿主检查完整模型/真实图片并复核live会话才改内存，实际保存复用普通编辑器冲突机制；取消/迟到/过期不改原草稿。；0.0.10源码纳入单实例六字段恢复、单/多位置画布、共享演员声明SET/恢复、整组offset，以及独立演员/放置/组织组/定义结构创作和定义重命名；九入口分离审批与局部历史，生成场景编辑不反向修改配方。空间层次、其他字段批次与跨视图历史仍未接入。；无嵌套/跨文件片段、通用表达式、脚本、组空间变换或多文件事务；没有新安装包、Tauri窗口或Android配方入口验收。。

下一步：在字段、位置及独立演员/放置/组/定义结构和重命名切片之后，分别定义空间层次与跨视图历史；嵌套/跨文件/多文件提交另立契约。

<a id="behavior.scene_runtime"></a>
### 场景实例的GDScript参数、信号与冻结迁移

`behavior.scene_runtime` · 场景与构建 · 源码交付

入口：已登记scene→behavior关系→JSON绑定清单/TXT源码→检查计划/构建/无头测试→行为事件与源诊断

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **scene-behaviors\.mjs：严格清单、依赖与可移植绑定计划**；可移植显式绑定规则与plan3组合；保存语法和执行契约分开，不填World空字段。 | 4 / 4 / 4 / 3 | [docs/test-results/scene-behavior-runtime/results\.json](../docs/test-results/scene-behavior-runtime/results.json)、[docs/test-results/scene-behavior-runtime/packaged-resources\.json](../docs/test-results/scene-behavior-runtime/packaged-resources.json)、[docs/test-results/release-0\.0\.8/results\.json](../docs/test-results/release-0.0.8/results.json) |
| 本机服务与适配 | **node-execution-backends\.mjs / node-project-build\.mjs：可信注册、输出与冻结编排**；复用保存态捕获与冻结回放，精确诊断范围来自冻结原文，服务仅返回计数和可信DTO。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-behavior-runtime/results\.json](../docs/test-results/scene-behavior-runtime/results.json)、[docs/test-results/scene-behavior-runtime/browser/browser\.json](../docs/test-results/scene-behavior-runtime/browser/browser.json)、[docs/test-results/scene-behavior-runtime/packaged-resources\.json](../docs/test-results/scene-behavior-runtime/packaged-resources.json) |
| 执行后端 | **godot4-behaviors\.mjs / behavior-runtime\.gd：独立Node参数/信号**；独立Node源码生成/编译、export与signal类型检查、可信身份及生命周期；不改旧生成字节。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-behavior-runtime/results\.json](../docs/test-results/scene-behavior-runtime/results.json)、[docs/test-results/scene-behavior-runtime/packaged-resources\.json](../docs/test-results/scene-behavior-runtime/packaged-resources.json)、[docs/test-results/release-0\.0\.8/results\.json](../docs/test-results/release-0.0.8/results.json) |
| 交互与渲染 | **app-project-build\.js**；行为数量/事件三语可读文本和源诊断，保留rawlog和任意文档草稿运行保护。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-behavior-runtime/results\.json](../docs/test-results/scene-behavior-runtime/results.json)、[docs/test-results/scene-behavior-runtime/browser/browser\.json](../docs/test-results/scene-behavior-runtime/browser/browser.json)、[docs/test-results/release-0\.0\.8/results\.json](../docs/test-results/release-0.0.8/results.json) |
| 本机服务与适配 | **resource-package-service\.mjs / resource-package-export\.mjs 等**；按实际绑定原文重新验证scene/script及actor闭包、requirement指纹与并发读取；普通保存/fullbackup保持原规则。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-behavior-runtime/results\.json](../docs/test-results/scene-behavior-runtime/results.json)、[docs/test-results/scene-behavior-runtime/packaged-resources\.json](../docs/test-results/scene-behavior-runtime/packaged-resources.json)、[docs/test-results/release-0\.0\.8/results\.json](../docs/test-results/release-0.0.8/results.json) |

平台：Linux本机编辑服务与真实Chrome/Godot4、移动仅纯规则与完整作者数据存储互通，不代表行为执行或UI接入、Tauri新安装及Android设备未验收。边界：0.0.8源码交付；明确选择绑定文档的Scene2D v2/v3才生成plan/runtime3；旧无行为v1/v2分支保持，Worldv1.behaviorBindings仍为[]。；严格可移植manifest1：最多32bindings/8sources，TXT每份64KiB合计512KiB；场景与源码必须有非part-of出向登记，稳定实例/定义依赖完整。；Godot4仅GDScript独立Node：无参构造、脚本自身标量export、最多4个明确类型信号参数；每binding独立对象，事件绑定身份可信且限制ready/finished生命周期。；作者源码随冻结快照；回放重新规划、核对指纹/工具/每份输出；TXT编译定位原文行，参数类型运行错误定位manifest指针，sourceRange由冻结作者文本补充。；选择包重派生场景/源码直接依赖并要求清单或pin；包内scene不得借ambientactor，外部pinnedscene可沿已锁关系读取传递actor并hash/fence复验；完整备份允许未完成原文。；静态预览只geometry，不验证或运行bindings；GUI展示计数/安全文本事件和诊断，不执行脚本，未保存任意doc继续阻止build/run。；本Godot／GDScript专题的脚本以用户权限运行，无沙箱承诺；不包含任意方法RPC、热更新、通用状态机、Nuis、GPU、Android执行器或新安装验收。Bevy Rust作者执行现由独立behavior.bevy_rust接入，不能由本专题旧证据推导其成熟度。内置参数／信号、首次声明和TXT草稿分别见behavior.authoring、behavior.creation、script.authoring；作者入口本身不授予执行权。。

下一步：内置脚本、首次多绑定和参数／信号编辑已分别接通；引用与回源由behavior.script_links负责，独立Rust通道见behavior.bevy_rust。继续定义已有声明迁移、解绑／热更新和规模验证；各后端分别验收。

<a id="runtime.objects_inspection"></a>
### 运行对象、位置采样与冻结来源只读观察

`runtime.objects_inspection` · 场景与构建 · 源码交付

入口：构建任务→当前owned运行job.runtime→本地名称/实例/定义检索、原文声明；POST /api/project-build action:inspect

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **scene-runtime-query\.mjs：稳定身份与采样观察核心**；冻结身份/来源与纯采样状态独立于引擎与视图，query分离完整DTO并按AND过滤；原事件准入仍属于adapter。 | 4 / 4 / 4 / 3 | [docs/test-results/runtime-object-inspection/core-query-final\.log](../docs/test-results/runtime-object-inspection/core-query-final.log)、[docs/test-results/runtime-object-inspection/host-real\.log](../docs/test-results/runtime-object-inspection/host-real.log)、[docs/test-results/runtime-object-inspection/packaged-resources\.json](../docs/test-results/runtime-object-inspection/packaged-resources.json) |
| 本机服务与适配 | **node-execution-backends\.mjs / node-project-build\.mjs：可信注册、输出与冻结编排**；验证全部frozen产物后建立观察，runtime progress/终态session与独立job视图；strictinspect只读当前ownedrun且不查tool或占槽。 | 4 / 4 / 4 / 3 | [docs/test-results/runtime-object-inspection/host-real\.log](../docs/test-results/runtime-object-inspection/host-real.log)、[docs/test-results/runtime-object-inspection/browser/browser\.json](../docs/test-results/runtime-object-inspection/browser/browser.json)、[docs/test-results/runtime-object-inspection/packaged-resources\.json](../docs/test-results/runtime-object-inspection/packaged-resources.json) |
| 交互与渲染 | **app-project-build\.js**；消费归属匹配的job\.runtime，本地过滤和三语采样标签、名称安全文本与冻结source导航，保持焦点/dirty/迟到归属保护。 | 4 / 4 / 3 / 3 | [docs/test-results/runtime-object-inspection/ui-final\.log](../docs/test-results/runtime-object-inspection/ui-final.log)、[docs/test-results/runtime-object-inspection/browser/browser\.json](../docs/test-results/runtime-object-inspection/browser/browser.json)、[docs/test-results/runtime-object-inspection/packaged-resources\.json](../docs/test-results/runtime-object-inspection/packaged-resources.json) |

平台：Linux本机CLI/编辑服务与工作台，实际浏览器/准备资源证据分列、Android仅可移植观察模块；无对象UI/执行器/设备验收、Tauri新安装和窗口未验收。边界：0.0.8源码交付；普通观察消费既有 plan/runtime1/2/3，无程序DTO保持；有限控制 plan1/2 可选 control 摘要和完整步骤样本，不改变作者格式或 adapter contract1。；仅从已验证冻结plan捕获actor身份、名称与来源；protocol1按objectId，2/3按instanceId且核对objectId，不暴露引擎Entity/节点/句柄。；waiting只有metadata/null样本；ready/finished提供完整坐标；state改变状态并使旧位置positionCurrent=false，diagnostic/behavior不改变观察，不提供实时反射。；host在frozen/source/adapter/tool/artifact验证后建立视图，runtime progress先于raw ready；128条事件ring不裁剪完整128actor视图，取消/错误/超时会话保留最后有效样本。；inspect只接受当前owned runjob UUID及可选instanceId/objectId小写UUID，AND过滤无匹配[]，无active/tool availability门禁，不启动任务/占槽/读作者源；foreign/nonrun/missing/unavailable拒绝。；UI核对scene/backend/descriptor/build/snapshot/protocol归属，本地检索、三语、采样阶段和source守护，dirty/creating/busy禁跳转并保护光标，切换清理旧对象。；本只读观察专题不含连续位置采样、组件反射／RPC／运行修改、BRP、资源通道、GPU、跨会话历史采用或Android对象UI；独立Rust行为见behavior.bevy_rust，其运行证据不由本专题旧评分代替。；有限方向回放另外准入 VIENTO_TRACE 全体样本；phase仍ready，positionSample control/零基positionStep；state可使样本stale，有效finished清步骤标记；来源仍由冻结计划提供。 按实例输入继续复用完整trace schema1及原观察DTO；稀疏输入不省略未列实例的样本。。

下一步：有限固定步骤采样已接入；连续实时采样、组件查询和运行修改仍需明确时间/顺序/预算/所有权，不写作者权威数据。

<a id="runtime.control_replay"></a>
### 有限方向程序、跨后端回放与完整步骤采样

`runtime.control_replay` · 场景与构建 · 源码交付

入口：构建任务 → 编辑控制回放 / 控制回放；project-build run --control-program

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **scene-control-program\.mjs：有限程序及原序trace准入**；纯程序/联合预算与原序trace准入，无模拟或引擎依赖。 | 4 / 3 / 4 / 3 | [docs/test-results/runtime-control-replay/portable-tests\.log](../docs/test-results/runtime-control-replay/portable-tests.log)、[docs/test-results/runtime-control-replay/runtime-proof\.json](../docs/test-results/runtime-control-replay/runtime-proof.json)、[docs/test-results/runtime-control-replay/engine-tests-final\.log](../docs/test-results/runtime-control-replay/engine-tests-final.log) |
| 可移植 JS 语义 | **scene-runtime-query\.mjs：稳定身份与采样观察核心**；可选control进度/positionStep与pushSample；旧DTO逐字段保持，来源冻结且查询分离。 | 4 / 3 / 4 / 3 | [docs/test-results/runtime-control-replay/portable-tests\.log](../docs/test-results/runtime-control-replay/portable-tests.log)、[docs/test-results/runtime-control-replay/cli-tests-final\.log](../docs/test-results/runtime-control-replay/cli-tests-final.log)、[docs/test-results/runtime-control-replay/host-ui-tests\.log](../docs/test-results/runtime-control-replay/host-ui-tests.log) |
| 本机服务与适配 | **node-execution-backends\.mjs / node-project-build\.mjs：可信注册、输出与冻结编排**；冻结程序SHA/独立会话与strict HTTP/CLI，仅可信描述符数据参数；取消/错误保留有效样本。 | 4 / 3 / 4 / 3 | [docs/test-results/runtime-control-replay/cli-tests-final\.log](../docs/test-results/runtime-control-replay/cli-tests-final.log)、[docs/test-results/runtime-control-replay/host-ui-tests\.log](../docs/test-results/runtime-control-replay/host-ui-tests.log)、[docs/test-results/runtime-control-replay/browser-final/browser\.json](../docs/test-results/runtime-control-replay/browser-final/browser.json) |
| 执行后端 | **control-runtime\.gd / control\.tscn：独立Godot固定步控制驱动**；Godot独立可信控制驱动消费bool程序并报告固定步trace，原5/GDS2文件保持。 | 3 / 3 / 3 / 3 | [docs/test-results/runtime-control-replay/engine-tests-final\.log](../docs/test-results/runtime-control-replay/engine-tests-final.log)、[docs/test-results/runtime-control-replay/cli-tests-final\.log](../docs/test-results/runtime-control-replay/cli-tests-final.log)、[docs/test-results/runtime-control-replay/browser-final/browser\.json](../docs/test-results/runtime-control-replay/browser-final/browser.json) |
| 执行后端 | **viento-bevy-runtime：锁定Bevy的可信无头ECS程序**；Bevy可信ECS工具0\.3\.0执行同程序、jointbudget和稳定实例trace，不编译作者Rust。 | 3 / 3 / 3 / 3 | [docs/test-results/runtime-control-replay/runtime-proof\.json](../docs/test-results/runtime-control-replay/runtime-proof.json)、[docs/test-results/runtime-control-replay/engine-tests-final\.log](../docs/test-results/runtime-control-replay/engine-tests-final.log)、[docs/test-results/runtime-control-replay/cli-tests-final\.log](../docs/test-results/runtime-control-replay/cli-tests-final.log) |
| 交互与渲染 | **app-project-build\.js**；独立回放/JSON editor按cap与plan/budget开放，消费host步骤观察和安全三语labels；旧runpayload保持。 | 4 / 3 / 3 / 3 | [docs/test-results/runtime-control-replay/host-ui-tests\.log](../docs/test-results/runtime-control-replay/host-ui-tests.log)、[docs/test-results/runtime-control-replay/browser-final/browser\.json](../docs/test-results/runtime-control-replay/browser-final/browser.json)、[docs/test-results/runtime-control-replay/packaged-resources\.json](../docs/test-results/runtime-control-replay/packaged-resources.json) |

平台：Linux本机编辑服务/CLI；实际浏览器与准备资源分别记录、Android只复用pure规则，未接执行器/界面/设备、Tauri新安装与窗口未验收。边界：0.0.8源码交付；只支持 runtime.control-replay capability、无作者行为 scene2d plan/runtime1/2、有限 headless；window/capture/interactive/plan3拒绝。；viento-runtime-control schema1 只有 fixedDelta 与 steps 的四向精确bool；1..64步，0<dt<=.25秒，总时长<=8秒，最后全释放；actors*steps<=1024联合预算执行前拒绝。 本功能保留schema1全局基础；schema2的独立实例路由另见runtime.instance_control。；纯模块不执行访问器、不接原型/隐藏字段/稀疏数组/循环/paths/Entity，输入分离深冻结；host记录canonicalJSON SHA、程序与有效样本。；VIENTO_TRACE schema1 按连续0基stepIndex返回全体actor身份/有限position/idle|moving；只在validready与finished之间，结束步长/演员值必须匹配程序与lastsample。；runtime与trace逐行原序，不先处理整块finished；无效结束不覆盖样本，取消/错误不补造完成；旧no-control观察和默认smoke保留。；Godot独立可信控制驱动保留原5文件/GDS行为2文件；Bevy可信工具0.3.0处理自身ECS，固定Bevy0.19.1、不编译作者Rust；工具/bin不进作者迁移包。；schema1 CLI只run可选16KiB JSON文件；HTTP只run新增controlProgram数据，UI编辑/进度/三语步骤样本与草稿守护；没有stdin、RPC、实时键盘、反射、渲染/GPU、安装或Android执行器。。

下一步：schema1全局基础保持；按实例有限输入另列runtime.instance_control。独立behavior.bevy_rust暂不接此有限回放；Rust行为回放、实时采样、运行资源、窗口输入和规模仍分别验收。

<a id="runtime.instance_control"></a>
### 按实例独立有限输入与稀疏步骤路由

`runtime.instance_control` · 场景与构建 · 源码交付

入口：已验证冻结plan2 → 输入示例的目标/显式生成输入示例或JSON → 控制回放；CLI run --control-program schema2

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **scene-control-program\.mjs：有限程序及原序trace准入**；schema2严格分离冻结、目标提前检查、双预算；原trace逐行准入共用，无移动模拟。 | 4 / 3 / 4 / 3 | [docs/test-results/runtime-instance-control/portable-tests-final\.log](../docs/test-results/runtime-instance-control/portable-tests-final.log)、[docs/test-results/runtime-instance-control/browser-final/browser\.json](../docs/test-results/runtime-instance-control/browser-final/browser.json)、[docs/test-results/runtime-instance-control/packaged-resources\.json](../docs/test-results/runtime-instance-control/packaged-resources.json) |
| 可移植 JS 语义 | **scene-runtime-query\.mjs：稳定身份与采样观察核心**；observer构造复用schema2 plan校验，fulltrace/control摘要与旧DTO保留，位置仍从后端准入帧记录。 | 4 / 3 / 4 / 3 | [docs/test-results/runtime-instance-control/portable-tests-final\.log](../docs/test-results/runtime-instance-control/portable-tests-final.log)、[docs/test-results/runtime-instance-control/browser-final/browser\.json](../docs/test-results/runtime-instance-control/browser-final/browser.json)、[docs/test-results/runtime-instance-control/packaged-resources\.json](../docs/test-results/runtime-instance-control/packaged-resources.json) |
| 本机服务与适配 | **node-execution-backends\.mjs / node-project-build\.mjs：可信注册、输出与冻结编排**；owned frozen实例目标缓存、双capability与SHA/样本绑定，未知目标提前拒绝；CLI16/256KiB和独立会话保持。 | 4 / 3 / 4 / 3 | [docs/test-results/runtime-instance-control/engine-tests-final\.log](../docs/test-results/runtime-instance-control/engine-tests-final.log)、[docs/test-results/runtime-instance-control/cli-tests\.log](../docs/test-results/runtime-instance-control/cli-tests.log)、[docs/test-results/runtime-instance-control/browser-final/browser\.json](../docs/test-results/runtime-instance-control/browser-final/browser.json) |
| 执行后端 | **control-runtime\.gd / control\.tscn：独立Godot固定步控制驱动**；Godot0\.5\.0可信GDS control driver按step instanceId路由与release未列，旧生成/行为文件字节保持。 | 3 / 3 / 3 / 3 | [docs/test-results/runtime-instance-control/engine-tests-final\.log](../docs/test-results/runtime-instance-control/engine-tests-final.log)、[docs/test-results/runtime-instance-control/cli-tests\.log](../docs/test-results/runtime-instance-control/cli-tests.log)、[docs/test-results/runtime-instance-control/browser-final/browser\.json](../docs/test-results/runtime-instance-control/browser-final/browser.json) |
| 执行后端 | **viento-bevy-runtime：锁定Bevy的可信无头ECS程序**；Bevy0\.3\.0可信ECS工具按稳定instanceId每步方向与release，独立验证原生输入/预算，不编译作者Rust。 | 3 / 3 / 3 / 3 | [docs/test-results/runtime-instance-control/engine-tests-final\.log](../docs/test-results/runtime-instance-control/engine-tests-final.log)、[docs/test-results/runtime-instance-control/runtime-proof\.json](../docs/test-results/runtime-instance-control/runtime-proof.json)、[docs/test-results/runtime-instance-control/browser-final/browser\.json](../docs/test-results/runtime-instance-control/browser-final/browser.json) |
| 交互与渲染 | **app-project-build\.js**；当前ownedbuild目标列表（末尾UUID短标识在前，title及value完整）、显式生成schema2示例与JSON保留、未知实例本地拒绝、三语提示和完整步骤观察。 | 4 / 3 / 3 / 3 | [docs/test-results/runtime-instance-control/browser-final/browser\.json](../docs/test-results/runtime-instance-control/browser-final/browser.json)、[docs/test-results/runtime-instance-control/packaged-resources\.json](../docs/test-results/runtime-instance-control/packaged-resources.json)、[docs/test-results/runtime-instance-control/results\.json](../docs/test-results/runtime-instance-control/results.json) |

平台：Linux本机CLI/编辑服务，实际两引擎/浏览器/准备资源证据分列、Android仅pure规则复用，无执行器/UI/设备验收、Tauri新安装与窗口未验收。边界：0.0.8源码交付；同时要求runtime.control-replay及runtime.control-replay.instances、无行为冻结plan/runtime2、有限headless；plan1即使empty inputs也拒绝，plan3/window/capture/interactive不支持。；viento-runtime-control schema2精确顶层format/schemaVersion/fixedDelta/steps；每步精确inputs，每行instanceId+四向bool；0..128行/步，总输入行<=1024，1..64步、0<dt<=.25、总时长<=8、最后inputs空或每行全false。；instanceId只准入冻结plan2实际实例集合；same-step重复拒绝、跨step可重复，定义UUID不能冒充实例，未知目标runtime_control_target_missing；合法实际instanceId与objectId相同仍按成员判断。；每步未列实例全部释放，不粘住上一输入；controls none/零速度保持原规则；具体移动/归一化在受信任Godot或Bevy runtime，可移植层只验证数据/身份/预算/trace。；actors*steps<=1024继续独立检查，因为每步trace返回全部冻结演员；trace schema1/protocol2及观察control/positionStep形状不变，无程序旧DTO与schema1全局语义保持。；CLI schema2控制文件<=256KiB，schema1旧16KiB限制保留；host记录冻结规范程序SHA及有效样本，verifiedownedbuild持有中立controlTargets；HTTP不接作者路径/工具/code/Entity，未知目标在启动任务前拒绝。；Godot adapter0.5.0用独立可信GDS driver；Bevy adapter/native0.3.0锁Bevy0.19.1，工具升级需重建；旧Godot5/GDS2/WASM2及历史证据原字节保留。；UI实例列表以instanceId末尾8位在前、name在后，窄屏区分同名/同前缀实例；title及实际值保留完整instanceId；选择目标不改JSON，显式生成才替换为已验证四步示例；poll/reopen/locale保留输入与草稿守护，不写作者工程。；仅有限按实例方向输入；没有实时输入／RPC／反射／运行组件修改、渲染／GPU、跨会话恢复、Tauri新安装或Android执行器。独立Rust作者通道behavior.bevy_rust尚未接入这条按实例回放路径。。

下一步：保持有限路由和完整采样的共同粒度；类型化事件、资源、实时采样与可变组件只有出现实际共同需求才另立契约。

<a id="execution.tool_identity"></a>
### 可信工具身份检查、状态DTO与候选失效

`execution.tool_identity` · 场景与构建 · 源码交付

入口：工作台“检查工具身份” → POST /api/project-build 精确action:tool-check；源码CLI --command tool-check → 同一可信host probe

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **execution-tool-status\.mjs：纯数据工具状态契约**；严格纯状态准入/冻结，同一DTO供Node与浏览器消费，拒路径/代码/访问器/污染；pending不携身份。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-tool-probe/results\.json](../docs/test-results/runtime-tool-probe/results.json)、[docs/test-results/runtime-tool-probe/core-probe-tests\.log](../docs/test-results/runtime-tool-probe/core-probe-tests.log)、[docs/test-results/runtime-tool-probe/packaged-resources\.json](../docs/test-results/runtime-tool-probe/packaged-resources.json) |
| 本机服务与适配 | **node-execution-tool-probe\.mjs：可信身份探测与候选签名**；固定host工具的无进程候选观察、显式adapter\.identify、总预算/取消与候选前后核对，只输出中立身份。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-tool-probe/results\.json](../docs/test-results/runtime-tool-probe/results.json)、[docs/test-results/runtime-tool-probe/engine-probes\.log](../docs/test-results/runtime-tool-probe/engine-probes.log)、[docs/test-results/runtime-tool-probe/core-probe-tests\.log](../docs/test-results/runtime-tool-probe/core-probe-tests.log) |
| 本机服务与适配 | **project-build-service\.mjs / build-process\.mjs 等**；精确tool-check鉴权、单owned检查/构建槽、会话缓存与关闭回收；不覆盖job/最新产物/计划或作者树，执行仍重新识别。 成功catalog\+owned构建/运行的来源离线只读降级；新plan/build仍fresh源并提前拒绝。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-tool-probe/results\.json](../docs/test-results/runtime-tool-probe/results.json)、[docs/test-results/runtime-tool-probe/core-probe-tests\.log](../docs/test-results/runtime-tool-probe/core-probe-tests.log)、[docs/test-results/runtime-tool-probe/browser/browser\.json](../docs/test-results/runtime-tool-probe/browser/browser.json) |
| 交互与渲染 | **app-project-build\.js**；显式检查及三语受控状态文本，纯DTO/backend核对、dirty草稿和旧无DTO兼容、checking与请求归属守护，丢响应只GET。 来源不可读提示与工具身份分开，源问题只阻止新计划/构建。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-tool-probe/results\.json](../docs/test-results/runtime-tool-probe/results.json)、[docs/test-results/runtime-tool-probe/core-probe-tests\.log](../docs/test-results/runtime-tool-probe/core-probe-tests.log)、[docs/test-results/runtime-tool-probe/browser/browser\.json](../docs/test-results/runtime-tool-probe/browser/browser.json) |
| 验证与维护 | **node-execution-tool\.mjs / project-build\.mjs：可信host和CLI后端选择**；独立源码CLI工具检查：仅固定注册host backend/tool与有界deadline，不打开作者工程、不生成场景输出。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-tool-probe/results\.json](../docs/test-results/runtime-tool-probe/results.json)、[docs/test-results/runtime-tool-probe/engine-probes\.log](../docs/test-results/runtime-tool-probe/engine-probes.log)、[docs/test-results/runtime-tool-probe/core-probe-tests\.log](../docs/test-results/runtime-tool-probe/core-probe-tests.log) |
| 执行后端 | **Bevy Rust 独立适配器：固定工具链、离线编译、诊断与临时回收**；固定Cargo/rustc1\.95\.0及两者字节身份，拒代理和工具漂移，复用现有identify与冻结守护。 | 3 / 3 / 3 / 2 | [docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser\.json](../docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser.json)、[docs/test-results/bevy-rust-behaviors/app-check\.log](../docs/test-results/bevy-rust-behaviors/app-check.log)、[docs/test-results/bevy-rust-behaviors/adapter-final-after-json\.log](../docs/test-results/bevy-rust-behaviors/adapter-final-after-json.log) |

平台：Linux可信CLI/本机编辑服务与工作台；实测范围独立报告、可移植DTO可准备到桌面/移动资源，无Android检查或执行入口、新Tauri安装/窗口与其他目标设备未验收。边界：0.0.9源码交付；原0.0.8阶段协议与边界保留。原专题在0.0.8之后、0.0.9交付前核验；工具检查与构建/运行分别准入，ready只记录检查时身份，不审批场景、授权执行、生成输出或自动重建。；viento-execution-tool-status schema1精确format/schemaVersion/backendId/status/reason/identity；unchecked/checking/ready/unavailable，只有ready携带version/完整二进制SHA256裸64hex/platform/arch；严格分离冻结、拒额外字段/getter/污染，DTO无路径、原始日志或执行代码。；GET只观察文件X_OK、解析路径及stat，绝不启动子进程；候选key仅宿主私有，基于realpath/dev/ino/size/mtimeNs/ctimeNs/mode，改变时会话缓存回到unchecked，不隐式探测。未检查候选沿旧available兼容行为，显式失败后available=false，成功重检恢复。；显式探测复用固定可信adapter.identify，不另写版本兼容规则；12s总终止预算覆盖候选与identify，子进程既有10s/合并输出1MiB、二进制读取512MiB上限保持；abort后等待回收而非遗留Promise.race，取消/超时或前后候选改变均不得缓存ready。；POST只允许{action:tool-check}，沿本机编辑鉴权，拒scene/backend/tool/path/output等附加字段；一个service同时一个检查或构建任务，close取消并等待检查。HTTP断开或网页关面板不取消宿主探测，完成结果须仍属同owner/未关闭service。；检查不创建/替换job/latestBuild，不改计划批准、运行样本、作者文件或草稿；构建和运行继续fresh identify，对照冻结工具版本/SHA与adapter/产物/来源守护，成功检查不能绕过runtime_tool_changed重建要求。；工作台消费同一纯DTO并核对backendId，旧服务无DTO隐藏检查入口；中英日文本与checking提示，dirty/creating草稿可检查但不保存/丢弃，异步请求守护和响应丢失只读刷新不重复发起检查。；独立CLI只接受固定已注册backend、可信host工具配置及1..12000ms预算，不读作者工程、不接场景/输出/控制程序/window/capture/interactive输入；ok按ready判断，公共JSON无本机路径。；Godot adapter0.5.0、Bevy adapter/native0.3.0/Bevy0.19.1、注册器及旧Godot/GDS/native/WASM冻结生成器不改；新辅助层不改变历史executionAdapter指纹、runtime/作者协议或增加第八种执行操作。；已成功读取catalog并拥有本会话已验证构建或其owned运行后，作者源暂不可读可只读降级至缓存目录，catalogDiagnostic仅返回固定code=build_catalog_unavailable；run/inspect/cancel/tool-check继续服务冻结产物。plan/build仍强制读取当前源，失败在创建job前拒绝；没有成功catalog或owned产物不能借此降级，恢复后的成功刷新清除诊断。UI来源提示独立于工具状态，仅阻止新的计划/构建，不把工具ready或冻结运行观察覆盖为源错误。；能力范围仅Linux本机检查；资源准备/纯DTO复用不表示Android工具执行器、Tauri新安装/窗口、Windows/macOS设备或新发行验收。；Bevy Rust工作树增量通过同一identify端口固定具体Cargo／rustc1.95.0，拒rustup代理；Cargo字节SHA与含rustc摘要的版本身份进入现有冻结守护，新适配行不提升旧安装或跨平台分数。。

下一步：继续按真实共同需求补工具诊断和目标平台验收；检查时身份不得取代运行前重新校验和冻结产物重建守护。

<a id="runtime.verification_cases"></a>
### 有限运行验收用例与步骤预期评判

`runtime.verification_cases` · 场景与构建 · 源码交付

入口：工作台编辑／明确生成用例→运行验收；CLI run --runtime-case；owned HTTP runtimeCase纯数据

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **runtime-verification-case\.mjs：纯用例准入与样本评判**；纯case严格分离冻结、目标/预算与samples评判；引擎完成事实由host传入，不模拟移动或执行。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-verification-cases/results\.json](../docs/test-results/runtime-verification-cases/results.json)、[docs/test-results/runtime-verification-cases/browser/browser\.json](../docs/test-results/runtime-verification-cases/browser/browser.json)、[docs/test-results/runtime-verification-cases/packaged-resources\.json](../docs/test-results/runtime-verification-cases/packaged-resources.json) |
| 本机服务与适配 | **node-project-build\.mjs**；通用冻结executor组合控制与真实采样，独立caseSHA/记录；断言失败和取消持久化分别处理。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-verification-cases/results\.json](../docs/test-results/runtime-verification-cases/results.json)、[docs/test-results/runtime-verification-cases/browser/browser\.json](../docs/test-results/runtime-verification-cases/browser/browser.json)、[docs/test-results/runtime-verification-cases/packaged-resources\.json](../docs/test-results/runtime-verification-cases/packaged-resources.json) |
| 本机服务与适配 | **project-build-service\.mjs / build-process\.mjs 等**；owned单槽精确payload、beforeawait分离与prejob目标准入、commit点和独立verification。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-verification-cases/results\.json](../docs/test-results/runtime-verification-cases/results.json)、[docs/test-results/runtime-verification-cases/browser/browser\.json](../docs/test-results/runtime-verification-cases/browser/browser.json)、[docs/test-results/runtime-verification-cases/packaged-resources\.json](../docs/test-results/runtime-verification-cases/packaged-resources.json) |
| 交互与渲染 | **app-project-build\.js**；明确JSON/完整采样baseline生成、三语逐行显示和纯评判再次校验；不自动写作者，文本/光标守护。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-verification-cases/results\.json](../docs/test-results/runtime-verification-cases/results.json)、[docs/test-results/runtime-verification-cases/browser/browser\.json](../docs/test-results/runtime-verification-cases/browser/browser.json)、[docs/test-results/runtime-verification-cases/packaged-resources\.json](../docs/test-results/runtime-verification-cases/packaged-resources.json) |
| 验证与维护 | **node-execution-tool\.mjs / project-build\.mjs：可信host和CLI后端选择**；源码CLI只finiteheadless/regular256KiB case，与control程序/窗口/非run互斥；冻结来源。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-verification-cases/results\.json](../docs/test-results/runtime-verification-cases/results.json)、[docs/test-results/runtime-verification-cases/browser/browser\.json](../docs/test-results/runtime-verification-cases/browser/browser.json)、[docs/test-results/runtime-verification-cases/packaged-resources\.json](../docs/test-results/runtime-verification-cases/packaged-resources.json) |

平台：Linux固定可信Godot/Bevy CLI与本机GUI服务、可移植pure DTO/评判可准备到桌面/移动资源、安装Tauri/Android设备未验收。边界：0.0.9源码交付；原0.0.8阶段协议与边界保留。原专题在0.0.8之后、0.0.9交付前核验；仅无行为冻结plan2、control program1/2、真实有限无头运行；旧plan1控制与所有旧作者/计划/trace/adapter/native/WASM不变。；纯viento-runtime-case schema1精确format/schemaVersion/program/checks；1–128稳定实例+零基步骤检查，至少position或state，重复实例步拒绝；position精确value[有限x,y]+有限非负显式tolerance，逐轴绝对差<=tol，无隐藏epsilon或模拟运动。；复用控制原预算/目标与严格trace；每步全体定义/实例配对且连续0起prefix，纯评判再审查样本，不伪造ready/finished/缺样本/引擎事实，不携路径/代码/后端/Entity。；complete只由可信宿主成功且完整运行确认；passed/failed/incomplete独立于执行status；cancel/timeout/protocolfailed或缺样本整体incomplete，逐行保留已观察actual/expected/比较，缺失unavailable。；host预FS验证输入/互斥finiteheadless，冻结plan目标在identify和session前准入；控制program与case各canonicalSHA，session追加verification但不改作者/生成库存；最终保存中的取消也持久化cancelled/incomplete，service用已完成record作为结果提交点。；service只owned build/headless/case数据、beforeawait分离与beforejobslot准入；CLI regular256KiB用例，互斥control-program/window/capture/interactive与非run/tool-check，JSON文件不接最终symlink。；GUI独立文本保留poll/lang/reopen选区，中英日显示执行与逐行验收；显式从owned成功完整control末步采样生成位置/state检查，tol0.0001，生成会覆盖输入但不自动学期望或写作者。；可移植JS契约与宿主执行/GUI分开；准备mobile仅纯case/control模块及已准入desktop数据评判，非Android执行或设备验收。。

下一步：分别定义工程内用例登记／保存／迁移、更广运行观察和作者行为检查；保留真实引擎完成与预期比较的边界。

<a id="runtime.case_documents"></a>
### 工程验收用例保存、重用与稳定身份迁移

`runtime.case_documents` · 场景与构建 · 源码交付

入口：工程验收用例→刷新/明确载入/保存/另存→资源包或完整迁移→同场景冻结运行；CLI兼容包装

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **runtime-case-document\.mjs：可移植工程包装与场景绑定**；纯工程文档识别、case分离与场景/实例/定义依赖守护；不读文件或模拟运行。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-documents/results\.json](../docs/test-results/runtime-case-documents/results.json)、[docs/test-results/runtime-case-documents/browser/browser\.json](../docs/test-results/runtime-case-documents/browser/browser.json)、[docs/test-results/runtime-case-documents/packaged-resources\.json](../docs/test-results/runtime-case-documents/packaged-resources.json) |
| 本机服务与适配 | **runtime-case-documents\.mjs：fresh作者目录与原子保存守护**；fresh作者catalog/load/save，双修订与publication再观察，既有事务复用。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-documents/results\.json](../docs/test-results/runtime-case-documents/results.json)、[docs/test-results/runtime-case-documents/browser/browser\.json](../docs/test-results/runtime-case-documents/browser/browser.json)、[docs/test-results/runtime-case-documents/packaged-resources\.json](../docs/test-results/runtime-case-documents/packaged-resources.json) |
| 存储与事务 | **node-document-storage\.mjs**；普通原子文档writer的可选发布守护；case新登记失败仅回滚本次descriptor。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-documents/results\.json](../docs/test-results/runtime-case-documents/results.json)、[docs/test-results/runtime-case-documents/browser/browser\.json](../docs/test-results/runtime-case-documents/browser/browser.json)、[docs/test-results/runtime-case-documents/packaged-resources\.json](../docs/test-results/runtime-case-documents/packaged-resources.json) |
| 交互与渲染 | **app-runtime-case-documents\.js：独立用例文档交互**；独立用例文档controller、auth headers、显式载入和写入、迟到回执/草稿守护。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-documents/results\.json](../docs/test-results/runtime-case-documents/results.json)、[docs/test-results/runtime-case-documents/browser/browser\.json](../docs/test-results/runtime-case-documents/browser/browser.json)、[docs/test-results/runtime-case-documents/packaged-resources\.json](../docs/test-results/runtime-case-documents/packaged-resources.json) |
| 交互与渲染 | **app-project-build\.js**；构建工作台传递scene/context和纯case，冻结运行与作者保存分别准入。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-documents/results\.json](../docs/test-results/runtime-case-documents/results.json)、[docs/test-results/runtime-case-documents/browser/browser\.json](../docs/test-results/runtime-case-documents/browser/browser.json)、[docs/test-results/runtime-case-documents/packaged-resources\.json](../docs/test-results/runtime-case-documents/packaged-resources.json) |
| 存储与事务 | **resource-package-service\.mjs / resource-package-export\.mjs 等**；选择包source-derived依赖与optional scenechildren、requirements/真实target核验及字节稳定迁移。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-documents/results\.json](../docs/test-results/runtime-case-documents/results.json)、[docs/test-results/runtime-case-documents/browser/browser\.json](../docs/test-results/runtime-case-documents/browser/browser.json)、[docs/test-results/runtime-case-documents/packaged-resources\.json](../docs/test-results/runtime-case-documents/packaged-resources.json) |
| 验证与维护 | **node-execution-tool\.mjs / project-build\.mjs：可信host和CLI后端选择**；CLI兼容原case与保存包装，scene绑定守护与旧有限模式/文件边界。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-documents/results\.json](../docs/test-results/runtime-case-documents/results.json)、[docs/test-results/runtime-case-documents/browser/browser\.json](../docs/test-results/runtime-case-documents/browser/browser.json)、[docs/test-results/runtime-case-documents/packaged-resources\.json](../docs/test-results/runtime-case-documents/packaged-resources.json) |

平台：Linux本机作者服务、工作台与可信Godot/Bevy CLI、纯模块可准备到移动资源；无Android引擎服务、未更新安装包或验收Tauri/设备。边界：0.0.9源码交付；原0.0.8阶段协议与边界保留。原专题在0.0.8之后、0.0.9交付前核验；作者文档与原运行case分离，原场景/计划/控制/trace/native/WASM及adapter不变。；严格四字段viento-runtime-case-document schema1，sceneObjectId唯一关联权威，case原DTO；256KiB UTF8/重复键/结构/稳定实例与定义登记边检查。；普通文档UUID/类型登记与原子正文写，source SHA CAS及scene SHA/record在publish前再观察；拒force及互斥create/update，失败撤回本操作descriptor/临时正文，精确原文保持。；新独立GUI文档控制器，显式fresh catalog/load/save/new，token仅authheaders，错误/冲突/late响应保留草稿和光标；pending save关闭标未确认，readonly关闭不标；三语窄屏。；正文派生case→scene依赖、scene可选children；catalog/reader/import检查声明、instance/definition边和目标hash，只有已声明pinned requirement availability在reader延期，import完整复查。；路径迁移保留全部UUID/BOM/CRLF/作者字节，无UUID clone/自动预期学习；完整archive保留损坏可修正文，selective package拒不完整用例。；保存与引擎任务槽解耦，fresh作者读取不能用frozen缓存代替；已载入纯case可sourceoffline对同scene frozen运行，scene绑定不符在job/session前拒。；准备桌面实际Node/双引擎与原生完整归档；移动仅可移植规则与准入desktop采样，不是Android执行/界面/安装验收。。

下一步：分别定义用例分组、批量验收、作者行为和更丰富运行观察；不从稳定ID迁移推导UUID克隆或跨引擎任意脚本转换。

<a id="runtime.case_suites"></a>
### 同场景有序验收组与宿主批次调度

`runtime.case_suites` · 场景与构建 · 源码交付

入口：已保存用例→按顺序选入/保存组→owned suite-run→成员结果/取消；CLI --runtime-suite

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **runtime-case-suite\.mjs：纯组准入、依赖、联合预算与汇总**；组成员、共享场景准入、联合预算与独立结果汇总 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-suites/results\.json](../docs/test-results/runtime-case-suites/results.json)、[docs/test-results/runtime-case-suites/browser/browser\.json](../docs/test-results/runtime-case-suites/browser/browser.json)、[docs/test-results/runtime-case-suites/packaged-resources\.json](../docs/test-results/runtime-case-suites/packaged-resources.json) |
| 可移植 JS 语义 | **runtime-case-document\.mjs：可移植工程包装与场景绑定**；沿用原用例绑定及抽出的共享场景依赖检查 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-suites/results\.json](../docs/test-results/runtime-case-suites/results.json)、[docs/test-results/runtime-case-suites/browser/browser\.json](../docs/test-results/runtime-case-suites/browser/browser.json)、[docs/test-results/runtime-case-suites/packaged-resources\.json](../docs/test-results/runtime-case-suites/packaged-resources.json) |
| 本机服务与适配 | **runtime-author-documents / runtime-case-suites：共享作者守护与整批捕获**；复用原作者原子保存和修订保护，一次捕获全体成员 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-suites/results\.json](../docs/test-results/runtime-case-suites/results.json)、[docs/test-results/runtime-case-suites/browser/browser\.json](../docs/test-results/runtime-case-suites/browser/browser.json)、[docs/test-results/runtime-case-suites/packaged-resources\.json](../docs/test-results/runtime-case-suites/packaged-resources.json) |
| 本机服务与适配 | **node-runtime-case-suite\.mjs：复用有限会话的宿主顺序调度**；宿主顺序旧无头会话、取消等待退出和独立回执 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-suites/results\.json](../docs/test-results/runtime-case-suites/results.json)、[docs/test-results/runtime-case-suites/browser/browser\.json](../docs/test-results/runtime-case-suites/browser/browser.json)、[docs/test-results/runtime-case-suites/packaged-resources\.json](../docs/test-results/runtime-case-suites/packaged-resources.json) |
| 本机服务与适配 | **node-execution-backends\.mjs / node-project-build\.mjs：可信注册、输出与冻结编排**；构建/快照共同验证与owner准入复查，旧后端执行器不改 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-suites/results\.json](../docs/test-results/runtime-case-suites/results.json)、[docs/test-results/runtime-case-suites/browser/browser\.json](../docs/test-results/runtime-case-suites/browser/browser.json)、[docs/test-results/runtime-case-suites/packaged-resources\.json](../docs/test-results/runtime-case-suites/packaged-resources.json) |
| 存储与事务 | **resource-package-service\.mjs / resource-package-export\.mjs 等**；组→成员→场景闭包、requirements/目标字节核验与路径稳定迁移 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-suites/results\.json](../docs/test-results/runtime-case-suites/results.json)、[docs/test-results/runtime-case-suites/browser/browser\.json](../docs/test-results/runtime-case-suites/browser/browser.json)、[docs/test-results/runtime-case-suites/packaged-resources\.json](../docs/test-results/runtime-case-suites/packaged-resources.json) |
| 交互与渲染 | **app-runtime-case-suites\.js：独立组编辑与进度展示**；显式有序成员/保存/载入/另存及批次结果，保留未知回执状态 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-suites/results\.json](../docs/test-results/runtime-case-suites/results.json)、[docs/test-results/runtime-case-suites/browser/browser\.json](../docs/test-results/runtime-case-suites/browser/browser.json)、[docs/test-results/runtime-case-suites/packaged-resources\.json](../docs/test-results/runtime-case-suites/packaged-resources.json) |
| 交互与渲染 | **app-project-build\.js**；父工作台只调用宿主批次与状态轮询，单case生成严格区分 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-suites/results\.json](../docs/test-results/runtime-case-suites/results.json)、[docs/test-results/runtime-case-suites/browser/browser\.json](../docs/test-results/runtime-case-suites/browser/browser.json)、[docs/test-results/runtime-case-suites/packaged-resources\.json](../docs/test-results/runtime-case-suites/packaged-resources.json) |
| 验证与维护 | **node-execution-tool\.mjs / project-build\.mjs：可信host和CLI后端选择**；CLI互斥组模式，注册UUID/相对path与可信工具边界 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-suites/results\.json](../docs/test-results/runtime-case-suites/results.json)、[docs/test-results/runtime-case-suites/browser/browser\.json](../docs/test-results/runtime-case-suites/browser/browser.json)、[docs/test-results/runtime-case-suites/packaged-resources\.json](../docs/test-results/runtime-case-suites/packaged-resources.json) |

平台：Linux本机workbench/Node/CLI可信Godot与Bevy、纯规则可准备到移动资源；不含Android引擎宿主、0.0.9源码交付；未验收新安装/设备。。边界：0.0.9源码交付；原0.0.8阶段协议与边界保留。原专题在0.0.8之后、0.0.9交付前核验；组与用例正文分开，原控制/trace/作者场景/plan/adapter/native/WASM保持。；严格四字段viento-runtime-case-suite schema1，16KiB、1–16同场景注册JSON成员、稳定UUID有序不重复；actor×总steps≤4096/总checks≤1024，全部预检后才分配job。；共享场景准入在成员正文延期时仍检查包内已知scene，reader只声明requirements缺正文延期，import真实目标再核验；完整迁移/路径变化保持原字节与UUID。；共享作者writer复用原登记锁、原子正文、source/scene SHA与publication guards；fresh组/成员来源，GUI显式保存/载入/另存，未知回执阻止重复写。；Node一次捕获所有成员与版本，逐成员复用现有headless executor，每份再检查frozen build/snapshot/tool；等待时被prune的owner在job前拒绝。；断言failed继续，进程/协议失败、timeout/cancel停余项为not-run；保持partial samples，等待reap释放唯一slot；final committed结果不被迟到cancel重写。；独立suite缓存原子receipt记录顺序/版本/session/counts，执行status与汇总status分开；GUI不启动队列、不从suite last samples生成单case。；真实Linux Chrome及prepared Node/Godot/Bevy/native archive限定验证；mobile仅pure数据，不是Android执行/安装验收。。

下一步：分别定义更丰富状态检查、作者行为、嵌套或并行组；不推导自动更新预期、UUID克隆或引擎脚本互译。

<a id="runtime.case_reports"></a>
### 当前批次成员详情与独立报告导出

`runtime.case_reports` · 场景与构建 · 源码交付

入口：已完成suite成员→当前owned job/member只读回读→预期/实际详情→显式JSON下载

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **runtime-case-report\.mjs：严格便携报告与完整重新评价**；纯报告契约、完整重新评价和数据预算 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-reports/results\.json](../docs/test-results/runtime-case-reports/results.json)、[docs/test-results/runtime-case-reports/browser/browser\.json](../docs/test-results/runtime-case-reports/browser/browser.json)、[docs/test-results/runtime-case-reports/packaged-resources\.json](../docs/test-results/runtime-case-reports/packaged-resources.json) |
| 本机服务与适配 | **runtime-case-reports / project-build-service：可信文件pin和当前成员只读归属**；可信报告文件pin/稳定回读与当前任务归属 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-reports/results\.json](../docs/test-results/runtime-case-reports/results.json)、[docs/test-results/runtime-case-reports/browser/browser\.json](../docs/test-results/runtime-case-reports/browser/browser.json)、[docs/test-results/runtime-case-reports/packaged-resources\.json](../docs/test-results/runtime-case-reports/packaged-resources.json) |
| 本机服务与适配 | **node-runtime-case-suite\.mjs：复用有限会话的宿主顺序调度**；终态成员保存报告、保留断言及IO失败停止余项 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-reports/results\.json](../docs/test-results/runtime-case-reports/results.json)、[docs/test-results/runtime-case-reports/browser/browser\.json](../docs/test-results/runtime-case-reports/browser/browser.json)、[docs/test-results/runtime-case-reports/packaged-resources\.json](../docs/test-results/runtime-case-reports/packaged-resources.json) |
| 交互与渲染 | **app-runtime-case-report\.js：独立三语详情与显式JSON导出**；实例步骤预期/实际/容差及显式独立JSON下载 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-reports/results\.json](../docs/test-results/runtime-case-reports/results.json)、[docs/test-results/runtime-case-reports/browser/browser\.json](../docs/test-results/runtime-case-reports/browser/browser.json)、[docs/test-results/runtime-case-reports/packaged-resources\.json](../docs/test-results/runtime-case-reports/packaged-resources.json) |
| 交互与渲染 | **app-project-build\.js**；父工作台接详情callback，保持编辑稿/引擎任务独立 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-reports/results\.json](../docs/test-results/runtime-case-reports/results.json)、[docs/test-results/runtime-case-reports/browser/browser\.json](../docs/test-results/runtime-case-reports/browser/browser.json)、[docs/test-results/runtime-case-reports/packaged-resources\.json](../docs/test-results/runtime-case-reports/packaged-resources.json) |

平台：Linux本机workbench/Node可信Godot与Bevy、纯报告入口可准备到移动资源；没有Android报告宿主或引擎验收、0.0.9源码交付；未验收新安装/设备。。边界：0.0.9源码交付；原0.0.8阶段协议与边界保留。原专题在0.0.8之后、0.0.9交付前核验；report输出格式独立，不改作者case/suite/scene、plan/control/trace、adapter/native/WASM。；严格八字段viento-runtime-case-report schema1，十字段捕获上下文、实例目标、终态、原用例/采样与完整重新评价；UTF8 compact+newline≤2MiB，原64step/128actor/1024actor-step/128check预算。；纯validator只证明结构/评价一致，录入context为provenance，不能认证任意外部JSON的引擎执行或原作者字节；不合成事件/采样交错回放。；可信宿主固定member-UUID文件，wx0600临时+exclusive原子发布，读取拒绝符号链接/文件替换并核对rawSHA/context/definitionSHA；私有pin/路径不进入HTTP。；调度器保存committed叶结果后再发布reportAvailable；保存失败停止余项但保留真实execution/assertions/samples，末成员完整汇总不掩盖报告IO错误。；只允许当前service当前suite job/member UUID回读，不占执行slot、不读作者/工具/build；源离线/build被清理可读，新job/close/迟到owner拒绝，旧cache不扫描接管。；独立三语GUI核验context及public叶counts/state；可查看前面failed/partial报告，explicit Blob下载，不写草稿/自动预期，不导入外部report。；本轮实际Chrome/pinnedNode双引擎与mobile pure范围见results；无新installer/已安装Tauri/Androidhost或device。。

下一步：单独设计跨重启报告历史、缓存管理和批次报告包；更广状态预期与引擎行为能力沿原边界演进。

<a id="scene.composition_inheritance"></a>
### 单实例六字段恢复继承与原子混合补丁

`scene.composition_inheritance` · 场景与构建 · 源码交付

入口：当前配方预览的实例覆盖对话框→选择恢复/其他字段设置→完整候选检查→原文草稿应用→普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **scene\_composition\_patch\.rs：稳定目标的六字段保真覆盖补丁**；复用无状态Rust保真覆盖补丁，原子set/reset只作用稳定目标，最后条目删除保留空数组，不写文件。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-inheritance/core-tests\.log](../docs/test-results/scene-composition-inheritance/core-tests.log)、[docs/test-results/scene-composition-inheritance/focused-tests\.log](../docs/test-results/scene-composition-inheritance/focused-tests.log)、[docs/test-results/scene-composition-inheritance/boundary-review\.json](../docs/test-results/scene-composition-inheritance/boundary-review.json) |
| 可移植 JS 语义 | **scene-composition\.mjs / studio-core\.mjs：可移植组合调用与响应守护**；共享ABI以独立edit能力隔离旧set/expand；严格核对完整预期语义与输入/候选原文，不新增JS删除算法。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-inheritance/core-tests\.log](../docs/test-results/scene-composition-inheritance/core-tests.log)、[docs/test-results/scene-composition-inheritance/focused-tests\.log](../docs/test-results/scene-composition-inheritance/focused-tests.log)、[docs/test-results/scene-composition-inheritance/boundary-review\.json](../docs/test-results/scene-composition-inheritance/boundary-review.json) |
| 可移植 JS 语义 | **scene-composition-overrides\.mjs：绑定原文与预览的覆盖提案及复核**；恢复集合从实际覆盖自有键派生，混合提案排除重复set；来源摘要/保存基线/精确回执在apply重新核对。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-inheritance/core-tests\.log](../docs/test-results/scene-composition-inheritance/core-tests.log)、[docs/test-results/scene-composition-inheritance/focused-tests\.log](../docs/test-results/scene-composition-inheritance/focused-tests.log)、[docs/test-results/scene-composition-inheritance/boundary-review\.json](../docs/test-results/scene-composition-inheritance/boundary-review.json) |
| 交互与渲染 | **app-scene-composition-overrides\.js：实例覆盖检查与草稿应用对话框**；对六组显示恢复/取消恢复，位置/尺寸成对、保留旧输入，dirty/签名/批准含恢复选择；缺edit隐藏入口。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-inheritance/core-tests\.log](../docs/test-results/scene-composition-inheritance/core-tests.log)、[docs/test-results/scene-composition-inheritance/focused-tests\.log](../docs/test-results/scene-composition-inheritance/focused-tests.log)、[docs/test-results/scene-composition-inheritance/boundary-review\.json](../docs/test-results/scene-composition-inheritance/boundary-review.json) |
| 交互与渲染 | **app-source-location\.js / app-runtime\.js / app-scene-preview\.js**；复用父预览完整候选与主编辑器live来源守护，仅内存应用，再普通保存；依赖/冲突/过期保持草稿。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-inheritance/core-tests\.log](../docs/test-results/scene-composition-inheritance/core-tests.log)、[docs/test-results/scene-composition-inheritance/focused-tests\.log](../docs/test-results/scene-composition-inheritance/focused-tests.log)、[docs/test-results/scene-composition-inheritance/boundary-review\.json](../docs/test-results/scene-composition-inheritance/boundary-review.json) |

平台：Linux本机编辑服务与Chrome三语配方源码草稿；Rust原生与WASM共享补丁、准备资源和移动纯模块范围按本轮结果；无Android恢复宿主/界面或设备验收。边界：0.0.10源码交付；独立于既有场景组合的单实例六字段恢复能力，原recipe/World/Scene2D/运行协议保持。；六字段position/size/color/speed/controls/imageResourceId按稳定placementId+actorKey定位，位置和尺寸各整体恢复；set与reset互斥且原子，changedPaths使用输入覆盖索引及固定字段顺序。；只删除当前实例实际覆盖键，最后值删除时移除该演员覆盖条目并保留overrides数组；不存在键的reset不创建空覆盖，显式图片null仍为不用图片，与字段删除恢复片段/投影分开。；Rust严格重验输入/候选及128KiB预算，保真删除键值或条目及必要分隔符，其他片段/实例/身份/组/偏移/字节不变；不做I/O或布局会话。；独立viento_core_scene_composition_edit_version()==1与supportsStudioCoreCompositionEdit；缺新edit保留旧set/expand/source/geometry，原请求/提案形状无reset时不变，坏ABI回执关闭runtime。；可移植propose排除选中reset字段的set，完整候选预览重新解析继承与依赖；GUI不猜继承值，显示恢复前输入并可取消恢复，选择进入dirty/签名/批准失效守护。；父预览与主编辑器继续复查当前源码/path/token/hash/保存基线，仅内存应用；取消/迟到/过期/缺依赖不写作者数据，普通保存负责持久化和外部冲突。；原生与WASM、专项/边界审阅及真实Chrome证据单独保存在本轮目录；打包/完整应用按最终结果，不冒充新安装包、Tauri窗口或Android设备。。

下一步：现有字段/画布/偏移入口保持；共享演员、整份放置、组织组、定义增删和定义重命名各列独立切片。后续空间层次、跨视图历史、嵌套/跨文件/规模以及多placement偏移或其他字段批次单独定义和验收。

<a id="scene.composition_canvas"></a>
### 配方单实例画布位置与原文草稿写回

`scene.composition_canvas` · 场景与构建 · 源码交付

入口：当前配方有效预览选择实例→调整此实例布局→拖动/方向键/场景坐标→完整候选检查→原文草稿→普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **scene\_composition\_patch\.rs：稳定目标的六字段保真覆盖补丁**；复用既有Rust position-only保真set补丁及完整前后expand，作者身份和范围外字节保持，无核心改动。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-canvas/core-layout-tests\.log](../docs/test-results/scene-composition-canvas/core-layout-tests.log)、[docs/test-results/scene-composition-canvas/results\.json](../docs/test-results/scene-composition-canvas/results.json)、[docs/test-results/scene-composition-canvas/focused-tests\.log](../docs/test-results/scene-composition-canvas/focused-tests.log) |
| 可移植 JS 语义 | **scene-source-layout\.mjs / scene-layout\.mjs：源码桥接、预览守护与共用Rust几何会话**；复用共享Rust geometry/draft历史及原位dirty，不传生成副本给普通Scene2D CST回写。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-canvas/core-layout-tests\.log](../docs/test-results/scene-composition-canvas/core-layout-tests.log)、[docs/test-results/scene-composition-canvas/results\.json](../docs/test-results/scene-composition-canvas/results.json)、[docs/test-results/scene-composition-canvas/focused-tests\.log](../docs/test-results/scene-composition-canvas/focused-tests.log) |
| 可移植 JS 语义 | **scene-composition-layout\.mjs：固定实例场景位置转局部覆盖**；固定instance模型/source绑定，world-local换算/未动轴与双范围准入，原子geometry修改和旧set提案。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-canvas/core-layout-tests\.log](../docs/test-results/scene-composition-canvas/core-layout-tests.log)、[docs/test-results/scene-composition-canvas/results\.json](../docs/test-results/scene-composition-canvas/results.json)、[docs/test-results/scene-composition-canvas/focused-tests\.log](../docs/test-results/scene-composition-canvas/focused-tests.log) |
| 交互与渲染 | **app-scene-composition-layout\.js：独立画布与当前实例门禁**；独立single-instance画布/方向键/场景坐标、movable门禁、批准失效与取消/释放，父完整候选检查。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-canvas/core-layout-tests\.log](../docs/test-results/scene-composition-canvas/core-layout-tests.log)、[docs/test-results/scene-composition-canvas/results\.json](../docs/test-results/scene-composition-canvas/results.json)、[docs/test-results/scene-composition-canvas/focused-tests\.log](../docs/test-results/scene-composition-canvas/focused-tests.log) |
| 交互与渲染 | **app-source-location\.js / app-runtime\.js / app-scene-preview\.js**；复用当前预览/主原文owner/hash/基线；共享父canonical完整提案\+result身份守护兼容合法child复制，仅内存应用后普通Save。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-canvas/core-layout-tests\.log](../docs/test-results/scene-composition-canvas/core-layout-tests.log)、[docs/test-results/scene-composition-canvas/results\.json](../docs/test-results/scene-composition-canvas/results.json)、[docs/test-results/scene-composition-canvas/focused-tests\.log](../docs/test-results/scene-composition-canvas/focused-tests.log) |

平台：Linux本机编辑服务源码与独立三语配方布局；当前WASM/Rust geometry复用、准备desktop513/mobile203与移动9纯模块+原WASM各5案例；Chrome154画布7/继承9与三语390px另证，无Android布局宿主/界面或设备验收。边界：0.0.10源码交付（审查基线9065667）；独立单实例position-only切片，原recipe/World/Scene2D/运行协议及Rust/WASM源码保持。；有效同一路径/摘要/保存基线预览绑定一个instanceId及placementId+actorKey；仅该UUID进入Rust geometry，完整场景作冻结参照，同定义兄弟不可移动。；拖动/方向键/数值输入使用展开后的场景中心，既有Rust移动/吸附/dirty/最多100步历史复用；画布movableIds门禁同时保护指针及键盘，旧普通布局默认行为保持。；纯helper将场景位置减去固定作者offset，只发旧set形状的position；未动轴沿用原局部值避免浮点逆减漂移，原位不出提案，world/local各±100000在历史修改前拒绝。；source/model/身份在首次await前分离；非法/foreign/multi修改不改变位置、dirty、历史或redo，退出及过期打开释放共有32槽会话，不维护第二份JS位置历史。；原文补丁及prepareApply复用已有单实例覆盖契约，范围外字节/模板/偏移/图片/null/分组/兄弟/稳定UUID不变；不使用生成/actors坐标补丁、scene.update或layoutSave保存。；父控制器检查完整模型/真实图片，GUI批准和source token/owner双重失效守护；应用只改当前原文内存，普通Save保留保存基线与外部冲突，取消/迟到不写作者数据。共享父完成回调核对完整canonical提案快照及同一result身份，兼容两个child的合法分离复制，改变字段仍拒绝。；仅单实例位置画布，无multi/align/共享模板/偏移编辑/跨视图统一历史；恢复位置继承仍用独立覆盖表单。专项、真实Chrome、全量和prepared按本轮结果分别标注，不冒称新安装/Tauri窗口/Android设备。。

下一步：现有字段/画布/偏移入口保持；共享演员、整份放置、组织组、定义增删和定义重命名各列独立切片。后续空间层次、跨视图历史、嵌套/跨文件/规模以及多placement偏移或其他字段批次单独定义和验收。

<a id="scene.composition_batch_canvas"></a>
### 配方多实例画布与原子位置批次

`scene.composition_batch_canvas` · 场景与构建 · 源码交付

入口：当前配方有效预览→调整配方布局→搜索/分组/多选整体移动或六向对齐→完整候选和目标列表检查→整批原文草稿应用→普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **scene\_composition\_patch\.rs：原子多目标局部位置与独立能力桥接**；独立Rust原子多目标position-only字节补丁，完整前后展开/最终预算和桥接能力/语义回执守护。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-batch-canvas/core-tests\.log](../docs/test-results/scene-composition-batch-canvas/core-tests.log)、[docs/test-results/scene-composition-batch-canvas/core-focus-tests\.log](../docs/test-results/scene-composition-batch-canvas/core-focus-tests.log)、[docs/test-results/scene-composition-batch-canvas/ui-tests-final\.log](../docs/test-results/scene-composition-batch-canvas/ui-tests-final.log) |
| 可移植 JS 语义 | **scene-source-layout\.mjs / scene-layout\.mjs：源码桥接、预览守护与共用Rust几何会话**；复用已有单会话Rust geometry/吸附/按尺寸align/100批次dirty历史，不为每实例创建独立历史。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-batch-canvas/core-tests\.log](../docs/test-results/scene-composition-batch-canvas/core-tests.log)、[docs/test-results/scene-composition-batch-canvas/core-focus-tests\.log](../docs/test-results/scene-composition-batch-canvas/core-focus-tests.log)、[docs/test-results/scene-composition-batch-canvas/ui-tests-final\.log](../docs/test-results/scene-composition-batch-canvas/ui-tests-final.log) |
| 可移植 JS 语义 | **scene-composition-batch-layout\.mjs：完整来源绑定与净位置批次**；完整source/model/所有稳定目标绑定，world-local双边界预检、净变化原子proposal和独立prepareApply。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-batch-canvas/core-tests\.log](../docs/test-results/scene-composition-batch-canvas/core-tests.log)、[docs/test-results/scene-composition-batch-canvas/core-focus-tests\.log](../docs/test-results/scene-composition-batch-canvas/core-focus-tests.log)、[docs/test-results/scene-composition-batch-canvas/ui-tests-final\.log](../docs/test-results/scene-composition-batch-canvas/ui-tests-final.log) |
| 交互与渲染 | **app-scene-composition-batch-layout\.js：独立多选/大纲/原文审批**；独立三语batch画布与大纲多选/search/group、审批targetlist/raw签名/异步owner/取消释放。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-batch-canvas/core-tests\.log](../docs/test-results/scene-composition-batch-canvas/core-tests.log)、[docs/test-results/scene-composition-batch-canvas/core-focus-tests\.log](../docs/test-results/scene-composition-batch-canvas/core-focus-tests.log)、[docs/test-results/scene-composition-batch-canvas/ui-tests-final\.log](../docs/test-results/scene-composition-batch-canvas/ui-tests-final.log) |
| 交互与渲染 | **app-source-location\.js / app-runtime\.js / app-scene-preview\.js**；复用当前预览及主原文owner/hash/保存基线，完整candidate/全部targets/图片检查后原子内存应用，普通Save。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-batch-canvas/core-tests\.log](../docs/test-results/scene-composition-batch-canvas/core-tests.log)、[docs/test-results/scene-composition-batch-canvas/core-focus-tests\.log](../docs/test-results/scene-composition-batch-canvas/core-focus-tests.log)、[docs/test-results/scene-composition-batch-canvas/ui-tests-final\.log](../docs/test-results/scene-composition-batch-canvas/ui-tests-final.log) |

平台：Linux本机编辑服务与Chrome配方原文/独立三语批次画布；共享Rust原生/WASM位置补丁与几何历史、实际桌面/移动准备副本按本轮报告；移动仅隔离纯模块，无Android画布宿主/界面或设备验收。边界：0.0.10源码交付（审查基线9065667）；独立批次切片，原recipe/World/Scene2D/执行协议及旧单实例helper/控制器/浏览器脚本保持。；当前同路径/摘要/保存基线有效配方绑定全部1–128个instanceId及placementId+actorKey；不同定义或同定义多个实例独立，组织侧带按原身份核对。；选择/检索/折叠/分组后代只属于独立视图，不改绘制顺序或原文，不以父预览selected授予来源写入权；默认当前actor或首实例。；复用一个Rust geometry会话的整体拖动、键盘、32像素锚点吸附、按有效尺寸六向对齐及最多100步历史；一次动作整批撤销，退出/失效打开释放共有32槽会话。；纯helper按每目标offset从world转local，未动轴沿用原局部值；world/local各±100000在任何几何/dirty/undo/redo改变前整批检查，任一非法/重复/foreign拒绝不留部分状态。；propose仅按作者放置/片段演员顺序携净变化目标及position，回到原位不出空覆盖；选集改变不删除本会话其他净变化目标。；Rust sceneComposition.patchPositions无状态原子合并1–128稳定放置/局部键位置目标，扫描一次组合精确编辑，同放置新增共用容器；前后完整展开和最终128KiB预算核对，范围外字节/BOM/行尾/未改数值/null/身份/组保持。；独立viento_core_scene_composition_positions_version()==1、supportsStudioCoreCompositionPositions与dispatcher；旧set/edit/expand域不接新op且继续可用，无JS补丁回退。桥接拒绝非目标语义/错误路径/坏回执。；prepareApply重验分离来源/hash/保存基线/全部UUID目标/规范顺序和整份精确回执，宿主完整预览所有目标及真实素材；最后live owner/token守护仅替换原文内存，普通Save处理持久化和外部冲突。；未完成raw数值锁换选/移动/对齐，静默字段变动不能绕过批准；纯换选可保留已检查几何，输入/历史变动失效。pending锁作者操作，late open/check/apply不影响新session，合法分离提案completion核对完整canonical快照和同一result。；独立三语界面复制并释放previewimages，不新取World图片清单；共享片段/偏移/其他属性/元数据/映射不改，无跨文件事务或跨视图统一撤销。；原生/WASM、相关专项、Chrome三语390px、完整应用与准备副本分别保存新证据；旧历史/评分/单实例字节保留，不推导新安装/Tauri窗口/Android画布宿主设备或执行引擎成熟度。。

下一步：现有字段/画布/偏移入口保持；共享演员、整份放置、组织组、定义增删和定义重命名各列独立切片。后续空间层次、跨视图历史、嵌套/跨文件/规模以及多placement偏移或其他字段批次单独定义和验收。

<a id="scene.composition_fragment_editor"></a>
### 共享片段演员六字段设置与关联覆盖审阅

`scene.composition_fragment_editor` · 场景与构建 · 源码交付

入口：当前配方预览选演员→编辑共享片段→raw声明显式勾选SET→全部引用/masks与完整候选检查→原文草稿→普通Save

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **scene\_composition\_patch\.rs：原子共享演员声明与独立能力桥接**；独立fragment能力及六字段原子保真SET，完整展开所有放置/offset/预算。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-fragment-editor/core-tests\.log](../docs/test-results/scene-composition-fragment-editor/core-tests.log)、[docs/test-results/scene-composition-fragment-editor/core-fmt\.log](../docs/test-results/scene-composition-fragment-editor/core-fmt.log)、[docs/test-results/scene-composition-fragment-editor/core-clippy\.log](../docs/test-results/scene-composition-fragment-editor/core-clippy.log) |
| 可移植 JS 语义 | **scene-composition-fragments\.mjs：raw声明及全引用掩蔽绑定**；raw声明和全引用/masks绑定、净声明proposal与严格分离prepareApply。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-fragment-editor/core-tests\.log](../docs/test-results/scene-composition-fragment-editor/core-tests.log)、[docs/test-results/scene-composition-fragment-editor/core-fmt\.log](../docs/test-results/scene-composition-fragment-editor/core-fmt.log)、[docs/test-results/scene-composition-fragment-editor/core-clippy\.log](../docs/test-results/scene-composition-fragment-editor/core-clippy.log) |
| 交互与渲染 | **app-scene-composition-fragments\.js：显式SET/关联影响/原文审批**；独立三语显式字段选择、关联掩蔽及完整原文审批/raw签名/异步归属。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-fragment-editor/core-tests\.log](../docs/test-results/scene-composition-fragment-editor/core-tests.log)、[docs/test-results/scene-composition-fragment-editor/core-fmt\.log](../docs/test-results/scene-composition-fragment-editor/core-fmt.log)、[docs/test-results/scene-composition-fragment-editor/core-clippy\.log](../docs/test-results/scene-composition-fragment-editor/core-clippy.log) |
| 交互与渲染 | **app-source-location\.js / app-runtime\.js / app-scene-preview\.js**；复用父完整候选/图片/全部target来源和主owner/token内存应用，普通Save。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-fragment-editor/core-tests\.log](../docs/test-results/scene-composition-fragment-editor/core-tests.log)、[docs/test-results/scene-composition-fragment-editor/core-fmt\.log](../docs/test-results/scene-composition-fragment-editor/core-fmt.log)、[docs/test-results/scene-composition-fragment-editor/core-clippy\.log](../docs/test-results/scene-composition-fragment-editor/core-clippy.log) |

平台：Linux本机编辑服务与Chrome三语共享字段源码草稿；共享Rust原生/WASM原子声明补丁、桌面/移动准备副本范围按本轮报告；mobile仅隔离纯模块，不代表Android作者编辑宿主/设备或引擎执行。边界：0.0.10源码交付（审查基线9065667）；独立共享声明切片，只编辑现有fragmentId/actorKey演员六字段，不新增作者格式/World命令/执行协议。；表单仅raw作者声明，未声明留空；明确勾选才启用并发送字段，位置/尺寸成对；绝不拿selected实例有效值/局部覆盖补模板默认值。；SET-only position/size/color/speed/controls/imageResourceId非空子集，提案只净声明变化；已声明同值无变化，未声明显式添加当前effective同值仍是源码变化。；全部同fragment/key引用按作者放置顺序列{instanceId,placementId,overrides}，overrides固定六字段顺序；目标集合/顺序/局部掩蔽属于canonical审批回执，不仅列可见变化实例。；局部覆盖继续优先，逐实例显示净字段参与共享变化或被覆盖掩蔽；全遮蔽明确只改声明仍允许检查/应用；objectId/UUID/groupKey/组/继承开关/placement/override保持。；独立fragment ABI探针/supports/dispatcher与sceneComposition.patchFragmentActor；旧set/edit/positions/expand不accept新op，缺cap只关闭新入口，无JS字节补丁回退。；Rust复用严格scanner和保真JSON编辑，原子SET模板后完整展开所有放置；local/world各轴±100000及前后128KiB UTF8校验，保留其他原字节/BOM/行尾/数值写法。；imageResourceId:null仅原模板useProjectionDefaults=true；图片清单由父preview已有只读World读取并guard，独立UI不请求World/HTTP、无Canvas/图片副本或geometry/history会话。；纯helper首次await前分离source/model，绑定全相关稳定实例及来源；prepare重算source/hash/保存基线/targets集合和顺序/masks/精确afterContent/changedPaths，遗漏或伪造回执拒绝。；父preview检查完整候选/真实图片与全部sourceLocations目标；raw字段/checkbox签名及canonical候选绑定批准，pending锁操作，late open/check/apply和静默变化不授权修改新owner。；主编辑器最后live source owner/token及canonical回执守护仅更新内存；合法分离提案可完成，取消保留原草稿，普通Save处理持久化和外部冲突。；无模板字段reset/remove、结构创作、offset编辑、跨文件提交或跨视图统一undo；旧single/batch/override路径及历史证据保持，不提升Godot/Bevy/Android/安装成熟度。。

下一步：现有字段/画布/偏移入口保持；共享演员、整份放置、组织组、定义增删和定义重命名各列独立切片。后续空间层次、跨视图历史、嵌套/跨文件/规模以及多placement偏移或其他字段批次单独定义和验收。

<a id="scene.composition_fragment_inheritance"></a>
### 共享片段可选声明恢复与原子设置删除

`scene.composition_fragment_inheritance` · 场景与构建 · 源码交付

入口：当前配方预览→编辑共享片段→选择允许的声明恢复/其他字段设置→全引用掩蔽与完整候选检查→原文草稿→普通Save

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **scene\_composition\_fragment\_patch\.rs：共享声明原子SET/RESET与独立fragment\_edit能力**；独立fragment\_edit原子SET/RESET及完整展开/偏移/预算、旧SET兼容 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-fragment-inheritance/core-fmt\.log](../docs/test-results/scene-composition-fragment-inheritance/core-fmt.log)、[docs/test-results/scene-composition-fragment-inheritance/core-clippy\.log](../docs/test-results/scene-composition-fragment-inheritance/core-clippy.log)、[docs/test-results/scene-composition-fragment-inheritance/core-wasm-build\.log](../docs/test-results/scene-composition-fragment-inheritance/core-wasm-build.log) |
| 可移植 JS 语义 | **scene-composition-fragments\.mjs：raw声明及全引用掩蔽绑定**；复用raw声明helper新增proposeEdit/reset与全引用masks严格prepare | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-fragment-inheritance/core-fmt\.log](../docs/test-results/scene-composition-fragment-inheritance/core-fmt.log)、[docs/test-results/scene-composition-fragment-inheritance/core-clippy\.log](../docs/test-results/scene-composition-fragment-inheritance/core-clippy.log)、[docs/test-results/scene-composition-fragment-inheritance/core-wasm-build\.log](../docs/test-results/scene-composition-fragment-inheritance/core-wasm-build.log) |
| 交互与渲染 | **app-scene-composition-fragments\.js：显式SET/关联影响/原文审批**；同表单五声明恢复、raw保留/互斥/net影响及来源批准守护 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-fragment-inheritance/core-fmt\.log](../docs/test-results/scene-composition-fragment-inheritance/core-fmt.log)、[docs/test-results/scene-composition-fragment-inheritance/core-clippy\.log](../docs/test-results/scene-composition-fragment-inheritance/core-clippy.log)、[docs/test-results/scene-composition-fragment-inheritance/core-wasm-build\.log](../docs/test-results/scene-composition-fragment-inheritance/core-wasm-build.log) |
| 交互与渲染 | **app-source-location\.js / app-runtime\.js / app-scene-preview\.js**；复用父完整candidate/图片/targets审批和主owner/token内存应用，普通Save | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-fragment-inheritance/core-fmt\.log](../docs/test-results/scene-composition-fragment-inheritance/core-fmt.log)、[docs/test-results/scene-composition-fragment-inheritance/core-clippy\.log](../docs/test-results/scene-composition-fragment-inheritance/core-clippy.log)、[docs/test-results/scene-composition-fragment-inheritance/core-wasm-build\.log](../docs/test-results/scene-composition-fragment-inheritance/core-wasm-build.log) |

平台：Linux本机编辑服务与Chrome三语共享声明原文草稿；共享Rust原生/WASM原子保真补丁、桌面/隔离移动准备仅pure helper及实际WASM；无Android作者编辑宿主/设备或引擎执行。边界：0.0.10源码交付（审查基线9065667）；复用现有共享演员及作者格式，独立fragment_edit能力与操作，不重标原SET或执行/设备交付。；只移除现有fragmentId/actorKey可选字段；position必需禁止删除，size/color/speed/controls仅source useProjectionDefaults=true可删，imageResourceId任一继承状态可删；不更换定义/身份/组/继承开关/placement/override。；图片声明删除在flagtrue时重新继承投影，flagfalse时无图；显式null表示不用图片，与删除分开。原声明/局部覆盖优先级保持。；values与reset原始意图先严格验证无重复/未知/重叠，再只携净设置及实际存在的删除；新proposeEdit({values,reset})始终包含规范顺序reset，旧propose SET形状和旧cap继续可用。；Rust无状态原子设置/删除，保真必要分隔符与非目标字节/BOM/行尾/极端未改数值，完整展开全部放置并检查local/world坐标及前后128KiB预算，不分配UUID或几何历史。；独立viento_core_scene_composition_fragment_edit_version()==1/supportsStudioCoreCompositionFragmentEdit/dispatcher/editFragmentActor，旧操作域拒绝新op；缺新cap仅禁恢复，旧SET真实继续，无fakevalue删除或JS补丁回退。；GUI五个恢复选项默认不选，未声明/不允许删除禁用，无PositionReset；SET/RESET同字段互斥，取消恢复保留原始输入，表单不猜投影/effective结果。；影响列表只取净values键和reset，全部同fragment/key引用及固定六字段masks按source顺序进入canonical提案；局部覆盖仍优先，全掩蔽仍允许只改声明。；prepare在await前分离source/proposal，重算摘要/保存基线/全targets/顺序/masks/精确afterContent/changedPaths；父完整候选与实际图片检查，raw/checkbox/reset/canonical签名绑定批准。；pending锁全部操作；静默变动/过期owner/token/late open/check/apply不授权新session。主宿主最终live守护仅更新内存，普通Save保留原基线及外部冲突；取消不改作者数据。；Rust/native-WASM/UI/宿主/Chrome/prepared真实证据与旧历史分别保存；无共享结构/offset/跨文件/跨视图统一undo，无新安装/Tauri窗口/Android编辑宿主设备或执行引擎声明。。

下一步：现有字段/画布/偏移入口保持；共享演员、整份放置、组织组、定义增删和定义重命名各列独立切片。后续空间层次、跨视图历史、嵌套/跨文件/规模以及多placement偏移或其他字段批次单独定义和验收。

<a id="scene.composition_placement_editor"></a>
### 整组放置偏移与全成员原文审批

`scene.composition_placement_editor` · 场景与构建 · 源码交付

入口：当前配方预览选任一实例→调整整组偏移→raw坐标对/删除缺省→全部演员及组映射/原文差异/完整候选检查→原文草稿→普通Save

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **scene\_composition\_placement\_patch\.rs：独立整组offset保真原子设置/删除**；独立placement cap/editPlacementOffset原子保真设置/删除与全展开边界 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-placement-offset/browser/browser\.json](../docs/test-results/scene-composition-placement-offset/browser/browser.json)、[docs/test-results/scene-composition-placement-offset/inheritance-regression/browser\.json](../docs/test-results/scene-composition-placement-offset/inheritance-regression/browser.json)、[docs/test-results/scene-composition-placement-offset/core-fmt\.log](../docs/test-results/scene-composition-placement-offset/core-fmt.log) |
| 可移植 JS 语义 | **scene-composition-placement\.mjs：全演员/组来源与精确offset提案**；rawoffset/全部actor-groupprovenance与sourceorder canonical提案/prepare | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-placement-offset/browser/browser\.json](../docs/test-results/scene-composition-placement-offset/browser/browser.json)、[docs/test-results/scene-composition-placement-offset/inheritance-regression/browser\.json](../docs/test-results/scene-composition-placement-offset/inheritance-regression/browser.json)、[docs/test-results/scene-composition-placement-offset/core-fmt\.log](../docs/test-results/scene-composition-placement-offset/core-fmt.log) |
| 交互与渲染 | **app-scene-composition-placement\.js：rawoffset/全成员/原文差异审批**；独立offset数值对/restore/全成员/只读差异与原始输入批准守护 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-placement-offset/browser/browser\.json](../docs/test-results/scene-composition-placement-offset/browser/browser.json)、[docs/test-results/scene-composition-placement-offset/inheritance-regression/browser\.json](../docs/test-results/scene-composition-placement-offset/inheritance-regression/browser.json)、[docs/test-results/scene-composition-placement-offset/core-fmt\.log](../docs/test-results/scene-composition-placement-offset/core-fmt.log) |
| 交互与渲染 | **app-source-location\.js / app-runtime\.js / app-scene-preview\.js**；复用父完整candidate/图片/全目标来源和主owner/token仅内存应用，普通Save | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-placement-offset/browser/browser\.json](../docs/test-results/scene-composition-placement-offset/browser/browser.json)、[docs/test-results/scene-composition-placement-offset/inheritance-regression/browser\.json](../docs/test-results/scene-composition-placement-offset/inheritance-regression/browser.json)、[docs/test-results/scene-composition-placement-offset/core-fmt\.log](../docs/test-results/scene-composition-placement-offset/core-fmt.log) |

平台：Linux本机编辑服务与Chrome三语配方原文offset表单；共享Rust原生/WASM无状态补丁、prepared桌面/隔离移动仅purehelper和实际WASM，无Android作者编辑宿主或设备验收。边界：0.0.10源码交付（审查基线9065667）；独立placement cap1/操作/纯提案/GUI，原recipe/World/Scene2D/执行协议与旧作者入口保持。；现有placement的offset在每个演员localposition覆盖之后相加，影响全部映射演员；组织groups只分组无transform。其他placement/sharedfragment/override/groupstructure/UUID不变。；offset为raw有限数值对或nullabsence，UI缺声明留空并另说明effective[0,0]；明确SET零和删除显式零是不同原文变化，同已声明数值无净变化。；UI restore仅declared offset可用，保留未完成原始输入，取消restore重新开放原输入；完整数值对各轴±100000，全演员world边界任一越界候选原子拒绝。；Rust无状态editPlacementOffset复用strictscanner与保真JSONpatch，前后完整展开与128KiB预算；BOM/CRLF/未改极端数字/其他原文保持，不分配身份或几何历史。；独立viento_core_scene_composition_placement_version()==1/supportsStudioCoreCompositionPlacement/dispatcher；旧域拒绝新op，缺cap仅关新入口，旧set/edit/fragment/geometry操作保留，无JS回退。；createSceneCompositionPlacementDraft首次await前分离source/model，复用完整预览绑定并额外核对所有actor/groupprovenance；selected实例只选定placement，不将globalviewselection作为权限。；proposal严格绑定scene/source/hash/保存基线/instance/placement/fragment/offset及sourceorder全targets{instanceId,actorKey}/groups{groupId,groupKey}/exactafterContent/changedPaths；prepare重算全身份映射/顺序/回执。；独立表单显示全实例及组织组、只读source diff和完整candidate，raw/reset与canonical签名绑定批准；父预览完整模型/图片/所有target来源守护，pending锁操作，silent/late/stale不授权新session。；主编辑器最后live owner/token守护仅内存应用，ordinarySave持久化及外部冲突；取消保留作者草稿，合法分离复制回执可完成。无Canvas/媒体副本/geometry会话、结构/其他字段/跨文或统一undo。；本轮Rust/真实native-WASM/UI/宿主/Chrome/prepared证据另存；旧历史评分/作者切片/Godot后端字节保护，不声明新安装/Tauri窗口/Android编辑设备、GPU或执行引擎成熟度。。

下一步：现有字段/画布/偏移入口保持；共享演员、整份放置、组织组、定义增删和定义重命名各列独立切片。后续空间层次、跨视图历史、嵌套/跨文件/规模以及多placement偏移或其他字段批次单独定义和验收。

<a id="backend.project_management"></a>
### 后端派生工程清单、只读核对与服务回收

`backend.project_management` · 场景与构建 · 源码交付

入口：成功构建→统一清单→后端工程列表／owned buildId检查→来源／工具／库存／资源副本／证据／保留原因

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **backend-project\.mjs：版本化来源、库存与生命周期纯清单**；纯schema1来源／库存／预算／冻结DTO | 3 / 3 / 4 / 3 | [docs/test-results/backend-project-management/core-regression-final\.log](../docs/test-results/backend-project-management/core-regression-final.log)、[docs/test-results/backend-project-management/retention-boundary-final\.log](../docs/test-results/backend-project-management/retention-boundary-final.log)、[docs/test-results/backend-project-management/backend-cache-final\.log](../docs/test-results/backend-project-management/backend-cache-final.log) |
| 本机服务与适配 | **node-backend-project：冻结再生成与完整工程只读核对**；完整冻结计划和已知byte来源核对 | 3 / 3 / 4 / 3 | [docs/test-results/backend-project-management/core-regression-final\.log](../docs/test-results/backend-project-management/core-regression-final.log)、[docs/test-results/backend-project-management/retention-boundary-final\.log](../docs/test-results/backend-project-management/retention-boundary-final.log)、[docs/test-results/backend-project-management/backend-cache-final\.log](../docs/test-results/backend-project-management/backend-cache-final.log) |
| 本机服务与适配 | **宿主工程所有权、保留、工程列表与CLI检查**；创建者所有权／安全普通回收／CLI冷检查 | 3 / 3 / 4 / 3 | [docs/test-results/backend-project-management/core-regression-final\.log](../docs/test-results/backend-project-management/core-regression-final.log)、[docs/test-results/backend-project-management/retention-boundary-final\.log](../docs/test-results/backend-project-management/retention-boundary-final.log)、[docs/test-results/backend-project-management/backend-cache-final\.log](../docs/test-results/backend-project-management/backend-cache-final.log) |
| 交互与渲染 | **三语后端工程详情与历史选择**；三语只读列表／详情与延迟批准守护 | 3 / 3 / 4 / 3 | [docs/test-results/backend-project-management/core-regression-final\.log](../docs/test-results/backend-project-management/core-regression-final.log)、[docs/test-results/backend-project-management/retention-boundary-final\.log](../docs/test-results/backend-project-management/retention-boundary-final.log)、[docs/test-results/backend-project-management/backend-cache-final\.log](../docs/test-results/backend-project-management/backend-cache-final.log) |

平台：Linux本机编辑服务与CLI；实际Godot4.7.2／Bevy0.19.1可信无头程序，Chrome154三语390px、prepared桌面／移动纯DTO一致性；无新安装Tauri窗口／Androidhost或设备验收。边界：0.0.10源码交付（审查基线9065667）；作者workspace仍权威，Godot原生生成工程与Bevy数据包复用schema1管理清单。；清单记录冻结来源、backend／adapter／tool身份、入口、生成／资源副本／作者源码副本角色；build／snapshot／source-map三个证据按精确bytes SHA锁定，无本机工具路径或执行权限。；纯DTO严格分离冻结及pretty UTF-8 4MiB预算；Node重新恢复冻结计划／生成器／适配器／source-map／库存与字节，无工具进程、作者源读取、修复或采纳。；旧无manifest只读派生recorded=false，新manifest语义／证据篡改拒绝；extra文件／目录／链接／sessions明示complete=false，不深入陌生树，不等于可删或可执行授权。；详情仅opaque buildId；本会话创建时物理目录inode/Symbol ledger/manifest hash不能从磁盘清单重新伪造删除所有权。跨服务恢复另列backend.project_catalog，恢复条目统一preserved。；每backend分目录；最多3份自动普通输出，prune先核原样bytes/tree后quarantine并再次核对；修改／新增／根替换／硬链接／报告或删除失败明确preserved。失败partial输入同样receipt保护，无并发同UID事务锁承诺。；GUI三语／390px只读来源与库存，详情owner／late／close／场景及后端身份守护，选择旧详情不改变latest运行；无任意本机path输入。；CLI冷inspect支持相对目录与source offline，run／suite从冻结backend选择对应env工具；运行仍独立验证执行字节及工具，清单不成为脚本输入。；Godot已知GD UID／资源import sidecars按可信生成路径清理，adapter指纹变化需旧构建重建，冻结7生成／runtime字节及协议保持。；持久catalog与冻结工程选择另列backend.project_catalog；本清单切片不提供生成工程回导／手动强删／任意独立发行／新ns-nova执行／Androidhost能力。；Bevy Rust工作树源工程显示独立bevy-rust-project类别、Cargo入口和源码交付限制；沿用已有纯清单、库存核对和owner守护。新增详情证据列在behavior.bevy_rust，旧管理评分保持。；0.1.3之后项目级多Scene2D组装由build.project_assembly单列：新增项目计划／成员来源／闭包适配不改变本功能既有单场景评分和历史验收。。

下一步：持久创建者索引和跨服务恢复已另列backend.project_catalog；继续定义生成工程作者化／导入、显式删除、跨缓存迁移和独立发行，不扫描缓存自动收养。

<a id="backend.project_catalog"></a>
### 后端工程持久列表、冻结选择与旧执行链对接

`backend.project_catalog` · 场景与构建 · 源码交付

入口：创建成功→原子宿主索引→重启历史列表→显式核验选择→原运行／控制／用例／验收组

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **backend-project\.mjs：版本化来源、库存与生命周期纯清单**；复用严格纯清单DTO，不添加宿主IO至领域 | 3 / 3 / 4 / 3 | [docs/test-results/backend-project-catalog/results\.json](../docs/test-results/backend-project-catalog/results.json)、[docs/test-results/backend-project-catalog/full-check-frozen\.log](../docs/test-results/backend-project-catalog/full-check-frozen.log)、[docs/test-results/backend-project-catalog/full-check-initial\.log](../docs/test-results/backend-project-catalog/full-check-initial.log) |
| 本机服务与适配 | **本机创建登记、原子索引与恢复身份guard**；持久索引与只读／运行恢复身份，清理权限分离 | 3 / 3 / 4 / 3 | [docs/test-results/backend-project-catalog/results\.json](../docs/test-results/backend-project-catalog/results.json)、[docs/test-results/backend-project-catalog/full-check-frozen\.log](../docs/test-results/backend-project-catalog/full-check-frozen.log)、[docs/test-results/backend-project-catalog/full-check-initial\.log](../docs/test-results/backend-project-catalog/full-check-initial.log) |
| 本机服务与适配 | **服务重启历史、显式运行选择与冻结控制上下文**；恢复列表／冻结选择与原控制验收服务对接 | 3 / 3 / 4 / 3 | [docs/test-results/backend-project-catalog/results\.json](../docs/test-results/backend-project-catalog/results.json)、[docs/test-results/backend-project-catalog/full-check-frozen\.log](../docs/test-results/backend-project-catalog/full-check-frozen.log)、[docs/test-results/backend-project-catalog/full-check-initial\.log](../docs/test-results/backend-project-catalog/full-check-initial.log) |
| 交互与渲染 | **三语历史来源、当前运行目标与强制刷新**；明确运行工程／来源与三语强制刷新 | 3 / 3 / 4 / 3 | [docs/test-results/backend-project-catalog/results\.json](../docs/test-results/backend-project-catalog/results.json)、[docs/test-results/backend-project-catalog/full-check-frozen\.log](../docs/test-results/backend-project-catalog/full-check-frozen.log)、[docs/test-results/backend-project-catalog/full-check-initial\.log](../docs/test-results/backend-project-catalog/full-check-initial.log) |

平台：Linux本机服务Godot4.7.2／Bevy0.19.1及Chrome154三语390px、桌面prepared副本；Android仅已有pureDTO保持，无安装或设备验收。边界：0.0.10源码交付（审查基线9065667）；只登记创建成功工程，恢复读入不生成删除ledger或隐式当前运行目标。；Node索引绑定backend／namespace、relative目录、source UUID／path、物理dev／ino与manifestSHA，strictdetached输入、256条／1MiB预算、跨进程锁／原子发布，不扫描陌生目录。；catalog恢复只列表，无作者正文、资源、工具探测／生成进程；显式选择完整inspect当前generator／adapter／bytes，重新绑定冻结control targets后复用原execute路径。；可读作品小清单的workspaceUUID另外核对，离线仍可检查与选取；新服务提供仅冻结场景，旧cachedscenes保留并通过全局sourceoffline诊断阻止author动作。；旧详情检查不会设置运行目标；选择epoch／job／latest／root／manifest／close前后守护；状态GET不重发select，lostresponse只GETreconcile。；显式Refresh强制核对索引与作者状态；prev记录变化或缺失撤销选择，currentwriteownership不因索引缺项而丢失；activejob保持已准入上下文直到结束。；恢复工程统一preserved，selection不获得自动回收权；currentpristine3回收更新索引／quarantine路径；unknown／manual／sessions继续保留。；Godot1图片／2实例／3 GDS与Bevy2真实重启后运行；两实例后端另接4步控制、三断言、两成员组／叶报告，作者与frozenbytes保持。；中英日390px、实际Chrome来源离线／lateclose／forcedrefresh与Bevy数据工程另证；prepared副本只证明sourcecopy与copyhost／pureVM，不提升Tauri安装或Androidhost成熟度。；CLI及本轮前未登记输出不自动入GUI，只有冷inspect；root／cache路径变化不自动迁移，索引本机状态不进作者包；无手动删除／回导／独立发行／native ns-nova。；0.1.3之后项目级多Scene2D组装由build.project_assembly单列：新增项目计划／成员来源／闭包适配不改变本功能既有单场景评分和历史验收。。

下一步：明确移除登记与删除产物的审阅边界、跨路径缓存迁移、可见保留预算；旧会话报告历史恢复单独接入。

<a id="scene.composition_structure_editor"></a>
### 共享片段演员增删、全放置身份与原文创作

`scene.composition_structure_editor` · 场景与构建 · 源码交付

入口：源码配方预览→编辑片段结构→新增/移除成员→全放置身份和覆盖影响→完整检查→原文草稿→普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **scene\_composition\_structure\_patch\.rs：原子模板演员和全放置身份增删**；独立structure能力与原子保真全映射增删 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-structure/results\.json](../docs/test-results/scene-composition-structure/results.json)、[docs/test-results/scene-composition-structure/core-native-test\.log](../docs/test-results/scene-composition-structure/core-native-test.log)、[docs/test-results/scene-composition-structure/app-check\.log](../docs/test-results/scene-composition-structure/app-check.log) |
| 可移植 JS 语义 | **scene-composition-structure\.mjs：冻结原文目录与exact结构提案**；未放置片段原文目录、影响身份与精确回执 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-structure/results\.json](../docs/test-results/scene-composition-structure/results.json)、[docs/test-results/scene-composition-structure/core-native-test\.log](../docs/test-results/scene-composition-structure/core-native-test.log)、[docs/test-results/scene-composition-structure/app-check\.log](../docs/test-results/scene-composition-structure/app-check.log) |
| 交互与渲染 | **app-scene-composition-structure\.js：成员创作与全放置审阅**；显式成员创作、稳定UUID、全影响与原文审阅 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-structure/results\.json](../docs/test-results/scene-composition-structure/results.json)、[docs/test-results/scene-composition-structure/core-native-test\.log](../docs/test-results/scene-composition-structure/core-native-test.log)、[docs/test-results/scene-composition-structure/app-check\.log](../docs/test-results/scene-composition-structure/app-check.log) |
| 交互与渲染 | **app-source-location\.js / app-runtime\.js / app-scene-preview\.js**；复用父完整候选和主编辑器来源守护/普通保存 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-structure/results\.json](../docs/test-results/scene-composition-structure/results.json)、[docs/test-results/scene-composition-structure/core-native-test\.log](../docs/test-results/scene-composition-structure/core-native-test.log)、[docs/test-results/scene-composition-structure/app-check\.log](../docs/test-results/scene-composition-structure/app-check.log) |

平台：Linux本机编辑服务和Chrome三语配方结构表单；Rust原生/WASM、prepared桌面/移动纯helper一致性；无Android编辑宿主或设备验收。边界：0.0.10源码交付（审查基线9065667）；已有recipe v1生成普通Scene2D v3，不升级作者/World/执行格式。；一个操作原子新增完整演员声明与全部相关放置显式instance UUID，或移除模板演员/所有actorIds成员/该键覆盖条目；组和其他身份/字段/原文保持。；新ID拒已有实例/组/placement和配方身份碰撞，不从局部key/数组索引派生；每放置ID在一次待审操作和重检间保持，Rust/helper不分配ID。；全部相关placement必须按作者顺序完整映射；未放置fragment可空targets/instances，所有fragment至少一演员、声明与展开128/source128KiB/最终坐标各自准入。；未放置片段检查声明及登记依赖，没有有效实例渲染；未声明投影默认资源的实际字节/effective值在将来放置时另外检查，不声明此处已验。；Rust独立可选structure cap/dispatcher保真splice；旧expand/fragment/set/reset/positions/placement操作与探针保持，缺cap仅关新入口，无JS规则回退。；纯helper在首次await前分离source/model；冻结public片段目录，私有snapshot生成exact edit/targets/afterContent/changedPaths；prepare重算来源hash/base/影响/精确回执。；GUI toolbar不依赖选中演员，允许unused；注册定义/兼容游戏投影/已登记图片/组织组选项，中英日及390px；原始输入/owner/完整候选审批绑定。；父控制器完整preview+真实依赖，并从Rust展开核对全演员/组身份和来源；允许selected opener删除。主编辑器最后核owner/token仅内存应用，ordinarySave保存/外部冲突。；真实Chrome新增/移除/取消/保存重开/图片拒绝/外部冲突与旧single/batch回归另证；prepared桌面及标准VM移动pure+WASM不代表新版安装或Android编辑/设备。；片段/组/placement增删、跨文件/嵌套、空间transform、统一历史、可执行recipe和运行引擎扩展不在此切片。。

下一步：整份放置、组织组、定义增删与定义重命名已分别列为独立切片；继续定义空间层次、场景文本组织和跨视图历史合同。

<a id="scene.authoring_workflow"></a>
### 独立场景创作流程、候选验收与宿主接口

`scene.authoring_workflow` · 场景与构建 · 源码交付

入口：六个独立配方编辑区→自身能力与来源→完整候选审阅→同源草稿应用→宿主导航→普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **scene-authoring-candidate\.mjs：固定语义候选回执验收**；来源摘要和独立domain目标验收 | 3 / 3 / 4 / 3 | [docs/test-results/scene-authoring-workflow/results\.json](../docs/test-results/scene-authoring-workflow/results.json)、[docs/test-results/scene-authoring-workflow/app-check\.log](../docs/test-results/scene-authoring-workflow/app-check.log)、[docs/test-results/scene-authoring-workflow/new-tests\.log](../docs/test-results/scene-authoring-workflow/new-tests.log) |
| 可移植 JS 语义 | **scene-authoring-workflow\.mjs：独立入口生命周期与窄状态**；可注入异步owner、窄状态和私有回执 | 3 / 3 / 4 / 3 | [docs/test-results/scene-authoring-workflow/results\.json](../docs/test-results/scene-authoring-workflow/results.json)、[docs/test-results/scene-authoring-workflow/app-check\.log](../docs/test-results/scene-authoring-workflow/app-check.log)、[docs/test-results/scene-authoring-workflow/new-tests\.log](../docs/test-results/scene-authoring-workflow/new-tests.log) |
| 交互与渲染 | **app-scene-authoring\.js：来源、目录、预览与界面连接**；六独立UI的browser连接和宿主导航交接 | 3 / 3 / 4 / 3 | [docs/test-results/scene-authoring-workflow/results\.json](../docs/test-results/scene-authoring-workflow/results.json)、[docs/test-results/scene-authoring-workflow/app-check\.log](../docs/test-results/scene-authoring-workflow/app-check.log)、[docs/test-results/scene-authoring-workflow/new-tests\.log](../docs/test-results/scene-authoring-workflow/new-tests.log) |
| 交互与渲染 | **app-source-location\.js / app-runtime\.js / app-scene-preview\.js**；复用未改原文宿主最后检查与普通保存 | 3 / 3 / 4 / 3 | [docs/test-results/scene-authoring-workflow/results\.json](../docs/test-results/scene-authoring-workflow/results.json)、[docs/test-results/scene-authoring-workflow/app-check\.log](../docs/test-results/scene-authoring-workflow/app-check.log)、[docs/test-results/scene-authoring-workflow/new-tests\.log](../docs/test-results/scene-authoring-workflow/new-tests.log) |

平台：Linux本机服务/Chrome六创作入口、prepared桌面和标准VM移动纯层；非安装/设备。边界：0.0.10源码交付；九创作入口分别维护输入、审批、选择和局部历史，没有跨区统一撤销。；纯candidate固定八种kind：instance（覆盖／单实例布局共用）、positions、fragment、placement、structure、placements、groups、definitions；核对摘要、来源及完整目标，unknown kind与bad shape闭合拒绝。；纯workflow使用注入来源/目录/预览/摘要/应用/成功通知接口，不导入DOM、HTTP、Node或具体执行引擎。；每入口仅暴露六个公共来源字段和自己的能力，不读取兄弟flag、构建结果或后端工程；执行中编辑等原权限仍关闭。；提案与model/actor在await前分离，open/review/apply各自epoch拒绝late/reentrant响应；关闭/文档/source token变化失效，旧临时preview仍尽力释放。；应用成功合法推进source token，完成仅接纳本入口exact结果回执/完整提案/当前owner；跨区回执和重放拒绝，纯层不聚焦或关闭窗口。；web adapter绑定九创作UI及HTTP/catalog；构建父仅交接窗口归属和成功导航，source host保留最后检查、内存应用、baseline和普通Save。3D只读来源视图独立，不借用配方候选或执行权限。；最初六入口抽取时，Rust/WASM、recipe/World/runtime格式、六domain补丁和UI/sourcehost原字节保持；旧桥接测试仅更新共享函数identity断言并保留双方完整审阅/释放保护。后续结构领域按各自专题证据接入，未改原数据协议。；最初抽取专题的固定Node全量、51新专项与37真实Chrome流程按当时六入口范围保留；后续三个结构入口的验证另列各专题。prepared标准VM复用不计安装窗口／Android编辑设备验收。；普通场景事务、执行生命周期、人机工程新面板/键盘/焦点交互、跨文件历史和自动保存不在这次接口拆分。。

下一步：沿独立来源、审阅、应用和导航接口继续场景结构创作，再逐区验证面板、键盘、焦点与跨区历史。

<a id="studio.system_modules"></a>
### Studio 系统装配与工程增量能力需求

`studio.system_modules` · 工程与工作台 · 源码交付

入口：工程模板／清单需求→固定模块规划→各区显式接口→宿主服务准入→原文普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **studio-modules\.mjs：系统注册与增量需求规划**；固定注册、依赖和局部需求诊断 | 3 / 3 / 4 / 3 | [docs/test-results/studio-system-modules/results\.json](../docs/test-results/studio-system-modules/results.json)、[docs/test-results/studio-system-modules/app-check\.log](../docs/test-results/studio-system-modules/app-check.log)、[docs/test-results/studio-system-modules/new-tests\.log](../docs/test-results/studio-system-modules/new-tests.log) |
| 交互与渲染 | **app-studio-system\.js：六区装配与宿主诊断**；启动装配与各区窄接口 | 3 / 3 / 3 / 3 | [docs/test-results/studio-system-modules/results\.json](../docs/test-results/studio-system-modules/results.json)、[docs/test-results/studio-system-modules/app-check\.log](../docs/test-results/studio-system-modules/app-check.log)、[docs/test-results/studio-system-modules/new-tests\.log](../docs/test-results/studio-system-modules/new-tests.log) |
| 工程定义与格式 | **studioProfile：工程定义、原生模板与迁移声明**；工程声明与新增配置快照 | 3 / 3 / 3 / 3 | [docs/test-results/studio-system-modules/results\.json](../docs/test-results/studio-system-modules/results.json)、[docs/test-results/studio-system-modules/app-check\.log](../docs/test-results/studio-system-modules/app-check.log)、[docs/test-results/studio-system-modules/new-tests\.log](../docs/test-results/studio-system-modules/new-tests.log) |
| 桌面宿主 | **studioProfile：工程定义、原生模板与迁移声明**；原生模板复制、旧摘要和迁移保留 | 3 / 3 / 3 / 3 | [docs/test-results/studio-system-modules/results\.json](../docs/test-results/studio-system-modules/results.json)、[docs/test-results/studio-system-modules/app-check\.log](../docs/test-results/studio-system-modules/app-check.log)、[docs/test-results/studio-system-modules/new-tests\.log](../docs/test-results/studio-system-modules/new-tests.log) |

平台：Linux实际HTTP／Chrome、原生模板归档与prepared桌面／移动纯层；非安装／设备。边界：0.0.10源码交付；系统基础边界，而非全部功能内部拆分。；当前八固定模块／24声明能力按依赖注册；重复提供者／缺依赖／循环／版本错误闭合拒绝，没有动态代码路径。3D模块依赖普通文档模块，不依赖World或构建。；工程studioProfile是增量required／optional数据；缺实际3D核心／Rust作者执行／未来API不关闭普通正文模块，静态active不授予写或运行权限，也不证明工具已安装。；新增配置严格校验并在await前分离，已有未来／无效声明原样读取和备份迁移，仅产生局部诊断。；GUI只在启动时装配七个区域（原六区加独立3D视图），各区拿自己的端口；正文模块保留既有宿主权威，media可选拿导出函数；私有controller和作者内容不外泄，只读snapshot供后续诊断面板。；正文宿主保留source／草稿／普通Save权威，语言先初始化；实际capability检测与工程加载接入compositionroot。；原生模板可选复制studioProfile，有字段纳入provenance；无字段旧包序列化和digest不变，戏剧scene依旧prose。；World与构建区内部仍聚合，原2D预览仍受构建区可用性约束；独立3D只读视图另列scene.primitives3d。不提供热卸载、插件执行或权限沙箱，也不声称全部内部功能已拆分。；系统基础专题当时七模块／22能力，51新专项、53原生PASS与1旧full-size忽略、7实际Chrome流程和prepared标准VM分别保留；后续第八3D模块与24声明能力的验证另列scene.primitives3d。无安装／Android设备验收。。

下一步：沿接口继续拆正文生命周期、World命令与2D场景预览／执行贡献；独立3D表示、计划和视图已列首切片，资源、空间层级、行为和进一步工程模板需求分别接入。

<a id="scene.composition_placements_editor"></a>
### 整份片段放置新增、保真复制与移除

`scene.composition_placements_editor` · 场景与构建 · 源码交付

入口：当前配方原文预览→管理片段放置→完整候选及身份审阅→应用原文草稿→普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **placements\_patch\.rs：独立整份放置CST补丁**；严格输入/展开预算及原文CST修改 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-placement-structure/results\.json](../docs/test-results/scene-composition-placement-structure/results.json)、[docs/test-results/scene-composition-placement-structure/app-check\.log](../docs/test-results/scene-composition-placement-structure/app-check.log)、[docs/test-results/scene-composition-placement-structure/core-results\.json](../docs/test-results/scene-composition-placement-structure/core-results.json) |
| 可移植 JS 语义 | **scene-composition-placements\.mjs：纯提案与创作回执**；来源提案、全身份复核和独立创作回执 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-placement-structure/results\.json](../docs/test-results/scene-composition-placement-structure/results.json)、[docs/test-results/scene-composition-placement-structure/app-check\.log](../docs/test-results/scene-composition-placement-structure/app-check.log)、[docs/test-results/scene-composition-placement-structure/core-results\.json](../docs/test-results/scene-composition-placement-structure/core-results.json) |
| 交互与渲染 | **整份放置管理：独立表单、预览连接与原文宿主**；各自表单、目录与完整预览连接 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-placement-structure/results\.json](../docs/test-results/scene-composition-placement-structure/results.json)、[docs/test-results/scene-composition-placement-structure/app-check\.log](../docs/test-results/scene-composition-placement-structure/app-check.log)、[docs/test-results/scene-composition-placement-structure/core-results\.json](../docs/test-results/scene-composition-placement-structure/core-results.json) |
| 存储与事务 | **整份放置管理：独立表单、预览连接与原文宿主**；原文内存应用及既有普通Save冲突边界 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-placement-structure/results\.json](../docs/test-results/scene-composition-placement-structure/results.json)、[docs/test-results/scene-composition-placement-structure/app-check\.log](../docs/test-results/scene-composition-placement-structure/app-check.log)、[docs/test-results/scene-composition-placement-structure/core-results\.json](../docs/test-results/scene-composition-placement-structure/core-results.json) |

平台：Linux实际HTTP/Chrome中英日390px原文创作、共享Rust原生/WASM和实际桌面/移动准备副本；非安装或Android设备。边界：0.0.10源码交付（审查基线9065667）；recipe/World/Scene2D/后端协议不变，未增加系统注册模块或声明能力。；新增已有片段（含原未使用片段）或复制已有放置均追加一个数组项，分配一次新的placement/全actor/group UUID；定义objectId可复用。；复制原placement CST，仅替换身份值token；保留原offset省略/显式零、六字段局部覆盖/null、顺序、空数组、数值词法和原文格式。；移除一份已有放置及其全部映射/覆盖，允许移除预览选中演员；不能删除最后一份放置。；独立可选placements_version=1和三操作；缺能力只关闭新入口，旧核心/六编辑入口保持。128KiB和完整展开的128演员/组/放置预算继续生效。；纯接口在await前分离输入；宿主重构动作、全部身份与原文补丁，完整候选检查新消费的投影/图片及全部actor/group贡献来源。；独立创作kind=placements与单placement offset编辑分开；各区不互相导入，原文仍只应用内存后普通Save处理持久化和外部冲突。；2744全应用、64新增JS、138共享核心（10新增）、8实际Chrome流程及114桌面/移动prepared标准VM案例分别记录，专项与全量重叠。；新操作只追加/移除整份放置；无重排、片段/组定义结构编辑、空间变换、多文件事务或跨视图统一历史，无安装/设备验收。。

下一步：片段演员、组织组、定义结构与重命名已另列独立创作能力；继续定义放置重排、空间层次、跨视图历史和规模边界。

<a id="scene.composition_groups_editor"></a>
### 共享片段组织组新增、名称／父组编辑、演员归组与空叶组移除

`scene.composition_groups_editor` · 场景与构建 · 源码交付

入口：当前配方原文预览→编辑组织分组→全放置组织关系及候选审阅→应用原文草稿→普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **groups\_patch\.rs：独立组织组四动作CST补丁**；严格组动作/全展开预算及原文CST修改 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-group-authoring/results\.json](../docs/test-results/scene-composition-group-authoring/results.json)、[docs/test-results/scene-composition-group-authoring/app-check\.log](../docs/test-results/scene-composition-group-authoring/app-check.log)、[docs/test-results/scene-composition-group-authoring/core-results\.json](../docs/test-results/scene-composition-group-authoring/core-results.json) |
| 可移植 JS 语义 | **scene-composition-groups\.mjs：全放置组织提案与创作回执**；来源提案、全身份及组名/父组/成员复核和独立创作回执 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-group-authoring/results\.json](../docs/test-results/scene-composition-group-authoring/results.json)、[docs/test-results/scene-composition-group-authoring/app-check\.log](../docs/test-results/scene-composition-group-authoring/app-check.log)、[docs/test-results/scene-composition-group-authoring/core-results\.json](../docs/test-results/scene-composition-group-authoring/core-results.json) |
| 交互与渲染 | **组织组创作：独立表单、预览连接与原文宿主**；各自表单、目录与完整预览连接 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-group-authoring/results\.json](../docs/test-results/scene-composition-group-authoring/results.json)、[docs/test-results/scene-composition-group-authoring/app-check\.log](../docs/test-results/scene-composition-group-authoring/app-check.log)、[docs/test-results/scene-composition-group-authoring/core-results\.json](../docs/test-results/scene-composition-group-authoring/core-results.json) |
| 存储与事务 | **组织组创作：独立表单、预览连接与原文宿主**；原文内存应用及既有普通Save冲突边界 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-group-authoring/results\.json](../docs/test-results/scene-composition-group-authoring/results.json)、[docs/test-results/scene-composition-group-authoring/app-check\.log](../docs/test-results/scene-composition-group-authoring/app-check.log)、[docs/test-results/scene-composition-group-authoring/core-results\.json](../docs/test-results/scene-composition-group-authoring/core-results.json) |

平台：Linux实际HTTP/Chrome中英日390px原文创作、共享Rust原生/WASM和实际桌面/移动准备副本；非安装或Android设备。边界：0.0.10源码交付（审查基线9065667）；recipe/World/Scene2D/后端协议不变，未增加系统注册模块或声明能力。；新增共享片段组织组，一次分配各引用放置的新group UUID；现有组局部键与全部actor/placement身份保持，未放置片段使用空目标列表。；名称和父组全量编辑、单演员归组或取消归组仅改共享声明；无净变化保留原字节，name保留原字符串，父组不得形成环或超过16层。；仅删除无直接演员和直接子组的空叶组并移除各放置映射；无隐式提升/成员转移，可删除最后组，保留groups:[]与groupIds:{}。；独立可选groups_version=1和四操作；缺能力只关闭新入口，旧核心/七编辑入口保持。128KiB和完整展开的128演员/组/放置及16层预算继续生效。；纯接口在await前分离输入；宿主重构动作、全部身份与精确原文补丁，完整候选检查投影/图片、全部actor/group贡献来源以及组名/父组/有序演员归属。；独立创作kind=groups与其余七区分开；各区不互相导入，源宿主仍只应用内存后普通Save处理持久化和外部冲突。；2816全应用、72新增JS、150共享核心（12新增）、10实际Chrome流程及142桌面/移动prepared标准VM案例分别记录，专项与全量重叠。；新操作仅组织分组；演员有效字段/绘制顺序/offset/局部覆盖原文保持；无片段定义编辑、重排、空间变换、多文件事务或跨视图统一历史，无安装/设备验收。。

下一步：定义结构与重命名已另列独立能力；继续定义组空间变换、重排及跨视图历史，保持组织组与空间层级分离。

<a id="scene.composition_definitions_editor"></a>
### 共享片段定义新增、独立复制与未放置定义移除

`scene.composition_definitions_editor` · 场景与构建 · 源码交付

入口：当前配方原文预览→管理片段定义→完整来源与候选审阅→应用原文草稿→普通保存；放置仍由独立入口处理

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **definitions\_patch\.rs：定义三动作及来源定位CST接口**；定义三动作/全展开预算及原文CST定位与修改 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-definition-authoring/results\.json](../docs/test-results/scene-composition-definition-authoring/results.json)、[docs/test-results/scene-composition-definition-authoring/app-check\.log](../docs/test-results/scene-composition-definition-authoring/app-check.log)、[docs/test-results/scene-composition-definition-authoring/core-results\.json](../docs/test-results/scene-composition-definition-authoring/core-results.json) |
| 可移植 JS 语义 | **scene-composition-definitions\.mjs：完整原始定义提案与来源创作回执**；来源提案、完整有效字段及贡献来源复核和独立创作回执 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-definition-authoring/results\.json](../docs/test-results/scene-composition-definition-authoring/results.json)、[docs/test-results/scene-composition-definition-authoring/app-check\.log](../docs/test-results/scene-composition-definition-authoring/app-check.log)、[docs/test-results/scene-composition-definition-authoring/core-results\.json](../docs/test-results/scene-composition-definition-authoring/core-results.json) |
| 交互与渲染 | **片段定义：独立表单、预览连接与原文宿主**；各自表单、目录与完整预览连接 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-definition-authoring/results\.json](../docs/test-results/scene-composition-definition-authoring/results.json)、[docs/test-results/scene-composition-definition-authoring/app-check\.log](../docs/test-results/scene-composition-definition-authoring/app-check.log)、[docs/test-results/scene-composition-definition-authoring/core-results\.json](../docs/test-results/scene-composition-definition-authoring/core-results.json) |
| 存储与事务 | **片段定义：独立表单、预览连接与原文宿主**；原文内存应用及既有普通Save冲突边界 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-definition-authoring/results\.json](../docs/test-results/scene-composition-definition-authoring/results.json)、[docs/test-results/scene-composition-definition-authoring/app-check\.log](../docs/test-results/scene-composition-definition-authoring/app-check.log)、[docs/test-results/scene-composition-definition-authoring/core-results\.json](../docs/test-results/scene-composition-definition-authoring/core-results.json) |

平台：Linux实际HTTP/Chrome中英日390px原文创作、共享Rust原生/WASM和实际桌面/移动准备副本；非安装或Android设备。边界：0.0.10源码交付（审查基线9065667）；recipe/World/Scene2D/后端协议不变，未增加系统注册模块或声明能力。；新增完整原始片段定义，界面先选择一个演员；复制仅替换所复制fragmentId值token并追加独立未放置定义；全原始声明和局部键保持。；仅移除没有任何原始placement引用的定义；至少保留一个定义，没有隐式删除放置或实例、身份分配、重排或重命名。；定义操作targets严格为空；完整展开后有效演员字段、绘制顺序和组织关系保持；删除未使用定义后重新验证JSON Pointer、UTF-16范围和有序贡献来源。；独立可选definitions_version=1与Rust CST操作；缺能力只关闭新入口，旧八个入口保持，128KiB、32定义和完整展开128演员/组/放置预算继续生效。；未放置定义候选校验全部原始对象和显式图片注册引用；有效投影和实际图片字节仍在首次放置复核，未扩大未放置依赖协议。；纯提案与独立kind=definitions接入第九创作域；宿主先分离输入、完整候选校验，再只应用内存原文，普通Save仍处理持久化及外部冲突。；2889全应用、73新增JS、163共享核心、11实际Chrome流程及166桌面/移动prepared标准VM案例分别记录，专项与全量重叠。；浏览器不能访问Node依赖；来源范围校验复用Rust CST定位接口，保持原静态资源边界；初次全量及浏览器失败保留。。

下一步：片段重命名另列scene.composition_definition_rename；继续定义重排、空间层次、嵌套或跨文件复用及跨视图历史合同。

<a id="scene.composition_definition_rename"></a>
### 共享片段重命名与全部放置引用同步

`scene.composition_definition_rename` · 场景与构建 · 源码交付

入口：原文配方预览→管理片段定义→重命名→完整来源候选审阅→草稿应用→普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **definition\_rename\.rs：保真标识与全部引用原子修改**；保真原子更新及完整原文/展开预算 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-fragment-rename/results\.json](../docs/test-results/scene-composition-fragment-rename/results.json)、[docs/test-results/scene-composition-fragment-rename/core-results\.json](../docs/test-results/scene-composition-fragment-rename/core-results.json)、[docs/test-results/scene-composition-fragment-rename/core-independent-audit\.json](../docs/test-results/scene-composition-fragment-rename/core-independent-audit.json) |
| 可移植 JS 语义 | **定义rename提案与独立核心桥的完整意图/字节复核**；完整意图/精确字节复核及九域既有候选来源 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition-fragment-rename/results\.json](../docs/test-results/scene-composition-fragment-rename/results.json)、[docs/test-results/scene-composition-fragment-rename/core-results\.json](../docs/test-results/scene-composition-fragment-rename/core-results.json)、[docs/test-results/scene-composition-fragment-rename/core-independent-audit\.json](../docs/test-results/scene-composition-fragment-rename/core-independent-audit.json) |
| 交互与渲染 | **定义管理内重命名、引用审阅及可选能力守护**；三语重命名表单、引用及稳定身份审阅 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-fragment-rename/results\.json](../docs/test-results/scene-composition-fragment-rename/results.json)、[docs/test-results/scene-composition-fragment-rename/core-results\.json](../docs/test-results/scene-composition-fragment-rename/core-results.json)、[docs/test-results/scene-composition-fragment-rename/core-independent-audit\.json](../docs/test-results/scene-composition-fragment-rename/core-independent-audit.json) |
| 存储与事务 | **定义管理内重命名、引用审阅及可选能力守护**；仅应用内存，普通保存负责持久化 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-fragment-rename/results\.json](../docs/test-results/scene-composition-fragment-rename/results.json)、[docs/test-results/scene-composition-fragment-rename/core-results\.json](../docs/test-results/scene-composition-fragment-rename/core-results.json)、[docs/test-results/scene-composition-fragment-rename/core-independent-audit\.json](../docs/test-results/scene-composition-fragment-rename/core-independent-audit.json) |

平台：Linux实际HTTP/Chrome中英日390px、Rust原生/WASM与桌面/移动实际准备副本；非安装或设备。边界：0.0.10源码交付；recipe/Scene2D/World/元数据/构建及后端协议不变；重命名复用九创作入口／八候选kind，当前系统另有八模块／24声明能力。；独立可选definition_rename_version=1；Rust原子修改定义及所有匹配放置fragmentId值；旧definitions三动作和只读locator保持。；区分大小写的原有64字符本地标识，重名冲突拒绝；同decoded标识原生严格byte-noop，纯提案拒绝unchanged。；前后完整展开及128KiB预算；保留UUID/局部键/顺序/坐标/覆盖/偏移/BOM/CRLF/数值拼写等无关字节，没有隐式生成实例或重排。；既有八字段提案/空targets和definitions工作流；source-ordered路径与完整actor/group贡献及UTF-16定位重新校验，旧片段标识不能伪装新来源。；JS桥完整意图语义和原始字符串token清单复核，Rust保持修改权威，无Node/DOM/文件IO或新JSON/YAML解析器。；能力缺失或不支持仅禁用重命名；新增/复制/未引用删除仍可审阅应用，普通Save承担持久化与冲突。；2943完整应用、172Rust、9实际Chrome流程及186prepared标准VM案例分别记录；专项与全量重叠，不代表安装或Android设备。；作者/历史日志/外部工具保持，当前文档与新增证据单独绑定，初次准备与浏览器失败保留。。

下一步：独立定义片段重排、空间层次、跨文件复用及跨视图历史契约。

<a id="scene.primitives3d"></a>
### 独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出

`scene.primitives3d` · 场景与构建 · 源码交付

入口：JSON 原文→可选 Rust 校验→独立 WebGL2 预览；同源 CLI→3D 派生计划→可检查 Godot 工程→有限探针

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **严格 3D 图元校验与精确来源范围**；严格源校验、预算与身份来源 | 3 / 3 / 4 / 3 | [docs/test-results/scene3d-primitives/results\.json](../docs/test-results/scene3d-primitives/results.json)、[docs/test-results/scene3d-primitives/core-results\.json](../docs/test-results/scene3d-primitives/core-results.json)、[docs/test-results/scene3d-primitives/core-final-confirmation-label\.json](../docs/test-results/scene3d-primitives/core-final-confirmation-label.json) |
| 可移植 JS 语义 | **可选核心桥、只读模型与独立 3D 计划**；完整语义/范围复核及后端独立计划 | 3 / 3 / 4 / 3 | [docs/test-results/scene3d-primitives/results\.json](../docs/test-results/scene3d-primitives/results.json)、[docs/test-results/scene3d-primitives/core-results\.json](../docs/test-results/scene3d-primitives/core-results.json)、[docs/test-results/scene3d-primitives/core-final-confirmation-label\.json](../docs/test-results/scene3d-primitives/core-final-confirmation-label.json) |
| 交互与渲染 | **独立只读来源端口、WebGL2 视图和三语交互**；来源只读、独立 GPU 视图、失败与释放 | 3 / 3 / 3 / 3 | [docs/test-results/scene3d-primitives/results\.json](../docs/test-results/scene3d-primitives/results.json)、[docs/test-results/scene3d-primitives/core-results\.json](../docs/test-results/scene3d-primitives/core-results.json)、[docs/test-results/scene3d-primitives/core-final-confirmation-label\.json](../docs/test-results/scene3d-primitives/core-final-confirmation-label.json) |
| 本机服务与适配 | **可检查 Godot3D 工程导出与有限实际探针**；新目录导出、库存和私有执行凭据 | 3 / 3 / 3 / 3 | [docs/test-results/scene3d-primitives/results\.json](../docs/test-results/scene3d-primitives/results.json)、[docs/test-results/scene3d-primitives/core-results\.json](../docs/test-results/scene3d-primitives/core-results.json)、[docs/test-results/scene3d-primitives/core-final-confirmation-label\.json](../docs/test-results/scene3d-primitives/core-final-confirmation-label.json) |
| 执行后端 | **可检查 Godot3D 工程导出与有限实际探针**；静态 Godot 图元与有限树/变换探针 | 3 / 3 / 3 / 3 | [docs/test-results/scene3d-primitives/results\.json](../docs/test-results/scene3d-primitives/results.json)、[docs/test-results/scene3d-primitives/core-results\.json](../docs/test-results/scene3d-primitives/core-results.json)、[docs/test-results/scene3d-primitives/core-final-confirmation-label\.json](../docs/test-results/scene3d-primitives/core-final-confirmation-label.json) |

平台：Linux 实际 HTTP/Chrome WebGL2 软件 GPU，中英日 390px、Rust 原生/WASM、实际 Godot4.7.2 无头探针、桌面/移动准备副本；非安装/设备。边界：0.0.10源码交付（审查基线9065667）；新增独立 schema1，不改变原 2D 作者格式、创作域、构建及运行协议。；严格 128KiB JSON、1–128 方块、稳定 UUID、透视相机和方向光；Rust 定位原文对象 UTF-16 范围。；RH/Y-up/−Z forward、米、度、显式 EulerXYZ；归一化极小方向向量，保留作者原数值与顺序。；第八系统模块仅依赖文档模块；24 声明能力与实际核心、WebGL2、工具检测分离，缺失读取端口仅关闭新视图。；来源只读端口绑定文档、会话和原文字节；旧响应无权更新新窗口；普通 Save 持久化，视角操作不改原文。；WebGL2 窗口关闭释放资源，无效草稿保留最近有效模型；中英日窄屏及真实软件 GPU 像素证明单独记录。；独立 kind:scene3d 计划与 Godot 适配，原始 source.json 和五文件库存可检查；旧后端能力注册不变。；全新目录排他导出、私有当前创建凭据、一次有限执行和生成文件核验；不认领外部工程，也不声称同 UID 进程沙箱。；3042 全应用、184 Rust、7 实际浏览器流程、206 prepared VM 案例及实际 Godot 探针分开记录；专项重叠，不作合计。；39 旧作者文件、3457 旧证据及 4 外部工具原字节保留；新增两个 3D 作者示例。没有安装包或 Android 设备验收。。

下一步：分别定义模型资源引用、空间层级、OC 投影、作者修改事务和行为能力，后续独立接 Bevy/NS-Nova。

<a id="scene.transform_authoring3d"></a>
### 独立 3D 对象变换原文创作

`scene.transform_authoring3d` · 场景与构建 · 源码交付

入口：已有 JSON 编辑会话→选择单对象/显式变换字段→Rust 数字补丁→完整候选审阅→原文草稿→普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **3D单对象CST数字补丁与完整原文校验**；strict source patch | 4 / 3 / 4 / 3 | [docs/test-results/scene3d-transform-authoring/results\.json](../docs/test-results/scene3d-transform-authoring/results.json)、[docs/test-results/scene3d-transform-authoring/core-results\.json](../docs/test-results/scene3d-transform-authoring/core-results.json)、[docs/test-results/scene3d-transform-authoring/core-document-review\.json](../docs/test-results/scene3d-transform-authoring/core-document-review.json) |
| 可移植 JS 语义 | **可选补丁桥与私有冻结原文提案**；branded proposal and receipt validation | 4 / 3 / 4 / 3 | [docs/test-results/scene3d-transform-authoring/results\.json](../docs/test-results/scene3d-transform-authoring/results.json)、[docs/test-results/scene3d-transform-authoring/core-results\.json](../docs/test-results/scene3d-transform-authoring/core-results.json)、[docs/test-results/scene3d-transform-authoring/core-document-review\.json](../docs/test-results/scene3d-transform-authoring/core-document-review.json) |
| 交互与渲染 | **独立三语对象变换输入与完整候选审阅**；independent review and cancellation | 4 / 3 / 4 / 3 | [docs/test-results/scene3d-transform-authoring/results\.json](../docs/test-results/scene3d-transform-authoring/results.json)、[docs/test-results/scene3d-transform-authoring/core-results\.json](../docs/test-results/scene3d-transform-authoring/core-results.json)、[docs/test-results/scene3d-transform-authoring/core-document-review\.json](../docs/test-results/scene3d-transform-authoring/core-document-review.json) |
| 交互与渲染 | **原文会话权限守护与独立系统端口**；document/session-owned draft port | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-transform-authoring/results\.json](../docs/test-results/scene3d-transform-authoring/results.json)、[docs/test-results/scene3d-transform-authoring/core-results\.json](../docs/test-results/scene3d-transform-authoring/core-results.json)、[docs/test-results/scene3d-transform-authoring/core-document-review\.json](../docs/test-results/scene3d-transform-authoring/core-document-review.json) |
| 可移植 JS 语义 | **原文会话权限守护与独立系统端口**；registered optional authoring module | 4 / 3 / 4 / 3 | [docs/test-results/scene3d-transform-authoring/results\.json](../docs/test-results/scene3d-transform-authoring/results.json)、[docs/test-results/scene3d-transform-authoring/core-results\.json](../docs/test-results/scene3d-transform-authoring/core-results.json)、[docs/test-results/scene3d-transform-authoring/core-document-review\.json](../docs/test-results/scene3d-transform-authoring/core-document-review.json) |

平台：Linux实际HTTP/Chrome，三语390px；软件WebGL预览回归、共享Rust原生/WASM与桌面/移动prepared纯层；非设备验收。边界：0.0.10/base3a91e84 之后未发布工作树增量；独立第九模块及25项声明能力，不扩充旧只读预览端口。；位置、XYZ欧拉旋转、尺寸非空子集及稳定UUID；CST仅改净变化数字，保留BOM/CRLF、无关词元、其他对象及全部场景语义。；原生/WASM可选补丁ABI；native合法noop由portable提案层拒绝，未修改候选没有应用审批。；私有冻结提案品牌，路径/token/完整原文/保存基线/当前SHA及文档/加载/草稿epoch共同守护；每次等待后重新检查。；独立三语表单保留未应用输入和完整候选，静默输入/目标变化、取消或迟到回执不可应用旧审批。；只更新内存草稿，普通Save保留磁盘冲突；旧预览独立消费新原文，缺失WebGL/World/构建不关闭字段编辑。；原生、WASM、完整应用、实际HTTP浏览器和216prepared案例分别记录；没有新安装包、设备或硬件GPU验收。。

下一步：独立明确结构增删、模型资源、空间层级和跨对象变换；不将此表单解释为3D gizmo或执行事务。

<a id="scene.object_authoring3d"></a>
### 独立 3D 对象新增、复制与移除

`scene.object_authoring3d` · 场景与构建 · 源码交付

入口：已有 JSON 编辑会话→选择对象操作／新身份→完整候选审阅→原文草稿→普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **3D对象数组CST结构补丁与完整候选验证**；strict structure patch | 4 / 3 / 4 / 3 | [docs/test-results/scene3d-object-authoring/core-results\.json](../docs/test-results/scene3d-object-authoring/core-results.json)、[docs/test-results/scene3d-object-authoring/core-native-test\.log](../docs/test-results/scene3d-object-authoring/core-native-test.log)、[docs/test-results/scene3d-object-authoring/core-clippy\.log](../docs/test-results/scene3d-object-authoring/core-clippy.log) |
| 可移植 JS 语义 | **可选对象补丁桥与独立冻结品牌及来源快照**；private object intent and complete receipt validation | 4 / 3 / 4 / 3 | [docs/test-results/scene3d-object-authoring/core-results\.json](../docs/test-results/scene3d-object-authoring/core-results.json)、[docs/test-results/scene3d-object-authoring/core-native-test\.log](../docs/test-results/scene3d-object-authoring/core-native-test.log)、[docs/test-results/scene3d-object-authoring/core-clippy\.log](../docs/test-results/scene3d-object-authoring/core-clippy.log) |
| 交互与渲染 | **独立三语对象管理及数量／身份完整审阅**；independent source review and cancellation | 4 / 3 / 4 / 3 | [docs/test-results/scene3d-object-authoring/core-results\.json](../docs/test-results/scene3d-object-authoring/core-results.json)、[docs/test-results/scene3d-object-authoring/core-native-test\.log](../docs/test-results/scene3d-object-authoring/core-native-test.log)、[docs/test-results/scene3d-object-authoring/core-clippy\.log](../docs/test-results/scene3d-object-authoring/core-clippy.log) |
| 交互与渲染 | **共享文档来源守护与独立对象端口及能力注册**；document-owned guarded in-memory apply | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-object-authoring/core-results\.json](../docs/test-results/scene3d-object-authoring/core-results.json)、[docs/test-results/scene3d-object-authoring/core-native-test\.log](../docs/test-results/scene3d-object-authoring/core-native-test.log)、[docs/test-results/scene3d-object-authoring/core-clippy\.log](../docs/test-results/scene3d-object-authoring/core-clippy.log) |
| 可移植 JS 语义 | **共享文档来源守护与独立对象端口及能力注册**；optional authoring-only module registration | 4 / 3 / 4 / 3 | [docs/test-results/scene3d-object-authoring/core-results\.json](../docs/test-results/scene3d-object-authoring/core-results.json)、[docs/test-results/scene3d-object-authoring/core-native-test\.log](../docs/test-results/scene3d-object-authoring/core-native-test.log)、[docs/test-results/scene3d-object-authoring/core-clippy\.log](../docs/test-results/scene3d-object-authoring/core-clippy.log) |

平台：Linux实际HTTP/Chrome与三语390px；软件GPU预览另记、共享Rust原生/WASM和桌面/移动prepared纯层；非设备验收。边界：0.0.10/base3a91e84 之后未发布工作树；第十固定模块、26项声明能力，不扩充旧只读预览端口。；严格 schema1 方块，1–128对象及128KiB UTF-8整份输入／候选预算；新身份拒绝冲突，删除最后对象拒绝。；复制完整原CST对象，只替换新UUID与明确改变的名称词元；同值escaped名称、escaped键、数值词元及全部源对象保持。；增删只改对象数组必要结构，保留其他对象身份、顺序与原声明，以及相机、光、顶层原文和BOM/CRLF。；与变换提案各有私有冻结品牌；共享五字段来源检查及宿主应用守护，不共享控制器、审批或Save/World/渲染/执行权限。；路径/token/当前raw/保存基线/当前SHA、文档与加载／草稿epoch每次等待后复核；并发赢家保留，迟到回执不覆盖。；普通Save仍保护外部冲突；关闭预览/变换/World/build或缺失WebGL不关闭结构审阅；三语切换保留作者名称、新身份及审批。；实际原生/WASM、浏览器、完整应用及prepared纯层证据分别记录，不代表新安装、Android设备或硬件GPU验收。。

下一步：空间层级、模型资源及多对象事务分别设计；不把结构表单当成3D gizmo、执行场景或128对象以上规模验收。

<a id="scene.environment_authoring3d"></a>
### 独立3D作者相机、方向光与背景编辑

`scene.environment_authoring3d` · 场景与构建 · 源码交付

入口：当前JSON原文→显式环境字段→完整候选审阅→原文草稿→普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **3D环境原子CST叶值补丁与完整候选校验**；atomic complete environment patch | 4 / 3 / 4 / 3 | [docs/test-results/scene3d-environment-authoring/baseline\.json](../docs/test-results/scene3d-environment-authoring/baseline.json)、[docs/test-results/scene3d-environment-authoring/source-freeze\.json](../docs/test-results/scene3d-environment-authoring/source-freeze.json)、[docs/test-results/scene3d-environment-authoring/core-results\.json](../docs/test-results/scene3d-environment-authoring/core-results.json) |
| 可移植 JS 语义 | **可选环境补丁桥与原文值库存及独立品牌**；private environment intent and bound raw value receipt | 4 / 3 / 4 / 3 | [docs/test-results/scene3d-environment-authoring/baseline\.json](../docs/test-results/scene3d-environment-authoring/baseline.json)、[docs/test-results/scene3d-environment-authoring/source-freeze\.json](../docs/test-results/scene3d-environment-authoring/source-freeze.json)、[docs/test-results/scene3d-environment-authoring/core-results\.json](../docs/test-results/scene3d-environment-authoring/core-results.json) |
| 交互与渲染 | **独立三语环境字段审阅和取消**；independent localized author environment review | 4 / 3 / 4 / 3 | [docs/test-results/scene3d-environment-authoring/baseline\.json](../docs/test-results/scene3d-environment-authoring/baseline.json)、[docs/test-results/scene3d-environment-authoring/source-freeze\.json](../docs/test-results/scene3d-environment-authoring/source-freeze.json)、[docs/test-results/scene3d-environment-authoring/core-results\.json](../docs/test-results/scene3d-environment-authoring/core-results.json) |
| 交互与渲染 | **文档来源会话守护与独立环境模块接线**；document-owned guarded unsaved source apply | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-environment-authoring/baseline\.json](../docs/test-results/scene3d-environment-authoring/baseline.json)、[docs/test-results/scene3d-environment-authoring/source-freeze\.json](../docs/test-results/scene3d-environment-authoring/source-freeze.json)、[docs/test-results/scene3d-environment-authoring/core-results\.json](../docs/test-results/scene3d-environment-authoring/core-results.json) |
| 可移植 JS 语义 | **文档来源会话守护与独立环境模块接线**；optional authoring-only environment module | 4 / 3 / 4 / 3 | [docs/test-results/scene3d-environment-authoring/baseline\.json](../docs/test-results/scene3d-environment-authoring/baseline.json)、[docs/test-results/scene3d-environment-authoring/source-freeze\.json](../docs/test-results/scene3d-environment-authoring/source-freeze.json)、[docs/test-results/scene3d-environment-authoring/core-results\.json](../docs/test-results/scene3d-environment-authoring/core-results.json) |

平台：Linux实际HTTP/Chrome三语390px与软件GPU预览、共享Rust原生/WASM与桌面/移动prepared纯层；非安装或设备。边界：0.0.10/base3a91e84之后未发布工作树；第十一固定模块、27项声明能力，旧readonly来源端口不扩权。；严格非空camera/light/background叶字段；原文及完整最终场景各验证一次，跨字段原子候选允许有效最终结果，不验证临时中间状态。；仅净变化数字/颜色值token可替换，固定净路径顺序；保留全部对象、所有键、未选字段、BOM/CRLF及词法。；环境、对象与变换提案各有私有冻结品牌；共享五字段来源守护与文档宿主审批，草稿改变使其他旧审批失效。；作者环境只读原文声明，预览临时orbit/zoom不填入表单；WebGL/World/build/其他创作入口缺失不关闭独立环境编辑。；三语表单显式勾选、完整候选审阅、取消与失主等待守护；Apply仅改草稿，普通Save处理磁盘持久化及外部冲突。；独立审核实证回执字段名交换错误；修后property key tokens不可替换，完整语义及净value token联合绑定。初始失败与修后记录均保存。；原生/WASM、完整应用、实际Chrome/SwiftShader和prepared标准VM各自验证，不作重复加总，未作新安装、Android设备或硬件GPU验收。。

下一步：模型资源、空间层级、材料和多对象编辑事务分别定义；此字段编辑不代表3D gizmo、场景运行或全局撤销实现。

<a id="scene.properties_authoring3d"></a>
### 独立3D对象名称与颜色编辑

`scene.properties_authoring3d` · 场景与构建 · 源码交付

入口：当前JSON原文→指定稳定UUID与明确名称／颜色→完整候选审阅→原文草稿→普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **3D名称与颜色CST值补丁及完整候选验证**；atomic string-value patch and complete scene validation | 4 / 3 / 4 / 3 | [docs/test-results/scene3d-property-authoring/baseline\.json](../docs/test-results/scene3d-property-authoring/baseline.json)、[docs/test-results/scene3d-property-authoring/source-freeze-confirmed\.json](../docs/test-results/scene3d-property-authoring/source-freeze-confirmed.json)、[docs/test-results/scene3d-property-authoring/core-results\.json](../docs/test-results/scene3d-property-authoring/core-results.json) |
| 可移植 JS 语义 | **可选属性补丁桥与独立冻结品牌**；private property intent and bound raw string receipt | 4 / 3 / 4 / 3 | [docs/test-results/scene3d-property-authoring/baseline\.json](../docs/test-results/scene3d-property-authoring/baseline.json)、[docs/test-results/scene3d-property-authoring/source-freeze-confirmed\.json](../docs/test-results/scene3d-property-authoring/source-freeze-confirmed.json)、[docs/test-results/scene3d-property-authoring/core-results\.json](../docs/test-results/scene3d-property-authoring/core-results.json) |
| 交互与渲染 | **独立三语对象属性审阅与原名称保留**；independent localized property review and original name retention | 4 / 3 / 4 / 3 | [docs/test-results/scene3d-property-authoring/baseline\.json](../docs/test-results/scene3d-property-authoring/baseline.json)、[docs/test-results/scene3d-property-authoring/source-freeze-confirmed\.json](../docs/test-results/scene3d-property-authoring/source-freeze-confirmed.json)、[docs/test-results/scene3d-property-authoring/core-results\.json](../docs/test-results/scene3d-property-authoring/core-results.json) |
| 交互与渲染 | **文档来源守护与独立属性模块装配**；document-owned guarded unsaved source apply | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-property-authoring/baseline\.json](../docs/test-results/scene3d-property-authoring/baseline.json)、[docs/test-results/scene3d-property-authoring/source-freeze-confirmed\.json](../docs/test-results/scene3d-property-authoring/source-freeze-confirmed.json)、[docs/test-results/scene3d-property-authoring/core-results\.json](../docs/test-results/scene3d-property-authoring/core-results.json) |
| 可移植 JS 语义 | **文档来源守护与独立属性模块装配**；optional independent authoring property module | 4 / 3 / 4 / 3 | [docs/test-results/scene3d-property-authoring/baseline\.json](../docs/test-results/scene3d-property-authoring/baseline.json)、[docs/test-results/scene3d-property-authoring/source-freeze-confirmed\.json](../docs/test-results/scene3d-property-authoring/source-freeze-confirmed.json)、[docs/test-results/scene3d-property-authoring/core-results\.json](../docs/test-results/scene3d-property-authoring/core-results.json) |

平台：Linux实际HTTP/Chrome三语390px与软件GPU预览、共享Rust原生/WASM及桌面/移动prepared纯层。边界：0.0.10/base3a91e84之后未发布工作树，第十二固定模块、28项声明能力，只依赖文档模块。；名称沿用旧解析规则：1–256个Unicode码点，不trim或规范化空白；颜色六位hex及大小写原样。；原文与完整最终场景各验证一次，只替换净授权字符串值词元；保留全部键、数字、BOM/CRLF、几何与非目标对象。；四种3D提案各有私有冻结品牌，共享五字段来源与宿主等待守护；旧readonly端口保持三字段。；三语表单默认不选字段，原name含CRLF/CR时未编辑选中保留作者原串；完整审阅、取消及失主等待守护独立。；Apply仅修改内存草稿，普通Save保持持久及外部冲突权威；不依赖preview、World、build或其他编辑控制器。；原生/WASM、完整应用、实际Chrome/SwiftShader与prepared纯层分别验证，无新安装或设备验收。。

下一步：模型素材、空间层级、材料、多对象事务与gizmo分别定义；属性字段不构成完整材料编辑。

<a id="scene.navigation3d"></a>
### 3D对象检索、临时聚焦与原文定位

`scene.navigation3d` · 场景与构建 · 源码交付

入口：当前JSON原文→Rust有效模型→独立文字检索／临时聚焦→稳定UUID重解析→返回原文声明

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **只读显示索引与私有原文定位回执**；validated-model display index and native exact-location private receipt | 4 / 3 / 4 / 3 | [docs/test-results/scene3d-navigation/baseline\.json](../docs/test-results/scene3d-navigation/baseline.json)、[docs/test-results/scene3d-navigation/source-freeze-verified\.json](../docs/test-results/scene3d-navigation/source-freeze-verified.json)、[docs/test-results/scene3d-navigation/renderer-results\.json](../docs/test-results/scene3d-navigation/renderer-results.json) |
| 交互与渲染 | **完整方块临时镜头与浮动原点渲染**；temporary whole-box framing and view-local float32 origin | 4 / 3 / 4 / 3 | [docs/test-results/scene3d-navigation/baseline\.json](../docs/test-results/scene3d-navigation/baseline.json)、[docs/test-results/scene3d-navigation/source-freeze-verified\.json](../docs/test-results/scene3d-navigation/source-freeze-verified.json)、[docs/test-results/scene3d-navigation/renderer-results\.json](../docs/test-results/scene3d-navigation/renderer-results.json) |
| 交互与渲染 | **独立3D检索选择与聚焦／返回原文界面**；localized readonly stable selection and independent view navigation | 4 / 3 / 4 / 3 | [docs/test-results/scene3d-navigation/baseline\.json](../docs/test-results/scene3d-navigation/baseline.json)、[docs/test-results/scene3d-navigation/source-freeze-verified\.json](../docs/test-results/scene3d-navigation/source-freeze-verified.json)、[docs/test-results/scene3d-navigation/renderer-results\.json](../docs/test-results/scene3d-navigation/renderer-results.json) |
| 交互与渲染 | **当前原文选择与一次性焦点宿主守护**；document-owned selection and guarded once-only focus | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-navigation/baseline\.json](../docs/test-results/scene3d-navigation/baseline.json)、[docs/test-results/scene3d-navigation/source-freeze-verified\.json](../docs/test-results/scene3d-navigation/source-freeze-verified.json)、[docs/test-results/scene3d-navigation/renderer-results\.json](../docs/test-results/scene3d-navigation/renderer-results.json) |

平台：Linux实际HTTP/Chrome中英日390px与SwiftShader、共享Rust有效来源与桌面/移动prepared纯模块。边界：0.0.10/base3a91e84之后未发布增量，仍十二固定模块／28项能力，没有作者格式或执行协议升级。；索引只投影已通过Rust校验的对象名称、UUID与来源，字面大小写查询只影响显示，不重新解析作者语义。；筛选隐藏选择时保留UUID和声明并提示；有效刷新重排保留身份，无效原文保留最近有效画面。；按实际GPU画布视场角和包围球聚焦完整方块，临时裁剪及浮动原点属于渲染；重置和刷新恢复作者相机。；只读来源仍为sourcePath/token/content三字段，可选locateSource只拥有selection/scroll/once-focus；不取得草稿应用、Save、World或后端。；宿主重新native parse定位UUID，完整内容/文档/会话/基线/版本和调用方审批在等待后保持，拒绝旧范围和晚到焦点。；BOM/CRLF/CR/nonBMP的native原文UTF16范围仅映射到完整匹配的textarea LF显示，raw作者字节与Save基线保持。；实际Chrome/软件WebGL、完整应用和桌面/移动纯准备副本分别记录，不声称新安装/Android/硬件GPU验收。。

下一步：空间层级、模型素材、行为与多对象创作分别实现；当前检索列表不形成3D树、碰撞或gizmo。

<a id="scene.picking3d"></a>
### 3D画布几何选择与双击聚焦

`scene.picking3d` · 场景与构建 · 源码交付

入口：有效Rust模型→实际Float32绘图帧→可见方块表面命中→稳定UUID选择／明确临时聚焦

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **实际绘图矩阵的纯方块表面命中**；Renderer-owned geometry and gestures, or model-owned independent readonly selection; no author or host grant\. | 4 / 3 / 4 / 3 | [docs/test-results/scene3d-picking/baseline\.json](../docs/test-results/scene3d-picking/baseline.json)、[docs/test-results/scene3d-picking/source-freeze-final\.json](../docs/test-results/scene3d-picking/source-freeze-final.json)、[docs/test-results/scene3d-picking/renderer-results\.json](../docs/test-results/scene3d-picking/renderer-results.json) |
| 交互与渲染 | **私有绘图帧与可撤销画布手势适配**；Renderer-owned geometry and gestures, or model-owned independent readonly selection; no author or host grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-picking/baseline\.json](../docs/test-results/scene3d-picking/baseline.json)、[docs/test-results/scene3d-picking/source-freeze-final\.json](../docs/test-results/scene3d-picking/source-freeze-final.json)、[docs/test-results/scene3d-picking/renderer-results\.json](../docs/test-results/scene3d-picking/renderer-results.json) |
| 交互与渲染 | **独立预览的稳定选择与临时聚焦接线**；Renderer-owned geometry and gestures, or model-owned independent readonly selection; no author or host grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-picking/baseline\.json](../docs/test-results/scene3d-picking/baseline.json)、[docs/test-results/scene3d-picking/source-freeze-final\.json](../docs/test-results/scene3d-picking/source-freeze-final.json)、[docs/test-results/scene3d-picking/renderer-results\.json](../docs/test-results/scene3d-picking/renderer-results.json) |

平台：Linux实际HTTP/Chrome中英日390px与SwiftShader、桌面／移动prepared纯Float32命中模块。边界：0.0.10之后未发布视图增量，保持12固定模块／28声明能力、作者格式、Rust／WASM及后端协议。；纯命中仅消费最近绘图的矩阵与CSS坐标，不读作者正文、原文范围、宿主或具体引擎。；使用相同浮动原点及实际上传矩阵，真实入口／出口表面必须在齐次裁剪内，近面不形成新几何。；最近表面遮挡优先，完全同深度按现有LEQUAL顺序选择后声明；不宣称抗锯齿与深度量化逐像素ID一致。；超过4CSSpx才旋转，返回起点仍为拖动；取消、多指、滚轮、手势中的位置／尺寸变化、模型变化及意外丢失捕获撤销旧手势；正常抬起释放保持原生双击。；渲染只通知UUID与冻结focus提示；独立预览核当前画布／适配器／文档／模型后共用选择路径。；筛选及空白点击保持当前选择；旧有效画面可查看，但其原文定位仍须宿主完整来源一致。；Chrome软件WebGL、正式应用、独立三角面参考及prepared纯VM分别记录，不提升安装／设备成熟度。。

下一步：空间结构、素材和多对象创作分别推进；点击选择不构成编辑gizmo、碰撞、像素ID缓冲或新的作者规则。

<a id="scene.selection_feedback3d"></a>
### 3D稳定选择的实体边缘反馈

`scene.selection_feedback3d` · 场景与构建 · 源码交付

入口：列表／画布稳定UUID→只读临时选择→原实体同pass边带→原遮挡／裁剪→明确双击临时聚焦

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **原实体单pass视觉选择及几何帧守护**；Renderer-owned display feedback and private geometric frame identity, or independent model-owned selection synchronization; no semantic or source-writing grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-selection-feedback/baseline\.json](../docs/test-results/scene3d-selection-feedback/baseline.json)、[docs/test-results/scene3d-selection-feedback/source-freeze-confirmed\.json](../docs/test-results/scene3d-selection-feedback/source-freeze-confirmed.json)、[docs/test-results/scene3d-selection-feedback/source-phase-confirmation\.json](../docs/test-results/scene3d-selection-feedback/source-phase-confirmation.json) |
| 交互与渲染 | **独立预览的稳定选择反馈同步与三语说明**；Renderer-owned display feedback and private geometric frame identity, or independent model-owned selection synchronization; no semantic or source-writing grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-selection-feedback/baseline\.json](../docs/test-results/scene3d-selection-feedback/baseline.json)、[docs/test-results/scene3d-selection-feedback/source-freeze-confirmed\.json](../docs/test-results/scene3d-selection-feedback/source-freeze-confirmed.json)、[docs/test-results/scene3d-selection-feedback/source-phase-confirmation\.json](../docs/test-results/scene3d-selection-feedback/source-phase-confirmation.json) |

平台：Linux实际HTTP/Chrome中英日390px与SwiftShader、桌面／移动prepared实际copiedrenderer＋注入GLspy。边界：0.0.10之后未发布视图增量；十二模块／28声明能力、原文作者格式、Rust／WASM、宿主和后端保持。；原实体片元着色通过局部面坐标和导数辨识真实边缘；双tone不修改作者颜色或几何。；单一原实体pass，Float32矩阵、LEQUAL深度和声明顺序保持；没有对角线、裁剪cap、膨胀几何或透视通道。；几何完全一致的私有反馈重绘保留tap.frame，普通重绘、模型、相机、尺寸和分配变化仍撤销旧资格。；独立GUI selected仍为唯一选择事实源；可选setter仅消费UUID/null，重复值不重绘，不取得写入或Save资格。；过滤、Reset、lastvalid画面保持选择；刷新重排／删除身份按原选择守护，原文定位仍须完整来源一致。；相关442/renderer67/UI196/独立23/portable298与真实Chrome33分别记录，重叠计数不相加。；首次浏览器近裁剪错误属于producer假设，初败与完整脚本保持；最终两harness变化由source phase明确绑定。；导数线宽近似；极细几何不保证内部可辨，隐藏对象通过列表／声明／聚焦确认；不宣称像素ID、安装或设备验收。。

下一步：空间结构、模型素材与作者批次继续各自推进；本反馈不构成gizmo、层级、材质或统一场景事务。

<a id="scene.translation_authoring3d"></a>
### 3D多对象原子整体移动

`scene.translation_authoring3d` · 场景与构建 · 源码交付

入口：独立多选／偏移→Rust一次计算校验→完整候选审阅→当前原文草稿→普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **原子共同偏移与保真位置数字补丁**；Independent native atomic semantic, accessor-safe optional bridge, privately branded proposal, isolated UI or source host; explicit port and draft ownership, no renderer/backend/Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-translation-authoring/baseline\.json](../docs/test-results/scene3d-translation-authoring/baseline.json)、[docs/test-results/scene3d-translation-authoring/source-freeze-confirmed\.json](../docs/test-results/scene3d-translation-authoring/source-freeze-confirmed.json)、[docs/test-results/scene3d-translation-authoring/source-hashes-confirmed\.json](../docs/test-results/scene3d-translation-authoring/source-hashes-confirmed.json) |
| 可移植 JS 语义 | **可选translation桥接与完整回执数字词元见证**；Independent native atomic semantic, accessor-safe optional bridge, privately branded proposal, isolated UI or source host; explicit port and draft ownership, no renderer/backend/Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-translation-authoring/baseline\.json](../docs/test-results/scene3d-translation-authoring/baseline.json)、[docs/test-results/scene3d-translation-authoring/source-freeze-confirmed\.json](../docs/test-results/scene3d-translation-authoring/source-freeze-confirmed.json)、[docs/test-results/scene3d-translation-authoring/source-hashes-confirmed\.json](../docs/test-results/scene3d-translation-authoring/source-hashes-confirmed.json) |
| 可移植 JS 语义 | **独立私有多对象提案与来源摘要准备**；Independent native atomic semantic, accessor-safe optional bridge, privately branded proposal, isolated UI or source host; explicit port and draft ownership, no renderer/backend/Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-translation-authoring/baseline\.json](../docs/test-results/scene3d-translation-authoring/baseline.json)、[docs/test-results/scene3d-translation-authoring/source-freeze-confirmed\.json](../docs/test-results/scene3d-translation-authoring/source-freeze-confirmed.json)、[docs/test-results/scene3d-translation-authoring/source-hashes-confirmed\.json](../docs/test-results/scene3d-translation-authoring/source-hashes-confirmed.json) |
| 交互与渲染 | **独立多选偏移表单与三语完整候选审批**；Independent native atomic semantic, accessor-safe optional bridge, privately branded proposal, isolated UI or source host; explicit port and draft ownership, no renderer/backend/Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-translation-authoring/baseline\.json](../docs/test-results/scene3d-translation-authoring/baseline.json)、[docs/test-results/scene3d-translation-authoring/source-freeze-confirmed\.json](../docs/test-results/scene3d-translation-authoring/source-freeze-confirmed.json)、[docs/test-results/scene3d-translation-authoring/source-hashes-confirmed\.json](../docs/test-results/scene3d-translation-authoring/source-hashes-confirmed.json) |
| 交互与渲染 | **第十三模块独立端口与共享最后草稿守护**；Independent native atomic semantic, accessor-safe optional bridge, privately branded proposal, isolated UI or source host; explicit port and draft ownership, no renderer/backend/Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-translation-authoring/baseline\.json](../docs/test-results/scene3d-translation-authoring/baseline.json)、[docs/test-results/scene3d-translation-authoring/source-freeze-confirmed\.json](../docs/test-results/scene3d-translation-authoring/source-freeze-confirmed.json)、[docs/test-results/scene3d-translation-authoring/source-hashes-confirmed\.json](../docs/test-results/scene3d-translation-authoring/source-hashes-confirmed.json) |

平台：Linux实际HTTP/Chrome中英日390px与SwiftShader、desktop/mobile prepared标准VM纯入口与隔离端口。边界：0.0.10之后未发布增量；十三固定模块／29声明能力，scene3d schema与后端、原四域、renderer保持。；1–128个现有不同UUID，共同XYZ偏移各轴±200000，全部最终position各轴±100000。；一份原model/CST合并位置数字词元，完整最终原文≤128KiB；任一失败无部分移动，目标与路径按sourceorder。；五字段来源、本域私有品牌、完整before/afterObjects与候选；复制／另外四域品牌不能转移审批。；独立UI选择不借preview选择；检索保持隐藏目标，zero或全部舍入无净变化不形成审批。；原文／表单／query／owner／关闭撤销approval；三digest与最后会话守护，完整内存write一次，Save继续基线冲突。；全应用、Rust、portable和真实Chrome分别记录，重叠测试不相加；真实Save与Conflict只在disposable workspace。；标准VM只证明实际copied模块，不取得Node/DOM/fetch/process；Chrome软件GPU与设备／安装交付分开。。

下一步：空间结构、模型素材、批次旋转缩放和统一历史仍分别设计；本域不构成层级、gizmo或跨文件提交。

<a id="scene.alignment_authoring3d"></a>
### 3D多对象参照轴位置对齐

`scene.alignment_authoring3d` · 场景与构建 · 源码交付

入口：独立多选／所选参照／世界轴→Rust原子位置词元补丁→完整审阅→当前原文草稿→普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **明确所选参照的原子世界轴位置数字补丁**；Independent native position semantics, optional accessor-safe receipt bridge, sixth private proposal, explicit UI or guarded source-host port\. Authored world-axis reference only; no renderer, bounding-box, backend or Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-alignment-authoring/baseline\.json](../docs/test-results/scene3d-alignment-authoring/baseline.json)、[docs/test-results/scene3d-alignment-authoring/source-hashes-browser-final\.json](../docs/test-results/scene3d-alignment-authoring/source-hashes-browser-final.json)、[docs/test-results/scene3d-alignment-authoring/source-phase-confirmation\.json](../docs/test-results/scene3d-alignment-authoring/source-phase-confirmation.json) |
| 可移植 JS 语义 | **独立alignment可选桥接与完整位置词元回执见证**；Independent native position semantics, optional accessor-safe receipt bridge, sixth private proposal, explicit UI or guarded source-host port\. Authored world-axis reference only; no renderer, bounding-box, backend or Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-alignment-authoring/baseline\.json](../docs/test-results/scene3d-alignment-authoring/baseline.json)、[docs/test-results/scene3d-alignment-authoring/source-hashes-browser-final\.json](../docs/test-results/scene3d-alignment-authoring/source-hashes-browser-final.json)、[docs/test-results/scene3d-alignment-authoring/source-phase-confirmation\.json](../docs/test-results/scene3d-alignment-authoring/source-phase-confirmation.json) |
| 可移植 JS 语义 | **第六私有对齐提案与五字段来源摘要准备**；Independent native position semantics, optional accessor-safe receipt bridge, sixth private proposal, explicit UI or guarded source-host port\. Authored world-axis reference only; no renderer, bounding-box, backend or Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-alignment-authoring/baseline\.json](../docs/test-results/scene3d-alignment-authoring/baseline.json)、[docs/test-results/scene3d-alignment-authoring/source-hashes-browser-final\.json](../docs/test-results/scene3d-alignment-authoring/source-hashes-browser-final.json)、[docs/test-results/scene3d-alignment-authoring/source-phase-confirmation\.json](../docs/test-results/scene3d-alignment-authoring/source-phase-confirmation.json) |
| 交互与渲染 | **独立多选参照轴表单与三语完整候选审批**；Independent native position semantics, optional accessor-safe receipt bridge, sixth private proposal, explicit UI or guarded source-host port\. Authored world-axis reference only; no renderer, bounding-box, backend or Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-alignment-authoring/baseline\.json](../docs/test-results/scene3d-alignment-authoring/baseline.json)、[docs/test-results/scene3d-alignment-authoring/source-hashes-browser-final\.json](../docs/test-results/scene3d-alignment-authoring/source-hashes-browser-final.json)、[docs/test-results/scene3d-alignment-authoring/source-phase-confirmation\.json](../docs/test-results/scene3d-alignment-authoring/source-phase-confirmation.json) |
| 交互与渲染 | **第十四模块明确来源端口与最后整份草稿守护**；Independent native position semantics, optional accessor-safe receipt bridge, sixth private proposal, explicit UI or guarded source-host port\. Authored world-axis reference only; no renderer, bounding-box, backend or Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-alignment-authoring/baseline\.json](../docs/test-results/scene3d-alignment-authoring/baseline.json)、[docs/test-results/scene3d-alignment-authoring/source-hashes-browser-final\.json](../docs/test-results/scene3d-alignment-authoring/source-hashes-browser-final.json)、[docs/test-results/scene3d-alignment-authoring/source-phase-confirmation\.json](../docs/test-results/scene3d-alignment-authoring/source-phase-confirmation.json) |

平台：Linux隔离副本实际HTTP/Chrome三语390px与SwiftShader、desktop/mobile prepared标准VM与注入端口。边界：0.0.10之后未发布增量；十四固定模块／30声明能力，作者schema、预览渲染、后端及原五创作域保持。；2–128个现有不同小写UUID，参照必须由用户明确指定且属于所选；axis只接受作者世界x/y/z。；直接设置为原参照对象该轴position坐标，不做差值累加、AABB、旋转包围盒、表面或视角对齐；不改其他轴、尺寸、旋转或身份。；同份原model/CST合并净变化位置数字词元，完整原文与最终原文各≤128KiB；目标／路径按sourceorder，不净变的指数／负零词元保持。；独立可选ABI仅依赖parse；第六私有提案品牌与五字段来源、完整before/afterObjects绑定；克隆及原五域提案不能借用审批。；独立UI不借预览选择或相机；检索保持隐藏目标／明确参照，撤销参照不会自动重选，原文／表单／query／关闭／owner变更撤销approval。；异步摘要前捕获来源与意图，宿主重核会话与整份候选并仅一次写内存；普通Save继续拥有磁盘、基线和冲突权威。；本轮全应用／native／WASM／prepared／真实Chrome分证，实际测试在隔离副本及临时作品执行；源码写回另由具体审阅记录确认，不提高安装／设备成熟度。；标准VM无Node/DOM/fetch/process，只取得注入DTO/hash与fakeGL端口；Chrome为SwiftShader软件WebGL，不作硬件GPU、Android或已安装版验收。。

下一步：旋转包围盒／表面对齐、批量复制、空间层级、模型素材、gizmo与统一历史仍分别设计，不以位置坐标对齐冒充几何布局。

<a id="scene.distribution_authoring3d"></a>
### 3D多对象单轴位置等距分布

`scene.distribution_authoring3d` · 场景与构建 · 源码交付

入口：独立多选／作者世界轴→原坐标排序与固定两端→Rust原子位置词元补丁→完整审阅→当前原文草稿→普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **固定两端并验证精度的原子等距位置数字补丁**；Independent native equal-gap position semantics, strict binary64 representability and fixed endpoints, optional complete receipt bridge, seventh private proposal, explicit UI or guarded source-host port\. No geometry, renderer, backend or Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-distribution-authoring/baseline\.json](../docs/test-results/scene3d-distribution-authoring/baseline.json)、[docs/test-results/scene3d-distribution-authoring/source-hashes-final\.json](../docs/test-results/scene3d-distribution-authoring/source-hashes-final.json)、[docs/test-results/scene3d-distribution-authoring/source-freeze-final\.json](../docs/test-results/scene3d-distribution-authoring/source-freeze-final.json) |
| 可移植 JS 语义 | **独立distribution可选桥接与双顺序完整词元回执见证**；Independent native equal-gap position semantics, strict binary64 representability and fixed endpoints, optional complete receipt bridge, seventh private proposal, explicit UI or guarded source-host port\. No geometry, renderer, backend or Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-distribution-authoring/baseline\.json](../docs/test-results/scene3d-distribution-authoring/baseline.json)、[docs/test-results/scene3d-distribution-authoring/source-hashes-final\.json](../docs/test-results/scene3d-distribution-authoring/source-hashes-final.json)、[docs/test-results/scene3d-distribution-authoring/source-freeze-final\.json](../docs/test-results/scene3d-distribution-authoring/source-freeze-final.json) |
| 可移植 JS 语义 | **第七私有分布提案与五字段来源摘要准备**；Independent native equal-gap position semantics, strict binary64 representability and fixed endpoints, optional complete receipt bridge, seventh private proposal, explicit UI or guarded source-host port\. No geometry, renderer, backend or Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-distribution-authoring/baseline\.json](../docs/test-results/scene3d-distribution-authoring/baseline.json)、[docs/test-results/scene3d-distribution-authoring/source-hashes-final\.json](../docs/test-results/scene3d-distribution-authoring/source-hashes-final.json)、[docs/test-results/scene3d-distribution-authoring/source-freeze-final\.json](../docs/test-results/scene3d-distribution-authoring/source-freeze-final.json) |
| 交互与渲染 | **独立多选世界轴表单与原生排序三语候选审批**；Independent native equal-gap position semantics, strict binary64 representability and fixed endpoints, optional complete receipt bridge, seventh private proposal, explicit UI or guarded source-host port\. No geometry, renderer, backend or Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-distribution-authoring/baseline\.json](../docs/test-results/scene3d-distribution-authoring/baseline.json)、[docs/test-results/scene3d-distribution-authoring/source-hashes-final\.json](../docs/test-results/scene3d-distribution-authoring/source-hashes-final.json)、[docs/test-results/scene3d-distribution-authoring/source-freeze-final\.json](../docs/test-results/scene3d-distribution-authoring/source-freeze-final.json) |
| 交互与渲染 | **第十五模块明确来源端口与最后整份草稿守护**；Independent native equal-gap position semantics, strict binary64 representability and fixed endpoints, optional complete receipt bridge, seventh private proposal, explicit UI or guarded source-host port\. No geometry, renderer, backend or Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-distribution-authoring/baseline\.json](../docs/test-results/scene3d-distribution-authoring/baseline.json)、[docs/test-results/scene3d-distribution-authoring/source-hashes-final\.json](../docs/test-results/scene3d-distribution-authoring/source-hashes-final.json)、[docs/test-results/scene3d-distribution-authoring/source-freeze-final\.json](../docs/test-results/scene3d-distribution-authoring/source-freeze-final.json) |

平台：Linux隔离副本实际HTTP/Chrome三语390px与SwiftShader、desktop/mobile prepared标准VM与注入端口。边界：0.0.10之后未发布增量；十五固定模块／31声明能力，作者schema、预览渲染、后端及原六创作域保持。；显式选择3–128个不同现有小写UUID，axis只接受作者世界x/y/z；原轴坐标数值升序，重合坐标包括±0均以原声明顺序打破平局。；两端保留原坐标与原数字词元；中间位置严格按binary64 start+(end-start)*(i/(n-1))先比例、乘跨度、再加起点，不作AABB、尺寸、表面、屏幕或透视分布。；零跨度合法原文无净变化；正跨度完整计算序列包括两端必须有限、在position边界内且严格递增，精度不足整批拒绝，不把折叠或重叠默认为成功。；一份原model/CST合并所有净变化位置数字词元，完整原文与最终候选各≤128KiB；instanceIds及净路径按sourceorder，orderedInstanceIds另表原数值排序；其他轴、UUID、旋转、尺寸、环境和词法保持。；独立可选ABI只依赖parse；第七私有品牌与五字段来源及完整before/afterObjects绑定；六个原域品牌和克隆不能借用审批。；独立UI不借预览选择或临时相机；检索保持隐藏目标，不在UI计算分布；表单、query、原文、归属、旧行事件和关闭改变撤销approval，异步摘要前捕获全部来源。；宿主重核会话与整份候选，仅一次写内存草稿；普通Save仍掌管磁盘、基线及外部冲突，原世界查询及后端不授予新编辑权。；本轮full/native/WASM/copied/实际Chrome分别记录，测试在隔离副本及临时作品执行；实际源码写回由独立记录确认，无新commit/push/安装或设备交付。；标准VM无Node/DOM/fetch/process，只有显式DTO/hash/fakeGL端口；Chrome使用SwiftShader软件WebGL，不宣称Android或硬件GPU验收。。

下一步：批量复制、几何包围盒布局、空间层级、模型素材、gizmo和跨视图统一历史仍需分别设计，不以作者位置等距分布代替。

<a id="scene.copy_authoring3d"></a>
### 3D多对象原文保真批量复制

`scene.copy_authoring3d` · 场景与构建 · 源码交付

入口：独立选择来源与新UUID／共同XYZ位移→Rust原子保真副本→完整审阅→当前原文草稿→普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **原子保真副本、身份与最终场景预算**；Independent atomic CST copying, complete slot-aware receipt bridge, eighth private proposal, explicit UI or guarded source-host port\. No renderer/backend/Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-copy-authoring/baseline\.json](../docs/test-results/scene3d-copy-authoring/baseline.json)、[docs/test-results/scene3d-copy-authoring/source-hashes-final\.json](../docs/test-results/scene3d-copy-authoring/source-hashes-final.json)、[docs/test-results/scene3d-copy-authoring/source-freeze-final\.json](../docs/test-results/scene3d-copy-authoring/source-freeze-final.json) |
| 可移植 JS 语义 | **独立copy桥接与槽位保真完整回执见证**；Independent atomic CST copying, complete slot-aware receipt bridge, eighth private proposal, explicit UI or guarded source-host port\. No renderer/backend/Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-copy-authoring/baseline\.json](../docs/test-results/scene3d-copy-authoring/baseline.json)、[docs/test-results/scene3d-copy-authoring/source-hashes-final\.json](../docs/test-results/scene3d-copy-authoring/source-hashes-final.json)、[docs/test-results/scene3d-copy-authoring/source-freeze-final\.json](../docs/test-results/scene3d-copy-authoring/source-freeze-final.json) |
| 可移植 JS 语义 | **第八私有复制提案及五字段摘要准备**；Independent atomic CST copying, complete slot-aware receipt bridge, eighth private proposal, explicit UI or guarded source-host port\. No renderer/backend/Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-copy-authoring/baseline\.json](../docs/test-results/scene3d-copy-authoring/baseline.json)、[docs/test-results/scene3d-copy-authoring/source-hashes-final\.json](../docs/test-results/scene3d-copy-authoring/source-hashes-final.json)、[docs/test-results/scene3d-copy-authoring/source-freeze-final\.json](../docs/test-results/scene3d-copy-authoring/source-freeze-final.json) |
| 交互与渲染 | **显式UUID映射、动态容量与三语复制审阅**；Independent atomic CST copying, complete slot-aware receipt bridge, eighth private proposal, explicit UI or guarded source-host port\. No renderer/backend/Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-copy-authoring/baseline\.json](../docs/test-results/scene3d-copy-authoring/baseline.json)、[docs/test-results/scene3d-copy-authoring/source-hashes-final\.json](../docs/test-results/scene3d-copy-authoring/source-hashes-final.json)、[docs/test-results/scene3d-copy-authoring/source-freeze-final\.json](../docs/test-results/scene3d-copy-authoring/source-freeze-final.json) |
| 交互与渲染 | **第十六模块独立来源及完整草稿最终守护**；Independent atomic CST copying, complete slot-aware receipt bridge, eighth private proposal, explicit UI or guarded source-host port\. No renderer/backend/Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-copy-authoring/baseline\.json](../docs/test-results/scene3d-copy-authoring/baseline.json)、[docs/test-results/scene3d-copy-authoring/source-hashes-final\.json](../docs/test-results/scene3d-copy-authoring/source-hashes-final.json)、[docs/test-results/scene3d-copy-authoring/source-freeze-final\.json](../docs/test-results/scene3d-copy-authoring/source-freeze-final.json) |

平台：Linux隔离HTTP/Chrome三语390px与SwiftShader、desktop/mobile准备副本标准VM。边界：0.0.10之后未发布增量；十六固定模块／32声明能力。作者schema、预览、后端及原七创作域保持。；每个不同现有来源UUID对应独立新UUID，规范映射和追加副本按原声明顺序；全部原声明及其文本原样保留。；请求1–127对映射，实际同时受来源数量和最终128对象预算限制，最大成功批次64；不截断超量选择。；共同XYZ按binary64逐分量相加，偏移每轴±200000，副本最终位置每轴±100000；名称、旋转、尺寸和颜色继承。零偏移也创建新身份，可能重叠。；复制整段来源CST，仅替换新UUID及净变化位置数字词元。单次固定尾部插入和完整最终解析／128KiB预算，任一目标无效整批拒绝。；独立可选ABI与第八私有提案品牌，五字段来源、前后对象诊断和完整回执绑定。七旧域和克隆不能借用审批。；桥接以原生model／sourceLocations及联合字符串数字词元见证定位身份与位置槽位；名称等于UUID或旋转等于位置也不能授权修改别的槽位。；独立来源端口只改草稿；查询、表单、映射、来源、取消、旧行和异步归属变化撤销审批，普通Save处理持久化及冲突。；全3752、Rust290、准备副本362及真实Chrome40流程在隔离副本完成；实际工程写回单独记录，不提高安装、设备或硬件GPU成熟度。。

下一步：包围盒布局、层级、模型资源、gizmo和跨视图统一历史需分别设计。

<a id="scene.removal_authoring3d"></a>
### 3D多对象原文保真原子批量移除

`scene.removal_authoring3d` · 场景与构建 · 源码交付

入口：显式来源选择→Rust一次原子移除→待删除与全部保留声明审阅→当前原文草稿→普通保存／冲突

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **原CST连续run原子移除与完整来源预算**；Independent atomic CST removal, exact UTF16 complete-cut receipt bridge, ninth private proposal, explicit survivor-aware UI or guarded source-host port\. No renderer/backend/Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-removal-authoring/baseline\.json](../docs/test-results/scene3d-removal-authoring/baseline.json)、[docs/test-results/scene3d-removal-authoring/core-results\.json](../docs/test-results/scene3d-removal-authoring/core-results.json)、[docs/test-results/scene3d-removal-authoring/core-fmt-initial\.log](../docs/test-results/scene3d-removal-authoring/core-fmt-initial.log) |
| 可移植 JS 语义 | **独立removal桥接与UTF16完整切除回执见证**；Independent atomic CST removal, exact UTF16 complete-cut receipt bridge, ninth private proposal, explicit survivor-aware UI or guarded source-host port\. No renderer/backend/Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-removal-authoring/baseline\.json](../docs/test-results/scene3d-removal-authoring/baseline.json)、[docs/test-results/scene3d-removal-authoring/core-results\.json](../docs/test-results/scene3d-removal-authoring/core-results.json)、[docs/test-results/scene3d-removal-authoring/core-fmt-initial\.log](../docs/test-results/scene3d-removal-authoring/core-fmt-initial.log) |
| 可移植 JS 语义 | **第九私有移除提案与五字段摘要重算守护**；Independent atomic CST removal, exact UTF16 complete-cut receipt bridge, ninth private proposal, explicit survivor-aware UI or guarded source-host port\. No renderer/backend/Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-removal-authoring/baseline\.json](../docs/test-results/scene3d-removal-authoring/baseline.json)、[docs/test-results/scene3d-removal-authoring/core-results\.json](../docs/test-results/scene3d-removal-authoring/core-results.json)、[docs/test-results/scene3d-removal-authoring/core-fmt-initial\.log](../docs/test-results/scene3d-removal-authoring/core-fmt-initial.log) |
| 交互与渲染 | **显式选择、保留对象数量与三语移除完整审阅**；Independent atomic CST removal, exact UTF16 complete-cut receipt bridge, ninth private proposal, explicit survivor-aware UI or guarded source-host port\. No renderer/backend/Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-removal-authoring/baseline\.json](../docs/test-results/scene3d-removal-authoring/baseline.json)、[docs/test-results/scene3d-removal-authoring/core-results\.json](../docs/test-results/scene3d-removal-authoring/core-results.json)、[docs/test-results/scene3d-removal-authoring/core-fmt-initial\.log](../docs/test-results/scene3d-removal-authoring/core-fmt-initial.log) |
| 交互与渲染 | **第十七模块独立来源与当前草稿最终归属守护**；Independent atomic CST removal, exact UTF16 complete-cut receipt bridge, ninth private proposal, explicit survivor-aware UI or guarded source-host port\. No renderer/backend/Save grant\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-removal-authoring/baseline\.json](../docs/test-results/scene3d-removal-authoring/baseline.json)、[docs/test-results/scene3d-removal-authoring/core-results\.json](../docs/test-results/scene3d-removal-authoring/core-results.json)、[docs/test-results/scene3d-removal-authoring/core-fmt-initial\.log](../docs/test-results/scene3d-removal-authoring/core-fmt-initial.log) |

平台：Linux隔离HTTP／Chrome三语390px与软件WebGL实测、desktop／mobile准备副本标准VM。边界：0.0.10之后未发布增量；十七固定模块／33声明能力。严格3D作者schema、旧八创作域、只读预览和后端语义保持。；精确四字段请求 scene3d.removeObjects；选择1–128个不同现有小写UUID，必须至少保留一个对象，实际最大成功移除127。全选、重复、未知或空选择整批拒绝，不截断选择。；完整原文解析和128KiB／128对象预算优先于移除意图；删除无效对象不能修复无效原文，超预算来源不能靠删除绕过预算。；复用原CST连续run分隔符切除，一组原区间、一次拼接、一次完整最终解析；保留声明及原文区间外字节不变，幸存对象顺序、身份、名称、变换、颜色和场景环境保持。；独立可选ABI viento_core_scene3d_removal_version v1；四字段回执规范instanceIds按原声明顺序，changedPaths用原objects索引，而非删除后索引。；桥接以原生model和UTF16 sourceLocations独立复现原文删除区间，要求完整afterContent相等，再要求完整过滤后model相等；无需引入新JSON作者语义解析器。；第九WeakSet私有品牌与精确十一字段深冻结提案；五字段来源在异步摘要前捕获，摘要后重算完整候选。旧八品牌十六方向及序列化克隆不能借用移除审批。；独立document来源端口只改草稿，默认不选择；查询只过滤列表，隐藏已选对象仍参与。全选保留完整选择并解释必须保留一对象，raw checkbox/query/source与旧行变化撤销审批。；已记录307 Rust（新17）、新增桥接与纯提案24、旧核心作者245、30 CLI／WASM向量、独立16及准备副本378项。HTTP／Chrome报告按各自来源SHA和当轮流程判定；最终来源刷新与全链复验由收尾记录，不把准备副本或软件GPU当成安装／设备验收。。

下一步：包围盒布局、层级、模型资源、gizmo和跨视图统一历史需分别设计。

<a id="scene.framing3d"></a>
### 3D全场景临时取景

`scene.framing3d` · 场景与构建 · 源码交付

入口：当前有效预览模型→全部旋转角点包围→实际画布比例临时相机→三语取景／重置

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **旋转方块全景包围与临时相机纯数学**；View-only full loaded scene framing; no author state, source-write port or backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-scene-framing/regression\.json](../docs/test-results/scene3d-scene-framing/regression.json)、[docs/test-results/scene3d-scene-framing/browser-verified/browser\.json](../docs/test-results/scene3d-scene-framing/browser-verified/browser.json)、[docs/test-results/scene3d-scene-framing/legacy-browser/browser\.json](../docs/test-results/scene3d-scene-framing/legacy-browser/browser.json) |
| 交互与渲染 | **全景GPU取景、手势清理与绘制失败反馈**；View-only full loaded scene framing; no author state, source-write port or backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-scene-framing/regression\.json](../docs/test-results/scene3d-scene-framing/regression.json)、[docs/test-results/scene3d-scene-framing/browser-verified/browser\.json](../docs/test-results/scene3d-scene-framing/browser-verified/browser.json)、[docs/test-results/scene3d-scene-framing/legacy-browser/browser\.json](../docs/test-results/scene3d-scene-framing/legacy-browser/browser.json) |
| 交互与渲染 | **现有只读预览的可选全景入口与三语状态**；View-only full loaded scene framing; no author state, source-write port or backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-scene-framing/regression\.json](../docs/test-results/scene3d-scene-framing/regression.json)、[docs/test-results/scene3d-scene-framing/browser-verified/browser\.json](../docs/test-results/scene3d-scene-framing/browser-verified/browser.json)、[docs/test-results/scene3d-scene-framing/legacy-browser/browser\.json](../docs/test-results/scene3d-scene-framing/legacy-browser/browser.json) |

平台：本机浏览器和桌面源码；实际Chrome显式ANGLE/SwiftShader，默认headless合成异常单独保留、桌面与移动准备副本的纯模块；设备未验收。边界：完整当前有效预览的1–128个方块参与，不受搜索、隐藏选择或当前所选对象影响。；纯数学保守包围、GPU适配和可选界面方法分开；17模块／33能力，无新作者ABI、宿主端口或引擎协议。；取景保持当前观看方向与FOV，临时裁剪及缩放范围独立；重置与成功刷新恢复作者相机。；无效草稿继续查看旧有效模型且保留诊断；取景不会授权原文定位、草稿应用或普通保存。；实际绘图失败清除命中资格并报告绘制中断，校验拒绝不修改相机；细小远物体不承诺像素可辨识。；只验证源码、复制资源与软件WebGL，不提升安装、设备或硬件GPU验收。。

下一步：六向标准观察已由独立工作树功能接入；相机平移、正交观察、模型素材和空间层级继续分别推进。

<a id="scene.standard_views3d"></a>
### 3D六向标准观察与极点导航

`scene.standard_views3d` · 场景与构建 · 源码交付

入口：有效预览→方向选择→临时up与整景取景→极点缩放／拖动／点选→作者相机重置

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **六向临时相机基底与极点连续轨道**；Explicit temporary view basis and six-direction navigation only; no author state, source writes, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-standard-views/results\.json](../docs/test-results/scene3d-standard-views/results.json)、[docs/test-results/scene3d-standard-views/browser/browser\.json](../docs/test-results/scene3d-standard-views/browser/browser.json)、[docs/test-results/scene3d-standard-views/prepared\.json](../docs/test-results/scene3d-standard-views/prepared.json) |
| 交互与渲染 | **六向临时相机基底与极点连续轨道**；Explicit temporary view basis and six-direction navigation only; no author state, source writes, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-standard-views/results\.json](../docs/test-results/scene3d-standard-views/results.json)、[docs/test-results/scene3d-standard-views/browser/browser\.json](../docs/test-results/scene3d-standard-views/browser/browser.json)、[docs/test-results/scene3d-standard-views/prepared\.json](../docs/test-results/scene3d-standard-views/prepared.json) |
| 交互与渲染 | **标准方向GPU适配与共享原子取景**；Explicit temporary view basis and six-direction navigation only; no author state, source writes, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-standard-views/results\.json](../docs/test-results/scene3d-standard-views/results.json)、[docs/test-results/scene3d-standard-views/browser/browser\.json](../docs/test-results/scene3d-standard-views/browser/browser.json)、[docs/test-results/scene3d-standard-views/prepared\.json](../docs/test-results/scene3d-standard-views/prepared.json) |
| 交互与渲染 | **三语方向选择与只读会话守卫**；Explicit temporary view basis and six-direction navigation only; no author state, source writes, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-standard-views/results\.json](../docs/test-results/scene3d-standard-views/results.json)、[docs/test-results/scene3d-standard-views/browser/browser\.json](../docs/test-results/scene3d-standard-views/browser/browser.json)、[docs/test-results/scene3d-standard-views/prepared\.json](../docs/test-results/scene3d-standard-views/prepared.json) |

平台：实际HTTP浏览器与显式ANGLE/SwiftShader软件WebGL2、桌面／移动资源副本纯模块，未验安装或Android设备。边界：前后左右俯仰六向精确观察，透视投影与全部当前有效对象，筛选和选择不缩小范围。；纯数学、GPU适配、三语界面独立，显式up仅属于临时视图；作者schema、Rust、宿主和后端不变。；俯视上方−Z、仰视上方+Z；屏幕局部轴连续旋转，滚轮保持精确方向，reset/refresh恢复作者相机。；失效来源保留最近有效预览与诊断，不授予来源定位或草稿写入权；部分绘图失败撤销命中帧并报告。；254项相关回归、真实Chrome软件WebGL七类流程、520截图像素检查与资源副本分证；无全量／安装／设备新结论。。

下一步：相机平移、正交观察及坐标提示分别定义视图状态；模型素材与空间层级继续独立推进。

<a id="scene.pan3d"></a>
### 3D临时镜头平移与独立手势模式

`scene.pan3d` · 场景与构建 · 源码交付

入口：有效预览→选择旋转／平移或临时修饰手势→屏幕平面移动镜头→保持选择与原文→恢复作者相机

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **屏幕平面临时相机平移与逐轴精度守护**；Temporary screen-plane camera translation and independent drag-mode handling only; no author state, source writes, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-pan/report\.json](../docs/test-results/scene3d-pan/report.json)、[docs/test-results/scene3d-pan/targeted-tests\.tap](../docs/test-results/scene3d-pan/targeted-tests.tap)、[docs/test-results/scene3d-pan/browser/browser\.json](../docs/test-results/scene3d-pan/browser/browser.json) |
| 交互与渲染 | **屏幕平面临时相机平移与逐轴精度守护**；Temporary screen-plane camera translation and independent drag-mode handling only; no author state, source writes, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-pan/report\.json](../docs/test-results/scene3d-pan/report.json)、[docs/test-results/scene3d-pan/targeted-tests\.tap](../docs/test-results/scene3d-pan/targeted-tests.tap)、[docs/test-results/scene3d-pan/browser/browser\.json](../docs/test-results/scene3d-pan/browser/browser.json) |
| 交互与渲染 | **独立拖动模式、修饰手势与GPU平移回滚**；Temporary screen-plane camera translation and independent drag-mode handling only; no author state, source writes, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-pan/report\.json](../docs/test-results/scene3d-pan/report.json)、[docs/test-results/scene3d-pan/targeted-tests\.tap](../docs/test-results/scene3d-pan/targeted-tests.tap)、[docs/test-results/scene3d-pan/browser/browser\.json](../docs/test-results/scene3d-pan/browser/browser.json) |
| 交互与渲染 | **三语拖动方式切换与只读会话接线**；Temporary screen-plane camera translation and independent drag-mode handling only; no author state, source writes, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-pan/report\.json](../docs/test-results/scene3d-pan/report.json)、[docs/test-results/scene3d-pan/targeted-tests\.tap](../docs/test-results/scene3d-pan/targeted-tests.tap)、[docs/test-results/scene3d-pan/browser/browser\.json](../docs/test-results/scene3d-pan/browser/browser.json) |

平台：HTTP 浏览器／WebGL2 只读视图；实际环境见专题记录、桌面／移动资源副本，未验新安装或 Android 设备。边界：相机与目标一起在当前屏幕平面平移，保持方向、距离、FOV、裁剪和临时 up；目标深度几何跟随 CSS 拖动。；CSS 画布尺寸与实际绘图缓冲比例分开，支持六向和自由视角；溢出、位移精度丢失及 Float32 上传失败拒绝。；setDragMode/snapshot.dragMode 显式报告临时手势模式；Shift 左拖和中键仅对按下时的手势生效，平移不点选或双击聚焦。；纯数学、GPU 手势适配和三语只读界面分开，旧手势停止与绘制失败回滚均不取得作者、保存、World 或执行权限。；专题回归、浏览器与准备副本各自记录实际范围，不将旧证据重标为本轮全量、安装、Android 设备或硬件 GPU 验收。。

下一步：正交观察、坐标提示和多指手势分别定义新边界；作者对象移动、空间层级与模型素材继续独立推进。

<a id="scene.orthographic3d"></a>
### 3D只读正交观察与模式相关取景

`scene.orthographic3d` · 场景与构建 · 源码交付

入口：有效预览→透视／正交切换→模式相关观察／聚焦／平移→保持作者相机与来源

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **纯投影矩阵与正交旋转几何取景**；Temporary projection matrices, mode-aware framing and read-only projection switching only; no author state, source writes, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-orthographic/report\.json](../docs/test-results/scene3d-orthographic/report.json)、[docs/test-results/scene3d-orthographic/targeted-tests\.tap](../docs/test-results/scene3d-orthographic/targeted-tests.tap)、[docs/test-results/scene3d-orthographic/browser/browser\.json](../docs/test-results/scene3d-orthographic/browser/browser.json) |
| 交互与渲染 | **纯投影矩阵与正交旋转几何取景**；Temporary projection matrices, mode-aware framing and read-only projection switching only; no author state, source writes, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-orthographic/report\.json](../docs/test-results/scene3d-orthographic/report.json)、[docs/test-results/scene3d-orthographic/targeted-tests\.tap](../docs/test-results/scene3d-orthographic/targeted-tests.tap)、[docs/test-results/scene3d-orthographic/browser/browser\.json](../docs/test-results/scene3d-orthographic/browser/browser.json) |
| 交互与渲染 | **私有投影模式、共享绘图命中与失败回滚**；Temporary projection matrices, mode-aware framing and read-only projection switching only; no author state, source writes, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-orthographic/report\.json](../docs/test-results/scene3d-orthographic/report.json)、[docs/test-results/scene3d-orthographic/targeted-tests\.tap](../docs/test-results/scene3d-orthographic/targeted-tests.tap)、[docs/test-results/scene3d-orthographic/browser/browser\.json](../docs/test-results/scene3d-orthographic/browser/browser.json) |
| 交互与渲染 | **三语透视／正交切换与只读会话守护**；Temporary projection matrices, mode-aware framing and read-only projection switching only; no author state, source writes, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-orthographic/report\.json](../docs/test-results/scene3d-orthographic/report.json)、[docs/test-results/scene3d-orthographic/targeted-tests\.tap](../docs/test-results/scene3d-orthographic/targeted-tests.tap)、[docs/test-results/scene3d-orthographic/browser/browser\.json](../docs/test-results/scene3d-orthographic/browser/browser.json) |

平台：HTTP 浏览器／WebGL2 只读视图；实际环境见专题记录、桌面／移动资源副本，未验新安装或 Android 设备。边界：纯 cameraProjection4 只返回投影矩阵，lookAt 单独负责相机基底；默认透视逐项保持，正交尺度匹配当前目标深度。；模式切换保留临时 camera、目标中心、裁剪、选择、拖动方式和聚焦距离边界，停止旧手势；其他深度尺寸依投影改变。；单对象和整景聚焦按当前投影框定旋转角点，平移接口不变；正交不同深度几何采用相同屏幕位移。；setProjectionMode/snapshot.projectionMode 显式隔离视图状态，Float32 预检与绘制失败回滚不取得作者、保存或后端权限。；重置／成功刷新恢复作者 camera 并保留投影，关闭重开默认透视；不写入 schema、元数据或 Godot 导出。；专题回归、浏览器与准备副本分别记录实际范围，旧证据不重标，不推断全量、安装、Android 设备或硬件 GPU 验收。。

下一步：坐标提示、多指导航与视图状态管理分别定义边界；作者投影格式、模型素材和空间层级继续独立推进。

<a id="scene.orientation3d"></a>
### 3D坐标方向提示与成功视图观察

`scene.orientation3d` · 场景与构建 · 源码交付

入口：有效绘图→冻结视图回执→纯三轴朝向→被动三语SVG提示→失效隐藏

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **纯相机基底到世界正轴方向**；Pure world-axis orientation, frozen successful-view observation and passive indicator only; no author source, save, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-orientation/report\.json](../docs/test-results/scene3d-orientation/report.json)、[docs/test-results/scene3d-orientation/targeted-tests\.tap](../docs/test-results/scene3d-orientation/targeted-tests.tap)、[docs/test-results/scene3d-orientation/browser/browser\.json](../docs/test-results/scene3d-orientation/browser/browser.json) |
| 交互与渲染 | **纯相机基底到世界正轴方向**；Pure world-axis orientation, frozen successful-view observation and passive indicator only; no author source, save, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-orientation/report\.json](../docs/test-results/scene3d-orientation/report.json)、[docs/test-results/scene3d-orientation/targeted-tests\.tap](../docs/test-results/scene3d-orientation/targeted-tests.tap)、[docs/test-results/scene3d-orientation/browser/browser\.json](../docs/test-results/scene3d-orientation/browser/browser.json) |
| 交互与渲染 | **成功视图冻结回执与失效观察隔离**；Pure world-axis orientation, frozen successful-view observation and passive indicator only; no author source, save, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-orientation/report\.json](../docs/test-results/scene3d-orientation/report.json)、[docs/test-results/scene3d-orientation/targeted-tests\.tap](../docs/test-results/scene3d-orientation/targeted-tests.tap)、[docs/test-results/scene3d-orientation/browser/browser\.json](../docs/test-results/scene3d-orientation/browser/browser.json) |
| 交互与渲染 | **独立被动SVG方向提示与三语无障碍说明**；Pure world-axis orientation, frozen successful-view observation and passive indicator only; no author source, save, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-orientation/report\.json](../docs/test-results/scene3d-orientation/report.json)、[docs/test-results/scene3d-orientation/targeted-tests\.tap](../docs/test-results/scene3d-orientation/targeted-tests.tap)、[docs/test-results/scene3d-orientation/browser/browser\.json](../docs/test-results/scene3d-orientation/browser/browser.json) |
| 交互与渲染 | **预览所属视图回执守护与三语角落接线**；Pure world-axis orientation, frozen successful-view observation and passive indicator only; no author source, save, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-orientation/report\.json](../docs/test-results/scene3d-orientation/report.json)、[docs/test-results/scene3d-orientation/targeted-tests\.tap](../docs/test-results/scene3d-orientation/targeted-tests.tap)、[docs/test-results/scene3d-orientation/browser/browser\.json](../docs/test-results/scene3d-orientation/browser/browser.json) |

平台：HTTP 浏览器／WebGL2 有效视图与独立 SVG；实际环境见专题记录、桌面／移动资源副本，未验新安装或 Android 设备。边界：orientationAxes 仅使用相机基底，输出冻结正 X/Y/Z 的屏幕右／下分量和朝观察者为正的 depth，独立于投影、FOV 与作者语义。；onViewChange 只发布成功视图的冻结 camera/projectionMode 或失效 null；同状态去重，观察者异常不改变绘图或释放结果。；独立组件使用 ownerDocument，三轴端点按深度排序；正方向标签与颜色同时可辨，空心背向、实心朝向或处于平面，极点及共线标签避免重叠。；约 96px 被动 SVG 不拦截指针，无 live 朗读；三语说明只翻译固定词，不读取作者名称或文本。；会话入口守护所属实例和当前有效画面；无 GPU、失效、失败或关闭时隐藏，无效新草稿仍对应最近有效预览。；无定时轮询、原文重解析、保存、点击方向、对象操纵、测量或坐标网格；不增加 schema、Rust、模块、能力或后端权限。；专题回归、浏览器与准备副本分别保留实际范围，旧证据不重标，不推断全量、安装、Android 设备或硬件 GPU 验收。。

下一步：多指导航、视图状态管理与独立网格分别定义边界；可交互方向控件、测量及对象操纵需要另行设计。

<a id="scene.touch_navigation3d"></a>
### 3D双指目标平面平移与捏合导航

`scene.touch_navigation3d` · 场景与构建 · 源码交付

入口：有效预览→两触控升级→越过阈值→中心锚定的平移与捏合→成功绘图→整次结束不误选

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **目标平面中心锚定的纯双指相机数学**；Pure target-plane touch camera math, renderer-owned touch lifecycle and conditional UI hint; no author source, save, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-touch/report\.json](../docs/test-results/scene3d-touch/report.json)、[docs/test-results/scene3d-touch/targeted-tests\.tap](../docs/test-results/scene3d-touch/targeted-tests.tap)、[docs/test-results/scene3d-touch/browser/browser\.json](../docs/test-results/scene3d-touch/browser/browser.json) |
| 交互与渲染 | **目标平面中心锚定的纯双指相机数学**；Pure target-plane touch camera math, renderer-owned touch lifecycle and conditional UI hint; no author source, save, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-touch/report\.json](../docs/test-results/scene3d-touch/report.json)、[docs/test-results/scene3d-touch/targeted-tests\.tap](../docs/test-results/scene3d-touch/targeted-tests.tap)、[docs/test-results/scene3d-touch/browser/browser\.json](../docs/test-results/scene3d-touch/browser/browser.json) |
| 交互与渲染 | **两触控输入生命周期与单次GPU提交**；Pure target-plane touch camera math, renderer-owned touch lifecycle and conditional UI hint; no author source, save, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-touch/report\.json](../docs/test-results/scene3d-touch/report.json)、[docs/test-results/scene3d-touch/targeted-tests\.tap](../docs/test-results/scene3d-touch/targeted-tests.tap)、[docs/test-results/scene3d-touch/browser/browser\.json](../docs/test-results/scene3d-touch/browser/browser.json) |
| 交互与渲染 | **按本地渲染支持显示三语触控说明**；Pure target-plane touch camera math, renderer-owned touch lifecycle and conditional UI hint; no author source, save, host IO or execution-backend authority\. | 4 / 3 / 3 / 3 | [docs/test-results/scene3d-touch/report\.json](../docs/test-results/scene3d-touch/report.json)、[docs/test-results/scene3d-touch/targeted-tests\.tap](../docs/test-results/scene3d-touch/targeted-tests.tap)、[docs/test-results/scene3d-touch/browser/browser\.json](../docs/test-results/scene3d-touch/browser/browser.json) |

平台：HTTP 浏览器／WebGL2 触控指针流程，具体环境见专题记录、桌面／移动资源副本，未验新安装或 Android 实机。边界：touchCamera 只消费临时相机、两组 CSS 触点、视口尺寸／绘图比例和距离界限；返回冻结相机或 null，不取得 DOM、来源或设备状态。；两组间距至少 4 CSS px，目标深度世界锚点跟随两指中心；使用实际夹取的缩放比例，方向与临时 up 保持，透视其他深度仍有视差。；渲染器只由两个明确 touch 指针升级，任一指累计移动超过 4px 后启动；同一动画帧合并两指最新坐标后一次绘制并更新基准，避免缩放限幅下事件先后造成纯平移尺度漂移，反向捏合立即响应。；平移与缩放作为单次完整候选预检和绘制；失败不部分提交，实际绘图失败清除命中帧与方向回执，既有取景边界保持。超出默认缩放区间的作者视角在本段使用相对距离范围，避免开始双指时跳动；范围在本段固定，已有聚焦范围原样沿用。；任意抬指、取消、丢失捕获、第三指或混合输入及视口／模型／视图变更结束整轮，不降级为残留单指误选；重新主触点才可开始。正常抬指提交末批有效位移；取消／视图变更撤销待处理输入与排帧，晚回调按手势会话守护。只有输入触发排帧，无轮询；无帧调度环境可同步适配。；supportsTouchNavigation 仅为渲染器本地 UI 提示，三语说明按支持显示；鼠标及单指原路径保持，无新按钮、module、声明能力、Rust、schema、保存或后端权限。；无双指旋转、惯性或作者变换；专题记录说明实际范围，不推断 Android 实机、硬件 GPU 或新安装产物验收。。

下一步：视图状态管理、独立网格、双指旋转与惯性分别定义交互边界；模型素材、空间层级与作者变换继续独立推进。

<a id="scene.fog3d"></a>
### 可组合3D距离雾声明、编辑与引擎适配

`scene.fog3d` · 场景与构建 · 源码交付

入口：环境表单→Rust保真提案→草稿与普通保存→只读预览／Godot工程与实际属性探针

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **Rust距离雾声明与保真补丁**；雾组件声明、来源绑定、渲染和宿主执行分别适配；复用既有环境域，不新增模板或隐式保存权限。 | 4 / 4 / 4 / 3 | [docs/test-results/scene3d-fog/results\.json](../docs/test-results/scene3d-fog/results.json)、[docs/test-results/scene3d-fog/browser-aligned/browser\.json](../docs/test-results/scene3d-fog/browser-aligned/browser.json)、[docs/test-results/scene3d-fog/godot\.json](../docs/test-results/scene3d-fog/godot.json) |
| 工程定义与格式 | **Rust距离雾声明与保真补丁**；雾组件声明、来源绑定、渲染和宿主执行分别适配；复用既有环境域，不新增模板或隐式保存权限。 | 4 / 4 / 4 / 3 | [docs/test-results/scene3d-fog/results\.json](../docs/test-results/scene3d-fog/results.json)、[docs/test-results/scene3d-fog/browser-aligned/browser\.json](../docs/test-results/scene3d-fog/browser-aligned/browser.json)、[docs/test-results/scene3d-fog/godot\.json](../docs/test-results/scene3d-fog/godot.json) |
| 可移植 JS 语义 | **雾组件提案与三语环境表单**；雾组件声明、来源绑定、渲染和宿主执行分别适配；复用既有环境域，不新增模板或隐式保存权限。 | 4 / 4 / 4 / 3 | [docs/test-results/scene3d-fog/results\.json](../docs/test-results/scene3d-fog/results.json)、[docs/test-results/scene3d-fog/browser-aligned/browser\.json](../docs/test-results/scene3d-fog/browser-aligned/browser.json)、[docs/test-results/scene3d-fog/godot\.json](../docs/test-results/scene3d-fog/godot.json) |
| 交互与渲染 | **雾组件提案与三语环境表单**；雾组件声明、来源绑定、渲染和宿主执行分别适配；复用既有环境域，不新增模板或隐式保存权限。 | 4 / 4 / 4 / 3 | [docs/test-results/scene3d-fog/results\.json](../docs/test-results/scene3d-fog/results.json)、[docs/test-results/scene3d-fog/browser-aligned/browser\.json](../docs/test-results/scene3d-fog/browser-aligned/browser.json)、[docs/test-results/scene3d-fog/godot\.json](../docs/test-results/scene3d-fog/godot.json) |
| 交互与渲染 | **只读WebGL指数雾适配**；雾组件声明、来源绑定、渲染和宿主执行分别适配；复用既有环境域，不新增模板或隐式保存权限。 | 4 / 4 / 4 / 3 | [docs/test-results/scene3d-fog/results\.json](../docs/test-results/scene3d-fog/results.json)、[docs/test-results/scene3d-fog/browser-aligned/browser\.json](../docs/test-results/scene3d-fog/browser-aligned/browser.json)、[docs/test-results/scene3d-fog/godot\.json](../docs/test-results/scene3d-fog/godot.json) |
| 执行后端 | **Godot原生雾映射与实际属性核对**；雾组件声明、来源绑定、渲染和宿主执行分别适配；复用既有环境域，不新增模板或隐式保存权限。 | 4 / 4 / 4 / 3 | [docs/test-results/scene3d-fog/results\.json](../docs/test-results/scene3d-fog/results.json)、[docs/test-results/scene3d-fog/browser-aligned/browser\.json](../docs/test-results/scene3d-fog/browser-aligned/browser.json)、[docs/test-results/scene3d-fog/godot\.json](../docs/test-results/scene3d-fog/godot.json) |
| 本机服务与适配 | **Godot原生雾映射与实际属性核对**；雾组件声明、来源绑定、渲染和宿主执行分别适配；复用既有环境域，不新增模板或隐式保存权限。 | 4 / 4 / 4 / 3 | [docs/test-results/scene3d-fog/results\.json](../docs/test-results/scene3d-fog/results.json)、[docs/test-results/scene3d-fog/browser-aligned/browser\.json](../docs/test-results/scene3d-fog/browser-aligned/browser.json)、[docs/test-results/scene3d-fog/godot\.json](../docs/test-results/scene3d-fog/godot.json) |

平台：HTTP浏览器／WebGL2软件GPU实际像素、Godot4有限无头属性探针、桌面／移动资源副本，未验安装或Android实机。边界：可选fog颜色／密度组件直接属于场景，不按游戏类型细分模板；旧场景不自动添加。；Rust负责schema1增量与原文修改，可选能力独立；共享提案和现有环境编辑器守护来源、审阅和草稿应用，普通保存独立。；WebGL2按当前临时相机的径向距离绘制指数雾，背景独立、选择边缘可读；Godot使用原生Environment并核对实际属性。；不包含时间采样、雨雪粒子、天气玩法订阅、3D Bevy 或跨引擎像素等价；本轮仅源码与资源副本。。

下一步：按实际场景需要独立接入粒子与资源、空间区域、时间变化及玩法读取，继续保持作者声明和引擎渲染分离。

<a id="scene.particles3d"></a>
### 通用3D粒子场、雨雪参数与显式时刻预览

`scene.particles3d` · 场景与构建 · 源码交付

入口：环境参数→Rust确定性分布／时刻→草稿普通保存→WebGL实例绘制／Godot工程

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **Rust粒子声明、保真补丁与确定性采样**；声明、采样、时钟、作者编辑、绘制与执行宿主各有独立接口，不共享保存权限。 | 4 / 4 / 4 / 3 | [docs/test-results/scene3d-particles/results\.json](../docs/test-results/scene3d-particles/results.json)、[docs/test-results/scene3d-particles/core/core-results\.json](../docs/test-results/scene3d-particles/core/core-results.json)、[docs/test-results/scene3d-particles/prepared\.json](../docs/test-results/scene3d-particles/prepared.json) |
| 工程定义与格式 | **Rust粒子声明、保真补丁与确定性采样**；声明、采样、时钟、作者编辑、绘制与执行宿主各有独立接口，不共享保存权限。 | 4 / 4 / 4 / 3 | [docs/test-results/scene3d-particles/results\.json](../docs/test-results/scene3d-particles/results.json)、[docs/test-results/scene3d-particles/core/core-results\.json](../docs/test-results/scene3d-particles/core/core-results.json)、[docs/test-results/scene3d-particles/prepared\.json](../docs/test-results/scene3d-particles/prepared.json) |
| 可移植 JS 语义 | **粒子严格桥接与环境作者表单**；声明、采样、时钟、作者编辑、绘制与执行宿主各有独立接口，不共享保存权限。 | 4 / 4 / 4 / 3 | [docs/test-results/scene3d-particles/results\.json](../docs/test-results/scene3d-particles/results.json)、[docs/test-results/scene3d-particles/core/core-results\.json](../docs/test-results/scene3d-particles/core/core-results.json)、[docs/test-results/scene3d-particles/prepared\.json](../docs/test-results/scene3d-particles/prepared.json) |
| 交互与渲染 | **粒子严格桥接与环境作者表单**；声明、采样、时钟、作者编辑、绘制与执行宿主各有独立接口，不共享保存权限。 | 4 / 4 / 4 / 3 | [docs/test-results/scene3d-particles/results\.json](../docs/test-results/scene3d-particles/results.json)、[docs/test-results/scene3d-particles/core/core-results\.json](../docs/test-results/scene3d-particles/core/core-results.json)、[docs/test-results/scene3d-particles/prepared\.json](../docs/test-results/scene3d-particles/prepared.json) |
| 交互与渲染 | **独立临时播放时钟与来源会话协调**；声明、采样、时钟、作者编辑、绘制与执行宿主各有独立接口，不共享保存权限。 | 4 / 4 / 4 / 3 | [docs/test-results/scene3d-particles/results\.json](../docs/test-results/scene3d-particles/results.json)、[docs/test-results/scene3d-particles/core/core-results\.json](../docs/test-results/scene3d-particles/core/core-results.json)、[docs/test-results/scene3d-particles/prepared\.json](../docs/test-results/scene3d-particles/prepared.json) |
| 交互与渲染 | **WebGL粒子实例渲染适配**；声明、采样、时钟、作者编辑、绘制与执行宿主各有独立接口，不共享保存权限。 | 4 / 4 / 4 / 3 | [docs/test-results/scene3d-particles/results\.json](../docs/test-results/scene3d-particles/results.json)、[docs/test-results/scene3d-particles/core/core-results\.json](../docs/test-results/scene3d-particles/core/core-results.json)、[docs/test-results/scene3d-particles/prepared\.json](../docs/test-results/scene3d-particles/prepared.json) |
| 执行后端 | **Godot粒子工程与受限验证适配**；声明、采样、时钟、作者编辑、绘制与执行宿主各有独立接口，不共享保存权限。 | 3 / 3 / 4 / 3 | [docs/test-results/scene3d-particles/results\.json](../docs/test-results/scene3d-particles/results.json)、[docs/test-results/scene3d-particles/core/core-results\.json](../docs/test-results/scene3d-particles/core/core-results.json)、[docs/test-results/scene3d-particles/prepared\.json](../docs/test-results/scene3d-particles/prepared.json) |
| 本机服务与适配 | **Godot粒子工程与受限验证适配**；声明、采样、时钟、作者编辑、绘制与执行宿主各有独立接口，不共享保存权限。 | 3 / 3 / 4 / 3 | [docs/test-results/scene3d-particles/results\.json](../docs/test-results/scene3d-particles/results.json)、[docs/test-results/scene3d-particles/core/core-results\.json](../docs/test-results/scene3d-particles/core/core-results.json)、[docs/test-results/scene3d-particles/prepared\.json](../docs/test-results/scene3d-particles/prepared.json) |

平台：HTTP浏览器／WebGL2软件GPU、Godot4可检查工程与隔离图形验证、桌面／移动准备副本，未验安装或实机。边界：可选粒子场属于场景；范围、尺寸和速度组合表现雨雪，不细分模板、不自动添加旧声明。；Rust无时钟；纯桥接、表单、临时播放控制与渲染器分离，播放不取得写入或后端执行权限。；粒子不成为可选中作者对象；Godot默认无头dummy无法回读非空实例时明确报告验证不可用，图形验证单独记录。；当前轴对齐盒状粒子，无纹理、透明度、碰撞、天气玩法或Bevy3D。。

下一步：按实际场景需求接入粒子素材、空间区域和玩法读取，保留中立采样与引擎扩展边界。

<a id="backend.project_delivery"></a>
### 已核对生成工程的可移植交付包

`backend.project_delivery` · 场景与构建 · 源码交付

入口：冻结构建→只读核对→三语交付审阅→准备ZIP→浏览器／桌面保存→独立内容核验

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **交付审阅纯契约**；纯审阅契约、宿主字节及生命周期、交互渲染分别持有独立接口。 | 3 / 3 / 4 / 3 | [docs/test-results/backend-project-delivery/results\.json](../docs/test-results/backend-project-delivery/results.json)、[docs/test-results/backend-project-delivery/browser-release/browser\.json](../docs/test-results/backend-project-delivery/browser-release/browser.json)、[docs/RELEASE\_0\.1\.1\.md](../docs/RELEASE_0.1.1.md) |
| 本机服务与适配 | **宿主交付计划、ZIP核验与任务生命周期**；纯审阅契约、宿主字节及生命周期、交互渲染分别持有独立接口。 | 3 / 3 / 4 / 3 | [docs/test-results/backend-project-delivery/results\.json](../docs/test-results/backend-project-delivery/results.json)、[docs/test-results/backend-project-delivery/browser-release/browser\.json](../docs/test-results/backend-project-delivery/browser-release/browser.json)、[docs/RELEASE\_0\.1\.1\.md](../docs/RELEASE_0.1.1.md) |
| 交互与渲染 | **内置交付审阅、下载和保存控制器**；纯审阅契约、宿主字节及生命周期、交互渲染分别持有独立接口。 | 3 / 3 / 4 / 3 | [docs/test-results/backend-project-delivery/results\.json](../docs/test-results/backend-project-delivery/results.json)、[docs/test-results/backend-project-delivery/browser-release/browser\.json](../docs/test-results/backend-project-delivery/browser-release/browser.json)、[docs/RELEASE\_0\.1\.1\.md](../docs/RELEASE_0.1.1.md) |
| 执行后端 | **Bevy Rust Cargo 源工程生成器与稳定来源映射**；交付完整Cargo源工程和锁文件，只有已登记源码库存进入ZIP，运行target与二进制不进入产物。 | 4 / 3 / 3 / 2 | [docs/test-results/bevy-rust-behaviors/generator-tests\.log](../docs/test-results/bevy-rust-behaviors/generator-tests.log)、[docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser\.json](../docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser.json)、[docs/test-results/bevy-rust-behaviors/app-check\.log](../docs/test-results/bevy-rust-behaviors/app-check.log) |
| 执行后端 | **Godot声音工程生成与来源诊断适配**；声音生成工程纳入实际WAV原字节和独立脚本库存，异地交付仍要求Godot工具。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio/godot-summary\.json](../docs/test-results/scene-audio/godot-summary.json)、[docs/test-results/scene-audio/browser-summary\.json](../docs/test-results/scene-audio/browser-summary.json)、[docs/test-results/scene-audio/prepared\.json](../docs/test-results/scene-audio/prepared.json) |

平台：本地HTTP浏览器下载与Godot重定位导入、桌面保存协议回归与资源副本；无新安装／Android实机验收。边界：只消费宿主已登记且完整核对的成功构建；请求绑定构建、快照与清单指纹，不接受目录或工具路径。；交付仅包含登记的project文件、素材／脚本副本、三语说明和SHA清单；作者快照、缓存、日志与清单外文件不入包。；准备持有任务占用直到流结束，服务关闭取消并等待；原生保存窗口阻止关闭，浏览器发起下载后由TTL清理，避免下载准入竞争。；纯清单契约、Node文件与ZIP适配、UI和宿主注入接口分离；校验只证明包内一致性，不授予执行或导入权限。；Godot生成工程仍需兼容Godot；旧Bevy数据包需可信程序。0.1.2后工作树的bevy-rust-project另交付Cargo源码与锁文件，需接收方工具链和缓存；三者均非独立游戏发行，新Rust生成器映射单独计工作树成熟度。；当前直接接收Scene2D后端构建目录；保存配方可先经scene.composition_materialize生成独立Scene2D，再走此交付。直接Composition／Scene3D统一组装、可执行发行与LSP服务仍另行接入。；0.1.3之后项目级多Scene2D组装由build.project_assembly单列：新增项目计划／成员来源／闭包适配不改变本功能既有单场景评分和历史验收。。

下一步：已有脚本关联管理和项目级多Scene2D组装已分别接通；后续独立定义场景切换、3D成员与目标平台发行。外部IDE／LSP通过独立文档与诊断端口接入。

<a id="behavior.authoring"></a>
### 内置行为绑定、参数与信号原文编辑

`behavior.authoring` · 场景与构建 · 源码交付

入口：已有登记绑定JSON→编辑场景行为→稳定实例／已关联TXT／typed参数／信号（可选读取已保存场景音轨并显式填入文本）→依赖核对与完整审阅→应用源码草稿→普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **行为原文补丁、私有提案与共享JSON索引**；行为语义保持现有严格协议，纯提案仅持有原文和稳定身份，不进入宿主IO。 | 3 / 4 / 3 / 3 | [docs/test-results/scene-behavior-authoring/summary\.json](../docs/test-results/scene-behavior-authoring/summary.json)、[docs/test-results/scene-behavior-authoring/browser-smoke\.json](../docs/test-results/scene-behavior-authoring/browser-smoke.json)、[docs/RELEASE\_0\.1\.1\.md](../docs/RELEASE_0.1.1.md) |
| 本机服务与适配 | **只读行为选项、登记依赖与摘要核对**；只读依赖选项与候选复验沿既有World观察和关系规则，不扩展执行或元数据写入。 | 3 / 4 / 3 / 3 | [docs/test-results/scene-behavior-authoring/summary\.json](../docs/test-results/scene-behavior-authoring/summary.json)、[docs/test-results/scene-behavior-authoring/browser-smoke\.json](../docs/test-results/scene-behavior-authoring/browser-smoke.json)、[docs/RELEASE\_0\.1\.1\.md](../docs/RELEASE_0.1.1.md) |
| 交互与渲染 | **独立文档来源与内存草稿应用宿主**；文档宿主以完整来源和已核对场景守护可选音轨目录，读前后复验来源并封装纯品牌；读取与既有提案审阅／草稿应用端口独立，不获得Save权威。 | 3 / 4 / 3 / 3 | [docs/test-results/scene-behavior-authoring/summary\.json](../docs/test-results/scene-behavior-authoring/summary.json)、[docs/test-results/scene-behavior-authoring/browser-smoke\.json](../docs/test-results/scene-behavior-authoring/browser-smoke.json)、[docs/RELEASE\_0\.1\.1\.md](../docs/RELEASE_0.1.1.md) |
| 交互与渲染 | **三语行为表单与独立系统装配**；独立三语表单读取并暂选音轨，只有显式填入才改变当前string参数；稳定行身份与会话守护隔离迟到结果，读取不锁普通编辑／审阅／应用，也不取得兄弟声音控制器或Save权威。 | 3 / 4 / 3 / 3 | [docs/test-results/scene-behavior-authoring/summary\.json](../docs/test-results/scene-behavior-authoring/summary.json)、[docs/test-results/scene-behavior-authoring/browser-smoke\.json](../docs/test-results/scene-behavior-authoring/browser-smoke.json)、[docs/RELEASE\_0\.1\.1\.md](../docs/RELEASE_0.1.1.md) |
| 可移植 JS 语义 | **场景音轨目录契约与行为来源品牌快照**；共享严格目录校验与私有品牌将已保存场景音轨约束到行为来源；显式选择只产生普通UUID文本，不识别变量用途、不形成跨文件受保护引用。 | 4 / 3 / 4 / 2 | [docs/test-results/scene-behavior-audio-picker/README\.md](../docs/test-results/scene-behavior-audio-picker/README.md)、[docs/RELEASE\_0\.1\.5\.md](../docs/RELEASE_0.1.5.md)、[docs/test-results/release-0\.1\.5/preflight\.json](../docs/test-results/release-0.1.5/preflight.json) |
| 本机服务与适配 | **已保存场景音轨的只读World服务与HTTP路由**；现有World读取边界解析唯一audio关系和已保存清单，独立认证HTTP读取只返回受限目录；不读取素材字节、不保存、不执行，也不接管行为编辑审批。 | 4 / 3 / 4 / 2 | [docs/test-results/scene-behavior-audio-picker/README\.md](../docs/test-results/scene-behavior-audio-picker/README.md)、[docs/RELEASE\_0\.1\.5\.md](../docs/RELEASE_0.1.5.md)、[docs/test-results/release-0\.1\.5/preflight\.json](../docs/test-results/release-0.1.5/preflight.json) |

平台：当前本机编辑服务与浏览器；实测范围以新专题为准、已有运行后端验收仍沿原专题，本轮不新增执行、安装或Android实机声明。边界：独立第18模块org.viento.scene-behaviors提供scene.authoring.behaviors；仅当前本机编辑服务，不代表Android行为编辑或新安装验收。；固定原场景、后端和语言；新增UUID由界面分配，保留已有bindingId，同实例可多行为，1–32条绑定且不能删除最后一条。；只选择已登记且由清单引用的TXT与所属场景实例；沿既有场景／角色／源码关系规则核对，不建立关联、不新建绑定文档。；参数保留文本／数字／布尔类型，信号映射遵守原预算；具体脚本导出类型和实际信号仍由后端构建／运行验证，界面不执行脚本。；JS私有提案与无浏览器第三方依赖的JSON索引保留未修改原文；同结构只改叶值，集合结构变化只重写选中容器，未知schema或重复键不自动清洗。；检查／应用核对原文字节、来源修订、保存基线、编辑会话与依赖摘要；仅同步修改内存，普通保存持有磁盘写入与外部冲突权限。；本表单不新建清单或关联；首次创建有独立behavior.creation入口，引用和回源由behavior.script_links负责。中立表单可编辑有效Rust声明，具体执行由独立behavior.bevy_rust接入；场景／后端／语言迁移、LSP、热更新及3D行为仍未接入。；0.1.5收录可选音轨编号助手：只读当前行为所属已保存场景及其唯一显式audio关系，保持作者轨道顺序、角色和UUID；不以资源字节可读或PCM／哈希验证作为目录读取前提。；目录快照绑定行为原文五字段与场景描述；不自动识别track_id等名称，任意string参数均须先选择再显式填入普通文本，number／boolean不出现选择器。填入不建立静态引用、保护未来轨道删除或自动更新行为源码。；读取与暂选不改表单、审阅或文件；等待和失败不阻塞普通检查／应用，来源及会话守护丢弃迟到结果，私有参数行身份防止切换绑定、删除或改类型后误填。三语切换保持输入与暂选，Cancel不写入；Apply仍仅更新原文草稿。；本次增量不增加Studio模块或能力：仍为21模块／40能力；不改变作者schema、后端协议或Rust ABI，不执行脚本／声音，不等于安装、Android实机或新的Godot／Bevy运行验收。；0.1.5收录本功能的0.1.4后工作树增量；发布检查见release-0.1.5，历史专题及评分按原范围保留，不把源码交付推导为安装、设备或新增后端执行验收。。

下一步：首次创建见behavior.creation与behavior.multi_creation，内置TXT草稿见script.authoring，已有脚本引用和回源见behavior.script_links；音轨助手仅减少普通string输入，后续继续推进显式引用契约、源码体验与标准LSP接口，不能把现有字符串推导为受保护引用。

<a id="behavior.creation"></a>
### 从已保存场景首次创建行为声明与关联

`behavior.creation` · 场景与构建 · 源码交付

入口：构建与运行选择已保存Scene2D→添加场景行为→已登记TXT与稳定实例→完整原文及关联审阅→三文件可恢复保存→打开原文→既有参数／信号编辑

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **中立首次行为创建、三文件规划及冻结依赖校验**；无副作用规则只规划声明、登记和恢复所需观察，具体提交与执行留在宿主。 | 3 / 4 / 3 / 3 | [docs/test-results/scene-behavior-creation/README\.md](../docs/test-results/scene-behavior-creation/README.md)、[docs/test-results/scene-behavior-creation/summary\.json](../docs/test-results/scene-behavior-creation/summary.json)、[docs/RELEASE\_0\.1\.1\.md](../docs/RELEASE_0.1.1.md) |
| 本机服务与适配 | **World命令适配、混合创建事务与v9恢复**；单命令将三目标变更交给受锁和摘要守护的v9事务；冻结只读依赖不作为恢复写入目标。 | 3 / 4 / 3 / 3 | [docs/test-results/scene-behavior-creation/README\.md](../docs/test-results/scene-behavior-creation/README.md)、[docs/test-results/scene-behavior-creation/summary\.json](../docs/test-results/scene-behavior-creation/summary.json)、[docs/RELEASE\_0\.1\.1\.md](../docs/RELEASE_0.1.1.md) |
| 本机服务与适配 | **首次创建只读实例与TXT目录服务**；只读目录共用核心场景准入和World快照，不分配UUID、不生成文件、不检测或运行工具。 | 3 / 4 / 3 / 3 | [docs/test-results/scene-behavior-creation/README\.md](../docs/test-results/scene-behavior-creation/README.md)、[docs/test-results/scene-behavior-creation/summary\.json](../docs/test-results/scene-behavior-creation/summary.json)、[docs/RELEASE\_0\.1\.1\.md](../docs/RELEASE_0.1.1.md) |
| 交互与渲染 | **三语首次创建控制器、构建入口与原文导航宿主**；首次创建控制器、构建父宿主和原文导航独立归属；后续已有清单编辑仍走原私有草稿提案。 | 3 / 4 / 3 / 3 | [docs/test-results/scene-behavior-creation/README\.md](../docs/test-results/scene-behavior-creation/README.md)、[docs/test-results/scene-behavior-creation/summary\.json](../docs/test-results/scene-behavior-creation/summary.json)、[docs/RELEASE\_0\.1\.1\.md](../docs/RELEASE_0.1.1.md) |

平台：本机Linux编辑服务、HTTP与浏览器；验证范围以首次创建专题为准、工作树功能；未声明新安装产物或Android设备可用。边界：现有org.viento.build模块提供scene.authoring.behavior-creation；该专题初次接入19模块／36项声明能力，当前系统20／37，入口实际可用仍取决于宿主behavior.create命令。；已发布首界面从Scene2D v2／v3生成一条Godot4／GDScript绑定，参数和信号初始为空；0.1.2之后多绑定清单另列behavior.multi_creation，原中立事务复用且不新增执行支持。；新文档UUID与bindingId由界面一次分配，输入修改撤销预览但保持身份；已有任何behavior关联，包括失效关联，都不允许再首次创建。；可移植规划复用严格行为声明、角色实例、已登记TXT、完整Scene2D计划和版本检查；只读选项不暴露脚本正文或本机路径。；一次事务只新建声明正文和登记，并保真追加原场景登记的唯一behavior边；新声明只派生场景与脚本references，原场景、角色和脚本正文保持。；宿主以登记锁和完整World重查提交三文件；v9恢复先核摘要和冻结依赖证据，再整体回退或补齐，不读取或覆盖当前只读作者依赖。；保存后的原文导航独立核身份、路径、修订和会话；继续使用既有行为编辑器的typed参数／信号审阅、草稿应用与普通保存。创建不解析或执行脚本，也不取得工具路径。；本首次创建专题限Linux编辑服务；新增Rust声明选项另映射behavior.bevy_rust，不用旧Godot证据证明Rust执行。已有声明场景／后端／语言迁移、LSP、Scene3D行为、安装更新及Android实机仍待接入。。

下一步：首次多绑定与已有声明新增引用分别由behavior.multi_creation和behavior.script_links接通；新Rust通道另列behavior.bevy_rust。标准LSP、已有声明迁移与3D验收继续单独推进。

<a id="script.authoring"></a>
### 内置脚本起始内容与普通TXT草稿保存

`script.authoring` · 编辑与创作 · 源码交付

入口：新建脚本→起始内容／工程类型／TXT路径→完整预览→普通原文草稿→编辑与保存→首次行为创建→参数／信号→运行交付

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **已知脚本起始内容与纯草稿提案**；可移植纯规划只选择起始内容和校验当前TXT草稿上下文；保存与执行归宿主。 | 4 / 4 / 3 / 3 | [docs/test-results/script-authoring/focused-final\.log](../docs/test-results/script-authoring/focused-final.log)、[docs/test-results/script-authoring/full-check\.log](../docs/test-results/script-authoring/full-check.log)、[docs/test-results/script-authoring/browser-verified/browser\.json](../docs/test-results/script-authoring/browser-verified/browser.json) |
| 交互与渲染 | **独立三语脚本创建与完整原文预览**；独立视图保存本地设置、展示全文、检查归属并交接普通草稿。 | 4 / 4 / 3 / 3 | [docs/test-results/script-authoring/focused-final\.log](../docs/test-results/script-authoring/focused-final.log)、[docs/test-results/script-authoring/full-check\.log](../docs/test-results/script-authoring/full-check.log)、[docs/test-results/script-authoring/browser-verified/browser\.json](../docs/test-results/script-authoring/browser-verified/browser.json) |
| 交互与渲染 | **编辑器同步草稿交接与独立模块装配**；最小同步宿主端口复用普通新文档保存与登记，独立模块不依赖构建或行为控制器。 | 4 / 4 / 3 / 3 | [docs/test-results/script-authoring/focused-final\.log](../docs/test-results/script-authoring/focused-final.log)、[docs/test-results/script-authoring/full-check\.log](../docs/test-results/script-authoring/full-check.log)、[docs/test-results/script-authoring/browser-verified/browser\.json](../docs/test-results/script-authoring/browser-verified/browser.json) |

平台：本机编辑服务与Chrome；中英日和390px布局、工作树功能；桌面／移动仅资源准备核对。边界：独立org.viento.scripts模块声明authoring.script；该专题初次接入19模块／36项声明能力，当前系统20／37，入口仍取决于当前工程、编辑宿主及未保存状态。；源码版提供两份Godot／GDScript起始内容；0.1.2后工作树另有Bevy Rust空ready、参数／信号及固定步移动起始内容，分别映射在behavior.bevy_rust与behavior.bevy_fixed_step。已有文档类型均可承载TXT，无需专用script类型。；纯JS规划只验证有界上下文、类型目录与正文目录内TXT路径，返回深冻结私有提案；没有文件IO、UUID、自动绑定、工具安装或执行。；独立三语弹窗保留本地选择与全文预览；取消、失效会话、原有未保存草稿或后台保存期间不能覆盖编辑器。；宿主同步交接为有未保存保护的普通源码草稿；普通保存独占正文及元数据登记，重名或保存失败仍保留草稿供修正。；保存后TXT可由首次创建或独立behavior.script_links引用；新增Rust起始内容不授予编译执行权，其后端成熟度见behavior.bevy_rust。语法高亮、LSP与Scene3D行为仍待接入。；本轮真实Linux浏览器与Godot流程；桌面／移动资源准备不等于安装包或Android实机验收。。

下一步：普通源码编辑增强分别见原文编辑相关切片；已有脚本引用和行为回源由behavior.script_links接通，语法高亮及标准LSP接口仍待推进。

<a id="authoring.source-indentation"></a>
### 通用原文多行缩进与原生撤销

`authoring.source-indentation` · 编辑与创作 · 源码交付

入口：普通源码／新脚本草稿→缩进单位与当前行／选区→增加或减少缩进→原生撤销／重做→普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **纯原文缩进、初始单位提示与UTF-16选区规划**；纯文本变换独立于语言、DOM和持久化；映射UTF-16选区及全文预算。 | 4 / 4 / 3 / 3 | [docs/test-results/source-editing/browser-1791856760717/report\.json](../docs/test-results/source-editing/browser-1791856760717/report.json)、[docs/test-results/source-editing/focused-final\.log](../docs/test-results/source-editing/focused-final.log)、[docs/test-results/source-editing/full-check\.log](../docs/test-results/source-editing/full-check.log) |
| 交互与渲染 | **原生文本事务、独立缩进工具条与三语视图**；独立DOM控制器只处理用户选择、原生事务及浏览器历史，不取得保存或后端接口。 | 4 / 4 / 3 / 3 | [docs/test-results/source-editing/browser-1791856760717/report\.json](../docs/test-results/source-editing/browser-1791856760717/report.json)、[docs/test-results/source-editing/focused-final\.log](../docs/test-results/source-editing/focused-final.log)、[docs/test-results/source-editing/full-check\.log](../docs/test-results/source-editing/full-check.log) |
| 交互与渲染 | **正文编辑来源及普通input草稿宿主**；原文宿主仅提供编辑状态／来源，input沿现有草稿和普通保存。 | 4 / 4 / 3 / 3 | [docs/test-results/source-editing/browser-1791856760717/report\.json](../docs/test-results/source-editing/browser-1791856760717/report.json)、[docs/test-results/source-editing/focused-final\.log](../docs/test-results/source-editing/focused-final.log)、[docs/test-results/source-editing/full-check\.log](../docs/test-results/source-editing/full-check.log) |

平台：Linux本机编辑服务与真实Chrome、桌面／移动仅准备资源，其他WebView原生撤销兼容性另验。边界：属于既有正文编辑模块；保持19模块、36项声明能力，不依赖脚本类型、Godot或行为绑定。；纯规则只接收规范LF文本、UTF-16选区、方向和显式单位，返回单一整行替换与新选区；输入及结果全文上限4Mi UTF-16。；可选Tab、2或4空格；新载入正文的首处非空行缩进仅提供初始提示，不是语言识别或自动格式化。首行BOM保持字节0，后续行不隐式清洗。；仅可写源码界面可用，Ctrl／Cmd方括号不占用普通Tab或Shift／Alt组合；IME、模态、保存／加载与readOnly均保护原文。；一次原生insertText事务沿浏览器历史撤销重做；无法编辑时不以.value或setRangeText覆盖回退。有原生input时不额外合成事件。；普通input继续脏状态、草稿恢复与普通保存；沿用现有换行序列化，改动区采用首个原换行，未改前后行保持字节。；Linux Chrome验证了真实输入、选区、撤销、三语390px与BOM／CRLF保存；资源准备不等于Tauri或Android安装验收，也不增加LSP、语法高亮或执行能力。。

下一步：继续独立接入源码行号／诊断呈现与标准文档／LSP端口；已有行为关系管理属于另一路径，不扩展文本工具权限。

<a id="authoring.source-position"></a>
### 通用原文行列位置与只读跳转

`authoring.source-position` · 编辑与创作 · 源码交付

入口：当前源码选区→逻辑行列与总行数→按行定位／取消→继续原生编辑与普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **纯LF／UTF-16有界行索引与位置查询**；只读LF／UTF-16索引，不持有正文写入或宿主接口。 | 4 / 4 / 3 / 3 | [docs/test-results/source-navigation/browser-1791861708197/report\.json](../docs/test-results/source-navigation/browser-1791861708197/report.json)、[docs/test-results/source-navigation/full-final\.log](../docs/test-results/source-navigation/full-final.log)、[docs/test-results/source-navigation/summary\.json](../docs/test-results/source-navigation/summary.json) |
| 交互与渲染 | **只读源码位置栏、跳转窗口与软换行测量**；独立行列栏和模态导航，只改选区与滚动。 | 4 / 4 / 3 / 3 | [docs/test-results/source-navigation/browser-1791861708197/report\.json](../docs/test-results/source-navigation/browser-1791861708197/report.json)、[docs/test-results/source-navigation/full-final\.log](../docs/test-results/source-navigation/full-final.log)、[docs/test-results/source-navigation/focused-handoff-final\.log](../docs/test-results/source-navigation/focused-handoff-final.log) |
| 交互与渲染 | **共同正文来源上下文与延迟脚本焦点保护**；正文来源及编辑门禁共享，延迟脚本焦点保留新位置。 | 4 / 4 / 3 / 3 | [docs/test-results/source-navigation/browser-1791861708197/report\.json](../docs/test-results/source-navigation/browser-1791861708197/report.json)、[docs/test-results/source-navigation/full-final\.log](../docs/test-results/source-navigation/full-final.log)、[docs/test-results/source-navigation/focused-handoff-final\.log](../docs/test-results/source-navigation/focused-handoff-final.log) |

平台：Linux本机编辑服务与真实Chrome、桌面／移动仅准备资源，其他WebView与设备另验。边界：属于既有正文模块，保持19模块／36项声明能力；不依赖语言、工程模板、行为绑定或执行后端。；纯索引接受最大4Mi UTF-16的规范LF文本，冻结查询接口；1基逻辑行和UTF-16列，初始BOM不计列，尾LF保留空行。；界面仅读取正文并改变选区／滚动，不写value、合成input、执行文本事务或调用保存；反向选区使用活动端。；跳转绑定来源标识和精确原文；关闭与焦点恢复后再核对归属，失效会话不能定位另一份文档。；保留原生软换行，用可丢弃的实际排版镜像测量目标；Ctrl／Cmd+G局限正文，IME、模态、加载／保存及只读状态受保护。；真实Chrome验证只读导航、原生撤销重做、三语390px与BOM／CRLF普通保存；修复脚本窗口延迟关闭回调覆盖新光标的竞态。；资源准备不等于安装或设备验收；侧边逐行行号、诊断呈现、LSP和其他WebView兼容性另行推进。。

下一步：继续以独立视图接入诊断呈现和标准LSP端口；侧边行号需单独适配软换行布局。

<a id="authoring.source-diagnostic"></a>
### 源码旁的单条诊断上下文与安全定位

`authoring.source-diagnostic` · 编辑与创作 · 源码交付

入口：构建诊断→核对来源与精确范围→源码旁保留诊断→修改后待复验→普通保存与显式重新检查

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **冻结诊断展示快照与有界标量契约**；有界展示数据，无宿主、构建与执行依赖。 | 4 / 4 / 3 / 3 | [docs/test-results/source-diagnostics/browser-1791864433041/report\.json](../docs/test-results/source-diagnostics/browser-1791864433041/report.json)、[docs/test-results/source-diagnostics/full-verified\.log](../docs/test-results/source-diagnostics/full-verified.log)、[docs/test-results/source-diagnostics/summary\.json](../docs/test-results/source-diagnostics/summary.json) |
| 交互与渲染 | **独立只读诊断面板、失效状态与三语窄屏布局**；只读当前上下文，不获取保存或重新检查接口。 | 4 / 4 / 3 / 3 | [docs/test-results/source-diagnostics/browser-1791864433041/report\.json](../docs/test-results/source-diagnostics/browser-1791864433041/report.json)、[docs/test-results/source-diagnostics/full-verified\.log](../docs/test-results/source-diagnostics/full-verified.log)、[docs/test-results/source-diagnostics/focused-final\.log](../docs/test-results/source-diagnostics/focused-final.log) |
| 交互与渲染 | **全文折行测量与共享源码显露适配器**；独立DOM全文测量，供多个导航入口复用。 | 4 / 4 / 3 / 3 | [docs/test-results/source-diagnostics/browser-1791864433041/report\.json](../docs/test-results/source-diagnostics/browser-1791864433041/report.json)、[docs/test-results/source-diagnostics/position-regression-final/report\.json](../docs/test-results/source-diagnostics/position-regression-final/report.json)、[docs/test-results/source-diagnostics/full-verified\.log](../docs/test-results/source-diagnostics/full-verified.log) |
| 交互与渲染 | **构建诊断映射、原文核对与焦点交接守护**；来源核对、标量映射和焦点恢复权限属于宿主。 | 4 / 4 / 3 / 3 | [docs/test-results/source-diagnostics/browser-1791864433041/report\.json](../docs/test-results/source-diagnostics/browser-1791864433041/report.json)、[docs/test-results/source-diagnostics/full-verified\.log](../docs/test-results/source-diagnostics/full-verified.log)、[docs/test-results/source-diagnostics/focused-final\.log](../docs/test-results/source-diagnostics/focused-final.log) |

平台：Linux本机编辑服务与真实Chrome、桌面／移动仅准备资源；Android构建入口及设备另验。边界：属于现有正文模块，保持19模块／36项声明能力；独立诊断快照不接收构建任务、后端对象或执行权限。；冻结且有界的标量快照描述代码、级别、消息、来源和定位状态；仅exact含规范LF／UTF-16范围。版本及字符边界由宿主和视图各自核对。；面板只展示和清理，不能保存、重新构建或编辑正文；首次输入后持续标记待复验，撤销相同原文也不认定错误解决。；明确区分精确、旧版本、近似及无范围；文档切换清除旧上下文，失败读取、未保存草稿和过期导航不能错误绑定。；独立DOM显露适配器为行号／来源跳转测量完整排版，保留软换行；来源激活延迟焦点，并在focus后重新核对归属和新弹窗。；后续用户点击、按键或指针操作取消旧延迟焦点的选区恢复；普通原生撤销、草稿、保存及冲突规则继续由正文宿主维护。；Linux Chrome实测静态构建错误到源码、三语390px、只读上下文、原生历史及BOM／CRLF保存；准备资源不代表安装、设备或新语言执行验收。。

下一步：工程问题总表、持续诊断和标准LSP文档端口分别推进；不会由这一展示组件隐式执行。

<a id="authoring.source-search"></a>
### 通用原文查找替换与单次原生撤销

`authoring.source-search` · 编辑与创作 · 源码交付

入口：当前源码→字面查找与匹配导航→当前或全部替换→原生撤销／重做→普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **字面匹配与有界单一替换规划**；无DOM和文件接口的纯文本规则，输出不可变匹配与编辑计划。 | 4 / 4 / 3 / 3 | [docs/test-results/source-search/browser-1791869406177/report\.json](../docs/test-results/source-search/browser-1791869406177/report.json)、[docs/test-results/source-search/full-final\.log](../docs/test-results/source-search/full-final.log)、[docs/test-results/source-search/resources\.json](../docs/test-results/source-search/resources.json) |
| 交互与渲染 | **独立查找替换视图、原生事务与三语布局**；只操作当前源码选区及受守护的原生文本事务；不接保存或执行端口。 | 4 / 4 / 3 / 3 | [docs/test-results/source-search/browser-1791869406177/report\.json](../docs/test-results/source-search/browser-1791869406177/report.json)、[docs/test-results/source-search/full-final\.log](../docs/test-results/source-search/full-final.log)、[docs/test-results/source-search/resources\.json](../docs/test-results/source-search/resources.json) |
| 交互与渲染 | **普通源码宿主接线与媒体输入归属**；原有草稿与普通保存负责持久化，媒体适配器核对真实文本输入归属。 | 4 / 4 / 3 / 3 | [docs/test-results/source-search/browser-1791869406177/report\.json](../docs/test-results/source-search/browser-1791869406177/report.json)、[docs/test-results/source-search/full-final\.log](../docs/test-results/source-search/full-final.log)、[docs/test-results/source-search/resources\.json](../docs/test-results/source-search/resources.json) |

平台：Linux本机编辑服务与真实Chrome、桌面／移动仅准备资源，其他WebView原生编辑兼容性另验。边界：属于既有正文编辑模块，保持19模块／36项声明能力；不依赖语言、工程模板、行为关系或执行后端。；纯规划接受规范LF原文和UTF-16选区；字面非重叠匹配，默认区分大小写，忽略大小写使用Unicode简单折叠而不改变来源偏移。；替换当前要求精确选中匹配；全部替换返回最小包围范围，一次原生insertText形成可一次撤销的编辑；替换值不解释$&、$1或反斜杠。；原文与最终结果最多4Mi UTF-16，查询4096、替换输入65536、匹配10000；超限完整拒绝，选区不切开有效代理对。；来源令牌、原文、输入选项、焦点及选区在原生编辑前核对；IME、模态、忙碌与切换来源期间保护正文。媒体导入只接收宿主确认归属的输入框，不借辅助查找字段回退修改源码。；普通input继续负责草稿、脏状态及诊断待复验；普通保存继续保留BOM／原换行风格和外部冲突。切换或重新加载正文清除旧查找上下文。；Linux真实Chrome验证导航、原生历史、三语390px、素材事件隔离与目标唯一的BOM／CRLF保存；资源准备不代表安装或设备验收。正则、全工程替换及LSP另行推进。。

下一步：继续独立接入工程问题总表与标准文档／LSP端口；跨文档搜索和编辑必须另行定义来源、事务与撤销。

<a id="build.task-problems"></a>
### 当前构建任务的问题筛选与来源导航

`build.task-problems` · 构建与运行 · 源码交付

入口：当前任务诊断→严重度／文字筛选→展开定位详情→核对原文版本→编辑保存与显式重验

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **有界单任务问题快照与字面筛选**；纯数据验证和不可变筛选不取得DOM、文件或执行接口。 | 4 / 4 / 3 / 3 | [docs/test-results/project-problems/browser-1791870888844/report\.json](../docs/test-results/project-problems/browser-1791870888844/report.json)、[docs/test-results/project-problems/full-final\.log](../docs/test-results/project-problems/full-final.log)、[docs/test-results/project-problems/resources\.json](../docs/test-results/project-problems/resources.json) |
| 交互与渲染 | **独立问题列表、三语筛选与稳定行节点**；视图维护筛选、展开状态和导航归属，不传递构建任务对象。 | 4 / 4 / 3 / 3 | [docs/test-results/project-problems/browser-1791870888844/report\.json](../docs/test-results/project-problems/browser-1791870888844/report.json)、[docs/test-results/project-problems/full-final\.log](../docs/test-results/project-problems/full-final.log)、[docs/test-results/project-problems/resources\.json](../docs/test-results/project-problems/resources.json) |
| 交互与渲染 | **任务观察映射与异步来源归属核对**；宿主把现有诊断映射为独立快照，读取／摘要后重验结果归属，再交接现有来源与焦点逻辑。 | 4 / 4 / 3 / 3 | [docs/test-results/project-problems/browser-1791870888844/report\.json](../docs/test-results/project-problems/browser-1791870888844/report.json)、[docs/test-results/project-problems/full-final\.log](../docs/test-results/project-problems/full-final.log)、[docs/test-results/project-problems/resources\.json](../docs/test-results/project-problems/resources.json) |

平台：Linux本机服务与真实Chrome、桌面／移动仅准备资源，移动构建入口及设备另验。边界：只消费当前任务最多256条诊断，保留原序和重复项，不汇总工程、历史或持续检查。任务场景独立于场景选择器。；纯规则严格捕获任务标量与来源信息，按严重度、文件、字段、代码、原消息及当前翻译进行字面筛选；原始详情为最多8192码元摘录。；独立视图只取得快照、可用状态、来源令牌与受守护导航接口；筛选／详情／语言变化不读取文件、保存或执行引擎。；同一任务等价轮询保留查询、输入选区和详情节点；新任务／后端／窗口会话清理旧状态。结果变化或当前条目不可用时撤销旧导航。；主编辑宿主在原文读取和摘要计算之后核对任务归属，再沿既有源码修订、精确范围与草稿保护规则定位；关闭窗口后的焦点由正文身份接管。；无来源问题仍显示；无任务、无诊断、筛选无匹配及畸形快照分别说明，不伪造定位。修改／撤销不会认定问题解决，须显式重新检查。；真实Chrome只执行静态计划诊断与来源编辑链路；不提升现有后端执行、LSP或安装设备成熟度。。

下一步：继续独立设计跨任务问题归档、工程诊断汇总与标准文档／LSP端口，不由只读列表隐式运行检查。

<a id="scene.composition_materialize"></a>
### 保存态配方生成独立运行场景

`scene.composition_materialize` · 场景与交互 · 源码交付

入口：已保存配方→完整依赖预览→独立场景审阅与创建→行为→构建运行→工程交付

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **保存配方的独立场景规划与修订核对**；保存配方的独立场景规划与修订核对，不取得其他作者区或执行后端的职责。 | 4 / 4 / 3 / 3 | [docs/test-results/two-dimensional-workflow/summary\.json](../docs/test-results/two-dimensional-workflow/summary.json)、[docs/test-results/two-dimensional-workflow/full\.log](../docs/test-results/two-dimensional-workflow/full.log)、[docs/test-results/two-dimensional-workflow/resources\.json](../docs/test-results/two-dimensional-workflow/resources.json) |
| 交互与渲染 | **独立场景生成审阅与保存结果核对**；独立场景生成审阅与保存结果核对，不取得其他作者区或执行后端的职责。 | 4 / 4 / 3 / 3 | [docs/test-results/two-dimensional-workflow/summary\.json](../docs/test-results/two-dimensional-workflow/summary.json)、[docs/test-results/two-dimensional-workflow/full\.log](../docs/test-results/two-dimensional-workflow/full.log)、[docs/test-results/two-dimensional-workflow/resources\.json](../docs/test-results/two-dimensional-workflow/resources.json) |
| 交互与渲染 | **配方入口与新场景构建目录交接**；配方入口与新场景构建目录交接，不取得其他作者区或执行后端的职责。 | 4 / 4 / 3 / 3 | [docs/test-results/two-dimensional-workflow/summary\.json](../docs/test-results/two-dimensional-workflow/summary.json)、[docs/test-results/two-dimensional-workflow/full\.log](../docs/test-results/two-dimensional-workflow/full.log)、[docs/test-results/two-dimensional-workflow/resources\.json](../docs/test-results/two-dimensional-workflow/resources.json) |
| 可移植 JS 语义 | **world-scene-create\.mjs / world-scene-update\.mjs 等**；展开后的独立Scene2D复用scene\.create校验、角色／图片依赖派生和正文／登记创建规划；不依赖旧v1界面。 | 4 / 4 / 3 / 3 | [docs/test-results/two-dimensional-workflow/summary\.json](../docs/test-results/two-dimensional-workflow/summary.json)、[docs/test-results/native-installed-0\.1\.1/summary\.json](../docs/test-results/native-installed-0.1.1/summary.json)、[docs/test-results/release-0\.1\.2/preflight\.json](../docs/test-results/release-0.1.2/preflight.json) |

平台：Linux本机服务、真实Chrome与Godot、桌面／移动仅准备资源；安装及设备另验。边界：输入仅限已登记保存态配方；读取前后核对World修订，完整配方预览包含未使用片段的依赖。；共享Rust展开保留实例／分组身份和投影继承声明；可移植规划不从渲染模型反推作者JSON，不读取文件或执行引擎。；新文档UUID、类型和路径经明确审阅；现有scene.create事务仅创建正文与依赖登记，原配方、定义和素材不改写。；生成场景独立维护，无自动同步、覆盖已有场景或反向回写；修改目的地撤销旧审阅，保存不明先只读核对。；构建父窗口只交接归属与新场景选择，旧计划失效；行为、快照、后端运行与工程交付继续沿独立接口。；浏览器实测从已准备的注册配方到新场景、脚本、行为、真实Godot逻辑执行和工程ZIP异地导入；不宣称上游创建全程UI、图形游戏验收或独立游戏安装包。。

下一步：丰富配方初始结构并扩展连续创作到交付验收；配方直接构建、自动同步和独立游戏发行分别设计。

<a id="scene.composition_create"></a>
### 直接新建配方的内置助手

`scene.composition_create` · 场景与构建 · 源码交付

入口：主编辑器 → 新建场景配方 → 多演员／可选起始排布 → 完整JSON审阅 → 普通草稿与保存 → 场景预览／生成

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **新配方草稿与起始排布的可移植规划**；准备普通JSON草稿并核对目录／来源；不取得文件、渲染或运行权限。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-composition-create/summary\.json](../docs/test-results/scene-composition-create/summary.json)、[docs/test-results/scene-composition-create/browser-acceptance\.json](../docs/test-results/scene-composition-create/browser-acceptance.json)、[docs/test-results/scene-composition-multi-create/summary\.json](../docs/test-results/scene-composition-multi-create/summary.json) |
| 本机服务与适配 | **新配方只读对象目录与HTTP适配**；读取已有保存态对象目录并提供无缓存只读HTTP响应。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-composition-create/summary\.json](../docs/test-results/scene-composition-create/summary.json)、[docs/test-results/scene-composition-create/browser-acceptance\.json](../docs/test-results/scene-composition-create/browser-acceptance.json)、[docs/test-results/scene-composition-multi-create/summary\.json](../docs/test-results/scene-composition-multi-create/summary.json) |
| 交互与渲染 | **新配方独立表单、审阅与模块装配**；独立表单和审阅，有限宿主端口；模块仅依赖文档能力。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-composition-create/summary\.json](../docs/test-results/scene-composition-create/summary.json)、[docs/test-results/scene-composition-create/browser-acceptance\.json](../docs/test-results/scene-composition-create/browser-acceptance.json)、[docs/test-results/scene-composition-multi-create/summary\.json](../docs/test-results/scene-composition-multi-create/summary.json) |
| 交互与渲染 | **app-runtime\.js / app-editor-draft\.js / app-source-history\.js**；通过配方专属提案校验后复用普通创建草稿及保存。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-composition-create/summary\.json](../docs/test-results/scene-composition-create/summary.json)、[docs/test-results/scene-composition-create/browser-acceptance\.json](../docs/test-results/scene-composition-create/browser-acceptance.json)、[docs/test-results/scene-composition-multi-create/summary\.json](../docs/test-results/scene-composition-multi-create/summary.json) |
| 共享 Rust 核心 | **scene\_composition\.rs：无状态文件内片段组合**；复用已有无状态Rust配方展开验证；本轮不改变Rust算法或格式。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-composition-create/summary\.json](../docs/test-results/scene-composition-create/summary.json)、[docs/test-results/scene-composition-create/browser-acceptance\.json](../docs/test-results/scene-composition-create/browser-acceptance.json)、[docs/test-results/scene-composition-multi-create/summary\.json](../docs/test-results/scene-composition-multi-create/summary.json) |

平台：本机HTTP编辑服务、真实Chrome与Godot无头验证、桌面／移动准备资源；新助手尚未安装，Android不开放创作入口。边界：只读目录列出已登记有效对象和兼容二维游戏投影；配方本身及无效投影不作为起始演员。；起始一个片段、一次放置及1–64演员；每项独立对象／投影、继承、局部键与位置，同对象可重复引用。增删不重新分配存留实例UUID，未完成输入可切换保留。；起始排布为横排／竖排／网格的独立纯坐标规划；显式预览全部旧新位置后应用，一次撤销恢复原数字输入。手动修改或增删使旧提案／回退失效，越界整体拒绝。间距按中心计算，不读取外观或碰撞。；投影继承保留useProjectionDefaults，不复制当前解析值；普通对象使用明确起始值。共享Rust展开验证配方规则，不新增后端格式。；可移植规划、只读Node目录、独立三语界面和普通文档宿主分离；取消无写，应用前重读目录并复核来源归属。；审阅结果进入普通未保存JSON草稿，保存与登记沿现有接口；外部路径占用拒绝覆盖并保留草稿。；真实Chrome从空工程GUI创建OC／投影／三演员配方，生成独立Scene2D并由Godot无头运行；两个同源投影实例各移动45px、普通对象40px，仍是共享方向键输入。本轮不含新增安装、行为脚本、ZIP交付或图形游戏验收。。

下一步：更丰富的起始片段组合、按需局部排布，以及完整上游创作到工程交付的同轮连续验收。

<a id="behavior.bevy_rust"></a>
### Bevy 作者 Rust 行为接入

`behavior.bevy_rust` · 运行后端与演进 · 源码交付

入口：已登记无图Scene2D与Rust TXT→显式Bevy/Rust行为清单→固定Cargo工具链→冻结源工程／离线编译→ready参数与信号→中立事件→源码交付

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 执行后端 | **Bevy Rust 独立适配器：固定工具链、离线编译、诊断与临时回收**；独立Rust适配器固定工具与能力，执行锁定离线编译、诊断和临时回收；旧Bevy数据工具不取得作者编译权。 | 3 / 3 / 3 / 2 | [docs/test-results/bevy-rust-behaviors/README\.md](../docs/test-results/bevy-rust-behaviors/README.md)、[docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser\.json](../docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser.json)、[docs/test-results/bevy-rust-behaviors/app-check\.log](../docs/test-results/bevy-rust-behaviors/app-check.log) |
| 执行后端 | **Bevy Rust Cargo 源工程生成器与稳定来源映射**；无图行为plan3生成锁定Cargo源工程、按UUID原字节源码与来源映射。 | 4 / 3 / 3 / 2 | [docs/test-results/bevy-rust-behaviors/generator-tests\.log](../docs/test-results/bevy-rust-behaviors/generator-tests.log)、[docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser\.json](../docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser.json)、[docs/test-results/bevy-rust-behaviors/app-check\.log](../docs/test-results/bevy-rust-behaviors/app-check.log) |
| 执行后端 | **Bevy Rust 就绪／固定步行为模板、类型化上下文与 ECS 运行**；独立Rust模板用每绑定就绪回调与类型化上下文发出既有事件，不承担GUI或作者保存。 | 3 / 3 / 3 / 2 | [docs/test-results/bevy-rust-behaviors/runtime-template-tests\.log](../docs/test-results/bevy-rust-behaviors/runtime-template-tests.log)、[docs/test-results/bevy-rust-behaviors/generator-tests\.log](../docs/test-results/bevy-rust-behaviors/generator-tests.log)、[docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser\.json](../docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser.json) |
| 可移植 JS 语义 | **中立行为 plan／runtime3 事件与来源准入**；中立行为事件准入核对冻结绑定与来源，拒身份、事件、数值或生命周期伪造。 | 4 / 3 / 3 / 2 | [docs/test-results/bevy-rust-behaviors/neutral-events\.log](../docs/test-results/bevy-rust-behaviors/neutral-events.log)、[docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser\.json](../docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser.json)、[docs/test-results/bevy-rust-behaviors/app-check\.log](../docs/test-results/bevy-rust-behaviors/app-check.log) |
| 本机服务与适配 | **node-execution-backends\.mjs / node-project-build\.mjs：可信注册、输出与冻结编排**；通用宿主按可信registry调用新适配器，保留冻结、产物和进程生命周期，不内嵌Cargo文件约定。 | 3 / 3 / 3 / 2 | [docs/test-results/bevy-rust-behaviors/README\.md](../docs/test-results/bevy-rust-behaviors/README.md)、[docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser\.json](../docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser.json)、[docs/test-results/bevy-rust-behaviors/app-check\.log](../docs/test-results/bevy-rust-behaviors/app-check.log) |
| 本机服务与适配 | **node-execution-tool\.mjs / project-build\.mjs：可信host和CLI后端选择**；本机host／CLI明确选择独立Rust后端及具体Cargo配置；不新增HTTP工具路径。 | 3 / 3 / 3 / 2 | [docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser\.json](../docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser.json)、[docs/test-results/bevy-rust-behaviors/app-check\.log](../docs/test-results/bevy-rust-behaviors/app-check.log)、[docs/test-results/release-0\.1\.3/preflight\.json](../docs/test-results/release-0.1.3/preflight.json) |
| 可移植 JS 语义 | **已知脚本起始内容与纯草稿提案**；Rust空ready与参数／信号起始内容复用普通TXT品牌草稿；不安装工具、关联或执行。 | 4 / 3 / 3 / 2 | [docs/test-results/bevy-rust-behaviors/ui\.log](../docs/test-results/bevy-rust-behaviors/ui.log)、[docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser\.json](../docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser.json)、[docs/test-results/bevy-rust-behaviors/app-check\.log](../docs/test-results/bevy-rust-behaviors/app-check.log) |
| 交互与渲染 | **独立三语脚本创建与完整原文预览**；新脚本窗口预览明确Rust全文并交接普通草稿；保存仍归文档宿主。 | 4 / 3 / 3 / 2 | [docs/test-results/bevy-rust-behaviors/ui\.log](../docs/test-results/bevy-rust-behaviors/ui.log)、[docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser\.json](../docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser.json)、[docs/test-results/bevy-rust-behaviors/app-check\.log](../docs/test-results/bevy-rust-behaviors/app-check.log) |
| 交互与渲染 | **三语首次创建控制器、构建入口与原文导航宿主**；首次行为显式backend/language profile进入审阅签名；切换保留多绑定身份且拒晚响应。 | 4 / 3 / 3 / 2 | [docs/test-results/bevy-rust-behaviors/ui\.log](../docs/test-results/bevy-rust-behaviors/ui.log)、[docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser\.json](../docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser.json)、[docs/test-results/bevy-rust-behaviors/app-check\.log](../docs/test-results/bevy-rust-behaviors/app-check.log) |
| 交互与渲染 | **三语后端工程详情与历史选择**；三语后端详情区分Cargo源工程与旧数据工程，显示需要工具链及不含缓存／二进制。 | 4 / 3 / 3 / 2 | [docs/test-results/bevy-rust-behaviors/ui\.log](../docs/test-results/bevy-rust-behaviors/ui.log)、[docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser\.json](../docs/test-results/bevy-rust-behaviors/browser-1791891439479/browser.json)、[docs/test-results/bevy-rust-behaviors/app-check\.log](../docs/test-results/bevy-rust-behaviors/app-check.log) |

平台：Linux本机CLI／编辑服务；Cargo与rustc1.95.0、Bevy0.19.1预缓存依赖、0.1.3源码交付；新安装包、Android执行、Windows/macOS设备未验收。边界：独立org.viento.bevy-rust适配器与模板当前0.2.0（首轮ready证据保留0.1.0条件）只接Scene2D行为plan／runtime3及无图build／headlessLogic；旧org.viento.bevy0.3.0数据通道、plan1／2及有限输入回放保持独立，不隐式升级或混用。；复用行为schema1、32bindings／8sources及标量参数／信号预算；TXT原字节按UUID复制为Rust模块，每份绑定一次ready，类型化string／number／boolean读取与emit映射既有protocol3事件。；明确选择Godot／GDScript或Bevy／Rust创建声明；切换撤销旧审阅但保留全部文档和绑定身份，不转换源码或切换宿主。空行为、参数／信号和固定步移动三个Rust起始内容仍只创建普通TXT草稿。已有引用管理、独立绑定编辑与普通保存各守原边界。；可信宿主通过VIENTO_EXECUTION_BACKEND与VIENTO_BEVY_RUST_CARGO固定通道及具体Cargo路径，拒rustup代理；Cargo／rustc1.95.0身份共同冻结，不允许作者文档或HTTP指定工具。；生成完整Cargo源码和锁文件；编译与运行使用--locked --offline，只复用预缓存registry，缺失依赖不联网安装。每次运行从冻结源码进入临时target，成功／失败／取消／超时回收派生缓存；工具、生成文件和适配器仍须重新核验。；新中立行为事件reader核对绑定／实例／定义、映射名、标量、预算、ready／finished与冻结诊断来源；GUI不解析执行Rust，编译定位沿现有来源和修订守护回到TXT。；bevy-rust-project源工程清单公开Cargo.toml入口、作者源码副本、工具和库存；ZIP不含target、编译缓存、二进制或作者快照，接收方需匹配工具链和锁定依赖，不是独立游戏发行。；没有图片、窗口、截图、GPU、有限输入回放、连续游戏循环、热更新、LSP或3D行为；Rust按本机用户权限执行，不是沙箱。系统保持20模块／37项声明能力、原作者格式和运行协议；本轮未安装。；0.2.0新增的显式固定步、自身位置与单次提交另列behavior.bevy_fixed_step；本功能旧ready评分及证据不自动扩展到新生命周期。适配器身份变化后旧生成工程需重建，旧ready源码继续兼容。。

下一步：ready参数／信号、冻结编译与源码交付保持；有限固定步自身位置另见behavior.bevy_fixed_step。控制回放、连续运行、资源与更丰富诊断、已有声明迁移、热更新、图形及目标平台仍需分别实现和验收。

<a id="behavior.multi_creation"></a>
### 首次行为清单的多实例与多脚本创建

`behavior.multi_creation` · 场景与构建 · 源码交付

入口：构建与运行→添加场景行为→增删绑定并选择实例／脚本→完整审阅→一次保存→独立参数／信号编辑→Godot→工程交付

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **中立首次行为清单的纯声明规划**；从受限数据清单生成完整行为声明和排序去重脚本ID；不分配身份或执行副作用。 | 4 / 4 / 3 / 2 | [docs/test-results/scene-behavior-multi-create/summary\.json](../docs/test-results/scene-behavior-multi-create/summary.json)、[docs/test-results/release-0\.1\.3/preflight\.json](../docs/test-results/release-0.1.3/preflight.json)、[scripts/tests/scene-behavior-create-plan\.test\.mjs](../scripts/tests/scene-behavior-create-plan.test.mjs) |
| 可移植 JS 语义 | **中立首次行为创建、三文件规划及冻结依赖校验**；复用既有中立behavior\.create语义、完整依赖与原有三目标创建规划；多绑定不新增写协议。 | 3 / 4 / 3 / 2 | [docs/test-results/scene-behavior-multi-create/summary\.json](../docs/test-results/scene-behavior-multi-create/summary.json)、[docs/test-results/release-0\.1\.3/preflight\.json](../docs/test-results/release-0.1.3/preflight.json)、[scripts/tests/world-behavior-create-pure\.test\.mjs](../scripts/tests/world-behavior-create-pure.test.mjs) |
| 本机服务与适配 | **World命令适配、混合创建事务与v9恢复**；复用现有受锁和修订守护的可恢复三文件事务；第二脚本变化及路径占用完整拒绝。 | 3 / 4 / 3 / 2 | [docs/test-results/scene-behavior-multi-create/summary\.json](../docs/test-results/scene-behavior-multi-create/summary.json)、[docs/test-results/release-0\.1\.3/preflight\.json](../docs/test-results/release-0.1.3/preflight.json)、[scripts/tests/world-behavior-create-service\.test\.mjs](../scripts/tests/world-behavior-create-service.test.mjs) |
| 交互与渲染 | **三语首次创建控制器、构建入口与原文导航宿主**；多绑定视图保留独立身份、选择与完整审阅，额外脚本回执严格核对；后续参数编辑沿原独立模块。 | 4 / 4 / 3 / 2 | [docs/test-results/scene-behavior-multi-create/summary\.json](../docs/test-results/scene-behavior-multi-create/summary.json)、[docs/test-results/release-0\.1\.3/preflight\.json](../docs/test-results/release-0.1.3/preflight.json)、[scripts/tests/scene-behavior-create-ui\.test\.mjs](../scripts/tests/scene-behavior-create-ui.test.mjs) |

平台：Linux本机编辑服务、真实Chrome、Godot无头及工程ZIP异地导入、桌面／移动准备资源；本轮未更新安装或验收Android设备。边界：扩展既有首次创建入口，保持20模块／37项声明能力；只接受尚无behavior关联的已保存Scene2D v2／v3。；清单1–32绑定、最多8份去重TXT脚本；每条保持独立bindingId，允许同实例多个行为和复用同脚本，新增优先未分配实例。；选择其他绑定只切视图，增删或修改撤销旧审阅；移除至少保留一条，现存身份不重分配。；独立纯规划接受已分配身份与中立后端声明，不读取文件、DOM或工具；既有行为格式检查仍为准入依据，界面当前仅声明Godot/GDScript。；完整JSON与全部去重依赖显式审阅后，现有behavior.create一次创建正文／登记并追加场景关系；脚本变化或路径占用完整拒绝，不扩展事务协议。；初始参数／信号为空，保存后沿已有独立行为编辑、草稿应用和普通保存配置。创建不会执行脚本或修改原场景正文、已有脚本。；真实Chrome从两个现有实例出发，内置新建第二份脚本并创建3绑定；独立配置三个事件后Godot运行和工程ZIP异地导入通过。不是空工程到交付的同轮全流程或独立游戏发行。；已有绑定清单新增脚本依赖仍需显式登记关系；本清单不自动覆盖既有声明或提供LSP。新增Bevy／Rust profile与执行能力另映射behavior.bevy_rust，旧Godot清单证据保持其范围。。

下一步：已有声明新增脚本与编辑交接由behavior.script_links独立切片接通；后续继续验收更多创作到交付路线，解绑与迁移另行设计。

<a id="behavior.script_links"></a>
### 已有行为的脚本引用与独立编辑交接

`behavior.script_links` · 场景与构建 · 源码交付

入口：构建与运行→管理已有行为→审阅并保存脚本引用→打开行为原文→独立绑定编辑→普通保存→Godot与工程交付

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **行为目录快照与脚本引用纯契约**；严格捕获独立目录并构造既有relation\.add；检查完整回执，拒绝额外副作用。 | 4 / 4 / 3 / 2 | [docs/test-results/scene-behavior-links/summary\.json](../docs/test-results/scene-behavior-links/summary.json)、[docs/test-results/release-0\.1\.3/preflight\.json](../docs/test-results/release-0.1.3/preflight.json)、[scripts/tests/scene-behavior-directory\.test\.mjs](../scripts/tests/scene-behavior-directory.test.mjs) |
| 本机服务与适配 | **保存态单快照行为目录与作者HTTP服务**；一次World读取和静态依赖核对；作者HTTP鉴权与浏览拒绝，无写入和引擎执行。 | 4 / 4 / 3 / 2 | [docs/test-results/scene-behavior-links/summary\.json](../docs/test-results/scene-behavior-links/summary.json)、[docs/test-results/release-0\.1\.3/preflight\.json](../docs/test-results/release-0.1.3/preflight.json)、[scripts/tests/scene-behavior-directory-service\.test\.mjs](../scripts/tests/scene-behavior-directory-service.test.mjs) |
| 交互与渲染 | **独立行为关联界面与源编辑宿主交接**；关联、索引刷新与来源导航端口分离；独立行为编辑继续只取得草稿权限。 | 4 / 4 / 3 / 2 | [docs/test-results/scene-behavior-links/summary\.json](../docs/test-results/scene-behavior-links/summary.json)、[docs/test-results/release-0\.1\.3/preflight\.json](../docs/test-results/release-0.1.3/preflight.json)、[scripts/tests/scene-behavior-links-ui\.test\.mjs](../scripts/tests/scene-behavior-links-ui.test.mjs) |
| 可移植 JS 语义 | **world-relations\.mjs / world-record-edit\.mjs**；复用现有元数据关系规划，不新增行为正文写入或关系协议。 | 3 / 4 / 3 / 2 | [docs/test-results/scene-behavior-links/summary\.json](../docs/test-results/scene-behavior-links/summary.json)、[docs/test-results/release-0\.1\.3/preflight\.json](../docs/test-results/release-0.1.3/preflight.json)、[scripts/tests/scene-behavior-directory\.test\.mjs](../scripts/tests/scene-behavior-directory.test.mjs) |
| 存储与事务 | **node-world-commands\.mjs**；复用已有修订守护与可恢复relation\.add事务；只修改明确登记文件。 | 3 / 4 / 3 / 2 | [docs/test-results/scene-behavior-links/summary\.json](../docs/test-results/scene-behavior-links/summary.json)、[docs/test-results/release-0\.1\.3/preflight\.json](../docs/test-results/release-0.1.3/preflight.json)、[scripts/tests/scene-behavior-directory-service\.test\.mjs](../scripts/tests/scene-behavior-directory-service.test.mjs) |
| 桌面宿主 | **desktop\_host\.rs / close\_state\.rs**；已有退出状态机识别新窗口dirty/busy，不添加原生业务写入。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-behavior-links/summary\.json](../docs/test-results/scene-behavior-links/summary.json)、[docs/test-results/release-0\.1\.3/preflight\.json](../docs/test-results/release-0.1.3/preflight.json)、[scripts/tests/desktop-close\.test\.mjs](../scripts/tests/desktop-close.test.mjs) |

平台：Linux本机编辑服务、真实Chrome、Godot无头和工程ZIP异地导入、桌面关闭保护测试与桌面／移动准备资源；未更新安装或验收Android设备。边界：单次保存态World快照确认Scene2D v2／v3与唯一行为声明；无关联时明确为空，缺失、歧义、错误声明或依赖拒绝。；目录最多256个已登记且适合引用的UTF-8 TXT候选，每份64KiB；绑定保持1–32条与实际使用最多8份脚本。未使用候选不占8份预算。；纯契约只捕获目录、生成固定references/空slot的relation.add，并核对完整preview或真实committed回执；无IO和新写入协议。；关联窗口只更新行为登记，取消不写入，不修改行为、场景或脚本正文。未知提交保持防重，只有只读核对相同声明已具备目标引用才收敛。；打开原文前重新读取并守护场景／会话／源版本；宿主刷新、原文导航与行为编辑不共享写入权。普通保存才持久化编辑后的绑定、参数和信号。；本关联专题已用中英日窄屏及已有双绑定场景新建第二脚本、增加第三绑定，Godot事件与工程ZIP异地导入单独验收；其证据不覆盖空工程全程、图形游戏、LSP或Rust运行。当前独立Rust通道见behavior.bevy_rust，不修改本专题原评分。。

下一步：继续打通后续玩法编辑与验证；解绑和跨场景迁移仍需各自契约。Rust作者执行由独立behavior.bevy_rust接入，已有引用管理继续保持中立登记边界。

<a id="behavior.bevy_fixed_step"></a>
### Bevy Rust 固定步自身实例位置与事件驱动

`behavior.bevy_fixed_step` · 运行后端与演进 · 源码交付

入口：固定步Rust TXT→已有脚本引用／独立绑定参数信号→冻结Cargo源工程→ready注册→固定两步自身位置与映射事件→源工程交付

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 执行后端 | **Bevy Rust 就绪／固定步行为模板、类型化上下文与 ECS 运行**；具体Rust运行实现负责ready注册、两步调度、位置／事件单次提交、manifest顺序和全程事件预算。 | 3 / 3 / 3 / 2 | [docs/test-results/bevy-rust-fixed-step/native-workflow-summary\.json](../docs/test-results/bevy-rust-fixed-step/native-workflow-summary.json)、[docs/test-results/bevy-rust-fixed-step/rust-test\.log](../docs/test-results/bevy-rust-fixed-step/rust-test.log)、[docs/test-results/bevy-rust-fixed-step/rust-clippy\.log](../docs/test-results/bevy-rust-fixed-step/rust-clippy.log) |
| 执行后端 | **Bevy Rust Cargo 源工程生成器与稳定来源映射**；原生成器带入0\.2\.0固定步模板，作者TXT仍原字节按UUID复制并保留可信来源，不把运行缓存加入源码库存。 | 3 / 3 / 3 / 2 | [docs/test-results/bevy-rust-fixed-step/native-workflow-summary\.json](../docs/test-results/bevy-rust-fixed-step/native-workflow-summary.json)、[docs/test-results/bevy-rust-fixed-step/legacy-generator\.log](../docs/test-results/bevy-rust-fixed-step/legacy-generator.log)、[docs/test-results/bevy-rust-fixed-step/browser-1791892801455/browser\.json](../docs/test-results/bevy-rust-fixed-step/browser-1791892801455/browser.json) |
| 执行后端 | **Bevy Rust 独立适配器：固定工具链、离线编译、诊断与临时回收**；原适配器锁定更新的具体模板身份，按既有阶段临时编译和运行，错误定位及回收不内嵌到作者编辑器。 | 3 / 3 / 3 / 2 | [docs/test-results/bevy-rust-fixed-step/native-workflow-summary\.json](../docs/test-results/bevy-rust-fixed-step/native-workflow-summary.json)、[docs/test-results/bevy-rust-fixed-step/browser-1791892801455/browser\.json](../docs/test-results/bevy-rust-fixed-step/browser-1791892801455/browser.json)、[docs/test-results/bevy-rust-fixed-step/app-check\.log](../docs/test-results/bevy-rust-fixed-step/app-check.log) |
| 可移植 JS 语义 | **已知脚本起始内容与纯草稿提案**；新增固定步移动起始内容复用纯TXT提案，不自动生成参数、事件、关系或执行任务。 | 3 / 3 / 3 / 2 | [docs/test-results/bevy-rust-fixed-step/authoring-summary\.json](../docs/test-results/bevy-rust-fixed-step/authoring-summary.json)、[docs/test-results/bevy-rust-fixed-step/authoring\.log](../docs/test-results/bevy-rust-fixed-step/authoring.log)、[docs/test-results/bevy-rust-fixed-step/browser-1791892801455/browser\.json](../docs/test-results/bevy-rust-fixed-step/browser-1791892801455/browser.json) |
| 交互与渲染 | **独立三语脚本创建与完整原文预览**；既有独立三语脚本窗口展示新模板，切换语言保留选择及原文并交接普通草稿保存。 | 3 / 3 / 3 / 2 | [docs/test-results/bevy-rust-fixed-step/authoring-summary\.json](../docs/test-results/bevy-rust-fixed-step/authoring-summary.json)、[docs/test-results/bevy-rust-fixed-step/authoring\.log](../docs/test-results/bevy-rust-fixed-step/authoring.log)、[docs/test-results/bevy-rust-fixed-step/browser-1791892801455/browser\.json](../docs/test-results/bevy-rust-fixed-step/browser-1791892801455/browser.json) |

平台：Linux本机编辑服务／CLI及固定离线Rust工具链；局部、真实后端、浏览器和资源准备分别记证据、0.1.3源码交付；安装包、Android、Windows与macOS设备未验收。边界：0.1.2之后未发布工作树；org.viento.bevy-rust适配器与模板0.2.0、Cargo／rustc1.95.0和Bevy0.19.1，仍仅Linux无图Scene2D行为plan／runtime3。旧org.viento.bevy0.3.0数据通道不变。；ready每binding一次，可通过on_fixed_update登记一个固定回调；仅ready允许登记，重复或固定回调内登记均为sticky生命周期错误。旧ready-only脚本保持兼容，旧适配器生成工程须重建。；当前smoke严格两步，每步delta_seconds0.25、tick从0开始；每步先执行既有默认方向移动，再按manifest绑定顺序执行固定回调。没有新增作者时钟、可配置步数或控制回放协议。；position／set_position／translate只操作当前绑定实例，坐标与计算结果必须有限；同实例多绑定可见前一个成功回调的结果，不能借接口修改其他实例或作者文件。；候选位置、待发事件与回调登记仅在当前调用成功后提交；Err、panic或被忽略的参数／位置／事件／生命周期接口错误均不提交本次。此前成功调用保留；任意作者Rust副作用不属于该事务，也不承诺沙箱。；每binding整次运行累计64事件，ready和固定回调共用预算；事件身份和信号映射沿冻结plan及既有中立reader。最终state按当前步前后净位移判断，不把事件帧当作连续位置采样。；bevy-rust-motion starter仅填TXT草稿，velocity_x／velocity_y数字及moved映射须在行为文档显式配置；普通保存、引用关联和绑定编辑继续各守原边界。；源码ZIP仍含Cargo锁文件与冻结作者源码，不含target／缓存／二进制；安装、图片、窗口、GPU、有限输入回放、连续实时循环、热更新、LSP及3D行为均未接入本切片。系统保持20模块／37声明能力、原作者格式与运行协议。。

下一步：先沿本轮有界固定步和来源错误验证细化运行接口；连续时钟、输入回放、交互窗口、跨实例操作、资源和更丰富状态应在各自所有权及预算明确后独立接入。

<a id="scene.audio_timeline"></a>
### 独立场景音轨与有限时间提示

`scene.audio_timeline` · 场景与构建 · 源码交付

入口：已登记Scene2D→唯一audio关系→声音JSON／资源依赖→Rust校验／显式时刻采样→可选声音计划与来源

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **Rust独立音轨与时间提示规则**；无状态音轨与提示严格校验、稳定时序和显式采样，不解码资源或控制播放。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio/core-summary\.json](../docs/test-results/scene-audio/core-summary.json)、[docs/test-results/scene-audio/browser-summary\.json](../docs/test-results/scene-audio/browser-summary.json)、[docs/test-results/scene-audio/prepared\.json](../docs/test-results/scene-audio/prepared.json) |
| 可移植 JS 语义 | **场景声音可选WASM能力桥**；只桥接可选Rust能力和分离冻结回执；核心不可用时明确失败而不以JS替补。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio/core-summary\.json](../docs/test-results/scene-audio/core-summary.json)、[docs/test-results/scene-audio/browser-summary\.json](../docs/test-results/scene-audio/browser-summary.json)、[docs/test-results/scene-audio/prepared\.json](../docs/test-results/scene-audio/prepared.json) |
| 可移植 JS 语义 | **场景声音登记依赖、计划与稳定来源**；沿明确audio关联和登记依赖附加可选声音计划，按稳定身份保留原JSON来源并显式申请能力。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio/planning-tests\.log](../docs/test-results/scene-audio/planning-tests.log)、[docs/test-results/scene-audio/browser-summary\.json](../docs/test-results/scene-audio/browser-summary.json)、[docs/test-results/scene-audio/prepared\.json](../docs/test-results/scene-audio/prepared.json) |
| 可移植 JS 语义 | **中立声音事件顺序、生命周期与来源准入**；独立准入音轨身份、原提示顺序、生命周期与诊断来源，组合原演员／行为读取器。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio/planning-tests\.log](../docs/test-results/scene-audio/planning-tests.log)、[docs/test-results/scene-audio/godot-summary\.json](../docs/test-results/scene-audio/godot-summary.json)、[docs/test-results/scene-audio/browser-summary\.json](../docs/test-results/scene-audio/browser-summary.json) |

平台：Rust原生／实际WASM共享规则；本机保存态计划与来源验证、0.1.3源码交付；安装及Android声音链路未验收。边界：viento-scene-audio schema1独立于场景正文和行为；1–16音轨、0–64提示、0–60秒、0–1音量，稳定场景／轨道／资源／提示UUID。；共享Rust严格检查完整声明并按时刻稳定排序；同刻沿作者顺序，play重新启动当前轨道、stop幂等停止。显式采样只返回命令与声明状态，不读取素材、推断自然结束或控制设备。；场景仅沿唯一audio登记关系启用，声音声明须反向引用场景并绑定其使用资源；未关联声明保持普通数据，旧无声音计划不添加能力或字段。；可选audio-plan1保留原Scene2D计划／运行版本，要求audio.nonspatial与audio.timeline；稳定身份把排序后的运行提示映射回作者原JSON Pointer及修订。；WASM可选能力缺失或错误时明确失败，没有JavaScript规则替代；旧几何／粒子能力维持。music／effect只表示用途，不代表混音总线或空间音频。；本声明不提供自然结束反馈、总线、空间音频或控制回放组合；首次声音创建与项目行为声音控制由各自独立功能承接，声音后端支持必须单独声明。。

下一步：独立设计自然结束反馈及更多声音领域语义；保持时间、资源与播放所有权分开。

<a id="scene.audio_authoring"></a>
### 已有场景声音的素材选择、轨道管理与时间提示编排

`scene.audio_authoring` · 创作与编辑 · 源码交付

入口：按需World绑定WAV→已有声音JSON→显式读取已绑定素材→选择资源／轨道管理／提示编排→完整原文审阅→应用草稿→普通保存

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **声音保真提案与已绑定素材目录捕获**；旧四提案契约保持；独立resources模式按品牌化目录授权resourceId及同批轨道／提示编辑，保真叶／数组补丁，完整候选委托Rust，应用按完整目录和两份来源摘要重算。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio/editor-summary\.json](../docs/test-results/scene-audio/editor-summary.json)、[docs/test-results/scene-audio/browser-summary\.json](../docs/test-results/scene-audio/browser-summary.json)、[docs/test-results/scene-audio/prepared\.json](../docs/test-results/scene-audio/prepared.json) |
| 交互与渲染 | **声音来源／素材目录复核、普通草稿与试听准备宿主**；来源令牌与修订在异步后重查，素材模式复用既有创建目录只读inspect并核对World／对象／完整候选目录；最后同步写普通草稿，不取得登记写入或普通Save权威。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio/editor-summary\.json](../docs/test-results/scene-audio/editor-summary.json)、[docs/test-results/scene-audio/browser-summary\.json](../docs/test-results/scene-audio/browser-summary.json)、[docs/test-results/scene-audio/prepared\.json](../docs/test-results/scene-audio/prepared.json) |
| 交互与渲染 | **独立三语声音编辑表单与素材试听控制入口**；三语表单显式读取已绑定WAV后可选素材，失败保留输入与旧轨道／提示编辑；继续支持1–16轨复制／移除和0–64提示编排，完整审阅后仅应用草稿，绑定通过既有World入口独立完成。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio/editor-summary\.json](../docs/test-results/scene-audio/editor-summary.json)、[docs/test-results/scene-audio/browser-summary\.json](../docs/test-results/scene-audio/browser-summary.json)、[docs/test-results/scene-audio/prepared\.json](../docs/test-results/scene-audio/prepared.json) |
| 可移植 JS 语义 | **studio-modules\.mjs：系统注册与增量需求规划**；独立声明scene\.authoring\.audio，仅依赖document；能力注册不授予文件或执行权。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio/editor-summary\.json](../docs/test-results/scene-audio/editor-summary.json)、[docs/test-results/scene-audio/browser-summary\.json](../docs/test-results/scene-audio/browser-summary.json)、[docs/test-results/scene-audio/prepared\.json](../docs/test-results/scene-audio/prepared.json) |
| 交互与渲染 | **app-studio-system\.js：六区装配与宿主诊断**；组合根只向声音视图注入独立来源、只读素材目录与草稿端口，World绑定、普通Save和build音频验证各自持权；关闭模块不关闭行为或媒体。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio/editor-summary\.json](../docs/test-results/scene-audio/editor-summary.json)、[docs/test-results/scene-audio/browser-summary\.json](../docs/test-results/scene-audio/browser-summary.json)、[docs/test-results/scene-audio/prepared\.json](../docs/test-results/scene-audio/prepared.json) |

平台：Linux本机HTTP编辑服务、Rust实际WASM校验；素材选择需要宿主提供既有声音目录读取，实际范围见独立素材选择专题、基础字段编辑已收录0.1.3；提示、轨道及已绑定素材选择收录于0.1.5源码，不等于新版安装或Android设备支持。边界：独立org.viento.scene-audio模块仅依赖文档，继续提供scene.authoring.audio@1；当前21模块／40项声明能力保持。行为和构建控制器不共享给该模块；显式素材试听通过独立scene.audio_audition端口接入。；旧createSceneAudioProposal保持定长、定身份的role／volume／loop及atSeconds／action叶编辑；createSceneAudioCueProposal仅允许提示移除和末尾追加，固定旧cue的trackId与相对顺序；createSceneAudioTimelineProposal允许当前已声明轨道间换轨、任意合法作者顺序及同批增删。这三种API继续固定轨道数量、身份、资源与顺序。原createSceneAudioTrackProposal独立接受含resourceId的完整tracks行：保留轨道id／resourceId及相对顺序，只在末尾追加复用原文资源的新轨道，最终1–16轨；同批cue必须引用最终轨道。 新createSceneAudioResourceProposal(source, edit, catalog)单独允许从已绑定目录选择resourceId，可同批轨道与提示结构编辑；旧四API仍不能替换保留轨道的素材。；parseJsonSource拒重复键，原文及完整候选都由同一Rust语义校验。轨道和提示分别按净变化生成叶补丁或局部数组补丁；结构变化按UUID复用保留项原文片段，仅改明确授权字段；resourceId叶值只在独立素材提案中授权。BOM、换行、转义键、未改数值及数组外原字节保留，空提示数组与删至空单独处理。运行先按时间排序，同刻按作者顺序；编辑不以运行排序重写作者数组。；私有品牌提案绑定原文／修订／来源token，并区分leaf、cue-only、timeline、tracks与resources；应用时按原模式重算。素材目录以私有数据捕获完整来源五字段和创建目录DTO，应用须重新读取生成新目录实例，核对World／对象／完整候选目录，并验证当前草稿与savedContent两份摘要。宿主每个异步边界及最后同步写入前复核，只更新普通未保存草稿；普通Save继续拥有持久化，不增加World写命令、Rust ABI或后端权限。；三语表单可复制当前轨道设置为独立UUID、同资源的末尾新行，不复制cue；未完成数字随复制保留。保持1–16轨，删除前需先移除或改接当前表单全部引用cue，handler复核静默输入变化。0–64提示默认0秒play追加，当前轨道选择及上下移动保留身份、焦点与半成品，语言切换不重置，修改撤销旧审阅。显式“读取已绑定素材”才启用WAV选择，不自动换值；失败保留输入并禁用素材选择，原轨道／提示编辑继续。目录丢失当前资源时保留ID与不可用提示。编辑不自动播放；显式素材试听走独立受限端口，不取得文件、World写入、后端或普通Save接口。；最初叶编辑专题证据保留：局部201项回归含25新增、零跳过；真实Chrome中英日390px的取消、完整审阅、普通保存和后续Godot／58450字节ZIP异地运行。该记录起点为复制示例已有声音JSON，不改标为本轮结构编辑重跑。；此前0.1.4后提示增删切片的核心／来源、界面及真实Chrome到Godot／异地ZIP分别保留在scene-audio-cue-authoring专题；其固定旧绑定／相对顺序和末尾追加API不变，不将该证据改标为本轮换轨／重排验收。；此前换轨与显式上下移动的核心／来源、三语界面、真实浏览器及运行范围由scene-audio-cue-arrangement专题独立记录；本图谱不预填测试数字。全部2136评分对象保持，不将局部证据外推安装、Android或物理扬声器。；轨道复制／移除和素材选择只改变声音正文，metadata绑定可保留最终所需资源的超集，资产与登记不删除。新素材必须先通过World既有resource.bind独立保存到声音文档；该绑定按assetId识别，不限定原role。之后显式目录选择再普通保存正文，取消正文不会撤销已保存绑定，不提供跨文件原子性、解绑或资源导入。解析与冻结只选择最终轨道实际使用资源并去重。；无cue引用不代表无行为引用：参数或脚本中动态轨道ID不会被静态解析或自动更新，作者移除轨道时需手动检查。实际调用未知轨道沿既有运行接口失败；保存并重建后才进入新快照，旧构建及运行保持原声明。；此前轨道复制／移除的核心／来源、三语界面、真实浏览器与运行范围由scene-audio-track-authoring专题独立记录；不预填测试数字，也不将旧提示专题改标为本轮重跑。全部2136评分对象保持。；声音宿主复用现有scene-audio-creation只读inspect；scene-audio-resources.mjs仅提供已绑定且登记／可用性符合目录条件的WAV选择，仍标为unverified。读取目录、保存绑定或应用正文都不验证真实PCM／SHA-256；构建所需的实际WAV检查与冻结由build完成；独立试听只验证自己的本次字节副本，不改变目录状态。没有新素材管理窗口或metadata写入端口。；本轮已绑定素材选择的纯层、来源宿主、中英日界面、World绑定到普通正文保存及浏览器／Godot／异地ZIP范围，由scene-audio-resource-selection专题独立记录。旧全部专题和2136评分对象保持，不外推安装、Android或物理扬声器验收。；0.1.5收录本功能的0.1.4后工作树增量；发布检查见release-0.1.5，历史专题及评分按原范围保留，不把源码交付推导为安装、设备或新增后端执行验收。。

下一步：继续单独设计声音内资源导入登记、解绑／清理、行为绑定导航和更广的作者历史；绑定、普通正文保存与播放保持各自权限。

<a id="runtime.godot_audio"></a>
### Godot非空间声音播放与资源工程交付

`runtime.godot_audio` · 运行后端与演进 · 源码交付

入口：显式声音计划→WAV哈希与容器冻结→Godot0.6.0生成→轨道播放／停止与声音帧→带WAV工程库存／ZIP

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 本机服务与适配 | **PCM WAV容器校验与真实资源冻结**；可信宿主冻结登记哈希对应的PCM WAV并检查容器，不转码、改写或把其他音频格式默认为可执行。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio/planning-tests\.log](../docs/test-results/scene-audio/planning-tests.log)、[docs/test-results/scene-audio/godot-summary\.json](../docs/test-results/scene-audio/godot-summary.json)、[docs/test-results/scene-audio/browser-summary\.json](../docs/test-results/scene-audio/browser-summary.json) |
| 执行后端 | **Godot声音工程生成与来源诊断适配**；Godot0\.6\.0生成独立声音脚本／清单／资源路径，适配能力与冻结来源诊断。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio/godot-summary\.json](../docs/test-results/scene-audio/godot-summary.json)、[docs/test-results/scene-audio/browser-summary\.json](../docs/test-results/scene-audio/browser-summary.json)、[docs/test-results/scene-audio/prepared\.json](../docs/test-results/scene-audio/prepared.json) |
| 执行后端 | **Godot每轨播放器与场景时间驱动**；Godot各轨独立流与播放器实现时间提示、音量与循环；有限smoke和实际时间由运行器维护。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio/godot-summary\.json](../docs/test-results/scene-audio/godot-summary.json)、[docs/test-results/scene-audio/browser-summary\.json](../docs/test-results/scene-audio/browser-summary.json)、[docs/test-results/scene-audio/prepared\.json](../docs/test-results/scene-audio/prepared.json) |
| 本机服务与适配 | **node-execution-backends\.mjs / node-project-build\.mjs：可信注册、输出与冻结编排**；通用生成资源映射承载WAV冻结副本及库存校验，执行编排不内嵌音轨语义。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio/planning-tests\.log](../docs/test-results/scene-audio/planning-tests.log)、[docs/test-results/scene-audio/godot-summary\.json](../docs/test-results/scene-audio/godot-summary.json)、[docs/test-results/scene-audio/browser-summary\.json](../docs/test-results/scene-audio/browser-summary.json) |

平台：Linux本机Godot4.7.2实际引擎PCM缓冲验证与异地工程交付、0.1.3源码交付；未验收物理扬声器或安装设备。边界：Godot适配器0.6.0显式声明audio.nonspatial／audio.timeline，旧无声音生成保持各自模块；Bevy数据与Rust行为通道明确拒绝，不静默丢弃声音。；宿主冻结实际PCM16 WAV，单／双声道、8–96kHz、每份最多32MiB；登记hash、完整RIFF容器、数据对齐及冻结库存均须核验，不转码或改写作者素材。；Godot独立生成器输出声音清单、运行脚本和audio/资源路径；每轨独立AudioStreamPlayer及流副本，处理音量、循环、play重新启动及stop。music／effect不变成混音总线。；有限smoke处理0、0.25、0.5秒，窗口生成工程由实际delta推进；独立VIENTO_AUDIO协议1核对就绪、提示顺序、结束及冻结诊断来源，与原演员／行为事件组合。 有限运行的声音结束时刻与演员步数交叉核对；高精度提示保留IEEE-754值及0.5秒相邻double边界，不以四舍五入扩大触发范围。；真实Godot4.7.2隔离AudioEffectCapture验证非零PCM、零音量、停止和独立循环，未验证物理扬声器；缺WAV给出轨道来源错误，不虚报finished。；工程ZIP仅带核对后的生成文件与WAV原字节，已验证异地工程库存和声音资源；不等于无开发引擎环境的独立游戏发行。；音频与有限控制回放目前明确拒绝；行为信号触发声音、空间声音、总线、Bevy音频、新安装和目标设备验收不在本范围。。

下一步：先独立接通行为事件到声音命令及受控时钟的组合验证；其他后端、空间音频、总线与独立发行各自准入。

<a id="scene.audio_creation"></a>
### 保存场景首次创建声音与完整登记

`scene.audio_creation` · 场景与构建 · 源码交付

入口：构建与运行→场景声音设置→逐轨选择定时／行为触发及登记WAV→审阅→三文件保存→普通编辑或项目行为控制→Godot→工程交付

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **首次声音轨道草稿与Rust权威委托**；纯输入注入稳定身份与逐轨触发方式；省略方式兼容默认定时play，行为方式不生成cue。混合／空时间线仍由既有Rust语义校验并稳定排序，不读取素材或分配身份。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio-creation/pure-summary\.json](../docs/test-results/scene-audio-creation/pure-summary.json)、[docs/test-results/scene-audio-creation/pure-test\.log](../docs/test-results/scene-audio-creation/pure-test.log)、[docs/test-results/scene-audio-creation/browser-1792056336902/browser\.json](../docs/test-results/scene-audio-creation/browser-1792056336902/browser.json) |
| 可移植 JS 语义 | **声音首次创建三文件计划与冻结依赖证据**；audio\.create严格请求检查保存态World／场景修订，复用普通创建约束并产生三文件计划；保留已有行为关系和原场景字节，用有界依赖快照证明恢复身份。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio-creation/pure-summary\.json](../docs/test-results/scene-audio-creation/pure-summary.json)、[docs/test-results/scene-audio-creation/pure-test\.log](../docs/test-results/scene-audio-creation/pure-test.log)、[docs/test-results/scene-audio-creation/browser-1792056336902/browser\.json](../docs/test-results/scene-audio-creation/browser-1792056336902/browser.json) |
| 可移植 JS 语义 | **声音创建目录、请求与完整回执合同**；在无IO边界捕获empty／ready目录并绑定源版本，严格检查新建回执；未知提交只凭同UUID、原文、修订与精确依赖闭包收敛。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio-creation/pure-summary\.json](../docs/test-results/scene-audio-creation/pure-summary.json)、[docs/test-results/scene-audio-creation/pure-test\.log](../docs/test-results/scene-audio-creation/pure-test.log)、[docs/test-results/scene-audio-creation/browser-1792056336902/browser\.json](../docs/test-results/scene-audio-creation/browser-1792056336902/browser.json) |
| 本机服务与适配 | **保存态声音目录与选中PCM实字节验证**；一次只读快照给出保存场景和已登记候选，HTTP须作者鉴权；预览、提交与最后写入前核验实际PCM、字节哈希和资源仓位置，不转码或复制作者素材。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio-creation/pure-summary\.json](../docs/test-results/scene-audio-creation/pure-summary.json)、[docs/test-results/scene-audio-creation/pure-test\.log](../docs/test-results/scene-audio-creation/pure-test.log)、[docs/test-results/scene-audio-creation/browser-1792056336902/browser\.json](../docs/test-results/scene-audio-creation/browser-1792056336902/browser.json) |
| 存储与事务 | **声音创建v10三文件事务与离线恢复**；独立v10只拥有声音正文、声音登记和场景登记三个写入目标；加载冻结依赖核对恢复，支持回滚／提交完成并保留外部冲突，恢复不读取今日WAV。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio-creation/pure-summary\.json](../docs/test-results/scene-audio-creation/pure-summary.json)、[docs/test-results/scene-audio-creation/pure-test\.log](../docs/test-results/scene-audio-creation/pure-test.log)、[docs/test-results/scene-audio-creation/browser-1792056336902/browser\.json](../docs/test-results/scene-audio-creation/browser-1792056336902/browser.json) |
| 交互与渲染 | **独立三语首次声音创建与保存导航**；构建视图交接保存态场景与命令端口；独立三语表单配置逐轨定时／行为模式，审阅三文件写入并导航已有正文。切换撤销审阅、保留身份和输入；不自动绑定脚本或播放。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio-creation/pure-summary\.json](../docs/test-results/scene-audio-creation/pure-summary.json)、[docs/test-results/scene-audio-creation/pure-test\.log](../docs/test-results/scene-audio-creation/pure-test.log)、[docs/test-results/scene-audio-creation/browser-1792056336902/browser\.json](../docs/test-results/scene-audio-creation/browser-1792056336902/browser.json) |
| 可移植 JS 语义 | **studio-modules\.mjs：系统注册与增量需求规划**；独立声明构建模块的scene\.authoring\.audio-creation，不把已有声音字段编辑模块扩大为World或文件写入宿主。 | 4 / 3 / 3 / 2 | [docs/test-results/scene-audio-creation/pure-summary\.json](../docs/test-results/scene-audio-creation/pure-summary.json)、[docs/test-results/scene-audio-creation/browser-1792056336902/browser\.json](../docs/test-results/scene-audio-creation/browser-1792056336902/browser.json)、[docs/test-results/scene-audio-creation/prepared\.json](../docs/test-results/scene-audio-creation/prepared.json) |

平台：Linux本机HTTP服务、真实Chrome、Godot无头与工程ZIP异地导入分别记录证据、0.1.4源码交付；桌面／移动准备资源不等于安装；当前Android宿主未声明audio.create。边界：从已保存且登记完整的Scene2D schema2／3出发；需要已有有效演员定义，原有行为可共存。不是空工程全程GUI、资源导入或场景正文重写。；每轨显式选择已登记PCM16 WAV、用途、音量、循环及定时／行为触发；默认定时播放且初始一条play，行为方式不生成cue。混合与全部行为触发均可，1–16轨道保持；该选择仅属于创作草稿，不向声音schema1增字段，实际规则继续委托Rust。；目录最多256候选且明确unverified；实际预览／提交／写前检查PCM16、单／双声道、8–96kHz、单份32MiB、去重合计128MiB、SHA-256与资源仓位置。素材留在原存储，不转码或复制到程序。；audio.create绑定World、场景对象与源修订，只创建新正文／新登记并lossless追加原场景audio关系；声音反向引用场景并去重绑定资源，既有行为与其他关系保留。已有、坏或歧义声音关联拒绝首次创建。；独立v10事务严格三份作者文件；冻结场景／定义及资源登记形成有界恢复证据，不含WAV字节。恢复不读取今日素材，不覆盖外部冲突，不把三文件协议扩为通用编辑。；既有声明的ready目录兼容reference／slot及合法有界附注；新创建回执及未知提交只凭同UUID／原文／修订和精确新依赖闭包确认。超时只读核对，不盲目重试创建。；创建表单、已有字段编辑、普通保存、行为绑定与后端播放保持独立接口。选择不同轨道／语言保留模式与未完成输入，切换模式撤销旧审阅并保留稳定身份；不自动创建或执行脚本。0.1.4后已有提示的增删、目标换轨及上下移动由独立scene.audio_authoring面板完成；同资源轨道复制与移除也由该独立面板处理，复用普通保存且保留原登记绑定；已有轨道还可先在World显式保存素材绑定，再从此面板读取目录并选择素材；复用创建目录只读inspect，不调用audio.create或三文件保存，新资源导入登记保持独立。；真实Godot与工程ZIP链复用已有音频能力；Bevy不新增音频支持。首次创建无需Godot，移动命令未接入；不声称物理扬声器、独立游戏发行或新安装设备验收。；最初定时创建验收记录：最终同轮真实Chrome六组／十二图／41份源码指纹稳定、零浏览器错误；58542字节工程ZIP含八生成文件／一去重WAV，异地Godot导入运行及两条提示一致。桌面／移动准备38比对与10项实际调用另记，不外推Android创建能力。；本轮触发方式分支复核：逐轨定时／行为触发创建：旧输入字节保持，零提示仍校验并登记WAV；107项相关检查、实际项目创建后八条行为声音命令及零定时提示、Chrome六组12图与异地ZIP、准备副本18次对照/3组核心调用通过。应用5307项中5150通过、157条件跳过。。

下一步：继续推进声音内资源导入登记、解绑／清理与行为绑定导航；首次三文件创建、已有声音普通保存、时间线和运行播放器的所有权保持独立。

<a id="build.project_assembly"></a>
### 项目级多场景组装、启动入口与统一工程交付

`build.project_assembly` · 场景与构建 · 源码交付

入口：构建与运行→项目组装→选择1–32个已保存场景及启动入口→审阅保存→检查／构建／运行→工程交付

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **项目组装声明、成员准入与嵌套中立计划**；正文成员与启动入口为权威，原样复用单场景计划并检查项目联合资源及身份。 | 4 / 3 / 3 / 2 | [docs/test-results/project-assembly/core-results\.json](../docs/test-results/project-assembly/core-results.json)、[docs/test-results/project-assembly/browser-1792059497612/browser\.json](../docs/test-results/project-assembly/browser-1792059497612/browser.json)、[docs/test-results/project-assembly/application\.log](../docs/test-results/project-assembly/application.log) |
| 本机服务与适配 | **多场景一次观察冻结与显式后端能力准入**；所有成员和资源来自同一World观察及fence；能力检查逐成员保留具体来源。 | 4 / 3 / 3 / 2 | [docs/test-results/project-assembly/core-results\.json](../docs/test-results/project-assembly/core-results.json)、[docs/test-results/project-assembly/browser-1792059497612/browser\.json](../docs/test-results/project-assembly/browser-1792059497612/browser.json)、[docs/test-results/project-assembly/application\.log](../docs/test-results/project-assembly/application.log) |
| 本机服务与适配 | **项目组装作者文档与构建任务接线**；作者服务按World／正文修订创建或保存声明；通用构建以target和entry分派，旧单场景接口兼容。 | 4 / 3 / 3 / 2 | [docs/test-results/project-assembly/browser-1792059497612/browser\.json](../docs/test-results/project-assembly/browser-1792059497612/browser.json)、[docs/test-results/project-assembly/application\.log](../docs/test-results/project-assembly/application.log)、[docs/test-results/project-assembly/prepared-resources\.json](../docs/test-results/project-assembly/prepared-resources.json) |
| 交互与渲染 | **独立项目组装表单与三语审阅**；独立表单编辑成员顺序与入口，保存前审阅完整作者JSON，保存后交给已有构建目标。 | 4 / 3 / 3 / 2 | [docs/test-results/project-assembly/browser-1792059497612/browser\.json](../docs/test-results/project-assembly/browser-1792059497612/browser.json)、[docs/test-results/project-assembly/application\.log](../docs/test-results/project-assembly/application.log)、[docs/test-results/project-assembly/prepared-resources\.json](../docs/test-results/project-assembly/prepared-resources.json) |
| 执行后端 | **Godot统一项目与逐成员生成**；具体节点、资源路径、脚本检查和入口配置只在Godot适配层；复用已有行为／声音执行。 | 4 / 3 / 3 / 2 | [docs/test-results/project-assembly/godot-backend-tests\.log](../docs/test-results/project-assembly/godot-backend-tests.log)、[docs/test-results/project-assembly/browser-1792059497612/browser\.json](../docs/test-results/project-assembly/browser-1792059497612/browser.json)、[docs/test-results/project-assembly/application\.log](../docs/test-results/project-assembly/application.log) |
| 本机服务与适配 | **项目来源manifest v2与持久工程目录**；manifest v2保留组装与全部成员来源；持久恢复显式targetKind／targetId，交付只消费已核对文件。 | 4 / 3 / 3 / 2 | [docs/test-results/project-assembly/godot-backend-tests\.log](../docs/test-results/project-assembly/godot-backend-tests.log)、[docs/test-results/project-assembly/browser-1792059497612/browser\.json](../docs/test-results/project-assembly/browser-1792059497612/browser.json)、[docs/test-results/project-assembly/application\.log](../docs/test-results/project-assembly/application.log) |
| 存储与事务 | **组装声明派生资源包成员闭包**；从正文sceneIds派生依赖，核对可读登记源并复用既有递归选择与导入fence，不复制成员权威到metadata。 | 4 / 3 / 3 / 2 | [docs/test-results/project-assembly/core-results\.json](../docs/test-results/project-assembly/core-results.json)、[docs/test-results/project-assembly/browser-1792059497612/browser\.json](../docs/test-results/project-assembly/browser-1792059497612/browser.json)、[docs/test-results/project-assembly/application\.log](../docs/test-results/project-assembly/application.log) |
| 可移植 JS 语义 | **studio-modules\.mjs：系统注册与增量需求规划**；既有构建模块声明项目组装作者能力，不增加模块或动态执行权限。 | 4 / 3 / 3 / 2 | [docs/test-results/project-assembly/core-results\.json](../docs/test-results/project-assembly/core-results.json)、[docs/test-results/project-assembly/browser-1792059497612/browser\.json](../docs/test-results/project-assembly/browser-1792059497612/browser.json)、[docs/test-results/project-assembly/application\.log](../docs/test-results/project-assembly/application.log) |

平台：Linux本机HTTP编辑器、真实Chrome与原生Godot无头／窗口分别实测、0.1.4源码交付；桌面／移动资源副本已比对和调用；安装版Tauri、Android及其他桌面系统未验收。边界：独立viento-project-assembly v1作者JSON保存title、entrySceneId和有序sceneIds；只使用已登记稳定场景UUID，成员由正文派生，不增加同义metadata关系权威。；kind=project／schemaVersion1计划嵌套原样Scene2D plan1／2／3；assembly来源与entry scene分开，组装不伪造scene／actors字段，不把Godot路径带入纯核心。；每成员各自通过既有模型／行为／声音准入；统一一次World观察和事务fence，联合去重资源，后端显式project.scenes及逐成员能力／语言检查。；当前最多32个Scene2D，128项联合资源及128MiB实字节；场景局部actor／instance身份可跨成员重用，资源UUID共享时只冻结及交付一份。；Godot生成单个project.godot和多个UUID命名场景目录，该组装切片的运行证据只观察启动成员；后续项目内运行时切换由runtime.project_scene_switching独立记录。；项目工程使用manifest v2明确assembly、entry及成员来源；旧单场景manifest v1、冻结重放和生成器边界保持。资源包沿组装→成员→已登记行为／素材依赖闭包，并在导入核对成员源。；组装作者服务与独立三语界面不执行引擎；构建目录、已有工程恢复选择和交付仍走可信宿主编排。物理／动画、Scene3D／Composition直接组装、LSP和独立游戏发行未包含。；最终业务验证从准备好的双场景工程出发，不声称空工程上游全部GUI创作；真实Chrome四组／八图、三语390px及Godot入口对象／窗口取消、工程ZIP异地启动均通过，81份来源不变。全应用5067项中4948通过／119条件跳过；后端专项117项另列，准备62比对／4组调用不等于安装。。

下一步：项目内切换与逐访问观察由runtime.project_scene_switching独立接入并保存新证据；随后分别定义3D／配方构建和目标平台发行。

<a id="runtime.project_scene_switching"></a>
### 项目内运行时场景切换与逐访问观察

`runtime.project_scene_switching` · 运行后端与演进 · 源码交付

入口：已保存项目组装→Godot场景切换脚本→冻结统一工程→绑定访问端口请求成员→离场清理／进入→当前与历史观察→工程ZIP交付

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **项目运行事件封装与逐访问准入**；独立项目封装只使用冻结身份并逐访问复用旧child事件准入。 | 4 / 3 / 3 / 2 | [docs/test-results/project-scene-switching/core-tests\.log](../docs/test-results/project-scene-switching/core-tests.log)、[docs/test-results/project-scene-switching/ui-results\.json](../docs/test-results/project-scene-switching/ui-results.json)、[docs/test-results/project-scene-switching/core-results\.json](../docs/test-results/project-scene-switching/core-results.json) |
| 可移植 JS 语义 | **当前场景及访问记录的纯观察与查询**；当前观察与有界访问历史为纯数据，切换立即撤销旧场景坐标。 | 4 / 3 / 3 / 2 | [docs/test-results/project-scene-switching/core-tests\.log](../docs/test-results/project-scene-switching/core-tests.log)、[docs/test-results/project-scene-switching/ui-results\.json](../docs/test-results/project-scene-switching/ui-results.json)、[docs/test-results/project-scene-switching/core-results\.json](../docs/test-results/project-scene-switching/core-results.json) |
| 执行后端 | **Godot项目协调器与访问绑定场景桥**；协调器拥有切换、退出清理、局部时钟及每绑定访问端口，旧单场景运行时保持。 | 4 / 3 / 3 / 2 | [docs/test-results/project-scene-switching/core-tests\.log](../docs/test-results/project-scene-switching/core-tests.log)、[docs/test-results/project-scene-switching/ui-results\.json](../docs/test-results/project-scene-switching/ui-results.json)、[docs/test-results/project-scene-switching/core-results\.json](../docs/test-results/project-scene-switching/core-results.json) |
| 本机服务与适配 | **项目运行观察分流与冻结成员白名单**；宿主按计划种类观察，冻结成员白名单与assembly任务身份独立。 | 4 / 3 / 3 / 2 | [docs/test-results/project-scene-switching/core-tests\.log](../docs/test-results/project-scene-switching/core-tests.log)、[docs/test-results/project-scene-switching/ui-results\.json](../docs/test-results/project-scene-switching/ui-results.json)、[docs/test-results/project-scene-switching/core-results\.json](../docs/test-results/project-scene-switching/core-results.json) |
| 交互与渲染 | **三语当前场景与访问历史及来源失效守护**；界面显示当前／历史，来源导航按visit与冻结成员版本撤销。 | 4 / 3 / 3 / 2 | [docs/test-results/project-scene-switching/core-tests\.log](../docs/test-results/project-scene-switching/core-tests.log)、[docs/test-results/project-scene-switching/ui-results\.json](../docs/test-results/project-scene-switching/ui-results.json)、[docs/test-results/project-scene-switching/core-results\.json](../docs/test-results/project-scene-switching/core-results.json) |
| 可移植 JS 语义 | **已知脚本起始内容与纯草稿提案**；复用既有纯脚本草稿提案，新增Godot场景切换起始内容。 | 4 / 3 / 3 / 2 | [docs/test-results/project-scene-switching/core-tests\.log](../docs/test-results/project-scene-switching/core-tests.log)、[docs/test-results/project-scene-switching/ui-results\.json](../docs/test-results/project-scene-switching/ui-results.json)、[docs/test-results/project-scene-switching/core-results\.json](../docs/test-results/project-scene-switching/core-results.json) |

平台：Linux本机服务／CLI、Godot 4项目工程与浏览器编辑界面；实际验证按本轮新证据分别记录、0.1.4源码交付；不更新安装；Android、Windows与macOS设备及独立游戏发行未验收。边界：复用viento-project-assembly schema1、1–32成员和启动场景；中立project plan1及各成员scene plan／runtime1、2、3均保持。系统仍21模块／40项声明能力，项目执行任务始终归属于组装身份。；独立VIENTO_PROJECT protocol1包裹旧runtime／audio帧；ready→scene-enter→scene-event→scene-exit→finished严格准入，每visit从1单调增加，最多64次，4096帧、128诊断及128KiB单行预算。原单场景事件格式及读取器不改。；每visit新建旧child reader，成员／访问／绑定／实例身份均从冻结计划验证；原始child输出、迟到旧访问、非成员、伪造actor finished及同场景切换拒绝。离场采样独立校验，声音停止完成与本visit局部时钟相符，不复用旧两步声音完成语义。；Godot根协调器持有成员、时钟和pending请求；作者Node通过get_meta("viento_project").request_scene(sceneId)取得绑定／visit窄端口。当前场景／重复pending／失效旧端口返回false；非法成员及64次限制通过原binding诊断回源并失败结束。；离场先撤销端口并禁用旧子树处理，再同步声音停止与最终状态、释放旧树后进入目标；无头运行整个项目固定两步0.25秒，ready链和每步后消费请求。窗口作者_process由Godot自然调度，不在宿主重放。；纯观察保存当前child DTO与project.visits；退出到下一enter间立即换成目标waiting观察并清空旧坐标。A→B→A以新visit身份区分，三语UI来源所有权同时绑定访问、当前成员和冻结修订，延迟旧跳转失效。；latestBuild.scenes只公开冻结sceneId、title、sourcePath、sourceRevision、planSchemaVersion与runtimeProtocolVersion；readRuntime沿当前成员过滤对象，任务和工程来源继续绑定assembly。普通保存与脚本起始内容不自动执行或变更成员。；不新增跨场景全局状态、事件总线、动态加载未冻结成员、3D／配方直接组装、Bevy项目运行、物理动画、LSP或目标平台独立发行；生成工程ZIP仍需相应Godot工具。；最终真实Chrome五组／九图及98份来源指纹保持，A→B→A、三语390px、Godot窗口取消与92367字节ZIP／23文件／2资源异地同序列通过。核心70、UI67与Godot专项42通过／2条件跳过分别记录；74准备比对／4组实际调用不代表安装。最终完整应用5107项中4980通过、127条件跳过、0失败，864份JS及API／版本预检通过；各专项存在重叠，不叠加为总测试数。；无头smoke由可信宿主向项目reader设置expectedTotalSeconds=0.5；逐访问时间相加后按1e-6绝对误差核对，提前0／0.25秒完成拒绝为runtime_protocol_incomplete。可选预期仅接受0–60秒有限数，不进入作者声明；普通窗口省略预期，可在首步前正常关闭。；最终第5组浏览器真实点击当前实例返回匹配作者文档并核对全文；夹具缺sourceRange，不能据此宣称精确选区。读取期间isLoadingSource由宿主自己置位，持续回源所有权只检查身份／修订／visit而不再把自身busy视为取消；精确来源读取由新增UI生命周期回归覆盖。。

下一步：在当前有界切换与访问来源规则之上，分别定义更广生命周期、跨场景状态和事件所有权及目标平台交付；不得把当前切换端口扩展为任意运行反射。

<a id="runtime.project_shared_state"></a>
### 项目会话共享标量状态与历史写入来源

`runtime.project_shared_state` · 运行后端与演进 · 源码交付

入口：项目组装与共享状态脚本→冻结协议2工程→绑定访问端口读写／移除→跨场景保持及运行观察→来源导航→工程ZIP交付

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **有界共享标量状态、修订与原子提交**；纯状态模型持有预算与修订，候选整体校验后提交，无引擎／文件／UI权限。 | 4 / 3 / 3 / 2 | [docs/test-results/project-shared-state/core-results\.json](../docs/test-results/project-shared-state/core-results.json)、[docs/test-results/project-shared-state/ui-results\.json](../docs/test-results/project-shared-state/ui-results.json)、[docs/test-results/project-shared-state/godot-tests\.log](../docs/test-results/project-shared-state/godot-tests.log) |
| 可移植 JS 语义 | **项目协议2状态帧与冻结绑定准入**；线协议只接受当前冻结绑定的成功状态变更，来源不从wire读取。 | 4 / 3 / 3 / 2 | [docs/test-results/project-shared-state/core-results\.json](../docs/test-results/project-shared-state/core-results.json)、[docs/test-results/project-shared-state/ui-results\.json](../docs/test-results/project-shared-state/ui-results.json)、[docs/test-results/project-shared-state/godot-tests\.log](../docs/test-results/project-shared-state/godot-tests.log) |
| 可移植 JS 语义 | **共享状态及历史写入来源的纯观察查询**；query保留当前演员与跨访问状态，按历史visit核对写入来源。 | 4 / 3 / 3 / 2 | [docs/test-results/project-shared-state/core-results\.json](../docs/test-results/project-shared-state/core-results.json)、[docs/test-results/project-shared-state/ui-results\.json](../docs/test-results/project-shared-state/ui-results.json)、[docs/test-results/project-shared-state/godot-tests\.log](../docs/test-results/project-shared-state/godot-tests.log) |
| 执行后端 | **Godot会话状态端口与显式项目协议交付**；Godot协调器会话实例持有状态，访问端口与项目协议2由后端明确实现。 | 4 / 3 / 3 / 2 | [docs/test-results/project-shared-state/core-results\.json](../docs/test-results/project-shared-state/core-results.json)、[docs/test-results/project-shared-state/ui-results\.json](../docs/test-results/project-shared-state/ui-results.json)、[docs/test-results/project-shared-state/godot-tests\.log](../docs/test-results/project-shared-state/godot-tests.log) |
| 本机服务与适配 | **冻结项目协议选择与宿主共享状态读取**；宿主按冻结后端协议分流，任务仍为assembly；指纹变化要求旧缓存重建。 | 4 / 3 / 3 / 2 | [docs/test-results/project-shared-state/core-results\.json](../docs/test-results/project-shared-state/core-results.json)、[docs/test-results/project-shared-state/ui-results\.json](../docs/test-results/project-shared-state/ui-results.json)、[docs/test-results/project-shared-state/godot-tests\.log](../docs/test-results/project-shared-state/godot-tests.log) |
| 交互与渲染 | **独立三语共享状态观察与历史来源导航**；独立只读面板消费准入DTO，来源沿原写入记录且受会话／visit／revision守护。 | 4 / 3 / 3 / 2 | [docs/test-results/project-shared-state/core-results\.json](../docs/test-results/project-shared-state/core-results.json)、[docs/test-results/project-shared-state/ui-results\.json](../docs/test-results/project-shared-state/ui-results.json)、[docs/test-results/project-shared-state/godot-tests\.log](../docs/test-results/project-shared-state/godot-tests.log) |
| 可移植 JS 语义 | **已知脚本起始内容与纯草稿提案**；复用脚本起始草稿机制增加共享状态示例，不取得保存／绑定／执行权。 | 4 / 3 / 3 / 2 | [docs/test-results/project-shared-state/core-results\.json](../docs/test-results/project-shared-state/core-results.json)、[docs/test-results/project-shared-state/ui-results\.json](../docs/test-results/project-shared-state/ui-results.json)、[docs/test-results/project-shared-state/godot-tests\.log](../docs/test-results/project-shared-state/godot-tests.log) |

平台：Linux本机HTTP编辑器、真实Chrome与Godot 4无头／窗口；桌面／移动资源副本一致性分别记录、0.1.4源码交付；未更新安装；Android及其他桌面目标设备、独立游戏发行未验收。边界：作者组装schema1、project plan1与旧scene1／2／3事件保持；仅新项目runtime protocol2增加状态帧，纯reader／observer显式protocolVersion选择且默认1。旧protocol1观察DTO与导出工程保留，不按stdout猜版本。当前Godot适配器0.9.0输出自己的viento-godot-project生成清单3，后端派生格式不进入纯作者计划。；会话状态从空映射／revision0开始，只在同一运行的场景访问间保持；Godot协调器实例持有数据，不写作者、构建声明、持久存档或跨任务全局对象。；窄绑定端口提供read_state(key)、write_state(key,value)、erase_state(key)。缺失读取null；值只bool、有限且绝对值≤1e9的number、有效Unicode字符串。null不存储；-0归一为0，数值1与1.0同值。；键为ASCII字母起始、后续字母／数字／下划线／点／连字符且最多64字符，保留constructor／prototype／__proto__；最多64个键、1024次成功变更、16384 UTF-8载荷字节，单字符串最多4096字节。布尔计1、数值计8、键计ASCII字节；候选全量检查后才提交。；同类型同值write成功但不发事件、不增revision；缺失erase返回false。失效旧visit端口静默拒绝；当前绑定非法输入通过原绑定诊断回源并失败结束，状态值／revision／lastChange保持原子性。；protocol2 ready必须stateRevision0；state事件只在当前已ready且未离场visit内准入，冻结scene／binding／instance／object身份及全局revision严格+1，operation set需value而delete禁止value。线协议禁止来源路径；finished核对最终stateRevision及宿主可选smoke时长。；纯DTO增加project.protocolVersion2和sharedState；entries按ASCII键排序，逐键记录最后revision与origin。origin的visit／scene／绑定／实例／演员和冻结binding.declaration来源保持，已离场写入来源不能换成当前场景；移除后保留lastChange，即使状态已空。；独立只读三语状态面板消费已准入query结果，过滤不改状态；来源票据绑定会话、visit和状态／条目revision，状态变化撤销迟到导航。当前binding来源只有文档／字段，不补造sourceRange或承诺精确选区。；可信宿主按已验证冻结backend.protocolVersion选择reader／observer，适配器身份和生成指纹继续严格核对。旧本机缓存遇适配器变更要求重建，不放宽hash或把reader兼容解释为旧缓存可直接重跑。；不增加系统模块或声明能力（仍21／40），不新增跨场景事件总线、对象／数组状态、存档、任意运行反射、动态成员、Bevy项目执行、网络同步或独立发行。；最终真实Chrome六组／九图、112份源码摘要保持：三语390px、A→B→A状态及删除来源、新运行清空、实际Godot窗口和98170字节ZIP／23文件／2资源异地同状态序列通过；回源fixture无sourceRange，仅证明匹配文档。核心95／UI82／host6通过，Godot69项67通过／2旧条件跳过，准备82比对／4调用分别记载；最终全应用5158项为5021通过／137条件跳过／0失败，875份JS及API／版本预检通过，starter40通过；各专项重叠不相加。。

下一步：在有界会话标量和冻结来源之上分别设计存档、复合领域数据及事件语义；不把本轮临时状态升级为隐式全局模型。

<a id="runtime.project_events"></a>
### 项目会话事件发布订阅与有界投递观察

`runtime.project_events` · 运行后端与演进 · 源码交付

入口：项目组装与事件脚本→冻结协议3工程→绑定访问订阅／发布→延迟FIFO回执与跨访问历史→发布／订阅来源→工程ZIP交付

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **有界事件账本、收件预留与FIFO回执**；纯事件账本复用标量词汇，独立校验完整预算／token归属／回执顺序；不持有引擎回调。 | 4 / 3 / 3 / 2 | [docs/test-results/project-events/core-results\.json](../docs/test-results/project-events/core-results.json)、[docs/test-results/project-events/ui-results\.json](../docs/test-results/project-events/ui-results.json)、[docs/test-results/project-events/script-starters\.log](../docs/test-results/project-events/script-starters.log) |
| 可移植 JS 语义 | **项目协议3事件准入与冻结双方来源**；项目封装接受明确协议3与当前ready绑定，将发送／订阅来源分别从冻结声明解析。 | 4 / 3 / 3 / 2 | [docs/test-results/project-events/core-results\.json](../docs/test-results/project-events/core-results.json)、[docs/test-results/project-events/ui-results\.json](../docs/test-results/project-events/ui-results.json)、[docs/test-results/project-events/script-starters\.log](../docs/test-results/project-events/script-starters.log) |
| 可移植 JS 语义 | **完整事件历史及当前访问的纯观察查询**；严格DTO保留128条完整历史，pending只属于最后ready访问，旧协议保持且不执行getter。 | 4 / 3 / 3 / 2 | [docs/test-results/project-events/core-results\.json](../docs/test-results/project-events/core-results.json)、[docs/test-results/project-events/ui-results\.json](../docs/test-results/project-events/ui-results.json)、[docs/test-results/project-events/script-starters\.log](../docs/test-results/project-events/script-starters.log) |
| 执行后端 | **Godot独立订阅队列与同步回调失败隔离**；后端独立事件模块持有订阅与回调，根协调器只驱动访问及先排空再切换／关闭。 | 4 / 3 / 3 / 2 | [docs/test-results/project-events/core-results\.json](../docs/test-results/project-events/core-results.json)、[docs/test-results/project-events/ui-results\.json](../docs/test-results/project-events/ui-results.json)、[docs/test-results/project-events/script-starters\.log](../docs/test-results/project-events/script-starters.log) |
| 交互与渲染 | **独立三语事件历史、回执与双方来源导航**；事件面板只消费准入结果，保留作者名称／载荷、收件结果及原始双方声明来源。 | 4 / 3 / 3 / 2 | [docs/test-results/project-events/core-results\.json](../docs/test-results/project-events/core-results.json)、[docs/test-results/project-events/ui-results\.json](../docs/test-results/project-events/ui-results.json)、[docs/test-results/project-events/script-starters\.log](../docs/test-results/project-events/script-starters.log) |
| 本机服务与适配 | **冻结项目协议选择与宿主共享状态读取**；复用宿主冻结协议选择和project inspect；以真实服务集成验证协议3，不新造状态权威。 | 4 / 3 / 3 / 2 | [docs/test-results/project-events/core-results\.json](../docs/test-results/project-events/core-results.json)、[docs/test-results/project-events/ui-results\.json](../docs/test-results/project-events/ui-results.json)、[docs/test-results/project-events/script-starters\.log](../docs/test-results/project-events/script-starters.log) |
| 可移植 JS 语义 | **已知脚本起始内容与纯草稿提案**；复用脚本起始草稿机制添加项目事件示例，不取得保存／绑定／执行权限。 | 4 / 3 / 3 / 2 | [docs/test-results/project-events/core-results\.json](../docs/test-results/project-events/core-results.json)、[docs/test-results/project-events/ui-results\.json](../docs/test-results/project-events/ui-results.json)、[docs/test-results/project-events/script-starters\.log](../docs/test-results/project-events/script-starters.log) |

平台：Linux本机HTTP编辑器、真实Chrome与Godot 4无头／窗口；桌面／移动资源副本一致性分别记录、0.1.4源码交付；未更新安装；Android及其他桌面目标设备、独立游戏发行未验收。边界：作者组装schema1、project plan1与旧scene1／2／3事件保持；新项目runtime protocol3显式增加发布／投递帧和eventSequence，纯reader／observer仍默认1且显式支持旧1／2，不从stdout猜协议。Godot适配器0.10.0与生成清单4属于后端格式。；会话事件接口仅subscribe_event(name,callback)、unsubscribe_event(id)、publish_event(name,value)。订阅属于当前visit及行为绑定，编号1至1024全会话稳定；离场撤销、不向后续订阅或新场景重放，新的运行从空会话开始。；事件名与载荷复用有界共享状态键／标量规则；最多64活跃订阅、1024累计登记、128发布、1024预留投递、64待处理消息、16384待处理字节、524288累计载荷字节。发布候选先全量验证并预留，拒绝不消耗序号或token归属；无收件发布即时完成且不占待处理队列。；发布捕获按订阅编号升序的收件快照；延迟FIFO逐消息逐收件分发，回调中发布排队尾，不递归调用。撤销后尚未开始的投递标skipped；已开始回调自行撤销仍按返回结果判定。排空队列后才执行切场景或普通窗口关闭，宿主取消可保留pending。；回调必须属于同一行为实例、仅接受一个载荷并同步返回严格true；void、false、运行错误、失效Callable或async均诊断失败。Godot独立同步调用层隔离直接调用中断，不制造handled；失败前共享状态及作者副作用不回滚。 订阅去重显式比较绑定参数的类型和值及解绑参数数，避免Godot原生Callable相等比较合并不同部分绑定。；event-publish由全局sequence、name、value、冻结sender tuple及ordered recipients组成；event-delivery只引用当前visit／scene、sequence、subscriptionId与handled／skipped。纯reader按冻结绑定解析各自来源，禁止wire路径；校验FIFO与每个token的name／origin稳定性，但不独立证明后端实际执行作者回调。；skipped回执证明订阅已撤销，纯reader禁止之后的新发布再次捕获该token或伪造handled；先前已排队记录仍可skipped。DTO不含发布与回执交错时间，只验证能证明的状态顺序，不补造历史时序。；完整有界DTO project.events保留最多128消息的发送origin和收件origin／status，过滤演员不删历史；只有最后ready访问能保留pending。source仍为原始binding声明，真实声明是/bindings/N且无sourceRange，不补造精确选区。；独立DTO完整来源契约也接受受限sourceRange；trace专用16 MiB、protocol3观察专用24 MiB只复制有界数据，以data descriptor选协议且不执行getter。覆盖128消息／1024收件、三个来源字段各4096字符及大合法child；旧帧和protocol1／2复制上限不变。；独立三语事件面板消费准入DTO，显示作者原文、发布／收件身份及pending／handled／skipped；来源导航受当前会话／visit和目标记录身份保护，回执状态或记录变化不能复活过期票据。共享状态面板独立保留。；复用已冻结backend.protocolVersion的宿主选择与既有构建／读取／ZIP路径，不放宽生成字节或适配器指纹；旧本机缓存需重建，旧独立工程与纯协议读取边界分别保留。21模块／40声明能力保持，无持久事件日志、异步回调、网络总线、存档、动态成员或Bevy项目执行。；最终核心126／UI99／starter40／真实host7通过；Godot85项83通过／2旧条件跳过。Chrome六组／十图／125执行源码保持，A→B→A六发布／五handled／两skipped及state8，三语390px、真实窗口、双方来源文档与107048字节ZIP／25文件／2媒体异地通过；准备89比对／4调用，7310历史文件及安装保持。最终常规全应用5228项5069通过／159工具条件跳过／0失败，886份JS及API／版本预检通过；带Godot完整检查点的1项旧取消竞态原样保留，按ready取消修正后真实定向7／7，不冒充启用工具全套重跑，各专项重叠不相加。。

下一步：先在明确会话范围内维护兼容和失败边界；持久事件日志、异步处理、跨启动存档和其他后端分别设计，不扩展为隐式全局总线。

<a id="runtime.project_audio_controls"></a>
### 行为驱动项目音轨播放停止与实际命令观察

`runtime.project_audio_controls` · 运行后端与演进 · 源码交付

入口：已登记声音与行为→可空提示／事件声音起始脚本→冻结协议4项目→有界播放停止请求→实际执行回执及双方来源→工程交付

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **有界实际音轨命令账本与双来源**；纯账本保存已执行回执，验证序号／轨道归属／局部时间／双来源，不调用设备或预测播放。 | 4 / 4 / 3 / 2 | [docs/test-results/project-audio-controls/core-results\.json](../docs/test-results/project-audio-controls/core-results.json)、[docs/test-results/project-audio-controls/ui-results\.json](../docs/test-results/project-audio-controls/ui-results.json)、[docs/test-results/project-audio-controls/rust-full\.log](../docs/test-results/project-audio-controls/rust-full.log) |
| 可移植 JS 语义 | **项目协议4声音回执与提示前缀准入**；冻结当前行为和音轨，验证旧cue前缀、失败与结束屏障；旧线格式保持。 | 4 / 4 / 3 / 2 | [docs/test-results/project-audio-controls/core-results\.json](../docs/test-results/project-audio-controls/core-results.json)、[docs/test-results/project-audio-controls/ui-results\.json](../docs/test-results/project-audio-controls/ui-results.json)、[docs/test-results/project-audio-controls/rust-full\.log](../docs/test-results/project-audio-controls/rust-full.log) |
| 可移植 JS 语义 | **声音命令历史与完整最大DTO查询**；只读query按访问历史校验命令时间，保留双方来源与原事件／状态；仅新观察有新预算。 | 4 / 4 / 3 / 2 | [docs/test-results/project-audio-controls/core-results\.json](../docs/test-results/project-audio-controls/core-results.json)、[docs/test-results/project-audio-controls/ui-results\.json](../docs/test-results/project-audio-controls/ui-results.json)、[docs/test-results/project-audio-controls/rust-full\.log](../docs/test-results/project-audio-controls/rust-full.log) |
| 执行后端 | **Godot项目声音请求队列与播放器桥接**；后端队列在audio ready和事件排空后调用现有播放器，实际调用后才发中立回执。 | 4 / 4 / 3 / 2 | [docs/test-results/project-audio-controls/core-results\.json](../docs/test-results/project-audio-controls/core-results.json)、[docs/test-results/project-audio-controls/ui-results\.json](../docs/test-results/project-audio-controls/ui-results.json)、[docs/test-results/project-audio-controls/rust-full\.log](../docs/test-results/project-audio-controls/rust-full.log) |
| 交互与渲染 | **独立三语声音命令与两类来源观察**；面板只消费准入回执，行为／音轨来源分别守护；不暴露运行控制权限。 | 4 / 4 / 3 / 2 | [docs/test-results/project-audio-controls/core-results\.json](../docs/test-results/project-audio-controls/core-results.json)、[docs/test-results/project-audio-controls/ui-results\.json](../docs/test-results/project-audio-controls/ui-results.json)、[docs/test-results/project-audio-controls/rust-full\.log](../docs/test-results/project-audio-controls/rust-full.log) |
| 共享 Rust 核心 | **Rust独立音轨与时间提示规则**；复用共享Rust声音规则允许空提示，作者非空声明语义与ABI保持。 | 4 / 4 / 3 / 2 | [docs/test-results/project-audio-controls/core-results\.json](../docs/test-results/project-audio-controls/core-results.json)、[docs/test-results/project-audio-controls/ui-results\.json](../docs/test-results/project-audio-controls/ui-results.json)、[docs/test-results/project-audio-controls/rust-full\.log](../docs/test-results/project-audio-controls/rust-full.log) |
| 可移植 JS 语义 | **场景声音可选WASM能力桥**；已有可选WASM桥严格承接空提示回执，不增加JS声音规则替代。 | 4 / 4 / 3 / 2 | [docs/test-results/project-audio-controls/core-results\.json](../docs/test-results/project-audio-controls/core-results.json)、[docs/test-results/project-audio-controls/ui-results\.json](../docs/test-results/project-audio-controls/ui-results.json)、[docs/test-results/project-audio-controls/rust-full\.log](../docs/test-results/project-audio-controls/rust-full.log) |
| 本机服务与适配 | **冻结项目协议选择与宿主共享状态读取**；复用宿主冻结协议分派及读取，项目4接线不新建另一份运行模型。 | 4 / 4 / 3 / 2 | [docs/test-results/project-audio-controls/core-results\.json](../docs/test-results/project-audio-controls/core-results.json)、[docs/test-results/project-audio-controls/ui-results\.json](../docs/test-results/project-audio-controls/ui-results.json)、[docs/test-results/project-audio-controls/rust-full\.log](../docs/test-results/project-audio-controls/rust-full.log) |
| 可移植 JS 语义 | **已知脚本起始内容与纯草稿提案**；复用原脚本草稿机制补事件声音起始内容，不取得播放／保存／绑定权限。 | 4 / 4 / 3 / 2 | [docs/test-results/project-audio-controls/core-results\.json](../docs/test-results/project-audio-controls/core-results.json)、[docs/test-results/project-audio-controls/ui-results\.json](../docs/test-results/project-audio-controls/ui-results.json)、[docs/test-results/project-audio-controls/rust-full\.log](../docs/test-results/project-audio-controls/rust-full.log) |

平台：Linux本机HTTP编辑器与真实Chrome／Godot 4；桌面及移动准备副本按98项字节对照和4组实际调用验证、0.1.4源码交付；未更新安装，Android及其他系统目标设备、物理扬声器与独立发行未验收。边界：仅项目行为端口新增play_audio(trackId)／stop_audio(trackId)，轨道必须属于当前访问冻结声音声明；无播放器、Godot Node、资源路径或设备句柄穿过纯核心与UI。旧访问静默拒绝，同次请求返回true只表示队列受理，不等于已播放。；新project protocol4增加audio-command与ready／finished.audioCommandSequence，作者组装及project plan1、旧scene1／2／3与AUDIO1提示流保持。纯调用默认protocol1，显式保留旧1／2／3；Godot0.11.0生成清单5与project.audio-control属于后端能力，不增系统模块／声明能力。；每运行最多256次受理请求、64条待执行；合法候选先完整核验并预留。每次play重启、stop幂等但都记实际调用回执，拒绝不消耗序号或预算。未知轨道／非法输入在调用行为处诊断失败；不向后来访问或新运行转移请求。；行为_ready可能早于音轨初始化；独立声音队列在完整初始化、audio ready及t0提示后执行。安全点先排空事件队列再顺序执行声音请求，两队列完成后才切场景或正常结束；取消／失败不伪造未执行回执。离场统一停止播放器，历史命令不表明音轨仍在播放。；中立线帧严格核对全局commandSequence、当前visit／scene／binding／instance／object、track／resource、play／stop及有限局部timeSeconds。来源仅由冻结行为与音轨各自声明解析，wire禁止路径／范围注入；失败或音频finished后拒新回执。；同访问命令时间非减，旧提示已准入数量必须等于冻结atSeconds<=命令时间的数量，scene-exit核对最后命令不晚于实际声音与访问结束。进行中不独立证明物理调用瞬间／设备播放；仍由宿主判定取消及失败，不把一次命令当自然结束或音量状态。；DTO project.audioCommands保留最多256条完整回执，分别含原始行为origin和track的轨道／资源／来源；查询演员不删历史，原访问身份不会替换为当前同轨对象。音轨真实sourceRange原样保留，行为无范围时只承诺文档／字段回源。；声音账本沿既有8 MiB数据复制边界；最大完整双来源、事件／状态／场景观察叠加由protocol4专用32 MiB约束覆盖，旧protocol1／2／3预算保持。所有选择按data descriptor，不调用getter。；Rust声声明提示范围从1–64扩展为0–64，仍1–16轨道且原非空语义不变，schema1与ABI保持；WASM桥严格回执同步接受空提示，没有JS声音规则替代。纯行为音轨可原文设cues:[]，首次创建也可逐轨选择行为触发；0.1.4后可在独立声音面板移除全部提示后普通保存。定时新建默认生成播放提示；旧安装可能仍拒空提示。；独立三语只读面板只显示实际执行的播放／停止命令、局部时间与两种冻结来源，保留历史筛选，来源票据随任务／访问／目标变化失效。事件与状态观察保持独立；脚本起始内容仍走普通草稿审阅、保存与绑定。；旧单场景生成字节保留；宿主继续按已验证冻结后端协议选择reader／observer，不放宽生成指纹。既有本机构建遇指纹变化需重建；旧独立ZIP保留自身代码。无空间声音、混音总线、暂停／跳转、实时音量、自然结束观察、Bevy声音或独立发行。；本轮核心149／UI133、共享Rust335及native声音9通过；真实Godot新声音13、相邻回归65、宿主8通过；Chrome六组11图核对A→B→A的8条实际命令、6次事件发布和状态修订8，双轨真实范围回源及异地工程再运行。完整常规应用5284项中5128通过、156条件跳过；897 JS与API／版本预检通过。各组合重叠不相加，准备副本与混音缓冲不推导安装或物理设备验收。。

下一步：按明确声音语义分别设计自然结束观察、暂停／跳转、空间音频与其他后端；不把实际命令回执扩展为隐式设备状态。

<a id="scene.audio_audition"></a>
### 已绑定声音素材的显式就地试听

`scene.audio_audition` · 创作与编辑 · 源码交付

入口：已有声音JSON→读取已绑定WAV→显式试听→新目录与本次字节核验→单轨WebAudio进度／暂停／继续／定位／停止

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **品牌化素材试听快照与共享PCM容器校验**；独立准备只验证fresh目录和本次有界size／hash／PCM字节副本；私有品牌和独立decoder副本不授予播放或保存权。 | 4 / 3 / 4 / 2 | [docs/test-results/scene-audio-audition/README\.md](../docs/test-results/scene-audio-audition/README.md)、[docs/RELEASE\_0\.1\.5\.md](../docs/RELEASE_0.1.5.md)、[docs/test-results/release-0\.1\.5/preflight\.json](../docs/test-results/release-0.1.5/preflight.json) |
| 交互与渲染 | **独立WebAudio单轨试听进度、暂停、定位与取消生命周期**；WebAudio单独管理显式激活、重采样预算、单轨gain／loop与进度／暂停／继续／定位；沿用验证缓冲，以owner及操作序号隔离迟到结果，不执行场景时间线。 | 4 / 3 / 4 / 2 | [docs/test-results/scene-audio-audition/README\.md](../docs/test-results/scene-audio-audition/README.md)、[docs/test-results/scene-audio-audition-transport/README\.md](../docs/test-results/scene-audio-audition-transport/README.md)、[docs/RELEASE\_0\.1\.5\.md](../docs/RELEASE_0.1.5.md) |
| 交互与渲染 | **稳定资源身份的受限HTTP字节读取**；受限读取只将选中稳定UUID映射到既有同源素材地址，有界完整响应、超时及取消由适配器负责。 | 4 / 3 / 4 / 2 | [docs/test-results/scene-audio-audition/README\.md](../docs/test-results/scene-audio-audition/README.md)、[docs/RELEASE\_0\.1\.5\.md](../docs/RELEASE_0.1.5.md)、[docs/test-results/release-0\.1\.5/preflight\.json](../docs/test-results/release-0.1.5/preflight.json) |
| 交互与渲染 | **声音来源／素材目录复核、普通草稿与试听准备宿主**；复用来源owner／token／修订与已绑定目录复核，独立试听准备端口不走草稿写入或普通Save。 | 4 / 3 / 4 / 2 | [docs/test-results/scene-audio-audition/README\.md](../docs/test-results/scene-audio-audition/README.md)、[docs/RELEASE\_0\.1\.5\.md](../docs/RELEASE_0.1.5.md)、[docs/test-results/release-0\.1\.5/preflight\.json](../docs/test-results/release-0.1.5/preflight.json) |
| 交互与渲染 | **独立三语声音编辑表单与素材试听控制入口**；三语表单提供显式试听／暂停／继续／定位／停止，轻量进度不改表单或审阅；编辑、检查、应用、刷新、关闭及hidden释放包括暂停中的快照，语言切换保留。 | 4 / 3 / 4 / 2 | [docs/test-results/scene-audio-audition/README\.md](../docs/test-results/scene-audio-audition/README.md)、[docs/test-results/scene-audio-audition-transport/README\.md](../docs/test-results/scene-audio-audition-transport/README.md)、[docs/RELEASE\_0\.1\.5\.md](../docs/RELEASE_0.1.5.md) |

平台：Linux本机HTTP编辑器与真实Chrome／WebAudio；实际输出及异步边界见独立试听专题、未更新安装；Android尚无目录／素材读取接口，不推导物理扬声器、其他浏览器或设备支持。边界：只从当前有效品牌目录选择已绑定WAV，沿既有Scene2D schema2／3唯一audio关联、完整已保存依赖检查及全工程256份符合条件候选上限；不导入、登记、绑定、删除或改写资源。；prepareSceneAudioAudition同步捕获source五字段；getResources重新读取不同实例的fresh品牌目录并比较完整创建DTO，包含World／对象／来源、未绑定候选及metadata附注。随后只读所选稳定资源ID，逐await检查owner与abort。；本次Uint8Array副本必须与登记大小和SHA-256一致且至多32MiB，再用原样迁移的共享PCM16单／双声道8–96kHz容器规则验证；私有WeakMap保存字节，公开冻结描述只含身份／名称／声道／采样率／帧数／时长，decoder每次获得新ArrayBuffer。目录继续unverified，不声称持续核对磁盘。；受限HTTP适配器只生成现有/asset-files/<UUID>地址，不接受任意URL／路径；限制完整响应、流式字节数、超时和取消，无新服务路由。浏览器播放与来源宿主分开，字节摘要端口不复用文本编码摘要。；独立WebAudio适配器仅在显式点击时resume，验证后decodeAudioData，经GainNode使用当前0–1音量，AudioBufferSourceNode使用当前整素材loop；一次一轨，零音量保持静音。解码前按输出重采样率估算float32内存至多128MiB，实际decode串行；不使用Blob URL或放宽CSP。；进度、pause／resume／seek属于同一次临时试听，AudioContext时钟派生位置；暂停保留已校验缓冲，继续和定位不重读或重复解码。非循环seek末尾统一paused、显式resume从头；循环末尾归零；resuming期间pause／seek拒绝、stop可用。旧节点结束与迟到resume按owner／操作序号丢弃，停止释放快照。；编辑、重新读取目录、检查、应用、关闭及页面hidden停止并释放暂停中的快照；迟到resume／读取／解码及旧节点结束不得影响新状态，语言切换保留表单与试听。未提供接口或WebAudio不可用时试听不可用，旧编辑继续。；本功能不执行cues、行为、场景时钟或Godot／Bevy，不写草稿、正文、metadata或素材；五种已有声音提案及普通Save契约不变。复用既有模块和i314来源宿主、i315三语表单；21模块／40声明能力、Rust语义／ABI、Godot0.11.0和项目协议4保持。；本机Chrome／WebAudio输出和接口集成按独立专题记录，不把浏览器输出当物理扬声器或引擎设备验收。本轮只扩展播放器和表单控制，证据见scene-audio-audition-transport；不改PCM／Godot。此前共享校验器指纹调整与真实Godot回归仍属于scene-audio-audition专题，旧结果不改标本轮重跑。；0.1.5收录本功能的0.1.4后工作树增量；发布检查见release-0.1.5，历史专题及评分按原范围保留，不把源码交付推导为安装、设备或新增后端执行验收。。

下一步：按独立需求继续设计场景时间提示预览或更多设备适配；保持单素材试听与场景／后端执行、文件保存及持续资源监测分离。

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

只改说明／评分而来源未变时可用 `--write`。检查包括 ID／坐标唯一性、文件路径、已发布／未发布评分门槛、四维完整性、工作流步骤／缺口和优先项的引用及唯一性、旧 50 链映射、源码及证据指纹、派生视图一致性。它不证明评分正确或产品测试通过，也不能自动发现目录外新增功能；每次新增能力需人工补图并核对 [STATUS](STATUS.md) 与 [ROADMAP](ROADMAP.md)。报告路径是仓库相对路径，不读取作者工程或本机配置。交互页内嵌同一数据，可脱机筛选和点开证据；单独复制 HTML 后仍可浏览，但源码链接需保持仓库相对布局。

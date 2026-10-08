# 当前功能图谱：架构、功能、实现与成熟度

核对日期：**2026-10-08**。源码版本 **0.0.9**；审查基线为提交 `d36baad631550a99593efe388cf84aa238b79c5f`，各项交付状态见下文。范围为本仓库已识别的能力与明确规划，不是全部未来功能的穷举，也不是运行时逐函数调用图。各项实测范围与执行条件见对应证据；源码验证不等于新安装包或设备验收。

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
| 功能 | 67 |
| 实现单元（含规划占位） | 142 |
| 已审查实现关系 | 248 |
| 显式评分单元 | 992 |
| 语义依赖边 | 146 |
| 工作流切片 | 30 |
| 旧链路已映射 | 50 |
| 引用并校验指纹的文件 | 597 |

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
| 执行后端 | Godot生成/运行与显式GDScript绑定；独立Bevy无头ECS程序消费中立计划与事件，能力分别声明；原生路线另列。 |
| 工程定义与格式 | 模板包、类型、Schema、作者身份与持久格式。 |
| 构建与分发 | WASM/桌面/移动资源准备、源码归档和生成物清理。 |
| 验证与维护 | 契约检查、回归工具、证据与遗留维护边界。 |

## 当前优先缺口

1. **从单实例覆盖推进共享片段与继承编辑**：配方保存/迁移、贡献预览及六字段单实例set已接通，精确补丁仅应用当前原文草稿并普通保存；共享片段编辑、删除覆盖/恢复继承及跨视图历史仍为空白。 验收：分别定义共享模板、删除覆盖/恢复继承和画布拖动的稳定目标、基线、撤销与保存，保留作者原字节/依赖；嵌套/跨文件、空间变换及规模分别验收。 涉及 [文件内场景片段、配方预览、单实例覆盖与迁移实验](#scene.composition)、[Scene2D v3 逻辑分组、共享大纲与后代选择](#scene.groups_v3)、[文本驱动场景、定义/实例分离与场景树](#scene.text_instances)、[场景来源模型与修订守护的原文定位](#scene.source_model)。
2. **在单源补丁之后继续下沉完整语义**：Rust已承接布局/历史/保存阶段，以及source-only严格JSON结构与数值补丁；完整作者模型、投影继承、来源导航和World规划仍JS。 验收：逐条对照既有JS完整语义与源码/注册/恢复契约，保持BOM/行尾、UUID、来源范围及事务兼容，不把受限source检查冒充完整模型。 涉及 [解析、字段与 World 规划下沉 Rust](#core.semantic_migration)。
3. **完善已接通的GDScript行为创作**：显式清单、参数/信号、冻结执行、诊断与迁移已接通；作者表单、动态解绑/热更新及规模验证仍需独立设计，Bevy第二后端已接无图ECS数据计划，作者Rust行为仍未实现。 当前只读实例观察已接通，连续采样与反射仍独立。 有限方向回放与固定步采样已接入；连续实时通道与反射仍需独立设计。 按实例有限方向现已独立接入，每步未列释放、目标与双预算明确；仍不是实时对象编辑。 验收：保留实例/绑定稳定身份、类型检查、来源和依赖闭包；参数辅助与生命周期变更分别验收，按真实两引擎共同需求逐项验证Rust行为与运行资源。 涉及 [场景实例的GDScript参数、信号与冻结迁移](#behavior.scene_runtime)、[执行后端能力、可信注册与通用编排](#execution.backend_middleware)、[Bevy/Rust 无头第二后端](#runtime.bevy_rust)、[运行对象、位置采样与冻结来源只读观察](#runtime.objects_inspection)、[有限方向程序、跨后端回放与完整步骤采样](#runtime.control_replay)、[按实例独立有限输入与稀疏步骤路由](#runtime.instance_control)。
4. **补真实交付与目标平台证据**：Rust布局、来源/实例/分组、单源草稿预览及坐标回写已纳入0.0.7源码并保留专题证据；对应Tauri安装产物与目标WebView仍需实测。 验收：对对应实际安装包重跑Linux关键流程及Android设备范围；Windows/macOS单独验收。 涉及 [源码、桌面与移动资源交付](#delivery.packaging)、[Android 无 Node 编辑宿主](#host.android-editing)、[Rust布局草稿、原子批次与撤销历史](#core.history_migration)、[布局草稿、多选与显式事务保存](#scene.layout_draft)、[Rust布局检查、保存与未知结果工作流](#core.save_state_migration)、[Scene2D v2 独立实例与定义复用](#scene.instances_v2)、[Scene2D v3 逻辑分组、共享大纲与后代选择](#scene.groups_v3)、[当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview)、[当前源码草稿的布局调整与精确回写](#scene.source_layout)。

## 业务工作流

| 路径 | 功能步骤 | 适用边界 |
| --- | --- | --- |
| 工程创建与日常创作 | [作品库、起始模板与最近工程](#host.library) → [五类独立工程起始模板包](#project.starter-packs) → [工程自定义类型、解析规则与文档模板](#project.type-templates) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [通用解析、静态索引与阅读](#authoring.parse-index) | 桌面与本机编辑；Android支持其中编辑/模板子集。 |
| 字段与语义变更 | [字段表原位保真编辑](#authoring.field-edit) → [World／Object／Resource 观察投影与查询](#world.query) → [单对象单属性语义修改](#world.property-set) → [批量属性提交、读取屏障与崩溃恢复](#world.changeset) → [通用解析、静态索引与阅读](#authoring.parse-index) | 当前批次只改既有对象属性；不是通用混合事务。 |
| 身份、关系和资源 | [新对象正文与登记共同创建](#world.object-create) → [引用／共享归属关系追加](#world.relation-add) → [为对象追加已登记素材用途](#world.resource-bind) → [World／Object／Resource 观察投影与查询](#world.query) | 各命令独立提交；不要把该顺序解释成一个原子批次。 |
| 一个OC的多用途投影 | [新对象正文与登记共同创建](#world.object-create) → [同一 OC 的子模板及多份用途投影创建／编辑](#projection.authoring) → [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) | 投影是独立作者定义；当前工作树v2允许同一投影的多个实例，v1保留原限制与显式升级。 |
| 预览、布局和保真保存 | [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [Scene2D v3 逻辑分组、共享大纲与后代选择](#scene.groups_v3) → [无需引擎的已保存场景预览](#scene.saved_preview) → [共享 Rust 布局规则与原子位置校验](#core.layout_rust) → [Rust布局草稿、原子批次与撤销历史](#core.history_migration) → [Rust 核心 WASM 接入与分发资源](#core.wasm_bridge) → [Rust布局检查、保存与未知结果工作流](#core.save_state_migration) → [布局草稿、多选与显式事务保存](#scene.layout_draft) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) | 逻辑组后代选择映射为既有实例批次；Rust管位置/历史/保存阶段，JS保留作者组结构及实际事务，非组空间变换或设备验收。 只从保存态进入布局；原文只读草稿预览另列独立工作流。 |
| 构建与真实Godot运行 | [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [Godot 4 工程生成与运行协议](#runtime.godot_generated_project) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) | Linux本机服务；旧v1/v2冻结重放保持，显式行为plan3另列行为工作流。0.0.8源码中间层严格区分能力/可信host/具体Godot；没有独立游戏发行，descriptor变化需重新批准。 |
| 媒体创作与原始资源取回 | [图片／视频／音频导入、引用、草稿预览与播放](#media.embed-play) → [为对象追加已登记素材用途](#world.resource-bind) → [单个登记素材原始字节再导出](#resource.original-export) → [导出准备、下载、原生保存及清理](#export.jobs-delivery) | 原文件导出不转码；登记和媒体播放各有验证范围。 |
| 跨工程复用与完整迁移 | [选择式资源包依赖闭包、冲突预览与追加导入](#resource.package) → [完整工程归档和恢复](#storage.full-archive) → [Android SAF 完整工程迁移](#host.android-transfer) | 选择包是复用，完整包是迁移；Android只接完整包。 |
| 阅读分享与下载生命周期 | [通用解析、静态索引与阅读](#authoring.parse-index) → [文档阅读分享包与受控下载生命周期](#export.document-share) → [导出准备、下载、原生保存及清理](#export.jobs-delivery) | 可取消/清理与原生保存回执；不替代工程备份。 |
| Android离线编辑与恢复 | [Android 无 Node 编辑宿主](#host.android-editing) → [Android 草稿和新建恢复](#host.android-draft-recovery) → [Android SAF 完整工程迁移](#host.android-transfer) | 无Node；未接媒体/World/场景构建；模拟器不等于真机。 |
| 源码验证、打包和清理 | [契约检查、回归与证据保存](#quality.validation-support) → [Rust 核心 WASM 接入与分发资源](#core.wasm_bridge) → [源码、桌面与移动资源交付](#delivery.packaging) → [构建缓存与磁盘清理](#delivery.generated-cleanup) | 构建准备和源码验证不能自动获得安装/多平台成熟度。 |
| 后续文本实例与行为 | [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [Scene2D v3 逻辑分组、共享大纲与后代选择](#scene.groups_v3) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [文本驱动场景、定义/实例分离与场景树](#scene.text_instances) → [GDScript 行为绑定历史探针](#behavior.gdscript_binding) → [Bevy/Rust 无头第二后端](#runtime.bevy_rust) | 稳定实例/分组、原文预览/回写和GDScript绑定已有切片；Bevy只接无图ECS计划，空间/剧本与Rust作者行为仍规划；历史探针原条件保留。 |
| 共享核心持续下沉 | [共享 Rust 布局规则与原子位置校验](#core.layout_rust) → [Rust布局草稿、原子批次与撤销历史](#core.history_migration) → [Rust布局检查、保存与未知结果工作流](#core.save_state_migration) → [解析、字段与 World 规划下沉 Rust](#core.semantic_migration) | 几何、草稿历史与保存状态已接通；来源模型/解析和World语义规划仍待迁移。 |
| 场景字段到修订匹配的作者原文 | [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [场景来源模型与修订守护的原文定位](#scene.source_model) → [无需引擎的已保存场景预览](#scene.saved_preview) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) | 保存态来源读取并匹配磁盘修订；显式草稿来源只匹配当前编辑器文本hash。声明/组名与共享定义分别定位，迟到/过期/近似位置不盲跳，来源切换不覆盖草稿。 |
| 共享定义的多实例创作、运行与迁移 | [同一 OC 的子模板及多份用途投影创建／编辑](#projection.authoring) → [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [场景来源模型与修订守护的原文定位](#scene.source_model) → [无需引擎的已保存场景预览](#scene.saved_preview) → [布局草稿、多选与显式事务保存](#scene.layout_draft) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [Godot 4 工程生成与运行协议](#runtime.godot_generated_project) → [选择式资源包依赖闭包、冲突预览与追加导入](#resource.package) | 合成工程贯通独立身份、局部覆盖、冻结执行和资源包导入；定义/素材去重；v3逻辑树另见分组工作流，尚无片段/剧本事件。 |
| 逻辑分组创作、大纲导航与批量布局 | [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [Scene2D v3 逻辑分组、共享大纲与后代选择](#scene.groups_v3) → [场景来源模型与修订守护的原文定位](#scene.source_model) → [无需引擎的已保存场景预览](#scene.saved_preview) → [Rust布局草稿、原子批次与撤销历史](#core.history_migration) → [布局草稿、多选与显式事务保存](#scene.layout_draft) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [Godot 4 工程生成与运行协议](#runtime.godot_generated_project) → [选择式资源包依赖闭包、冲突预览与追加导入](#resource.package) | 启用作者v3后显式保存组与归属；大纲过滤/后代选择沿用稳定实例，位置编辑和迁移保留组，构建剥离组织结构复用plan2。没有空间变换继承、片段或剧本事件。 |
| 场景原文草稿、只读预览与来源往返 | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [场景来源模型与修订守护的原文定位](#scene.source_model) | 单份已登记场景源码经128KiB/磁盘基线校验后只读预览；依赖仍取保存态登记。精确来源回到原编辑器，错误保留有效画面；本地源码布局回写为另一个明确分支，不授予World事务保存。 |
| 场景源码草稿、局部布局与普通保存 | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [Rust布局草稿、原子批次与撤销历史](#core.history_migration) → [当前源码草稿的布局调整与精确回写](#scene.source_layout) | 仅源码模式/单scene：Rust strict inspect→有效预览/hash绑定→Rust几何与局部历史→Rust精确scalar proposal→宿主复核后内存应用→主编辑器普通保存。source操作无状态且不读写磁盘；取消不改文本，应用不重置保存基线，无World命令/构建/统一undo。 |
| 配方预览、单实例覆盖原文草稿与保存迁移 | [新对象正文与登记共同创建](#world.object-create) → [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [文件内场景片段、配方预览、单实例覆盖与迁移实验](#scene.composition) → [当前场景原文草稿的只读预览与精确定位](#scene.text_draft_preview) → [场景来源模型与修订守护的原文定位](#scene.source_model) → [选择式资源包依赖闭包、冲突预览与追加导入](#resource.package) | 普通JSON登记/源码保存→Rust展开与依赖→saved/draft预览/贡献导航→当前源的稳定目标六字段set提案→完整候选检查→live复核后内存应用→普通保存→资源包迁移作者字节。预览无snapshot/sceneEditing，不改共享片段/其他放置；CLI输出v3可另行登记构建，生成编辑不回写recipe。 |
| 显式能力到冻结后端执行 | [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [Godot 4 工程生成与运行协议](#runtime.godot_generated_project) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) | 保存态输入→纯descriptor→可信registry→Godot或Bevy独立adapter→指纹与冻结回放；Godot图片/窗口/显式GDScript与Bevy无图headless分别验收，无原生/离屏/内嵌/GPU。 |
| 实例行为从作者原文到事件、诊断与迁移 | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [引用／共享归属关系追加](#world.relation-add) → [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [场景实例的GDScript参数、信号与冻结迁移](#behavior.scene_runtime) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [选择式资源包依赖闭包、冲突预览与追加导入](#resource.package) | 普通JSON/TXT+显式关系→严格plan3→冻结构建→Godot独立Node/参数/信号→可信事件/源诊断→选择包或完整迁移。静态预览不校验行为；生成物和事件不回写作者文本，无RPC/热更新/移动执行器。 |
| 同计划双引擎：Bevy数据构建与无头回放 | [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [Bevy/Rust 无头第二后端](#runtime.bevy_rust) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) | 同定义两实例无图plan2→显式CLI/host backend与可信tool→scene-check→Bevy ECS固定步/中立事件→冻结源离线回放。Godot同plan比较，不跨译作者脚本；HTTP不收新路径/代码，无window/image/作者Rust/GPU。 |
| 运行对象样本→稳定实例检索→冻结声明来源 | [Scene2D v2 独立实例与定义复用](#scene.instances_v2) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [运行对象、位置采样与冻结来源只读观察](#runtime.objects_inspection) | 已验证冻结构建→Godot/Bevy既有准入事件→完整runtime视图与ownedinspect→本地检索/阶段提示/source守护；state使旧位置失效，cancel/error留样本，无RPC/连续采样/作者回写。 |
| 冻结构建→有限方向程序→两引擎步骤采样→只读对象观察 | [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [有限方向程序、跨后端回放与完整步骤采样](#runtime.control_replay) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [运行对象、位置采样与冻结来源只读观察](#runtime.objects_inspection) | 有限headless无行为plan1/2，程序/联合预算与SHA捕获，adapter暂存/清理，runtime原序ready/state/trace/finished与独立对象视图；不能跨译脚本或回写作者数据，无RPC/实时输入/渲染。 |
| 冻结plan2→独立实例输入→每步释放→全体样本观察 | [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [有限方向程序、跨后端回放与完整步骤采样](#runtime.control_replay) → [按实例独立有限输入与稀疏步骤路由](#runtime.instance_control) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) → [运行对象、位置采样与冻结来源只读观察](#runtime.objects_inspection) | owned冻结实例目标→显式示例或严格JSON→dualcap/版本/输入行/actorssteps预算→Godot/Bevy各自按实例路由且每步未列释放→原schema1完整trace/observer；不回写作者、不接实时或RPC。 |
| 可选显式工具检查→计划批准→运行前重新核对 | [可信工具身份检查、状态DTO与候选失效](#execution.tool_identity) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [构建工作台、诊断、取消与进程回收](#build.workbench_lifecycle) | GET无进程→显式固定工具identify→中立只读状态；ready只说明检查时身份，后续用户仍显式批准场景/构建，执行重新识别并核对冻结来源/产物/工具。检查不写作者/生成输出，不覆盖旧job/样本；0.0.8之后未发布，无新安装/设备。 |
| 有限输入＋预期→冻结实例采样→独立验收结果 | [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [有限方向程序、跨后端回放与完整步骤采样](#runtime.control_replay) → [有限运行验收用例与步骤预期评判](#runtime.verification_cases) → [运行对象、位置采样与冻结来源只读观察](#runtime.objects_inspection) | 显式case或从owned完整采样生成末步预期；host真实完成，pure逐步实例检查，assertion failed与execution failed分开；不完整不判passed，作者和原产物不改。 |
| 验收草稿→明确保存/载入→稳定身份迁移→同场景冻结重跑 | [源码／分段草稿、创建、保存与冲突](#authoring.document-edit) → [稳定身份、登记、归属及历史背景迁移](#identity.registration-ownership) → [工程验收用例保存、重用与稳定身份迁移](#runtime.case_documents) → [选择式资源包依赖闭包、冲突预览与追加导入](#resource.package) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [有限运行验收用例与步骤预期评判](#runtime.verification_cases) | 作者文档fresh字节与双修订保护；包/完整迁移保留UUID和正文；frozen场景绑定提前检查，离线仅已有loaded纯case，不做批量或安装/Android引擎。 |
| 保存用例→有序组→全部准入→顺序执行/取消→独立汇总 | [工程验收用例保存、重用与稳定身份迁移](#runtime.case_documents) → [同场景有序验收组与宿主批次调度](#runtime.case_suites) → [冻结输入、可移植计划与能力检查](#build.snapshot_plan) → [执行后端能力、可信注册与通用编排](#execution.backend_middleware) → [有限运行验收用例与步骤预期评判](#runtime.verification_cases) → [选择式资源包依赖闭包、冲突预览与追加导入](#resource.package) | 先fresh捕获全部作者成员再分配owner；assertion fail继续/executionfail或cancel停余项，reap释放；mobile只pure、不升级安装/设备或旧评分。 |
| 当前有序组→committed成员→私有pin回读→逐步详情→显式JSON下载 | [同场景有序验收组与宿主批次调度](#runtime.case_suites) → [有限运行验收用例与步骤预期评判](#runtime.verification_cases) → [当前批次成员详情与独立报告导出](#runtime.case_reports) | 作者来源离线可读owned报告；新job/close使旧owner失效，不扫描历史，不自动改预期，mobile仅pure。 |

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

平台：桌面／本机浏览器；具体界面与安装验收分开。边界：选择对象及依赖闭包；验证、冲突预览、独立持久导入事务；保留 UUID、归属和原字节；只读服务只开放清单／导出；Android 未接入资源包 UI；导入恢复中的 fence 不能按缓存清理；外部改动停止恢复；旧功能图 50 条链未包含此能力；未发布配方增量按当前原文派生全部模板/覆盖依赖，读包/导入重验类别与清单完整性；不写作者metadata，失效配方可完整备份但不能选择式迁移。。

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
| 构建与分发 | **prepare.mjs / build.mjs 等**；开发构建/资源准备与源码归档：0.0.8明确两crate和四官方样例闭包、排除targets/作者数据；临时快照回读不等于最终commit压缩包或安装验收。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json) |
| 构建与分发 | **prepare.mjs**；开发时准备移动端离线静态资源及WASM；不提供Android场景运行入口。 | 4 / 4 / 3 / 3 | [docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json) |
| 验证与维护 | **desktop.yml / check.yml**；开发验证与维护工具；不属于作者运行语义。 | 3 / 1 / 3 / 3 | [docs/test-results/release-0.0.4/results.json](../docs/test-results/release-0.0.4/results.json)、[docs/test-results/release-0.0.6/results.json](../docs/test-results/release-0.0.6/results.json)、[docs/test-results/rust-studio-core/results.json](../docs/test-results/rust-studio-core/results.json) |

平台：开发与CI构建命令；非产品浏览器功能、当前Rust组合完成源码与资源验证，未验新安装包、Linux最近安装实测0.0.4；Windows/macOS与新Android包分别待验。边界：0.0.5–0.0.8均源码交付、无新安装包；资源准备或临时sourcearchive通过不能替代安装运行验收。；Windows/macOS原生验收未完成，Android发行签名未配置；CI手动触发只生成构件，不自动GitHub Release；共享Rust与累计场景/后端功能纳入0.0.8源码；本轮源码归档修复两crate与4官方样例闭包、所有crate target/作品排除，验证快照已删除，审计文案之后的最终Git提交不另冒充同一archive。。

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

平台：开发者CLI、自动化测试与CI配置、本地记录与CI运行结果分别取证。边界：测试总数不表示功能覆盖率；不同工具配置导致不同跳过数；当前轮次的工具、失败和跳过以bevy-backend/results.json为准；历史报告保留当时条件。；未验证的平台/尚未实现功能不能列为已测试。

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

平台：Linux本机编辑服务、新版Tauri窗口和Android未验收/未接入。边界：JSON范围、场景语义/投影继承与计划发射已分层；v1/v2作者对应plan1/2，v3逻辑组编译为plan2；来源/分组侧带信息不进入构建计划，原文仍进入冻结快照；仅 Scene2D 受限能力；尚未迁 Rust；不从任意故事正文自动推导可执行游戏；v2双身份冻结重放与v3逻辑组已纳入0.0.7源码；旧v1/v2计划、生成文件和后端摘要保持，v3仅使用现有v2运行协议；captureBuildSnapshot仍只读取保存文件且忽略未知draft选项；只读草稿捕获使用独立入口/身份域，不提供可执行快照或污染构建任务缓存。；未发布行为另列behavior.scene_runtime：已登记v2/v3 scene显式behavior关系才组合plan/runtime3，源码/清单进入冻结原文；旧无行为计划与所有静态预览保持原版本。。

下一步：保留已接行为依赖与旧格式重放，完善后续层次/片段的冻结输入和来源边界。

<a id="execution.backend_middleware"></a>
### 执行后端能力、可信注册与通用编排

`execution.backend_middleware` · 场景与构建 · 源码交付

入口：engine/backend-capabilities.mjs→可信host registry/executor→Godot或Bevy adapter

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **backend-capabilities.mjs：纯数据描述符和七操作支持检查**；严格分离冻结descriptor；七种执行操作/平台/plan schema/feature分别校验，未知数据不获权；无工具/文件/进程依赖。 | 4 / 4 / 4 / 3 | [docs/test-results/backend-middleware/results.json](../docs/test-results/backend-middleware/results.json)、[docs/test-results/backend-middleware/packaged-resources.json](../docs/test-results/backend-middleware/packaged-resources.json)、[docs/test-results/bevy-backend/workflow-real-initial.log](../docs/test-results/bevy-backend/workflow-real-initial.log) |
| 本机服务与适配 | **node-execution-backends.mjs / node-project-build.mjs：可信注册、输出与冻结编排**；固定可信后端与生命周期；中立files/resourceFiles输出先校验再发布，冻结工具/生成物/独立executionAdapter回放；HTTP不注册或选任意代码/路径。 | 4 / 4 / 4 / 3 | [docs/test-results/backend-middleware/results.json](../docs/test-results/backend-middleware/results.json)、[docs/test-results/backend-middleware/browser/browser.json](../docs/test-results/backend-middleware/browser/browser.json)、[docs/test-results/backend-middleware/packaged-resources.json](../docs/test-results/backend-middleware/packaged-resources.json) |
| 执行后端 | **godot4-adapter.mjs：具体工具、阶段、环境与固定生成分支**；包装旧Godot v1/v2冻结生成器及新增显式行为v3分支；具体命令/环境/阶段/缓存与通用宿主隔离，四operation实装，离屏/内嵌/GPU false；legacy兼容显式声明。 | 4 / 4 / 3 / 3 | [docs/test-results/backend-middleware/results.json](../docs/test-results/backend-middleware/results.json)、[docs/test-results/backend-middleware/browser/browser.json](../docs/test-results/backend-middleware/browser/browser.json)、[docs/test-results/backend-middleware/packaged-resources.json](../docs/test-results/backend-middleware/packaged-resources.json) |
| 交互与渲染 | **app-project-build.js**；根据完整纯描述符按操作开放任务入口；descriptor/后端变化撤销旧计划和产物批准，保留dirty/会话/异步归属与三语界面。 | 4 / 4 / 3 / 3 | [docs/test-results/backend-middleware/results.json](../docs/test-results/backend-middleware/results.json)、[docs/test-results/backend-middleware/browser/browser.json](../docs/test-results/backend-middleware/browser/browser.json)、[docs/test-results/backend-middleware/packaged-resources.json](../docs/test-results/backend-middleware/packaged-resources.json) |

平台：Linux本机编辑服务、移动打包纯能力模块不代表Android执行服务、新版Tauri窗口/新安装和设备未验收。边界：0.0.8源码执行中间层独立于作者、plan和runtime格式；精确纯数据描述符分别声明build/headlessLogic/windowPreview/windowCapture/offscreenRender/embeddedViewport/gpuCompute，未知或不支持请求失败关闭。；宿主固定可信适配器、阶段及工具；HTTP和工程文件不能提交后端代码、可执行文件或输出路径，host固定选择已注册Godot/Bevy，网页没有选择器。；通用执行器消费中立files/resourceFiles/来源/产物契约，发布前检查相对路径、碰撞、入口和预算；Godot参数、环境、文件约定和缓存保留在具体适配器。；新构建/会话增加独立executionAdapter指纹；历史backend生成器摘要与协议不改；仅显式接受legacy的已知Godot允许旧记录缺新字段，其余冻结回放检查仍执行。；Godot4产品仅Linux及四种操作；offscreenRender/embeddedViewport/gpuCompute为false。Bevy另有真实无图headless实现；替代夹具/命名空间扩展不代表Nuis/ns-nova/yalivia/GPU实现。；服务返回platform/full descriptor/job.backendId/latestBuild.backendId；UI按操作判断，描述符或后端变化撤销旧计划/产物批准。没有新安装或设备验收。；Godot descriptor0.5.0 保留显式behavior.bindings/behavior.gdscript与plan3；Bevy adapter/tool0.3.0；两者声明runtime.control-replay与runtime.control-replay.instances，全局仅无行为plan1/2有限headless，按实例仅冻结plan2；可选数据参数不增加RPC/Entity或第八种操作。；0.0.8之后未发布的显式工具身份检查由execution.tool_identity独立列出；GET无子进程，ready不授予执行权，实际build/run仍fresh identify及冻结工具/adapter/产物守护；本功能既有评分不因该增量提升。。

下一步：有限方向回放与采样沿同一可信 host 接入；实时通道、运行资源和作者 Rust 行为由后续共同需求另立契约。

<a id="runtime.godot_generated_project"></a>
### Godot 4 工程生成与运行协议

`runtime.godot_generated_project` · 场景与构建 · 源码交付

入口：buildProject/runProjectBuild → generateGodotProject → fixed Godot scene/runtime

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 执行后端 | **godot4.mjs / runtime.gd**；冻结v1具体执行后端，原始生成器/脚本字节和后端摘要保留；v2由独立i104适配，作者数据权威不变。 | 4 / 4 / 3 / 3 | [docs/test-results/scene2d-build/results.json](../docs/test-results/scene2d-build/results.json)、[docs/test-results/scene2d-build/window-session.json](../docs/test-results/scene2d-build/window-session.json)、[docs/test-results/build-workbench/results.json](../docs/test-results/build-workbench/results.json) |
| 本机服务与适配 | **node-project-build.mjs**；通用executor按可信registry固定后端；执行相应plan/protocol并校验冻结输出，具体Godot命令/环境/文件名已从本模块移出；新增中间层交付另列。 | 4 / 4 / 3 / 3 | [docs/test-results/scene2d-build/results.json](../docs/test-results/scene2d-build/results.json)、[docs/test-results/scene2d-build/window-session.json](../docs/test-results/scene2d-build/window-session.json)、[docs/test-results/build-workbench/results.json](../docs/test-results/build-workbench/results.json) |
| 执行后端 | **godot4-dispatch.mjs / godot4-instances.mjs / runtime-v2.gd**；0.0.7源码交付的v2运行分支；v1仍由i074冻结生成器负责，版本选择及双身份事件不改变作者定义。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-instances/runtime-review-tests.log](../docs/test-results/scene-instances/runtime-review-tests.log)、[docs/test-results/scene-instances/packaged-resources.json](../docs/test-results/scene-instances/packaged-resources.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：Linux本机编辑服务、新版Tauri窗口和Android未验收/未接入。边界：仅 Linux 启用；产物为需要 Godot 的工程，非独立发行程序；旧runtime.gd保持固定；当前显式GDScript Node参数/信号绑定另列behavior.scene_runtime，不支持任意方法RPC或热重载。；无嵌入视口/GPU 计算/物理/音频行为；v1与v2生成器/运行脚本字节冻结；v3作者逻辑组编译为既有plan2，运行层不接收groupId或组结构；实例/定义双身份继续沿用v2；未发布中间层包装原冻结分支，新增executionAdapter指纹独立于历史生成器摘要；Godot参数/环境/缓存留在后端，第二Bevy实现只消费无图plan1/2，Godot原范围保留。。

下一步：保持旧v1/v2生成分支兼容；明确行为分支的作者契约与证据另列behavior.scene_runtime。

<a id="build.workbench_lifecycle"></a>
### 构建工作台、诊断、取消与进程回收

`build.workbench_lifecycle` · 场景与构建 · 源码交付

入口：web/modules/app-project-build.js → local build API → createProjectBuildService

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 交互与渲染 | **app-project-build.js**；界面状态、用户输入与结果呈现；按纯描述符分别判断操作并核对任务/产物后端身份，变更撤销旧批准；新增中间层交付另列。 | 4 / 4 / 2 / 3 | [docs/test-results/build-workbench/results.json](../docs/test-results/build-workbench/results.json)、[docs/test-results/build-workbench/browser.json](../docs/test-results/build-workbench/browser.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |
| 本机服务与适配 | **project-build-service.mjs / build-process.mjs 等**；本机服务编排/生命周期，固定host选择的可信backend并返回平台/descriptor和任务/产物后端身份；HTTP不给实现/路径权限。 | 4 / 4 / 3 / 3 | [docs/test-results/build-workbench/results.json](../docs/test-results/build-workbench/results.json)、[docs/test-results/build-workbench/browser.json](../docs/test-results/build-workbench/browser.json)、[docs/test-results/release-0.0.7/results.json](../docs/test-results/release-0.0.7/results.json) |

平台：Linux本机编辑服务、新版Tauri窗口和Android未验收/未接入。边界：仅 Linux 本机编辑服务；只读浏览/Android 无入口；单服务单任务；任务身份只属于当前服务会话；SIGKILL/断电恢复及跨重启任务发现未实现；本会话仅保留最近三份自建输出，不自动删以前会话/CLI 产物；未发布界面按完整descriptor分别判断模式；描述符或backend身份变化撤销旧计划/产物批准，不新增第二引擎选择器。。

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

平台：Linux本机编辑服务、新版Tauri窗口和Android未验收/未接入。边界：静态保存态，不推进运行输入/状态机；字体/SVG 不保证和 Godot 像素一致；Linux 本机编辑服务入口，Android 未接入；缓存保留两份/128 MiB/十分钟；这不是大型场景性能验收；0.0.7按v2实例选择与定位，共享定义/图片不合并实例；具体交付见scene.instances_v2；v3逻辑分组通过独立sceneStructure侧带进入共享大纲；树与查询不改变plan2演员顺序或静态画布渲染；当前原文草稿是独立的scene.text_draft_preview源码能力；保存态刷新、图形布局和可执行构建不隐式消费未保存文本。；未发布配方保存态/当前原文只读预览另列scene.composition；独立预览观察不成为原Scene2D可执行快照。；静态预览仅geometry，不校验或执行行为清单；保存态behavior错误仍可得到有效预览，不视为可构建证明。。

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
### GDScript 行为绑定历史探针

`behavior.gdscript_binding` · 运行后端与演进 · 独立原型

入口：node docs/test-results/behavior-binding/run.mjs

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 执行后端 | **run.mjs / probe.gd 等**；历史独立GDScript探针；不承担当前作者协议或其构建/迁移验证。 | 2 / 3 / 2 / 1 | [docs/test-results/behavior-binding/results.json](../docs/test-results/behavior-binding/results.json)、[docs/test-results/behavior-binding/probe.gd](../docs/test-results/behavior-binding/probe.gd) |

平台：Linux独立Godot探针。边界：仅2026-10-03独立探针，未验证产品快照/包迁移/UI；历史结果原字节保留。；该探针的实验身份/方法调用不是持久作者协议，也未覆盖热重载或大量对象。；当前产品受限绑定使用独立behavior.scene_runtime实现与新证据，不提升本探针成熟度。。

下一步：保留选型证据；当前作者链路参见behavior.scene_runtime，不用旧探针代替新产品验收。

<a id="scene.text_instances"></a>
### 文本驱动场景、定义/实例分离与场景树

`scene.text_instances` · 运行后端与演进 · 规划中

入口：开发路线：文本层次、复用片段与剧本事件（非现有产品入口）

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **文本层次、复用片段、剧本事件与场景树（未实现）**；完整文本场景系统的规划占位；稳定实例、逻辑分组和单源只读预览已另列源码切片，嵌套/跨文件片段、剧本事件、共享可写草稿和跨文件原子提交仍未实现。 | 1 / 0 / — / 0 | [docs/test-results/scene-draft-preview/results.json](../docs/test-results/scene-draft-preview/results.json)、[docs/ROADMAP.md](../docs/ROADMAP.md)、[docs/NEXT_ARCHITECTURE.zh-CN.md](../docs/NEXT_ARCHITECTURE.zh-CN.md) |

平台：规划未接入产品。边界：Scene2D v2稳定实例和v3持久逻辑分组已分别形成scene.instances_v2与scene.groups_v3切片，不代表完整文本场景系统完成；actors仍为1–128个实例；逻辑组不改变坐标或绘制顺序，空间父子变换、剧本事件和跨文件原子提交仍未实现；单文件片段展开另列实验scene.composition；分组树与查询不等于大规模场景性能验收，也没有自动迁移旧作品；单场景原文草稿预览与坐标回写另列切片；scene.composition已提供单文件展开及普通配方文档/依赖迁移，已接保存态/当前草稿配方只读预览及贡献来源定位，当前源码单实例覆盖另走稳定目标补丁，共享模板编辑、统一undo和多文件原子提交仍未接。。

下一步：配方已接普通JSON保存、依赖迁移、当前原文预览与贡献定位；下一步共享模板修改与单次放置覆盖的写回隔离，统一历史、嵌套/跨文件及空间变换另立契约。

<a id="runtime.bevy_rust"></a>
### Bevy/Rust 无头第二后端

`runtime.bevy_rust` · 运行后端与演进 · 源码交付

入口：已登记无图Scene2D→显式CLI或host选择→冻结构建→可信Bevy ECS程序→事件与离线回放

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 执行后端 | **viento-bevy-runtime：锁定Bevy的可信无头ECS程序**；预编译可信Bevy程序检查数据并用真实ECS移动/状态，两个实例保留定义配对；无作者Rust编译或渲染能力。 | 4 / 4 / 3 / 3 | [docs/test-results/bevy-backend/runtime-proof.json](../docs/test-results/bevy-backend/runtime-proof.json)、[docs/test-results/bevy-backend/adapter-real-final.log](../docs/test-results/bevy-backend/adapter-real-final.log)、[docs/test-results/bevy-backend/workflow-real-initial.log](../docs/test-results/bevy-backend/workflow-real-initial.log) |
| 可移植 JS 语义 | **scene-runtime-events.mjs：中立Scene2D身份与生命周期准入**；中立runtime1/2身份/完整集合/数值/状态/生命周期校验，无引擎或宿主依赖。 | 4 / 4 / 4 / 3 | [docs/test-results/bevy-backend/adapter-real-final.log](../docs/test-results/bevy-backend/adapter-real-final.log)、[docs/test-results/bevy-backend/workflow-real-initial.log](../docs/test-results/bevy-backend/workflow-real-initial.log)、[docs/test-results/bevy-backend/packaged-resources.json](../docs/test-results/bevy-backend/packaged-resources.json) |
| 执行后端 | **bevy-adapter.mjs / bevy-project.mjs：工具、阶段与数据产物**；Bevy精确工具识别、noimage准入、数据工程生成与scene-check/headless阶段，不导入Godot模块。 | 4 / 4 / 3 / 3 | [docs/test-results/bevy-backend/adapter-real-final.log](../docs/test-results/bevy-backend/adapter-real-final.log)、[docs/test-results/bevy-backend/workflow-real-initial.log](../docs/test-results/bevy-backend/workflow-real-initial.log)、[docs/test-results/bevy-backend/packaged-resources.json](../docs/test-results/bevy-backend/packaged-resources.json) |
| 本机服务与适配 | **node-execution-tool.mjs / project-build.mjs：可信host和CLI后端选择**；CLI显式backend/tool和host环境固定选择，沿用通用冻结executor；HTTP不选择可执行代码或路径。 | 4 / 4 / 4 / 3 | [docs/test-results/bevy-backend/workflow-real-initial.log](../docs/test-results/bevy-backend/workflow-real-initial.log)、[docs/test-results/bevy-backend/packaged-resources.json](../docs/test-results/bevy-backend/packaged-resources.json)、[docs/test-results/bevy-backend/results.json](../docs/test-results/bevy-backend/results.json) |
| 交互与渲染 | **app-project-build.js**；复用构建工作台观察host固定的Bevy，按descriptor开放plan/build/headless并禁window；三语/390px/dirty/caret保持，没有引擎选择下拉框。 | 4 / 4 / 3 / 3 | [docs/test-results/bevy-backend/browser/browser.json](../docs/test-results/bevy-backend/browser/browser.json)、[docs/test-results/bevy-backend/packaged-resources.json](../docs/test-results/bevy-backend/packaged-resources.json)、[docs/test-results/bevy-backend/results.json](../docs/test-results/bevy-backend/results.json) |

平台：Linux可信本机CLI/编辑服务；源码与新安装验收分开、Android仅portable事件规则，无执行器/UI。边界：0.0.8源码交付；org.viento.bevy adapter/runtime0.3.0锁Bevy0.19.1；Linux plan/runtime1/2，仅build/headlessLogic，以及scene2d/input.arrows/state.movement/runtime.control-replay/runtime.control-replay.instances。旧0.1.0/0.2.0工具和记录需按精确身份重新构建。；同定义双实例保留instanceId/objectId配对；受控固定步方向输入只移动arrows实例，无实体键盘/图片/窗口或GPU验收。 按实例schema2仅冻结plan2，每步未列实例释放；完整trace仍返回全体演员。；Rust运行程序是独立可信本机工具，作者工程只生成scene-data.json；不动态运行Cargo或编译作者Rust源码。；中立事件模块无Node/DOM/Godot/Bevy imports；原Godot5文件保持字节，适配器各自负责命令/生成布局/工具身份。；host环境固定单backend，CLI可显式backend/tool；HTTP不接新代码/路径，原界面无引擎选择器；desktop资源带adapter但不带Bevybin，Android不带执行器。；不承诺作者Rust/GDScript跨语言互译；无BRP/反射/RPC/热更新/任意状态机/新安装包。。

下一步：有限控制程序与步骤采样已接通；再按实际共同需求定义连续实时采样、类型化事件、资源通道与作者 Rust 行为，图片/窗口与规模独立验收。

<a id="runtime.native_nuis"></a>
### Nuislang/ns-nova/yalivia 原生执行

`runtime.native_nuis` · 运行后端与演进 · 规划中

入口：ADR 0008 与长期架构（非产品入口）

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 执行后端 | **Nuislang/ns-nova/yalivia 原生执行（未实现）**；规划占位，尚无生产实现；无Nuis构建执行、ns-nova/yalivia接入 | 1 / 0 / — / 0 | [docs/adr/0008-native-nuis-and-bootstrap-runtime.md](../docs/adr/0008-native-nuis-and-bootstrap-runtime.md)、[docs/NEXT_ARCHITECTURE.zh-CN.md](../docs/NEXT_ARCHITECTURE.zh-CN.md)、[docs/ROADMAP.md](../docs/ROADMAP.md) |

平台：规划未接入产品。边界：无Nuis构建执行、ns-nova/yalivia接入；当前开发不以Nuislang就绪为前置；不可将项目内共享Rust算法称作ns-nova引擎接入；已实现描述符和host中间层只是接入起点；命名空间native extension身份/版本不代表原生代码或GPU可执行。。

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

平台：Linux本机编辑服务、新版Tauri窗口和Android未验收/未接入。边界：Scene2D v1/v2/v3来源与计划拆分仍在可移植JS；v3逻辑组和组字段来源另见scene.groups_v3，空间层级与剧本语义未实现；JSON值由JSON.parse确定，CST只取UTF-16范围；上限8Mi单元/64层/100000值节点；运行拒绝解码后重复键；仅旧v1事务恢复保留最后键语义且无歧义范围，v2/v3恢复继续严格校验；来源和逻辑组侧带信息不进入冻结构建计划；v3作者文本仍进入快照，过期、近似范围不选择，未保存草稿保留；新Tauri安装产物及Android设备未验收；单场景草稿来源可按原样hash在当前编辑器定位，坏草稿诊断与最后有效画面各保留自己的修订；不是将保存态来源强行映射到未保存文本。；未发布配方预览复用来源模型并将生成位置重映射到recipe真实贡献项；仅导航，不授予覆盖或布局写入，具体范围见scene.composition。。

下一步：为共享模板与单次放置覆盖明确写回目标和历史边界，保持已有来源修订守护及旧冻结构建快照。

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

下一步：实验scene.composition已用稳定组身份展开现有v3；后续接配方来源/覆盖编辑，空间父子变换与大规模场景性能单独验证。

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

平台：Linux本机编辑服务与Chrome；真实HTTP、宿主编辑器和浏览器验收范围见当前报告、新Tauri安装产物及Android场景预览未验收/未接入。边界：仅当前已登记场景的一份原文草稿，UTF-8最多128 KiB；严格sceneId/sourcePath/baseSourceRevision/content契约，孤立代理字符、额外字段和超限请求拒绝，HTTP整体请求仍受既有1 MiB限制；以磁盘SHA-256修订为基线，替换克隆观察中的场景正文和源修订后重新派生World投影；角色/投影/素材及关系绑定继续使用已保存登记，缺失或未关联依赖只诊断，不写正文或metadata；草稿身份与构建快照分域；来源按原样BOM/CRLF/Unicode正文hash绑定，返回draft修订与v3组织侧带，不返回sceneEditing或可执行build-snapshot，不创建构建任务或缓存；有效结果原子替换；错误、外部基线冲突或迟到响应保留最后有效画面和来源修订。同一场景可关闭预览、编辑原文、重开自动预览草稿；关闭释放服务端资源，仅保留一份有界解码画面，换场景/失去能力/销毁清理；精确来源定位只校验当前编辑器草稿并移动光标；原文变化、近似范围、场景切换和异步所有权失效均保留内容。投影来源继续走保存态来源路径；草稿预览不授予图形场景表单或World布局保存；来源仍与当前源码一致时可进入独立scene.source_layout本地坐标回写。构建只捕获保存输入，即使传入未知draft选项也不会构建草稿。；只读覆盖与重新投影仍是JS；宿主冻结、HTTP和浏览器渲染分别负责I/O与界面。完整场景/投影语义未下沉Rust，没有多文件原子保存或完整剧本系统；单场景源码坐标回写另列scene.source_layout，新Tauri安装产物和Android场景功能未验收/未接入。；当前草稿为配方时走scene.composition的专用只读模型；来源贡献可导航，仍不允许scene.source_layout回写生成坐标。。

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

下一步：复用片段已另列scene.composition实验；源码补丁仍只改当前普通场景，配方覆盖写回、跨文件提交与跨视图历史须独立契约。

<a id="scene.composition"></a>
### 文件内场景片段、配方预览、单实例覆盖与迁移实验

`scene.composition` · 场景与构建 · 源码交付

入口：普通已登记JSON源码编辑/保存与资源包；保存/草稿配方预览、贡献导航及当前源码的单实例覆盖对话框；scene:compose只读CLI

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 共享 Rust 核心 | **scene_composition.rs：无状态文件内片段组合**；纯Rust检查并展开recipe，明确声明/展开上限及稳定映射，输出既有v3和无宿主来源指针；不接World或文件。 | 3 / 3 / 4 / 3 | [docs/test-results/scene-composition/results.json](../docs/test-results/scene-composition/results.json)、[docs/test-results/scene-composition/packaged-resources.json](../docs/test-results/scene-composition/packaged-resources.json)、[docs/test-results/scene-composition-workflow/results.json](../docs/test-results/scene-composition-workflow/results.json) |
| 可移植 JS 语义 | **scene-composition.mjs / studio-core.mjs：可移植组合调用与响应守护**；同步调用Rust组合/独立可选覆盖补丁；校验来源归属、唯一目标语义与真实有序changedPaths，并重新严格展开回执。坏回执关闭runtime；缺patch能力保留旧域，无JS算法回退。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition/results.json](../docs/test-results/scene-composition/results.json)、[docs/test-results/scene-composition/packaged-resources.json](../docs/test-results/scene-composition/packaged-resources.json)、[docs/test-results/scene-composition-workflow/results.json](../docs/test-results/scene-composition-workflow/results.json) |
| 本机服务与适配 | **scene-compose.mjs：独立文件/已登记快照的只读JSON输出**；有界独立文件或已登记World快照，核对可选源修订与全部声明依赖；输出scene或带原字节摘要/origin的bundle，不写/注册/构建作品。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition/results.json](../docs/test-results/scene-composition/results.json)、[docs/test-results/scene-composition/packaged-resources.json](../docs/test-results/scene-composition/packaged-resources.json)、[docs/test-results/scene-composition-workflow/results.json](../docs/test-results/scene-composition-workflow/results.json) |
| 可移植 JS 语义 | **scene-composition-document.mjs：配方文档识别与源码派生依赖**；普通文档顶层格式识别，复用Rust校验并从全部模板/覆盖只读派生对象与图片依赖；分类和引用检查不写元数据、不复制组合算法。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-workflow/results.json](../docs/test-results/scene-composition-workflow/results.json)、[docs/test-results/scene-composition-workflow/packaged-resources.json](../docs/test-results/scene-composition-workflow/packaged-resources.json)、[docs/test-results/scene-composition-workflow/browser/browser.json](../docs/test-results/scene-composition-workflow/browser/browser.json) |
| 本机服务与适配 | **resource-package-service.mjs / resource-package-export.mjs 等**；资源包目录合并源码派生边和原文指纹；读包/导入重新检查真实recipe与分类/requirements完整性、目标现存来源；保留已有持久导入机制。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-workflow/results.json](../docs/test-results/scene-composition-workflow/results.json)、[docs/test-results/scene-composition-workflow/packaged-resources.json](../docs/test-results/scene-composition-workflow/packaged-resources.json)、[docs/test-results/scene-composition-workflow/browser/browser.json](../docs/test-results/scene-composition-workflow/browser/browser.json) |
| 可移植 JS 语义 | **scene-composition-preview.mjs：只读展开模型与贡献来源映射**；合并临时派生与作者依赖，复用v3模型并把场景/诊断/字段映射配方原字节；保留投影来源，不输出synthetic观察或写权限。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-preview/browser/browser.json](../docs/test-results/scene-composition-preview/browser/browser.json)、[docs/test-results/scene-composition-preview/results.json](../docs/test-results/scene-composition-preview/results.json)、[docs/test-results/scene-composition-preview/packaged-resources.json](../docs/test-results/scene-composition-preview/packaged-resources.json) |
| 本机服务与适配 | **node-build-snapshot.mjs / project-build.mjs**；保存/草稿配方捕获使用原源fence及冻结图片，独立预览身份无build snapshot；原captureBuildSnapshot继续只处理已登记Scene2D。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-preview/browser/browser.json](../docs/test-results/scene-composition-preview/browser/browser.json)、[docs/test-results/scene-composition-preview/results.json](../docs/test-results/scene-composition-preview/results.json)、[docs/test-results/scene-composition-preview/packaged-resources.json](../docs/test-results/scene-composition-preview/packaged-resources.json) |
| 本机服务与适配 | **scene-preview-service.mjs**；HTTP预览保留配方元数据、真实来源和组织大纲，资源缓存/摘要/释放沿旧规则；拒绝把配方响应变成sceneEditing。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-preview/browser/browser.json](../docs/test-results/scene-composition-preview/browser/browser.json)、[docs/test-results/scene-composition-preview/results.json](../docs/test-results/scene-composition-preview/results.json)、[docs/test-results/scene-composition-preview/packaged-resources.json](../docs/test-results/scene-composition-preview/packaged-resources.json) |
| 本机服务与适配 | **project-build-service.mjs / build-process.mjs 等**；状态分别列可构建Scene2D与可预览配方；不因普通recipe文档启动后端任务，缺Godot时仍提供本机静态预览。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-preview/browser/browser.json](../docs/test-results/scene-composition-preview/browser/browser.json)、[docs/test-results/scene-composition-preview/results.json](../docs/test-results/scene-composition-preview/results.json)、[docs/test-results/scene-composition-preview/packaged-resources.json](../docs/test-results/scene-composition-preview/packaged-resources.json) |
| 交互与渲染 | **app-source-location.js / app-runtime.js / app-scene-preview.js**；画布/大纲与贡献导航保留dirty/修订；普通Scene2D写入和构建入口关闭，独立覆盖入口需当前源码身份/能力。父控制器验证候选并传live守护，主编辑器复核提案后仅替换同一原文草稿。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-preview/browser/browser.json](../docs/test-results/scene-composition-preview/browser/browser.json)、[docs/test-results/scene-composition-preview/results.json](../docs/test-results/scene-composition-preview/results.json)、[docs/test-results/scene-composition-preview/packaged-resources.json](../docs/test-results/scene-composition-preview/packaged-resources.json) |
| 共享 Rust 核心 | **scene_composition_patch.rs：稳定目标的六字段保真覆盖补丁**；严格校验整份配方后按稳定目标生成保真六字段set补丁，前后展开/预算均检查；不改共享片段/其他放置/身份，不创建会话或执行I/O。 | 4 / 3 / 4 / 3 | [docs/test-results/scene-composition-overrides/core-bridge.log](../docs/test-results/scene-composition-overrides/core-bridge.log)、[docs/test-results/scene-composition-overrides/results.json](../docs/test-results/scene-composition-overrides/results.json)、[docs/test-results/scene-composition-overrides/packaged-resources.json](../docs/test-results/scene-composition-overrides/packaged-resources.json) |
| 可移植 JS 语义 | **scene-composition-overrides.mjs：绑定原文与预览的覆盖提案及复核**；从当前源与真实预览派生局部编辑状态；提案只包含实际改值，prepare重验hash/目标与精确核心输出，异步前分离输入，无保存副作用。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-overrides/results.json](../docs/test-results/scene-composition-overrides/results.json)、[docs/test-results/scene-composition-overrides/packaged-resources.json](../docs/test-results/scene-composition-overrides/packaged-resources.json)、[docs/test-results/scene-composition-overrides/browser/browser.json](../docs/test-results/scene-composition-overrides/browser/browser.json) |
| 交互与渲染 | **app-scene-composition-overrides.js：实例覆盖检查与草稿应用对话框**；单实例表单→完整候选检查/审阅→live守护的显式内存应用；原文/保存基线保持，普通保存负责磁盘；取消/过期/迟到不写。 | 3 / 3 / 3 / 3 | [docs/test-results/scene-composition-overrides/results.json](../docs/test-results/scene-composition-overrides/results.json)、[docs/test-results/scene-composition-overrides/packaged-resources.json](../docs/test-results/scene-composition-overrides/packaged-resources.json)、[docs/test-results/scene-composition-overrides/browser/browser.json](../docs/test-results/scene-composition-overrides/browser/browser.json) |

平台：Linux本机编辑服务与Chrome配方预览/局部覆盖原文草稿；Node只读CLI/资源包；共享Rust原生/WASM展开与保真补丁、实际打包资源隔离检查与安装/Android设备范围按本轮报告区分。边界：0.0.8源码实验性功能：recipe v1复用普通已登记.json文档与原编辑/保存/冲突；workspace v2/v3配方可只读预览，不新增项目类型、World/journal命令、workspace/Scene2D/运行协议。；配方1–32片段，各含演员及逻辑组；1–128次放置，显式local key→UUID完整映射；声明与展开分别限128演员/128组及16层，重排不改身份。；放置先合并白名单覆盖再应用位置偏移，越界整批拒绝；继承字段省略与imageResourceId:null区分，覆盖不改变定义/身份/分组/继承开关。；Rust严格JSON/重复键/形状/引用/身份/覆盖/预算检查；无状态无I/O，不使用32槽布局会话。原生和WASM共用，不分配或散列生成UUID。；来源sidecar记录模板/放置/身份及贡献JSON Pointer；CLI保留原字节SHA-256，登记模式增加objectId/sourcePath/worldId/worldRevision来源；不授予World/sceneEditing权限。；当前顶层format选择配方工作流，删除后回归普通JSON；Rust校验后从全部模板/覆盖派生对象/图片依赖，含unused/被覆盖项，null忽略；不按文件名猜、不自动写metadata。；配方依赖合并作者已有关系，导出闭包与读包/导入重验实际字节；依赖必须正确列入documents/assets或有指纹requirements，目标同UUID不能补清单漏项；投影闭包沿旧规则。；未完成原文可普通保存和完整备份，无效配方不能展开/选择式打包；生成v3经已有scene.create单独登记，编辑它不会回写配方。；保存态与当前单文档草稿先复用原观察/修订守护，内部克隆展开为v3并合并派生和手工依赖；完整模型/投影/图片规则共用，内部观察不返回、不持久化。；配方标题/画布/背景、演员/组声明和诊断映射实际原文；多贡献主位置近似，template/override/offset/identity各可精确导航。继承尺寸/图片继续指向投影，旧revision不能误选新文本。；独立预览身份绑定配方原文/World修订与冻结图片，不返回sceneEditing或执行snapshot；配方从构建Scene2D清单分离，Scene2D表单/拖动/草稿布局不接生成坐标。；单实例覆盖仅对当前同路径/摘要/保存基线源码会话开放；独立Rust可选操作按placementId+actorKey设置六字段，前后128KiB/完整展开校验，保留其余原始字节，未改字段保留继承。；提案与准备应用分离异步输入，桥接拒绝非目标语义/伪造路径/重复键回执；宿主检查完整模型/真实图片并复核live会话才改内存，实际保存复用普通编辑器冲突机制；取消/迟到/过期不改原草稿。；不编辑共享模板、不删除覆盖/恢复继承、不从画布拖动回写；缺少patch能力只关闭新入口，旧展开/源码/几何仍可用。生成场景的直接编辑不反向修改配方。；无嵌套/跨文件片段、通用表达式、脚本、组空间变换或多文件事务；没有新安装包、Tauri窗口或Android配方入口验收。。

下一步：在当前单实例set与普通保存闭环上，再定义删除覆盖/恢复继承、共享片段编辑及撤销边界；画布拖动、嵌套/跨文件和多文件提交另立契约。

<a id="behavior.scene_runtime"></a>
### 场景实例的GDScript参数、信号与冻结迁移

`behavior.scene_runtime` · 场景与构建 · 源码交付

入口：已登记scene→behavior关系→JSON绑定清单/TXT源码→检查计划/构建/无头测试→行为事件与源诊断

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **scene-behaviors.mjs：严格清单、依赖与可移植绑定计划**；可移植显式绑定规则与plan3组合；保存语法和执行契约分开，不填World空字段。 | 4 / 4 / 4 / 3 | [docs/test-results/scene-behavior-runtime/results.json](../docs/test-results/scene-behavior-runtime/results.json)、[docs/test-results/scene-behavior-runtime/packaged-resources.json](../docs/test-results/scene-behavior-runtime/packaged-resources.json)、[docs/test-results/release-0.0.8/results.json](../docs/test-results/release-0.0.8/results.json) |
| 本机服务与适配 | **node-execution-backends.mjs / node-project-build.mjs：可信注册、输出与冻结编排**；复用保存态捕获与冻结回放，精确诊断范围来自冻结原文，服务仅返回计数和可信DTO。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-behavior-runtime/results.json](../docs/test-results/scene-behavior-runtime/results.json)、[docs/test-results/scene-behavior-runtime/browser/browser.json](../docs/test-results/scene-behavior-runtime/browser/browser.json)、[docs/test-results/scene-behavior-runtime/packaged-resources.json](../docs/test-results/scene-behavior-runtime/packaged-resources.json) |
| 执行后端 | **godot4-behaviors.mjs / behavior-runtime.gd：独立Node参数/信号**；独立Node源码生成/编译、export与signal类型检查、可信身份及生命周期；不改旧生成字节。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-behavior-runtime/results.json](../docs/test-results/scene-behavior-runtime/results.json)、[docs/test-results/scene-behavior-runtime/packaged-resources.json](../docs/test-results/scene-behavior-runtime/packaged-resources.json)、[docs/test-results/release-0.0.8/results.json](../docs/test-results/release-0.0.8/results.json) |
| 交互与渲染 | **app-project-build.js**；行为数量/事件三语可读文本和源诊断，保留rawlog和任意文档草稿运行保护。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-behavior-runtime/results.json](../docs/test-results/scene-behavior-runtime/results.json)、[docs/test-results/scene-behavior-runtime/browser/browser.json](../docs/test-results/scene-behavior-runtime/browser/browser.json)、[docs/test-results/release-0.0.8/results.json](../docs/test-results/release-0.0.8/results.json) |
| 本机服务与适配 | **resource-package-service.mjs / resource-package-export.mjs 等**；按实际绑定原文重新验证scene/script及actor闭包、requirement指纹与并发读取；普通保存/fullbackup保持原规则。 | 4 / 4 / 3 / 3 | [docs/test-results/scene-behavior-runtime/results.json](../docs/test-results/scene-behavior-runtime/results.json)、[docs/test-results/scene-behavior-runtime/packaged-resources.json](../docs/test-results/scene-behavior-runtime/packaged-resources.json)、[docs/test-results/release-0.0.8/results.json](../docs/test-results/release-0.0.8/results.json) |

平台：Linux本机编辑服务与真实Chrome/Godot4、移动仅纯规则与完整作者数据存储互通，不代表行为执行或UI接入、Tauri新安装及Android设备未验收。边界：0.0.8源码交付；明确选择绑定文档的Scene2D v2/v3才生成plan/runtime3；旧无行为v1/v2分支保持，Worldv1.behaviorBindings仍为[]。；严格可移植manifest1：最多32bindings/8sources，TXT每份64KiB合计512KiB；场景与源码必须有非part-of出向登记，稳定实例/定义依赖完整。；Godot4仅GDScript独立Node：无参构造、脚本自身标量export、最多4个明确类型信号参数；每binding独立对象，事件绑定身份可信且限制ready/finished生命周期。；作者源码随冻结快照；回放重新规划、核对指纹/工具/每份输出；TXT编译定位原文行，参数类型运行错误定位manifest指针，sourceRange由冻结作者文本补充。；选择包重派生场景/源码直接依赖并要求清单或pin；包内scene不得借ambientactor，外部pinnedscene可沿已锁关系读取传递actor并hash/fence复验；完整备份允许未完成原文。；静态预览只geometry，不验证或运行bindings；GUI展示计数/安全文本事件和诊断，不执行脚本，未保存任意doc继续阻止build/run。；脚本以用户权限运行，无沙箱承诺；无任意方法RPC/热更新/通用状态机/行为参数表单/作者BevyRust行为/Nuis/GPU/Android执行器或新安装验收。。

下一步：完善绑定清单创作和参数辅助，再独立定义解绑/热更新及规模验证；其他后端必须真实工具链验收。

<a id="runtime.objects_inspection"></a>
### 运行对象、位置采样与冻结来源只读观察

`runtime.objects_inspection` · 场景与构建 · 源码交付

入口：构建任务→当前owned运行job.runtime→本地名称/实例/定义检索、原文声明；POST /api/project-build action:inspect

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **scene-runtime-query.mjs：稳定身份与采样观察核心**；冻结身份/来源与纯采样状态独立于引擎与视图，query分离完整DTO并按AND过滤；原事件准入仍属于adapter。 | 4 / 4 / 4 / 3 | [docs/test-results/runtime-object-inspection/core-query-final.log](../docs/test-results/runtime-object-inspection/core-query-final.log)、[docs/test-results/runtime-object-inspection/host-real.log](../docs/test-results/runtime-object-inspection/host-real.log)、[docs/test-results/runtime-object-inspection/packaged-resources.json](../docs/test-results/runtime-object-inspection/packaged-resources.json) |
| 本机服务与适配 | **node-execution-backends.mjs / node-project-build.mjs：可信注册、输出与冻结编排**；验证全部frozen产物后建立观察，runtime progress/终态session与独立job视图；strictinspect只读当前ownedrun且不查tool或占槽。 | 4 / 4 / 4 / 3 | [docs/test-results/runtime-object-inspection/host-real.log](../docs/test-results/runtime-object-inspection/host-real.log)、[docs/test-results/runtime-object-inspection/browser/browser.json](../docs/test-results/runtime-object-inspection/browser/browser.json)、[docs/test-results/runtime-object-inspection/packaged-resources.json](../docs/test-results/runtime-object-inspection/packaged-resources.json) |
| 交互与渲染 | **app-project-build.js**；消费归属匹配的job.runtime，本地过滤和三语采样标签、名称安全文本与冻结source导航，保持焦点/dirty/迟到归属保护。 | 4 / 4 / 3 / 3 | [docs/test-results/runtime-object-inspection/ui-final.log](../docs/test-results/runtime-object-inspection/ui-final.log)、[docs/test-results/runtime-object-inspection/browser/browser.json](../docs/test-results/runtime-object-inspection/browser/browser.json)、[docs/test-results/runtime-object-inspection/packaged-resources.json](../docs/test-results/runtime-object-inspection/packaged-resources.json) |

平台：Linux本机CLI/编辑服务与工作台，实际浏览器/准备资源证据分列、Android仅可移植观察模块；无对象UI/执行器/设备验收、Tauri新安装和窗口未验收。边界：0.0.8源码交付；普通观察消费既有 plan/runtime1/2/3，无程序DTO保持；有限控制 plan1/2 可选 control 摘要和完整步骤样本，不改变作者格式或 adapter contract1。；仅从已验证冻结plan捕获actor身份、名称与来源；protocol1按objectId，2/3按instanceId且核对objectId，不暴露引擎Entity/节点/句柄。；waiting只有metadata/null样本；ready/finished提供完整坐标；state改变状态并使旧位置positionCurrent=false，diagnostic/behavior不改变观察，不提供实时反射。；host在frozen/source/adapter/tool/artifact验证后建立视图，runtime progress先于raw ready；128条事件ring不裁剪完整128actor视图，取消/错误/超时会话保留最后有效样本。；inspect只接受当前owned runjob UUID及可选instanceId/objectId小写UUID，AND过滤无匹配[]，无active/tool availability门禁，不启动任务/占槽/读作者源；foreign/nonrun/missing/unavailable拒绝。；UI核对scene/backend/descriptor/build/snapshot/protocol归属，本地检索、三语、采样阶段和source守护，dirty/creating/busy禁跳转并保护光标，切换清理旧对象。；没有连续位置采样、组件反射/RPC/运行修改、作者Rust/BRP/资源通道/GPU/跨会话历史采用或Android对象UI。；有限方向回放另外准入 VIENTO_TRACE 全体样本；phase仍ready，positionSample control/零基positionStep；state可使样本stale，有效finished清步骤标记；来源仍由冻结计划提供。 按实例输入继续复用完整trace schema1及原观察DTO；稀疏输入不省略未列实例的样本。。

下一步：有限固定步骤采样已接入；连续实时采样、组件查询和运行修改仍需明确时间/顺序/预算/所有权，不写作者权威数据。

<a id="runtime.control_replay"></a>
### 有限方向程序、跨后端回放与完整步骤采样

`runtime.control_replay` · 场景与构建 · 源码交付

入口：构建任务 → 编辑控制回放 / 控制回放；project-build run --control-program

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **scene-control-program.mjs：有限程序及原序trace准入**；纯程序/联合预算与原序trace准入，无模拟或引擎依赖。 | 4 / 3 / 4 / 3 | [docs/test-results/runtime-control-replay/portable-tests.log](../docs/test-results/runtime-control-replay/portable-tests.log)、[docs/test-results/runtime-control-replay/runtime-proof.json](../docs/test-results/runtime-control-replay/runtime-proof.json)、[docs/test-results/runtime-control-replay/engine-tests-final.log](../docs/test-results/runtime-control-replay/engine-tests-final.log) |
| 可移植 JS 语义 | **scene-runtime-query.mjs：稳定身份与采样观察核心**；可选control进度/positionStep与pushSample；旧DTO逐字段保持，来源冻结且查询分离。 | 4 / 3 / 4 / 3 | [docs/test-results/runtime-control-replay/portable-tests.log](../docs/test-results/runtime-control-replay/portable-tests.log)、[docs/test-results/runtime-control-replay/cli-tests-final.log](../docs/test-results/runtime-control-replay/cli-tests-final.log)、[docs/test-results/runtime-control-replay/host-ui-tests.log](../docs/test-results/runtime-control-replay/host-ui-tests.log) |
| 本机服务与适配 | **node-execution-backends.mjs / node-project-build.mjs：可信注册、输出与冻结编排**；冻结程序SHA/独立会话与strict HTTP/CLI，仅可信描述符数据参数；取消/错误保留有效样本。 | 4 / 3 / 4 / 3 | [docs/test-results/runtime-control-replay/cli-tests-final.log](../docs/test-results/runtime-control-replay/cli-tests-final.log)、[docs/test-results/runtime-control-replay/host-ui-tests.log](../docs/test-results/runtime-control-replay/host-ui-tests.log)、[docs/test-results/runtime-control-replay/browser-final/browser.json](../docs/test-results/runtime-control-replay/browser-final/browser.json) |
| 执行后端 | **control-runtime.gd / control.tscn：独立Godot固定步控制驱动**；Godot独立可信控制驱动消费bool程序并报告固定步trace，原5/GDS2文件保持。 | 3 / 3 / 3 / 3 | [docs/test-results/runtime-control-replay/engine-tests-final.log](../docs/test-results/runtime-control-replay/engine-tests-final.log)、[docs/test-results/runtime-control-replay/cli-tests-final.log](../docs/test-results/runtime-control-replay/cli-tests-final.log)、[docs/test-results/runtime-control-replay/browser-final/browser.json](../docs/test-results/runtime-control-replay/browser-final/browser.json) |
| 执行后端 | **viento-bevy-runtime：锁定Bevy的可信无头ECS程序**；Bevy可信ECS工具0.3.0执行同程序、jointbudget和稳定实例trace，不编译作者Rust。 | 3 / 3 / 3 / 3 | [docs/test-results/runtime-control-replay/runtime-proof.json](../docs/test-results/runtime-control-replay/runtime-proof.json)、[docs/test-results/runtime-control-replay/engine-tests-final.log](../docs/test-results/runtime-control-replay/engine-tests-final.log)、[docs/test-results/runtime-control-replay/cli-tests-final.log](../docs/test-results/runtime-control-replay/cli-tests-final.log) |
| 交互与渲染 | **app-project-build.js**；独立回放/JSON editor按cap与plan/budget开放，消费host步骤观察和安全三语labels；旧runpayload保持。 | 4 / 3 / 3 / 3 | [docs/test-results/runtime-control-replay/host-ui-tests.log](../docs/test-results/runtime-control-replay/host-ui-tests.log)、[docs/test-results/runtime-control-replay/browser-final/browser.json](../docs/test-results/runtime-control-replay/browser-final/browser.json)、[docs/test-results/runtime-control-replay/packaged-resources.json](../docs/test-results/runtime-control-replay/packaged-resources.json) |

平台：Linux本机编辑服务/CLI；实际浏览器与准备资源分别记录、Android只复用pure规则，未接执行器/界面/设备、Tauri新安装与窗口未验收。边界：0.0.8源码交付；只支持 runtime.control-replay capability、无作者行为 scene2d plan/runtime1/2、有限 headless；window/capture/interactive/plan3拒绝。；viento-runtime-control schema1 只有 fixedDelta 与 steps 的四向精确bool；1..64步，0<dt<=.25秒，总时长<=8秒，最后全释放；actors*steps<=1024联合预算执行前拒绝。 本功能保留schema1全局基础；schema2的独立实例路由另见runtime.instance_control。；纯模块不执行访问器、不接原型/隐藏字段/稀疏数组/循环/paths/Entity，输入分离深冻结；host记录canonicalJSON SHA、程序与有效样本。；VIENTO_TRACE schema1 按连续0基stepIndex返回全体actor身份/有限position/idle|moving；只在validready与finished之间，结束步长/演员值必须匹配程序与lastsample。；runtime与trace逐行原序，不先处理整块finished；无效结束不覆盖样本，取消/错误不补造完成；旧no-control观察和默认smoke保留。；Godot独立可信控制驱动保留原5文件/GDS行为2文件；Bevy可信工具0.3.0处理自身ECS，固定Bevy0.19.1、不编译作者Rust；工具/bin不进作者迁移包。；schema1 CLI只run可选16KiB JSON文件；HTTP只run新增controlProgram数据，UI编辑/进度/三语步骤样本与草稿守护；没有stdin、RPC、实时键盘、反射、渲染/GPU、安装或Android执行器。。

下一步：schema1全局基础保持；按实例有限输入已作为runtime.instance_control独立接入；实时采样或类型化运行资源、作者Rust、窗口输入和规模仍各自验收。

<a id="runtime.instance_control"></a>
### 按实例独立有限输入与稀疏步骤路由

`runtime.instance_control` · 场景与构建 · 源码交付

入口：已验证冻结plan2 → 输入示例的目标/显式生成输入示例或JSON → 控制回放；CLI run --control-program schema2

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **scene-control-program.mjs：有限程序及原序trace准入**；schema2严格分离冻结、目标提前检查、双预算；原trace逐行准入共用，无移动模拟。 | 4 / 3 / 4 / 3 | [docs/test-results/runtime-instance-control/portable-tests-final.log](../docs/test-results/runtime-instance-control/portable-tests-final.log)、[docs/test-results/runtime-instance-control/browser-final/browser.json](../docs/test-results/runtime-instance-control/browser-final/browser.json)、[docs/test-results/runtime-instance-control/packaged-resources.json](../docs/test-results/runtime-instance-control/packaged-resources.json) |
| 可移植 JS 语义 | **scene-runtime-query.mjs：稳定身份与采样观察核心**；observer构造复用schema2 plan校验，fulltrace/control摘要与旧DTO保留，位置仍从后端准入帧记录。 | 4 / 3 / 4 / 3 | [docs/test-results/runtime-instance-control/portable-tests-final.log](../docs/test-results/runtime-instance-control/portable-tests-final.log)、[docs/test-results/runtime-instance-control/browser-final/browser.json](../docs/test-results/runtime-instance-control/browser-final/browser.json)、[docs/test-results/runtime-instance-control/packaged-resources.json](../docs/test-results/runtime-instance-control/packaged-resources.json) |
| 本机服务与适配 | **node-execution-backends.mjs / node-project-build.mjs：可信注册、输出与冻结编排**；owned frozen实例目标缓存、双capability与SHA/样本绑定，未知目标提前拒绝；CLI16/256KiB和独立会话保持。 | 4 / 3 / 4 / 3 | [docs/test-results/runtime-instance-control/engine-tests-final.log](../docs/test-results/runtime-instance-control/engine-tests-final.log)、[docs/test-results/runtime-instance-control/cli-tests.log](../docs/test-results/runtime-instance-control/cli-tests.log)、[docs/test-results/runtime-instance-control/browser-final/browser.json](../docs/test-results/runtime-instance-control/browser-final/browser.json) |
| 执行后端 | **control-runtime.gd / control.tscn：独立Godot固定步控制驱动**；Godot0.5.0可信GDS control driver按step instanceId路由与release未列，旧生成/行为文件字节保持。 | 3 / 3 / 3 / 3 | [docs/test-results/runtime-instance-control/engine-tests-final.log](../docs/test-results/runtime-instance-control/engine-tests-final.log)、[docs/test-results/runtime-instance-control/cli-tests.log](../docs/test-results/runtime-instance-control/cli-tests.log)、[docs/test-results/runtime-instance-control/browser-final/browser.json](../docs/test-results/runtime-instance-control/browser-final/browser.json) |
| 执行后端 | **viento-bevy-runtime：锁定Bevy的可信无头ECS程序**；Bevy0.3.0可信ECS工具按稳定instanceId每步方向与release，独立验证原生输入/预算，不编译作者Rust。 | 3 / 3 / 3 / 3 | [docs/test-results/runtime-instance-control/engine-tests-final.log](../docs/test-results/runtime-instance-control/engine-tests-final.log)、[docs/test-results/runtime-instance-control/runtime-proof.json](../docs/test-results/runtime-instance-control/runtime-proof.json)、[docs/test-results/runtime-instance-control/browser-final/browser.json](../docs/test-results/runtime-instance-control/browser-final/browser.json) |
| 交互与渲染 | **app-project-build.js**；当前ownedbuild目标列表（末尾UUID短标识在前，title及value完整）、显式生成schema2示例与JSON保留、未知实例本地拒绝、三语提示和完整步骤观察。 | 4 / 3 / 3 / 3 | [docs/test-results/runtime-instance-control/browser-final/browser.json](../docs/test-results/runtime-instance-control/browser-final/browser.json)、[docs/test-results/runtime-instance-control/packaged-resources.json](../docs/test-results/runtime-instance-control/packaged-resources.json)、[docs/test-results/runtime-instance-control/results.json](../docs/test-results/runtime-instance-control/results.json) |

平台：Linux本机CLI/编辑服务，实际两引擎/浏览器/准备资源证据分列、Android仅pure规则复用，无执行器/UI/设备验收、Tauri新安装与窗口未验收。边界：0.0.8源码交付；同时要求runtime.control-replay及runtime.control-replay.instances、无行为冻结plan/runtime2、有限headless；plan1即使empty inputs也拒绝，plan3/window/capture/interactive不支持。；viento-runtime-control schema2精确顶层format/schemaVersion/fixedDelta/steps；每步精确inputs，每行instanceId+四向bool；0..128行/步，总输入行<=1024，1..64步、0<dt<=.25、总时长<=8、最后inputs空或每行全false。；instanceId只准入冻结plan2实际实例集合；same-step重复拒绝、跨step可重复，定义UUID不能冒充实例，未知目标runtime_control_target_missing；合法实际instanceId与objectId相同仍按成员判断。；每步未列实例全部释放，不粘住上一输入；controls none/零速度保持原规则；具体移动/归一化在受信任Godot或Bevy runtime，可移植层只验证数据/身份/预算/trace。；actors*steps<=1024继续独立检查，因为每步trace返回全部冻结演员；trace schema1/protocol2及观察control/positionStep形状不变，无程序旧DTO与schema1全局语义保持。；CLI schema2控制文件<=256KiB，schema1旧16KiB限制保留；host记录冻结规范程序SHA及有效样本，verifiedownedbuild持有中立controlTargets；HTTP不接作者路径/工具/code/Entity，未知目标在启动任务前拒绝。；Godot adapter0.5.0用独立可信GDS driver；Bevy adapter/native0.3.0锁Bevy0.19.1，工具升级需重建；旧Godot5/GDS2/WASM2及历史证据原字节保留。；UI实例列表以instanceId末尾8位在前、name在后，窄屏区分同名/同前缀实例；title及实际值保留完整instanceId；选择目标不改JSON，显式生成才替换为已验证四步示例；poll/reopen/locale保留输入与草稿守护，不写作者工程。；仅有限按实例方向输入；没有实时输入/RPC/反射/运行组件修改、作者Rust、渲染/GPU、跨会话恢复、Tauri新安装或Android执行器。。

下一步：保持有限路由和完整采样的共同粒度；类型化事件、资源、实时采样与可变组件只有出现实际共同需求才另立契约。

<a id="execution.tool_identity"></a>
### 可信工具身份检查、状态DTO与候选失效

`execution.tool_identity` · 场景与构建 · 源码交付

入口：工作台“检查工具身份” → POST /api/project-build 精确action:tool-check；源码CLI --command tool-check → 同一可信host probe

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **execution-tool-status.mjs：纯数据工具状态契约**；严格纯状态准入/冻结，同一DTO供Node与浏览器消费，拒路径/代码/访问器/污染；pending不携身份。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-tool-probe/results.json](../docs/test-results/runtime-tool-probe/results.json)、[docs/test-results/runtime-tool-probe/core-probe-tests.log](../docs/test-results/runtime-tool-probe/core-probe-tests.log)、[docs/test-results/runtime-tool-probe/packaged-resources.json](../docs/test-results/runtime-tool-probe/packaged-resources.json) |
| 本机服务与适配 | **node-execution-tool-probe.mjs：可信身份探测与候选签名**；固定host工具的无进程候选观察、显式adapter.identify、总预算/取消与候选前后核对，只输出中立身份。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-tool-probe/results.json](../docs/test-results/runtime-tool-probe/results.json)、[docs/test-results/runtime-tool-probe/engine-probes.log](../docs/test-results/runtime-tool-probe/engine-probes.log)、[docs/test-results/runtime-tool-probe/core-probe-tests.log](../docs/test-results/runtime-tool-probe/core-probe-tests.log) |
| 本机服务与适配 | **project-build-service.mjs / build-process.mjs 等**；精确tool-check鉴权、单owned检查/构建槽、会话缓存与关闭回收；不覆盖job/最新产物/计划或作者树，执行仍重新识别。 成功catalog+owned构建/运行的来源离线只读降级；新plan/build仍fresh源并提前拒绝。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-tool-probe/results.json](../docs/test-results/runtime-tool-probe/results.json)、[docs/test-results/runtime-tool-probe/core-probe-tests.log](../docs/test-results/runtime-tool-probe/core-probe-tests.log)、[docs/test-results/runtime-tool-probe/browser/browser.json](../docs/test-results/runtime-tool-probe/browser/browser.json) |
| 交互与渲染 | **app-project-build.js**；显式检查及三语受控状态文本，纯DTO/backend核对、dirty草稿和旧无DTO兼容、checking与请求归属守护，丢响应只GET。 来源不可读提示与工具身份分开，源问题只阻止新计划/构建。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-tool-probe/results.json](../docs/test-results/runtime-tool-probe/results.json)、[docs/test-results/runtime-tool-probe/core-probe-tests.log](../docs/test-results/runtime-tool-probe/core-probe-tests.log)、[docs/test-results/runtime-tool-probe/browser/browser.json](../docs/test-results/runtime-tool-probe/browser/browser.json) |
| 验证与维护 | **node-execution-tool.mjs / project-build.mjs：可信host和CLI后端选择**；独立源码CLI工具检查：仅固定注册host backend/tool与有界deadline，不打开作者工程、不生成场景输出。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-tool-probe/results.json](../docs/test-results/runtime-tool-probe/results.json)、[docs/test-results/runtime-tool-probe/engine-probes.log](../docs/test-results/runtime-tool-probe/engine-probes.log)、[docs/test-results/runtime-tool-probe/core-probe-tests.log](../docs/test-results/runtime-tool-probe/core-probe-tests.log) |

平台：Linux可信CLI/本机编辑服务与工作台；实测范围独立报告、可移植DTO可准备到桌面/移动资源，无Android检查或执行入口、新Tauri安装/窗口与其他目标设备未验收。边界：0.0.9源码交付；原0.0.8阶段协议与边界保留。0.0.8后的未发布工作树增量；工具检查与构建/运行分别准入，ready只记录检查时身份，不审批场景、授权执行、生成输出或自动重建。；viento-execution-tool-status schema1精确format/schemaVersion/backendId/status/reason/identity；unchecked/checking/ready/unavailable，只有ready携带version/完整二进制SHA256裸64hex/platform/arch；严格分离冻结、拒额外字段/getter/污染，DTO无路径、原始日志或执行代码。；GET只观察文件X_OK、解析路径及stat，绝不启动子进程；候选key仅宿主私有，基于realpath/dev/ino/size/mtimeNs/ctimeNs/mode，改变时会话缓存回到unchecked，不隐式探测。未检查候选沿旧available兼容行为，显式失败后available=false，成功重检恢复。；显式探测复用固定可信adapter.identify，不另写版本兼容规则；12s总终止预算覆盖候选与identify，子进程既有10s/合并输出1MiB、二进制读取512MiB上限保持；abort后等待回收而非遗留Promise.race，取消/超时或前后候选改变均不得缓存ready。；POST只允许{action:tool-check}，沿本机编辑鉴权，拒scene/backend/tool/path/output等附加字段；一个service同时一个检查或构建任务，close取消并等待检查。HTTP断开或网页关面板不取消宿主探测，完成结果须仍属同owner/未关闭service。；检查不创建/替换job/latestBuild，不改计划批准、运行样本、作者文件或草稿；构建和运行继续fresh identify，对照冻结工具版本/SHA与adapter/产物/来源守护，成功检查不能绕过runtime_tool_changed重建要求。；工作台消费同一纯DTO并核对backendId，旧服务无DTO隐藏检查入口；中英日文本与checking提示，dirty/creating草稿可检查但不保存/丢弃，异步请求守护和响应丢失只读刷新不重复发起检查。；独立CLI只接受固定已注册backend、可信host工具配置及1..12000ms预算，不读作者工程、不接场景/输出/控制程序/window/capture/interactive输入；ok按ready判断，公共JSON无本机路径。；Godot adapter0.5.0、Bevy adapter/native0.3.0/Bevy0.19.1、注册器及旧Godot/GDS/native/WASM冻结生成器不改；新辅助层不改变历史executionAdapter指纹、runtime/作者协议或增加第八种执行操作。；已成功读取catalog并拥有本会话已验证构建或其owned运行后，作者源暂不可读可只读降级至缓存目录，catalogDiagnostic仅返回固定code=build_catalog_unavailable；run/inspect/cancel/tool-check继续服务冻结产物。plan/build仍强制读取当前源，失败在创建job前拒绝；没有成功catalog或owned产物不能借此降级，恢复后的成功刷新清除诊断。UI来源提示独立于工具状态，仅阻止新的计划/构建，不把工具ready或冻结运行观察覆盖为源错误。；能力范围仅Linux本机检查；资源准备/纯DTO复用不表示Android工具执行器、Tauri新安装/窗口、Windows/macOS设备或新发行验收。。

下一步：继续按真实共同需求补工具诊断和目标平台验收；检查时身份不得取代运行前重新校验和冻结产物重建守护。

<a id="runtime.verification_cases"></a>
### 有限运行验收用例与步骤预期评判

`runtime.verification_cases` · 场景与构建 · 源码交付

入口：工作台编辑／明确生成用例→运行验收；CLI run --runtime-case；owned HTTP runtimeCase纯数据

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **runtime-verification-case.mjs：纯用例准入与样本评判**；纯case严格分离冻结、目标/预算与samples评判；引擎完成事实由host传入，不模拟移动或执行。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-verification-cases/results.json](../docs/test-results/runtime-verification-cases/results.json)、[docs/test-results/runtime-verification-cases/browser/browser.json](../docs/test-results/runtime-verification-cases/browser/browser.json)、[docs/test-results/runtime-verification-cases/packaged-resources.json](../docs/test-results/runtime-verification-cases/packaged-resources.json) |
| 本机服务与适配 | **node-project-build.mjs**；通用冻结executor组合控制与真实采样，独立caseSHA/记录；断言失败和取消持久化分别处理。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-verification-cases/results.json](../docs/test-results/runtime-verification-cases/results.json)、[docs/test-results/runtime-verification-cases/browser/browser.json](../docs/test-results/runtime-verification-cases/browser/browser.json)、[docs/test-results/runtime-verification-cases/packaged-resources.json](../docs/test-results/runtime-verification-cases/packaged-resources.json) |
| 本机服务与适配 | **project-build-service.mjs / build-process.mjs 等**；owned单槽精确payload、beforeawait分离与prejob目标准入、commit点和独立verification。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-verification-cases/results.json](../docs/test-results/runtime-verification-cases/results.json)、[docs/test-results/runtime-verification-cases/browser/browser.json](../docs/test-results/runtime-verification-cases/browser/browser.json)、[docs/test-results/runtime-verification-cases/packaged-resources.json](../docs/test-results/runtime-verification-cases/packaged-resources.json) |
| 交互与渲染 | **app-project-build.js**；明确JSON/完整采样baseline生成、三语逐行显示和纯评判再次校验；不自动写作者，文本/光标守护。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-verification-cases/results.json](../docs/test-results/runtime-verification-cases/results.json)、[docs/test-results/runtime-verification-cases/browser/browser.json](../docs/test-results/runtime-verification-cases/browser/browser.json)、[docs/test-results/runtime-verification-cases/packaged-resources.json](../docs/test-results/runtime-verification-cases/packaged-resources.json) |
| 验证与维护 | **node-execution-tool.mjs / project-build.mjs：可信host和CLI后端选择**；源码CLI只finiteheadless/regular256KiB case，与control程序/窗口/非run互斥；冻结来源。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-verification-cases/results.json](../docs/test-results/runtime-verification-cases/results.json)、[docs/test-results/runtime-verification-cases/browser/browser.json](../docs/test-results/runtime-verification-cases/browser/browser.json)、[docs/test-results/runtime-verification-cases/packaged-resources.json](../docs/test-results/runtime-verification-cases/packaged-resources.json) |

平台：Linux固定可信Godot/Bevy CLI与本机GUI服务、可移植pure DTO/评判可准备到桌面/移动资源、安装Tauri/Android设备未验收。边界：0.0.9源码交付；原0.0.8阶段协议与边界保留。0.0.8之后未发布工作树；仅无行为冻结plan2、control program1/2、真实有限无头运行；旧plan1控制与所有旧作者/计划/trace/adapter/native/WASM不变。；纯viento-runtime-case schema1精确format/schemaVersion/program/checks；1–128稳定实例+零基步骤检查，至少position或state，重复实例步拒绝；position精确value[有限x,y]+有限非负显式tolerance，逐轴绝对差<=tol，无隐藏epsilon或模拟运动。；复用控制原预算/目标与严格trace；每步全体定义/实例配对且连续0起prefix，纯评判再审查样本，不伪造ready/finished/缺样本/引擎事实，不携路径/代码/后端/Entity。；complete只由可信宿主成功且完整运行确认；passed/failed/incomplete独立于执行status；cancel/timeout/protocolfailed或缺样本整体incomplete，逐行保留已观察actual/expected/比较，缺失unavailable。；host预FS验证输入/互斥finiteheadless，冻结plan目标在identify和session前准入；控制program与case各canonicalSHA，session追加verification但不改作者/生成库存；最终保存中的取消也持久化cancelled/incomplete，service用已完成record作为结果提交点。；service只owned build/headless/case数据、beforeawait分离与beforejobslot准入；CLI regular256KiB用例，互斥control-program/window/capture/interactive与非run/tool-check，JSON文件不接最终symlink。；GUI独立文本保留poll/lang/reopen选区，中英日显示执行与逐行验收；显式从owned成功完整control末步采样生成位置/state检查，tol0.0001，生成会覆盖输入但不自动学期望或写作者。；可移植JS契约与宿主执行/GUI分开；准备mobile仅纯case/control模块及已准入desktop数据评判，非Android执行或设备验收。。

下一步：分别定义工程内用例登记／保存／迁移、更广运行观察和作者行为检查；保留真实引擎完成与预期比较的边界。

<a id="runtime.case_documents"></a>
### 工程验收用例保存、重用与稳定身份迁移

`runtime.case_documents` · 场景与构建 · 源码交付

入口：工程验收用例→刷新/明确载入/保存/另存→资源包或完整迁移→同场景冻结运行；CLI兼容包装

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **runtime-case-document.mjs：可移植工程包装与场景绑定**；纯工程文档识别、case分离与场景/实例/定义依赖守护；不读文件或模拟运行。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-documents/results.json](../docs/test-results/runtime-case-documents/results.json)、[docs/test-results/runtime-case-documents/browser/browser.json](../docs/test-results/runtime-case-documents/browser/browser.json)、[docs/test-results/runtime-case-documents/packaged-resources.json](../docs/test-results/runtime-case-documents/packaged-resources.json) |
| 本机服务与适配 | **runtime-case-documents.mjs：fresh作者目录与原子保存守护**；fresh作者catalog/load/save，双修订与publication再观察，既有事务复用。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-documents/results.json](../docs/test-results/runtime-case-documents/results.json)、[docs/test-results/runtime-case-documents/browser/browser.json](../docs/test-results/runtime-case-documents/browser/browser.json)、[docs/test-results/runtime-case-documents/packaged-resources.json](../docs/test-results/runtime-case-documents/packaged-resources.json) |
| 存储与事务 | **node-document-storage.mjs**；普通原子文档writer的可选发布守护；case新登记失败仅回滚本次descriptor。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-documents/results.json](../docs/test-results/runtime-case-documents/results.json)、[docs/test-results/runtime-case-documents/browser/browser.json](../docs/test-results/runtime-case-documents/browser/browser.json)、[docs/test-results/runtime-case-documents/packaged-resources.json](../docs/test-results/runtime-case-documents/packaged-resources.json) |
| 交互与渲染 | **app-runtime-case-documents.js：独立用例文档交互**；独立用例文档controller、auth headers、显式载入和写入、迟到回执/草稿守护。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-documents/results.json](../docs/test-results/runtime-case-documents/results.json)、[docs/test-results/runtime-case-documents/browser/browser.json](../docs/test-results/runtime-case-documents/browser/browser.json)、[docs/test-results/runtime-case-documents/packaged-resources.json](../docs/test-results/runtime-case-documents/packaged-resources.json) |
| 交互与渲染 | **app-project-build.js**；构建工作台传递scene/context和纯case，冻结运行与作者保存分别准入。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-documents/results.json](../docs/test-results/runtime-case-documents/results.json)、[docs/test-results/runtime-case-documents/browser/browser.json](../docs/test-results/runtime-case-documents/browser/browser.json)、[docs/test-results/runtime-case-documents/packaged-resources.json](../docs/test-results/runtime-case-documents/packaged-resources.json) |
| 存储与事务 | **resource-package-service.mjs / resource-package-export.mjs 等**；选择包source-derived依赖与optional scenechildren、requirements/真实target核验及字节稳定迁移。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-documents/results.json](../docs/test-results/runtime-case-documents/results.json)、[docs/test-results/runtime-case-documents/browser/browser.json](../docs/test-results/runtime-case-documents/browser/browser.json)、[docs/test-results/runtime-case-documents/packaged-resources.json](../docs/test-results/runtime-case-documents/packaged-resources.json) |
| 验证与维护 | **node-execution-tool.mjs / project-build.mjs：可信host和CLI后端选择**；CLI兼容原case与保存包装，scene绑定守护与旧有限模式/文件边界。 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-documents/results.json](../docs/test-results/runtime-case-documents/results.json)、[docs/test-results/runtime-case-documents/browser/browser.json](../docs/test-results/runtime-case-documents/browser/browser.json)、[docs/test-results/runtime-case-documents/packaged-resources.json](../docs/test-results/runtime-case-documents/packaged-resources.json) |

平台：Linux本机作者服务、工作台与可信Godot/Bevy CLI、纯模块可准备到移动资源；无Android引擎服务、未更新安装包或验收Tauri/设备。边界：0.0.9源码交付；原0.0.8阶段协议与边界保留。0.0.8之后未发布工作树，作者文档与原运行case分离，原场景/计划/控制/trace/native/WASM及adapter不变。；严格四字段viento-runtime-case-document schema1，sceneObjectId唯一关联权威，case原DTO；256KiB UTF8/重复键/结构/稳定实例与定义登记边检查。；普通文档UUID/类型登记与原子正文写，source SHA CAS及scene SHA/record在publish前再观察；拒force及互斥create/update，失败撤回本操作descriptor/临时正文，精确原文保持。；新独立GUI文档控制器，显式fresh catalog/load/save/new，token仅authheaders，错误/冲突/late响应保留草稿和光标；pending save关闭标未确认，readonly关闭不标；三语窄屏。；正文派生case→scene依赖、scene可选children；catalog/reader/import检查声明、instance/definition边和目标hash，只有已声明pinned requirement availability在reader延期，import完整复查。；路径迁移保留全部UUID/BOM/CRLF/作者字节，无UUID clone/自动预期学习；完整archive保留损坏可修正文，selective package拒不完整用例。；保存与引擎任务槽解耦，fresh作者读取不能用frozen缓存代替；已载入纯case可sourceoffline对同scene frozen运行，scene绑定不符在job/session前拒。；准备桌面实际Node/双引擎与原生完整归档；移动仅可移植规则与准入desktop采样，不是Android执行/界面/安装验收。。

下一步：分别定义用例分组、批量验收、作者行为和更丰富运行观察；不从稳定ID迁移推导UUID克隆或跨引擎任意脚本转换。

<a id="runtime.case_suites"></a>
### 同场景有序验收组与宿主批次调度

`runtime.case_suites` · 场景与构建 · 源码交付

入口：已保存用例→按顺序选入/保存组→owned suite-run→成员结果/取消；CLI --runtime-suite

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **runtime-case-suite.mjs：纯组准入、依赖、联合预算与汇总**；组成员、共享场景准入、联合预算与独立结果汇总 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-suites/results.json](../docs/test-results/runtime-case-suites/results.json)、[docs/test-results/runtime-case-suites/browser/browser.json](../docs/test-results/runtime-case-suites/browser/browser.json)、[docs/test-results/runtime-case-suites/packaged-resources.json](../docs/test-results/runtime-case-suites/packaged-resources.json) |
| 可移植 JS 语义 | **runtime-case-document.mjs：可移植工程包装与场景绑定**；沿用原用例绑定及抽出的共享场景依赖检查 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-suites/results.json](../docs/test-results/runtime-case-suites/results.json)、[docs/test-results/runtime-case-suites/browser/browser.json](../docs/test-results/runtime-case-suites/browser/browser.json)、[docs/test-results/runtime-case-suites/packaged-resources.json](../docs/test-results/runtime-case-suites/packaged-resources.json) |
| 本机服务与适配 | **runtime-author-documents / runtime-case-suites：共享作者守护与整批捕获**；复用原作者原子保存和修订保护，一次捕获全体成员 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-suites/results.json](../docs/test-results/runtime-case-suites/results.json)、[docs/test-results/runtime-case-suites/browser/browser.json](../docs/test-results/runtime-case-suites/browser/browser.json)、[docs/test-results/runtime-case-suites/packaged-resources.json](../docs/test-results/runtime-case-suites/packaged-resources.json) |
| 本机服务与适配 | **node-runtime-case-suite.mjs：复用有限会话的宿主顺序调度**；宿主顺序旧无头会话、取消等待退出和独立回执 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-suites/results.json](../docs/test-results/runtime-case-suites/results.json)、[docs/test-results/runtime-case-suites/browser/browser.json](../docs/test-results/runtime-case-suites/browser/browser.json)、[docs/test-results/runtime-case-suites/packaged-resources.json](../docs/test-results/runtime-case-suites/packaged-resources.json) |
| 本机服务与适配 | **node-execution-backends.mjs / node-project-build.mjs：可信注册、输出与冻结编排**；构建/快照共同验证与owner准入复查，旧后端执行器不改 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-suites/results.json](../docs/test-results/runtime-case-suites/results.json)、[docs/test-results/runtime-case-suites/browser/browser.json](../docs/test-results/runtime-case-suites/browser/browser.json)、[docs/test-results/runtime-case-suites/packaged-resources.json](../docs/test-results/runtime-case-suites/packaged-resources.json) |
| 存储与事务 | **resource-package-service.mjs / resource-package-export.mjs 等**；组→成员→场景闭包、requirements/目标字节核验与路径稳定迁移 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-suites/results.json](../docs/test-results/runtime-case-suites/results.json)、[docs/test-results/runtime-case-suites/browser/browser.json](../docs/test-results/runtime-case-suites/browser/browser.json)、[docs/test-results/runtime-case-suites/packaged-resources.json](../docs/test-results/runtime-case-suites/packaged-resources.json) |
| 交互与渲染 | **app-runtime-case-suites.js：独立组编辑与进度展示**；显式有序成员/保存/载入/另存及批次结果，保留未知回执状态 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-suites/results.json](../docs/test-results/runtime-case-suites/results.json)、[docs/test-results/runtime-case-suites/browser/browser.json](../docs/test-results/runtime-case-suites/browser/browser.json)、[docs/test-results/runtime-case-suites/packaged-resources.json](../docs/test-results/runtime-case-suites/packaged-resources.json) |
| 交互与渲染 | **app-project-build.js**；父工作台只调用宿主批次与状态轮询，单case生成严格区分 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-suites/results.json](../docs/test-results/runtime-case-suites/results.json)、[docs/test-results/runtime-case-suites/browser/browser.json](../docs/test-results/runtime-case-suites/browser/browser.json)、[docs/test-results/runtime-case-suites/packaged-resources.json](../docs/test-results/runtime-case-suites/packaged-resources.json) |
| 验证与维护 | **node-execution-tool.mjs / project-build.mjs：可信host和CLI后端选择**；CLI互斥组模式，注册UUID/相对path与可信工具边界 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-suites/results.json](../docs/test-results/runtime-case-suites/results.json)、[docs/test-results/runtime-case-suites/browser/browser.json](../docs/test-results/runtime-case-suites/browser/browser.json)、[docs/test-results/runtime-case-suites/packaged-resources.json](../docs/test-results/runtime-case-suites/packaged-resources.json) |

平台：Linux本机workbench/Node/CLI可信Godot与Bevy、纯规则可准备到移动资源；不含Android引擎宿主、0.0.9源码交付；未验收新安装/设备。。边界：0.0.9源码交付；原0.0.8阶段协议与边界保留。0.0.8之后未发布工作树；组与用例正文分开，原控制/trace/作者场景/plan/adapter/native/WASM保持。；严格四字段viento-runtime-case-suite schema1，16KiB、1–16同场景注册JSON成员、稳定UUID有序不重复；actor×总steps≤4096/总checks≤1024，全部预检后才分配job。；共享场景准入在成员正文延期时仍检查包内已知scene，reader只声明requirements缺正文延期，import真实目标再核验；完整迁移/路径变化保持原字节与UUID。；共享作者writer复用原登记锁、原子正文、source/scene SHA与publication guards；fresh组/成员来源，GUI显式保存/载入/另存，未知回执阻止重复写。；Node一次捕获所有成员与版本，逐成员复用现有headless executor，每份再检查frozen build/snapshot/tool；等待时被prune的owner在job前拒绝。；断言failed继续，进程/协议失败、timeout/cancel停余项为not-run；保持partial samples，等待reap释放唯一slot；final committed结果不被迟到cancel重写。；独立suite缓存原子receipt记录顺序/版本/session/counts，执行status与汇总status分开；GUI不启动队列、不从suite last samples生成单case。；真实Linux Chrome及prepared Node/Godot/Bevy/native archive限定验证；mobile仅pure数据，不是Android执行/安装验收。。

下一步：分别定义更丰富状态检查、作者行为、嵌套或并行组；不推导自动更新预期、UUID克隆或引擎脚本互译。

<a id="runtime.case_reports"></a>
### 当前批次成员详情与独立报告导出

`runtime.case_reports` · 场景与构建 · 源码交付

入口：已完成suite成员→当前owned job/member只读回读→预期/实际详情→显式JSON下载

| 架构 | 实现／职责 | 四项评分 | 证据入口 |
| --- | --- | --- | --- |
| 可移植 JS 语义 | **runtime-case-report.mjs：严格便携报告与完整重新评价**；纯报告契约、完整重新评价和数据预算 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-reports/results.json](../docs/test-results/runtime-case-reports/results.json)、[docs/test-results/runtime-case-reports/browser/browser.json](../docs/test-results/runtime-case-reports/browser/browser.json)、[docs/test-results/runtime-case-reports/packaged-resources.json](../docs/test-results/runtime-case-reports/packaged-resources.json) |
| 本机服务与适配 | **runtime-case-reports / project-build-service：可信文件pin和当前成员只读归属**；可信报告文件pin/稳定回读与当前任务归属 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-reports/results.json](../docs/test-results/runtime-case-reports/results.json)、[docs/test-results/runtime-case-reports/browser/browser.json](../docs/test-results/runtime-case-reports/browser/browser.json)、[docs/test-results/runtime-case-reports/packaged-resources.json](../docs/test-results/runtime-case-reports/packaged-resources.json) |
| 本机服务与适配 | **node-runtime-case-suite.mjs：复用有限会话的宿主顺序调度**；终态成员保存报告、保留断言及IO失败停止余项 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-reports/results.json](../docs/test-results/runtime-case-reports/results.json)、[docs/test-results/runtime-case-reports/browser/browser.json](../docs/test-results/runtime-case-reports/browser/browser.json)、[docs/test-results/runtime-case-reports/packaged-resources.json](../docs/test-results/runtime-case-reports/packaged-resources.json) |
| 交互与渲染 | **app-runtime-case-report.js：独立三语详情与显式JSON导出**；实例步骤预期/实际/容差及显式独立JSON下载 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-reports/results.json](../docs/test-results/runtime-case-reports/results.json)、[docs/test-results/runtime-case-reports/browser/browser.json](../docs/test-results/runtime-case-reports/browser/browser.json)、[docs/test-results/runtime-case-reports/packaged-resources.json](../docs/test-results/runtime-case-reports/packaged-resources.json) |
| 交互与渲染 | **app-project-build.js**；父工作台接详情callback，保持编辑稿/引擎任务独立 | 3 / 3 / 4 / 3 | [docs/test-results/runtime-case-reports/results.json](../docs/test-results/runtime-case-reports/results.json)、[docs/test-results/runtime-case-reports/browser/browser.json](../docs/test-results/runtime-case-reports/browser/browser.json)、[docs/test-results/runtime-case-reports/packaged-resources.json](../docs/test-results/runtime-case-reports/packaged-resources.json) |

平台：Linux本机workbench/Node可信Godot与Bevy、纯报告入口可准备到移动资源；没有Android报告宿主或引擎验收、0.0.9源码交付；未验收新安装/设备。。边界：0.0.9源码交付；原0.0.8阶段协议与边界保留。0.0.8之后未发布工作树；report输出格式独立，不改作者case/suite/scene、plan/control/trace、adapter/native/WASM。；严格八字段viento-runtime-case-report schema1，十字段捕获上下文、实例目标、终态、原用例/采样与完整重新评价；UTF8 compact+newline≤2MiB，原64step/128actor/1024actor-step/128check预算。；纯validator只证明结构/评价一致，录入context为provenance，不能认证任意外部JSON的引擎执行或原作者字节；不合成事件/采样交错回放。；可信宿主固定member-UUID文件，wx0600临时+exclusive原子发布，读取拒绝符号链接/文件替换并核对rawSHA/context/definitionSHA；私有pin/路径不进入HTTP。；调度器保存committed叶结果后再发布reportAvailable；保存失败停止余项但保留真实execution/assertions/samples，末成员完整汇总不掩盖报告IO错误。；只允许当前service当前suite job/member UUID回读，不占执行slot、不读作者/工具/build；源离线/build被清理可读，新job/close/迟到owner拒绝，旧cache不扫描接管。；独立三语GUI核验context及public叶counts/state；可查看前面failed/partial报告，explicit Blob下载，不写草稿/自动预期，不导入外部report。；本轮实际Chrome/pinnedNode双引擎与mobile pure范围见results；无新installer/已安装Tauri/Androidhost或device。。

下一步：单独设计跨重启报告历史、缓存管理和批次报告包；更广状态预期与引擎行为能力沿原边界演进。

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

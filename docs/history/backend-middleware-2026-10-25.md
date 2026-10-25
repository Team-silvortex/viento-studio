# BACKEND_MIDDLEWARE.md 历史说明归档

归档日期：2026-10-25。以下内容从[当前指南](../BACKEND_MIDDLEWARE.md)移出，保留原记录的开发时点、版本和验收边界；其中“当前”“工作树”“未发布”和安装状态均指原记录时点。当前交付状态见[状态页](../STATUS.md)，原专题与发布记录保持不变。

## 历次增量前言

**0.2.0 后当前工作树**增加显式[逐实例动画运行](../BACKEND_MIDDLEWARE.md#逐实例动画的后端准入)：作者动画4映射动画子计划3，仅instance项目选择协议11／Godot适配器0.20.0／清单12。旧整场景分支、独立预览与原作者脚本保持；本轮未发布或更新安装。

**0.1.8 源码收录**：自然完成通知、状态表与条件、版本化源码重编辑、参数接口及脚本使用位置已纳入[本版](../RELEASE_0.1.8.md)。0.1.8发布时Godot适配器0.16.0，新含动画项目使用protocol 7／清单8，22模块／43项声明能力保持；下述较早阶段的版本与验证条件按当时范围保留，本次未更新安装。

**此前0.1.7开发阶段**增加独立自然完成契约及订阅：新含动画项目使用 Godot 0.16.0／project protocol 7／清单 8，旧协议 1–6 继续可读取，无动画生成仍为 protocol 4。完成来源是冻结动画／片段，接收来源才是行为；不借用事件发布者，也不把渲染节点泄露给脚本。见[架构](../ARCHITECTURE.md#动画自然完成的独立边界)。

**0.1.7 源码边界**：下述序列帧、项目动画控制和命名片段已纳入[本版](../RELEASE_0.1.7.md)。0.1.7发布时 Godot 适配器为 0.15.0；含 schema 3 动画的项目使用 protocol 6，仅旧动画使用 protocol 5，无动画使用 protocol 4，生成清单分别为 7／6／5。Bevy 两条通道仍不接视觉动画或项目组装；作者侧时长调整、轨道复制及只读目录不增加后端能力。旧段落的适配器版本与证据保留开发时点，本次未更新安装。

**命名动画片段增量**：Godot 适配器 0.15.0 声明 `animation.clips2d` 和 project protocol 6。schema 3 作者动画变为 animation-plan 2；只含旧动画的项目仍生成 protocol 5，无动画项目仍生成 protocol 4，准入按冻结计划精确匹配。protocol 6 的命令状态增加 `clipId`，片段名称、范围和来源从冻结声明派生；旧协议的精确形状和预算保持。生成清单 7 列出片段协调器，旧清单 5／6 保留。见[片段架构](../ARCHITECTURE.md#命名片段的独立边界)。

**项目动画控制增量**：含动画的组装计划独立要求后端 `project.animation-control` 能力。Godot 0.14.0 广告 project protocol 5；无动画项目的生成物允许严格匹配旧 protocol 4，其他降级不接收。执行回执由共享 Rust transport 核对，来源由冻结计划解析；后端队列不进入 UI 或作者格式。生成清单 6 显式列出控制协调器和动画队列，工程检查／ZIP 沿已验证库存工作。单场景动画继续使用原生成器。详见[架构边界](../ARCHITECTURE.md#项目动画控制的独立边界)。

**0.1.6 后工作树**新增独立 `animation.sprite2d` 准入：含等分网格序列帧的计划保留 `animation.visual2d` 并额外要求该能力，删去标记不能绕过检查。Godot 0.13.0 使用独立序列帧生成器；四属性计划继续生成原 0.12.0 文件。图片闭包沿实例现有绑定和冻结资源，不增加资源解析通路；Bevy 两通道明确拒绝。参见[动画格式](../SCENE_ANIMATION.md#等分网格序列帧)。

项目事件与声音控制接入阶段支持[项目组装](../PROJECT_ASSEMBLY.md)、[共享状态](../PROJECT_SHARED_STATE.md)、[项目事件](../PROJECT_EVENTS.md)与[行为声音控制](../PROJECT_AUDIO_CONTROLS.md)。中立 `project:1` 计划保留全部 Scene2D 子计划，Godot 适配器 `0.11.0` 声明 `project.scenes`、`project.scene-switching`、`project.shared-state`、`project.events`、`project.audio-control`，Bevy 两条通道尚不接收项目计划。独立 `VIENTO_PROJECT:` 协议 4 校验访问、嵌套事件、状态修订、事件 FIFO 投递及实际声音命令；宿主从已验证冻结工程显式选择协议。纯读取器保留协议 1／2／3，不放宽旧构建的指纹重建要求。纯账本与查询、Godot 的事件及声音队列、三类独立只读观察面板各自维护。

**0.1.3 收录说明**：本页标为 0.1.2 后工作树的多行为、脚本引用、Bevy Rust 与声音增量现已纳入[本版源码](../RELEASE_0.1.3.md)。历史版本、模块数和验收条件保留原时点；当前为 21 模块／38 项声明能力，本次未制作或更新安装包。

0.1.2 后工作树另接[独立场景声音](../SCENE_AUDIO.md)。通用计划通过唯一 `audio` 登记关系显式附加声音声明、稳定来源与已登记 WAV 资源，并要求 `audio.nonspatial`／`audio.timeline`；不改变无声音计划。Godot 适配器升至 `0.6.0`，消费独立生成器／播放器和声音事件读取器；Bevy 两条通道均在准入阶段明确拒绝，不能静默丢弃声音。应用版本仍为 `0.1.2`，旧生成工程需按适配器身份重新构建。

0.1.2 后工作树新增独立 `org.viento.bevy-rust`：复用冻结 plan／runtime 3、行为参数与事件，以及通用后端工程管理／交付。Cargo 项目生成、工具身份与临时编译留在适配器；中立行为事件校验沉淀到 `engine/scene-behavior-events.mjs`，Godot 与 Bevy Rust 共用。旧 `org.viento.bevy` 数据通道及其能力保持；具体范围见 [Bevy 指南](../BEVY_BACKEND.md)。

[工程持久管理](../BACKEND_PROJECTS.md)位于 Node 宿主与 GUI 的独立对接层：统一恢复登记与选择协议，不加入后端能力描述符，不改变工具识别、生成格式或运行协议。持久 read/run 身份凭据与创建者清理 ledger 分开；Godot／Bevy 复用冻结选择上下文，原生 ns-nova 能力仍待接入。

后端工程的来源与库存由独立[工程管理层](../BACKEND_PROJECTS.md)记录和检查。它不把引擎特定生成器规则放进 GUI，也不改变执行适配器指纹或已有冻结产物的准入。

工具身份、运行验收用例、工程内保存、有序批次及成员报告现已随 [0.0.9 源码](../RELEASE_0.0.9.md)交付；下列旧阶段名称与专题验收记录保留其原条件。

[成员报告](../RUNTIME_CASE_REPORTS.md)接在通用调度器之后，只选择既有执行终态、定义与已接收的采样。后端不实现报告队列或导出接口；文件保存／pin 回读属于可信宿主，严格评价属于纯层，详情／下载属于 GUI。相同格式覆盖 Godot 与 Bevy，不改变引擎协议或适配器指纹。

0.0.8 源码把后端能力、宿主执行编排和具体引擎实现分开，Linux 上已有 Godot 4 与 [Bevy 无头后端](../BEVY_BACKEND.md)两条受限实现。Bevy 消费无图 Scene2D plan 1／2，不接图片、作者 Rust 行为或图形运行；Godot 的[行为绑定](../SCENE_BEHAVIORS.md)另为明确关联清单的场景增加 plan／runtime 3。作者格式和既有计划／协议保持。Nuislang、ns-nova、yalivia、离屏渲染、内嵌视口或 GPU 计算仍未接入。该阶段源码版本为 0.0.10，当前安装状态见 [当前状态](../STATUS.md)。

0.0.9 的[有序验收组](../RUNTIME_CASE_SUITES.md)由通用 Node 宿主顺序复用已有无头控制会话，每份重新验证冻结产物与可信工具。全部作者成员在任务分配前捕获，组准入和结果汇总留在纯模块；后端只收到原控制程序。断言失败继续，执行失败／取消停止余项；不新增引擎队列 API。

## 中间层首次接入的指纹说明

新 `build.json` 和 `session.json` 增加独立的 `executionAdapter: { id, contractVersion, sha256 }`。中间层最初接入时，Godot 适配器指纹覆盖十二份文件：`scene-behavior-events.mjs`、`scene-runtime-events.mjs`、`godot4-adapter.mjs`、`backend-capabilities.mjs`、`node-execution-backends.mjs`、`godot4-behaviors.mjs`、`godot4/behavior-runtime.gd`、`scene-behaviors.mjs` 、`build-plan.mjs`、`scene-control-program.mjs`、`godot4/control-runtime.gd` 和 `godot4/control.tscn`；它与旧 `backend.sha256` 的生成器／运行脚本摘要分别核对。运行仍从冻结原文重建计划，核对后端、协议、工具版本与二进制摘要、生成文件清单和每份字节，才创建独立运行副本。源工程离线后可重放，工具或适配器变化要求重建。

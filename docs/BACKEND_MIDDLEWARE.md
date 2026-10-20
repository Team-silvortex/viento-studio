# 执行后端中间层

**0.1.7 源码边界**：下述序列帧、项目动画控制和命名片段已纳入[本版](RELEASE_0.1.7.md)。当前 Godot 适配器为 0.15.0；含 schema 3 动画的项目使用 protocol 6，仅旧动画使用 protocol 5，无动画使用 protocol 4，生成清单分别为 7／6／5。Bevy 两条通道仍不接视觉动画或项目组装；作者侧时长调整、轨道复制及只读目录不增加后端能力。旧段落的适配器版本与证据保留开发时点，本次未更新安装。

**命名动画片段增量**：Godot 适配器 0.15.0 声明 `animation.clips2d` 和 project protocol 6。schema 3 作者动画变为 animation-plan 2；只含旧动画的项目仍生成 protocol 5，无动画项目仍生成 protocol 4，准入按冻结计划精确匹配。protocol 6 的命令状态增加 `clipId`，片段名称、范围和来源从冻结声明派生；旧协议的精确形状和预算保持。生成清单 7 列出片段协调器，旧清单 5／6 保留。见[片段架构](ARCHITECTURE.md#命名片段的独立边界)。

**项目动画控制增量**：含动画的组装计划独立要求后端 `project.animation-control` 能力。Godot 0.14.0 广告 project protocol 5；无动画项目的生成物允许严格匹配旧 protocol 4，其他降级不接收。执行回执由共享 Rust transport 核对，来源由冻结计划解析；后端队列不进入 UI 或作者格式。生成清单 6 显式列出控制协调器和动画队列，工程检查／ZIP 沿已验证库存工作。单场景动画继续使用原生成器。详见[架构边界](ARCHITECTURE.md#项目动画控制的独立边界)。

**0.1.6 后工作树**新增独立 `animation.sprite2d` 准入：含等分网格序列帧的计划保留 `animation.visual2d` 并额外要求该能力，删去标记不能绕过检查。Godot 0.13.0 使用独立序列帧生成器；四属性计划继续生成原 0.12.0 文件。图片闭包沿实例现有绑定和冻结资源，不增加资源解析通路；Bevy 两通道明确拒绝。参见[动画格式](SCENE_ANIMATION.md#等分网格序列帧)。

当前未发布工作树支持[项目组装](PROJECT_ASSEMBLY.md)、[共享状态](PROJECT_SHARED_STATE.md)、[项目事件](PROJECT_EVENTS.md)与[行为声音控制](PROJECT_AUDIO_CONTROLS.md)。中立 `project:1` 计划保留全部 Scene2D 子计划，Godot 适配器 `0.11.0` 声明 `project.scenes`、`project.scene-switching`、`project.shared-state`、`project.events`、`project.audio-control`，Bevy 两条通道尚不接收项目计划。独立 `VIENTO_PROJECT:` 协议 4 校验访问、嵌套事件、状态修订、事件 FIFO 投递及实际声音命令；宿主从已验证冻结工程显式选择协议。纯读取器保留协议 1／2／3，不放宽旧构建的指纹重建要求。纯账本与查询、Godot 的事件及声音队列、三类独立只读观察面板各自维护。

**0.1.3 收录说明**：本页标为 0.1.2 后工作树的多行为、脚本引用、Bevy Rust 与声音增量现已纳入[本版源码](RELEASE_0.1.3.md)。历史版本、模块数和验收条件保留原时点；当前为 21 模块／38 项声明能力，本次未制作或更新安装包。

0.1.2 后工作树另接[独立场景声音](SCENE_AUDIO.md)。通用计划通过唯一 `audio` 登记关系显式附加声音声明、稳定来源与已登记 WAV 资源，并要求 `audio.nonspatial`／`audio.timeline`；不改变无声音计划。Godot 适配器升至 `0.6.0`，消费独立生成器／播放器和声音事件读取器；Bevy 两条通道均在准入阶段明确拒绝，不能静默丢弃声音。应用版本仍为 `0.1.2`，旧生成工程需按适配器身份重新构建。

0.1.2 后工作树新增独立 `org.viento.bevy-rust`：复用冻结 plan／runtime 3、行为参数与事件，以及通用后端工程管理／交付。Cargo 项目生成、工具身份与临时编译留在适配器；中立行为事件校验沉淀到 `engine/scene-behavior-events.mjs`，Godot 与 Bevy Rust 共用。旧 `org.viento.bevy` 数据通道及其能力保持；具体范围见 [Bevy 指南](BEVY_BACKEND.md)。

[工程持久管理](BACKEND_PROJECTS.md)位于 Node 宿主与 GUI 的独立对接层：统一恢复登记与选择协议，不加入后端能力描述符，不改变工具识别、生成格式或运行协议。持久 read/run 身份凭据与创建者清理 ledger 分开；Godot／Bevy 复用冻结选择上下文，原生 ns-nova 能力仍待接入。

后端工程的来源与库存由独立[工程管理层](BACKEND_PROJECTS.md)记录和检查。它不把引擎特定生成器规则放进 GUI，也不改变执行适配器指纹或已有冻结产物的准入。

工具身份、运行验收用例、工程内保存、有序批次及成员报告现已随 [0.0.9 源码](RELEASE_0.0.9.md)交付；下列旧阶段名称与专题验收记录保留其原条件。

[成员报告](RUNTIME_CASE_REPORTS.md)接在通用调度器之后，只选择既有执行终态、定义与已接收的采样。后端不实现报告队列或导出接口；文件保存／pin 回读属于可信宿主，严格评价属于纯层，详情／下载属于 GUI。相同格式覆盖 Godot 与 Bevy，不改变引擎协议或适配器指纹。

0.0.8 源码把后端能力、宿主执行编排和具体引擎实现分开，Linux 上已有 Godot 4 与 [Bevy 无头后端](BEVY_BACKEND.md)两条受限实现。Bevy 消费无图 Scene2D plan 1／2，不接图片、作者 Rust 行为或图形运行；Godot 的[行为绑定](SCENE_BEHAVIORS.md)另为明确关联清单的场景增加 plan／runtime 3。作者格式和既有计划／协议保持。Nuislang、ns-nova、yalivia、离屏渲染、内嵌视口或 GPU 计算仍未接入。源码版本为 0.0.10，安装状态见 [当前状态](STATUS.md)。

0.0.9 的[有序验收组](RUNTIME_CASE_SUITES.md)由通用 Node 宿主顺序复用已有无头控制会话，每份重新验证冻结产物与可信工具。全部作者成员在任务分配前捕获，组准入和结果汇总留在纯模块；后端只收到原控制程序。断言失败继续，执行失败／取消停止余项；不新增引擎队列 API。

## 三层职责

```mermaid
flowchart LR
  UI[构建工作台] --> Admission[可移植能力检查]
  UI --> Service[本机任务服务]
  Service --> Executor[通用冻结构建与会话编排]
  Executor --> Registry[宿主固定后端注册表]
  Registry --> Godot[Godot 4 执行适配器]
  Registry --> Bevy[Bevy 数据执行适配器]
  Registry --> Rust[Bevy Rust 执行适配器]
  Rust --> Cargo[冻结 Cargo 源工程与临时编译]
  Rust --> BehaviorEvents[中立行为事件校验]
  Behaviors --> BehaviorEvents
  Godot --> Dispatch[保留原字节的 v1/v2 生成器与运行脚本]
  Godot --> Behaviors[显式行为的 v3 生成与事件协议]
  Bevy --> Host[预编译可信 Rust/Bevy 运行程序]
  Bevy --> Events[中立 Scene2D 事件校验]
  Executor --> Records[快照、产物、来源与会话记录]
```

| 层次 | 实现 | 负责内容 |
| --- | --- | --- |
| 可移植有限控制 | `engine/scene-control-program.mjs` | 检查全局／按实例方向布尔程序、冻结实例目标、时长及输入行／联合对象预算；按行准入有限步骤样本与生命周期，不模拟移动、不携引擎句柄 |
| 可移植运行观察 | `engine/scene-runtime-query.mjs` | 从已验证 plan 1／2／3 建立独立身份／来源视图，消费准入事件并按实例／定义筛选；不启动进程、不查询引擎反射 |
| 可移植能力契约 | `engine/backend-capabilities.mjs` | 校验纯数据描述符，分别检查执行操作、平台、计划版本和功能需求；不接触文件、进程、DOM 或具体引擎 |
| 可移植工具状态 | `engine/execution-tool-status.mjs` | 严格校验身份检查状态及版本／摘要；不携工具路径、进程输出或执行权限 |
| 宿主中间层 | `scripts/adapters/node-execution-backends.mjs`、`node-project-build.mjs`、`scripts/lib/project-build-service.mjs` | 捕获已保存输入，固定后端身份与可信实现，校验输出与冻结回放，管理任务、取消、进程结果及记录 |
| 具体执行适配器 | `scripts/backends/godot4-adapter.mjs`、`bevy-adapter.mjs`、`bevy-rust-adapter.mjs` | 各引擎的工具识别、生成入口、阶段、命令行参数、环境、协议事件、诊断和缓存回收 |

注册表由本机程序以可信实现创建；它复制并冻结描述符、阶段列表和调用入口。HTTP 和工程文件不能注册代码、加载模块或传入可执行文件与输出路径。服务由宿主选择一个后端，网页没有引擎选择下拉框；源码 CLI 可以明确选择已登记的后端与本机工具。Bevy Rust 也沿用相同输入、输出和冻结运行检查，Cargo 编译只存在于其固定适配器内部，不增加通用动态编译或可执行文件交付钩子。这不是已冻结的通用插件 ABI。

## 描述符与能力检查

描述符使用 `format: "viento-execution-backend"`、`schemaVersion: 1`，精确包含以下字段。作者格式版本、描述符版本和运行协议分别管理。

| 字段 | 约定 |
| --- | --- |
| `id`、`label`、`version` | 点分命名空间身份、展示名称、无前导零的 `x.y.z` 适配器版本；当前为 `org.viento.godot4`、`Godot 4`、`0.11.0` |
| `platforms` | 无重复的平台标识数组；当前 Godot 适配器仅声明 `linux` |
| `plans` | `{ kind, schemaVersion, runtimeProtocolVersion }` 数组，按 kind／schema 唯一；Scene2D plan 1／2／3 分别绑定 runtime 1／2／3，3 用于显式行为。另有 project plan 1／项目运行协议 4；每次访问嵌套对应子场景的原协议。通用描述符也接受 project runtime 1／2／3，由具体适配器显式声明 |
| `capabilities` | 无重复的功能标识数组；当前为 `scene2d`、`input.arrows`、`state.movement`、`image`、`behavior.bindings`、`behavior.gdscript`、`runtime.control-replay`、`runtime.control-replay.instances`、`audio.nonspatial`、`audio.timeline`、`project.scenes`、`project.scene-switching`、`project.shared-state`、`project.events`、`project.audio-control` |
| `execution` | 下表七个键都必须存在并为布尔值 |
| `extensions` | `{ id, version }` 数组，ID 必须处于后端自身命名空间；仅描述能力扩展身份，不含代码或路径 |

| 执行操作 | Godot 4 | Bevy 数据 | Bevy Rust | 含义 |
| --- | --- | --- | --- | --- |
| `build` | `true` | `true` | `true` | Godot 导入／检查脚本；Bevy 数据检查场景；Bevy Rust 检查 Cargo 源工程 |
| `headlessLogic` | `true` | `true` | `true` | 独立进程执行无头逻辑测试 |
| `windowPreview` | `true` | `false` | `false` | 独立正常窗口运行 |
| `windowCapture` | `true` | `false` | `false` | 窗口 smoke 运行生成截图；也必须声明窗口预览能力 |
| `offscreenRender` | `false` | `false` | `false` | 当前没有离屏渲染实现 |
| `embeddedViewport` | `false` | `false` | `false` | 当前没有嵌入编辑器的运行视口 |
| `gpuCompute` | `false` | `false` | `false` | 当前没有 GPU 计算接口 |

上方字段表列出 Godot 声明。Bevy 的 ID 为 `org.viento.bevy`、适配器／可信运行程序版本为 `0.3.0`，仅声明 Linux、scene2d plan／runtime 1／2，以及 `scene2d`、`input.arrows`、`state.movement`、`runtime.control-replay`、`runtime.control-replay.instances`；`extensions` 为空。带图片或行为的计划不能因同为 Scene2D 而绕过能力检查。

Bevy Rust 的适配器版本为 `0.2.0`，仅支持无图 plan／runtime 3，声明 `scene2d`、`input.arrows`、`state.movement`、`behavior.bindings`、`behavior.rust`。固定步接口是 Rust 运行模板内的实例能力：`ready` 显式登记更新函数，固定时间步与自身位置命令由运行时管理；通用宿主仍只接收已有协议事件，不识别作者 Rust 函数。编译缓存属于可回收宿主临时目录；工程清单只含冻结源码。

无头逻辑能力不推导出渲染能力；命名空间中的原生扩展信息也不表示已经能执行原生代码。当前 Godot 的 `extensions` 为空。生成器保留其历史后端元数据与摘要，描述符 `version` 不替换历史生成器版本。

`validateExecutionBackendDescriptor(input)` 返回与输入分离且递归冻结的描述符，未知字段、非数据成员、自定义原型、访问器、循环、稀疏数组和预算超限会被拒绝；访问器不会在校验过程中运行。错误为 `TypeError`，`errorCode` 为 `build_backend_invalid`。

`checkExecutionBackendSupport(descriptor, { operation, platform?, plan? })` 返回诊断数组，空数组表示这组声明支持该请求。缺操作或操作为 `false` 返回 `build_execution_unsupported`；平台不符为 `build_platform_unsupported`；计划格式、种类或版本不符为 `build_backend_plan_unsupported`；缺功能仍使用 `build_capability_missing`，保留场景 UUID、逻辑路径与原有空 JSON Pointer。无效 DTO 或未知操作拒绝为 `build_backend_invalid`。`canExecuteBackend(descriptor, operation, platform?)` 为 UI 提供失败时返回 `false` 的便利检查，不查找工具，也不启动运行。

## 宿主适配与冻结回放

适配器 contract version 1 提供描述符、构建／运行准备阶段，以及 `availability`、`identify`、`generate`、`fingerprint`、`executePhase`、`diagnostics`、`createEventReader`、`cleanupProject` 入口。可执行函数仅存在于可信宿主实现中。通用执行器消费这些入口，不包含 Godot 命令行参数、环境变量、缓存名或生成文件名。

工程管理增量给构建后的 `cleanupProject(directory, context)` 另传可信的 `generatedFiles` 与 `resourceFiles` 相对路径列表；适配器可忽略此可选上下文。Godot 只清除这些已知输入对应的 UID／导入辅助文件，未知内容留给统一库存检查和保留规则。宿主不按后端名称猜测缓存文件。

生成结果通过 `files`、中立的 `resourceFiles`（资源 UUID → 相对文件路径）、`sourceMap`、历史 `backend` 元数据和 `artifact` 描述交付。宿主先校验并复制结果，再创建输出目录：拒绝绝对路径、路径逃逸、文件与资源冲突、同一路径同时作文件和目录、缺少入口及预算超限。构建输出始终位于作者工程和实际素材目录之外。具体引擎如何组织自己的生成项目，属于适配器职责。

新 `build.json` 和 `session.json` 增加独立的 `executionAdapter: { id, contractVersion, sha256 }`。Godot 适配器指纹覆盖十二份文件：`scene-behavior-events.mjs`、`scene-runtime-events.mjs`、`godot4-adapter.mjs`、`backend-capabilities.mjs`、`node-execution-backends.mjs`、`godot4-behaviors.mjs`、`godot4/behavior-runtime.gd`、`scene-behaviors.mjs` 、`build-plan.mjs`、`scene-control-program.mjs`、`godot4/control-runtime.gd` 和 `godot4/control.tscn`；它与旧 `backend.sha256` 的生成器／运行脚本摘要分别核对。运行仍从冻结原文重建计划，核对后端、协议、工具版本与二进制摘要、生成文件清单和每份字节，才创建独立运行副本。源工程离线后可重放，工具或适配器变化要求重建。

显式兼容旧记录的已知 Godot 适配器允许没有 `executionAdapter` 字段的历史构建，仍执行旧生成器、工具和产物检查。新字段存在时必须精确匹配；其他后端不能因为字段缺失而自动获得兼容。原作者正文、UUID、登记、图片、Scene2D 格式和历史生成脚本不因此迁移。原无行为 plan／runtime 1／2 保持，行为清单明确选择新增 plan／runtime 3。

本机状态返回平台、完整描述符，以及 `job.backendId`／`latestBuild.backendId`。构建工作台分别判断构建、无头测试和窗口预览，并把描述符变化视为旧计划和产物批准失效；后端身份不符的任务不能授权新操作。界面保留中英日翻译、草稿保护、诊断导航及关闭后任务观察。工具路径仍来自宿主配置，HTTP 仅接受既有场景、任务和产物身份。

## 工具身份检查（未发布增量）

工作台新增 **检查工具身份**，源码 CLI 新增 `--command tool-check`。两者共用 `node-execution-tool-probe.mjs`，先确认宿主配置的候选文件，再调用可信适配器的既有 `identify`，最后复查候选。版本兼容规则仍由 Godot／Bevy 各自维护；没有为检查新增执行操作、适配器版本或运行协议。

公共数据是 `viento-execution-tool-status` schema 1：精确字段为 `format`、`schemaVersion`、`backendId`、`status`、`reason`、`identity`。四种状态为 `unchecked`、`checking`、`ready`、`unavailable`；只有 `ready` 携带 `{version, sha256, platform, arch}`，摘要为二进制完整字节的 64 位小写 hex。失败原因限 `tool_missing`、`platform_unsupported`、`tool_version`、`tool_timeout`、`tool_output_limit`、`tool_failed`、`tool_cancelled`、`tool_changed`。DTO 严格分离并冻结，拒绝额外字段、访问器和原型污染；不返回路径、原始输出或异常文本。

`GET /api/project-build` 只观察文件权限、解析路径和文件状态，不启动工具。身份检查须显式 `POST {"action":"tool-check"}`，不能附场景、后端、路径或其他字段，沿用本机连接和编辑鉴权。服务同时只允许一个检查或构建任务；检查不创建任务、不替换最近产物、计划批准或运行观察。未保存草稿不阻止检查。关闭宿主会取消检查并等待进程回收；网页关面板不会结束宿主检查。

总检查预算默认 12 秒，包含文件身份与版本检查；既有适配器版本进程仍有 10 秒／合计 1 MiB 输出限制，取消清理可能稍后完成。CLI 可指定 1–12000 毫秒的更短预算。缓存只属于当前服务内存，以私有候选摘要失效；文件、权限或链接目标变化后显示未检查。检查失败禁用构建／运行，检查计划及静态预览仍可使用。`ready` 只描述检查当时的事实；实际构建／运行继续重新识别工具并校验冻结二进制摘要，检查不能授予执行权限或绕过旧记录验证。工具发现、图形配置和安装仍待开发。

源码版本仍为 0.0.8；本轮结果见[工具检查验证](test-results/runtime-tool-probe/results.json)，没有更新安装版。

本轮还修复任务状态与作者目录的耦合：服务已成功读取目录且拥有成功冻结构建时，后续源工程不可读取不会中断工具／运行状态。保留上次目录并返回无路径的 `catalogDiagnostic: {code: "build_catalog_unavailable"}`，界面单独提示；重新读到源工程后清除提示。新计划／构建始终重新读取作者目录，不能借旧列表启动；已有冻结产物的运行、inspect、取消及工具检查继续可用。首次目录读取失败仍报错，不伪造有效工程。

## 运行验收用例（未发布增量）

[有限用例](RUNTIME_CASES.md)在通用宿主组合控制回放与可移植评判，沿用已有执行操作和适配器接口。纯层检查有限方向程序、plan 2 实例目标、步骤与显式位置容差／状态预期；宿主从严格 trace 取得样本并给出真实运行完成事实。会话追加独立 `verification`，不把断言失败写成引擎进程失败，取消／协议错误不补造通过证据。HTTP 输入只含纯数据且在任务分配前准入；Godot／Bevy 仍各自执行控制程序，无新引擎接口、计划、trace 或设备句柄。

## 运行对象观察

当前新增[运行对象](RUNTIME_OBJECTS.md)沿用 adapter contract version 1 与已有运行协议。通用执行器在工具与产物全部校验后建立观察，先发布分离的 runtime 视图，再通知原始事件；任务服务的完整视图独立于 128 条事件环，终态会话保留最后有效观察。来源仅取冻结声明，状态事件不更新坐标；取消或错误不补造 finished 样本。

HTTP inspect 只接受当前任务 UUID 及可选实例／定义 UUID，绕过新任务和工具可用性门禁，只读服务拥有的当前 run 任务。界面从 status.job.runtime 本地筛选，不向引擎发送查询或修改。该共同能力由 Godot／Bevy 的实际现有事件验证，无需加入 Entity、RPC、动态编译或渲染接口。

## 验证与下一步

当前另接入[有限控制回放](RUNTIME_CONTROL.md)：宿主冻结与记录纯方向程序；schema 2 提前按已验证 plan 2 核对实例 UUID，后端同时声明实例回放能力，未列实例由运行程序逐步释放。适配器在独立会话暂存驱动／程序，两引擎自行执行移动；可移植准入器按原顺序处理 runtime 与 trace 帧，样本进入同一对象观察。作者场景、旧计划、原构建库存及 adapter contract version 1 保持；`executePhase` 只增加可选 `controlProgram` 数据参数，不增加 stdin、RPC 或 Entity 接口。每次回放都继续核对工具、适配器、快照和产物摘要；没有程序的旧运行方式不增加控制字段。

此前中间层轮次的[验证记录](test-results/backend-middleware/results.json) 区分纯能力契约、Godot 包装适配器、通用宿主、真实 Godot、浏览器及打包资源。替代后端夹具仅用于测试通用执行器可注入另一种输出布局和阶段；它不是产品第二引擎，也不证明 Bevy、Nuis 或 GPU 已接入。已有冻结生成物与历史证据继续按原条件保留。

专项命令和平台要求见 [验证指南](TESTING.md#执行后端中间层)。GDScript 源码、参数、事件与来源的独立范围见[场景行为](SCENE_BEHAVIORS.md)；Bevy 实际工具链、同计划双引擎比较和受限能力见 [Bevy 指南](BEVY_BACKEND.md)。`engine/scene-runtime-events.mjs` 独立校验 Scene2D 运行身份、状态和生命周期；Bevy 不导入 Godot 生成器或事件读取器，旧 Godot 文件保持原字节。现有实例观察已由两个真实后端共同验证；有限控制只增加固定步骤采样，后续连续实时采样、资源或行为能力仍由真实需求推动，不提前授予 BRP、反射、作者 Rust 行为或资源通道。作者数据仍由原文、登记和素材维护，设备句柄与执行实现不进入工程迁移包。

运行验收的工程保存层见[用例文档](RUNTIME_CASES.md#工程内保存与迁移未发布增量)：只保存场景稳定身份与纯用例，文档读写／包迁移由作者宿主处理；Godot 和 Bevy 继续收到原控制程序，不读取项目路径、包装或登记元数据。

## 声音领域的具体适配

共享 Rust 定义音轨、播放／停止提示及显式时刻的声明状态；schema 1 允许 0–64 个提示，空提示不新增 ABI，也不替代项目声音命令账本。可移植计划层核对关联与来源，宿主冻结层读取真实资源并校验哈希及 PCM16 WAV 容器。音频文件限制单／双声道、8–96 kHz、每份不超过 32 MiB；文档播放器支持的其他音频格式不自动成为执行后端能力。

Godot 生成工程把音频映射至独立资源路径，普通图像及行为生成保持各自模块。运行器使用独立 `AudioStreamPlayer` 与每轨流副本处理音量、循环和 play／stop；有限 smoke 观察 0、0.25、0.5 秒，窗口运行由实际场景时间推进。`music`／`effect` 不映射为混音总线或空间节点。声音帧使用独立 `VIENTO_AUDIO` 协议 1，由 `scene-audio-events.mjs` 与已有演员／行为读取器组合；受冻结身份、顺序、预算与来源限制，不给 GUI 发引擎对象句柄。有限运行结束时刻另与演员固定步数交叉核对；提示保留 IEEE-754 精度，包括 0.5 秒两侧相邻 double 的触发差异。

工程库存和 ZIP 交付包含冻结的 WAV 原字节、声音清单及运行脚本。真实测试已核对异地工程文件／资源，并在 Godot 的隔离混音缓冲验证非零 PCM、零增益、停止与独立循环；这不验证实际扬声器。当前音频与有限控制回放组合明确拒绝；项目内行为触发已通过[独立声音控制](PROJECT_AUDIO_CONTROLS.md)接入；空间声音、总线、Bevy 音频及独立游戏发行仍需单独对接。见[声音指南](SCENE_AUDIO.md)和[专项验收](test-results/scene-audio/README.md)。

项目声音控制使用协议 4 的 `audio-command` 及起止命令计数，行为和音轨来源从当前冻结计划分别解析。原 `VIENTO_AUDIO` 协议 1 继续负责时间提示与声音生命周期；动态回执还需满足到期提示前缀、局部时钟及访问结束校验。Godot 独立声音队列在事件队列后排空，调用播放器后才发回执；核心没有播放器对象或磁盘读写。Godot 生成 `assembly.json` schema 5，作者组装与项目计划保持 1，旧单场景生成字节保持。

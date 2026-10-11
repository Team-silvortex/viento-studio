# 当前能力与平台

当前另接[3D 最小切片](SCENE3D.md)：独立作者表示与可选 Rust 校验能力、WebGL2 只读预览及可检查的 Godot 工程导出。方块、透视相机、方向光和变换形成完整实验链路；模型素材、空间层级、OC 投影与行为仍分别推进。独立模块仅取得来源读取接口，2D 创作域和运行协议保持。

当前 0.0.10 源码增加[片段定义重命名](SCENE_COMPOSITION.md#重命名片段定义)：Rust 原子更新定义及全部放置引用，保持稳定身份、有效场景和其他原文；复用九域中的定义管理、完整审阅、草稿应用及普通保存。旧核心只禁用此动作。证据见[独立专题](test-results/scene-composition-fragment-rename/results.json)，该专题验证在 0.0.9 工作树完成，能力纳入 0.0.10 源码。

当前 0.0.10 的 2D 主线另接[片段定义管理](SCENE_COMPOSITION.md#管理片段定义)：新增共享声明、保真复制为独立片段、移除未被放置引用的片段。原实例身份、有效字段、绘制顺序和组织关系保持，完整候选与来源检查后应用原文草稿并普通保存。首次放置另查有效投影及实际图片；实际证据见[独立记录](test-results/scene-composition-definition-authoring/results.json)。

当前 0.0.10 的 2D 主线另接[组织分组编辑](SCENE_COMPOSITION.md#编辑共享片段的组织分组)：新增组、修改名称／父级、演员归组及删除空叶组。每个引用放置保持稳定身份，完整分组语义和来源检查后普通保存；演员位置、绘制顺序及后端协议保持。实际证据见[本轮记录](test-results/scene-composition-group-authoring/results.json)。

当前 0.0.10 的 2D 主线新增[整份放置管理](SCENE_COMPOSITION.md#管理片段放置)：新增已有片段、复制偏移及覆盖、移除整份放置；独立身份和完整候选检查后应用原文草稿，再普通保存。共享 Rust 规则、纯提案、创作工作流、浏览器适配与原文宿主分别负责；不新增作者格式、引擎协议或安装包。实际验证另见[本轮记录](test-results/scene-composition-placement-structure/results.json)。

当前 0.0.10 源码新增[系统模块与工程需求](STUDIO_MODULES.md)：整个 Studio 的六个功能区经独立装配入口和各自接口接入，工程／模板可声明增量能力需求，原生实例化与迁移保留声明。普通文本不受未知需求阻断；该次模块装配切片当时未实现 3D、动态插件、热卸载或新的安装包。全量 2680 项、51 项新增专项和 7 条实际浏览器流程通过；原生宿主与 prepared 副本分别验证，详见[本轮记录](test-results/studio-system-modules/results.json)。

当前 **0.0.10 源码**已补齐[后端工程持久恢复与运行选择](BACKEND_PROJECTS.md)：Godot／Bevy 的成功工程按本机索引跨服务列出，历史工程需明确“设为运行工程”后才接入普通运行、有限控制、用例和验收组。工具缺失仍可检查／选择，作者离线只保留冻结入口；目录／清单身份变化或不同 workspace 拒绝使用。恢复工程只保留，不能因重启重建自动删除权。旧未登记产物仍由 CLI 查看，索引不进入作者迁移包。

0.0.10 源码另增加[后端工程管理](BACKEND_PROJECTS.md)：Godot 与 Bevy 保存统一来源／工具／库存清单，工作台提供本机成功工程列表与只读明细，CLI 可检查旧输出；自动清理只删除宿主原样写入的普通输出，修改、新增文件及运行报告会保留并说明原因。持久列表与运行选择见上段；生成工程回导仍未接入。

核对日期：**2026-10-11**。本页汇总当前源码的功能阶段和平台接入；操作方法见 [快速开始](GETTING_STARTED.md)，模块实现见 [系统架构](ARCHITECTURE.md)，未来工作见 [开发路线](ROADMAP.md)。按架构、实现和成熟度查薄弱环节，使用 [当前功能图谱](FUNCTION_ATLAS.md) 与 [离线交互版](function-atlas.html)。

配方九个编辑区现通过独立[创作工作流](SCENE_AUTHORING.md)连接宿主：候选验收、会话归属和浏览器连接分层，表单、画布和局部历史分别维护。构建窗口不再承担各类目标匹配，编辑区只取得自己的能力及来源状态，为后续工作流与人机交互优化保留接口。这些能力已纳入 0.0.10 源码交付。

## 版本与交付

| 层次 | 当前记录 |
| --- | --- |
| 源码版本 | **0.0.10**，交付范围见 [版本记录](RELEASE_0.0.10.md)；升版前主线验证见 [最新专题](test-results/scene3d-primitives/results.json)，历史报告保持原版本条件 |
| 本版新增 | 后端工程管理与持久恢复／显式运行选择、九个配方原文创作域、系统模块装配与模板能力需求、独立 3D 方块表示／只读预览／Godot 工程导出 |
| 配方创作交付 | 九个独立入口覆盖实例属性与恢复、单／多实例位置、共享字段与声明恢复、整组偏移、演员结构、整份放置、组织分组和片段定义（含重命名）；完整候选审阅后应用原文草稿，再普通保存 |
| 继承的源码能力 | 通用工程模板与 OC 多份投影、字段与语义编辑、媒体／资源包／完整迁移、Scene2D 实例／分组／布局、Rust 核心、源码草稿／精确补丁、片段配方、GDScript 行为、Godot 与 Bevy 执行中间层 |
| 最近保留的 Linux 安装包验收 | [0.0.4](test-results/release-0.0.4/results.json)；0.0.5–0.0.10 为源码交付，未重新制作或验收安装包 |
| 分发方式 | 从源码启动或自行构建；CI 的安装包工作流手动触发，生成构件，不自动创建 GitHub Release |

源码提交与推送不更新已有安装。本次不制作 AppImage、deb 或 APK，也不创建 GitHub Release 或版本标签；旧安装不因源码推送获得新功能。应用标识、用户数据路径、作者格式、元数据和素材保持；Godot adapter 0.5.0、Bevy adapter／可信工具 0.3.0 与原计划／trace 版本分别管理。

0.0.9 已把完整验收工作流接入现有构建工作台，0.0.10 保留该契约：检查可信工具，构建冻结实例场景，保存用例与预期，按明确成员顺序运行验收组，再查看或下载每份已完成成员的报告。断言失败继续后续成员，执行失败／取消停止余项；执行终态与断言结果分开。作者来源离线后，已经捕获的输入仍可完成运行，当前任务报告不要求回读作者或构建目录。新任务替换归属后不能通过接口读取旧报告；纯报告规则不会认证外部 JSON 的真实引擎执行。

## 已实现的能力

| 范围 | 已接通的行为 | 参考 |
| --- | --- | --- |
| 编辑与解析 | Markdown / TXT / JSON / YAML，源码、分段、字段表，原格式保留与冲突检查 | [字段编辑](FIELD_EDITING.md) |
| 工程定义 | 项目独立的文档类型、解析规则、布局分组和模板；新建可选择五类起始包 | [工程模板](PROJECT_TEMPLATES.md) |
| OC 多份投影 | 子模板继承、创建／编辑独立配置、原 OC 关联、图片同步登记、场景继承与依赖导出 | [投影指南](OBJECT_PROJECTIONS.md) |
| 配方原文创作 | 保存／草稿预览及贡献定位、单实例覆盖；当前 0.0.10 源码另接恢复继承、位置画布／原子批次、共享片段六字段设置／可选声明恢复、整组放置偏移、共享演员结构、整份放置、组织分组及片段定义管理，独立创作工作流完整检查后普通保存 | [片段组合](SCENE_COMPOSITION.md) |
| 语义查询 | World / Object / Resource 投影、字段来源、关系、诊断 | [世界与对象](WORLD_PROJECTION.md) |
| 语义写入 | `property.set`、`changeset.apply`、`object.create`、`relation.add`、`resource.bind`；`scene.create`、`scene.update`、`projection.create`、`projection.update` | [事务](WORLD_TRANSACTIONS.md)及相关命令指南 |
| 媒体与迁移 | 图片／视频／音频引用，HTML / Markdown 分享，选择式资源包，单素材导出，完整 `.viento.zip` | [导出](EXPORT.md)、[资源包](RESOURCE_PACKAGES.md) |
| 构建与运行 | Scene2D v1／v2／v3 表单创建／编辑与依赖登记、独立实例复制／重排、嵌套分组及大纲、逐字段继承覆盖、已保存布局预览、单选／多选位置拖动、按尺寸对齐、坐标编辑与显式保存、当前源码草稿的布局回写、冻结输入、Godot 生成工程、无头逻辑测试、独立窗口、诊断与取消 | [构建指南](PROJECT_BUILD.md) |
| 有限控制回放 | 全局 schema 1 支持无行为 plan 1／2，按实例 schema 2 仅冻结 plan 2；目标生成、每步独立方向与全体采样；Godot adapter 0.5.0／Bevy adapter 和可信工具 0.3.0 | [控制回放](RUNTIME_CONTROL.md) |
| 运行验收用例 | 纯控制与逐步位置／状态检查、明确生成参考预期、工程保存／载入／另存、修订冲突与断连守护、稳定身份迁移及同场景冻结重跑；仅无行为 plan 2 | [运行验收](RUNTIME_CASES.md) |
| 有序运行验收组 | 同场景稳定成员与顺序、共享作者保存、联合预算、全部捕获、断言失败继续、取消退出与独立回执；GUI／CLI 和稳定身份迁移 | [验收组](RUNTIME_CASE_SUITES.md) |
| 批次成员报告 | 每份终态定义／真实采样／重新评价，当前任务只读详情与显式 JSON 下载；离线、篡改和迟到归属保护 | [成员报告](RUNTIME_CASE_REPORTS.md) |
| 运行对象观察 | 可移植对象视图消费既有协议 1／2／3；工作台本地检索、采样阶段和原文定位，取消／错误保留最后有效样本；不提供实时反射或 RPC | [运行对象](RUNTIME_OBJECTS.md) |
| 工具身份检查 | 工作台与 CLI 显式检查确认版本／完整摘要；当前服务缓存、候选变化失效，GET 不启动进程，构建／运行仍重新识别 | [执行中间层](BACKEND_MIDDLEWARE.md) |
| 执行后端隔离 | 可移植描述符检查、可信宿主注册表、中立输出／资源映射、独立适配器指纹与冻结回放；Godot 支持构建、无头逻辑、独立窗口及窗口截图，Bevy 另接无图场景构建／无头逻辑 | [中间层契约](BACKEND_MIDDLEWARE.md)、[Bevy 指南](BEVY_BACKEND.md) |
| 场景实例行为 | 显式登记的 GDScript Node 绑定、多实例独立参数、类型化信号事件；构建／运行诊断定位到清单或源码，工作台三语展示 | [行为指南](SCENE_BEHAVIORS.md) |
| 共享 Rust 核心 | 独立 crate 共用原生与 WASM 目标；布局计算、位置草稿、100 步历史、dirty 与保存工作流已接入，另有无状态的源码检查／精确坐标补丁；GUI 使用同步 WASM，能力缺失保留旧操作和预览 | [架构边界](ARCHITECTURE.md#共享-rust-核心的运行边界) |
| 界面语言 | 简体中文、English、日本語；切换保留草稿，作品内容维持作者原文 | [语言设置](LANGUAGES.md) |

Scene2D 来源模型已在 JS 层与构建计划分离，预览字段可定位到当前原文；旧 v1 计划、快照和生成文件保持兼容。来源范围随正文修订校验，过期或近似位置不误选，未保存草稿保留。Scene2D v2 已区分实例 `instanceId` 与定义 `objectId`，同一 OC／投影可在场景中重复使用；选择、位置历史、来源和 Godot 运行事件均按实例区分。新场景默认 v2，旧 v1 保留原规则，点击“启用场景实例”后经预览保存才升级。实例仍限 1–128 个，新增 v3 支持 0–128 个组织分组、最多 16 层；大纲可折叠、检索、整组选择及定位组名原文。分组不改变绝对坐标或叠放顺序，无行为场景仍使用 plan/runtime v2。单场景未保存原文已可显式预览，支持返回编辑器修改后重开；错误保留最近有效画面，来源定位核对当前草稿摘要。预览不改登记或构建输入，草稿限 128 KiB UTF-8。当前源码模式可显式“调整草稿布局”，经完整正文审阅后仅把坐标补丁应用回文本草稿，再由主编辑器普通保存；取消保留原草稿，过期画面不能回写。保存态表单／事务布局保存仍要求先结束文本草稿。单文件片段组合已有独立与已登记模式的只读 CLI，配方复用普通文档和资源包流程，并可预览已保存或当前未保存原文、定位真实贡献来源，详见下段；单实例覆盖、共享片段六字段设置／允许的共享声明恢复与整组放置偏移可检查后应用到当前原文草稿；空间变换、多文件提交、跨视图统一撤销、剧本事件和规模扩展待实现。

Studio 规则继续向 Rust 核心迁移，位置历史、dirty 判断、保存阶段与请求归属已迁移；源码布局的严格 JSON、v1／v2／v3 身份／坐标／分组检查和仅数值 token 补丁也已下沉，原文前后仍限 128 KiB。源码回写不再依赖浏览器 YAML 模块，相关 HTTP 包目录入口已撤除。后端 JSON/CST、完整场景语义、投影继承、资源与关系、回执正文／摘要校验、HTTP 访问与实际事务、大部分 World／构建规划仍在 JS；可选核心能力声明保持旧布局操作兼容，不增加场景格式或自动迁移工程。近期行为后端优先 GDScript 和 Rust，C# 暂缓；当前只接入显式注册的 GDScript Node 参数／信号绑定，不支持任意方法 RPC、热更新或跨引擎源码互译。

[场景片段组合](SCENE_COMPOSITION.md)接受一份严格 JSON 配方：片段内演员和逻辑组可多次放置，每次显式指定生成 UUID、局部覆盖与位置偏移。Rust 原生与 WASM 共用无状态组合规则，输出普通 Scene2D v3；Node CLI 可只读独立文件或工程已登记文档并向 stdout 输出，不修改作品。来源 bundle 用原始字节 SHA-256 绑定配方，提供 JSON Pointer 贡献来源，不提供精确回写范围。配方使用现有类型和 `.json` 正文登记，普通编辑／保存允许未完成内容，完整备份保留原文；选择式资源包从当前模板与覆盖派生定义／图片闭包，并在读包和导入时复验。派生依赖不自动写入元数据，无效配方不能展开或选择式打包，删除顶层格式标记回归普通 JSON。生成场景通过已有 `scene.create` 单独登记后进入原构建流程，编辑生成场景不会更新 recipe。场景预览已接已保存和未保存配方，只在内存展开并复用 v3 模型；字段贡献分别定位到模板、局部覆盖、偏移和身份映射，继承来源继续指向投影。预览不返回构建快照或布局保存权限，配方从构建／运行选择中分离。当前源码配方可编辑六类单实例局部覆盖：按稳定放置／局部键生成保留原字节的 Rust 补丁，经完整预览检查后应用到同一原文草稿，持久化继续普通保存；未改字段保留继承，取消或过期提案不改草稿。0.0.10 源码可按六字段恢复继承，位置与尺寸成对删除；恢复与其他 set 原子组合，所选演员最后覆盖字段删除后移除条目并保留 overrides 数组，图片 null 与恢复保持不同含义。同一版源码另接独立单实例位置画布：拖动、键盘和场景坐标经现有 Rust 几何历史转换为 position-only 局部覆盖提案，完整检查后应用原文草稿并普通保存；其他实例、片段、偏移及属性保持。现另接独立配方多实例画布：大纲搜索／分组后代／多选，整体拖动、吸附、六向对齐及一次撤销整批；新可选 Rust 位置补丁原子改动多个放置目标，完整候选及目标列表检查后应用原文草稿并普通保存。旧单实例入口保持。现另接独立共享片段字段编辑：表单只显示原文声明，六类值逐字段明确勾选后设置；全部相关放置与局部覆盖掩蔽展示并经完整候选／图片检查，应用原文草稿后普通保存。未声明字段显式设为相同有效值仍新增声明，全被覆盖时仍可修改模板原文。当前另接共享声明恢复：启用投影继承的尺寸／颜色／速度／控制可删，图片任一继承状态可删，位置必需；设置与恢复原子组合，完整候选重读继承及图片后普通保存。现另接整组放置偏移表单：选择任一成员绑定该 placement 全体演员和组身份，offset 在局部覆盖之后相加，数值对或恢复缺省零声明经完整候选检查后应用草稿／普通保存；局部覆盖、共享声明及组组织保持。共享演员结构现已接入独立表单：新增原子补齐全部放置的稳定身份，移除同步清理成员映射和局部覆盖；完整检查后应用原文草稿并普通保存，未放置片段也可编辑。嵌套片段、跨文件引用及生成结果双向同步尚未接入。

这些能力的范围各自受契约约束：批量属性提交只接受现有对象的属性修改，不能混合创建、关系和资源动作；Scene2D 的几何预览仍只处理角色引用、图片和布局；构建可另行挂载明确声明的行为，原有方向键及 `idle` / `moving` 状态并未成为通用状态机。游戏起始模板本身用于设计文档，可执行内容还需显式场景声明。

执行中间层现有两条受限实现：Godot 4 与 Bevy 0.19.1 无头运行程序。Bevy 只声明无图场景的构建、方向输入和移动逻辑，图片、GDScript／Rust 作者行为、窗口、离屏、内嵌视口和 GPU 均未接入；不支持的计划由能力检查拒绝。宿主选择一个可信后端，界面根据描述符开放操作，没有引擎选择下拉框。HTTP 不接收后端模块、工具或输出路径。作者 Scene2D 格式和无行为 plan／runtime 1／2 保持，Godot 显式行为使用 plan／runtime 3。工具与生成产物不进入作者迁移包，范围见 [Bevy 指南](BEVY_BACKEND.md)。

既有构建工作台接入[运行对象观察](RUNTIME_OBJECTS.md)：纯 JS 观察核心从已验证冻结计划取身份／来源，独立于原始事件环保存启动／结束坐标和状态变化。Godot／Bevy 沿用已有 plan／runtime 1／2／3；状态事件不含坐标时明确标出位置样本过期。工作台仅检索和返回作者声明；宿主 inspect 只查询本服务当前运行任务，不占执行槽、不查工具、不暴露引擎 Entity 或方法。当前另接[有限控制回放](RUNTIME_CONTROL.md)：无行为 plan 1／2 可以有限方向程序按固定步骤报告完整位置；普通观察 DTO 不变，控制任务附完成步数和明确步骤样本。连续实时采样、反射、RPC 与运行修改未接入。

## 平台接入

表格描述当前源码接入，实际设备覆盖另列。桌面栏指 Web / Tauri 桌面宿主；浏览器栏指本机 **编辑服务**。

| 能力 | 桌面源码 | 本地浏览器 | Android 预览源码 |
| --- | --- | --- | --- |
| 文档编辑与三语设置 | 已接入 | 已接入 | 已接入 |
| 起始工程模板选择 | 已接入 | 使用已有工程 | 已接入；新选择器已做浏览器／原生存储联调，设备待验收 |
| 项目类型与模板配置 | 已接入 | 已接入 | 可读取导入定义；配置界面未接入 |
| World 查询与语义命令 | 已接入 | 已接入 | 未接入 |
| 媒体访问、插入和播放 | 已接入 | 已接入 | 未接入；完整包保留素材字节及引用 |
| 文档分享、选择式资源包、单素材导出 | 已接入 | 已接入 | 未接入 |
| 完整工程包 | 原生导入／导出 | 导出；导入使用桌面版 | 系统文件选择器导入／导出 v2 / v3 包 |
| OC 投影创建、编辑与查询 | 已接入；新版窗口待验收 | 已接入 World 界面 | 未接入；完整包保留原始数据 |
| Scene2D 预览、布局编辑与构建工作台 | Linux 本机服务接入；新版 Tauri 窗口待验收 | Linux 本机编辑服务已实测 | 未接入 |
| 场景行为构建与事件 | Linux 本机服务接入；新版 Tauri 窗口待验收 | Linux 本机编辑服务已实测 | 未接入；完整包保留作者数据 |
| 有限方向回放与步骤采样 | Linux 本机源码接入；Tauri 窗口待验收 | 已有工作台控制程序入口 | 未接执行器／界面；纯控制规则可移植 |
| 运行对象检索与来源 | Linux 本机源码接入；Tauri 窗口待验收 | 本机工作台接入，实际浏览器证据另列 | 未接界面／执行器；纯观察模块可移植 |
| Bevy 无图场景构建与无头逻辑 | Linux 本机服务接入；Tauri 窗口待验收 | 固定宿主选择已实测 | 未接入；仅纯事件／能力模块校验 |
| 工具检查、用例／验收组与成员报告 | Linux 本机源码接入；新版 Tauri 窗口待验收 | 实际本机工作台、三语与窄屏已实测 | 未接宿主／界面／执行器；纯规则可移植 |
| 工程位置 | 自选文件夹，可绑定外置素材 | 宿主选定的本机工程 | 应用私有目录 |

只读浏览服务不提供语义写入、项目配置或引擎执行；选择式资源包仅开放清单与导出。网页访问本机工程依赖本地服务。

## 验证边界

以下开发专题保留在 0.0.9 或更早工作树中执行时的版本、计数和源码条件；其中“当前”或“未发布”描述属于该次验证。0.0.10 的累计交付范围见[版本记录](RELEASE_0.0.10.md)。

最新[独立场景创作流程验收](test-results/scene-authoring-workflow/results.json)对应当前未发布工作树：固定 Node **24.20.0** 的完整应用 **2629／2629**，**506** 个 JavaScript 文件及 API／版本预检通过，0 失败／跳过／取消／todo。新候选 **15**、工作流 **31** 和浏览器接线 **5** 共 **51** 项，以及含旧配方回归的 **388** 项，与全量重叠，不相加。实际 Chrome **154** 六个入口共 **37** 流程通过，**9** 张代表截图目视；桌面／移动准备副本各 **40** 组标准 VM 检查（各 **86** 个实际模块），共 **80** 组，库存 **529／216／11** 文件核对。只证明纯层复用及本机浏览器，不提升安装或 Android 编辑设备交付。

本轮冻结 **610** 份源码；**2799** 份旧证据、**39** 作者样例、**14** Rust 文件、旧场景与后端及 **4** 工具保持。WASM **337188** 字节及 build 元数据、六个 UI 控制器和原文应用／普通保存宿主原字节保留；没有新 Rust 测试或操作协议。初次新候选夹具错误和旧共享函数身份断言失败均保留，后者改为验证独立两区完整审阅及释放；未知配置语义边界在冻结前闭合拒绝。清理本轮 **7** 个起始不存在的生成目录，释放 **4.324 GiB**。此前专题按原范围保留如下。

当前主线[共享演员结构专题](test-results/scene-composition-structure/results.json)属于 **0.0.9 发布后未发布工作树**：已登记配方的预览工具栏新增“编辑片段结构”，支持已有片段新增／移除演员和未放置片段，原子同步所有放置身份与局部覆盖，再应用主源码草稿并普通保存。Rust 独立结构能力与原有 recipe v1、生成 Scene2D v3、执行后端和普通保存相互分离。未放置片段检查声明和登记依赖，没有有效实例渲染，不宣称默认投影和未使用素材字节已验收。

固定 Node **24.20.0** [完整应用](test-results/scene-composition-structure/app-check.log) **2578／2578**、[新增专项](test-results/scene-composition-structure/focused-tests.log) **74／74**，均 0 失败／跳过／取消／todo；**500** 个 JavaScript 文件及 API／版本预检通过。共享 Rust 原生 **128** 项（新增 9）及 fmt／clippy 通过，实际 native／WASM **17** 组结构回执一致，WASM **337188** 字节。旧局部核心专项曾因未设置工具路径跳过 1 个 Godot 用例，其原条件保留；最终全量已配置实际工具且零跳过。

实际 Chrome **154.0.8037.97** 的新结构 **5** 条、旧单实例 **7** 条和旧批次 **5** 条分别通过，均无页面异常或 SVG 外部访问。验证两放置稳定 UUID、继承／图片／组来源、增删及覆盖清理、未放置片段、取消、原始输入失效、普通保存／重开和外部冲突；中英日 **390px** 表单及影响列表和桌面审阅共 **7** 张最终截图另经目视。局部列表可正常垂直滚动，完整内容另由 DOM／原文断言核对。

[准备副本](test-results/scene-composition-structure/packaged-resources.json)核对桌面 **526**／移动 **213**／作品库 **11** 份文件，映射 **536** 份来源或明确变换；两端各执行新 **4**／旧 **24** 组 helper 案例，共 **56** 组。移动标准 VM 加载 **84** 个本地 ESM 模块及实际 WASM，无 Node／DOM／网络或宿主导入；这是可移植性验证，不是恶意代码安全沙箱或 Android 作者编辑／设备验收。正式 **604** 份产品／测试来源在全部验证期间保持，[独立边界审查](test-results/scene-composition-structure/boundary-review.json)无开放阻塞项。旧 **2695** 份历史、**39** 份样例、**4** 份工具、冻结后端 **7** 份和旧场景切片 **23** 份保持；Rust 只注册新独立结构域及新增模块。没有新安装窗口、版本、提交或推送声明。 [收尾核验](test-results/scene-composition-structure/final-audit.json)保持旧图谱坐标评分，新增结构切片后为 **76** 功能／**164** 实现／**287** 绑定／**1148** 稀疏单元；仅[清理本轮生成物](test-results/scene-composition-structure/cleanup.json) **8** 个目录，释放已分配磁盘块 **4948459520** 字节，约 **4.609 GiB**。共享新 WASM、作品、工具、依赖和已有安装保留。


当前[后端工程持久恢复专题](test-results/backend-project-catalog/results.json)的固定 Node **24.20.0** 全量 **2504／2504**、新增专项 **65／65**，均 0 失败／跳过／取消／todo；**491** 个 JavaScript 文件、API／版本预检通过。真实 Godot 图片／实例／GDScript 与 Bevy 实例四类工程完成重启和离线运行，两实例后端另完成控制、用例、验收组与成员报告；真实 Chrome **8** 流程及中英日 **390px** 通过。最终准备副本 **21** 组、桌面 **524**／移动 **211**／作品库界面 **11** 份文件核对通过；共享 Rust／WASM、原生成器和运行协议保持。这些是未发布源码、Linux 本机工具、浏览器和准备副本证据，无新安装或设备声明。旧轮次条件与初次失败原样保留。

当前[整组放置偏移专题](test-results/scene-composition-placement-offset/results.json)继续 **0.0.9 发布后未发布工作树**；旧专题保留各自执行条件。

本轮共享 Rust 原生 **119** 项（新增 9）及 fmt／clippy 通过；固定 Node **24.20.0** 的[完整应用](test-results/scene-composition-placement-offset/app-check.log) **2353／2353**、[相关专项](test-results/scene-composition-placement-offset/focused-tests.log) **488／488** 和[核心专项](test-results/scene-composition-placement-offset/core-focus.log) **155／155** 均 0 失败／跳过／取消／todo，**468** 个 JavaScript 文件及 API／版本预检通过。[新增 70 项](test-results/scene-composition-placement-offset/new-test-counts.json)为 helper 16／协议 11／UI 24／父控制器 7／预览 4／主编辑器 8，已包含在全量；专项互相重叠，不相加。系统 Node **24.21.0** 的新 UI **24** 项及原共享 SET／恢复测试 **48** 项实际通过，真实 helper／Rust 执行，无 Canvas 或媒体替身。

实际 Chrome **154.0.8037.97** 的[放置偏移实测](test-results/scene-composition-placement-offset/browser/browser.json)完成 **5** 条流程；[旧共享恢复](test-results/scene-composition-placement-offset/inheritance-regression/browser.json) **6** 条和[旧批次画布](test-results/scene-composition-placement-offset/batch-regression/browser.json) **5** 条另实际回归，均 0 页面异常。新流程检查全成员偏移、缺省与显式零、恢复、完整候选、普通保存与外部冲突。中英日 **390px** 和审阅页可见区域共 4 张截图另经目视核对；完整候选原文由浏览器逐字断言核对。本轮没有单独重跑旧 SET 浏览器流程。

[准备副本](test-results/scene-composition-placement-offset/packaged-resources.json)完整核对桌面资源 **519**／移动 **209**／作品库界面 **11** 份文件，源码复制或明确变换逐份匹配。桌面与隔离移动各执行 **14** 组新偏移和 **21** 组旧 SET／恢复／单实例／批次 helper，共 **70** 组（新 28／旧 42），首跑通过。移动加载 **86** 个本地 ESM 模块及实际重建 WASM，无 Node／DOM／网络全局或宿主导入；这是纯层可移植验证，不等同 Android 作者编辑／持久化／设备、安全沙箱、安装窗口或引擎执行验收。

[保真报告](test-results/scene-composition-placement-offset/historical-preservation.json)确认 **2430** 份旧历史、**23** 份受保护旧切片、**7** 份冻结 Godot 后端和 **571** 份最终产品／测试源码保持。仅[清理](test-results/scene-composition-placement-offset/cleanup.json) **8** 个最初不存在的本轮生成目录，按 inode 去重已分配磁盘块回收 **4887965696** 字节，即 **4.552 GiB**；共享重建 WASM、依赖、外部工具、作者数据、偏好和已有安装保留。版本仍为 **0.0.9**，新能力属于未发布工作树。

上一轮[共享声明恢复专题](test-results/scene-composition-fragment-inheritance/results.json)属于 **0.0.9 发布后未发布工作树**，原 SET、单实例及批次证据继续单独保存。

本轮共享 Rust 原生 **110** 项（新增 9）及 fmt／clippy 通过；固定 Node **24.20.0** 的[完整应用](test-results/scene-composition-fragment-inheritance/app-check.log) **2283／2283**、[正式相关专项](test-results/scene-composition-fragment-inheritance/focused-tests.log) **418／418** 均 0 失败／跳过／取消／todo，**459** 个 JavaScript 文件及 API／版本预检通过。新增 **60** 项（helper 16／协议桥接 11／UI 20／父控制器 5／主编辑器 8）已包含在全量，核心专项 **88**、相关专项和界面回归互相重叠，不相加。UI [新 20 项](test-results/scene-composition-fragment-inheritance/ui-tests-initial.log)和[旧 SET 原测试 28 项](test-results/scene-composition-fragment-inheritance/ui-regression-initial.log)首次均通过，使用系统 Node **24.21.0** 与真实 helper／Rust，无 Canvas 或几何历史替身。

实际 Chrome **154.0.8037.97** 的[共享声明恢复实测](test-results/scene-composition-fragment-inheritance/browser-second/browser.json)完成 **6** 条流程；[旧共享 SET](test-results/scene-composition-fragment-inheritance/set-regression/browser.json) **6** 条、[旧实例恢复](test-results/scene-composition-fragment-inheritance/override-regression/browser.json) **9** 条和[旧批次画布](test-results/scene-composition-fragment-inheritance/batch-regression/browser.json) **5** 条分别实际回归，均 0 页面异常。新流程使用真实投影和图片，检查 null 删除后重继承、无继承图片删除无图、原子混合设置／恢复、局部掩蔽、普通保存和冲突。中英日 **390px** 及审阅页的可见区域共 4 张截图另经目视核对；完整候选原文由浏览器逐字断言核对。

[准备副本](test-results/scene-composition-fragment-inheritance/packaged-resources.json)完整核对桌面资源 **517**／移动 **207**／作品库界面 **11** 份文件，逐份源码复制或明确变换匹配。两端各执行 **10** 组新恢复和 **11** 组旧 SET／单实例／批次 helper，共 **42** 组（新 20／旧 22），首跑通过。移动加载 **85** 个本地 ESM 模块及实际重建 WASM，无 Node／DOM／网络全局或宿主导入；这是纯规则可移植验证，不等同 Android 编辑／持久化／设备或安全沙箱验收。[最终结果](test-results/scene-composition-fragment-inheritance/results.json)绑定 **560** 份产品／测试源码与四个 fresh 原生 helper。

[保真报告](test-results/scene-composition-fragment-inheritance/historical-preservation.json)确认 **2339** 份旧历史、**16** 份受保护旧切片、**7** 份冻结 Godot 后端和 **560** 份最终源码保持。仅[清理](test-results/scene-composition-fragment-inheritance/cleanup.json) **9** 个确属本轮的生成目录：8 个在起始基线不存在，额外 default target 的生成时间与归属有独立证据。按 inode 去重已分配磁盘块回收 **4896763904** 字节，即 **4.560 GiB**；共享重建 WASM、外部工具、作者数据、偏好与已有安装保持，版本仍为 0.0.9。

上一轮[共享片段字段专题](test-results/scene-composition-fragment-editor/results.json)仍为 **0.0.9 发布后未发布工作树**。共享 Rust 原生 **101** 项及 fmt／clippy 通过；固定 Node **24.20.0** 的[正式相关专项](test-results/scene-composition-fragment-editor/focused-tests-final.log) **358／358** 和[完整应用](test-results/scene-composition-fragment-editor/app-check.log) **2223／2223** 均 0 失败／跳过／取消／todo，**453** 个 JavaScript 文件及 API／版本预检通过。新增 **75** 项为纯 helper 16、桥接 11、界面 28、父控制器 9、主编辑器 8 和预览入口 3，全部已计入全量；核心专项 161 与相关 358／完整 2223 相互重叠，不累计为覆盖率。界面首次最终 28 项使用系统 Node **24.21.0**，真实 helper／Rust 执行，无 Canvas 或几何历史替身。

实际 Chrome **154.0.8037.97** 的[共享表单实测](test-results/scene-composition-fragment-editor/browser/browser.json)完成 **6** 条流程，0 页面异常和 SVG 外部访问；中英日 **390px** 及审阅页可见区域截图已另经视觉核对；完整候选原文由浏览器逐字断言核对。验证原始声明与实例覆盖分离、关联放置和掩蔽、完整候选、普通保存／重开、批准静默失效和外部冲突。旧[单实例画布](test-results/scene-composition-fragment-editor/single-regression/browser.json) **7** 条与[批次画布](test-results/scene-composition-fragment-editor/batch-regression/browser.json) **5** 条另实际回归，均无异常／SVG 外部访问，原脚本及受保护作者链路保持原字节；不代表新安装或 Android 设备验收。

本轮[准备副本](test-results/scene-composition-fragment-editor/packaged-resources.json)完整核对桌面资源 **517**／移动 **207**／作品库界面 **11** 份文件，逐份源码复制或明确变换匹配。固定 Node **24.20.0** 的桌面副本和隔离移动 ESM／实际 WASM 各通过 **9** 组新共享字段案例及 **2** 组真实旧单实例／批次 helper 回归，共 **22** 组执行（新 18／旧 4）。移动加载 **85** 个本地模块，含 vendor YAML，无 Node／DOM／网络全局或宿主导入；只验证纯声明编辑和回执，不替代 Android 作者编辑、安装窗口、持久化或引擎执行。本轮 **553** 份产品／测试源码摘要与副本执行绑定。

[本轮保真核对](test-results/scene-composition-fragment-editor/historical-preservation.json)确认 **2257** 份旧历史、**7** 份冻结 Godot 后端、**9** 份旧单实例／批次／覆盖切片和 **553** 份最终源码保持；旧评分和报告执行条件不改写。仅[清理](test-results/scene-composition-fragment-editor/cleanup.json) **8** 个最初不存在的本轮生成目录，按 inode 去重的已分配磁盘块回收 **4879388672** 字节，即 **4.544 GiB**；共享重建 WASM、外部工具、作者数据、偏好及已有安装保留。

上一轮[配方多实例批次画布专题](test-results/scene-composition-batch-canvas/results.json)仍为 **0.0.9 发布后未发布工作树**。共享 Rust 核心原生 **93** 项及 fmt／clippy 通过；[最终相关专项](test-results/scene-composition-batch-canvas/focused-tests.log)使用固定 Node **24.20.0** 完成 **249／249**，0 失败／跳过／取消。新增批次纯适配 **15**、核心桥接 **10**、界面 **24**、父控制器 **7**、主编辑器 **8** 和预览入口 **2** 项均包含在专项内；初次界面 24 项使用系统 Node 24.21.0，绘制为替身，大纲和共享 helper／Rust 实际执行。这些新增 66 项已计入[本轮完整应用](test-results/scene-composition-batch-canvas/app-check.log) **2148／2148**；固定 Node 24.20.0 完成 **444** 个 JavaScript 文件及 API／版本预检，0 失败／跳过／取消。专项与完整应用有重叠，不相加为覆盖率。

本轮 Chrome **154.0.8037.97** 的[批次实测](test-results/scene-composition-batch-canvas/browser/browser.json)完成 **5** 条流程，0 页面异常和 SVG 外部访问；中英日 **390px** 截图已核对。流程覆盖分组多选、真实拖动／方向键、按尺寸对齐、整批撤销与重做、跨放置四目标候选、原文应用与普通保存／重开，以及原始字段批准失效和外部保存冲突。旧单实例画布在[本轮独立目录](test-results/scene-composition-batch-canvas/single-regression/browser.json)另实跑 **7** 条流程，0 异常或 SVG 外部访问。新 positions 可选域与旧 set／edit／expand 分离，单实例实现及旧专题原字节保留；没有新增安装窗口或 Android 设备验收。

本轮[准备副本](test-results/scene-composition-batch-canvas/packaged-resources.json)核对完整桌面 **515**／移动 **205**／作品库 **11** 份文件及重点源码 **113／83／11** 份；固定 Node 24.20.0 执行桌面副本，隔离移动加载 **84** 个本地 ESM 模块（含 vendor YAML），无 Node／DOM／网络全局或宿主导入。两端各通过同一 **8** 组案例，共 **16** 组执行；源码前后 **543** 份 SHA 保持稳定。移动只验证可移植位置及精确补丁，不表示 Android 画布、保存宿主或设备已接入。

当前[单实例配方画布专题](test-results/scene-composition-canvas/results.json)仍属于 **0.0.9 发布后未发布工作树**。最终固定 Node **24.20.0** 完成应用 **2082／2082**，0 失败／跳过／取消；**436** 个 JavaScript 文件及 API／版本预检通过。[相关专项](test-results/scene-composition-canvas/focused-tests.log) **128／128**，含新纯适配 **15** 项、新位置界面 **19** 项及父控制器回归，已计入全量。共享画布 **30** 项由全量验证；初次界面与画布合计 **49** 项使用系统 Node 24.21.0，记录保留其原条件。专项不与全量相加。

本轮 Chrome **154.0.8037.97** 的[最终画布实测](test-results/scene-composition-canvas/browser-final/browser.json)完成 **7** 条流程，0 页面异常；桌面及中英日 **390px** 截图已核对，位置、局部坐标、可见操作和窄屏无横向溢出。共享父应用回调修复后，原覆盖／恢复流程另在本轮目录[重跑 **9** 条](test-results/scene-composition-canvas/inheritance-regression/browser.json)，0 异常。没有新增 Rust 协议或改动共享核心，不重标旧独立 Rust、安装窗口或 Android 设备验收。

本轮[准备资源](test-results/scene-composition-canvas/packaged-resources.json)使用固定 Node **24.20.0**，核对完整桌面 **513**／移动 **203** 份文件及重点源码 **111**／**81** 份。桌面复制模块和隔离移动 ESM／原 WASM 各通过同一 **5** 组位置案例，共 **10** 组；移动加载 **9** 个纯模块并拒绝 **13** 个显式非法操作，无 Node／DOM／网络或宿主导入。它验证准备副本与可移植坐标规则，不代表 Tauri 安装、Android 布局界面或设备、引擎执行及新增独立 Rust 测试。

本轮[恢复继承专项](test-results/scene-composition-inheritance/results.json)属于 **0.0.9 发布后未发布工作树**。固定内置 Node **24.20.0** 完成应用 **2037／2037**、**431** 个 JavaScript 文件及 API／版本预检，0 失败／跳过／取消。共享 Rust 原生测试 **87** 项及 fmt／clippy 通过；补丁桥接、纯提案、界面及源码／父预览宿主专项 **74／74**，含真实原生／WASM 对照，专项已计入全量。

本轮 Chrome **154.0.8037.97** 完成 **9** 条流程及中英日 **390px** 检查，覆盖同值恢复、混合 set／reset、删除目标全部覆盖、完整候选、取消／过期、普通保存与外部冲突，作者元数据、图片及稳定实例身份保持。旧 set／expand 能力、最后条目删除、显式图片 `null` 与恶意回执另有边界审阅；准备资源的实际范围由本轮结果记录，不沿用旧版本数字，也不代表新安装包或设备验收。

本轮[准备资源验证](test-results/scene-composition-inheritance/prepared-resources.json)核对完整桌面资源 **511**、移动资源 **201**、作品库界面 **11** 份文件，重点副本分别为桌面 **80**／移动 **76** 份。桌面固定 Node 与隔离移动 ESM／WASM 各验证同一 **5** 类继承案例，回执及提案一致；移动加载 **111** 个模块，无 Node／DOM／网络全局，只证明可移植模块，不代表 Android 宿主、界面或设备。

[0.0.9 本版验收](test-results/release-0.0.9/results.json)使用固定 Node **24.20.0** 重新完成应用 **2017／2017**、0 失败／跳过／取消，**430** 个 JavaScript 文件及 API／版本预检通过。新构建的原生辅助程序参与回归；版本／源码打包规则专项 **7／7** 与全量重叠。完整准备清单核对桌面 **511**、作品库 **11**、移动 **201** 份文件；两个实际后端完成 **5** 份批次回执、**9** 个会话与 **9** 份报告，含 **4** 次来源和构建离线回读。

此前最新 [成员报告专题](test-results/runtime-case-reports/results.json) 在 **0.0.8 未发布工作树**完成真实 Chrome **6** 流程、**5** 个唯一任务、中英日 390px、成员详情与明确 JSON 下载，作者原字节、文本草稿和光标保留。0.0.9 源码发布时没有重新执行浏览器检查；这些专题结果保留其原版本条件。

专题中固定 Node 24.20.0 的准备资源核对桌面 511／移动 201 文件，两实际后端得到 9 份成员报告，含来源离线且构建已清理后的独立回读。移动仅执行隔离纯模块数据检查，没有 Android 报告宿主、界面或引擎执行。原生辅助程序按专题构建并用于应用检查；此前独立 Rust 测试与浏览器阶段不改写为本版新验收。完整数字、环境、初次失败与修复后的证据见各自记录；专项与全量有重叠，不累加为覆盖率。

最后仅清理一处文件末尾多余 LF，相关 **31／31** 专项和语法检查通过。[格式记录](test-results/release-0.0.9/final-formatting.json)把最终源码与先前全量／准备／归档字节精确关联，其他源码摘要不变。

历次发布和开发阶段的验证段落已移至 [验证历程](history/VALIDATION.md)，原日志、截图、版本和源码指纹保留在各专题目录。源码／准备资源验证不等同新版 Tauri 安装窗口、Windows／macOS 原生交互或 Android 设备验收。

## 尚未实现的目标

- 场景空间层次、片段排序、嵌套／跨文件片段、剧本事件、多文件草稿与原子提交、跨视图统一撤销，以及超过 128 实例的规模验证；文件内组合已有普通文档保存／依赖迁移、只读 CLI、配方原文预览／贡献定位与当前原文的单实例覆盖编辑；六字段恢复继承、单实例位置画布、配方多实例移动／对齐／原子位置批次及共享片段演员六字段设置／允许的声明恢复、整组 placement 偏移、共享演员增删及整份放置新增／复制／移除及组织分组编辑已纳入 0.0.10 源码。
- Nuislang 原生构建与执行、ns-nova / yalivia 接入、GUI 迁到 ns-nova；Bevy 的图片／窗口、作者 Rust 行为、反射／BRP 和热更新仍待单独接入。
- 通用工程类型插件、行为参数编辑表单、方法 RPC／通用状态机、Live Build、嵌入运行视口、GPU 计算与资源通道。
- 独立游戏程序导出、构建会话的宿主崩溃恢复、跨重启任务身份恢复；成员报告历史管理、跨任务／重启回读及外部报告导入。
- 通用混合 ChangeSet、永久撤销历史，以及 Android 上尚未接入的上述桌面能力。

Windows / macOS 的构建配置已有，原生交互仍需目标系统验收；Android 真机、更多 WebView 和厂商环境也仍待覆盖。完整设计与验收门槛见 [路线](ROADMAP.md) 和 [原生方向 ADR](adr/0008-native-nuis-and-bootstrap-runtime.md)。

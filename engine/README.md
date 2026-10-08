# 可移植引擎

工具状态和用例／组／报告纯模块已纳入 [0.0.9 源码交付](../docs/RELEASE_0.0.9.md)，原阶段报告仍保持 0.0.8 条件。

`runtime-case-report.mjs` 是输出报告的纯入口：固定上下文、实例目标、终态、原 case/trace 与重新计算的 evaluation，严格核对存储评价并返回深度冻结副本，实际 UTF-8 紧凑导出限定 2 MiB。它不导入作者 CST/YAML、Node、DOM 或运行生命周期重放。可信文件 pin 属于 Node，GUI 只读详情与显式下载，见[成员报告](../docs/RUNTIME_CASE_REPORTS.md)。

[当前架构](../docs/ARCHITECTURE.md) · [工程模板](../docs/PROJECT_TEMPLATES.md) · [开发路线](../docs/ROADMAP.md)

这里保留现有 JavaScript 解析、原文适配与语义规划，并通过 `studio-core.mjs` 调用独立的共享 Rust 编辑规则和草稿状态。Godot 等工程运行后端位于宿主适配层，Nuis / ns-nova / yalivia 原生接入属于后续路线。

`index.mjs` 是不依赖 Node、HTTP 服务、Tauri 或本机配置的入口。输入是正文字符串、项目定义、登记记录和稳定素材引用；输出是解析结果、布局、字段范围或修改后的正文。唯一运行依赖是 `yaml`，浏览器宿主使用该包的 browser 发行文件，或由打包器解析其 browser/default 入口。`json-source.mjs` 仍供后端模型与事务使用；源码布局通过 Rust 严格扫描与补丁接口工作，前端模块图不再为它加载 YAML，本机服务也不再公开 YAML 包目录。移动端通用解析仍保留已有 `/vendor/yaml/`。

桌面服务和网页编辑器已经复用这里的实现。旧的 `scripts/lib/`、`scripts/standardize-docs/` 和 `web/modules/` 入口保留转发，避免同时改变调用方与公共资源路径。核心不能反向导入这些入口。

有序验收组的轻量纯入口 `runtime-case-suite-contract.mjs` 定义成员结构和终态汇总，GUI 不加载作者解析依赖；`runtime-case-suite.mjs` 重导出同一规则并另接联合预算、原用例及共享场景准入。不访问文件、DOM 或引擎。作者捕获与逐成员调度留在 Node，操作与边界见[验收组](../docs/RUNTIME_CASE_SUITES.md)。

## 数据与解析

- `parseSourceContent(content, sourcePath, descriptor)`：Markdown、文本、JSON、YAML 解析，服从文档所属类型的规则。
- `buildDocumentLayout(parsed)`：通用章节、字段分组和内容块布局。
- `createDocumentFieldDraft` / `serializeFieldDraft`：依据当前正文范围编辑字段，保留未修改字节、BOM、换行和注释。应用层负责用 `fieldValueValid` 阻止非法输入。
- `prepareMediaDraft`：插入和收集图片、视频、音频引用。宿主须先确认素材已登记，再传入 `{ type, src: 'asset:<UUID>', caption }`；此函数不导入素材文件。
- `createProjectModel(defaults)`：注入默认类型与模板后，解析项目路径、定义及文档类型。宿主从 `scripts/lib/workspace-layout.json` 装载物理布局，从 `scripts/lib/project-templates.json` 装载起始模板包及旧工程兼容默认值。显式工程定义只使用自己的模板路径，不按内置文件名回退正文；返回的嵌套字段规则为独立副本。核心不读取文件，也不选择工程模板包。
- `document-model.mjs`：登记记录的归属关系、旧模型兼容与层级组装。
- `document-contract.mjs`：现有前后端共享的数据约定。接口能力声明不代表引擎已经实现某个平台宿主。
- `resource-package.mjs`：基于稳定身份进行循环安全的依赖／附属内容选择，返回自动包含项和外部依赖；ZIP、校验缓存和导入事务属于 Node 宿主，见 [资源包](../docs/RESOURCE_PACKAGES.md)。
- `object-projection-template.mjs`、`object-projection.mjs`、`world-object-projection.mjs`、`world-projection-update.mjs`：OC 子模板继承、嵌入快照、配置／依赖验证及 `projection.create`／`projection.update` 两文件规划；见 [多份投影](../docs/OBJECT_PROJECTIONS.md)。
- `json-source.mjs`：严格 JSON 值及原文 UTF-16 范围，复用 YAML CST 并检测解码后重复键；索引有大小／深度／节点限制，范围不持久化。
- `scene-draft-preview.mjs`：`validateSceneDraftRequest` 限定单份已登记场景草稿（128 KiB UTF-8），`overlaySceneDraftPreview` 校验原文 SHA-256 基线，在克隆观察中替换原样文本并重建投影；登记关系不变，不写文件，不规划保存。宿主冻结图片并复查读取屏障后，供独立草稿预览使用，构建仍读取保存版本。
- `scene-source-layout.mjs`：通过 Rust `sceneSource.inspect`／`sceneSource.patch` 检查源码结构并生成精确坐标补丁；JS 核对有效预览、摘要和会话来源，共享 Rust 几何与局部历史，供宿主核验后写入编辑器内存，不接收 World 保存权限或执行 I/O。
- `scene-model.mjs`：`resolveScene2DModel` 解析 Scene2D v1／v2／v3、投影有效值和依赖，返回对应版本的模型与文件／修订／字段范围；v2 以 `instanceId` 区分同一定义的多个实例，`objectId` 继续引用登记文档。登记恢复模式不重读投影语义，仅 v1 保留历史重复键／索引预算兼容。
- `build-plan.mjs`：`scene2DModelToPlan` 将作者 v1 发射为 plan v1、作者 v2／v3 发射为 plan v2；旧 DTO 保持原样，v3 分组从运行计划剔除，`createScene2DPlan` 保留原入口，并在场景明确关联有效行为清单时组合 plan／runtime 3；没有行为时旧计划逐字段不变。几何来源附加信息不进入冻结计划，能力与 Godot 适配分离。冻结资源、构建与运行属于 Node 适配层，见 [二维场景构建](../docs/PROJECT_BUILD.md)。
- `scene-behaviors.mjs`：识别并严格检查注册行为清单、场景实例、TXT 源码、标量参数与信号声明；解析明确 `behavior` 关系，派生并核验资源包依赖，生成可冻结的行为 DTO。无 Node／DOM／Godot 调用，不执行或解析 GDScript；静态预览继续只消费几何模型。当前格式与预算见[场景行为](../docs/SCENE_BEHAVIORS.md)。

- `backend-capabilities.mjs`：校验并分离冻结 `viento-execution-backend` schema 1 纯数据描述符；分别判断七种执行操作、平台、plan kind／schema 和功能需求。没有 Godot 回退、工具探测或进程调用；描述符格式／字段或操作不合法时拒绝，UI 的 `canExecuteBackend` 失败时返回 `false`。宿主注册表与具体引擎实现见[执行后端中间层](../docs/BACKEND_MIDDLEWARE.md)。
- `scene-control-program.mjs`：分离并深冻结严格方向布尔程序；schema 1 保留全局输入，schema 2 每步按冻结 plan 2 实例 UUID 独立输入，未列实例释放，重复／未知目标拒绝且输入总行数至多 1024。核对 1–64 步、`0 < fixedDelta <= 0.25` 秒、总时长 8 秒、最后全释放及演员 × 步数 1024 联合预算；逐行准入协议 1／2 完整步骤样本与生命周期，回调按原顺序进入既有事件读取器和观察。没有 I/O、引擎句柄或移动模拟，见[有限控制回放](../docs/RUNTIME_CONTROL.md)。
- `runtime-verification-case.mjs`：未发布的有限运行用例与评判；复用控制 schema 1／2，仅无行为冻结 plan 2，以稳定实例和零基步骤检查有限坐标／非负显式容差或状态。严格分离／冻结、1–128 检查、未知／重复目标与顺序样本拒绝；完整运行、断言失败、缺样本／中断分别表示，不模拟引擎或写作者数据。见[运行验收用例](../docs/RUNTIME_CASES.md)。
- `runtime-case-document.mjs`：工程验收文档的严格四字段包装、正文格式识别、稳定场景绑定及登记依赖验证；复用内层原用例，派生场景依赖与可选子内容，不读写工程，不把文件位置或结果写入运行协议。
- `scene-runtime-query.mjs`：从已验证冻结 plan 1／2／3 取得稳定实例／定义身份及来源，消费已准入 ready／state／finished，提供分离的完整只读观察和 AND 身份筛选。状态变化使原位置样本过期，诊断／行为不改观察；可选有限控制程序为 plan 1／2 增加步骤进度和 `pushSample`，无程序 DTO 原样保留；无 Node、DOM、具体引擎、反射或 RPC 依赖，见[运行对象](../docs/RUNTIME_OBJECTS.md)。
- `scene-runtime-events.mjs`：独立校验 plan／runtime 1／2 的实例身份、坐标、运动状态与 ready／finished 生命周期；诊断导航只从冻结计划取来源。没有 Node、DOM、Godot 或 Bevy 依赖；当前由 [Bevy 无头适配器](../docs/BEVY_BACKEND.md)消费，旧 Godot 事件读取器保持原字节。

`scene-identity.mjs` 的 `sceneActorIdentity(actor)` 返回 v2／v3 `instanceId` 或旧 v1 `objectId`，供已验证模型的选择、原文匹配和布局使用；它不分配身份或替代场景校验。新表单默认 v2，启用分组显式升级 v3。

`scene-groups.mjs` 验证 v3 稳定组身份、父组、成员、数量与深度，并以 `buildSceneOutline` 提供确定顺序的嵌套大纲、祖先保留搜索及按作者顺序排列的后代实例。它不依赖 DOM；`scene-structure.mjs` 负责模型到预览结构的投影及独立信封校验。分组只组织编辑内容，不包含空间变换、可见性或行为。

`sourcePath` 是项目内以 `/` 分隔的逻辑路径，例如 `documents/characters/旅人.md`，不是磁盘绝对路径或 Android 的 `content://` URI。逻辑路径和 `asset:<UUID>` 应写入作品；平台句柄只存在于适配层。

## Rust 布局草稿

`studio-core.mjs` 不加载宿主文件，也不依赖 DOM；宿主以 `initializeStudioCore(loadBytes)` 提供 WASM。`dispatchStudioCore` 调用几何操作，`dispatchStudioCoreDraft` 调用协议第 1 版的 `layoutDraft.*` 状态操作。`dispatchStudioCoreSave` 调用同版本的 `layoutSave.*` 保存状态操作。`dispatchStudioCoreSource` 调用无状态的 `sceneSource.inspect`／`sceneSource.patch`。各域共用有界缓冲，分别校验操作及响应，同步完成；可选 `viento_core_scene_source_version() === 1` 能力导出区分支持源码操作的新核心与仅支持旧布局的核心，后者继续使用旧操作但不能执行源码补丁。

`createSceneLayoutDraft(payload)` 负责核对源文和预览身份，保留作者字段与修订条件，并创建 Rust 草稿。v2／v3 将实例 UUID 映射为 Rust 布局协议中名为 `objectId` 的不透明选择键，v1 沿用定义 UUID；作者声明中的 `objectId` 始终保留定义含义。这一几何／历史操作域接收不透明键和值，保持原协议；源码的受限定义／实例检查由独立 `sceneSource.*` 操作负责。`setPositions`、`undo`、`redo`、`reset` 的状态改变在 Rust 完成；JS 只缓存返回的当前坐标与状态。`command()` 继续组装 `scene.update`，`matches()` 沿用原文语义核对。调用者退出时必须执行幂等 `dispose()`；释放后其他方法拒绝访问，不返回陈旧状态。

保存版和源码草稿版共用 `createSceneGeometryDraft`，该会话只向 Rust 传几何身份和值。源码版另向无状态接口传递有界场景正文，严格检查和原文补丁不创建额外会话。源码版 `createSceneSourceLayoutDraft(model, source, { digest })` 核对原文 SHA-256、保存基线、计划版本、实例顺序／位置与 v3 组织侧带，返回同样的几何／历史方法及 `propose()`，没有 `command`、`beginSave` 或持久化接口。`source` 为 `{ sourcePath, baseSourceRevision, content }`，摘要函数返回 64 位小写 SHA-256。

`patchSceneSourcePositions(content, changes)` 调用 Rust 按 UTF-8 字节范围仅替换变化的坐标数值 token，返回 `{ afterContent, changedPaths }`；不相关原文、BOM、行尾和未改数字写法原样保留。源文本前后都限制 128 KiB UTF-8；严格扫描保留 64 层／100000 值节点预算、1–128 个实例及 v3 的 0–128 组／16 层限制。它只核对这一操作需要的源码结构，完整投影、依赖、资源与场景运行语义继续使用原 JS 模型，后端 JSON/CST 未迁移。`prepareSceneSourceLayoutApply(current, proposal, { digest })` 核对来源与基线，并重算完整候选，防止伪造修改；宿主仍须在 await 后检查当前场景身份、源码模式和编辑会话，才替换内存。应用保留原保存版本，不读取磁盘；外部文件改动仍可接收本地补丁，但后续预览或普通保存会各自检查原基线并报告冲突。没有跨视图统一撤销或多文件事务。

保存版的状态由随草稿存在的 Rust `LayoutSaveWorkflow` 持有，检查／保存／核对返回当前请求标识；重复或失效完成被拒绝。位置修改使审阅失效，非可编辑阶段不能修改位置。JS 保留作者原文、已审阅的请求／响应、摘要和回读校验，并在每次异步返回时核对会话归属。

独立 Rust `LayoutDraft` 可直接用于原生调用，`undo`、`redo`、`reset` 返回 `Result<bool, CoreError>`，保存阶段冻结时明确拒绝变更；JSON/WASM 草稿表最多 32 份，每份 1–128 个对象，历史最多 100 批次。句柄不持久化、不代表权限，布局状态结果不包含整个历史或作者正文；无状态源码补丁单独返回候选正文。此轮没有添加永久撤销、跨重启草稿恢复、原生 GUI 或 Android 场景入口。具体边界见 [共享核心架构](../docs/ARCHITECTURE.md#共享-rust-核心的运行边界)。

## 文件内片段组合实验

0.0.8 的 `scene-composition.mjs` 提供同步 `expandSceneComposition(content)`，返回已分离的 `{ scene, sourceMap }`。它经 `dispatchStudioCoreComposition` 调用无状态 `sceneComposition.expand`，不执行 I/O、分配 UUID 或创建布局会话。宿主须先初始化共享核心；可选 `viento_core_scene_composition_version() === 1` 导出声明组合能力，旧核心继续支持原操作但拒绝此操作，没有 JS 组合回退。

recipe v1 在单文件内声明片段和放置，显式提供局部键到生成演员／组 UUID 的完整映射。Rust 校验结构、覆盖、组织关系和展开预算，输出现有 Scene2D v3；定义、投影继承、素材实际内容和登记关系继续由原 Scene2D 规划器验证。桥接会核对来源贡献项属于当前模板、演员覆盖、放置偏移或组引用，不能引用另一个对象的有效路径。来源仅为输入配方的 JSON Pointer 及贡献项，没有宿主路径、摘要或可写范围；Node CLI 才把原始输入字节摘要加入 bundle；已登记模式还附只读文档／World 来源。生成场景不携带配方元数据，后续编辑不反向更新配方。

`scene-composition-document.mjs` 提供同步 `inspectSceneComposition(content)` 与 `validateSceneCompositionDependencies(checked, record, source)`。它按当前正文顶层格式识别普通已登记 JSON 文档，复用 Rust 校验，再收集全部模板与覆盖的定义／图片 UUID；不复制组合算法，也不读写作品。无效配方不返回部分依赖，最小格式标记可供只读分类。依赖校验检查可用正文、自引用／嵌套配方与图片类别，投影闭包继续由既有规则处理。

Node CLI 和资源包宿主消费派生结果，文档登记／保存沿用原流程；没有新增 World 命令、元数据自动回写或普通解析器布局。未完成原文可保存及完整备份，选择式迁移要求配方与依赖有效。已保存／未保存配方的只读预览已接入；当前源码配方可另行编辑单实例局部覆盖并应用到原文草稿，再普通保存。共享模板编辑、删除覆盖／恢复继承、嵌套／跨文件片段和多文件事务仍未接入。完整契约及只读 CLI 用法见[片段组合指南](../docs/SCENE_COMPOSITION.md)。

局部覆盖使用独立的可选 `viento_core_scene_composition_patch_version() === 1`，由 Rust `sceneComposition.patchOverrides` 按稳定放置 ID 和局部演员键设置 position／size／color／speed／controls／imageResourceId 六类值。它复用严格 scanner、组合校验和数值序列化，只补丁目标源码，保留其他原始字节；前后原文各限 128 KiB，不保存文件或改 World。桥接提供 `supportsStudioCoreCompositionPatch()` 和 `dispatchStudioCoreCompositionPatch(request)`，核对有序真实路径、唯一目标语义并重新严格展开回执，坏回执使核心不可用；缺少新能力不影响旧展开／源码／几何能力。

`scene-composition-overrides.mjs` 的 `createSceneCompositionOverrideDraft(model, source, actorId, { digest })` 绑定有效预览、当前原文摘要和保存基线，返回局部表单值及 `propose`；未改字段不变成显式覆盖。`prepareSceneCompositionOverrideApply(current, proposal, { digest })` 重新核对摘要、身份与精确 Rust 回执。异步前复制输入，纯接口没有 I/O；宿主完整预览候选并在最终内存应用前复查当前会话，持久保存继续由普通编辑器处理。贡献来源仅授权导航，不授予这项编辑能力。

`scene-composition-preview.mjs` 提供异步 `resolveSceneCompositionPreview(observed, recipeId, { digest })`，返回 `{ recognized, ok, model, diagnostics, composition }`。它支持 workspace v2／v3 中普通已登记 recipe v1；草稿由宿主先使用既有只读覆盖器处理。内部克隆观察、合并派生与作者原关系／绑定、调用原 v3 模型后，把场景修订、诊断与来源全部映射回配方原文；不会返回合成观察、`sceneEditing` 或构建 snapshot。没有格式标记时 `recognized: false`，由调用方继续原 Scene2D 流程。

`composition` v1 只携带 `recipeObjectId`、`sourcePath`、`sourceRevision`、`fragmentCount`、`placementCount`。`sourceLocations.sceneFields` 增加标题／视口／背景位置；演员／组来源附 `fragmentId`、`placementId` 和 `localKey`。合成字段的主范围 `exact: false`，`contributors` 的每项是实际位置加 `role: template | override | offset | identity`；投影继承的复合尺寸与独立轴来源保留。宿主负责图片实际字节、并发读取守护与缓存，前端仅导航和渲染，不从来源推导写入权限。

## World 只读投影

`createWorldProjection(input, { digest })` 把已读取的旧作品、正文与登记映射为 World / Object / Resource，摘要函数由宿主注入。`queryWorldProjection` 与 `worldCommandDescriptors` 提供相同的查询和 revision 前置条件；它们不读取文件，不执行 ChangeSet。字段属性必须连同原文范围和 `sourceRevision` 使用，不能成为第二份权威数据。入口和边界见 [世界与对象](../docs/WORLD_PROJECTION.md) 及 [ADR 0002](../docs/adr/0002-world-projection-and-property-authority.md)。

`world-command-contract.mjs` 提供轻量的属性命令描述、请求校验与可写性判断；浏览器查询入口不必加载解析依赖。`preparePropertySet(projection, content, request, { digest })` 在宿主提供的快照上检查 World / Object / source revision、生成单字段修改并验证解析往返。它返回原文修改计划及提案，不执行 I/O；`node-world-commands.mjs` 才负责锁和发布。完整边界见 [ADR 0003](../docs/adr/0003-single-property-command.md)。

`prepareChangeSet(source, projection, request, { digest })` 整体规划多个现有对象的属性修改及反向命令，仍不执行 I/O。日志、读取屏障和恢复属于宿主，实现边界见 [ADR 0004](../docs/adr/0004-recoverable-source-changesets.md)。

`prepareSceneCreate(source, projection, request, { digest })` 校验显式 Scene2D 声明，规划新正文及由角色／图片引用派生的登记。它复用同一个场景规划器，不依赖 Godot；Node 用受限事务共同保存两文件，见 [场景创建](../docs/PROJECT_BUILD.md#创建场景)。

`prepareSceneUpdate(source, projection, recordContent, request, { digest })` 保真修改已有 Scene2D v1／v2／v3 声明，保留逐字段继承／覆盖并追加缺少的定义或图片依赖。v2 按实例 UUID 复用重排后的原文片段；显式 v1→v2 升级以旧 `objectId` 初始化 `instanceId`，拒绝版本降级；v3 分组按组 UUID 无损匹配。共享定义或图片只登记一次，不生成额外的 World 对象。`world-scene-update.mjs` 中的原文变换也供受限 version 8 恢复重放；候选由同一场景规划器校验，不读取文件或执行引擎，见 [场景编辑](../docs/PROJECT_BUILD.md#编辑已有场景)。

`prepareObjectCreate(source, projection, request, { digest })` 检查新 UUID、类型、来源路径及正文，规划新正文与登记，并预测创建后的对象和世界 revision。它不读取模板、分配随机身份或创建文件；文件系统冲突检查、排他发布及恢复由 Node 宿主执行，见 [对象创建](../docs/WORLD_OBJECT_CREATE.md) 和 [ADR 0005](../docs/adr/0005-recoverable-object-creation.md)。

`prepareRelationAdd(source, projection, recordContent, request, { digest })` 检查两个端点的版本和关系图，只向原始登记 JSON 插入一个关系。保留原字节及未知数字，计算新关系与 revision；不修改正文或执行 I/O。Node 宿主负责元数据镜像、登记锁与恢复，见 [对象关系](../docs/WORLD_RELATIONS.md) 和 [ADR 0006](../docs/adr/0006-recoverable-relation-registration.md)。

`prepareResourceBind(source, projection, recordContent, request, { digest })` 校验对象和素材登记版本，向既有 `assetBindings` 追加一个用途绑定。复用可移植 `world-record-edit.mjs`，保留已有 JSON 字节；不读资源文件、不复制素材、不把离线状态解释为内容验证。Node 宿主以受限 version 4 意图提交／恢复，作品格式仍是 v2 / v3，见 [资源绑定](../docs/WORLD_RESOURCES.md) 和 [ADR 0007](../docs/adr/0007-recoverable-resource-binding.md)。

## 文档存储接口

`createDocumentStore({ storage, editablePrefixes, onWrite })` 返回 `getDocByPath(path)` 与 `writeDoc(payload)`，沿用编辑器的读写响应和冲突错误。`editablePrefixes` 由宿主的已验证项目配置提供，前缀包含末尾 `/`；不能直接采用请求中的目录值。`onWrite` 是保存成功后的缓存失效通知。

宿主提供以下异步操作：

| 操作 | 输入 / 输出与职责 |
| --- | --- |
| `transaction(path, operation)` | 对同一逻辑文档及其兼容别名串行执行 `operation`，异常后必须释放锁。不同服务实例访问同一作品时也须共享锁。 |
| `writeTransaction(path, operation, { create })`（可选） | 写入专用协调；未提供时回退到 `transaction`。Node 非创建写入在文档队列内取得登记锁，新建沿用登记流程内的锁；只读操作不创建锁。 |
| `resolve(path, { create })` | 检查目录边界与授权，返回 `null` 或 `{ path, exists, handle }`。`path` 为规范逻辑路径，`handle` 是宿主私有定位信息。允许创建时可返回尚不存在的目标。 |
| `read(reference)` | 返回同一读取快照的 `{ content, version, lastModified, writeState }`。修改时间为 ISO 字符串；版本使用现有 `sha256:<64位小写十六进制>` 或十进制修订号约定，不能仅依赖修改时间。`writeState` 可携带平台写入所需状态。 |
| `write(reference, content, { create, previous, documentType })` | 持久化并返回 `{ version, lastModified }`。`previous` 是上述读取快照；创建必须独占，失败须保留原文件；创建文档还须正确登记类型和稳定 ID。 |

核心不解析 `handle`、`writeState`，不假设文件系统可以执行重命名。平台必须兑现写入和登记的一致性要求；内存测试适配器只用来验证接口，不是 Android 的持久化实现。

平台错误可携带现有 `statusCode / errorCode / payload`；缺失文件用 `ENOENT`、独占创建冲突用 `EEXIST`，工作流会映射为既有接口错误。原始宿主错误不会成为保存失败时的用户可见文件路径。

桌面实现位于 `scripts/adapters/node-document-storage.mjs`，继续使用已有的目录校验、共享事务队列、内容指纹、原子替换和登记锁。媒体文件访问、索引落盘、完整项目导入导出、本机偏好仍属于桌面平台层。

## 验证与下一步

未发布增量的 `execution-tool-status.mjs` 是独立纯数据工具状态契约：严格分离 `unchecked`／`checking`／`ready`／`unavailable` 与受控失败原因，只有成功状态携版本及完整二进制摘要，不携路径、原始进程输出或执行权限。宿主显式探测复用已有适配器识别，浏览器只显示状态；见[中间层说明](../docs/BACKEND_MIDDLEWARE.md#工具身份检查未发布增量)。

`scripts/tests/portable-engine.test.mjs` 在没有 Node 全局对象的隔离环境中加载引擎及 YAML 浏览器版本，执行跨格式编辑、媒体引用和存储冲突场景，同时检查依赖方向。`portable-engine-scenarios.mjs` 也可通过静态测试页面在真实浏览器中运行，不需要应用 API。

Android 预览宿主已接入：`mobile/platform.mjs` 在 WebView 中复用本引擎，`src-tauri/src/mobile_storage.rs` 在应用私有目录执行原生读写。移动端索引即时生成，不需要 Node 或后台 HTTP 服务。编辑器保留按作品隔离的恢复草稿，恢复时沿用旧版本指纹，避免覆盖应用关闭期间发生的修改。

移动宿主已复用桌面项目包格式，通过系统文件选择器导入、导出。后续仍需媒体访问、模板配置和真机验证，见 [移动端说明](../mobile/README.md)。不要为了兼容宿主而改变现有作品格式或在正文中保存设备绝对路径。

作者验收的 Node 存储提供可选 `prepareWrite` 发布守护，供当前场景和正文版本复查；普通文档存储的既有接口与行为保持。移动资源包含纯包装校验，不提供本机引擎工作台的作者文档动作。

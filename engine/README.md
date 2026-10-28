# 可移植引擎

`engine/` 提供不依赖 DOM、Node、HTTP、Tauri 或具体执行引擎的规则、模型、规划和观察契约。文件读取、摘要实现、素材字节、进程及持久化由宿主注入或执行；共享 Rust／WASM 负责已迁入的领域规则，JavaScript 负责来源捕获、回执核对和编排。

本文是当前 API 导航，按数据、作者提案、执行观察和存储接口组织。源码版本 **0.2.5**，已收录自由平面碰撞、单向平台下穿、水平往返及端点事件，原始观察留存和共用有限执行预算分别维护；安装与平台范围见 [STATUS](../docs/STATUS.md)。[完整历史接口快照](../docs/history/engine-2026-10-25.md)保留请求示例、旧兼容细节及逐轮记录。以下 3D 标题中的旧版本号保留既有外部链接，不作为当前交付状态。

## 调用边界

| 输入／输出 | 使用约束 |
| --- | --- |
| 作者原文和逻辑路径 | `sourcePath` 是工程内 `/` 分隔路径；作品只保存逻辑路径或 `asset:<UUID>`，不保存磁盘绝对路径／`content://` 句柄 |
| 来源与提案 | 来源修订、私有品牌、精确目标和起始值共同绑定提案；JSON 克隆与序列化不能复制进程内授权 |
| 异步宿主操作 | await 前分离输入，返回后复验来源、会话与能力代际；完整候选检查不代替最后内存守护 |
| 领域与视图 | 领域返回冻结数据或提案，视图持有选择、原始输入和临时时钟；输入回填、Apply、Save 分开 |
| 执行 | backend 能力与 host 权限分别检查；纯计划、样本和观察不持有进程或任意文件访问权 |

## 数据与解析

| 模块／入口 | 职责 |
| --- | --- |
| `parseSourceContent(content, sourcePath, descriptor)` | 按所属文档类型解析 Markdown、文本、JSON、YAML |
| `buildDocumentLayout(parsed)` | 通用章节、字段组与内容块布局；元数据服从类型布局 |
| `createDocumentFieldDraft`／`serializeFieldDraft` | 按原文范围保真修改，保留未改字节、BOM、换行和注释；宿主仍需 `fieldValueValid` |
| `prepareMediaDraft` | 插入已登记图片／视频／音频引用 `{type,src:'asset:<UUID>',caption}`，不导入文件 |
| `createProjectModel(defaults)` | 从宿主注入的布局／模板默认值解析工程，显式定义不按内置文件名回退；不读取模板文件 |
| `document-model.mjs`／`document-contract.mjs` | 登记归属、兼容组装与共享 DTO；契约存在不表示平台已实现 |
| `resource-package.mjs` | 按稳定身份计算循环安全依赖闭包；ZIP、字节验证和导入事务属宿主 |
| `object-projection-template.mjs` 等投影模块 | 子模板继承、嵌入快照、配置／依赖与两文件 create／update 规划 |
| `json-source.mjs` | `JSON.parse` 确定值，无第三方依赖扫描器取得有界 UTF-16 范围并拒绝解码重复键；不再依赖 YAML CST |
| `scene-model.mjs`／`scene-identity.mjs` | Scene2D v1／v2／v3、有效投影值和来源；v2／v3 instanceId 区分实例，objectId 始终指向定义 |
| `scene-groups.mjs`／`scene-structure.mjs` | 稳定组织组、嵌套大纲与预览信封；无空间变换、可见性或行为语义 |
| `scene-draft-preview.mjs` | 单份已登记源码草稿的 128 KiB 捕获和 SHA-256 基线覆盖；克隆观察后重新派生，不产生构建或保存权 |

解析模型、索引与 World 属性是原文的投影，不是第二份可写权威数据。JSON 来源范围含 BOM，使用 UTF-16 半开区间；索引有大小、深度和节点预算，恢复兼容按事务版本分别处理。YAML 文档支持与轻量 JSON 索引的依赖边界分开。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-01)。

## 场景创作工作流

`validateSceneAuthoringCandidate(kind, proposal, payload, {sourceRevision})` 同步核验完整候选、来源、目标和有序变化，返回冻结小回执；不授予保存权限。`createSceneAuthoringWorkflow(options)` 仅通过来源、目录、预览、摘要、应用及通知端口编排，各入口独立持有会话与回执，退出释放临时预览。规则与接线见[场景创作](../docs/SCENE_AUTHORING.md)。

`script-authoring.mjs` 的 `listScriptStarters()`／`prepareScriptDraft(context,request)` 提供 Godot GDScript、Bevy Rust 起始内容与普通 TXT 草稿提案。`prepareScriptDraftApply` 再验当前会话、正文目录和类型目录；不创建 UUID、关系或执行源码。已有行为、声音、动画与物理各由自己的 edit／source 契约接入原文草稿，最终普通保存权仍属于宿主。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-02)。

## Rust 布局草稿

`studio-core.mjs` 不加载宿主文件，也不依赖 DOM；宿主以 `initializeStudioCore(loadBytes)` 提供 WASM。`dispatchStudioCore` 调用几何操作，`dispatchStudioCoreDraft` 调用协议第 1 版的 `layoutDraft.*` 状态操作。`dispatchStudioCoreSave` 调用同版本的 `layoutSave.*` 保存状态操作。`dispatchStudioCoreSource` 调用无状态的 `sceneSource.inspect`／`sceneSource.patch`。各域共用有界缓冲，分别校验操作及响应，同步完成；可选 `viento_core_scene_source_version() === 1` 能力导出区分支持源码操作的新核心与仅支持旧布局的核心，后者继续使用旧操作但不能执行源码补丁。

`createSceneLayoutDraft(payload)` 负责核对源文和预览身份，保留作者字段与修订条件，并创建 Rust 草稿。v2／v3 将实例 UUID 映射为 Rust 布局协议中名为 `objectId` 的不透明选择键，v1 沿用定义 UUID；作者声明中的 `objectId` 始终保留定义含义。这一几何／历史操作域接收不透明键和值，保持原协议；源码的受限定义／实例检查由独立 `sceneSource.*` 操作负责。`setPositions`、`undo`、`redo`、`reset` 的状态改变在 Rust 完成；JS 只缓存返回的当前坐标与状态。`command()` 继续组装 `scene.update`，`matches()` 沿用原文语义核对。调用者退出时必须执行幂等 `dispose()`；释放后其他方法拒绝访问，不返回陈旧状态。

保存版和源码草稿版共用 `createSceneGeometryDraft`，该会话只向 Rust 传几何身份和值。源码版另向无状态接口传递有界场景正文，严格检查和原文补丁不创建额外会话。源码版 `createSceneSourceLayoutDraft(model, source, { digest })` 核对原文 SHA-256、保存基线、计划版本、实例顺序／位置与 v3 组织侧带，返回同样的几何／历史方法及 `propose()`，没有 `command`、`beginSave` 或持久化接口。`source` 为 `{ sourcePath, baseSourceRevision, content }`，摘要函数返回 64 位小写 SHA-256。

`patchSceneSourcePositions(content, changes)` 调用 Rust 按 UTF-8 字节范围仅替换变化的坐标数值 token，返回 `{ afterContent, changedPaths }`；不相关原文、BOM、行尾和未改数字写法原样保留。源文本前后都限制 128 KiB UTF-8；严格扫描保留 64 层／100000 值节点预算、1–128 个实例及 v3 的 0–128 组／16 层限制。它只核对这一操作需要的源码结构，完整投影、依赖、资源与场景运行语义继续使用原 JS 模型，后端 JSON/CST 未迁移。`prepareSceneSourceLayoutApply(current, proposal, { digest })` 核对来源与基线，并重算完整候选，防止伪造修改；宿主仍须在 await 后检查当前场景身份、源码模式和编辑会话，才替换内存。应用保留原保存版本，不读取磁盘；外部文件改动仍可接收本地补丁，但后续预览或普通保存会各自检查原基线并报告冲突。没有跨视图统一撤销或多文件事务。

保存版的状态由随草稿存在的 Rust `LayoutSaveWorkflow` 持有，检查／保存／核对返回当前请求标识；重复或失效完成被拒绝。位置修改使审阅失效，非可编辑阶段不能修改位置。JS 保留作者原文、已审阅的请求／响应、摘要和回读校验，并在每次异步返回时核对会话归属。

独立 Rust `LayoutDraft` 可直接用于原生调用，`undo`、`redo`、`reset` 返回 `Result<bool, CoreError>`，保存阶段冻结时明确拒绝变更；JSON/WASM 草稿表最多 32 份，每份 1–128 个对象，历史最多 100 批次。句柄不持久化、不代表权限，布局状态结果不包含整个历史或作者正文；无状态源码补丁单独返回候选正文。此轮没有添加永久撤销、跨重启草稿恢复、原生 GUI 或 Android 场景入口。具体边界见 [共享核心架构](../docs/ARCHITECTURE.md#共享-rust-核心的运行边界)。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-03)。

## 文件内片段组合实验

`expandSceneComposition(content)` 经可选 Rust `sceneComposition.expand` 返回分离的 `{scene,sourceMap}`，不分配 UUID、不读 World 或文件。`resolveSceneCompositionPreview(observed,recipeId,{digest})` 映射预览和来源回原配方，不返回合成观察、构建 snapshot 或 sceneEditing；未识别格式由调用方继续原 Scene2D 路径。

| 文件 | Draft／Apply 入口及职责 |
| --- | --- |
| `scene-composition-layout.mjs`／`scene-composition-batch-layout.mjs` | 单实例／批次位置，保留模板、覆盖与放置来源 |
| `scene-composition-overrides.mjs` | `createSceneCompositionOverrideDraft`／`prepareSceneCompositionOverrideApply`：局部值设置和恢复 |
| `scene-composition-fragments.mjs` | `createSceneCompositionFragmentDraft`／`prepareSceneCompositionFragmentApply`：共享声明的 propose／proposeEdit；有效值不填补未声明字段 |
| `scene-composition-placement.mjs` | `createSceneCompositionPlacementDraft`／`prepareSceneCompositionPlacementApply`：整份放置 offset 设置或删除，显式零与缺失不同 |
| `scene-composition-placements.mjs` | `createSceneCompositionPlacementsDraft`／`prepareSceneCompositionPlacementsApply`：新增、复制、移除放置；调用方显式提供身份 |
| `scene-composition-structure.mjs` | `createSceneCompositionStructureDraft`／`prepareSceneCompositionStructureApply`：共享演员新增／移除，核对全部相关放置 |

每份提案绑定原文、预览、保存基线、完整目标和有序 changedPaths。Rust 原子执行并重新展开，宿主复验候选模型、图片、摘要和当前会话后只写内存。恢复和 null 的语义按字段分别定义；所有被局部覆盖掩蔽的共享声明仍可显式修改。原文预算为 128 KiB，声明与展开规模有独立限制，不能用未放置片段绕过预算。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-04)。

## 组织分组原文创作

`scene-composition-groups.mjs` 提供 `createSceneCompositionGroupsDraft` 与 `prepareSceneCompositionGroupsApply`。独立可选 `viento_core_scene_composition_groups_version() === 1` 对应新增组、编辑名称／父级、演员归组和删除空叶组；纯提案在异步前分离作者输入，宿主重新核对完整影响与精确补丁。每份放置的组 UUID 独立且稳定，组织变化不移动实例或改变运行计划；保存沿用主编辑器。范围与操作见[组织分组指南](../docs/SCENE_COMPOSITION.md#编辑共享片段的组织分组)。

## 片段定义原文创作

`createSceneCompositionDefinitionsDraft(model,source,{digest})` 返回 raw 片段和放置快照，`propose` 支持 add／copy／remove／rename，`prepareSceneCompositionDefinitionsApply` 重算来源、完整意图和精确补丁。新增提供完整声明，复制仅改定义身份，删除要求无引用，重命名同步全部匹配放置；这些操作不产生实例 UUID，targets 保持空数组。

定义动作与重命名各有独立可选 Rust marker，前后展开仍限 128 KiB、32 片段、128 声明演员与组；同名重命名的无变化回执不能作为编辑提案。`dispatchStudioCoreCompositionDefinitionLocations` 只返回有序 JSON Pointer 对应的 UTF-16 来源，最多 4096 条、每条 4096 UTF-8 字节；缺路径回退最近容器并注明 exact，不授予写入权。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-09)。

## 配方到独立运行场景

`scene-composition-materialize.mjs` 以来源原文、登记投影、保存态预览和读取后的 World 修订规划独立 Scene2D。摘要由调用方注入，展开仍归共享 Rust 核心；生成新场景的命令复用 `scene.create`，原配方和元数据不写入。界面只编排读取、审阅、保存及结果核对，不把引擎或渲染依赖引入规划层。具体使用与边界见[配方指南](../docs/SCENE_COMPOSITION.md#从配方创建运行场景)。

项目内运行的独立模块：`project-runtime-contracts.mjs` 约束身份、访问与事件预算；`project-runtime-events.mjs` 按访问复用既有场景／行为／音频读取器；`project-runtime-query.mjs` 将当前对象与访问历史组合为只读视图。它们不加载引擎、不编辑作者文件，Godot 元数据请求接口和节点清理由后端实现；具体边界见[项目内切换](../docs/PROJECT_ASSEMBLY.md#运行中切换场景)。

`project-audio-commands.mjs` 保存有界的实际控制回执；项目协议 4 从冻结行为与音轨分别解析来源，查询保留跨访问历史。它不推断设备播放状态，不取得播放器或作者写入权限。声音声明与空时间线仍由 Rust 校验。

## 声音、动画与二维物理

角色运动事件与事件声音起始内容是普通TXT草稿，沿既有 `script-authoring` 创建／保存／绑定路径交付。Godot行为局部 `viento_character_motion` 只报告 jumped／landed，起始脚本自己发布已有项目事件；无新Rust声明或编辑器跨区写入权。事件声音可按实例UUID过滤，媒体控制和来源观察继续使用原契约。

| 模块族 | 纯契约和接口边界 |
| --- | --- |
| `scene-audio-*` | Rust 声明／采样、原文提案、音轨目录、绑定素材目录和试听准备各自独立；字节、WebAudio 与运行归宿主 |
| `scene-animation-core.mjs` | Rust 检查、采样、transport、片段、retime 和 copyTrack；可选 ABI 门控，不做 JS 规则回退 |
| `scene-animation-edit.mjs` | retime／copyTrack 表单 helper 返回本地候选；`createSceneAnimationProposal` 才产生来源提案，Apply 和 Save 继续独立 |
| `scene-animation-directory.mjs`／`scene-animation-usage.mjs` | 保存态片段目录、行为参数 UUID 文字匹配与品牌来源；不执行脚本或推断动态引用 |
| `animation-state-*.mjs` | 完整表准入、v1–v5 源码 codec、静态图、标量／共享值／平面组合与手动试算；真实运行证据另读 |
| `project-animation-*.mjs`／`project-event-review.mjs` | 有界账本、完整观察准入、来源关联和独立回看模型；不使用当前作者文件补造冻结事实 |
| `scene-physics2d.mjs`／`scene-physics2d-edit.mjs` | Rust 声明检查、显式关系子计划与原文编辑；目标、空间目录和执行能力分开 |
| `project-physics2d-trace.mjs` | 独立物理观察流准入、冻结身份／来源映射、访问次序与256样本预算；只读快照不改作者声明或既有运行对象坐标 |
| `scene-physics2d-targets.mjs` | 保存态实例目录与精确 source5 品牌、所有体的成员核对；Apply 前目录重读由宿主负责 |

动画 schema 4 的逐实例运行、旧整场景协议兼容与目标时钟见[正式运行边界](../docs/ARCHITECTURE.md#逐实例正式动画运行边界)。声音、动画、物理的首次创建分别由 `world-audio-create.mjs`、`world-animation-create.mjs`、`world-physics2d-create.mjs` 规划，三文件事务在宿主执行，不借编辑提案直接落盘。

`inspectScenePhysics2D(document)` 捕获输入后按 schema 分派：v1 使用既有 `scenePhysics2D.inspect`，v2 使用独立 `scenePhysics2D.inspectResponse` 与 `viento_core_scene_physics2d_response_version` 可选标记。v2 仅角色接受可选 `collisionResponse: "stop" | "slide"`，省略为停止。编辑提案在显式滑动时才修改 schema 叶与响应字段；首次创建默认仍生成 v1。空间 DTO 继续只保存几何字段，既有偏移／尺寸提案不会删除原文中的响应声明。

`scenePhysics2DCapabilities(document)` 仅在实际滑动角色存在时追加 `physics.character-slide2d`；冻结场景与项目都需明确声明，缺失时拒绝。Godot 响应包装与旧停止生成器分离，两个 Bevy 适配器继续拒绝物理。作者格式、物理计划 v1、创建事务 v12 和项目运行线协议各自维护；详见[碰撞响应](../docs/SCENE_PHYSICS2D.md#选择角色的碰撞响应)。

schema 3 的角色可显式保存 `characterMotion`（platformer、重力、起跳速度、最大下落速度），且要求滑动响应。独立 `scenePhysics2D.inspectMotion`／`viento_core_scene_physics2d_motion_version` 保持旧操作范围；JS桥接核对完整回执，原文编辑只修改相关叶及可选成员。`scenePhysics2DCapabilities` 从实际声明另派生 `physics.character-motion2d`；能力缺失时冻结计划、后端及生成回执分别拒绝。Godot 独立包装负责模拟，核心不持有速度／着地状态或引擎节点，观察v1与项目协议保持。关闭模式保留当前格式（schema 3或4），生成器显式转换到旧无运动分支。

schema 4 以 `oneWay: { margin: 1 }` 增加静态矩形单向平台，容差有限且在 1–64 内。`inspectScenePhysics2D` 按版本选择独立 `scenePhysics2D.inspectOneWay`；`supportsStudioCoreScenePhysics2DOneWay`／`dispatchStudioCoreScenePhysics2DOneWay` 只依赖 `viento_core_scene_physics2d_one_way_version() === 1`，完整验证继承的 motion／slide 字段。旧操作仍严格对应 schema 1／2／3。`scene-physics2d-edit.mjs` 对 `oneWay.margin` 作叶级更新，三种可选字段共享不重叠的增删补丁；首次启用升级、关闭删除字段但不降版本，普通创建默认保持。

水平往返平台使用物理schema 5的独立核心域 `scenePhysics2D.inspectPlatformMotion`，仅静态矩形接受 `platformMotion: {kind: "horizontal", offsetX, speed}`。保真编辑器显式升级声明；真实轨迹和承载由执行后端处理，Web空间图保持几何显示。[使用与边界](../docs/SCENE_PHYSICS2D.md#配置水平往返平台)。

`physics.one-way-platform2d` 仅由实际 `oneWay` 字段派生；Godot 0.26.0 包装配置固定朝上的原生矩形单向碰撞及 margin，原运动／事件层和项目／观察协议保持。0.26包装本身只配置静态单向面；水平运动与主动下穿由后续独立层提供，任意方向尚未定义。两个 Bevy 适配器不支持。空间几何 DTO 不携带这些运行参数，表单几何修改保留完整作者声明。使用流程见[静态单向平台](../docs/SCENE_PHYSICS2D.md#配置静态单向平台)。

### 物理空间视图与字段提案

`captureScenePhysics2DSpace(source,raw)` 捕获只读空间数据；`createScenePhysics2DSpaceView(space,document)` 结合已检查物理声明与保存态实例位置，返回品牌几何。没有图片、求解器、DOM、IO 或隐式来源写权。

| 提案 API | 输入与输出 |
| --- | --- |
| `createScenePhysics2DOffsetProposal(view,bodyId,delta)` | 严格有限二维增量，返回冻结 `{bodyId,instanceId,fromOffset,offset,center,delta}`；合法最终 offset 各轴 ±8192 |
| `createScenePhysics2DResizeProposal(view,bodyId,delta)` | box 为完整宽／高增量两数，circle 为半径增量一数；返回冻结 `{bodyId,instanceId,fromShape,shape,center,delta}` |
| `isScenePhysics2DOffsetProposal`／`isScenePhysics2DResizeProposal` | 只识别本域创建的原品牌对象，克隆或伪造对象不通过 |
| `scenePhysics2DOffsetProposalMatches(proposal,view,bodyId,currentOffset)` | 同一视图、同一体和精确起始偏移 |
| `scenePhysics2DResizeProposalMatches(proposal,view,bodyId,currentShape)` | 同一视图、同一体、同种形状和精确起始尺寸 |

最终形状由原 Rust inspect 检查，矩形完整尺寸 1–8192，圆半径 0.5–4096；形状类型、中心和 offset 不因 resize 改变。拒绝越界、未知体、未解析目标、恶意对象和旧视图匹配，不夹取、不量化；零增量合法。渲染器通过真实逆 CTM 计算增量，控制器另外核验 raw 表单与会话，只回填变化字段，再走原 Check／Review／Apply／Save。

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

## 构建、执行能力与运行观察

| 模块 | 输出及限制 |
| --- | --- |
| `build-plan.mjs` | Scene2D v1 → plan 1，v2／v3 → plan 2，明确行为组合 plan 3；组织组不进入执行几何 |
| `backend-capabilities.mjs` | 严格 `viento-execution-backend` 描述符，判断七类操作、平台、计划和功能；不探测工具或回退引擎 |
| `execution-tool-status.mjs` | unchecked／checking／ready／unavailable；成功状态携版本与二进制摘要，不携路径或执行权限 |
| `scene-control-program.mjs` | 有限方向输入；全局／逐实例 schema 分离，1–64 步、单步 ≤0.25 秒、总 8 秒、演员×步数 1024、最后全释放 |
| `runtime-verification-case.mjs`／`runtime-case-document.mjs` | 有限用例、身份和断言；仅无行为 plan 2，完成／失败／缺样本分开，不模拟引擎 |
| `project-execution-budget.mjs` | 七维有限会话成本的原子预留与分离快照；业务身份、队列和记录留存由调用方管理 |
| `project-queued-requests.mjs` | 共用请求分流、时钟／FIFO终态关联、留存与异常收尾；领域规则由调用方提供 |
| `project-animation-requests.mjs` | 校验冻结动画来源、目标及命令，复用共用队列观察 |
| `project-audio-requests.mjs` | 校验冻结音轨、绑定与播放／停止请求；后端回执不证明设备出声 |
| `project-event-positions.mjs` | 复用原事件账本与精确帧，保留已结清发布尾部及全部未决的逐接收者位置 |
| `project-execution-frames.mjs` | 组合原reader准入精确业务帧封套，保留有界位置尾部，独立于预算窗口 |
| `project-execution-clock.mjs` | 组合reader校验独立调度观察；真实帧对、七维增量／总量与有界窗口，不补充执行额度 |
| `scene-runtime-events.mjs`／`scene-runtime-query.mjs` | 已冻结计划的身份、位置、生命周期和步骤准入，再返回不可变观察；来源来自计划，不采用进程任意路径 |
| `backend-project-delivery.mjs` | 绑定完整后端清单与摘要的交付审阅 DTO；归档成员和字节再由宿主验证 |

Godot、Bevy 数据与 Bevy Rust 的资源、语言和运行范围分别由后端声明。完整冻结、进程执行、工具身份和工程生成见[中间层](../docs/BACKEND_MIDDLEWARE.md)，模块状态不替代后端能力。

### 项目有限执行预算

`project-execution-budget.mjs` 导出冻结的 `PROJECT_EXECUTION_BUDGET_POLICY` 与 `createProjectExecutionBudget()`。后者返回冻结接口：`reserve(costs) -> boolean` 原子准入完整成本向量，`snapshot()` 返回七维已用计数的冻结副本。七维分别为 `eventRegistrations`、`eventPublishes`、`eventDeliveries`、`eventBytes`、`stateMutations`、`audioRequests`、`animationRequests`；具体上限见[共用策略](../docs/BACKEND_MIDDLEWARE.md#有限执行预算)。

成本向量只接受普通对象或 null 原型对象的可枚举自有数据字段；空向量与零成本有效。未知键、访问器、非安全整数、负数或超额整体返回 `false`，不执行 getter、不修改已用计数。输入和快照不能回写内部状态；每个预算实例独立，不提供 reset、业务序号或调度时钟。

`project-event-bus.mjs` 在身份、令牌及待处理容量检查完成后预留事件次数、接收者与字节；原有完整序列和投递语义不变。Godot 0.32.0 生成包装从同一策略输出 `execution-budget.json`，运行 helper 在一个协调器中供事件、状态、音频与动画调用；helper 和转换脚本接受严格库存核对，历史模板源字节与无预算层产物读取保留。`sequence`／`state_revision`／动画 `reserved_count` 继续表达业务身份，活动订阅和待处理容量由各自服务管理。

作者格式及项目运行协议 4／7／10／11 未改变，单场景生成不加入项目预算层。当前仍是有限会话，flush、deferred 和场景切换不重置额度，也没有 continuous 开关；原始帧尾部留存不改变这些执行上限。验证范围见[有限执行预算记录](../docs/test-results/runtime-execution-budget/README.md)。

### 项目执行调度观察

`project-execution-clock.mjs` 是0.2.5发布后的未发布开发增量。导出 `PROJECT_EXECUTION_CLOCK_PREFIX`（`VIENTO_EXECUTION_CLOCK:`）和 `createProjectExecutionClockReader({ runtimeReader, onSnapshot, retainedWindows = 32 })`。`runtimeReader` 必须提供 `push()`／`finish()`；可选 `onSnapshot` 接收分离快照，`retainedWindows` 允许1–8192。返回接口保留原事件、诊断和getter，并在物理组合存在 `snapshot()` 时继续转发；调度快照另从 `executionClock` 读取。

独立协议1只接受精确sample结构：`index`、`clock: { idleFrame, physicsFrame }`、七维 `used`／`total` 及 `reason`。原因限 `sample`、`rejected`、`finished`、`aborted`。新窗口时钟必须单调且至少一个维度前进；当前窗口可合并增量，累计成本必须等于上个窗口总量加当前增量，所有成本保持有限策略范围。非法观察原子拒绝，不能回退或部分修改最后合法记录。

`executionClock` 快照包含 `format: "viento-execution-clock-observation"`、`schemaVersion: 1`、`policyVersion: 1`、`limits`、`phase`、七维 `total`、`totalWindows`、`windows` 和 `retention`。窗口行保留实际帧对、成本、索引与原因；retention给出上限、累计／保留／移出数量及首末窗口索引。默认保留32个窗口，同窗口更新不增加总数。phase为 `waiting`／`recording`／`finished`／`incomplete`；reader收尾缺少合法终止或存在诊断时不确认完成。

每行限制16 KiB UTF-8，观察处理预算8192帧，诊断最多128条。分块输入仅暂存可能属于此前缀的内容，其他内容立即委托原reader；合法观察与业务协议互不占用对方帧编号。`finish()` 保留原返回形状，快照另由getter及回调提供。宿主将快照存入 `session.json.executionClock` 和任务同名字段，并对取消／失败／超时明确设置 `incomplete`；当前没有专用界面控件。

Godot0.33包装从真实引擎idle／physics计数生成窗口，复用冻结0.32预算和既有项目协议4／7／10／11。窗口是观察分组，不是因果事务；未增加reset或continuous开关，有限累计准入、业务序号、语义账本、输出及时限保持。实现分层见[执行调度观察](../docs/BACKEND_MIDDLEWARE.md#执行调度观察)，验证范围见[专题记录](../docs/test-results/runtime-execution-clock/README.md)，不沿用旧预算验收作为新增观察的通过证据。

### 项目因果锚点

`project-causal-anchors.mjs` 的 `createProjectCausalAnchors(runtimeObservation, { recentPerKind = 16 })` 从严格校验后的完整观察生成独立、分离且深冻结的 `viento-project-causal-anchors` schema1。支持旧项目协议1–11；无相应账本时不伪造节点。`recentPerKind`允许0–64，未知选项和访问器拒绝，非法数据不进入投影。

`nodes`使用原 `kind:sequence` 身份，四类为 `events`、`animationCommands`、`animationCompletions`、`animationStateEntries`，`record`保留冻结来源。`roots`的理由为 `recent`、`pending-delivery`、`target-baseline`、`latest-controller-entry`；当前ready访问的目标基线涵盖playing、paused、stopped和finished回执，最近控制器进入不声称实时active。`edges`区分触发来源 `trigger`、全局截止 `global-watermark` 和实际播放命令 `playback-command`。逐实例完成沿 `targetCommandSequence`定位播放，不能用全局截止代替。

所有保留根的引用递归保留并去重。`retention`为四类与aggregate提供total／retained／dropped；dropped只表示未纳入当前投影，旧完整账本仍保留。已退出访问不再贡献目标／控制器基线，已完成投递仍可能被保留入口引用。DTO放在会话／任务顶层 `causalAnchors`，不扩充旧project观察字段，不交回旧完整序号验证器。

此层不消费原始日志或给事件猜测引擎帧，不拥有执行预算、订阅身份和队列。未接收独立排队请求身份，也不把状态进入后的相邻命令当作其执行结果。[验证范围](../docs/test-results/runtime-causal-anchors/README.md)。

## 独立 3D 原始表示

`scene3d.mjs` 的 `parseScene3DSource(content)` 返回冻结的 `{ model, sourceLocations }`；独立可选 `viento_core_scene3d_version() === 1`、`supportsStudioCoreScene3D()` 和 `dispatchStudioCoreScene3D()` 提供 `scene3d.parse`。Rust 校验严格作者结构、预算、稳定身份、相机／灯光与裁剪约束，并定位原始对象 UTF-16 范围。`createScene3DPlan(content)` 派生独立 `kind: 'scene3d'` schema 1 计划；纯层没有 DOM、文件或具体引擎依赖。原文仍为普通文档保存权威，GUI 的 WebGL2 和 Godot 导出适配分别消费同一模型／计划。原 2D 格式、创作域和执行协议不变。规则见[3D 初步接入](../docs/SCENE3D.md)。

3D 作者域共同使用 source5、精确补丁回执和最终宿主会话守护；每域有独立可选 Rust 探针、私有品牌和 `create…Proposal`／`prepare…Apply`。缺某个域只关闭其入口，任何提案都不能跨域应用。下列接口的完整请求键、预算、退化条件及兼容实现见各节历史链接。

### 3D 双指导航接口（0.1.0 之后的工作树）

纯函数 `touchCamera(camera, startPoints, currentPoints, viewport, distanceLimit = 200000, distanceMinimum = 0.01)` 返回分离、冻结的临时相机或 `null`。每组触点为两个局部 CSS `[x, y]`，`viewport` 使用 CSS `width/height` 与实际绘图缓冲 `aspect`。两组间距均至少 4px；有效相机基底直接按正比例缩放，不经 Euler 轨道的俯仰限制，再复用 `panCamera` 使起始两指中心的目标深度世界点落到当前中心。锚点修正使用实际可表示且受限的距离比例；保持原方向、可选 `up`、FOV 和裁剪声明。非法／退化输入、溢出、不可表示缩放与明显精度损失拒绝整个结果，不修改输入。规则同时适用透视与正交；透视其他深度仍按自身深度产生视差。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-11)。

### 3D 坐标方向观察接口（0.1.0 之后的工作树）

纯函数 `orientationAxes(camera)` 仅消费有效相机基底，返回冻结的三项数组或 `null`。每项为 `{ axis: 'X' | 'Y' | 'Z', x, y, depth }`，分别对应正轴在屏幕右方向、屏幕向下方向及观察者方向的分量；`depth > 0` 表示朝向观察者。结果与 FOV、投影和作者语义无关，整体平移或改变镜头距离不改变方向；显式临时 `up` 保持精确极点与自由滚转的一致性。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-12)。

### 3D 正交投影视图接口（0.1.0 之后的工作树）

`cameraProjection4(camera, aspect, projectionMode = 'perspective')` 返回冻结的 16 元素列主序投影矩阵或 `null`，不包含 `lookAt4`。只接受 `perspective/orthographic`；透视路径保留既有 `perspective4` 的逐项输出。正交高度为 `2 * distance * tan(FOV / 2)`，宽度为高度乘实际绘图缓冲比例，沿右手 OpenGL 约定使用原 near/far。因此切换模式保留目标深度的显示中心和尺度，其他深度的尺寸会按投影规则改变。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-13)。

### 3D 临时镜头平移接口（0.1.0 之后的工作树）

`web/modules/scene3d-math.js` 的 `panCamera(camera, deltaX, deltaY, { width, height, aspect })` 是纯视图函数，返回分离、冻结的相机或 `null`。位移与 `width/height` 使用 CSS 像素，`aspect` 使用实际绘图缓冲宽高比。函数在当前相机基底内同时平移位置和目标，使目标深度处的几何跟随指针；正交模式下所有深度采用相同屏幕位移。保持原方向、距离、FOV、near/far 和可选临时 `up`；零拖动返回分离的无变化结果。它不使用作者坐标上限或普通轨道默认距离边界。非法输入、溢出、消失的拖动与明显精度损失拒绝整次计算；远坐标小物体允许正常舍入。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-14)。

### 3D 标准方向的视图接口（0.1.0 之后的工作树）

纯视图数学 `standardViewCamera(camera, direction)` 只接受 `front/back/left/right/top/bottom`，返回分离、冻结的相机或 `null`；临时 `up` 为显式三元向量。俯视为+Y侧／上方−Z，仰视为−Y侧／上方+Z，其他方向上方+Y。`lookAt4(position, target, up)`、对象／整景聚焦和 `orbitCamera` 共用该基底；没有显式up的作者相机保持原世界Y轨道与极点拒绝。带up的轨道使用屏幕局部轴连续旋转，零旋转缩放保持精确极点，聚焦结果与renderer快照复制up以隔离外部修改。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-15)。

<a id="3d-只读浏览导航未发布增量"></a>

### 3D 只读浏览导航（0.1.0）

`scene3d-navigation.mjs` 复用已有 Rust `scene3d.parse` 的模型与来源，不增 schema、原生操作或编辑探针。`createScene3DObjectIndex(parsed)` 生成深冻结的显示行，`queryScene3DObjects(index, query)` 按名称／UUID 忽略大小写的字面子串筛选，保留声明顺序和稳定身份；仅查询 trim，不改作者名称。显示索引与作者提案、执行身份和保存资格分开。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-16)。

### 3D 全场景取景（0.1.0）

`scene3d-math.js` 的 `sceneBounds(objects)` 以所有方块真实旋转八角点计算冻结的 `{ min, max, center, radius }` 或 `null`；`frameSceneCamera(camera, objects, aspect)` 保留当前视向与 FOV，使用实际画布比例生成临时相机或 `null`。全场景包围保证不等于远处微小对象具有可辨像素。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-17)。

<a id="3d-画布选择未发布增量"></a>

### 3D 画布选择（0.1.0）

画布命中属于视图坐标和输入适配，不新增 Rust 作者操作、schema、`engine/index.mjs` 导出或宿主权限。`web/modules/scene3d-picking.js` 的纯 `pickScene3DObject(frame, clientX, clientY)` 消费实际绘图帧 `{ rect, width, height, viewProjection, objects: [{ instanceId, model }] }`；矩阵是实际上传的 Float32 值，返回最近可见方块的 UUID 或 `null`，不修改输入。CSS 客户坐标通过当前画布位置映射；近面／中间深度构造有限射线，再检查真正的方块表面及齐次裁剪，避免极端裁剪比例下 Float32 远点变为无穷。完全同深度时与现有 `LEQUAL` 绘图一致，后声明优先。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-18)。

<a id="3d-选择反馈未发布增量"></a>

### 3D 选择反馈（0.1.0）

渲染器新增可选 `setSelectedObject(instanceId | null) -> boolean`，只持有临时稳定身份。未加载模型、未知身份、非法输入、上下文丢失或释放后返回 `false` 且不改变状态；有效身份或显式 `null` 更新视觉选择，同值调用成功且不重绘。`setModel` 清理旧选择，由独立预览在成功加载后同步；`resetView` 保留选择。`snapshot().selectedInstanceId` 是 UUID 或 `null`，不携带作者范围或写入资格。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-19)。

<a id="3d-单对象变换未发布增量"></a>

### 3D 单对象变换（0.1.0）

`scene3d-transform.mjs` 提供 `createScene3DTransformProposal(source,edit)`、`isScene3DTransformProposal` 与 `prepareScene3DTransformApply(source,proposal,{digest})`。按稳定 UUID 修改现有对象的位置／旋转／尺寸；只改被批准的数值 token，不重新序列化整份场景。完整来源、目标和精确回执重算通过后，只返回普通内存草稿应用所需数据；Save 与外部冲突由文档宿主负责。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-20)。

<a id="3d-对象结构管理未发布增量"></a>

### 3D 对象结构管理（0.1.0）

`scene3d-objects.mjs` 提供 `createScene3DObjectsProposal(source,edit)`、`isScene3DObjectsProposal` 与 `prepareScene3DObjectsApply(source,proposal,{digest})`。新增、复制或移除一个方块；身份由调用方明确提供，保持无关声明与顺序，不引入素材或层级关系。完整来源、目标和精确回执重算通过后，只返回普通内存草稿应用所需数据；Save 与外部冲突由文档宿主负责。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-21)。

<a id="3d-环境原文编辑未发布增量"></a>

### 3D 环境原文编辑（0.1.0）

`scene3d-environment.mjs` 提供 `createScene3DEnvironmentProposal(source,edit)`、`isScene3DEnvironmentProposal` 与 `prepareScene3DEnvironmentApply(source,proposal,{digest})`。作者相机、方向光、背景以及可选雾／粒子场；全候选重验相机和裁剪，临时预览相机不进入提案。完整来源、目标和精确回执重算通过后，只返回普通内存草稿应用所需数据；Save 与外部冲突由文档宿主负责。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-22)。

<a id="3d-对象属性原文编辑未发布增量"></a>

### 3D 对象属性原文编辑（0.1.0）

`scene3d-properties.mjs` 提供 `createScene3DPropertiesProposal(source,edit)`、`isScene3DPropertiesProposal` 与 `prepareScene3DPropertiesApply(source,proposal,{digest})`。现有 UUID 的名称／颜色，保持其他字段和原文；缺属性 ABI 不关闭其他作者域。完整来源、目标和精确回执重算通过后，只返回普通内存草稿应用所需数据；Save 与外部冲突由文档宿主负责。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-23)。

<a id="3d-多对象整体移动未发布增量"></a>

### 3D 多对象整体移动（0.1.0）

`scene3d-translation.mjs` 提供 `createScene3DTranslationProposal(source,edit)`、`isScene3DTranslationProposal` 与 `prepareScene3DTranslationApply(source,proposal,{digest})`。1–128 个对象一次共同偏移、整体检查最终边界；不循环调用单对象变换，也不采用预览选择作为授权。完整来源、目标和精确回执重算通过后，只返回普通内存草稿应用所需数据；Save 与外部冲突由文档宿主负责。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-24)。

<a id="3d-参照位置对齐未发布增量"></a>

### 3D 参照位置对齐（0.1.0）

`scene3d-alignment.mjs` 提供 `createScene3DAlignmentProposal(source,edit)`、`isScene3DAlignmentProposal` 与 `prepareScene3DAlignmentApply(source,proposal,{digest})`。2–128 个所选对象沿单轴对齐到明确参照；参照必须在选择内，依据原文值一次生成完整候选。完整来源、目标和精确回执重算通过后，只返回普通内存草稿应用所需数据；Save 与外部冲突由文档宿主负责。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-25)。

<a id="3d-单轴等距分布未发布增量"></a>

### 3D 单轴等距分布（0.1.0）

`scene3d-distribution.mjs` 提供 `createScene3DDistributionProposal(source,edit)`、`isScene3DDistributionProposal` 与 `prepareScene3DDistributionApply(source,proposal,{digest})`。3–128 个对象按原坐标和声明序稳定排序、保留两端、单轴等距分布；范围、舍入和无变化由 Rust 统一处理。完整来源、目标和精确回执重算通过后，只返回普通内存草稿应用所需数据；Save 与外部冲突由文档宿主负责。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-26)。

<a id="3d-批量复制未发布增量"></a>

### 3D 批量复制（0.1.0）

`scene3d-copy.mjs` 提供 `createScene3DCopyProposal(source,edit)`、`isScene3DCopyProposal` 与 `prepareScene3DCopyApply(source,proposal,{digest})`。现有对象一对一新身份及共同偏移，按原文片段保真追加；总对象最多 128，检查不重新分配 UUID。完整来源、目标和精确回执重算通过后，只返回普通内存草稿应用所需数据；Save 与外部冲突由文档宿主负责。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-27)。

<a id="3d-批量移除未发布增量"></a>

### 3D 批量移除（0.1.0）

`scene3d-removal.mjs` 提供 `createScene3DRemovalProposal(source,edit)`、`isScene3DRemovalProposal` 与 `prepareScene3DRemovalApply(source,proposal,{digest})`。一次计算多个现有 UUID 的删除区间，至少保留一个对象；全选拒绝，不静默缩减，不删除资源。完整来源、目标和精确回执重算通过后，只返回普通内存草稿应用所需数据；Save 与外部冲突由文档宿主负责。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-28)。

### 可选距离雾（0.1.0 之后的工作树）

作者 schema 1 与独立 scene3d plan 1 允许可选 `fog: { color, density }`，其中 color 为六位 hex，density 是 `0..1` 的每场景单位衰减系数。缺省或零关闭；不改变模板包，不隐式填充旧模型。`supportsStudioCoreScene3DFog()` 检查独立 `viento_core_scene3d_fog_version() === 1`。含雾解析及雾修改需要该能力，原环境能力保持可用。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-29)。

### 通用粒子场（0.1.0 之后的工作树）

`supportsStudioCoreScene3DParticles()` 检查可选 `viento_core_scene3d_particles_version() === 1`。scene3d schema 1／plan 1 的可选 `particleField` 具有完整 center／extent／velocity／size／color／count／seed，严格拒绝额外或缺失字段。缺省保持缺省，count=0 关闭。

`prepareScene3DParticleField`／`sampleScene3DParticleField` 复用 Rust 的确定分布与显式时刻偏移；临时播放头、渲染、作者字段与后端导出分别负责。雨雪是通用粒子参数组合，不要求细分模板。

[完整接口细节与阶段记录](../docs/history/engine-2026-10-25.md#section-30)。

## 字面源码查找与替换规划

`source-search.mjs` 独立于语言、文件系统和界面。`findSourceMatches({ text, query, matchCase })` 返回冻结的非重叠 UTF-16 区间，空查询返回空数组；`matchCase` 默认 true，关闭后采用保留原始偏移的 Unicode 简单大小写匹配。

`planSourceReplacement({ text, query, replacement, matchCase, selectionStart, selectionEnd, all })` 返回冻结的 `changed/start/end/replacement/selectionStart/selectionEnd/count`。单处模式要求选区恰好是一处匹配；全部模式合成最小包围区间，保留各匹配之间的正文。替换值始终为字面内容。没有净变化时不要求宿主创建编辑事务。

原文需为 LF 文本，输入及输出最多 4 Mi UTF-16，查询 4096、替换输入 65536 码元，非重叠匹配最多 10000 处。非法输入报告 `source_search_invalid`，匹配或输出预算超限报告 `source_search_limit`；不返回可误认为完整结果的截断列表。宿主负责来源和当前文本守护、浏览器原生事务及普通保存；此模块不验证磁盘修订。

## 当前任务诊断快照与筛选

`project-problems.mjs` 提供 `createProjectProblemsSnapshot({task, diagnostics})` 与 `filterProjectProblems(snapshot, {severity, query, messages})`。前者输出冻结的 `{task, rows}`，每行保留原始零基 `index`；后者返回 `{rows, total, matched, counts}`，严重度统计始终基于完整快照。`messages` 可选，按全部行顺序传入当前语言消息。检索为 Unicode 忽略大小写的字面子串，不跨字段拼接；原始顺序与重复项保留。

最多 256 行；纯核心查询最多 4096 UTF-16（界面限制 512），消息键 2000、翻译 4000、详情 8192、路径 4096、字段路径 2048。任务身份为有界标量；来源范围要求 UTF-16 整数边界、原始字段路径、显式 exact 与 SHA-256 修订，实际字符边界及当前修订由读取原文的宿主核对。缺失标量由适配器显式提供空字符串，无范围时省略 `sourceRange`；畸形记录、getter、稀疏数组、超限或无效来源均抛出 `project_problems_invalid`。筛选复验序列化快照，无模块私有品牌要求，便于后续原生适配。

## 验证与下一步

`scripts/tests/portable-engine.test.mjs` 在无 Node 全局对象的隔离环境验证解析、字段、媒体、存储冲突和依赖方向；`portable-engine-scenarios.mjs` 可在真实静态浏览器页面运行。Rust 原生／WASM、一致性、来源守护、GUI 和实际引擎分别验证，最新范围见[测试指南](../docs/TESTING.md)及[功能图谱](../docs/FUNCTION_ATLAS.md)，历史结果不因整理重标。

Android 的 `mobile/platform.mjs` 在 WebView 复用可移植规则，Rust `mobile_storage.rs` 执行私有目录原子读写、即时索引与恢复；项目包复用桌面格式。移动资源构建不等于本机作者工作台或引擎执行支持，媒体、模板配置及设备验收按[移动端说明](../mobile/README.md)单独判断。未来宿主接入应实现注入端口，不能改写作品逻辑路径或绕过来源／保存契约。

`godot-character-contact-events-script.mjs` 是普通作者起始源码：校验独立 `viento_character_contacts` 版本1及两字符串信号，发布 `physics.contact_started`／`physics.contact_ended`，载荷为对方实例UUID，可用 `other_instance_id` 过滤。自身身份仍由现有项目端口绑定，旧运动、触发区与声音模板保持；此脚本不承担接触集合计算或文件保存。语义与设置见[移动碰撞事件](../docs/SCENE_PHYSICS2D.md#用角色移动碰撞驱动项目事件)。

0.2.5 源码让同一碰撞起始脚本支持自由平面停止／滑动角色，参数与端口版本保持；运行求解、集合差项及普通作者事件仍由各自层负责。实际适配范围见[物理指南](../docs/SCENE_PHYSICS2D.md#用角色移动碰撞驱动项目事件)。

`godot-character-drop-through-script.mjs` 把已有输入动作的按键边沿转换为自身 `viento_character_drop.request_drop()`，只有 `drop_action` 参数。端口拒绝是正常玩法结果；几何支撑、例外恢复和生命周期由独立Godot控制器负责，脚本不承担移动、碰撞查询或文件保存。见[主动下穿](../docs/SCENE_PHYSICS2D.md#从单向平台主动下穿)。

`godot-platform-endpoint-events-script.mjs` 是普通TXT起始内容，严格核对 `viento_platform_events` 版本1、零参起点／终点信号和本实例身份。`origin_event`／`destination_event` 空名各自禁用，发布载荷为平台UUID。运行端每端每项目步合并通知，不在脚本中轮询位置、推进轨迹或管理物理句柄；现有项目事件预算保持。见[平台端点事件](../docs/SCENE_PHYSICS2D.md#用平台端点事件驱动动画与声音)。

`project-runtime-events.mjs` 将原始帧保留窗与累计准入、启动／结束状态分离；`retention` 描述原始帧序号范围，`lifecycle` 描述已验证状态。回调和每次 `push()` 返回所有新准入帧，业务账本仍保留完整有限语义。`project-runtime-query.mjs` 仅留最后一条原始帧，独立消费语义结果；这不解除4096帧或各业务的累计执行预算。

### 项目业务帧位置

`createProjectExecutionFramesReader({ runtimeReader, onSnapshot, retainedFrames = 128 })` 从 `project-execution-frames.mjs` 导出，与 `PROJECT_EXECUTION_FRAME_PREFIX`（`VIENTO_EXECUTION_FRAME:`）配套。`retainedFrames` 允许1–4096；原reader必须提供 `push()`／`finish()`，原getter及物理 `snapshot()`继续转发。对旧业务DTO本身不增加字段，仅在独立协议1封套中校验连续index及单调 `{idleFrame, physicsFrame}`，准入仍由原reader决定；有该能力的新构建拒绝裸项目帧。

`executionFrames` 返回分离快照：`format: "viento-project-execution-frames"`、`schemaVersion: 1`、`phase`、`totalFrames`、`frames`和`retention`。每行只保留index、clock和紧凑reference；retention给出limit／total／retained／dropped／firstIndex／lastIndex。phase为waiting／recording／finished／incomplete。业务通知异常后的已准入事实只保存一次；透传clock通知仍可独立完成收尾。

Godot0.34在真实输出点采集计数，Node将快照保存至session与任务接口。零成本业务位置不能强制归入预算窗口，尾部之外的因果锚点不会获得推测时钟。具体行与帧预算、库存和旧构建重建要求见[中间层](../docs/BACKEND_MIDDLEWARE.md#业务回执的精确引擎帧)，实际证据见[专题](../docs/test-results/runtime-execution-frames/README.md)。

### 动画排队请求观察

`project-animation-requests.mjs` 导出 `PROJECT_ANIMATION_REQUEST_PREFIX`（`VIENTO_ANIMATION_REQUEST:`）及 `createProjectAnimationRequestsReader(plan, { runtimeReader, protocolVersion = 7, onSnapshot, retainedRequests = 128 })`。runtimeReader必须已组合精确业务帧层；业务协议可为5–11，逐实例计划要求11，当前产品按内容选择7／10／11。retainedRequests允许1–256，仅限制终态尾部；原getter、业务返回值及物理snapshot继续转发。

独立协议1的accepted精确携带requestId、clock、origin、target和command；origin只含visitIndex／sceneId／bindingId／instanceId／objectId，source由冻结计划构造。applied另含commandSequence及executionFrameIndex，必须匹配FIFO队首、已准入原animation-command和当前精确业务帧时钟；discarded仅接受运行error后的队首及reason=abort。接受时seek只校验整段duration，选择后的范围继续交给原执行准入。

`animationRequests`返回分离DTO：`format: "viento-project-animation-requests"`、schemaVersion=1、phase、counts（accepted／applied／discarded／pending）、requests和retention（limit／total／retained／dropped／pending／terminal／firstRequestId／lastRequestId）。请求行包含requestId、status、acceptedClock、冻结origin、target、command，以及终态的applied（clock／commandSequence／executionFrameIndex）或discarded（clock／reason）。行按requestId排序，默认最近128条终态加全部未决请求，最多64条未决。

每会话最多256个连续请求ID、512次此前缀尝试；去行尾观察行最多16 KiB UTF-8，诊断最多128条。无完整applied证据时保留pending，即使原业务回执已经准入；业务观察者异常不重放，尾帧与独立clock仍按原收尾边界保留。finished仅在业务完成、无未决及诊断后确认；宿主失败／取消／超时标incomplete。无动画旧reader由适配器能力开关保持原入口；音频由独立能力选择其领域reader，事件请求身份与continuous仍未开放。合同见[中间层](../docs/BACKEND_MIDDLEWARE.md#动画排队请求观察)，验证范围见[专题](../docs/test-results/runtime-animation-requests/README.md)。


### 共用队列与音频请求观察

`project-queued-requests.mjs` 提供动画与音频共用的观察机制：前缀分流、单调时钟、FIFO队首与原业务回执关联、终态留存和回调异常收尾。领域模块分别提供冻结计划准入，原业务reader继续拥有实际命令及状态规则；共用机制不合并两域身份、队列或预算。

`project-audio-requests.mjs` 导出 `PROJECT_AUDIO_REQUEST_PREFIX`（`VIENTO_AUDIO_REQUEST:`）及 `createProjectAudioRequestsReader(plan, { runtimeReader, protocolVersion = 4, onSnapshot, retainedRequests = 128 })`，支持业务协议4–11，在精确业务帧reader之外组合。retainedRequests允许1–256，仅限制终态尾部。accepted携带requestId、clock、origin五种身份、trackId与action（play／stop）；来源及音轨资源从冻结计划派生，进程不能指定作者路径。applied携带commandSequence和executionFrameIndex，须匹配原audio-command与当前精确帧时钟；discarded仅在真实业务error之后接受队首reason=abort；这是abort循环于移除队首前同步输出的清理标记，不推定播放发生或失败。

`audioRequests` 返回独立的 `viento-project-audio-requests`、schemaVersion=1快照，包含phase（waiting／recording／finished／incomplete）、counts（accepted／applied／discarded／pending）、requests和retention（limit／total／retained／dropped／pending／terminal／firstRequestId／lastRequestId）。请求行保存requestId、status、acceptedClock、origin五身份与冻结source、track（trackId／resourceId／冻结source）、action，以及显式applied或discarded证据；默认保留最近128条终态加全部pending，最多64条未决。音频与动画各有256个会话请求ID和256次有限预约，不共享编号或返还额度；前缀尝试、单行及诊断上限同共用观察合同；拒绝诊断为runtime_audio_request_invalid，限额诊断为runtime_audio_request_limit。没有完整applied证据时保留pending，不从取消推断丢弃，也不从已验证后端调用推断设备出声。

Node将快照保存到会话与任务接口，原业务协议保持。含音轨Godot项目使用0.36外层，无音轨但有动画仍为0.35，两者均无为0.34。新领域与共用reader的最终验证、组合库存、宿主和真实引擎范围见[音频专题](../docs/test-results/runtime-audio-requests/README.md)，合同见[中间层](../docs/BACKEND_MIDDLEWARE.md#音频排队请求观察)；本轮未发布或更新安装。

### 项目事件发布与投递位置

`project-event-positions.mjs` 导出 `createProjectEventPositionsReader({ runtimeReader, onSnapshot, retainedEvents = 32 })`。下游必须提供已有 `projectEvents` 语义账本及 `executionFrames`，retainedEvents允许1–128，仅限制已结清发布尾部。此层逐行委托原读取器，不解析新前缀、不增加游戏请求；完整原账本、FIFO和预算仍由既有模块维护。

`eventPositions` 为 `viento-project-event-positions`、schemaVersion=1，phase取waiting／recording／finished／incomplete；counts为published／settled／pending／deliveries／handled／skipped／pendingDeliveries，deliveries表示已预留接收者总数。retention为limit／total／retained／dropped／pending／settled／firstSequence／lastSequence。items复用原事件条目的sequence、name、value、origin、deliveries，并增加 `published:{clock,executionFrameIndex}`；handled／skipped接收者增加 `delivered:{clock,executionFrameIndex}`，pending没有delivered。clock为idleFrame／physicsFrame，双方source仍来自原账本的冻结绑定。

默认保留按发布sequence最新32条已结清发布加全部未决发布，零接收者发布立即结清；部分投递完成也会保留整份未决条目的已确认位置。原始尾部移出不丢失这些证据，但不扩展为完整历史时钟账本。位置是回执输出位置，不是回调开始时刻；pending不证明未执行，取消或失败不制造discarded。异常后的唯一已准入事实及下游尾帧会在收尾保存，回调拿到的副本不能改变内部状态。

原有getter、events／diagnostics和可选snapshot继续转发；匹配位置或原账本失败时增加runtime_event_position_invalid，原业务诊断保持。Godot仅在项目协议≥3且已有runtime.execution-frames时组合此reader，旧reader和其他后端保持原字段范围。没有新backend能力、版本或GDScript；执行适配器指纹变化仍要求旧冻结构建重建。171项定向和真实Godot六案已通过，最终完整检查及兼容范围见[本轮专题](../docs/test-results/runtime-event-positions/README.md)。

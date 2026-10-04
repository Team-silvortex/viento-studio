# 可移植引擎

[当前架构](../docs/ARCHITECTURE.md) · [工程模板](../docs/PROJECT_TEMPLATES.md) · [开发路线](../docs/ROADMAP.md)

这里保留现有 JavaScript 解析、原文适配与语义规划，并通过 `studio-core.mjs` 调用独立的共享 Rust 编辑规则和草稿状态。Godot 等工程运行后端位于宿主适配层，Nuis / ns-nova / yalivia 原生接入属于后续路线。

`index.mjs` 是不依赖 Node、HTTP 服务、Tauri 或本机配置的入口。输入是正文字符串、项目定义、登记记录和稳定素材引用；输出是解析结果、布局、字段范围或修改后的正文。唯一运行依赖是 `yaml`，浏览器宿主使用该包的 browser 发行文件，或由打包器解析其 browser/default 入口。`json-source.mjs` 仍供后端模型与事务使用；源码布局通过 Rust 严格扫描与补丁接口工作，前端模块图不再为它加载 YAML，本机服务也不再公开 YAML 包目录。移动端通用解析仍保留已有 `/vendor/yaml/`。

桌面服务和网页编辑器已经复用这里的实现。旧的 `scripts/lib/`、`scripts/standardize-docs/` 和 `web/modules/` 入口保留转发，避免同时改变调用方与公共资源路径。核心不能反向导入这些入口。

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
- `build-plan.mjs`：`scene2DModelToPlan` 将作者 v1 发射为 plan v1、作者 v2／v3 发射为 plan v2；旧 DTO 保持原样，v3 分组从运行计划剔除，`createScene2DPlan` 保留原入口；来源附加信息不进入冻结计划，能力与 Godot 适配分离。冻结资源、构建与运行属于 Node 适配层，见 [二维场景构建](../docs/PROJECT_BUILD.md)。

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

`scripts/tests/portable-engine.test.mjs` 在没有 Node 全局对象的隔离环境中加载引擎及 YAML 浏览器版本，执行跨格式编辑、媒体引用和存储冲突场景，同时检查依赖方向。`portable-engine-scenarios.mjs` 也可通过静态测试页面在真实浏览器中运行，不需要应用 API。

Android 预览宿主已接入：`mobile/platform.mjs` 在 WebView 中复用本引擎，`src-tauri/src/mobile_storage.rs` 在应用私有目录执行原生读写。移动端索引即时生成，不需要 Node 或后台 HTTP 服务。编辑器保留按作品隔离的恢复草稿，恢复时沿用旧版本指纹，避免覆盖应用关闭期间发生的修改。

移动宿主已复用桌面项目包格式，通过系统文件选择器导入、导出。后续仍需媒体访问、模板配置和真机验证，见 [移动端说明](../mobile/README.md)。不要为了兼容宿主而改变现有作品格式或在正文中保存设备绝对路径。

# 可移植引擎

**当前源码0.1.8**：状态表和有类型事件条件由独立Rust能力准入，固定Godot生成器与版本codec负责源码，条件／静态图／参数修复／使用位置各自维护界面或只读查询。Godot适配器0.16.0，新含动画项目为protocol 7／清单8；见[本版记录](../docs/RELEASE_0.1.8.md)。

动画事件转换支持[有类型的载荷条件](../docs/SCENE_ANIMATION.md#按事件载荷选择转换)，经Rust检查生成可重编辑脚本并沿普通保存交付。

动画状态表可[查看静态转换图并定位字段](../docs/SCENE_ANIMATION.md#查看状态转换图)，新建与重新编辑共用同一视图。

已保存脚本可[查看使用位置并定位行为原文](../docs/SCENE_BEHAVIORS.md#从脚本查看使用位置)，用于跨场景逐个修复绑定。

保存态脚本声明现可用于[行为参数接口提示与显式修复](../docs/SCENE_BEHAVIORS.md#根据脚本接口修复参数)，仍沿原有审阅和普通保存流程。

动画状态表新增独立 Rust 校验／索引化桥接与 Godot 文本发射器：`animation-state-table-core.mjs`、`godot-animation-state-script.mjs`。表格不持有文件、播放器或 UI；生成的普通 TXT 经既有草稿品牌与保存，见[用法](../docs/SCENE_ANIMATION.md#从状态表生成动画脚本)。 带版本声明的脚本现可重新打开表格，经完整审阅后更新普通草稿与保存。

0.1.8收录独立项目动画完成账本／protocol 7 观察。自然结束仍调用共享 Rust transport，来源由冻结计划提供，命令与完成记录分开；不增加作者格式或核心 ABI。参见[架构边界](../docs/ARCHITECTURE.md#动画自然完成的独立边界)。

**0.1.7 源码收录**：动画序列帧、transport、命名片段、时长调整与轨道复制由共享 Rust 和独立可选能力门控；片段目录／使用位置、来源提案及运行回执分别维护，事件动画使用普通脚本起始内容。0.1.7发布时为22 模块／43 项声明能力，Godot 适配器 0.15.0；下文版本与证据保留各轮开发时点。见[本版记录](../docs/RELEASE_0.1.7.md)，源码交付不代表本机已更新安装。

`scene-animation-create-plan.mjs` 生成一条轨道的起止帧草稿，格式及数值仍由 Rust 动画核心验证；`scene-animation-creation-contract.mjs` 捕获目录、创建请求及精确回执，确认未知提交。`world-animation-create.mjs` 产生严格三文件计划与有界场景／定义恢复证据，独立于构建和素材读取。Host 负责身份分配、存储和锁，UI 负责输入及审阅。当前 22 模块／43 项声明能力，Rust ABI、动画 schema 和 Godot 适配器保持。见[首次创建指南](../docs/SCENE_ANIMATION.md#从场景首次创建动画)。

`scene-animation-targets.mjs` 提供动画实例目录的纯数据捕获、来源品牌、稳定编号选择及成员验证；不承担文件读取或渲染。宿主读取一次世界快照并校验保存原文，目录可包含已失去目标的动画供作者修复；应用目录选择前再次核对当前保存态。见[动画指南](../docs/SCENE_ANIMATION.md#按名称选择场景实例)。

**2D 动画工作树增量**：`scene-animation-core.mjs` 调用共享 Rust 的 `sceneAnimation.inspect/sample` 和独立可选能力，规则无时钟、DOM 或文件接口。`scene-animation.mjs` 解析保存关联并核对稳定实例，产生可选动画计划与精确轨道来源；`scene-animation-edit.mjs` 生成带来源品牌的原文提案。示意播放器／渲染器、来源宿主、Godot 视觉容器和工程组装分别实现。初次动画接入时为 22 模块／42 项声明能力；旧段落保留开发时点。详见[动画指南](../docs/SCENE_ANIMATION.md)。

**0.1.4 源码归属**：项目组装、共享状态、事件及行为声音控制已收录[0.1.4](../docs/RELEASE_0.1.4.md)。当前为 21 模块／40 项声明能力；下文较早的工作树说明与测试证据保留原时点。0.1.4 后工作树先增加提示增删提案，随后增加提示换轨／顺序的完整编排提案及独立的轨道复制／移除提案与表单，随后接入已绑定素材选择，独立素材试听准备与浏览器适配器进一步支持进度、暂停／继续和定位，复用 Rust 语义、来源宿主和普通保存；未新增模块、能力、ABI 或后端协议。

当前未发布工作树新增[项目事件](../docs/PROJECT_EVENTS.md)：`project-event-bus.mjs` 原子预留发布与接收预算，校验 FIFO 投递结果和冻结双方来源；项目运行读取器／查询显式接入协议 3，旧协议 1／2 语义保持。Godot 的具体订阅与回调在适配器专用模块，根协调器仅拥有场景生命周期；界面只读消费观察快照。当前仍为 21 模块／40 项声明能力。

当前未发布工作树新增[项目共享状态](../docs/PROJECT_SHARED_STATE.md)：`project-shared-state.mjs` 负责有界标量账本、原子变更与来源 DTO；`project-runtime-events.mjs` 按显式项目协议 1／2 验证事件，状态来源仅从冻结绑定派生；`project-runtime-query.mjs` 保留当前对象、访问历史和共享状态。它们不读取文件、DOM 或执行引擎。Node 宿主依据验证后的冻结工程选择协议，Godot 端口与独立只读界面分别实现。当前为 21 模块／40 项声明能力。

**0.1.3 收录说明**：本页标为 0.1.2 后工作树的多行为、脚本引用、Bevy Rust 与声音增量现已纳入[本版源码](../docs/RELEASE_0.1.3.md)。历史版本、模块数和验收条件保留原时点；当前为 21 模块／38 项声明能力，本次未制作或更新安装包。

源码基线 0.1.2 发布时为 20 模块／37 项声明能力；当前场景声音工作树为 21 模块／38 项声明能力。0.1.2 后的未发布工作树也增加首次行为多绑定清单与已有脚本引用管理，均复用现有作者格式、事务和执行协议；本轮未安装新包。历史段落的模块数与验证范围保留原时点。

[场景声音](../docs/SCENE_AUDIO.md)使用独立 `viento-scene-audio` schema 1：共享 Rust `sceneAudio.inspect`／`sceneAudio.sample` 校验稳定音轨和 0–60 秒 play／stop 提示，只返回声明及显式时刻的命令状态。`scene-audio-core.mjs` 经可选 WASM 能力调用同一核心，没有 JavaScript 规则回退；规则不包含资源解码、自然结束、设备或播放。

`scene-audio-edit.mjs` 严格解析原文、防重复键并调用 Rust 验证。旧 `createSceneAudioProposal` 继续只替换既有音轨 role／volume／loop 和提示 atSeconds／action 的叶 token，保持定长、定身份契约。原 `createSceneAudioCueProposal` 继续接受完整提示行，只允许 0–64 提示的移除与末尾追加，保留既有提示的身份、trackId 和相对顺序，旧契约不放宽。原 `createSceneAudioTimelineProposal` 继续接受完整编排，在同批增删／字段修改之外允许既有提示换到当前已声明轨道并显式重排；提示身份、轨道顺序及资源声明保持。

只换轨而未增删／重排时修改 trackId 叶 token；结构变化只重建 `/cues`，按 UUID 复用保留项原片段并更新明确改动的 trackId／时间／动作，空数组与删至空分别处理。同批轨道设置仍沿原叶补丁路径。运行采样仍按时间排序、同刻保留作者顺序，编辑不以排序结果改写作者数组。

以上三种 API 继续固定轨道数量、身份、资源与顺序。原 `createSceneAudioTrackProposal` 单独接受完整 tracks 行（含 resourceId），允许保留原轨道的有序子序列，并在末尾追加只复用原文资源的新轨道；保留轨道的 id／resourceId 不变。最终须为 1–16 轨，提示可同批编排但必须引用最终轨道。轨道结构按 UUID 复用原片段，轨道和提示补丁分别按各自净变化生成；复制 UI 拷贝当前设置，不生成 cue。

`scene-audio-resources.mjs` 的 `captureSceneAudioResources` 独立捕获已绑定 WAV 目录；`createSceneAudioResourceProposal(source, edit, catalog)` 限制资源选择并允许同批轨道／提示结构编辑；旧 leaf／cue-only／timeline／tracks 四种 API 保持原契约。宿主复用声音创建目录的只读 inspect，核对来源、保存基线、World／对象与候选目录修订；显式选择资源后保真修改 resourceId，再按原文审阅、应用普通草稿和普通 Save 继续。应用须使用重新读取后捕获的新目录实例，比较完整创建目录 DTO 与来源五字段，再核对草稿／保存正文两份摘要。素材目录不赋予登记、文件或播放权限。

`scene-audio-audition.mjs` 独立提供 `prepareSceneAudioAudition(source, catalog, resourceId, { getResources, readBytes, digestBytes, isCurrent, signal })`。来源在首次 await 前按 data descriptor 捕获；必须选自当前品牌目录的已绑定 WAV，并通过新目录实例比较完整上下文。读取的 Uint8Array 复制后核对登记大小（至多 32 MiB）、SHA-256 和共享 PCM16 规则，各异步返回后检查来源／取消。私有品牌描述只有 resourceId／name／channels／sampleRate／frames／durationSeconds；`isSceneAudioAudition` 判断品牌，`sceneAudioAuditionBytes` 每次返回独立 ArrayBuffer，调用者和摘要实现不能改变私有字节快照。它不读 DOM、不播放、不保存，也不声称持续验证磁盘。

`audio-wav.mjs` 是原 Node PCM 校验器的原样迁移，旧 `scripts/lib/audio-wav.mjs` 仅重导出；浏览器与 Node 使用同一容器规则。Godot 适配器完整来源指纹增加 `engine/audio-wav.mjs`，旧缓存需重建，版本／协议不变；追加的真实 Godot 回归与浏览器试听输出证据分别记录。来源宿主注入现有目录接口、稳定资源 UUID 的受限 GET 和字节摘要；独立 WebAudio 适配器管理 resume／decode／GainNode／循环及单轨暂停、继续、定位和停止，解码前另限重采样后的预计 float32 缓冲 128 MiB。当前表单的 volume／loop 可用于素材试听，cues、场景时钟与执行后端不参与。目录仍标 unverified，旧五种声音提案的编辑与普通保存契约保持。

试听属于独立 `scene.audio_audition` 功能坐标，复用现有模块、来源宿主与三语表单；暂停及定位沿用同一已验证缓冲，继续不重新读取素材；进度由 AudioContext 时钟派生，播放器不获得文件或场景时间线权限。编辑、刷新目录、检查、应用、关闭和 hidden 释放包括暂停中的快照，语言切换保留。本轮的播放器控制与准备资源范围见[试听控制专题](../docs/test-results/scene-audio-audition-transport/README.md)，此前基础播放与 PCM 指纹回归保留在[原专题](../docs/test-results/scene-audio-audition/README.md)；不据此声称 Godot／Bevy、安装或物理设备通过。

资源登记和文件不由声音提案修改。构建解析接受覆盖最终使用资源的 assetBindings 超集，只将当前轨道实际使用的资源去重送入计划和冻结；移除轨道保留旧绑定，不清理资产。动态行为参数／代码中的轨道 ID 不做静态解析，作者需在移除后自行更新；现有运行接口拒绝实际调用的未知轨道。

原四种提案与新素材选择共享来源宿主，各自授权范围在应用时重新计算；来源修订复核仅授予普通内存草稿应用；场景、保留轨道身份、登记绑定及未修改原字节保持，资源引用只在新素材选择流程中显式改变。独立 `org.viento.scene-audio` 模块及来源端口不拥有保存、行为或后端执行权。操作见[轨道管理](../docs/SCENE_AUDIO.md#复制与移除已有声音轨道)与[声音提示编排](../docs/SCENE_AUDIO.md#调整提示目标轨道与顺序)；[旧增删专题](../docs/test-results/scene-audio-cue-authoring/README.md)、[换轨／顺序专题](../docs/test-results/scene-audio-cue-arrangement/README.md)与[轨道专题](../docs/test-results/scene-audio-track-authoring/README.md)分别记录各自时点与范围。此前素材选择边界另见[独立专题](../docs/test-results/scene-audio-resource-selection/README.md)：World 的 `resource.bind` 先独立保存 metadata，之后普通 Save 仅写声音正文，不宣称跨文件原子性；目录候选未验证实际 PCM／哈希，build 继续拥有字节检查与冻结。

`scene-audio.mjs` 沿场景唯一 `audio` 关系解析已登记声明，核对反向场景依赖和资源绑定，生成独立可选声音计划与源映射。它要求 `audio.nonspatial`／`audio.timeline`，不把 `music`／`effect` 当作混音总线；无关联时不改变旧计划。`scene-audio-events.mjs` 从冻结声明验证声音帧及诊断归属，与演员／行为事件读取器组合。PCM16 WAV 容器规则由共享纯校验器提供；实际读取、哈希计算、资源复制、Godot 播放与 ZIP 交付分别留在宿主和适配器；Bevy 当前明确拒绝声音。细节与有限范围见[声音指南](../docs/SCENE_AUDIO.md)。

Bevy Rust 工作树增量只在已有纯声明中使用 `org.viento.bevy-rust`／`rust`，已有创建、目录、绑定编辑、`relation.add` 和普通保存继续共用；不新增系统模块、作者格式或运行协议。具体 Cargo 生成、工具身份、离线编译和临时回收位于 `scripts/backends/bevy-rust-*`，不进入可移植编辑核心。固定步增量复用同一 TXT 草稿契约，只增加 `bevy-rust-motion` 起始内容；回调注册、自身实例位置提交、固定时间步和累计事件预算由 Rust 运行模板负责，不进入作者编辑器。范围与证据见[Bevy 指南](../docs/BEVY_BACKEND.md#rust-作者行为通道012-后工作树)、[首次通道记录](../docs/test-results/bevy-rust-behaviors/README.md)及[固定步记录](../docs/test-results/bevy-rust-fixed-step/README.md)。

`scene-behavior-create-plan.mjs` 为首次行为清单提供纯声明规划：已分配身份、明确后端／语言、1–32 条实例／脚本绑定、最多 8 份去重源码，经既有行为格式检查输出完整原文与去重脚本 ID。它不访问 DOM、工程、文件或工具；只读目录和 `behavior.create` 事务维持独立边界。

`scene-behavior-directory.mjs` 为[已有行为管理](../docs/SCENE_BEHAVIORS.md#管理已有行为)提供严格目录捕获、`references` 请求规划与既有 `relation.add` 回执校验；只消费身份、路径、修订和使用关系，不读取宿主、文件、DOM 或执行后端。Node 服务独立读取同一次 World 快照，沿唯一显式行为关系校验清单与依赖，提供至多 256 份、每份至多 64 KiB 的已登记 TXT。空目录与无效关系分别处理；事务仅追加登记引用，绑定修改经原草稿接口和普通保存继续。验证范围见[关联专题](../docs/test-results/scene-behavior-links/README.md)。

`scene-composition-create.mjs` 为初始配方准备冻结草稿：编辑上下文与只读对象目录分别核对，稳定身份由调用者明确提供；现有 Rust 展开器校验完整声明。它不读取磁盘、不登记文档、不选择引擎，普通正文宿主继续拥有保存权威。

`scene-composition-create-layout.mjs` 独立规划起始横排／竖排／网格，只接收稳定实例身份及数值坐标，返回冻结的位置清单。它拒绝整体越界，不读取对象外观或推断碰撞；视图负责显式应用与一次回退，完整配方仍经原创建核心和 Rust 校验。

0.1.0 的独立 3D 作者接口分别覆盖变换、对象结构、环境、属性、整体移动、参照对齐、等距分布、批量复制和批量移除。九个可选 Rust 能力经可移植私有提案与文档来源守护接到独立界面；只更新原文草稿，普通保存保持持久权威。只读预览、数学与 GPU 适配不取得这些作者接口。0.1.0 发布时为 17 模块、33 项声明能力；之后的行为编辑、首次行为创建及独立脚本创建使当时工作树增至 19／36。交付与历史验证条件见[版本记录](../docs/RELEASE_0.1.0.md)。

`studio-modules.mjs` 提供固定系统模块注册与增量需求规划：描述符、依赖、提供者和 API 版本确定性检查，不读取 DOM／文件／网络或执行引擎。模板的 `studioProfile` 只请求能力，普通文档继续可用；模块装配状态和宿主执行权限分开，见[系统边界](../docs/STUDIO_MODULES.md)。

后端工程持久恢复由 `scripts/adapters/node-backend-project-catalog.mjs` 负责本机索引、原子更新和读取／运行身份守护，复用纯 `backend-project.mjs` 清单验证，不把文件、锁或物理 inode 放进可移植领域模块。服务显式选择冻结工程后复用已有运行、控制和验收上下文；恢复条目不授予清理权，格式与 GUI 见[后端工程管理](../docs/BACKEND_PROJECTS.md)。

`backend-project.mjs` 是[后端工程管理](../docs/BACKEND_PROJECTS.md)的轻量纯清单入口：版本化来源、生成文件／资源副本、工具与适配器身份、精确证据摘要与生命周期，返回严格冻结 DTO。它不读取文件、启动工具或授予删除权限；实际字节核对与创建宿主的内存所有权留在 Node，GUI 只读显示。

工具状态和用例／组／报告纯模块已纳入 [0.0.9 源码交付](../docs/RELEASE_0.0.9.md)，原阶段报告仍保持 0.0.8 条件。

0.0.10 源码新增[配方实例恢复继承](../docs/SCENE_COMPOSITION.md#编辑单个实例的局部覆盖)。无状态 Rust 规则原子处理六字段设置与删除，可移植提案和 GUI 继续分离；本轮验证另见[继承恢复记录](../docs/test-results/scene-composition-inheritance/results.json)，不归入此前发布或设备验收。

同一版源码另接[配方单实例画布调整](../docs/SCENE_COMPOSITION.md#从画布调整单个实例位置)：纯适配器复用已有 Rust 几何历史与局部覆盖补丁，GUI 编辑展开后的场景中心位置，候选只改作者原文中的局部 `position`。独立记录见[画布专题](../docs/test-results/scene-composition-canvas/results.json)；没有新作者格式、Rust 协议、共享片段修改或多选操作。

当前另接独立[配方多实例批次画布](../docs/SCENE_COMPOSITION.md#从画布批量调整配方实例)：同一 Rust 几何会话处理多选移动和六向对齐，新可选无状态补丁一次修改多个稳定目标的局部位置。旧单实例入口继续独立使用；[批次专题](../docs/test-results/scene-composition-batch-canvas/results.json)保留本轮实际验证范围，该专题验证保留 0.0.9 条件，该能力纳入 0.0.10，0.1.0 继续保留。

同一版源码现接[共享片段字段编辑](../docs/SCENE_COMPOSITION.md#编辑共享片段的演员声明)：独立 Rust 能力只设置现有片段演员的六类声明，纯提案绑定全部相关放置及局部覆盖掩蔽；GUI 只显示原文声明并逐字段明确勾选，完整候选与图片经宿主检查后应用到当前原文草稿，再普通保存。[本轮记录](../docs/test-results/scene-composition-fragment-editor/results.json)独立保存，这些作者编辑能力不提升引擎执行或设备成熟度。

当前另接[共享声明恢复](../docs/SCENE_COMPOSITION.md#恢复共享片段的投影继承)：移除现有可选声明，重新使用投影继承，或在未启用继承时移除图片。设置与恢复共用一次原子候选及普通保存；原六字段 SET 接口继续可用。[新增专题](../docs/test-results/scene-composition-fragment-inheritance/results.json)与前轮证据分别保存，该专题验证保留 0.0.9 条件，该能力纳入 0.0.10，0.1.0 继续保留。

同一版源码另接[放置偏移表单](../docs/SCENE_COMPOSITION.md#调整整组放置偏移)：编辑或删除一个 placement 的可选 `offset`，在各演员局部位置覆盖之后统一相加，影响该放置的全部实例；组织分组不提供空间变换。完整候选及全部演员／组身份检查后仅应用原文草稿，再普通保存。[本轮专题](../docs/test-results/scene-composition-placement-offset/results.json)单独保存，该专题验证保留 0.0.9 条件，该能力纳入 0.0.10，0.1.0 继续保留。

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
- `script-authoring.mjs`：`listScriptStarters()` 返回冻结的 Godot GDScript 与 Bevy Rust 空行为／参数信号／固定步移动及 Godot 项目场景切换、事件动画片段等起始内容；`prepareScriptDraft(context, request)` 接受 `{ sourceToken, documentRoot, documentTypes: [{ id, label }] }` 和 `{ starterId, documentType, sourcePath }`，仅允许正文目录内可迁移的 TXT 路径与当前工程类型。提案深冻结并带私有品牌；`isScriptDraftProposal`／`prepareScriptDraftApply(currentContext, proposal)` 拒绝克隆、序列化及会话／目录／类型目录变化，返回普通新建草稿所需数据。语言与后端标识不授予执行能力，不读取文件、创建 UUID、改项目模板或关联场景；普通保存负责登记，未来语言服务另经独立文档接口接入。见[内置脚本创建](../docs/SCENE_BEHAVIORS.md#内置脚本创建)。`godot-project-animation-event` 仅组合已有事件订阅和动画选择／播放端口：默认订阅 `checkpoint`，空片段选择完整动画，就绪时不发布或暂停，退出时清理订阅，缺少选择方法的旧项目不执行。同步 handled 仅确认请求提交，实际执行另查动画回执；见[事件动画用法](../docs/SCENE_ANIMATION.md#用项目事件触发动画片段)。
- `scene-behaviors-edit.mjs`：已有行为清单的私有审阅提案、稳定绑定身份及保真草稿补丁；复用无浏览器第三方依赖的 JSON 源码索引，固定场景／后端／语言，未知格式停止表单改写。依赖核对、编辑会话、普通保存与执行各属宿主接口，不新增 Rust ABI。
- `scene-animation-core.mjs`：`retimeSceneAnimation(document, durationSeconds)` 经可选 `viento_core_scene_animation_retime_version() = 1` 调用 Rust `sceneAnimation.retime`，返回冻结的 `{ document }`。仅改变总时长、关键帧时间和片段边界，保留 schema 1／2／3、数值、身份、列表顺序、插值、循环及网格；相同时长不重算，跨轨道／片段的不同时间因精度合并时整次拒绝。桥接核对原生回执，不提供 JS 变换回退，不持有运行时钟或后端权限。
- `scene-animation-edit.mjs`：`retimeSceneAnimationDraft(content, edit, durationSeconds)` 先严格快照当前表单，复用普通编辑的完整候选和格式升级规则，再请求 Rust 变换。返回冻结文档，只供本地字段回填，不是来源提案或保存授权。后续仍由 `createSceneAnimationProposal` 生成保真时间叶补丁，沿既有来源守护应用普通草稿并保存。操作见[整段时长调整](../docs/SCENE_ANIMATION.md#整段按比例调整时长)。
- 动画轨道复制：`copySceneAnimationTrack(document, sourceTrackId, targetInstanceId, newTrackId)` 经可选 `viento_core_scene_animation_track_copy_version() = 1` 调用 Rust `sceneAnimation.copyTrack`，返回冻结的 `{ document }`。只替换克隆轨道的 `id`／`instanceId` 后追加，保留源轨道、时间／数值／网格和文档格式；同目标／属性、新轨道编号或预算冲突整次拒绝。`copySceneAnimationTrackDraft(content, edit, sourceTrackId, targetInstanceId, newTrackId)` 复用严格当前表单捕获与候选 schema 规则，只返回本地表单数据。UI 复用已有来源匹配实例目录验证新目标；UUID、目录、普通审阅／保存均不进入 Rust。之后的结构提案重写 `tracks` 数组并保留外部未修改原文，不建立素材绑定或运行时克隆。见[复制轨道](../docs/SCENE_ANIMATION.md#复制轨道到其他实例)。
- `scene-animation-usage.mjs`：当前场景已保存行为参数的完整片段编号文字匹配与精确来源品牌。只读快照、UTF-16 位置和普通编辑分离；不执行脚本、不推断受保护引用。见[片段使用位置](../docs/SCENE_ANIMATION.md#查看动画片段使用位置)。
- `scene-animation-directory.mjs`：已保存命名动画片段的严格目录与行为来源品牌，复用 Rust 声明校验，独立限制动画和行为原文预算。目录只供显式填入普通文本参数；不读取图片、不执行后端、不推导引用保护，不改变旧动画格式。见[片段编号选入](../docs/SCENE_BEHAVIORS.md#将动画片段编号填入行为参数)。
- `scene-audio-directory.mjs`：独立的已保存音轨目录契约与行为来源品牌绑定。`captureSceneAudioDirectory` 校验场景／声音描述和既有声音声明；`captureSceneBehaviorAudioTracks` 要求目录场景三字段与行为依赖一致，输出冻结的音轨 UUID、资源 UUID 和用途。`sceneBehaviorAudioTrackValue` 仅返回目录内显式选择的普通字符串，不生成提案或赋予保存／播放权限。Node 只读服务和宿主来源守护独立接入，不读 WAV 或运行完整构建规划；Rust ABI、作者格式与后端版本保持。见[行为参数选入音轨](../docs/SCENE_BEHAVIORS.md#将音轨编号填入行为参数)及[验收记录](../docs/test-results/scene-behavior-audio-picker/README.md)。
- `world-behavior-create.mjs`：已保存 Scene2D v2／v3 首次启用行为的纯规划，复用严格声明、依赖和完整构建计划校验。调用者提供稳定文档／绑定 UUID，生成新正文、新登记和既有场景登记追加的三文件计划；冻结只读依赖证据供宿主恢复，原场景与脚本源码保持。核心不硬编码执行引擎；首版界面限定 Godot／GDScript 单绑定，0.1.2 后工作树已扩展为多绑定／多脚本清单及显式 Godot／GDScript、Bevy／Rust 选项；持久化和执行由各自宿主处理，通用 `relation.add` 不增加 `behavior` 权限。

- `backend-capabilities.mjs`：校验并分离冻结 `viento-execution-backend` schema 1 纯数据描述符；分别判断七种执行操作、平台、plan kind／schema 和功能需求。没有 Godot 回退、工具探测或进程调用；描述符格式／字段或操作不合法时拒绝，UI 的 `canExecuteBackend` 失败时返回 `false`。宿主注册表与具体引擎实现见[执行后端中间层](../docs/BACKEND_MIDDLEWARE.md)。
- `scene-control-program.mjs`：分离并深冻结严格方向布尔程序；schema 1 保留全局输入，schema 2 每步按冻结 plan 2 实例 UUID 独立输入，未列实例释放，重复／未知目标拒绝且输入总行数至多 1024。核对 1–64 步、`0 < fixedDelta <= 0.25` 秒、总时长 8 秒、最后全释放及演员 × 步数 1024 联合预算；逐行准入协议 1／2 完整步骤样本与生命周期，回调按原顺序进入既有事件读取器和观察。没有 I/O、引擎句柄或移动模拟，见[有限控制回放](../docs/RUNTIME_CONTROL.md)。
- `runtime-verification-case.mjs`：有限运行用例与评判；复用控制 schema 1／2，仅无行为冻结 plan 2，以稳定实例和零基步骤检查有限坐标／非负显式容差或状态。严格分离／冻结、1–128 检查、未知／重复目标与顺序样本拒绝；完整运行、断言失败、缺样本／中断分别表示，不模拟引擎或写作者数据。见[运行验收用例](../docs/RUNTIME_CASES.md)。
- `runtime-case-document.mjs`：工程验收文档的严格四字段包装、正文格式识别、稳定场景绑定及登记依赖验证；复用内层原用例，派生场景依赖与可选子内容，不读写工程，不把文件位置或结果写入运行协议。
- `scene-runtime-query.mjs`：从已验证冻结 plan 1／2／3 取得稳定实例／定义身份及来源，消费已准入 ready／state／finished，提供分离的完整只读观察和 AND 身份筛选。状态变化使原位置样本过期，诊断／行为不改观察；可选有限控制程序为 plan 1／2 增加步骤进度和 `pushSample`，无程序 DTO 原样保留；无 Node、DOM、具体引擎、反射或 RPC 依赖，见[运行对象](../docs/RUNTIME_OBJECTS.md)。
- `scene-runtime-events.mjs`：独立校验 plan／runtime 1／2 的实例身份、坐标、运动状态与 ready／finished 生命周期；诊断导航只从冻结计划取来源。没有 Node、DOM、Godot 或 Bevy 依赖；当前由 [Bevy 无头适配器](../docs/BEVY_BACKEND.md)消费，旧 Godot 事件读取器保持原字节。

`scene-identity.mjs` 的 `sceneActorIdentity(actor)` 返回 v2／v3 `instanceId` 或旧 v1 `objectId`，供已验证模型的选择、原文匹配和布局使用；它不分配身份或替代场景校验。新表单默认 v2，启用分组显式升级 v3。

`scene-groups.mjs` 验证 v3 稳定组身份、父组、成员、数量与深度，并以 `buildSceneOutline` 提供确定顺序的嵌套大纲、祖先保留搜索及按作者顺序排列的后代实例。它不依赖 DOM；`scene-structure.mjs` 负责模型到预览结构的投影及独立信封校验。分组只组织编辑内容，不包含空间变换、可见性或行为。

`sourcePath` 是项目内以 `/` 分隔的逻辑路径，例如 `documents/characters/旅人.md`，不是磁盘绝对路径或 Android 的 `content://` URI。逻辑路径和 `asset:<UUID>` 应写入作品；平台句柄只存在于适配层。

## 场景创作工作流

`scene-composition-placements.mjs` 为整份放置新增、复制、移除提供独立原文提案与复核。`createSceneCompositionPlacementsDraft` 保留原声明、全部受影响演员及组身份；`prepareSceneCompositionPlacementsApply` 复查来源和精确回执。可选 Rust placements 能力与已有 offset、共享演员结构接口分开，复制按源字节范围只替换身份，不从预览有效值反推覆盖。操作和预算见[放置管理](../docs/SCENE_COMPOSITION.md#管理片段放置)。

`scene-authoring-candidate.mjs` 的 `validateSceneAuthoringCandidate(kind, proposal, payload, { sourceRevision })` 同步验收完整配方候选回执，按实例、批次位置、共享字段、放置及结构语义分别核对来源和目标，返回分离的冻结小回执；未知语义或无效载荷拒绝。摘要由调用者计算，验收不授予保存权限。

`scene-authoring-workflow.mjs` 的 `createSceneAuthoringWorkflow(options)` 通过来源、目录、预览、摘要、应用和成功通知接口连接独立编辑区。每入口拥有独立会话／回执，仅提供六个公共来源字段及自己的能力；异步工作核对归属及原提案，关闭会话清理回执，临时预览始终尽力释放。合法内存应用可推进来源令牌，成功导航仍核对同一回执／文档／窗口。没有 DOM、HTTP、文件读写或具体执行引擎依赖，普通保存留在宿主。具体边界见[场景创作工作流](../docs/SCENE_AUTHORING.md)。

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

Node CLI 和资源包宿主消费派生结果，文档登记／保存沿用原流程；没有新增 World 命令、元数据自动回写或普通解析器布局。未完成原文可保存及完整备份，选择式迁移要求配方与依赖有效。已保存／未保存配方的只读预览已接入；当前源码配方可另行编辑单实例局部覆盖或恢复继承，也可设置共享片段演员声明、恢复允许的共享声明、编辑整组放置偏移、增删共享演员、管理整份放置、编辑组织分组及管理片段定义，应用到原文草稿后普通保存。片段重命名已接入定义管理；嵌套／跨文件片段和多文件事务仍未接入。完整契约及只读 CLI 用法见[片段组合指南](../docs/SCENE_COMPOSITION.md)。

局部覆盖使用独立的可选 `viento_core_scene_composition_patch_version() === 1`，由 Rust `sceneComposition.patchOverrides` 按稳定放置 ID 和局部演员键设置 position／size／color／speed／controls／imageResourceId 六类值。它复用严格 scanner、组合校验和数值序列化，只补丁目标源码，保留其他原始字节；前后原文各限 128 KiB，不保存文件或改 World。桥接提供 `supportsStudioCoreCompositionPatch()` 和 `dispatchStudioCoreCompositionPatch(request)`，核对有序真实路径、唯一目标语义，并在补丁调度结束后重新严格展开输入和回执，坏回执使核心不可用；缺少新能力不影响旧展开／源码／几何能力。

另一个可选 `viento_core_scene_composition_edit_version() === 1`／`supportsStudioCoreCompositionEdit()` 开放 `sceneComposition.editOverrides`。请求增加白名单 `resetFields`，与 `values` 不重叠；纯恢复允许 `values: {}`，完全无意图的请求拒绝。Rust 原子合并 set／reset，位置／尺寸按数组整体恢复，删除最后一个值时移除所选演员覆盖条目，保留 `overrides` 数组及其他条目；不存在的恢复字段不会创建空覆盖。删除图片覆盖表示重新使用片段／投影，显式 `imageResourceId: null` 仍表示不用图片。旧 set 请求及探针保持；缺 edit 的核心只关闭恢复入口。

`scene-composition-overrides.mjs` 的 `createSceneCompositionOverrideDraft(model, source, actorId, { digest })` 绑定有效预览、当前原文摘要和保存基线，返回局部表单值及 `propose(fullFormValues, { resetFields })`；恢复集合按六字段顺序规范化，排除对应 set 候选，未改字段不变成显式覆盖。没有恢复时保留旧提案形状。`prepareSceneCompositionOverrideApply(current, proposal, { digest })` 重新核对摘要、身份与精确 Rust 回执。异步前复制输入，纯接口没有 I/O；宿主完整预览候选并在最终内存应用前复查当前会话，持久保存继续由普通编辑器处理。GUI 不猜继承值，恢复与表单值一起使审阅批准失效；贡献来源仅授权导航，不授予这项编辑能力。

`scene-composition-layout.mjs` 的异步 `createSceneCompositionLayoutDraft(model, source, instanceId, { digest })` 先复用上述原文／模型绑定，再为一个固定实例创建 `createSceneGeometryDraft`。`actors()` 返回完整场景的副本，只有目标位置来自 Rust 会话；`state()`、`currentPosition()`、`setPosition()`、`setPositions()`、`move()`、`undo()`、`redo()`、`reset()`、`dispose()` 复用原有几何和最多 100 步的历史。其他 UUID、多实例或非法位置修改在状态更新前拒绝，调用者退出或打开过期时必须释放会话。`offset` 与 `localPosition()` 是分离的只读值。

画布／坐标输入使用展开后的场景位置，`propose()` 转成偏移前的局部 `position`，只返回已有 set 提案形状；普通 `prepareSceneCompositionOverrideApply` 仍负责重算回执。局部与展开位置各限 ±100000，局部越界在 Rust 几何修改前拒绝，不能先改变 dirty／历史再失败。未动的场景轴沿用基线局部值，避免小数位置逆减偏移时产生噪声；回到原位置时不生成提案。完整候选仍由宿主验证，最终应用只替换当前原文草稿，普通保存再写盘。该适配器不调用 `scene.update` 或 `layoutSave`，不修改模板、放置偏移、图片、分组或稳定身份；没有多选、对齐或跨视图统一撤销。

独立可选 `viento_core_scene_composition_positions_version() === 1`／`supportsStudioCoreCompositionPositions()` 开放 `sceneComposition.patchPositions`，由 `dispatchStudioCoreCompositionPositions` 单独调度。请求包含原文和 1–128 个 `{ placementId, actorKey, position }`；只设置局部位置，不接受其他字段或重复目标。Rust 一次扫描输入，按作者放置／演员顺序组合精确编辑，再检查完整候选及最终 128 KiB 预算；同一放置新增多个覆盖共用容器，净无变化目标不产生显式覆盖。桥接核对全部目标语义和有序真实路径，拒绝非目标改动或伪造回执。旧 set／edit／expand 探针、请求及调度域保持，缺新 positions 能力只关闭批次入口。

`scene-composition-batch-layout.mjs` 导出异步 `createSceneCompositionBatchLayoutDraft(model, source, { digest })`，分离当前作者源与完整有效预览，核对全部稳定实例／放置／局部键和组织侧带后创建一个共享几何会话。`actors()`、`state()`、`currentPosition(id)`、`setPosition()`、`setPositions()`、`move()`、`align()`、`undo()`、`redo()`、`reset()`、`dispose()` 复用 Rust 几何及最多 100 步历史；每批 world／local 各 ±100000 在修改历史前整体检查，失败保留当前位置、dirty 和 redo。`propose()` 只携带净变化目标，按作者顺序返回 `{ sceneId, sourcePath, baseSourceRevision, sourceRevision, changes, afterContent, changedPaths }`；每个 change 为 `{ instanceId, placementId, actorKey, position }`，position 是偏移前局部值。未移动轴保留原局部小数，未改字段和范围外作者字节保持。

`prepareSceneCompositionBatchLayoutApply(current, proposal, { digest })` 重新检查来源摘要、保存基线、全部身份及规范顺序，再重算整批精确回执。GUI 的选择集、搜索和分组只属于视图，完整候选和净变化目标列表经宿主检查后才获批准；当前原文 owner／token 仍须在最终内存应用前复查。取消不改原草稿，普通保存继续处理磁盘写入与外部冲突。纯模块不执行 I/O、World 命令或引擎运行，不编辑共享片段、偏移、其他属性或跨文件内容，也没有跨视图统一撤销。

共享片段字段另用可选 `viento_core_scene_composition_fragment_version() === 1`，由 `supportsStudioCoreCompositionFragment()`／`dispatchStudioCoreCompositionFragment()` 调用无状态 `sceneComposition.patchFragmentActor`。请求按现有 `fragmentId`／`actorKey` 设置 `position`／`size`／`color`／`speed`／`controls`／`imageResourceId` 的非空子集；没有删除、恢复或结构操作，旧 expand／set／edit／positions 域不接受这项请求。Rust 复用严格扫描器和保真 JSON 补丁，原子修改模板声明，再展开完整候选并核对每个放置偏移后的坐标与 128 KiB UTF-8 预算；其余字段、覆盖、UUID、组、继承开关和不相关字节保持。

`scene-composition-fragments.mjs` 的 `createSceneCompositionFragmentDraft(model, source, actorId, { digest })` 绑定有效预览、摘要和保存基线，返回原文已声明的六字段 `values` 及按作者顺序排列的全部 `{ instanceId, placementId, overrides }`。`propose(selectedValues)` 只产生净声明变化；未声明字段显式设为当前有效值仍是新增声明，全部实例均被局部覆盖掩蔽时仍允许更新模板原文。`imageResourceId: null` 仅在片段开启投影继承时有效。`prepareSceneCompositionFragmentApply` 分离异步输入，重新计算目标集合、覆盖字段、顺序、精确候选与变化路径，拒绝伪造回执。

共享声明恢复另用 `viento_core_scene_composition_fragment_edit_version() === 1`／`supportsStudioCoreCompositionFragmentEdit()`，独立 `dispatchStudioCoreCompositionFragmentEdit` 只接收 `sceneComposition.editFragmentActor`。请求包含不重叠的 `values` 与 `reset`：`size`／`color`／`speed`／`controls` 仅在该片段演员的 `useProjectionDefaults: true` 时允许移除，`imageResourceId` 在任一继承状态都可移除；禁止恢复必需的 `position`。图片声明删除在开启继承时重新使用投影图片，关闭继承时表示无图；显式 null 与删除不同。Rust 原子执行设置与删除，再展开所有放置检查偏移坐标及最终正文预算；局部覆盖、身份、组织和非目标原文仍保持。

新增 `draft.proposeEdit({ values, reset })` 先验证原始设置／恢复意图，再筛出净声明设置和实际存在的删除。该提案始终包含规范顺序的 `reset` 数组，与原 `propose(values)` 的 SET-only 形状分别保留；完全无净变化不产生提案。`prepareSceneCompositionFragmentApply` 按提案形状选择原 SET 或新编辑能力，重算目标／覆盖掩蔽及完整精确回执。缺少新 edit 能力时只禁用共享恢复，旧 SET 不受影响；旧操作域不接收新请求。

独立 GUI 表单不读取有效实例值来填补缺失声明，不持有几何历史或图片副本。父预览负责素材列表、完整候选模型与图片检查，主编辑器在来源 owner／token 及批准回执一致时更新内存；原始表单签名和 canonical 候选绑定审批，取消保留原草稿。普通 Save 处理持久化及外部冲突。这里没有新 World 命令、共享结构编辑、放置偏移编辑、跨文件提交或跨视图统一撤销。

五个恢复选项仅对已声明且允许移除的字段开放，与同字段设置互斥；恢复前原始输入保持可见，勾选变化和静默输入变化都会使批准失效。影响列表只使用净设置和净删除，所有引用的局部覆盖仍优先；全部被掩蔽时允许只改变共享声明。GUI 不推测恢复后的值，完整候选及图片必须由父宿主重新检查；应用仍只更新当前原文草稿。

放置偏移另用 `viento_core_scene_composition_placement_version() === 1`／`supportsStudioCoreCompositionPlacement()` 与独立 `dispatchStudioCoreCompositionPlacement`，操作为 `sceneComposition.editPlacementOffset`。请求定位现有 `placementId`，`offset` 为有限数值对或 null；数值对设置声明，null 删除可选声明。缺失偏移按 `[0,0]` 生效，但与显式零声明的原文不同；两者转换仍是需要审批的源码变化。Rust 原子保真改动该放置的 offset，检查各轴 ±100000、完整展开所有演员后的边界与前后 128 KiB UTF-8 预算；演员局部值、覆盖、其他放置、共享片段、组、身份和不相关字节保持。旧操作域不接此请求，缺新能力只关闭此入口。

`scene-composition-placement.mjs` 导出 `createSceneCompositionPlacementDraft(model, source, actorId, { digest })`，从固定实例绑定整个 placement，首次 await 前分离原文和有效模型并校验全部演员／组来源。草稿返回原声明 `offset`（数值对或 null）和按片段声明顺序排列的 `targets: [{ instanceId, actorKey }]`／`groups: [{ groupId, groupKey }]`；`propose(offsetPairOrNull)` 只生成净原文变化。提案携 scene／source／保存基线／实例／placement／fragment 身份、offset、全部 targets／groups、精确 afterContent 和有序 changedPaths。`prepareSceneCompositionPlacementApply` 分离输入，再重算来源摘要、身份映射、目标顺序和完整 Rust 回执，拒绝遗漏或伪造。

独立 GUI 显示声明值与当前预览生效偏移，未声明时输入留空，不自动添加零声明。恢复删除 offset 并保留 raw 输入；数值对和恢复选择共同绑定批准。表单列出该放置的全部实例及组织组，显示只读原文差异和完整候选；父宿主完整检查模型及图片后，在最后一次 live source owner／token 守护成立时仅更新原文内存，再普通 Save 持久化。该入口不创建 Canvas、媒体副本或几何会话，不编辑分组变换、片段结构、其他属性、跨文件或统一撤销。

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

`execution-tool-status.mjs` 是独立纯数据工具状态契约：严格分离 `unchecked`／`checking`／`ready`／`unavailable` 与受控失败原因，只有成功状态携版本及完整二进制摘要，不携路径、原始进程输出或执行权限。宿主显式探测复用已有适配器识别，浏览器只显示状态；见[中间层说明](../docs/BACKEND_MIDDLEWARE.md#工具身份检查未发布增量)。

`scripts/tests/portable-engine.test.mjs` 在没有 Node 全局对象的隔离环境中加载引擎及 YAML 浏览器版本，执行跨格式编辑、媒体引用和存储冲突场景，同时检查依赖方向。`portable-engine-scenarios.mjs` 也可通过静态测试页面在真实浏览器中运行，不需要应用 API。

Android 预览宿主已接入：`mobile/platform.mjs` 在 WebView 中复用本引擎，`src-tauri/src/mobile_storage.rs` 在应用私有目录执行原生读写。移动端索引即时生成，不需要 Node 或后台 HTTP 服务。编辑器保留按作品隔离的恢复草稿，恢复时沿用旧版本指纹，避免覆盖应用关闭期间发生的修改。

移动宿主已复用桌面项目包格式，通过系统文件选择器导入、导出。后续仍需媒体访问、模板配置和真机验证，见 [移动端说明](../mobile/README.md)。不要为了兼容宿主而改变现有作品格式或在正文中保存设备绝对路径。

作者验收的 Node 存储提供可选 `prepareWrite` 发布守护，供当前场景和正文版本复查；普通文档存储的既有接口与行为保持。移动资源包含纯包装校验，不提供本机引擎工作台的作者文档动作。

共享片段演员结构：`scene-composition-structure.mjs` 的 `createSceneCompositionStructureDraft(model, source, { digest })` 返回原文片段、成员、组和放置快照，`propose({ action: 'add', fragmentId, actor, instances })` 或 `propose({ action: 'remove', fragmentId, actorKey })` 生成一次完整候选。`instances` 按原文相关放置顺序提供显式 UUID，未放置片段为空；helper 不分配身份、不写文件。`prepareSceneCompositionStructureApply` 重查当前来源与精确回执。Rust 新独立结构探针和 dispatcher 保持旧展开／字段／位置／偏移能力；操作步骤见[共享结构创作](../docs/SCENE_COMPOSITION.md#编辑片段的演员结构)。

## 组织分组原文创作

`scene-composition-groups.mjs` 提供 `createSceneCompositionGroupsDraft` 与 `prepareSceneCompositionGroupsApply`。独立可选 `viento_core_scene_composition_groups_version() === 1` 对应新增组、编辑名称／父级、演员归组和删除空叶组；纯提案在异步前分离作者输入，宿主重新核对完整影响与精确补丁。每份放置的组 UUID 独立且稳定，组织变化不移动实例或改变运行计划；保存沿用主编辑器。范围与操作见[组织分组指南](../docs/SCENE_COMPOSITION.md#编辑共享片段的组织分组)。

## 片段定义原文创作

`createSceneCompositionDefinitionsDraft(model, source, { digest })` 返回深冻结的 raw 片段目录及各自关联放置，`propose(edit)` 接受 `{ action: 'add', fragment }`、`{ action: 'copy', sourceFragmentId, fragmentId }` 或 `{ action: 'remove', fragmentId }`。新增完整原始声明；复制原 CST 仅替换片段标识；只删除未被任何放置引用的片段。三动作均不生成实例 UUID，八字段提案的 `targets` 固定为 `[]`。`prepareSceneCompositionDefinitionsApply(current, proposal, { digest })` 分离输入、核对来源／基线并精确重算动作和原文补丁。

独立可选 `viento_core_scene_composition_definitions_version() === 1`、`supportsStudioCoreCompositionDefinitions()` 与 `dispatchStudioCoreCompositionDefinitions()` 提供 `sceneComposition.addFragmentDefinition`、`copyFragmentDefinition`、`removeFragmentDefinition`。前后完整展开，保持 128 KiB／32 片段／128 声明演员与组的预算，未放置声明也计入。纯层不读 World、资源或文件；实际候选检查全部基础登记依赖，但未放置的投影有效值和图片字节在首次放置时再验。完整有序实例、组织语义及新来源核对后，仅应用原文内存并普通保存。

定义提案另接受 `{ action: 'rename', fragmentId, newFragmentId }`。独立可选 `viento_core_scene_composition_definition_rename_version() === 1`、`supportsStudioCoreCompositionDefinitionRename()` 与 `dispatchStudioCoreCompositionDefinitionRename()` 提供 `sceneComposition.renameFragmentDefinition`；不改变旧三动作 ABI，也不依赖旧定义探针或只读来源定位探针。Rust 同步所选定义和全部匹配放置的标识值，按原文顺序返回 `/fragments/i/fragmentId` 及 `/placements/j/fragmentId` 路径，其他原字节、稳定身份和有效场景保持。原生同名请求是原字节无变化回执；纯提案／应用拒绝 `scene_composition_definitions_unchanged`。纯层严格复核完整意图、语义、原始字符串 token 和新来源，拒绝伪造补丁；标识及前后展开预算沿用既有规则，`targets` 仍为空，普通保存不变。详见[重命名契约](../docs/SCENE_COMPOSITION.md#重命名片段定义)。

同一可选能力的只读 `dispatchStudioCoreCompositionDefinitionLocations({ protocolVersion: 1, operation: 'sceneComposition.inspectDefinitionLocations', content, paths })` 使用 Rust CST 为有序 JSON Pointer 返回 `{ locations }`：每项含 `propertyPath`、`start`、`end`、`encoding: 'utf-16'` 和 `exact`，包含 BOM 偏移；不存在的路径回退至最近容器。最多查询 4096 个唯一合法路径，各限 4096 UTF-8 字节。它完整校验配方、只做定位，不生成编辑回执；候选校验用它重算声明和有序贡献来源，浏览器模块图继续不依赖私有 Node／YAML 包目录。


## 独立 3D 原始表示

`scene3d.mjs` 的 `parseScene3DSource(content)` 返回冻结的 `{ model, sourceLocations }`；独立可选 `viento_core_scene3d_version() === 1`、`supportsStudioCoreScene3D()` 和 `dispatchStudioCoreScene3D()` 提供 `scene3d.parse`。Rust 校验严格作者结构、预算、稳定身份、相机／灯光与裁剪约束，并定位原始对象 UTF-16 范围。`createScene3DPlan(content)` 派生独立 `kind: 'scene3d'` schema 1 计划；纯层没有 DOM、文件或具体引擎依赖。原文仍为普通文档保存权威，GUI 的 WebGL2 和 Godot 导出适配分别消费同一模型／计划。原 2D 格式、创作域和执行协议不变。规则见[3D 初步接入](../docs/SCENE3D.md)。

### 3D 双指导航接口（0.1.0 之后的工作树）

纯函数 `touchCamera(camera, startPoints, currentPoints, viewport, distanceLimit = 200000, distanceMinimum = 0.01)` 返回分离、冻结的临时相机或 `null`。每组触点为两个局部 CSS `[x, y]`，`viewport` 使用 CSS `width/height` 与实际绘图缓冲 `aspect`。两组间距均至少 4px；有效相机基底直接按正比例缩放，不经 Euler 轨道的俯仰限制，再复用 `panCamera` 使起始两指中心的目标深度世界点落到当前中心。锚点修正使用实际可表示且受限的距离比例；保持原方向、可选 `up`、FOV 和裁剪声明。非法／退化输入、溢出、不可表示缩放与明显精度损失拒绝整个结果，不修改输入。规则同时适用透视与正交；透视其他深度仍按自身深度产生视差。

渲染器只有在两个明确的 touch 指针组合时升级手势，任一触点累计移动超过 4 CSS px 后开始。同一浏览器动画帧内先合并两指最新坐标，成功绘图后再更新相机和触点基准，避免缩放限幅下两个移动事件的先后顺序改变纯平移尺度；取景的临时距离边界沿用既有聚焦／缩放规则。平移和缩放形成一个完整候选，一次最终绘制；预检拒绝不改变旧相机，实际绘图失败另外清除命中帧与视图回执。任意抬指／取消／捕获丢失、第三触点或混合输入，以及滚动、尺寸／模型／模式／焦点变化或滚轮都会结束整次手势，不降级为残留单指点选或拖动。正常抬指先提交最后一批待处理的有效位移；取消、视口／模式／模型变更、重置、滚轮、销毁或上下文丢失则丢弃待处理输入并取消排帧，晚回调核对手势会话后才可执行。调度只由输入触发，不轮询；缺少帧调度的适配环境可同步执行，鼠标和单指路径保持。

`supportsTouchNavigation: true` 是渲染器本地只读提示，界面据此显示三语说明，不是 Studio 声明能力。数学没有 DOM，渲染器没有作者原文或保存接口，UI 不维护触点状态。鼠标和单指路径保留，没有新模块、Rust ABI、作者 schema 或后端协议；双指旋转、惯性与对象变换仍未接入。用户操作与各项验证范围见[双指导航](../docs/SCENE3D.md#双指导航010-之后的工作树)。

### 3D 坐标方向观察接口（0.1.0 之后的工作树）

纯函数 `orientationAxes(camera)` 仅消费有效相机基底，返回冻结的三项数组或 `null`。每项为 `{ axis: 'X' | 'Y' | 'Z', x, y, depth }`，分别对应正轴在屏幕右方向、屏幕向下方向及观察者方向的分量；`depth > 0` 表示朝向观察者。结果与 FOV、投影和作者语义无关，整体平移或改变镜头距离不改变方向；显式临时 `up` 保持精确极点与自由滚转的一致性。

`createScene3DRenderer` 的可选 `onViewChange(receipt)` 在完整成功帧后发布深冻结的 `{ camera, projectionMode }`，相同视图不会重复通知。相机字段、position/target 和可选 up 都与内部状态分离；没有源字节、模型、对象或编辑权限。有效画面失效、上下文丢失或销毁时发布 `null`，重复失效通知去重。观察者异常被隔离，不能把成功绘制改为失败或阻止资源释放。

独立 `createScene3DOrientationIndicator(container, { t })` 使用 `container.ownerDocument` 创建被动 SVG，返回冻结的 `{ update(camera), refresh(), dispose() }`。有效更新显示三根正轴，非法值隐藏；`refresh()` 只翻译固定词说明，`dispose()` 删除自身 SVG 并拒绝后续更新。轴组按深度排序，端点用实心／空心辅助区分朝向，固定 `+X/+Y/+Z` 标签在极点或共线时仍可分辨；颜色不是唯一标识。容器使用三语 `aria-label`，不设置 live 区域，不拦截指针。

预览入口保存所属渲染器的有效回执并守护当前会话；关闭、失效或无 GPU 时隐藏，无效草稿保留最后有效画面的朝向。组件不读取渲染器、不轮询、不重新解析原文，也不接入作者、保存或后端接口。它是方向观察提示，不提供点击方向、对象操纵、测量或网格。操作与专题证据见[坐标方向提示](../docs/SCENE3D.md#坐标方向提示010-之后的工作树)。

### 3D 正交投影视图接口（0.1.0 之后的工作树）

`cameraProjection4(camera, aspect, projectionMode = 'perspective')` 返回冻结的 16 元素列主序投影矩阵或 `null`，不包含 `lookAt4`。只接受 `perspective/orthographic`；透视路径保留既有 `perspective4` 的逐项输出。正交高度为 `2 * distance * tan(FOV / 2)`，宽度为高度乘实际绘图缓冲比例，沿右手 OpenGL 约定使用原 near/far。因此切换模式保留目标深度的显示中心和尺度，其他深度的尺寸会按投影规则改变。

`frameCamera(camera, object, aspect, projectionMode = 'perspective')` 与 `frameSceneCamera(camera, objects, aspect, projectionMode = 'perspective')` 按当前模式框定旋转几何。正交距离采用 `max(2 * radius, 1.2 * radius / (tan(FOV / 2) * min(1, aspect)))`，保持方向与临时 `up`，另生成安全近／远裁剪。`panCamera` 的签名与规则不变：目标深度尺度在两种模式一致，正交下所有深度的屏幕位移相同。数学层不取得 DOM、作者文本、宿主或执行后端。

渲染器可选 `setProjectionMode('perspective' | 'orthographic')` 返回布尔值，当前状态由 `snapshot().projectionMode` 显式报告。切换保留临时 camera、聚焦距离边界、选择和拖动方式，停止旧手势，并在矩阵与实际 Float32 上传预检后提交；绘制失败恢复原模式，部分绘图失败另使命中帧失效并报告。普通绘图、点选、选择提示及模式相关聚焦使用相同的矩阵生成路径。重置或换模型恢复作者 camera 并保留投影模式，关闭重开预览恢复默认透视。

投影模式不写入作者 schema、原文、元数据、保存、构建计划或 Godot 导出，没有新增 Rust ABI、模块、声明能力或后端协议。实际用户边界与专题证据见[正交观察](../docs/SCENE3D.md#正交观察010-之后的工作树)。

### 3D 临时镜头平移接口（0.1.0 之后的工作树）

`web/modules/scene3d-math.js` 的 `panCamera(camera, deltaX, deltaY, { width, height, aspect })` 是纯视图函数，返回分离、冻结的相机或 `null`。位移与 `width/height` 使用 CSS 像素，`aspect` 使用实际绘图缓冲宽高比。函数在当前相机基底内同时平移位置和目标，使目标深度处的几何跟随指针；正交模式下所有深度采用相同屏幕位移。保持原方向、距离、FOV、near/far 和可选临时 `up`；零拖动返回分离的无变化结果。它不使用作者坐标上限或普通轨道默认距离边界。非法输入、溢出、消失的拖动与明显精度损失拒绝整次计算；远坐标小物体允许正常舍入。

渲染器可选 `setDragMode('orbit' | 'pan')` 返回布尔值，模式由 `snapshot().dragMode` 显式报告。模式切换取消旧手势，模式本身不改相机；Shift 左键／中键在按下时选择一次性平移。平移不发出点选或聚焦回调，保留已有聚焦的距离边界与裁剪，先检查实际 Float32 上传再绘制；失败恢复上次相机，部分绘图失败另使命中帧失效并报告。模式在重置或换模型时保留，关闭重开预览恢复默认旋转；手势和临时相机都不进入作者模型。

这组接口位于已有只读预览边界，没有新增 Rust 操作、作者格式、系统能力或后端协议。操作与专题证据见[临时镜头平移](../docs/SCENE3D.md#临时镜头平移010-之后的工作树)。

### 3D 标准方向的视图接口（0.1.0 之后的工作树）

纯视图数学 `standardViewCamera(camera, direction)` 只接受 `front/back/left/right/top/bottom`，返回分离、冻结的相机或 `null`；临时 `up` 为显式三元向量。俯视为+Y侧／上方−Z，仰视为−Y侧／上方+Z，其他方向上方+Y。`lookAt4(position, target, up)`、对象／整景聚焦和 `orbitCamera` 共用该基底；没有显式up的作者相机保持原世界Y轨道与极点拒绝。带up的轨道使用屏幕局部轴连续旋转，零旋转缩放保持精确极点，聚焦结果与renderer快照复制up以隔离外部修改。

GPU适配器的可选 `setViewDirection(direction)` 返回布尔值，使用全部当前有效对象与实际绘图缓冲比例取景，保持FOV、身份选择和作者模型。它与 `focusAll()` 共享相机、临时裁剪、缩放范围和失败回滚；旧手势撤销，部分绘图失败清除命中帧并通知原错误端口。重置或新模型恢复作者相机，不保留临时up。标准方向专题最初仅覆盖透视；当前通过独立 `projectionMode` 选择透视或正交。作者 schema 不增加 up 或投影模式，也没有新的 Rust ABI、模型语义、宿主或执行权限。用户操作与实际验证见[标准方向](../docs/SCENE3D.md#标准观察方向010-之后的工作树)。

<a id="3d-只读浏览导航未发布增量"></a>

### 3D 只读浏览导航（0.1.0）

`scene3d-navigation.mjs` 复用已有 Rust `scene3d.parse` 的模型与来源，不增 schema、原生操作或编辑探针。`createScene3DObjectIndex(parsed)` 生成深冻结的显示行，`queryScene3DObjects(index, query)` 按名称／UUID 忽略大小写的字面子串筛选，保留声明顺序和稳定身份；仅查询 trim，不改作者名称。显示索引与作者提案、执行身份和保存资格分开。

`createScene3DSourceLocation({ sourcePath, token, content }, instanceId)` 复制严格快照，再完整原生解析当前原文，按 UUID 派生 JSON Pointer 和 UTF-16 声明范围。返回值深冻结且带本域私有标记，`isScene3DSourceLocation()` 检查该资格；序列化副本不转移它。`scene3DSourceDisplaySelection(location, displayedContent)` 仅接受该凭据，完整核对显示文本等于源 CRLF／CR 转 LF 后的内容，并把原范围映射到浏览器文本框的 UTF-16 偏移。BOM、Unicode 与作者原换行字节保持，调用方的行号或数字范围不作为来源权威。

预览仅取得独立 `getSource` 和可选 `locateSource` 端口。宿主重查文档、原文编辑会话、路径、token、完整源字节、保存基线和版本，并在 await 后再核当前视图审批；确认返回 `false` 或冻结 `{ located: true, focus }`。视图先关闭弹窗，再调用一次 `focus`；此时仍核当前文档／会话／源字节，只选择和滚动原文，不改变内容、dirty、保存或执行状态。缺少定位端口不会关闭搜索和 GPU 预览，旧画面不授予过期源范围导航。

Web 渲染适配器新增同步 `focusObject(instanceId)`，成功返回 `true`，未加载、未知身份、已释放或上下文丢失时 `false` 且不改变视角。独立 `frameCamera(camera, object, aspect)` 以旋转方块包围球、实际绘制缓冲比例和较小视场角计算 1.2 倍留白，返回深冻结的临时镜头；无效视角输入返回 `null`。朝向和 FOV 保持，临时 near／far 包含完整几何，不受作者裁剪或普通轨道默认最大距限制。

聚焦后的轨道／缩放使用独立临时距离边界并重算裁剪范围，避免第一次交互跳回普通 0.01／200000 默认夹距；非聚焦轨道保持原默认边界。GPU 矩阵使用目标作为临时浮动原点，保持平移不变量和远坐标小物体的 float32 精度；`snapshot().camera` 仍返回作者坐标系中的 detached 临时值。重置／新模型恢复作者相机并清旧拖动、聚焦，关闭释放 GPU 和监听资源。renderer／数学层不取得源字节、HTTP、文件、作者控制器、World 或后端端口。用户步骤见[只读浏览指南](../docs/SCENE3D.md#只读浏览导航未发布增量)。

### 3D 全场景取景（0.1.0）

`scene3d-math.js` 的 `sceneBounds(objects)` 以所有方块真实旋转八角点计算冻结的 `{ min, max, center, radius }` 或 `null`；`frameSceneCamera(camera, objects, aspect)` 保留当前视向与 FOV，使用实际画布比例生成临时相机或 `null`。全场景包围保证不等于远处微小对象具有可辨像素。

渲染器的可选 `focusAll(): boolean` 取消旧手势，在上传前检查 Float32 矩阵有限性，保留当前选择及现有 `snapshot().camera` 形状；取景裁剪与缩放边界仅属于临时视图。无效计算不变更相机；真正绘图失败回滚相机与聚焦状态、使命中帧失效，并通过已有 `onError` 反馈。重置和成功新模型恢复作者相机。UI 在无 WebGL、等待刷新或旧会话状态时关闭动作，搜索过滤不会缩小取景范围；无效草稿仍可查看最近有效模型，原文定位继续检查完整当前来源。该接口没有 Rust、作者补丁、保存、素材或后端权限。用户边界见[全场景取景](../docs/SCENE3D.md#全场景取景未发布增量)，软件浏览器限制保存在[专题](../docs/test-results/scene3d-scene-framing/results.json)。

<a id="3d-画布选择未发布增量"></a>

### 3D 画布选择（0.1.0）

画布命中属于视图坐标和输入适配，不新增 Rust 作者操作、schema、`engine/index.mjs` 导出或宿主权限。`web/modules/scene3d-picking.js` 的纯 `pickScene3DObject(frame, clientX, clientY)` 消费实际绘图帧 `{ rect, width, height, viewProjection, objects: [{ instanceId, model }] }`；矩阵是实际上传的 Float32 值，返回最近可见方块的 UUID 或 `null`，不修改输入。CSS 客户坐标通过当前画布位置映射；近面／中间深度构造有限射线，再检查真正的方块表面及齐次裁剪，避免极端裁剪比例下 Float32 远点变为无穷。完全同深度时与现有 `LEQUAL` 绘图一致，后声明优先。

`renderer.hitTest(clientX, clientY)` 只读取内部最近成功绘图帧；未绘制、已关闭、上下文丢失或画布尺寸与当前分配不一致时返回 `null`。可选 `onPick(instanceId, { focus })` 只在合格单击／双击后通知独立预览；第二参数是冻结的视图提示，渲染器不直接取得选择控制器、源快照、作者提案、保存或引擎接口。预览核对当前画布／适配器、有效文档和模型 UUID 后更新选择；明确 `focus: true` 时再复用既有 `focusObject`。筛选及来源诊断保持，空白不清选择。

此算法匹配实际绘图矩阵的几何投影，不宣称与抗锯齿边缘、深度缓冲量化或逐像素 ID 缓冲完全一致。手势、取消和真实浏览器范围见[画布选择指南](../docs/SCENE3D.md#画布选择未发布增量)。旧解析、四份作者提案品牌、来源定位宿主、后台工程和运行协议保持原字节。

<a id="3d-选择反馈未发布增量"></a>

### 3D 选择反馈（0.1.0）

渲染器新增可选 `setSelectedObject(instanceId | null) -> boolean`，只持有临时稳定身份。未加载模型、未知身份、非法输入、上下文丢失或释放后返回 `false` 且不改变状态；有效身份或显式 `null` 更新视觉选择，同值调用成功且不重绘。`setModel` 清理旧选择，由独立预览在成功加载后同步；`resetView` 保留选择。`snapshot().selectedInstanceId` 是 UUID 或 `null`，不携带作者范围或写入资格。

边缘提示在原有实体绘制的同一片元着色中完成。单位方块局部坐标和面的固定轴区分真实外边缘与三角对角线，导数近似计算明暗色带；位置、变换、Float32 上传矩阵、深度测试、裁剪和声明顺序保持，没有膨胀方块、额外透视通道或作者材质变更。同深度仍按现有 `LEQUAL` 顺序，后声明实体可以遮挡先声明对象的提示。

选择反馈重绘仅在实际 Float32 相机／对象矩阵、有序 UUID、绘图分配和 CSS 尺寸均相同时保留私有几何帧身份，避免一次单击显示提示后误使原生双击失效。普通重绘及相机／模型／尺寸变化仍遵守原取消规则；位置变化的手势守护保持。列表与画布只向渲染器同步身份，没有新增 Rust 语义、schema、模块、作者补丁、来源宿主或后端协议。用户步骤与限制见[视觉反馈](../docs/SCENE3D.md#选中对象的视觉反馈未发布增量)。

<a id="3d-单对象变换未发布增量"></a>

### 3D 单对象变换（0.1.0）

0.1.0 纳入独立可选 `viento_core_scene3d_patch_version() === 1`。`supportsStudioCoreScene3DPatch()` 同时检查原 `scene3d.parse` 与新补丁探针；缺少补丁探针不影响已支持的只读解析。`dispatchStudioCoreScene3DPatch(request)` 只接受以下五字段请求，`values` 是非空的 `position`／`rotationDegrees`／`size` 子集，每项为沿用作者范围的三个有限数值：

```js
dispatchStudioCoreScene3DPatch({
  protocolVersion: 1,
  operation: 'scene3d.patchObjectTransform',
  content,
  instanceId,
  values: { position: [3, 1.5, -4] },
});
```

原生响应的 `scene3dPatch` 与桥接返回值均为精确 `{ instanceId, beforeContent, afterContent, changedPaths }`。Rust 复用现有严格解析、CST 和数值规则，前后各验证完整原文及 128 KiB UTF-8 预算；按稳定实例只替换净变化数字 token。其他原文、未变数字词法、键转义、BOM、CRLF、顺序与稳定身份保持。路径只对应实际改动分量，固定按 `position`、`rotationDegrees`、`size` 再按 XYZ 排序，例如 `/objects/1/size/2`。原生和桥接接受无变化请求，返回原字节与空路径；作者提案层另以 `scene3d_transform_unchanged` 拒绝无净变化审批。

桥接拒绝访问器、隐藏属性、自定义序列化和无效 DTO；成功回执绑定目标、完整输入原文、实际路径、全部非数字原字节及完整 Rust 前后模型，只允许请求目标字段的净数值变化。伪造或超限成功回执使核心不可用；正常来源／数值错误保持核心可用。桥接保持无 DOM、Node 或 YAML/CST 包依赖，数值词法库存仅防御回执，场景准入和修改仍由 Rust 执行。旧解析、模型、计划、2D 创作接口及后端协议保持原契约。

`scene3d-transform.mjs` 的 `createScene3DTransformProposal(source, { instanceId, values })` 使用当前来源快照 `{ sourcePath, token, content, baseSourceRevision, sourceRevision }` 生成深冻结、带模块私有标记的完整提案；复制或序列化提案不转移应用资格。`prepareScene3DTransformApply(source, proposal, { digest })` 在等待摘要前分离来源，核对路径、token、原文与修订并重新生成精确补丁，返回冻结 `{ afterContent, sourcePath, changedPaths }`。它不保存文件或持有 World／引擎／渲染权限；宿主仍须在异步完成后核对当前编辑会话和审批，应用到原文内存，再普通保存。GUI 作者表单与只读预览分别取得自己的接口，步骤见[对象变换指南](../docs/SCENE3D.md#编辑单个对象的变换未发布增量)。

[前轮变换核心记录](../docs/test-results/scene3d-transform-authoring/core-results.json)保留当时 196 项 Rust 测试及该轮验证范围，与 0.0.10 的初步 3D 验证分别保存，不代表已更新安装版、移动设备或额外引擎能力。

<a id="3d-对象结构管理未发布增量"></a>

### 3D 对象结构管理（0.1.0）

0.1.0 纳入独立可选 `viento_core_scene3d_objects_version() === 1`。`supportsStudioCoreScene3DObjectsPatch()` 同时检查原 `scene3d.parse` 与新 objects 探针，`dispatchStudioCoreScene3DObjectsPatch(request)` 只调度 `scene3d.patchObjects`。缺少新探针只关闭对象管理，已有解析和变换接口保持；本域不依赖变换探针。

请求共有精确四字段 `{ protocolVersion: 1, operation: 'scene3d.patchObjects', content, action }`，再按动作提供以下字段；不接受其他或混合动作字段：

| `action` | 额外请求字段 | 修改范围 |
| --- | --- | --- |
| `add` | `object`：完整七字段方块声明 | 追加新对象；身份、名称、形状、位置、旋转、尺寸和颜色沿用既有 schema |
| `copy` | `instanceId`、`newInstanceId`、`name` | 追加所选原声明的 CST 副本，只替换身份和净变化名称值 |
| `remove` | `instanceId` | 删除所选声明及必要分隔符，保留至少一个对象 |

新增／复制 UUID 由调用者一次提供，必须规范、全新且不与现有对象冲突。复制名称必需显式提供；与原名称语义相同时保留原名称 token，包括转义拼写。复制不添加偏移或修改变换，原数字的指数、负零、键转义、键顺序及项内空白保持。删除按原声明位置执行，未删除对象和场景其余字节保持。

原生响应的 `scene3dObjectsPatch` 与桥接返回值均为精确六字段 `{ action, instanceId, sourceInstanceId, beforeContent, afterContent, changedPaths }`。`instanceId` 表示新增／复制的目标或被删除对象，`sourceInstanceId` 仅复制时为原对象身份，其余动作固定为 `null`。`changedPaths` 恰有一个 `/objects/N`，指追加位置或被删除位置；删除后其他对象的来源范围须重新读取，不能沿用旧原文范围。

Rust 复用严格 `scene3d.parse` 和 CST，完整验证前后原文；两份原文分别限 128 KiB UTF-8，对象保持 1–128 个并沿用已有相机、灯光、名称、向量及身份约束。原文无效、未知或重复字段、身份冲突、最后对象删除、越界或增长超限均原子拒绝。桥接核对精确 DTO、完整前后 Rust 模型和所有未授权字节，拒绝访问器、自定义序列化、错误身份／路径及伪造成功回执；正常领域错误保持核心可用，坏成功回执使其不可用。没有新增 JavaScript 场景规则或 YAML／宿主依赖。

`scene3d-objects.mjs` 提供 `createScene3DObjectsProposal(source, edit)`、`isScene3DObjectsProposal(proposal)` 和 `prepareScene3DObjectsApply(source, proposal, { digest })`。`source` 沿用精确 `{ sourcePath, token, content, baseSourceRevision, sourceRevision }`，`edit` 是 `{ action: 'add', object }`、`{ action: 'copy', instanceId, newInstanceId, name }` 或 `{ action: 'remove', instanceId }`。完整提案深冻结且带模块私有标记；拷贝、序列化或另一作者域的提案不能取得应用资格。

应用准备在等待摘要前复制来源，核对路径、token、完整原文和修订，检查当前摘要并重算完整原生补丁，返回冻结 `{ afterContent, sourcePath, changedPaths }`。`scene3d-authoring.mjs` 只共享来源准入，不共享动作、提案标记或控制器。宿主仍须在等待后核对编辑会话与完整审批，才更新原文内存；普通保存负责磁盘写入、基线和外部冲突。作者层不调用渲染器、World 命令、后端或 Save；GUI 操作见[方块管理指南](../docs/SCENE3D.md#管理方块对象未发布增量)。

`org.viento.scene3d-objects` 只依赖文档模块，贡献 `scene.authoring.objects3d`，由宿主注入本域来源和草稿应用接口。静态能力声明不授予权限，不代表安装包已更新或所有内部功能均已拆分。

[前轮对象管理核心记录](../docs/test-results/scene3d-object-authoring/core-results.json)绑定当时 210 项 Rust 测试（新增 14 项）、18 项新桥接测试、20 请求的实际原生／WASM 一致性，以及含新增项的 219 项共享核心回归。各轮记录保留原时点；回归总数不相加，源码验证不代替安装版或设备验证。

<a id="3d-环境原文编辑未发布增量"></a>

### 3D 环境原文编辑（0.1.0）

0.1.0 纳入独立可选 `viento_core_scene3d_environment_version() === 1`。`supportsStudioCoreScene3DEnvironmentPatch()` 要求原 `scene3d.parse` 与新环境探针均为 1；`dispatchStudioCoreScene3DEnvironmentPatch(request)` 只调度 `scene3d.patchEnvironment`。缺少新探针不会关闭已支持的原解析、对象或变换能力，本域也不依赖后两者的探针。

请求精确为 `{ protocolVersion: 1, operation: 'scene3d.patchEnvironment', content, values }`。`values` 是非空的背景、相机或灯光子集；存在的嵌套子集也须非空，无 `null`、额外字段或原始 JSON 解码后重复键：

| 值 | 允许的字段 |
| --- | --- |
| `background` | 六位十六进制颜色字符串 |
| `camera` | `position`、`target` 三元有限数值；`fovDegrees`、`near`、`far` 有限数值 |
| `light` | `direction` 三元有限数值；`color` 六位十六进制颜色；`energy` 有限数值 |

```js
dispatchStudioCoreScene3DEnvironmentPatch({
  protocolVersion: 1,
  operation: 'scene3d.patchEnvironment',
  content,
  values: { background: '#102030', camera: { near: 2000, far: 4000 } },
});
```

原生 `scene3dEnvironmentPatch` 和桥接返回值均精确为 `{ beforeContent, afterContent, changedPaths }`。原文先经完整旧解析器校验，Rust 按 CST 只替换净变化的数字或颜色字符串值 token，合并全部所选项后再完整验证最终场景。近平面与远平面、位置与目标可以原子调整，不校验临时逐字段状态；相机距离／方向／裁剪、灯光方向／强度和其他数值限制沿用原 `scene3d.parse`。前后各限 128 KiB UTF-8，预算增长超限拒绝；无效候选不产生部分结果。

`changedPaths` 固定按 `/background`、`/camera/position/0..2`、`/camera/target/0..2`、`/camera/fovDegrees`、`/camera/near`、`/camera/far`、`/light/direction/0..2`、`/light/color`、`/light/energy` 返回净变化项，与作者键顺序无关。同值数值和解码后同值字符串保留原始词法；所有对象、名称、视口、键转义、未改数值／颜色、BOM、CRLF 和其余原字节保持。合法原生和桥接 no-op 返回原字节及 `[]`，纯提案另以 `scene3d_environment_unchanged` 拒绝无变化审批。

桥接先拒绝访问器、自定义序列化和无效精确 DTO，再用原生完整前后模型与数字／字符串 token 库存核对成功回执。库存固定全部 key token 和结构原字节，只允许 value slot 净变化；完整预期模型绑定请求的环境叶字段，不能靠交换相机键名伪造数值修改。坏成功回执使核心不可用；正常领域错误保持可用。没有引入 JavaScript 数值范围／交叉约束副本、JSON 属性解析器、YAML 或宿主依赖。

`scene3d-environment.mjs` 的 `createScene3DEnvironmentProposal(source, { values })`、`isScene3DEnvironmentProposal(proposal)` 和 `prepareScene3DEnvironmentApply(source, proposal, { digest })` 使用本域私有提案标记，绑定精确来源快照 `{ sourcePath, token, content, baseSourceRevision, sourceRevision }`。提案深冻结并含前后环境和完整原文；复制、序列化或其他作者域的提案不能应用。准备阶段在 await 前复制来源，复查摘要、身份与修订，再重算全部补丁；宿主在等待后还须复查当前会话及审批才更新内存。普通保存继续负责磁盘持久化与冲突。

`org.viento.scene3d-environment` 只依赖文档模块，贡献 `scene.authoring.environment3d`，取得自己的来源读取和草稿应用接口。它不取得预览渲染器、对象／变换控制器、World、后端或 Save 接口；预览临时视角不会转换为作者相机。用户步骤见[作者环境指南](../docs/SCENE3D.md#编辑作者环境未发布增量)。

[前轮环境核心记录](../docs/test-results/scene3d-environment-authoring/core-results.json)绑定当时 222 项 Rust 测试（新增 12 项）、20 项新增桥接测试、20 请求的实际原生／WASM 一致性及含新增项的 239 项共享核心回归；初次新夹具失败与实际字段名交换漏洞、修复和回归日志均保留。此前变换、对象管理和发布证明保持原时点，不代表新安装包或设备验收。

<a id="3d-对象属性原文编辑未发布增量"></a>

### 3D 对象属性原文编辑（0.1.0）

当前工作树另增独立可选 `viento_core_scene3d_properties_version() === 1`。`supportsStudioCoreScene3DPropertiesPatch()` 要求原 `scene3d.parse` 与新 properties 探针均为 1，`dispatchStudioCoreScene3DPropertiesPatch(request)` 只调度 `scene3d.patchProperties`。缺少本域能力仅关闭属性编辑，不关闭已支持的解析、变换、对象结构或环境操作，本域也不依赖它们的编辑探针。

请求精确为 `{ protocolVersion: 1, operation: 'scene3d.patchProperties', content, instanceId, values }`，`instanceId` 指原文已有的稳定对象，`values` 是非空的 `name`／`color` 字符串子集，不接受 `null`、其他字段或原始 JSON 解码后重复键。只提供 SET，不修改身份、几何或结构：

```js
dispatchStudioCoreScene3DPropertiesPatch({
  protocolVersion: 1,
  operation: 'scene3d.patchProperties',
  content,
  instanceId,
  values: { name: 'Tower · 方柱', color: '#87d8b9' },
});
```

原生 `scene3dPropertiesPatch` 与桥接返回值均精确为 `{ beforeContent, afterContent, changedPaths }`。Rust 先完整验证原文，再仅替换目标净变化字符串值为规范 JSON 字符串；最终完整解析复用原名称 1–256 Unicode 码点、六位颜色及所有场景规则，没有新增 trim 或名称规范化。原文和结果分别限 128 KiB UTF-8，字符串增长与转义编码计入预算；原文无效、未知身份、非法属性或增长超限原子拒绝。路径固定按 `/objects/N/name`、`/objects/N/color` 返回实际变化，与作者键顺序无关。

同值解码字符串保留原始转义词法。合法 native／bridge no-op 返回完整原字节与 `[]`，作者层以 `scene3d_properties_unchanged` 拒绝空审批。字符串库存固定全部 key token 及所有非字符串间隔，包括数字、顺序、BOM、换行和结构；全场景预期模型进一步绑定所选对象和值，名称／颜色键交换、其他对象变化或同值重新编码均拒绝。成功回执只有授权字符串 value slot 可变化；伪造回执使核心不可用，正常领域错误保留核心可用。桥接无 JavaScript 语义规则副本、属性解析器、DOM、Node、YAML 或文件依赖。

`scene3d-properties.mjs` 提供 `createScene3DPropertiesProposal(source, { instanceId, values })`、`isScene3DPropertiesProposal(proposal)` 和 `prepareScene3DPropertiesApply(source, proposal, { digest })`。精确来源快照仍为 `{ sourcePath, token, content, baseSourceRevision, sourceRevision }`；提案深冻结并带本域私有标记，含选中身份、前后对象、完整原文和变更路径。拷贝、序列化及其他作者域提案不转移应用资格。

准备阶段在 await 前复制来源，复查路径、token、原文、基线和当前摘要，重算全部字符串补丁；宿主在等待后复查当前会话与完整审批才更新原文内存，普通保存继续负责磁盘与冲突。属性模块不取得对象／变换／环境控制器、渲染器、World、后端或 Save 接口。当时工作树固定声明 12 个模块、28 项能力；`org.viento.scene3d-properties` 只依赖文档模块并贡献 `scene.authoring.properties3d`，静态声明不授予保存权限或证明安装包已更新。用户步骤见[名称和颜色指南](../docs/SCENE3D.md#编辑对象名称和颜色未发布增量)。

本轮[对象属性核心验证](../docs/test-results/scene3d-property-authoring/core-results.json)绑定 234 项 Rust 测试（185 单元＋49 集成，新增 12 项）、20 项新增桥接测试、20 请求的实际 native／WASM 一致性，以及包含新增项的 259 项共享核心回归。实测包含原始重复键、Unicode／控制字符名称、同值转义与无变化、UTF-8 增长和收缩、键交换与非授权数值／对象回执、独立探针和旧操作兼容；这些源码证明不代表已更新安装包或设备验收。

<a id="3d-多对象整体移动未发布增量"></a>

### 3D 多对象整体移动（0.1.0）

新可选 `viento_core_scene3d_translation_version() === 1` 由 `supportsStudioCoreScene3DTranslationPatch()` 检查，另要求既有 `scene3d.parse`。`dispatchStudioCoreScene3DTranslationPatch(request)` 只接受以下精确五字段请求；缺新探针只关闭整体移动，原四份作者操作继续独立可用。

```js
dispatchStudioCoreScene3DTranslationPatch({
  protocolVersion: 1,
  operation: 'scene3d.translateObjects',
  content,
  instanceIds: [firstId, secondId],
  offset: [3, 0, 2],
});
```

`instanceIds` 为 1–128 个不同且已存在的规范 UUID；`offset` 为三个有限数，各轴 ±200000。Rust 先解析完整原文和 CST，再计算全部目标位置，各轴最终 ±100000；合并净变化位置数字词元后只验证完整最终结果，不调用多次单对象补丁。前后各限 128 KiB UTF-8，任何无效目标、越界或最终预算超限整次拒绝。

原生 `scene3dTranslationPatch` 与桥接返回值精确为 `{ instanceIds, offset, beforeContent, afterContent, changedPaths }`。目标按原声明顺序返回，包括因浮点舍入未净变化的已选对象；路径只列净变化位置分量，按原对象序号和 XYZ 排序。桥接分离输入，核对精确 DTO、完整前后原生模型及数字词元间所有原字节，拒绝伪造回执和未授权数值归一化。原生与桥接接受完全无净变化，返回原字节和空路径；作者提案以 `scene3d_translation_unchanged` 拒绝审批。BOM、CRLF、转义键、未变指数与负零词法保持。

`scene3d-translation.mjs` 提供 `createScene3DTranslationProposal(source, { instanceIds, offset })`、`isScene3DTranslationProposal()`、`prepareScene3DTranslationApply(source, proposal, { digest })`。五字段来源为 `{ sourcePath, token, content, baseSourceRevision, sourceRevision }`；提案深冻结、带私有标记，包含源身份与修订、完整原文、规范目标、偏移、净变路径及完整 `beforeObjects`／`afterObjects`。拷贝、序列化及其他四域提案不能应用。

准备阶段在 await 前复制来源，重查摘要及源身份并重算完整原生补丁。宿主在异步完成后再次检查来源所有者和审批才一次性更新原文内存，普通保存保留磁盘基线与冲突职责。`org.viento.scene3d-translation` 只依赖文档模块，贡献 `scene.authoring.translation3d`；该专题当时共十三模块、29 项声明能力。新域不依赖预览、具体后端、World 或 Save，不变更作者 schema、运行协议或渲染器。步骤见[整体移动指南](../docs/SCENE3D.md#整体移动多个对象未发布增量)，核心证据见[独立记录](../docs/test-results/scene3d-translation-authoring/core-results.json)。

<a id="3d-参照位置对齐未发布增量"></a>

### 3D 参照位置对齐（0.1.0）

`viento_core_scene3d_alignment_version() === 1`、`supportsStudioCoreScene3DAlignmentPatch()`、`dispatchStudioCoreScene3DAlignmentPatch()` 提供独立可选对齐域，仅依赖原 `scene3d.parse`，缺此探针不影响其余五份作者操作。

```js
dispatchStudioCoreScene3DAlignmentPatch({
  protocolVersion: 1,
  operation: 'scene3d.alignObjects',
  content,
  instanceIds: [referenceId, otherId],
  anchorInstanceId: referenceId,
  axis: 'x',
});
```

请求精确六字段；`instanceIds` 为 2–128 个不同且已存在的规范 UUID，`anchorInstanceId` 必须属于所选集合，`axis` 为小写 `x`／`y`／`z`。Rust 从同份完整原模型直接取得参照该轴位置，按原声明顺序设置所选对象，只合并净变化数字词元，再解析完整最终候选。前后各限 128 KiB UTF-8；原文无效、重复／未知身份、未选参照、非法轴或最终增长超限整次拒绝。目标没有通过多次变换或整体移动重建，没有屏幕／GPU 或包围盒计算。

原生 `scene3dAlignmentPatch` 与桥接返回值精确为 `{ instanceIds, anchorInstanceId, axis, beforeContent, afterContent, changedPaths }`。所选对象含参照，按原声明顺序返回；路径只对应净变化的所选轴位置，按原对象序号排列。参照和已对齐对象保留原数字词法，未选轴与所有其他字段及词元间字节保持。桥接分离输入，核对完整前后原生模型、精确参照和轴、规范目标及位置数字范围，拒绝错误参照、额外路径、未授权修改或数值归一化。原生与桥接接受无净变化，返回原文与空路径；提案层以 `scene3d_alignment_unchanged` 拒绝审批。

`scene3d-alignment.mjs` 提供 `createScene3DAlignmentProposal(source, { instanceIds, anchorInstanceId, axis })`、`isScene3DAlignmentProposal()`、`prepareScene3DAlignmentApply(source, proposal, { digest })`。精确五字段来源 `{ sourcePath, token, content, baseSourceRevision, sourceRevision }` 与当前作者域共用准入；私有品牌、动作语义与审批独立。提案包含完整原文、前后所选声明、目标、参照、轴和变更路径，深冻结，复制及其余五域品牌不能转移应用资格。准备在 await 前捕获来源，复查摘要及身份，再重算完整原生补丁；宿主等待后核对当前文档／来源／审批才一次性更新原文内存，普通保存继续负责磁盘基线和外部冲突。

`org.viento.scene3d-alignment` 只依赖文档模块，贡献 `scene.authoring.alignment3d`，通过独立 `scene3dAlignment` 端口装配。该对齐专题当时共十四模块、30 项声明能力；作者 schema、只读渲染、2D、后端工程和运行协议保持。用户步骤见[位置对齐](../docs/SCENE3D.md#对齐多个对象的位置未发布增量)，验证见[独立记录](../docs/test-results/scene3d-alignment-authoring/results.json)。

<a id="3d-单轴等距分布未发布增量"></a>

## 3D 单轴等距分布（0.1.0）

独立可选 `viento_core_scene3d_distribution_version() === 1` 与既有 `scene3d.parse` 共同决定 `supportsStudioCoreScene3DDistributionPatch()`。`dispatchStudioCoreScene3DDistributionPatch(request)` 接受精确五字段请求：

```js
{
  protocolVersion: 1,
  operation: 'scene3d.distributeObjects',
  content: originalText,
  instanceIds: [firstUuid, secondUuid, thirdUuid],
  axis: 'x',
}
```

目标为3–128个不同且已存在的稳定UUID。原生从同份完整原文按该轴数值升序排序，相等数值（含正／负零）按声明序，不采用调用者顺序。原排序两端直接保留作者数值和词元；内部点使用 `start + (end - start) * (i / (n - 1))` 的 binary64 运算次序，不采用融合乘加。跨度为0合法返回无净变化；非零跨度若最终序列含两端不能严格递增，整次 `scene3d_distribution_invalid`，没有部分回执或自行修正。其他作者约束及最终128KiB UTF-8预算在完整候选上核对，增长与收缩共同结算。

精确回执 `scene3dDistributionPatch` 为 `{ instanceIds, orderedInstanceIds, axis, beforeContent, afterContent, changedPaths }`：`instanceIds`按原声明序，`orderedInstanceIds`按分布序，路径只列净变化该轴token并按原文对象序。桥接核对两套完整UUID、轴、前后模型及词元之间的全部未授权字节；不允许伪造重排或额外数字修改。未变内部点、两端、其他轴与对象、键拼写、指数／负零、BOM及CRLF保持。原生与桥接接受no-op，作者提案以 `scene3d_distribution_unchanged` 拒绝审批。

`scene3d-distribution.mjs` 提供 `createScene3DDistributionProposal(source, { instanceIds, axis })`、`isScene3DDistributionProposal()` 和 `prepareScene3DDistributionApply(source, proposal, { digest })`。来源精确为 `{ sourcePath, token, content, baseSourceRevision, sourceRevision }`；独立深冻结提案携带原文、前后所选完整对象、两套身份顺序、轴与路径，具有第七私有品牌。序列化、克隆及旧六域提案不授予应用权。准备在await前分离来源，核对身份与摘要并重算完整原生补丁；宿主最后复核当前会话和审批，才一次写入原文内存，普通保存负责持久化和冲突。

`org.viento.scene3d-distribution`仅依赖文档模块，贡献 `scene.authoring.distribution3d`，通过独立 `scene3dDistribution` 端口装配。该分布专题当时15模块、31项声明能力，schema、只读预览、渲染、2D和执行后端保持。缺新探针仅禁用本域；用户步骤见[等距分布](../docs/SCENE3D.md#等距分布多个对象的位置未发布增量)。

<a id="3d-批量复制未发布增量"></a>

## 3D 批量复制（0.1.0）

独立可选 `viento_core_scene3d_copy_version() === 1` 与既有 `scene3d.parse` 共同决定 `supportsStudioCoreScene3DCopyPatch()`。`dispatchStudioCoreScene3DCopyPatch(request)` 只接受精确五字段：

```js
{
  protocolVersion: 1,
  operation: 'scene3d.copyObjects',
  content: originalText,
  copies: [
    { sourceInstanceId: firstUuid, newInstanceId: firstCopyUuid },
    { sourceInstanceId: secondUuid, newInstanceId: secondCopyUuid },
  ],
  offset: [3, 0, 2],
}
```

`copies`准入为1–127份精确两字段映射，来源不同且存在，新UUID不同且不与任何原对象冲突。成功复制同时要求`originalCount + copies.length <= 128`，因此实际批次最大64，且不超过当前来源数与剩余名额；不会降低或截断请求。offset是作者世界位置的binary64逐分量加法，各轴±200000，副本最终每轴±100000。原解析错误沿用原域，语义身份／位置无效用`scene3d_copy_invalid`，最终对象／UTF-8预算超限用`scene3d_limit`；请求结构不合法用`studio_core_request_invalid`。零偏移和舍入后未净移动都仍合法结构复制，没有`unchanged`审批分支。

精确原生`scene3dCopyPatch`为`{ copies, offset, beforeContent, afterContent, changedPaths }`。映射按来源在原文中的声明顺序返回、保持源→新UUID对应，副本同序追加；路径仅为顺序新项`/objects/<originalCount>`等。原完整文档在最后原对象末尾只有一处插入，每份为`,`＋原数组首项前空白＋副本完整声明，原前后字节保持。副本从来源CST复制，只修改新UUID值和净变化position数字词元，名称不加后缀；原位置未净变化时词法保持。整个候选一次校验128KiB UTF-8和作者约束，不循环调用旧copy或解析中间态。

桥接使用原生前后sourceLocations、完整model witness和字符串／数字联合词元清单，限定UUID值槽及position数字槽，所有键、其他值、内部空白和原文前后段byte固定；名称恰等于旧UUID、位置与旋转/尺寸同数值时也不能扩大授权。来源UUID词法只在其副本的instanceId值被替换，其他相同字符串保持。

`scene3d-copy.mjs`提供`createScene3DCopyProposal(source, { copies, offset })`、`isScene3DCopyProposal()`与`prepareScene3DCopyApply(source, proposal, { digest })`。五字段来源`{ sourcePath, token, content, baseSourceRevision, sourceRevision }`在await前分离；深冻结第八私有品牌提案包含完整原文、规范映射、共同偏移、新项路径及原selected `beforeObjects`与新clone `afterObjects`，两套诊断同source-order mapping。准备核对源身份／两修订／摘要并重算精确补丁；宿主最后守护才更新源内存，普通保存继续负责持久化与冲突。克隆、序列化及旧七域提案无跨入口权限。

`org.viento.scene3d-copy`仅依赖文档模块，贡献`scene.authoring.copy3d`，通过独立`scene3dCopy`端口装配；该复制专题当时16模块、32项声明能力。作者schema、原七域、只读预览／渲染、2D与执行后端保持。缺新探针只禁用本域。用户步骤见[批量复制](../docs/SCENE3D.md#批量复制对象未发布增量)。

<a id="3d-批量移除未发布增量"></a>

## 3D 批量移除（0.1.0）

新增可选ABI `viento_core_scene3d_removal_version() === 1`、`supportsStudioCoreScene3DRemovalPatch()`与`dispatchStudioCoreScene3DRemovalPatch()`。精确四键请求为`{ protocolVersion: 1, operation: 'scene3d.removeObjects', content, instanceIds }`，数组允许1–128个不同现有小写UUID；必须至少保留一个对象，因此最多成功移除127项。空选择、重复／未知身份或移除全部以`scene3d_removal_invalid`拒绝，原文解析和128KiB预算优先，不能通过删除绕过无效来源。

原生`scene3dRemovalPatch`回执精确四键`{ instanceIds, beforeContent, afterContent, changedPaths }`。身份与路径按原声明顺序规范化，`/objects/i`使用删除前索引。基于原CST复用连续选中项的删除区间，一次合并拼接和最终完整解析；不循环旧单对象接口。幸存对象声明和删除区间之外的字节保留，必要逗号及邻近空白会随被删区间去除。

桥接以原生model及sourceLocations独立重建完整预期切区间，要求afterContent逐字相同，并核对所有幸存对象模型。不接受语义相同的重排、数值改写或布局整理，不引入第二套JS语义解析器。

`scene3d-removal.mjs`提供`createScene3DRemovalProposal(source, { instanceIds })`、`isScene3DRemovalProposal()`及`prepareScene3DRemovalApply(source, proposal, { digest })`。五字段来源在await前分离；第九私有WeakSet品牌和深冻结提案有11键：`kind: 'scene3d-removal'`、`sourcePath`、`sourceToken`、`baseSourceRevision`、`sourceRevision`、`instanceIds`、`beforeContent`、`afterContent`、`changedPaths`、`removedObjects`、`remainingObjects`。前者为源序待删对象，后者为全部源序幸存对象。准备核对摘要／身份／修订并重算完整补丁；宿主等待后复核会话和审批，才更新草稿，普通保存处理磁盘和冲突。旧八域及克隆不授予本域权限，没有无变化审批。

`org.viento.scene3d-removal`仅依赖文档模块，贡献`scene.authoring.removal3d`并装配独立`scene3dRemoval`来源端口。该移除专题当时为17模块、33项声明能力；预览、schema、2D、执行后端及旧八作者域保持，用户步骤见[批量移除](../docs/SCENE3D.md#批量移除对象未发布增量)。

### 可选距离雾（0.1.0 之后的工作树）

作者 schema 1 与独立 scene3d plan 1 允许可选 `fog: { color, density }`，其中 color 为六位 hex，density 是 `0..1` 的每场景单位衰减系数。缺省或零关闭；不改变模板包，不隐式填充旧模型。`supportsStudioCoreScene3DFog()` 检查独立 `viento_core_scene3d_fog_version() === 1`。含雾解析及雾修改需要该能力，原环境能力保持可用。

`scene3d.patchEnvironment` 接受完整的 `values.fog`。首次插入在已验证的根对象结束括号前追加规范组件，变化路径为 `/fog`；已有组件仅改 `/fog/color`、`/fog/density` 净变化叶值。桥接层对新增片段做精确定位和内容绑定，剥离该片段后复用旧 token／间隙清单检查，再核对重解析模型；其余字段与原字节仍受原规则保护。before／afterEnvironment 仅在模型实际有雾时带 fog。普通保存、来源修订和审批守护沿用已有环境域。

密度按 `1 - exp(-density * distance)` 作用于物体表面。WebGL2 与 Godot 分别适配，核心没有渲染／时间／宿主权限；距离来自当前镜头，不写回作者相机。格式、编辑步骤与实测边界见[距离雾](../docs/SCENE3D.md#距离雾)。

### 通用粒子场（0.1.0 之后的工作树）

`supportsStudioCoreScene3DParticles()` 检查可选 `viento_core_scene3d_particles_version() === 1`。scene3d schema 1／plan 1 的可选 `particleField` 具有完整 center／extent／velocity／size／color／count／seed，严格拒绝额外或缺失字段。缺省保持缺省，count=0 关闭。

`prepareScene3DParticleField(field)` 调用 `scene3d.prepareParticleField`，返回冻结 `{field, phases}`。phases 为 count×3 的精确 float32 数组；Rust 以 seed XOR 0x9e3779b9（零状态改用 0x6d2b79f5）运行 u32 xorshift32 13/17/5，每分量取高24位除以16777216。`sampleScene3DParticleField(field,timeSeconds)` 调用 `scene3d.sampleParticleField`，返回冻结 `{timeSeconds, offset}`，时刻限 0–3600；偏移为各轴 `(velocity*time/extent).rem_euclid(1)`。归一化坐标为 `fract(phase+offset)`，位置为 `center+extent*(coordinate-.5)`。桥接验证回执，不提供缺能力的 JS 采样替代。

两个纯操作的回复容器为 `scene3dParticles`；不取得时钟、I/O 或渲染权限。宿主拥有时刻，GPU 适配器负责实例绘制。环境补丁接受完整 `values.particleField`；首次规范插入路径 `/particleField`，已有组件只替换净变化叶值。与雾同时新增时按 fog、particleField 顺序插入；桥接先绑定规范插入片段，再验证原 token／间隙及重解析模型，其余字节不变。字段范围和交互见[通用粒子场](../docs/SCENE3D.md#通用粒子场)。

`source-indentation.mjs` 提供与语言和浏览器无关的规范 LF 原文缩进规划、UTF-16 选区映射及初始缩进提示。DOM 层采用原生文本事务以沿用撤销，普通正文保存保留原有序列化和冲突处理；不自动格式化或执行脚本。

`source-position.mjs` 的 `createSourceLineIndex(text)` 接受至多 4 Mi UTF-16 码元的规范 LF 文本，返回冻结的 `length`、`lineCount`、`position(offset)` 和 `lineRange(line)` 接口。位置从 1 开始，偏移及列使用 UTF-16；首个 BOM 不计列，第一行可导航起点越过 BOM。换行符属于前一行，末尾 LF 产生可定位的空行。索引内部保存有界行起点，查询不暴露可变存储，非法输入返回 `source_position_invalid`；不读取文档、DOM、保存状态或后端。

`source-diagnostic.mjs` 的 `createSourceDiagnosticSnapshot(input)` 返回脱离输入对象的冻结展示快照：来源路径、字段、修订、代码、级别、消息键、原始详情和定位状态。仅 `exact` 状态可携带已转换的 LF／UTF-16 范围；输入只允许普通数据属性，各字段有独立预算，不接受构建任务、访问器、函数或执行权限。它不计算源码摘要或判断错误是否解决：版本及字符边界由来源宿主核对，视图另核对当前文本范围。首次面板消费者见[诊断说明](../docs/SCENE_BEHAVIORS.md#原文诊断上下文)。

## 字面源码查找与替换规划

`source-search.mjs` 独立于语言、文件系统和界面。`findSourceMatches({ text, query, matchCase })` 返回冻结的非重叠 UTF-16 区间，空查询返回空数组；`matchCase` 默认 true，关闭后采用保留原始偏移的 Unicode 简单大小写匹配。

`planSourceReplacement({ text, query, replacement, matchCase, selectionStart, selectionEnd, all })` 返回冻结的 `changed/start/end/replacement/selectionStart/selectionEnd/count`。单处模式要求选区恰好是一处匹配；全部模式合成最小包围区间，保留各匹配之间的正文。替换值始终为字面内容。没有净变化时不要求宿主创建编辑事务。

原文需为 LF 文本，输入及输出最多 4 Mi UTF-16，查询 4096、替换输入 65536 码元，非重叠匹配最多 10000 处。非法输入报告 `source_search_invalid`，匹配或输出预算超限报告 `source_search_limit`；不返回可误认为完整结果的截断列表。宿主负责来源和当前文本守护、浏览器原生事务及普通保存；此模块不验证磁盘修订。

## 当前任务诊断快照与筛选

`project-problems.mjs` 提供 `createProjectProblemsSnapshot({task, diagnostics})` 与 `filterProjectProblems(snapshot, {severity, query, messages})`。前者输出冻结的 `{task, rows}`，每行保留原始零基 `index`；后者返回 `{rows, total, matched, counts}`，严重度统计始终基于完整快照。`messages` 可选，按全部行顺序传入当前语言消息。检索为 Unicode 忽略大小写的字面子串，不跨字段拼接；原始顺序与重复项保留。

最多 256 行；纯核心查询最多 4096 UTF-16（界面限制 512），消息键 2000、翻译 4000、详情 8192、路径 4096、字段路径 2048。任务身份为有界标量；来源范围要求 UTF-16 整数边界、原始字段路径、显式 exact 与 SHA-256 修订，实际字符边界及当前修订由读取原文的宿主核对。缺失标量由适配器显式提供空字符串，无范围时省略 `sourceRange`；畸形记录、getter、稀疏数组、超限或无效来源均抛出 `project_problems_invalid`。筛选复验序列化快照，无模块私有品牌要求，便于后续原生适配。


## 配方到独立运行场景

`scene-composition-materialize.mjs` 以来源原文、登记投影、保存态预览和读取后的 World 修订规划独立 Scene2D。摘要由调用方注入，展开仍归共享 Rust 核心；生成新场景的命令复用 `scene.create`，原配方和元数据不写入。界面只编排读取、审阅、保存及结果核对，不把引擎或渲染依赖引入规划层。具体使用与边界见[配方指南](../docs/SCENE_COMPOSITION.md#从配方创建运行场景)。

项目内运行的独立模块：`project-runtime-contracts.mjs` 约束身份、访问与事件预算；`project-runtime-events.mjs` 按访问复用既有场景／行为／音频读取器；`project-runtime-query.mjs` 将当前对象与访问历史组合为只读视图。它们不加载引擎、不编辑作者文件，Godot 元数据请求接口和节点清理由后端实现；具体边界见[项目内切换](../docs/PROJECT_ASSEMBLY.md#运行中切换场景)。

`project-audio-commands.mjs` 保存有界的实际控制回执；项目协议 4 从冻结行为与音轨分别解析来源，查询保留跨访问历史。它不推断设备播放状态，不取得播放器或作者写入权限。声音声明与空时间线仍由 Rust 校验。

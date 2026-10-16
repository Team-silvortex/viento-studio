# 二维功能对接表

**0.1.5 收录说明**：[本版源码](RELEASE_0.1.5.md)收录已有声音的时间提示编排、轨道管理、已绑定素材选择、就地试听及暂停／定位，以及行为文本参数中的音轨选择。读取、试听、表单修改与普通保存保持独立。下文开发阶段及专题证据保留原时点；源码发布不代表已更新安装或设备验收。

**0.1.4 收录说明**：[本版源码](RELEASE_0.1.4.md)已收录首次声音创建与逐轨触发方式、项目组装与场景切换、共享状态、项目事件和行为声音控制。当前为 **21 模块／40 项声明能力**，Godot **0.11.0**、项目协议 **4**；旧段落与验收数字保留各自执行时点，本次未更新安装。

**0.1.4 后工作树：试听进度与控制**：`scene.audio_audition` 沿用既有实现和绑定，新增当前素材的进度、暂停／继续与定位；声音文档、场景 cues 和后端运行各自独立。操作见[就地试听](SCENE_AUDIO.md#就地试听音轨素材)，本轮证据见[试听控制专题](test-results/scene-audio-audition-transport/README.md)。

**此前 0.1.4 后工作树：选择已绑定的声音素材**：先通过现有 **世界与对象 → 绑定资源** 为声音文档绑定已登记 WAV，再在 **编辑场景声音** 显式读取已绑定素材并选择音轨的新素材。资源目录与来源修订复核独立于保真正文提案；修改经审阅后仅应用普通草稿，再普通保存。旧四种提案契约保持；单独替换素材时保留轨道身份与提示引用。目录读取不验证实际 PCM／哈希，构建继续检查资源字节；素材绑定与正文保存是两次独立操作。验证见[素材选择专题](test-results/scene-audio-resource-selection/README.md)。

**此前 0.1.4 后轨道复制与移除切片**：[已有声音的轨道管理](SCENE_AUDIO.md#复制与移除已有声音轨道)支持复制当前轨道设置，生成独立轨道身份并复用同一素材，不复制时间提示。保持 1–16 条轨道；移除前需先移除或改接当前提示，行为脚本中的轨道 ID 由作者另行检查。新 `createSceneAudioTrackProposal` 只复用原文已使用的资源，保留已有轨道资源与相对顺序，新轨道追加；旧三种提案契约、普通草稿／保存、Rust ABI 和模块／后端版本保持。验证另见[轨道编辑专题](test-results/scene-audio-track-authoring/README.md)。

**此前 0.1.4 后提示换轨与顺序切片**：[声音提示编排](SCENE_AUDIO.md#调整提示目标轨道与顺序)支持将提示改为当前文档中另一条已声明轨道，并用 **上移／下移** 调整作者列表。播放仍先按时间排序，同刻按列表顺序执行；提示身份、轨道资源及普通草稿／保存边界保持。新 `createSceneAudioTimelineProposal` 独立扩展编排，两种旧提案 API 保持原契约；Rust ABI、模块／能力和后端版本不变。验证范围见[换轨与顺序专题](test-results/scene-audio-cue-arrangement/README.md)。

**此前 0.1.4 后提示增删切片**：[已有声音的时间提示编辑](SCENE_AUDIO.md#增删已有声音的时间提示)支持在独立面板添加或移除 0–64 条提示，保留既有轨道与资源绑定、旧提示身份和相对顺序；新提示追加。检查完整原文后应用普通草稿并保存，Rust 语义／ABI、模块／能力和后端版本保持。验证范围见[提示编辑专题](test-results/scene-audio-cue-authoring/README.md)。


**0.1.3 收录说明**：本页标为 0.1.2 后工作树的多行为、脚本引用、Bevy Rust 与声音增量现已纳入[本版源码](RELEASE_0.1.3.md)。历史版本、模块数和验收条件保留原时点；0.1.3 收录时为 21 模块／38 项声明能力，该次未制作或更新安装包。

当前源码版本为 0.1.4；其后工作树已接通提示增删、换轨与上移／下移，随后接入同资源轨道复制／移除与已绑定素材选择，独立素材试听进一步支持进度、暂停／继续与定位；行为参数现可显式选入已保存场景的音轨编号。本页说明当前二维工作流如何交接。功能身份、实现绑定和评分以 [功能图谱 JSON](function-atlas.json) 为准；这里不另设总分或完成率，也不把引擎原生能力当作 Studio 已接入能力。

[空工程到 Godot](function-atlas.html#workflow=oc-projection-composition-runtime) · [普通二维主线](function-atlas.html#workflow=author-to-delivery) · [配方到工程交付](function-atlas.html#workflow=composition-to-delivery) · [配方与 Godot 行为](function-atlas.html#workflow=composition-godot-behaviors) · [Bevy 数据交付](function-atlas.html#workflow=bevy-data-delivery) · [Bevy Rust 固定步与交付](function-atlas.html#workflow=bevy-rust-fixed-step-delivery) · [场景声音到工程交付](function-atlas.html#workflow=scene-audio-to-delivery) · [项目行为声音控制](function-atlas.html#workflow=project-audio-controls-to-delivery)

## 从入口到实现

| 阶段 | 内置入口与数据交接 | 实现归属与边界 |
| --- | --- | --- |
| 设定 | 普通文档／字段编辑；世界与对象创建、登记稳定身份 | `authoring.document-edit`、`world.object-create`；原文、登记和素材继续是作者数据 |
| 设定投影 | 从同一 OC 创建多份用途投影，保存后供实例引用 | `projection.authoring`；投影是独立文档，实例可继承或明确覆盖其运行字段 |
| 普通二维场景 | 构建与运行中的创建／编辑场景，默认稳定实例，可启用逻辑分组 | `scene.instances_v2`、`scene.groups_v3`；[`scene.create/update`](../engine/world-scene-create.mjs) 负责作者事务。逻辑分组不隐式变换位置 |
| 配方创作 | 新建场景配方 → 多演员对象／投影清单 → 可选起始排布 → 完整 JSON 审阅 → 普通草稿与保存；九个独立编辑区继续丰富 | `scene.composition_create`、`scene.composition`、`scene.authoring_workflow`；只读目录、Rust 校验、独立助手与普通保存分别负责 |
| 配方转运行场景 | 场景预览 → 从配方创建场景 → 审阅完整展开内容 → 保存新的 Scene2D | `scene.composition_materialize`；Rust 展开、JS 创建规划、独立对话框和共享创建事务分开。原配方不改写，生成场景不自动同步 |
| 脚本与行为（可选） | TXT 草稿 → 普通保存；首次行为清单审阅／保存，或管理已有行为 → 审阅／保存脚本引用 → 打开行为原文 → 独立绑定编辑 → 普通保存 | `script.authoring`、`behavior.creation`、`behavior.authoring` 与既有 `relation.add`；首次清单和已有引用管理属于 0.1.2 后工作树。关联只改登记，绑定编辑只改草稿；显式声明 Godot/GDScript 或 Bevy/Rust，执行能力由对应宿主后端核对 |
| 场景声音（可选） | 已保存场景 → 场景声音设置 → 选择 WAV 和 1–16 条轨道 → 审阅／一次保存正文与登记 → 打开原文 → World 绑定素材（按需）→ 已绑定素材选择、轨道复制／移除及字段调整 → 提示增删／换轨／上移下移 → 审阅／普通保存 | 首次创建由独立 `audio.create` 和三文件事务负责；已有 `scene.audio_timeline`、`scene.audio_authoring` 保持 Rust 规则与草稿编辑边界。1–16 轨支持复制／有 cue 引用保护的移除，并可显式读取已绑定 WAV 后选择新素材；绑定保存与正文保存分开，旧登记绑定保留，行为 ID 由作者维护；0–64 提示按时间优先、同刻列表执行，编辑不自动播放 |
| 行为音轨选择（可选） | 已保存声音声明 → 编辑场景行为 → 读取场景音轨 → 为文本参数选择并填入 UUID → 审阅／草稿／普通保存 | 独立只读目录检查场景与声音登记，不读取 WAV 或运行完整构建规划；来源宿主核对两份目录的场景修订。所选值沿用普通字符串规则，不新增引用关系、脚本语义或持续引用保护；API 可用性不是新的 Studio 声明能力 |
| 素材试听（可选） | 编辑场景声音 → 读取已绑定素材 → 所选轨道试听／暂停／继续／定位／停止 | `scene.audio_audition`；纯准备核对新目录和本次 size／hash／PCM，受限 GET 沿稳定资源身份读取，WebAudio 按当前音量／循环播放一份素材，进度与暂停／继续／定位复用验证快照；不执行 cues 或保存，32 MiB 文件与 128 MiB 解码估算各自限额 |
| 静态预览（可选） | 场景预览可读取保存态或当前有效草稿 | `scene.saved_preview` 与草稿预览切片；预览不执行脚本，也不证明后端运行效果 |
| 项目组装 | 构建与运行 → 项目组装 → 成员与启动场景 → 审阅／保存 | `build.project_assembly`；正文 UUID 成员派生迁移依赖，Godot 合并工程，其他后端明确拒绝 |
| 项目行为声音 | 已有音轨与绑定 → 事件声音脚本或直接请求 → 项目运行 → 声音控制记录及双方回源 | `runtime.project_audio_controls`；Rust 允许空时间提示，Godot 独立排队执行，可移植核心校验实际命令回执，UI 不取得播放器 |
| 计划与构建 | 已保存 Scene2D 或项目组装 → 检查计划 → 显式构建 | `build.snapshot_plan`、`execution.backend_middleware`、`build.workbench_lifecycle`；中立计划通过具体后端能力准入，再冻结依赖和工具身份 |
| 运行与诊断 | 显式无头测试／受支持的窗口预览；观察事件和任务问题，核对来源后打开原文 | `runtime.godot_generated_project` 或 `runtime.bevy_rust`；`build.task-problems` 保留单任务来源，修改后需要明确重验 |
| 工程管理 | 后端工程详情、文件核对、持久列表与显式运行选择 | `backend.project_management`、`backend.project_catalog`；生成工程和本机缓存不回写作者工程 |
| 工程交付 | 交付工程 → 准备包 → 下载／保存 | `backend.project_delivery`；仅打包成功登记且库存校验通过的生成文件。完整作者迁移另走作品备份，独立游戏发行仍是规划项 |

行为音轨选择的操作见[行为指南](SCENE_BEHAVIORS.md#将音轨编号填入行为参数)，证据单列[专题记录](test-results/scene-behavior-audio-picker/README.md)；没有目录端口的宿主保留普通参数编辑。本次未增加 Rust ABI、作者格式、后端版本、安装或设备验收。

各阶段是可选择的业务路线，不是必须逐个调用的接口序列，也不是覆盖整条链路的一次原子事务。无行为场景可直接进入构建；首次创建、已有脚本引用管理及绑定正文编辑分别拥有各自的审阅与保存边界。

## 当前后端映射

以下按 [Godot 适配器](../scripts/backends/godot4-adapter.mjs)、[Bevy 数据适配器](../scripts/backends/bevy-adapter.mjs) 与 [Bevy Rust 适配器](../scripts/backends/bevy-rust-adapter.mjs) 的能力声明核对。宿主服务当前固定一个执行后端；行为创建中的后端选项只写作者声明，不切换宿主。

| 对接能力 | Godot 4 | Bevy 数据通道 | Bevy Rust 通道（工作树） |
| --- | --- | --- | --- |
| 后端标识 | `org.viento.godot4` | `org.viento.bevy` | `org.viento.bevy-rust` |
| 无行为二维计划 | plan 1／2 | plan 1／2，仅无图 | 当前仅接行为 plan 3 |
| 作者 Scene2D v3 逻辑分组 | 保留组织结构；无行为时生成 plan 2 | 同样生成无图 plan 2 | 有行为时生成无图 plan 3；组不是空间变换 |
| 多场景组装／启动场景 | project plan 1；成员保留各自 plan 1／2／3 | 未接入，明确拒绝 | 未接入，明确拒绝 |
| 图片资源 | 已接入 | 未接入，明确拒绝 | 未接入，明确拒绝 |
| 非空间音轨与时间提示 | 适配器 0.11.0，保留原声音子协议 1；1–16 音轨、0–64 提示、PCM16 WAV、0–60 秒 play／stop、独立音量与循环 | 未接入，明确拒绝 | 未接入，明确拒绝 |
| 项目行为播放／停止音轨 | `project.audio-control`，项目协议 4；访问内请求队列、实际回执及行为／音轨双来源 | 未接入，明确拒绝 | 未接入，明确拒绝 |
| 参数／信号和作者脚本 | GDScript Node，plan 3 | 未接入作者代码 | Rust `ready`、显式固定步自身位置、类型化参数和映射事件，plan 3 |
| 无头逻辑运行 | 已接入 | 可信固定运行程序 | 冻结 Cargo 源码临时编译与有界测试 |
| 有限控制回放与按实例输入 | 无行为 plan 1／2；按实例输入限 plan 2；当前拒绝声音组合 | 同范围 | 未接入 |
| 独立窗口预览／截图 | 已接入具体能力 | 未接入 | 未接入 |
| 嵌入运行视口／GPU 计算接口 | 尚未声明 | 尚未声明 | 尚未声明 |
| 工程交付内容 | `project.godot`、场景、脚本及图片／WAV 资源 | `scene-data.json` 数据工程 | Cargo 源码／锁文件，不含二进制或 `target` |
| 接收方需求 | 兼容的 Godot 工具 | 匹配的可信 Bevy 运行程序 | 匹配 Rust 工具链与已缓存锁定依赖 |

**作者格式版本与运行计划版本属于不同接口。** 作者场景使用 v3 组织分组，并不表示使用运行 plan 3；目前显式行为才进入 plan 3。静态二维／三维预览能力也不能推导出相同的运行后端支持。

## 映射出的下一步

[场景声音](SCENE_AUDIO.md)与[项目行为声音控制](PROJECT_AUDIO_CONTROLS.md)已分别接入；当前为 21 模块／40 项声明能力。作者使用 1–16 条轨道和 0–64 个有限时间提示，空提示支持纯行为触发；Godot 执行并交付实际 PCM WAV。0.1.4 后工作树在既有 `scene.audio_authoring` 先增加提示添加／移除，随后支持目标换轨与显式上下移动；复用原实现和绑定，2136 个评分对象保持。旧增删 API 和[原证据](test-results/scene-audio-cue-authoring/README.md)保持，换轨／顺序另见[编排专题](test-results/scene-audio-cue-arrangement/README.md)。此前同资源轨道复制与移除继续复用此功能及实现，旧三种 API 的轨道范围保持，证据独立存于[轨道专题](test-results/scene-audio-track-authoring/README.md)。此前素材选择同样复用该功能、实现和绑定，证据见[素材选择专题](test-results/scene-audio-resource-selection/README.md)；World 绑定、普通正文保存和构建音频验证保持独立，不增加图谱坐标或评分。此前素材试听独立登记 `scene.audio_audition`，新增 3 个实现并复用来源宿主／表单共 5 个绑定；图谱为 128 功能／355 实现／539 绑定／2156 单元／90 工作流，原 2136 个评分对象完整保留。新增 20 格按实现 4／验证 3／解耦 4／交付 2 记录，试听作为既有声音工作流中的可选步骤，不成为构建前置条件。声音声明编辑、素材试听、项目控制与只读观察保持各自边界。本轮进度、暂停／继续和素材定位扩展既有 i354 播放器与 i315 表单，2156 个评分对象保持；证据见[试听控制专题](test-results/scene-audio-audition-transport/README.md)。总线、空间音频、场景运行时暂停／跳转、自然结束观察和 Bevy 声音仍为后续范围。

新建配方助手 `scene.composition_create` 已纳入 0.1.2 源码，初始一片段／1–64 演员／一放置；已有编辑区负责后续结构。横排／竖排／网格只修改起始表单坐标，预览、应用与撤销独立于普通保存。操作与范围见[创建指南](SCENE_COMPOSITION.md#新建场景配方)。

0.1.2 之后工作树将首次行为创建扩展为 1–32 个绑定、最多 8 份去重脚本；同实例多行为与同脚本多实例均可显式配置，参数和信号仍在独立行为编辑器设置。它复用原三文件事务，该清单扩展保持 20 模块／37 项声明能力，未增加后端或协议；本轮 Rust 执行适配器是后续独立增量。当前主线沿“二维场景 → 实例行为组合 → 不同玩法 → 工程交付”推进，同一 OC 的不同投影和绑定清单可以各自演进；既有清单新增脚本引用现可从[管理已有行为](SCENE_BEHAVIORS.md#管理已有行为)独立审阅并保存，再进入绑定编辑；只读目录最多提供 256 个、每份至多 64 KiB 的已登记 TXT。缺失或歧义关系拒绝操作，不从模板或执行后端推断。

- **Bevy 作者 Rust 行为**：`behavior.bevy_rust` 的首个工作树切片已用独立 `org.viento.bevy-rust` 适配器接入；旧数据运行程序保持不编译作者源码。固定步增量单列 `behavior.bevy_fixed_step`；当前闭环包含 `ready`、固定两步自身位置驱动、标量参数和映射事件；回调注册、单次提交和累计事件预算在独立 Rust 运行实现内维护。图片、控制回放、连续运行及热更新仍需独立契约和验证。工具配置与交付边界见[Bevy 指南](BEVY_BACKEND.md#rust-作者行为通道012-后工作树)。
- **独立游戏发行**：`build.standalone_distribution`。工程 ZIP 已能迁移，但仍需引擎工具；目标平台导出和无开发引擎环境运行尚未接入。
- 现有绑定的引用移除／迁移、空间父子变换、跨视图历史、跨文件配方及大规模性能仍按各功能的“下一步”单独审查，不由这些缺口穷举。

工作流的 `gaps` 只列本次明确登记的额外缺口。旧工作流没有该字段表示尚未梳理，不能解释为没有缺口；显式空数组也只表示这次没有登记额外项。缺口单独展示，不会进入已经接通的阶段计数或继承相邻实现的评分。

## 验证边界与图谱维护

声音的 Rust／WASM、保真叶补丁、编辑来源守护、计划与 PCM 冻结、真实 Godot 混音和工程交付分别见[声音专题](test-results/scene-audio/README.md)。缓冲区捕获证明引擎产生了样本，未验证物理扬声器；不据此推导 Bevy 声音、安装或 Android 设备支持。

Bevy Rust 作者行为首轮验证见[独立专题](test-results/bevy-rust-behaviors/README.md)，后续固定步位置／事件验证见[固定步专题](test-results/bevy-rust-fixed-step/README.md)。两者不从旧数据通道或 Godot 报告推导；本轮未更新安装包。

首次行为多绑定／多脚本与已有脚本引用管理分别见[创建专题](test-results/scene-behavior-multi-create/README.md)和[关联专题](test-results/scene-behavior-links/README.md)。旧的单绑定创建、行为编辑与运行证据继续按原条件阅读，本轮未更新安装包，也不据这些源码入口推导设备验收结果。

新建配方首版的独立证据见[创建验收](test-results/scene-composition-create/README.md)，多演员增删、混合继承与运行另见[多演员验收](test-results/scene-composition-multi-create/README.md)，起始排布见[排布验收](test-results/scene-composition-create-layout/README.md)。上一轮[Linux 安装验收](test-results/native-installed-0.1.1/README.md)覆盖保存态配方的后续链路；新创建助手尚未重新打包安装。各记录分别保留起点和实际运行平台。

[二维实测](test-results/two-dimensional-workflow/README.md) 的连续浏览器起点是服务夹具准备的已登记配方：界面创建独立场景、TXT 脚本和行为后，真实 Godot 无头运行、工程 ZIP 下载和异地导入通过。它不证明上游 OC／投影／配方全程 GUI、图形游戏体验、Bevy 作者行为或安装设备验收。Bevy 的已有验证仍以其独立专题为准。

前一轮映射工作只完善目录、依赖关系、步骤／缺口阅读与定位工具，没有增加引擎能力，也没有重跑上述历史产品测试。新增工具测试和真实离线浏览器验证见 [功能映射验证记录](test-results/functional-mapping/README.md)。原有评分、证据和旧 F01–F50 网络保持；本轮有意修订的说明、优先项和依赖边见 [映射审查记录](test-results/functional-mapping/catalog-review.json)。

依赖图统一采用 **前置能力 `from` → 使用者 `to`**。仅表示可选后续操作的关系放进工作流，不作为所有使用者必需的前置条件。新增能力先登记唯一功能身份，再关联实现与证据；图谱检查通过只证明引用和派生文件一致，不证明人工评分正确或功能已经验收。

首次添加声音的目录、资源核验、三文件恢复、独立界面和浏览器运行／工程交付另见[本轮验收](test-results/scene-audio-creation/README.md)。已有作品与旧验收记录保留原字节。

项目行为声音的纯回执准入、Rust 空提示、实际 Godot 播放／停止、双来源导航与异地工程验证见[本轮专题](PROJECT_AUDIO_CONTROLS.md)。图谱新增 `runtime.project_audio_controls`，只为本轮新增绑定评分；旧声音与项目事件单元保留原证据和对象，不把命令回执当成持续播放、安装或物理扬声器验收。

# 二维功能对接表

本表按 **设定 → 投影 → 场景实现 → 项目组装 → 构建运行 → 工程交付** 追踪当前入口与实现边界。当前源码为 **0.2.6**，已收录调度时钟、因果锚点、业务帧、媒体请求与事件位置观察，运行记录和有限执行预算分别维护，本机安装仍为 **0.2.0**。具体交付与平台范围见[状态页](STATUS.md)，旧增量前言与历史判断见[归档](history/function-mapping-2d-2026-10-25.md)。

首次操作读[项目工作流](PROJECT_WORKFLOW.md)和[构建指南](PROJECT_BUILD.md)。本页分为[入口交接](#从入口到实现)、[后端支持](#当前后端映射)、[明确缺口](#映射出的下一步)和[验证边界](#验证边界与图谱维护)。功能身份、实现绑定与评分以[功能图谱](FUNCTION_ATLAS.md)及[JSON](function-atlas.json)为准；这里不另设总分、完成率，也不把引擎原生能力视为 Studio 已接入能力。

[空工程到 Godot](function-atlas.html#workflow=oc-projection-composition-runtime) · [普通二维主线](function-atlas.html#workflow=author-to-delivery) · [配方到工程交付](function-atlas.html#workflow=composition-to-delivery) · [Bevy 数据交付](function-atlas.html#workflow=bevy-data-delivery) · [Bevy Rust 固定步与交付](function-atlas.html#workflow=bevy-rust-fixed-step-delivery) · [场景声音](SCENE_AUDIO.md) · [场景动画](SCENE_ANIMATION.md) · [场景物理](SCENE_PHYSICS2D.md)

## 从入口到实现

| 阶段 | 内置入口与数据交接 | 实现归属与边界 |
| --- | --- | --- |
| 设定 | 普通文档／字段编辑；世界与对象创建、登记稳定身份 | `authoring.document-edit`、`world.object-create`；原文、登记和素材继续是作者数据 |
| 设定投影 | 从同一 OC 创建多份用途投影，保存后供实例引用 | `projection.authoring`；投影是独立文档，实例可继承或明确覆盖其运行字段 |
| 普通二维场景 | 构建与运行中的创建／编辑场景，默认稳定实例，可启用逻辑分组 | `scene.instances_v2`、`scene.groups_v3`；[`scene.create/update`](../engine/world-scene-create.mjs) 负责作者事务。逻辑分组不隐式变换位置 |
| 配方创作 | 新建场景配方 → 多演员对象／投影清单 → 可选起始排布 → 完整 JSON 审阅 → 普通草稿与保存；九个独立编辑区继续丰富 | `scene.composition_create`、`scene.composition`、`scene.authoring_workflow`；只读目录、Rust 校验、独立助手与普通保存分别负责 |
| 配方转运行场景 | 场景预览 → 从配方创建场景 → 审阅完整展开内容 → 保存新的 Scene2D | `scene.composition_materialize`；Rust 展开、JS 创建规划、独立对话框和共享创建事务分开。原配方不改写，生成场景不自动同步 |
| 脚本与行为（可选） | TXT 草稿 → 普通保存；首次行为清单审阅／保存，或管理已有行为 → 审阅／保存脚本引用 → 打开行为原文 → 独立绑定编辑 → 普通保存 | `script.authoring`、`behavior.creation`、`behavior.authoring` 与既有 `relation.add`；关联只改登记，绑定编辑只改草稿；显式声明 Godot/GDScript 或 Bevy/Rust，执行能力由对应宿主后端核对 |
| 物理声明（可选） | 已保存场景 → 场景物理 → 审阅／一次保存正文与双向关系 → 字段修改与目标检查 → 应用草稿／普通保存 → 项目组装 | `scene.physics2d`、`authoring.physics2d`；声明、实例目录、保存态空间几何与后端求解分离。空间图支持查看／选择、偏移和尺寸手势；几何修改仍需检查、审阅、应用与普通保存，不移动场景实例 |
| 动画轨道与片段（可选） | 已保存场景 → 首次创建动画 → 按名选实例／编辑关键帧与片段 → 检查／审阅／普通保存 → 保存态画面预览 | `scene.animation2d` 与独立编辑、目录和采样实现；资源归场景／投影，视觉变化不改逻辑位置或物理形状 |
| 动画运行范围（可选） | 动画表单 → 明确整场景／逐实例 → 检查／审阅／普通保存 → 项目组装构建 | 动画 schema 4 的 `playbackScope` 决定真实运行目标；保存态预览中的临时范围单独维护。逐实例初始停止，脚本控制所属实例；同实例多控制器仍无所有权仲裁 |
| 动画状态表（可选） | 新建脚本 → Godot / 动画状态表 → 初始状态／事件与完成转换 → 精确源码审阅 → 普通 TXT 保存 → 行为片段参数 → 项目运行与工程 ZIP | `authoring.animation_state_script`；Rust 验证并建立索引、独立 GDScript 发射器生成、UI 编辑本次创建表格。生成后普通源码可编辑，带版本声明且源码精确匹配时可重新打开表格；运行范围由动画文档显式选择，整场景共享或按实例独立 |
| 脚本使用位置（可选） | 已保存 TXT → 查看跨场景登记引用与绑定 → 精确原文快照 → 主编辑器定位 → 显式修复／普通保存 → 刷新查询 | 只读目录、来源宿主与窗口分离；不扫描动态代码或未登记依赖，不自动迁移其他绑定 |
| 脚本参数接口修复（可选） | 保存状态表变化 → 打开行为绑定 → 接口提示／显式补齐或更名保留值 → 检查／应用草稿／普通保存 → 项目运行 | 通用标量接口与源码 provider、表单助手分离；只修当前绑定，不推断任意脚本或跨工程迁移 |
| 事件载荷条件（可选） | 事件转换 → 类型/比较/值 → Rust准入 → v2源码审阅 → 普通保存 → Godot与工程ZIP | 严格标量类型、精确数字、不匹配忽略；原v1保留，无条件可明确恢复；条件不是绑定参数 |
| 状态转换图（可选） | 新建／重编辑表格 → 展开静态图 → 选择状态／转换 → 定位字段 → 原有源码审阅与保存 | 复用Rust检查与稳定索引，图投影／布局／视图分离；图操作不修改表格或撤销审阅，不表示运行中的活动状态 |
| 状态规则试算（可选） | 当前状态表 → 显式事件／完成与共享状态样本 → 单步或连续试算 → 导出／编辑／重跑手动预期用例 | 纯规则求值、用例解析与表单各自负责；不执行引擎、推进真实播放头或把实际结果自动写为预期 |
| 状态表再次编辑（可选） | 已保存 TXT → 编辑动画状态表 → 修改转换／审阅参数增删及完整源码 → 应用当前草稿 → 普通保存 → 项目运行 | 同文件版本声明、固定生成器比对、来源提案、宿主与视图分别负责；手改或未知版本拒绝表格覆盖，不自动迁移行为参数 |
| 动画完成衔接（可选） | 新建普通完成脚本 → 绑定／按名填入前后片段 → 审阅与保存 → 项目运行 → 独立完成记录及三类来源导航 → 工程 ZIP | `runtime.project_animation_completion`；Rust transport 核验自然结束，可移植账本、Godot 完成投递、普通脚本和只读 UI 各自负责。循环、手动定位或停止不触发自然完成；新动画命令或离场使旧通知失效 |
| 动画轨道复制（可选） | 编辑场景动画 → 已读取有效实例目录 → 显式选择源轨道／目标实例 → 复制 → 检查／审阅 → 普通草稿与保存 | Rust `sceneAnimation.copyTrack` 保留源轨道，只替换新轨道身份和目标后追加；父编辑器复用现有目录验证新目标，不读取图片或新增绑定。无目录或可选 marker 时保留普通字段编辑；同目标／属性和预算冲突不产生部分修改 |
| 动画整段时长（可选） | 编辑场景动画 → 目标时长（秒）→ 按比例调整时长 → 重新检查／审阅 → 普通草稿与保存 | Rust `sceneAnimation.retime` 只变换时间；JS 严格捕获当前未保存表单，独立界面不获得保存或播放权限。全部不同时间须保持先后，失败／无变化不撤销已有审阅；无可选 marker 时保留普通编辑 |
| 场景声音（可选） | 已保存场景 → 场景声音设置 → 选择 WAV 和 1–16 条轨道 → 审阅／一次保存正文与登记 → 打开原文 → World 绑定素材（按需）→ 已绑定素材选择、轨道复制／移除及字段调整 → 提示增删／换轨／上移下移 → 审阅／普通保存 | 首次创建由独立 `audio.create` 和三文件事务负责；已有 `scene.audio_timeline`、`scene.audio_authoring` 保持 Rust 规则与草稿编辑边界。1–16 轨支持复制／有 cue 引用保护的移除，并可显式读取已绑定 WAV 后选择新素材；绑定保存与正文保存分开，旧登记绑定保留，行为 ID 由作者维护；0–64 提示按时间优先、同刻列表执行，编辑不自动播放 |
| 行为音轨选择（可选） | 已保存声音声明 → 编辑场景行为 → 读取场景音轨 → 为文本参数选择并填入 UUID → 审阅／草稿／普通保存 | 独立只读目录检查场景与声音登记，不读取 WAV 或运行完整构建规划；来源宿主核对两份目录的场景修订。所选值沿用普通字符串规则，不新增引用关系、脚本语义或持续引用保护；API 可用性不是新的 Studio 声明能力 |
| 素材试听（可选） | 编辑场景声音 → 读取已绑定素材 → 所选轨道试听／暂停／继续／定位／停止 | `scene.audio_audition`；纯准备核对新目录和本次 size／hash／PCM，受限 GET 沿稳定资源身份读取，WebAudio 按当前音量／循环播放一份素材，进度与暂停／继续／定位复用验证快照；不执行 cues 或保存，32 MiB 文件与 128 MiB 解码估算各自限额 |
| 静态预览（可选） | 场景预览可读取保存态或当前有效草稿 | `scene.saved_preview` 与草稿预览切片；预览不执行脚本，也不证明后端运行效果 |
| 项目组装 | 构建与运行 → 项目组装 → 成员与启动场景 → 审阅／保存 | `build.project_assembly`；正文 UUID 成员派生迁移依赖，Godot 合并工程，其他后端明确拒绝 |
| 项目行为声音 | 已有音轨与绑定 → 事件声音脚本或直接请求 → 项目运行 → 声音控制记录及双方回源 | `runtime.project_audio_controls`；Rust 允许空时间提示，Godot 独立排队执行，可移植核心校验实际命令回执，UI 不取得播放器 |
| 计划与构建 | 已保存 Scene2D 或项目组装 → 检查计划 → 显式构建 | `build.snapshot_plan`、`execution.backend_middleware`、`build.workbench_lifecycle`；中立计划通过具体后端能力准入，再冻结依赖和工具身份 |
| 运行与诊断 | 显式无头测试／受支持的窗口预览；观察事件和任务问题，核对来源后打开原文 | `runtime.godot_generated_project` 或 `runtime.bevy_rust`；`build.task-problems` 保留单任务来源，修改后需要明确重验 |
| 动画运行观察（可选） | 命令、完成、逐次进入与退出快照 → 按控制器／目标回看 → 核对冻结来源 | 各类回执独立验证；触发来源可回看真实进入原因，未记录逐项条件失败、实时活动高亮或断点 |
| 工程管理 | 后端工程详情、文件核对、持久列表与显式运行选择 | `backend.project_management`、`backend.project_catalog`；生成工程和本机缓存不回写作者工程 |
| 工程交付 | 交付工程 → 准备包 → 下载／保存 | `backend.project_delivery`；仅打包成功登记且库存校验通过的生成文件。完整作者迁移另走作品备份，独立游戏发行仍是规划项 |

行为音轨选择的操作见[行为指南](SCENE_BEHAVIORS.md#将音轨编号填入行为参数)，证据单列[专题记录](test-results/scene-behavior-audio-picker/README.md)；没有目录端口的宿主保留普通参数编辑。该选择入口沿用普通参数保存；其独立专题不代表额外平台或安装验收。

各阶段是可选择的业务路线，不是必须逐个调用的接口序列，也不是覆盖整条链路的一次原子事务。无行为场景可直接进入构建；首次创建、已有脚本引用管理及绑定正文编辑分别拥有各自的审阅与保存边界。

## 当前后端映射

当前 Godot 执行适配器为 **0.22.0**，协议与生成器版本按[冻结项目内容选择](PROJECT_BUILD.md#当前项目协议选择)。以下按 [Godot 适配器](../scripts/backends/godot4-adapter.mjs)、[Bevy 数据适配器](../scripts/backends/bevy-adapter.mjs) 与 [Bevy Rust 适配器](../scripts/backends/bevy-rust-adapter.mjs) 的能力声明核对。宿主服务当前固定一个执行后端；行为创建中的后端选项只写作者声明，不切换宿主。

| 对接能力 | Godot 4 | Bevy 数据通道 | Bevy Rust 通道 |
| --- | --- | --- | --- |
| 后端标识 | `org.viento.godot4` | `org.viento.bevy` | `org.viento.bevy-rust` |
| 无行为二维计划 | plan 1／2 | plan 1／2，仅无图 | 当前仅接行为 plan 3 |
| 作者 Scene2D v3 逻辑分组 | 保留组织结构；无行为时生成 plan 2 | 同样生成无图 plan 2 | 有行为时生成无图 plan 3；组不是空间变换 |
| 多场景组装／启动场景 | project plan 1；成员保留各自 plan 1／2／3 | 未接入，明确拒绝 | 未接入，明确拒绝 |
| 图片资源 | 已接入 | 未接入，明确拒绝 | 未接入，明确拒绝 |
| 等分图集序列帧 | `animation.sprite2d`，实例已有图片、整数帧／逐帧保持 | 未接入，明确拒绝 | 未接入，明确拒绝 |
| 命名动画片段（参数按名称选入编号；动画侧查看本场景参数使用位置） | `animation.clips2d`，按 UUID 选择时间区间，曲线与素材共享 | 未接入，明确拒绝 | 未接入，明确拒绝 |
| 项目动画控制 | `project.animation-control`；完整动画或命名片段的播放／暂停／停止／定位 | 未接入，明确拒绝 | 未接入，明确拒绝 |
| 逐实例正式动画 | `animation.instances2d`；显式 schema 4／instance，要求项目组装；协议11 | 未接入，明确拒绝 | 未接入，明确拒绝 |
| 状态表生成动画脚本 | 普通 GDScript，v1–v5 完整源码匹配后可重编辑；事件、完成、载荷／共享状态与组合条件 | 尚无对应发射器 | 尚无对应发射器 |
| 动画自然完成与片段衔接 | `project.animation-completion`；独立订阅与完成记录，脚本经既有控制端口衔接 | 未接入，明确拒绝 | 未接入，明确拒绝 |
| 动画状态与来源观察 | 退出快照、逐次进入及触发来源；按控制器／动画目标只读回看 | 未接入 | 未接入 |
| 二维物理 | `physics.bodies2d`／`character2d`／`sensors2d`；静态体、方向键角色与触发区；要求项目组装 | 未接入，明确拒绝 | 未接入，明确拒绝 |
| 非空间音轨与时间提示 | 声音子协议 1；1–16 音轨、0–64 提示、PCM16 WAV、0–60 秒 play／stop、独立音量与循环 | 未接入，明确拒绝 | 未接入，明确拒绝 |
| 项目行为播放／停止音轨 | `project.audio-control`；访问内请求队列、实际回执及行为／音轨双来源 | 未接入，明确拒绝 | 未接入，明确拒绝 |
| 参数／信号和作者脚本 | GDScript Node，plan 3 | 未接入作者代码 | Rust `ready`、显式固定步自身位置、类型化参数和映射事件，plan 3 |
| 无头逻辑运行 | 已接入 | 可信固定运行程序 | 冻结 Cargo 源码临时编译与有界测试 |
| 角色停止／滑动 | schema 2 角色可选；仅实际滑动追加 `physics.character-slide2d`，旧停止声明保持 | 未接入，明确拒绝 | 未接入，明确拒绝 |
| 物理步与移动碰撞观察 | `physics.observe2d`；项目半秒测试最多256条角色样本，冻结来源、请求／实际位移及碰撞位置／法线；独立观察协议1 | 未接入 | 未接入 |
| 角色重力与跳跃 | `physics.character-motion2d`；显式schema 3角色参数，左右运动、单次着地起跳、重力／下落速度上限，沿用观察与项目协议 | 未接入，明确拒绝 | 未接入，明确拒绝 |
| 角色起跳／落地事件 | `physics.character-events2d`；实际运动信号经普通作者绑定发布项目事件，声音可按实例UUID过滤；复用事件／媒体观察 | 未接入 | 未接入 |
| 静态单向平台 | `physics.one-way-platform2d`；显式 schema 4 静态矩形 `oneWay.margin`，1–64、默认 1；Godot 0.26.0 原生固定朝上碰撞，复用运动／事件及既有协议 | 未接入，明确拒绝 | 未接入，明确拒绝 |
| 角色移动碰撞事件 | `physics.character-contacts2d`；0.2.5 通过0.28生成层支持自由平面停止／滑动及重力／跳跃角色；本步移动阻挡集合变化驱动作者事件；载荷为对方实例UUID，不等于持续几何接触 | 未接入 | 未接入 |
| 水平往返平台 | 0.2.5 收录0.30生成层 `physics.platform-motion2d`；静态矩形schema 5，偏移／速度，真实支撑的重力角色承载，起跳与下穿执行当步停止承载 | 未接入，明确拒绝 | 未接入，明确拒绝 |
| 平台端点事件 | 0.2.5 收录0.31生成层 `physics.platform-events2d`；平台行为局部起点／终点通知，每端每步合并，普通脚本转项目事件与媒体；累计发布预算保持 | 未接入 | 未接入 |
| 单向平台主动下穿 | 0.2.5 收录0.29生成层 `physics.character-drop-through2d`；角色局部请求，真实单向支撑，下一步独立例外，几何脱离或离场恢复 | 未接入 | 未接入 |
| 有限控制回放与按实例输入 | 无行为 plan 1／2；按实例输入限 plan 2；声音、动画、物理组合拒绝 | 同样限支持的无图、无行为计划 | 未接入 |
| 独立窗口预览／截图 | 已接入具体能力 | 未接入 | 未接入 |
| 嵌入运行视口／GPU 计算接口 | 尚未声明 | 尚未声明 | 尚未声明 |
| 工程交付内容 | `project.godot`、场景、脚本及图片／WAV 资源 | `scene-data.json` 数据工程 | Cargo 源码／锁文件，不含二进制或 `target` |
| 接收方需求 | 兼容的 Godot 工具 | 匹配的可信 Bevy 运行程序 | 匹配 Rust 工具链与已缓存锁定依赖 |

**作者格式版本与运行计划版本属于不同接口。** 作者场景使用 v3 组织分组，并不表示使用运行 plan 3；目前显式行为才进入 plan 3。静态二维／三维预览能力也不能推导出相同的运行后端支持。

## 映射出的下一步

当前已接通逐实例动画、状态进入来源与目标回看，以及 Godot 项目中的二维物理。空间图偏移／尺寸编辑补充作者输入方式，不增加后端能力或运行协议。下一步应分别验证以下缺口，具体优先级由[路线图](ROADMAP.md)与[图谱](FUNCTION_ATLAS.md)维护：

- **物理扩展**：当前角色可显式选择停止或滑动；当前另有[有界物理观察](SCENE_PHYSICS2D.md#查看角色的物理步与碰撞)。基础[角色重力与跳跃](SCENE_PHYSICS2D.md#配置角色的重力与跳跃)及[起跳／落地事件](SCENE_PHYSICS2D.md#用角色运动事件驱动动画与声音)也已接入。[静态单向平台](SCENE_PHYSICS2D.md#配置静态单向平台)通过普通创建后编辑、审阅原文及显式保存启用，关闭不降格式；0.2.5 已收录[主动下穿](SCENE_PHYSICS2D.md#从单向平台主动下穿)和[水平往返平台](SCENE_PHYSICS2D.md#配置水平往返平台)；持续接触事件、垂直／旋转平台、动态刚体、力／冲量、材质、关节、3D 和 Bevy 物理尚未接入。
- **动画扩展**：混合、骨骼、任意打包图集、关键帧事件、运行断点和实时状态高亮仍待独立契约；逐实例支持不意味着多个控制器自动仲裁。
- **声音扩展**：总线、空间音频、场景运行时暂停／跳转、自然结束观察及 Bevy 声音未接入；素材试听已有暂停／继续／定位，不能推导相同运行能力。
- **Bevy 作者 Rust 行为**：已有 `ready`、有限固定步自身位置、标量参数、事件与 Cargo 工程交付；图片、窗口、连续运行、热更新和项目组装仍缺契约与验证。工具配置见[Bevy 指南](BEVY_BACKEND.md)。
- **工程交付**：`build.standalone_distribution` 尚未接入；工程 ZIP 仍需对应引擎工具，目标平台导出及无开发工具环境的独立游戏运行另行开发。
- **编辑与协作**：引用移除／迁移、跨绑定批量修复、空间父子变换、跨视图撤销、跨文件配方、大规模性能和外部 IDE／LSP 接口仍需分别梳理。

工作流的 `gaps` 只列明确登记的额外缺口。旧工作流没有该字段表示尚未梳理，不能解释为没有缺口；显式空数组也只表示这次没有登记额外项。缺口单独展示，不会进入已经接通的阶段计数或继承相邻实现的评分。

## 验证边界与图谱维护

声音的 Rust／WASM、保真叶补丁、编辑来源守护、计划与 PCM 冻结、真实 Godot 混音和工程交付分别见[声音专题](test-results/scene-audio/README.md)。缓冲区捕获证明引擎产生了样本，未验证物理扬声器；不据此推导 Bevy 声音、安装或 Android 设备支持。

Bevy Rust 作者行为首轮验证见[独立专题](test-results/bevy-rust-behaviors/README.md)，后续固定步位置／事件验证见[固定步专题](test-results/bevy-rust-fixed-step/README.md)。两者不从旧数据通道或 Godot 报告推导；安装范围单独以状态页为准。

首次行为多绑定／多脚本与已有脚本引用管理分别见[创建专题](test-results/scene-behavior-multi-create/README.md)和[关联专题](test-results/scene-behavior-links/README.md)。旧的单绑定创建、行为编辑与运行证据继续按原条件阅读，不据这些源码入口推导设备验收结果。

新建配方首版的独立证据见[创建验收](test-results/scene-composition-create/README.md)，多演员增删、混合继承与运行另见[多演员验收](test-results/scene-composition-multi-create/README.md)，起始排布见[排布验收](test-results/scene-composition-create-layout/README.md)。早期[Linux 安装验收](test-results/native-installed-0.1.1/README.md)覆盖保存态配方的后续链路；该报告只证明当次安装条件，当前安装另见状态页。各记录分别保留起点和实际运行平台。

[二维实测](test-results/two-dimensional-workflow/README.md) 的连续浏览器起点是服务夹具准备的已登记配方：界面创建独立场景、TXT 脚本和行为后，真实 Godot 无头运行、工程 ZIP 下载和异地导入通过。它不证明上游 OC／投影／配方全程 GUI、图形游戏体验、Bevy 作者行为或安装设备验收。Bevy 的已有验证仍以其独立专题为准。

早期映射工作只完善目录、依赖关系、步骤／缺口阅读与定位工具，没有增加引擎能力，也没有重跑上述历史产品测试。新增工具测试和真实离线浏览器验证见 [功能映射验证记录](test-results/functional-mapping/README.md)。原有评分、证据和旧 F01–F50 网络保持；该次修订的说明、优先项和依赖边见 [映射审查记录](test-results/functional-mapping/catalog-review.json)。

依赖图统一采用 **前置能力 `from` → 使用者 `to`**。仅表示可选后续操作的关系放进工作流，不作为所有使用者必需的前置条件。新增能力先登记唯一功能身份，再关联实现与证据；图谱检查通过只证明引用和派生文件一致，不证明人工评分正确或功能已经验收。

首次添加声音的目录、资源核验、三文件恢复、独立界面和浏览器运行／工程交付另见[首次创建验收](test-results/scene-audio-creation/README.md)。已有作品与旧验收记录保留原字节。

项目行为声音的纯回执准入、Rust 空提示、实际 Godot 播放／停止、双来源导航与异地工程验证见[行为声音指南](PROJECT_AUDIO_CONTROLS.md)。图谱新增 `runtime.project_audio_controls`，只为本轮新增绑定评分；旧声音与项目事件单元保留原证据和对象，不把命令回执当成持续播放、安装或物理扬声器验收。

物理首次创建、目标目录与只读空间图见[创建](test-results/scene-physics2d-creation/README.md)、[目标选择](test-results/scene-physics2d-targets/README.md)和[空间图](test-results/scene-physics2d-space/README.md)。空间手势的开发阶段实测分别见[偏移编辑](test-results/scene-physics2d-space-edit/README.md)与[尺寸编辑](test-results/scene-physics2d-space-resize/README.md)；角色停止／滑动、旧默认兼容和异地 Godot 交付见[响应专题](test-results/scene-physics2d-response/README.md)。动画逐实例运行见[独立专题](test-results/animation-instance-runtime/README.md)；各专题保留实际浏览器、Godot 和源文件指纹条件，不替代安装程序验收。

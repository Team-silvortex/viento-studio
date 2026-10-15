# 二维功能对接表

**0.1.3 收录说明**：本页标为 0.1.2 后工作树的多行为、脚本引用、Bevy Rust 与声音增量现已纳入[本版源码](RELEASE_0.1.3.md)。历史版本、模块数和验收条件保留原时点；当前为 21 模块／38 项声明能力，本次未制作或更新安装包。

核对日期：2026-10-13；源码基线 0.1.2，配方创建／生成、查找替换和任务问题列表已纳入该版；其后未发布工作树增加首次行为多绑定／多脚本创建，以及已有行为的脚本引用管理；当前再接入独立 Bevy Rust 作者行为源工程通道、有界固定步位置／事件驱动，以及 Rust 音轨／时间提示到 Godot 播放与工程交付。本页说明当前二维工作流如何交接。功能身份、实现绑定和评分以 [功能图谱 JSON](function-atlas.json) 为准；这里不另设总分或完成率，也不把引擎原生能力当作 Studio 已接入能力。

[空工程到 Godot](function-atlas.html#workflow=oc-projection-composition-runtime) · [普通二维主线](function-atlas.html#workflow=author-to-delivery) · [配方到工程交付](function-atlas.html#workflow=composition-to-delivery) · [配方与 Godot 行为](function-atlas.html#workflow=composition-godot-behaviors) · [Bevy 数据交付](function-atlas.html#workflow=bevy-data-delivery) · [Bevy Rust 固定步与交付](function-atlas.html#workflow=bevy-rust-fixed-step-delivery) · [场景声音到工程交付](function-atlas.html#workflow=scene-audio-to-delivery)

## 从入口到实现

| 阶段 | 内置入口与数据交接 | 实现归属与边界 |
| --- | --- | --- |
| 设定 | 普通文档／字段编辑；世界与对象创建、登记稳定身份 | `authoring.document-edit`、`world.object-create`；原文、登记和素材继续是作者数据 |
| 设定投影 | 从同一 OC 创建多份用途投影，保存后供实例引用 | `projection.authoring`；投影是独立文档，实例可继承或明确覆盖其运行字段 |
| 普通二维场景 | 构建与运行中的创建／编辑场景，默认稳定实例，可启用逻辑分组 | `scene.instances_v2`、`scene.groups_v3`；[`scene.create/update`](../engine/world-scene-create.mjs) 负责作者事务。逻辑分组不隐式变换位置 |
| 配方创作 | 新建场景配方 → 多演员对象／投影清单 → 可选起始排布 → 完整 JSON 审阅 → 普通草稿与保存；九个独立编辑区继续丰富 | `scene.composition_create`、`scene.composition`、`scene.authoring_workflow`；只读目录、Rust 校验、独立助手与普通保存分别负责 |
| 配方转运行场景 | 场景预览 → 从配方创建场景 → 审阅完整展开内容 → 保存新的 Scene2D | `scene.composition_materialize`；Rust 展开、JS 创建规划、独立对话框和共享创建事务分开。原配方不改写，生成场景不自动同步 |
| 脚本与行为（可选） | TXT 草稿 → 普通保存；首次行为清单审阅／保存，或管理已有行为 → 审阅／保存脚本引用 → 打开行为原文 → 独立绑定编辑 → 普通保存 | `script.authoring`、`behavior.creation`、`behavior.authoring` 与既有 `relation.add`；首次清单和已有引用管理属于 0.1.2 后工作树。关联只改登记，绑定编辑只改草稿；显式声明 Godot/GDScript 或 Bevy/Rust，执行能力由对应宿主后端核对 |
| 场景声音（可选） | 普通 JSON／声音示例 → 登记场景 `audio` 关系和素材绑定 → 编辑场景声音 → 审阅／应用草稿 → 普通保存 | `scene.audio_timeline`、`scene.audio_authoring`；Rust 校验音轨与时间提示，表单保持场景／资源／身份固定。当前没有声音新建向导，也不自动播放 |
| 静态预览（可选） | 场景预览可读取保存态或当前有效草稿 | `scene.saved_preview` 与草稿预览切片；预览不执行脚本，也不证明后端运行效果 |
| 计划与构建 | 已保存 Scene2D → 检查计划 → 显式构建 | `build.snapshot_plan`、`execution.backend_middleware`、`build.workbench_lifecycle`；中立计划通过具体后端能力准入，再冻结依赖和工具身份 |
| 运行与诊断 | 显式无头测试／受支持的窗口预览；观察事件和任务问题，核对来源后打开原文 | `runtime.godot_generated_project` 或 `runtime.bevy_rust`；`build.task-problems` 保留单任务来源，修改后需要明确重验 |
| 工程管理 | 后端工程详情、文件核对、持久列表与显式运行选择 | `backend.project_management`、`backend.project_catalog`；生成工程和本机缓存不回写作者工程 |
| 工程交付 | 交付工程 → 准备包 → 下载／保存 | `backend.project_delivery`；仅打包成功登记且库存校验通过的生成文件。完整作者迁移另走作品备份，独立游戏发行仍是规划项 |

各阶段是可选择的业务路线，不是必须逐个调用的接口序列，也不是覆盖整条链路的一次原子事务。无行为场景可直接进入构建；首次创建、已有脚本引用管理及绑定正文编辑分别拥有各自的审阅与保存边界。

## 当前后端映射

以下按 [Godot 适配器](../scripts/backends/godot4-adapter.mjs)、[Bevy 数据适配器](../scripts/backends/bevy-adapter.mjs) 与 [Bevy Rust 适配器](../scripts/backends/bevy-rust-adapter.mjs) 的能力声明核对。宿主服务当前固定一个执行后端；行为创建中的后端选项只写作者声明，不切换宿主。

| 对接能力 | Godot 4 | Bevy 数据通道 | Bevy Rust 通道（工作树） |
| --- | --- | --- | --- |
| 后端标识 | `org.viento.godot4` | `org.viento.bevy` | `org.viento.bevy-rust` |
| 无行为二维计划 | plan 1／2 | plan 1／2，仅无图 | 当前仅接行为 plan 3 |
| 作者 Scene2D v3 逻辑分组 | 保留组织结构；无行为时生成 plan 2 | 同样生成无图 plan 2 | 有行为时生成无图 plan 3；组不是空间变换 |
| 图片资源 | 已接入 | 未接入，明确拒绝 | 未接入，明确拒绝 |
| 非空间音轨与时间提示 | 适配器 0.6.0；PCM16 WAV、0–60 秒 play／stop、独立音量与循环 | 未接入，明确拒绝 | 未接入，明确拒绝 |
| 参数／信号和作者脚本 | GDScript Node，plan 3 | 未接入作者代码 | Rust `ready`、显式固定步自身位置、类型化参数和映射事件，plan 3 |
| 无头逻辑运行 | 已接入 | 可信固定运行程序 | 冻结 Cargo 源码临时编译与有界测试 |
| 有限控制回放与按实例输入 | 无行为 plan 1／2；按实例输入限 plan 2；当前拒绝声音组合 | 同范围 | 未接入 |
| 独立窗口预览／截图 | 已接入具体能力 | 未接入 | 未接入 |
| 嵌入运行视口／GPU 计算接口 | 尚未声明 | 尚未声明 | 尚未声明 |
| 工程交付内容 | `project.godot`、场景、脚本及图片／WAV 资源 | `scene-data.json` 数据工程 | Cargo 源码／锁文件，不含二进制或 `target` |
| 接收方需求 | 兼容的 Godot 工具 | 匹配的可信 Bevy 运行程序 | 匹配 Rust 工具链与已缓存锁定依赖 |

**作者格式版本与运行计划版本属于不同接口。** 作者场景使用 v3 组织分组，并不表示使用运行 plan 3；目前显式行为才进入 plan 3。静态二维／三维预览能力也不能推导出相同的运行后端支持。

## 映射出的下一步

[场景声音](SCENE_AUDIO.md)已经作为独立领域接入：当前 21 模块／38 项声明能力。作者使用 1–16 条轨道和 1–64 个有限时间提示；Godot 执行并交付实际 PCM WAV。声音与行为编辑保持独立；新建／登记向导、行为事件触发、总线、空间音频和 Bevy 声音实现分别列为后续范围。

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

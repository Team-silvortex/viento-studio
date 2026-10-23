# 文档中心

**当前源码版本为 0.1.9**，收录动画有序分支、状态快照、逐次进入记录、控制器回看、共享状态条件和组合条件。见[版本记录](RELEASE_0.1.9.md)、[当前能力与平台](STATUS.md)和[发布预检](test-results/release-0.1.9/README.md)。本次交付源码，已安装程序保持；历史专题保留开发时的版本与验收条件。

动画作者与运行链路可从以下入口进入：

- [状态表生成与重新编辑](SCENE_ANIMATION.md#从状态表生成动画脚本)，以及[静态状态图与字段定位](SCENE_ANIMATION.md#查看状态转换图)。
- [有序事件分支](SCENE_ANIMATION.md#按顺序匹配事件分支)、[项目共享状态条件](SCENE_ANIMATION.md#按项目共享状态选择转换)和[全部／任一满足组合](SCENE_ANIMATION.md#组合多个转换条件)。
- [逐次进入记录](SCENE_ANIMATION.md#查看每次成功进入状态的记录)、[退出前快照](SCENE_ANIMATION.md#查看运行后的动画状态快照)和[按控制器回看记录](SCENE_ANIMATION.md#按控制器回看运行记录)。
- [行为参数接口修复](SCENE_BEHAVIORS.md#根据脚本接口修复参数)、[脚本使用位置与原文导航](SCENE_BEHAVIORS.md#从脚本查看使用位置)及[自然完成与片段衔接](SCENE_ANIMATION.md#动画自然完成与片段衔接)。

[系统模块与工程需求](STUDIO_MODULES.md)说明整个 Studio 的装配、模板需求、表示和后端边界，以及后续 3D 与工作流布局的接入规则。

[后端工程管理](BACKEND_PROJECTS.md)现另覆盖成功工程的本机持久索引、重启恢复、明确运行目标选择、离线冻结场景入口与保留规则；新版源码的交付和验证条件见[当前状态](STATUS.md)。

从当前需要完成的任务进入。本文中的“工程”指一份 workspace；部分界面仍使用“作品”或“作品库”名称。

[快速开始](GETTING_STARTED.md) · [当前状态](STATUS.md) · [功能成熟度图谱](FUNCTION_ATLAS.md) · [0.1.8 版本记录](RELEASE_0.1.8.md) · [开发路线](ROADMAP.md) · [历史记录](history/README.md)

## 第一次使用

| 需要做什么 | 从这里开始 |
| --- | --- |
| 选择启动方式、创建第一份工程、体验样例 | [快速开始](GETTING_STARTED.md) |
| 判断源码功能、安装包与平台差异 | [当前能力与平台](STATUS.md) |
| 配置类型、编辑正文、保存与迁移 | [项目工作流](PROJECT_WORKFLOW.md) |
| 在字段表中修改数值、文字和开关 | [字段编辑](FIELD_EDITING.md) |
| 使用图片、视频与音频，切换界面语言 | [图片／视频／音频](MEDIA_RESOURCES.md)、[三语设置](LANGUAGES.md) |
| 分享文档、备份工程或保存单个素材 | [导出](EXPORT.md) |
| 选择对象和资源，在工程之间复用 | [资源包](RESOURCE_PACKAGES.md) |
| 多场景项目、启动入口、运行中切换与工程交付 | [项目组装](PROJECT_ASSEMBLY.md) |
| 跨场景保留计数／标记，查看变更与行为来源 | [项目共享状态](PROJECT_SHARED_STATE.md) |
| 行为间发布／订阅通知，查看处理顺序与双方来源 | [项目事件](PROJECT_EVENTS.md) |
| [行为驱动场景声音](PROJECT_AUDIO_CONTROLS.md) | 当前场景音轨的行为播放／停止、独立回执与双来源、工程交付 |
| 场景实例／分组、布局与源码草稿预览、构建和测试 | [构建与运行](PROJECT_BUILD.md) |
| 查看当前任务的问题、筛选诊断并返回原文修复 | [任务问题列表](PROJECT_BUILD.md#当前任务问题列表) |
| 多实例挂载 GDScript／Rust、编辑参数／信号、选入音轨或动画片段编号及错误定位 | [场景行为绑定](SCENE_BEHAVIORS.md) |
| 编辑音轨与时间提示、选择 WAV 并试听／暂停／定位、Godot 播放及资源交付 | [场景声音](SCENE_AUDIO.md) |
| 创建／编辑关键帧与序列帧、命名片段、时长调整与轨道复制、行为／事件控制、预览及 Godot 工程交付 | [场景动画](SCENE_ANIMATION.md) |
| 查看运行对象、检索实例／定义并返回冻结声明 | [运行对象与采样](RUNTIME_OBJECTS.md) |
| 在 Godot／Bevy 上回放全局或独立实例方向并逐步观察 | [有限控制回放](RUNTIME_CONTROL.md) |
| 保存、迁移用例并在冻结实例场景上检查逐步位置／状态预期 | [运行验收用例](RUNTIME_CASES.md) |
| 有序批量验收、成员顺序与联合预算 | [运行验收组](RUNTIME_CASE_SUITES.md) |
| 查看批次中每份用例的失败步骤并下载独立 JSON | [成员报告](RUNTIME_CASE_REPORTS.md) |
| 查看各后端生成工程、来源、文件库存与保留原因 | [后端工程管理](BACKEND_PROJECTS.md) |
| 同一无图场景在 Godot／Bevy 上构建与无头运行 | [Bevy 第二后端](BEVY_BACKEND.md) |
| 3D 对象与环境编辑、批量操作、预览导航及 Godot 工程导出 | [3D 场景编辑与预览](SCENE3D.md) |
| 新建多演员配方、起始排布、九域编辑及生成独立运行场景 | [场景片段组合](SCENE_COMPOSITION.md) |

## 工程格式与语义操作

| 主题 | 负责说明的文档 |
| --- | --- |
| 工程格式、类型与旧项目兼容概览 | [通用项目](GENERIC_PROJECTS.md) |
| 目录、权威数据、缓存、素材位置与迁移边界 | [工程布局](WORKSPACE_LAYOUT.md) |
| 内置起始包、文档模板、创建来源和兼容规则 | [工程模板](PROJECT_TEMPLATES.md) |
| 同一 OC 的 RPG、视觉小说、文学与戏剧配置 | [子模板与多份投影](OBJECT_PROJECTIONS.md) |
| 文档身份、背景故事与共享归属 | [文档模型](OC_DOCUMENT_MODEL.md) |
| 对象查询、字段来源与单属性修改 | [世界与对象](WORLD_PROJECTION.md) |
| 多对象属性提交、读取屏障与恢复 | [批量事务](WORLD_TRANSACTIONS.md) |
| 创建对象、追加关系、绑定已登记资源 | [对象创建](WORLD_OBJECT_CREATE.md)、[对象关系](WORLD_RELATIONS.md)、[资源绑定](WORLD_RESOURCES.md) |
| 机器可读格式和额外运行时校验 | [Schemas](../schemas/README.md) |
| 本机设置、最近工程、备份与外置素材绑定 | [本机数据目录](LOCAL_DATA_STORAGE.md) |

## 开发与平台

| 主题 | 文档 |
| --- | --- |
| 跨架构功能、实现证据、四维成熟度与工作流筛选 | [当前功能图谱](FUNCTION_ATLAS.md)、[离线交互版](function-atlas.html) |
| 已实现的模块职责、依赖方向与完整调用路径 | [系统架构](ARCHITECTURE.md)、[场景创作工作流](SCENE_AUTHORING.md) |
| 可移植解析、字段、存储及语义规划接口 | [引擎接口](../engine/README.md) |
| 执行能力描述符、可信宿主注册表与具体引擎隔离 | [执行后端中间层](BACKEND_MIDDLEWARE.md) |
| Node 本地服务、索引与维护命令 | [脚本说明](../scripts/README.md) |
| 桌面启动、打包、原生交互和清理 | [桌面说明](../desktop/README.md) |
| Android 私有存储、构建与设备限制 | [移动端说明](../mobile/README.md) |
| 如何验证修改、复现问题与保存证据 | [测试指南](TESTING.md) |
| 代码、文档及发布维护约定 | [贡献指南](../.github/CONTRIBUTING.md) |

## 架构演进

[开发路线](ROADMAP.md) 汇总阶段状态、下一步和验收条件。[下一代架构书](NEXT_ARCHITECTURE.zh-CN.md) 保存长期目标模型与设计推导；其中的目标须经实现和测试后才能列入 [当前状态](STATUS.md)。

| 决策 | 记录 |
| --- | --- |
| 软件版本与工程数据兼容 | [ADR 0001](adr/0001-product-version-and-data-compatibility.md) |
| World 投影、字段权威来源 | [ADR 0002](adr/0002-world-projection-and-property-authority.md) |
| 单属性命令 | [ADR 0003](adr/0003-single-property-command.md) |
| 可恢复的多源属性提交 | [ADR 0004](adr/0004-recoverable-source-changesets.md) |
| 对象创建、关系追加、资源绑定 | [ADR 0005](adr/0005-recoverable-object-creation.md)、[ADR 0006](adr/0006-recoverable-relation-registration.md)、[ADR 0007](adr/0007-recoverable-resource-binding.md) |
| Nuis 原生方向、GUI 宿主与副引擎 | [ADR 0008](adr/0008-native-nuis-and-bootstrap-runtime.md) |

## 示例与历史

- [Epic of Viento Line](examples/README.md)：独立官方作品，说明现有作品如何使用通用定义。
- [Scene3D](../examples/scene3d/README.md)：独立方块、相机和方向光；只读预览与显式 Godot 工程导出。
- [Scene2D](../examples/scene2d/README.md)：仓库内合成工程，验证从设计声明到运行产物。
- [场景片段组合](../examples/scene-composition/README.md)：单文件配方展开到现有 v3；已保存／当前草稿可预览并查看贡献来源，单实例局部覆盖可检查后应用到当前原文草稿并普通保存。已保存配方可在预览中显式生成独立 Scene2D，再进入构建与工程交付。
- [关键帧动画](../examples/scene-animation/README.md)：独立视觉偏移、旋转、缩放和透明度，无外部素材。
- [场景声音](../examples/scene-audio/README.md)：已登记的音轨、时间提示与 PCM WAV 合成样例。
- [场景行为](../examples/scene-behaviors/README.md)：同一 GDScript 的两个实例使用独立参数，贯通计划、构建、事件、来源诊断和依赖迁移。
- [历史索引](history/README.md)：发布、缺陷修复、平台验收、迁移及旧功能链路图。
- [验证历程](history/VALIDATION.md)：各阶段的版本、测试计数、环境和限制。

`test-results/` 保存日志、截图和源码摘要。[当前图谱](FUNCTION_ATLAS.md) 以四维坐标维护架构、功能、实现和成熟度；旧 b.4.3 图谱继续保存历史状态，不再承担当前能力目录。旧报告表示当时的状态；当前操作入口从本页进入，当前平台判断以 [STATUS](STATUS.md) 为准。

当前 2D 创作主线新增[共享演员结构编辑](SCENE_COMPOSITION.md#编辑片段的演员结构)与独立[整份放置管理](SCENE_COMPOSITION.md#管理片段放置)：复用已有片段、复制原偏移及覆盖或移除整份放置，审阅全部影响身份及完整原文，再应用源码草稿并普通保存。当前源码与各平台验收条件见[当前状态](STATUS.md)。

2D 配方当前还可[编辑组织分组](SCENE_COMPOSITION.md#编辑共享片段的组织分组)，按明确操作调整组名、父级和演员归组；与放置、演员字段及画布各自独立，普通保存仍是作者写入入口。

片段定义管理见[新增、复制、重命名与未引用删除](SCENE_COMPOSITION.md#管理片段定义)。先维护共享声明，再通过独立演员、组织组和放置入口完成场景；普通保存继续保留作者原文。

新配方可从[演员清单](SCENE_COMPOSITION.md#新建场景配方)开始：选择已有对象／投影并保留独立实例，使用[起始排布](SCENE_COMPOSITION.md#起始排布)预览、应用或撤销全部位置，审阅完整 JSON 后普通保存。再[生成独立运行场景](SCENE_COMPOSITION.md#从配方创建运行场景)，继续脚本、诊断修复与工程交付。源码与已安装版本的范围见 [0.1.9 版本记录](RELEASE_0.1.9.md)。

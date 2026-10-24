# Viento Studio

Viento 是正在向设计优先工作流演进的 IDE。现有工作台用于原创角色、游戏设定、文学、戏剧和软件设计：工程自己保存类型、模板、正文与资源，编辑器提供字段编辑、对象关系、可恢复保存和迁移。

原生方向是 **Nuislang、ns-nova 与 yalivia runtime**。Viento 将作为 ns-nova 的官方 GUI 编辑器，自身 GUI 也计划迁到 ns-nova；目前使用 Web / Tauri 宿主，Godot 4 已作为独立进程接通受限二维场景构建与运行。0.0.8 源码纳入 [Bevy 无头后端](docs/BEVY_BACKEND.md)，用同一冻结场景计划验证第二引擎的对象身份、输入与移动规则。原生执行、GUI 迁移及副引擎的阶段安排见 [开发路线](docs/ROADMAP.md)。

[快速开始](docs/GETTING_STARTED.md) · [当前能力与平台](docs/STATUS.md) · [功能成熟度图谱](docs/FUNCTION_ATLAS.md) · [文档中心](docs/README.md) · [系统架构](docs/ARCHITECTURE.md)

动画主线可通过[状态表生成普通脚本](docs/SCENE_ANIMATION.md#从状态表生成动画脚本)，配置[有序分支](docs/SCENE_ANIMATION.md#按顺序匹配事件分支)、[共享状态条件](docs/SCENE_ANIMATION.md#按项目共享状态选择转换)和[全部／任一满足组合](docs/SCENE_ANIMATION.md#组合多个转换条件)，沿用完整源码审阅、普通保存与项目构建。运行后可[按控制器回看状态进入、后续命令与末态](docs/SCENE_ANIMATION.md#按控制器回看运行记录)。

0.2.0 新增[状态进入的触发来源](docs/SCENE_ANIMATION.md#查看状态进入的触发来源)：运行记录区分初始化回调、事件、动画完成与直接进入，回看关联实际事件值或完成片段；0.2.0 发布时严格控制器工程使用协议10，旧记录仍可读取；当前逐实例范围的协议选择见下节。

本版支持[按事件回看投递与动画进入](docs/PROJECT_EVENTS.md#按事件回看投递与动画进入)，从消息及逐订阅结果跳到对应控制器历史，沿用现有运行协议。

编辑时可直接[手动试算事件分支](docs/SCENE_ANIMATION.md#手动试算事件分支)，输入事件和共享状态样本，检查有序匹配、逐项条件及短路结果，再定位字段。试算与运行历史分别查看。

试算还支持[连续事件与完成转换](docs/SCENE_ANIMATION.md#连续试算事件与完成转换)：显式记录一步后采用预测目标，继续下一样本，查看步骤详情并撤回。它用于编辑时检查路径。已记录路径可[导出为试算用例](docs/SCENE_ANIMATION.md#保存与重跑手动试算用例)，修改规则后重新导入并对照手动预期。[内置用例编辑](docs/SCENE_ANIMATION.md#在-studio-内编辑试算用例)可修改样本与预期，检查、应用后再重跑或导出。

## 当前状态

0.2.2 收录[场景空间中的碰撞体查看与选择](docs/SCENE_PHYSICS2D.md#在场景空间中查看与选择碰撞体)：按保存态位置显示碰撞范围，点击后进入已有参数，检查、审阅和普通保存保持独立。见[空间图验证](docs/test-results/scene-physics2d-space/README.md)。

0.2.2 收录[从场景首次创建物理](docs/SCENE_PHYSICS2D.md#从现有场景开始)：选择实例、审阅参数和关系，一次保存声明、登记与场景关联，再进入已有字段编辑器。当前为 **23 模块／45 项声明能力**；[开发验证](docs/test-results/scene-physics2d-creation/README.md)保留升版前记录，本机安装仍为 0.2.0。

0.2.1 收录[二维物理闭环](docs/SCENE_PHYSICS2D.md)，现可在[独立物理面板](docs/SCENE_PHYSICS2D.md#编辑已有物理声明)中编辑已有 JSON 的碰撞体、形状、偏移及层掩码，查看局部示意，经审阅应用草稿后普通保存。该发布基线的实例 UUID 手动填写；登记、关联与成员由构建前检查。Godot 真实接触事件可触发动画，物理根和视觉层独立；含物理生成工程为适配器 0.21.0，物理编辑面板不改变后端或运行协议。本版为源码交付，本机安装仍为 0.2.0。

0.2.2 补齐[物理目标按名称选择](docs/SCENE_PHYSICS2D.md#按名称选择已有场景实例)：从已保存场景读取名称和完整实例 UUID，支持缺失目标修复、刷新，以及应用前重读目录。读取失败时保留明确标注的手填流程；运动属性仍由构建检查。中英日界面与原文草稿保持独立，开发验证见[专题记录](docs/test-results/scene-physics2d-targets/README.md)。

0.2.1 收录[按实例预览动画](docs/SCENE_ANIMATION.md#按实例预览已保存动画)：同一场景里的角色可以独立选片段、播放、暂停和定位，单独停止或全部恢复静态。该范围只影响当前预览，不修改作者保存的运行范围。

0.2.1 同时收录[逐实例正式动画运行](docs/SCENE_ANIMATION.md#为正式运行选择播放范围)：在动画字段中显式选择范围，检查、审阅并普通保存后，从项目组装构建。每个实例独立选择与控制片段，完成通知按目标核对；只有显式逐实例项目使用协议11；无物理生成工程回执保留0.20.0，旧整场景项目保持原分支。Bevy 尚未接入。这次源码交付不更新安装；开发验证范围见[专题记录](docs/test-results/animation-instance-runtime/README.md)。

源码版本为 **0.2.2**，新增物理实例名称选择与修复、首次声明及关系创建、场景空间查看与选择，并收录导出指标 CI 竞态修复；详见[版本记录](docs/RELEASE_0.2.2.md)及[发布检查](docs/test-results/release-0.2.2/README.md)。当前为 **23 模块／45 项声明能力**；本机安装仍为 0.2.0。0.2.1 的动画、组装与物理运行能力继续保留。

动画同时支持[自然完成与片段衔接](docs/SCENE_ANIMATION.md#动画自然完成与片段衔接)，可将攻击结束接到循环待机；状态进入、命令执行、自然完成和退出快照分别记录。

0.1.6 已收录[2D 视觉关键帧动画](docs/SCENE_ANIMATION.md)：从场景首次创建并保存关联、内置字段编辑、保存态实例按名称选择、Rust 采样示意、已保存场景画面播放、Godot 运行及工程交付，该阶段为 **22 模块／43 项声明能力**。这些功能已进入源码版本；源代码、浏览器、引擎和准备副本的验证范围见[动画专题](docs/test-results/scene-animation/README.md)、[首次创建记录](docs/test-results/scene-animation-creation/README.md)和[场景画面预览记录](docs/test-results/scene-animation-scene-preview/README.md)。

[项目组装](docs/PROJECT_ASSEMBLY.md)把已保存的二维场景组织为一个 Godot 工程；行为可切换场景、读写[会话状态](docs/PROJECT_SHARED_STATE.md)、发布[项目事件](docs/PROJECT_EVENTS.md)、控制[场景声音](docs/PROJECT_AUDIO_CONTROLS.md)及[场景动画](docs/SCENE_ANIMATION.md#行为控制项目动画)。独立观察面板保留运行记录与作者来源，工程 ZIP 可在新目录导入运行。[Bevy Rust 通道](docs/BEVY_BACKEND.md#rust-作者行为通道012-后工作树)继续提供无图二维就绪／固定步行为和 Cargo 源工程交付，项目组装与声音尚未接入。

此前 0.2.0 主线源码已提交推送，本机 Linux x86_64 AppImage 已更新。原生验收中发现的交互问题经修复后重新打包，并针对最终安装包复测；包摘要、各次结果和精确覆盖见[本机安装验收](docs/test-results/native-installed-0.2.0/README.md)。本次没有创建 GitHub Release 或版本标签，其他平台仍按各自证据判断。0.2.1 的开发专题保留当时的 0.2.0 工作树身份和执行条件；源码发布不将它们重标为新安装验收。

当前已有：

- Markdown、文本、JSON、YAML 的源码／分段／字段编辑；字面查找替换、撤销／重做、多行缩进、行列跳转、原文诊断及中英日界面。
- 空白、游戏、文学、戏剧和软件设计起始模板；工程独立维护类型与模板，角色背景及共享内容有明确归属。
- 同一 OC 的多份独立投影，可创建／编辑 RPG、视觉小说、文学和戏剧配置；RPG 投影可在 Scene2D 中继承或覆盖运行字段。
- 对象查询、属性修改、批量提交、对象创建、关系和资源绑定；版本冲突检查与中断恢复。
- [场景声音](docs/SCENE_AUDIO.md)：首次创建、逐轨定时／行为触发、提示增删／换轨／排序、轨道复制与移除、已绑定 WAV 选择和就地试听；试听支持暂停／继续／定位，修改经审阅应用草稿后普通保存。Godot 继续提供 PCM 混音、[行为播放／停止](docs/PROJECT_AUDIO_CONTROLS.md)及带资源的工程交付。
- [2D 关键帧动画](docs/SCENE_ANIMATION.md)：首次创建与双向关联、四视觉属性与等分图集序列帧、轨道／关键帧／命名片段编辑、实例选择、等比时长调整和轨道复制。行为可控制播放头或用项目事件触发片段，参数可按名称选入编号并查看本场景使用位置；0.2.1 支持[按状态配置片段](docs/SCENE_ANIMATION.md#按状态配置动画片段)，显式应用后经普通审阅保存；表单示意、保存态场景预览与实际 Godot 执行分别验证，工程 ZIP 保留动画与资源。
- [项目组装与切换](docs/PROJECT_ASSEMBLY.md)：1–32 个二维场景和启动入口、[共享状态](docs/PROJECT_SHARED_STATE.md)、[事件发布订阅](docs/PROJECT_EVENTS.md)，独立运行观察与冻结来源。
- [图片／视频／音频引用](docs/MEDIA_RESOURCES.md)，文档分享、选择式资源包、单素材导出及完整工程迁移。
- 实验性 Scene2D 场景创建／编辑、独立实例、嵌套组织分组，单选／多选布局和局部撤销历史；保存状态及原文草稿预览，精确坐标回写与普通保存。
- 共享 Rust/WASM 编辑核心；[场景片段配方](docs/SCENE_COMPOSITION.md)的展开、保存态／草稿预览，以及共享覆盖、布局、实例、片段、放置、分组与定义的独立创作工作流。
- [新建配方助手](docs/SCENE_COMPOSITION.md#新建场景配方)：1–64 项演员、同对象独立实例、投影继承；横排／竖排／网格先预览后应用。完整 JSON 审阅与普通保存后，可显式生成独立 Scene2D，继续行为、构建与交付。
- 计划检查、Godot 构建、[GDScript／Bevy Rust 行为绑定](docs/SCENE_BEHAVIORS.md)与文本参数音轨选择、无头测试、独立窗口、[当前任务问题列表与原文定位](docs/PROJECT_BUILD.md#当前任务问题列表)和任务取消；[可信执行中间层](docs/BACKEND_MIDDLEWARE.md)复用冻结计划与工具校验。
- Godot／Bevy [有限控制回放](docs/RUNTIME_CONTROL.md)：全局或按实例独立方向输入、固定步骤采样和冻结运行对象观察。
- 可检查、迁移及导出 `.viento-build.zip` 的[后端派生工程](docs/BACKEND_PROJECTS.md)，独立[模块装配与模板需求](docs/STUDIO_MODULES.md)。
- [3D 场景创作与预览](docs/SCENE3D.md)：严格场景文本、九类独立作者编辑、只读 WebGL2 标准方向／平移／正交／双指导航、整景取景、距离雾与通用粒子场，以及可检查的 Godot 源工程导出。
- 显式工具身份检查、[验收用例](docs/RUNTIME_CASES.md)的保存与稳定身份迁移、[有序验收组](docs/RUNTIME_CASE_SUITES.md)，以及当前批次[成员详情与 JSON 导出](docs/RUNTIME_CASE_REPORTS.md)。

各平台的接入和实测范围见 [能力矩阵](docs/STATUS.md#平台接入)。Godot 产物需要 Godot 工具；Bevy 数据产物需要单独构建的可信运行程序；独立 Bevy Rust 源工程需要固定 Rust 工具链与预缓存依赖，运行时临时编译作者代码，ZIP 不含二进制或缓存。两条 Bevy 通道均未提供图片或窗口渲染。原生 Nuis 执行、嵌入运行视口、GPU 计算及独立游戏程序导出仍在路线内。

## 从源码开始

桌面开发需要 Node.js 24、Rust 稳定版及 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)。

```sh
git clone --depth 1 https://github.com/Team-silvortex/viento-studio.git
cd viento-studio
rustup target add wasm32-unknown-unknown
npm ci
npm run desktop:dev
```

在首页新建工程、打开已有文件夹或导入 `.viento.zip`。浏览器启动、合成样例体验和第一份文档见 [快速开始](docs/GETTING_STARTED.md)；安装包构建见 [桌面说明](desktop/README.md)，Android 见 [移动端说明](mobile/README.md)。预编译产物的交付与验收状态见 [当前状态](docs/STATUS.md#版本与交付)。

只检查应用代码可运行 `npm run check -- --app-only`，测试使用临时样例。验证层级和可选工具见 [测试指南](docs/TESTING.md)。

## 工程与资料

新工程把清单、正文、模板、元数据、素材和可重建缓存分开保存；程序升级与工程迁移分别进行。目录契约见 [工程布局](docs/WORKSPACE_LAYOUT.md)，日常操作见 [项目工作流](docs/PROJECT_WORKFLOW.md)。

原作品 **Epic of Viento Line** 是独立的 [官方内容示范](docs/examples/README.md)。仓库另含可复制的 [Scene2D 合成样例](examples/scene2d/README.md)，用于验证构建链路。两者的用途和数据范围分别说明。

## 参与开发

先阅读 [贡献指南](.github/CONTRIBUTING.md) 与 [当前架构](docs/ARCHITECTURE.md)。需求和问题通过 [Issues](https://github.com/Team-silvortex/viento-studio/issues) 反馈，安全问题使用 [私密报告说明](.github/SECURITY.md)。程序许可证见 [LICENSE](LICENSE)。

仓库保留早期程序、作品正文和素材的完整 Git 历史；浅克隆适合当前开发。发布、修复与测试记录统一从 [历史索引](docs/history/README.md) 查阅，既有数据的版本兼容见 [ADR 0001](docs/adr/0001-product-version-and-data-compatibility.md)。

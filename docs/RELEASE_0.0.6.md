# 0.0.6 版本记录

2026-10-03。将多工程模板、OC 子模板与独立投影、Scene2D 创作和预览、Linux Godot 构建工作台纳入源码交付。继续使用 workspace v2 / v3，保留已有工程的正文、登记、模板、素材与 UUID；应用升级不自动改写工程定义。

## 变更

- **工程模板解耦**：新建可选择空白、游戏、文学、戏剧或软件设计。桌面与 Android 源码共用声明式模板目录；工程保存独立定义、模板副本及来源摘要。旧 OC 默认模板继续兼容，游戏、文学、戏剧分别采用适合自身内容的类型和解析规则。
- **同一 OC，多份投影**：在“世界与对象”创建和编辑 RPG 玩家／NPC、视觉小说、文学或戏剧配置。子模板继承字段，保存完整规则快照；每份投影有独立 UUID 并引用原 OC，可复用已有投影生成新的独立默认配置。背景与身份仍由原 OC 维护，编辑投影不会改写其他用途。
- **Scene2D 创建与编辑**：从已有文档和图片创建场景，自动登记依赖；既有场景可调整画布、角色和运行配置。尺寸、颜色、速度、输入及图片可继承投影，也可逐项覆盖。更新保留 UUID、路径及未改动的原文格式；换图、移除角色不删除作者资源或已有登记。
- **场景预览选项卡**：无需启动 Godot，即可查看已保存场景的图片、中心位置、尺寸、着色、叠放和投影覆盖。支持缩放、平移、网格、对象选择、来源跳转及编辑后刷新。预览使用经过校验的冻结图片，切换和关闭释放资源；它是静态设计布局，不运行移动或状态机。
- **构建与运行工作台**：Linux 本机服务提供计划检查、Godot 4 生成工程、无头逻辑测试、独立窗口运行、日志、来源诊断及取消。构建冻结正文和图片输入，记录工具与产物摘要；运行使用独立副本，产物及工具缓存放在工程之外。
- **数据保护与迁移**：新增受限 `scene.create`、`projection.create`、`projection.update`、`scene.update`，对应第 5–8 版事务意图；GUI、HTTP 与 CLI 共用规划、修订检查及恢复规则。旧事务继续兼容，预览不写作者文件，完全无变化的更新不生成事务。完整工程包与选择式资源包保留场景、投影、来源及图片依赖，恢复与原生归档同步检查新增日志。
- **工作流与文档**：上述界面提供中英日提示、草稿保护、返回入口和窄屏布局。重组快速开始、能力矩阵、架构、路线、模板、构建及验证指南，并保存各阶段的合成样例和浏览器证据。
- 产品、锁文件和界面统一为 `0.0.6`；Android `versionCode` 为 `1000006`，macOS 构建编号为 `1.0.6`。应用标识仍为 `io.viento.studio`。

操作入口与契约见 [工程模板](PROJECT_TEMPLATES.md)、[OC 子模板与投影](OBJECT_PROJECTIONS.md)、[场景预览／构建与运行](PROJECT_BUILD.md) 和 [事务恢复](WORLD_TRANSACTIONS.md)。

## 验证与交付范围

发布前检查记录保存在 [0.0.6 发布验证](test-results/release-0.0.6/results.json)，涵盖版本一致性、桌面与移动资源准备、应用回归和完整桌面 Rust 测试。测试使用隔离样例，不读写日常作品或应用配置。

版本一致性及 API 契约检查通过，283 个 JavaScript 文件通过语法检查。应用回归 **1108 项通过、0 失败、0 跳过**，包含真实 Godot、原生归档与移动存储辅助程序集成。完整桌面宿主编译与 Rust 测试通过：**48 项通过、0 失败、1 项大作品往返测试按配置忽略**。桌面与移动资源准备通过。

开发阶段的 [工程模板](test-results/project-templates/results.json)、[游戏／文学／戏剧模板](test-results/oc-templates/results.json)、[构建工作台](test-results/build-workbench/results.json)、[场景创作](test-results/scene-authoring/results.json)、[投影创建](test-results/oc-projections/results.json)、[投影编辑](test-results/oc-projection-edit/results.json)、[场景编辑](test-results/scene-edit/results.json) 和 [场景预览](test-results/scene-preview/results.json) 保留原始版本标识和结果。场景预览的 Chrome 实测覆盖图片像素、几何与覆盖、缩放平移、选中、三语、窄屏、旧请求隔离及保存后刷新；Godot 窗口、取消与宿主退出回收见此前构建记录。这些专项证据不改写为新安装包或新设备验收。

本次交付为源码版本提交与推送，没有重新制作、发布或安装 AppImage、deb、APK，没有创建 GitHub Release 或版本标签。已有安装和 `dist/current/` 保留；使用新功能需从 0.0.6 源码启动或另行构建安装包。新版 Tauri 窗口、Windows／macOS 原生交互以及 Android 新模板选择器仍需目标平台验收。

Godot 后端当前只接通受限 Scene2D：角色文档引用、图片、方向键和 `idle` / `moving` 状态；产物是需要 Godot 的生成工程。独立游戏程序导出、通用行为／状态机、嵌入运行视口、Nuislang / ns-nova / yalivia 原生执行及 GPU 通道尚未实现。Android 继续支持现有编辑器、模板新建和完整项目迁移，尚未接入 World 语义命令、投影界面、场景预览和构建工作台。完整平台范围见 [当前状态](STATUS.md)。

作品格式未升级到 workspace v4，`changeset.apply` 仍只处理既有对象的属性修改。旧程序不能恢复第 5–8 版事务日志；回退前须用支持相应协议的版本完成恢复，再备份完整工程。

# 0.0.7 版本记录

2026-10-04。将场景布局编辑、共享 Rust 核心、独立场景实例、组织分组、原文草稿预览与坐标回写纳入源码交付。它延续 0.0.6 的工程模板、OC 投影和 Godot 工作台；workspace 仍兼容 v2 / v3，应用更新不自动迁移或改写作者工程。

## 变更

- **直接调整场景布局**：画布与列表支持单选／多选、整组拖动、坐标输入、网格吸附、六向对齐和批次撤销／重做。已保存场景采用明确的检查、审阅与事务保存；冲突保留草稿，保存结果未知时先只读核对，避免重复提交。
- **编辑规则进入共享 Rust 核心**：原生与 WASM 共用布局几何、位置批次校验、dirty 判断、100 批次局部历史，以及检查／保存／核对的阶段和请求身份。最多 32 个同时存在的布局会话，关闭即释放。网页使用同步 WASM，界面只负责交互与绘制；成品运行无需安装 Rust 工具链。
- **同一定义可有多个独立实例**：Scene2D v2 将实例 `instanceId` 与定义 `objectId` 分开，支持复制、重排和分别修改位置。新场景默认 v2；旧 v1 保留原规则，可经明确预览与保存升级。来源定位、布局历史、Godot 运行事件、冻结输入和资源迁移均保留实例身份。
- **可嵌套的组织分组**：Scene2D v3 提供组名、父组与实例归属，大纲支持折叠、搜索、祖先保留、选择后代和定位组名原文。每场景仍限 1–128 个实例，允许 0–128 个组、最多 16 层；分组不改变绝对坐标或绘制顺序，运行使用既有 plan/runtime v2。
- **源码草稿驱动设计预览**：已登记场景的当前原文可独立预览，支持 v1／v2／v3，限制 128 KiB UTF-8。错误保留文本和最近有效画面；字段来源只定位与当前草稿摘要相符的内容。投影、资源登记及构建继续读取保存状态，草稿预览不取得 World 保存权限。
- **布局结果可应用回文本草稿**：在源码模式打开有效草稿布局，经完整候选审阅后，只把变化的坐标应用到主编辑器内存，再由普通保存写入文件。Rust 无状态接口执行严格 JSON、身份／坐标／组检查和精确数值 token 补丁；BOM、CRLF、未改指数／负零与其他原文保留。哈希、编辑归属和保存基线继续由宿主核对；浏览器源码布局不再加载 YAML CST。
- **来源、构建和恢复保持明确边界**：场景来源模型与计划生成分离，声明字段和投影继承字段分别定位。旧 v1／v2 计划及生成器保持兼容；v3 组织信息通过独立预览侧带传递。布局保存沿用 `scene.update` 两文件事务与修订条件，完整工程包和选择式资源包保留声明、身份及依赖，旧事务恢复规则继续兼容。
- **功能图谱与维护流程**：增加架构、功能、实现和四项成熟度的可检索图谱，维护 56 项功能、110 个实现单元、176 个实现绑定及 18 条工作流，附可校验的证据与文件摘要。旧 F01–F50 链路图和历次报告原样保留；开发／打包准备与清理覆盖共享 WASM 和 Rust 构建目录。
- 产品及界面版本统一为 `0.0.7`；Android `versionCode` 为 `1000007`，macOS 构建编号为 `1.0.7`。应用标识仍为 `io.viento.studio`。

操作方法见 [场景预览、布局与构建](PROJECT_BUILD.md)，实现边界见 [架构](ARCHITECTURE.md) 和 [引擎接口](../engine/README.md)，功能与证据筛选见 [当前图谱](FUNCTION_ATLAS.md)。

## 验证与交付范围

发布前检查见 [0.0.7 验证记录](test-results/release-0.0.7/results.json)。Linux 上固定使用 Node.js **24.20.0**，启用真实 Godot 4.7.2、Rust 核心原生入口及归档／移动存储辅助程序：版本一致性、API 契约及 **330 个 JavaScript 文件**语法检查通过，应用回归 **1422 项通过、0 失败、0 跳过**。共享 Rust 核心 **48 项通过**，fmt／clippy 通过；桌面宿主 Rust **48 项通过、0 失败、1 项真实大作品往返按配置忽略**，未使用日常作品数据。桌面与移动资源准备通过，分别核对 **476／182 份文件**的产物清单与摘要。

下列开发专题记录保留执行时的版本、平台、源码摘要及限制；真实 Chrome 及数值专项证据沿用这些明确列出的记录，不改写成此次新安装包或设备验收。

- [布局编辑](test-results/scene-layout/results.json) 与 [多选](test-results/scene-selection/results.json)：画布操作、原文保留、冲突／未知结果处理和真实 Chrome。
- [Rust 几何](test-results/rust-studio-core/results.json)、[位置历史](test-results/rust-layout-history/results.json) 与 [保存工作流](test-results/rust-layout-save/results.json)：独立原生测试、WASM 一致性、会话释放及请求归属。
- [来源模型](test-results/scene-source-model/results.json)、[独立实例](test-results/scene-instances/results.json) 和 [组织分组](test-results/scene-groups/results.json)：旧格式兼容、身份／来源、真实 Godot 运行、恢复与资源包往返。
- [原文草稿预览](test-results/scene-draft-preview/results.json) 与 [源码布局回写](test-results/scene-source-layout/results.json)：只读预览、仅内存应用、普通保存和外部冲突保留。
- [Rust 源码检查与补丁](test-results/rust-scene-source/results.json)：应用回归 1353 通过／19 环境跳过，Rust 48 项通过，82 个旧 JS 冻结样例、500 次原生／WASM 对照及 12000 个数值压力样例通过；真实 Chrome 新源码布局 5 条流程／99 项断言和旧保存布局 8 条流程通过。专项与完整回归重叠，不相加为覆盖率。

本次交付源码提交与推送，没有重新制作、发布或安装 AppImage、deb、APK，也不创建 GitHub Release 或版本标签。最近保留的 Linux 安装包验收仍为 [0.0.4](test-results/release-0.0.4/results.json)。已有安装和 `dist/current/` 不因源码更新而改变；使用 0.0.7 功能需从对应源码启动或自行构建安装包。新版 Tauri 窗口、Windows／macOS 原生交互和 Android 设备仍需单独验收。

共享核心的下沉范围是布局、局部历史、保存阶段和源码坐标补丁；完整场景模型、投影继承、依赖、World 规划及后端 JSON/CST 仍在 JavaScript。移动资源携带同一 WASM，但 Android 尚未接入 World 语义命令、场景预览和构建工作台。

本版没有复用片段、空间父子变换、剧本事件、多文件草稿提交、跨文本／表单／画布统一撤销或跨重启布局恢复。Godot 产物仍是需要引擎的生成工程；任意作者脚本、Bevy、副引擎插件、Nuislang / ns-nova / yalivia 原生执行及 GUI 迁移继续按 [路线](ROADMAP.md) 推进。

作者 Scene2D 格式版本与应用版本独立。workspace 未升级为 v4，`changeset.apply` 仍只处理既有对象的属性修改；旧客户端不保证能读取新增的场景版本或恢复第 5–8 版事务日志。回退前先用支持相应协议的版本完成恢复，并导出完整工程备份。

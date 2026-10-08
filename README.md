# Viento Studio

Viento 是正在向设计优先工作流演进的 IDE。现有工作台用于原创角色、游戏设定、文学、戏剧和软件设计：工程自己保存类型、模板、正文与资源，编辑器提供字段编辑、对象关系、可恢复保存和迁移。

原生方向是 **Nuislang、ns-nova 与 yalivia runtime**。Viento 将作为 ns-nova 的官方 GUI 编辑器，自身 GUI 也计划迁到 ns-nova；目前使用 Web / Tauri 宿主，Godot 4 已作为独立进程接通受限二维场景构建与运行。0.0.8 源码纳入 [Bevy 无头后端](docs/BEVY_BACKEND.md)，用同一冻结场景计划验证第二引擎的对象身份、输入与移动规则。原生执行、GUI 迁移及副引擎的阶段安排见 [开发路线](docs/ROADMAP.md)。

[快速开始](docs/GETTING_STARTED.md) · [当前能力与平台](docs/STATUS.md) · [功能成熟度图谱](docs/FUNCTION_ATLAS.md) · [文档中心](docs/README.md) · [系统架构](docs/ARCHITECTURE.md)

## 当前状态

源码版本为 **0.0.9**。本版在既有场景、行为与双引擎链路上纳入工具身份检查、逐步运行验收用例、工程内保存与迁移、有序批量验收，以及独立成员详情和 JSON 报告导出，详见 [版本记录](docs/RELEASE_0.0.9.md)。本次交付源码，使用新功能需从源码启动或自行构建安装包；最近保留的 Linux 安装包验收仍为 0.0.4。

当前已有：

- Markdown、文本、JSON、YAML 的源码／分段／字段编辑，以及中英日界面。
- 空白、游戏、文学、戏剧和软件设计起始模板；工程独立维护类型与模板，角色背景及共享内容有明确归属。
- 同一 OC 的多份独立投影，可创建／编辑 RPG、视觉小说、文学和戏剧配置；RPG 投影可在 Scene2D 中继承或覆盖运行字段。
- 对象查询、属性修改、批量提交、对象创建、关系和资源绑定；版本冲突检查与中断恢复。
- [图片／视频／音频引用](docs/MEDIA_RESOURCES.md)，文档分享、选择式资源包、单素材导出及完整工程迁移。
- 实验性 Scene2D 场景创建／编辑、独立实例、嵌套组织分组，单选／多选布局和局部撤销历史；保存状态及原文草稿预览，精确坐标回写与普通保存。
- 共享 Rust/WASM 编辑核心；[场景片段配方](docs/SCENE_COMPOSITION.md)的展开、保存态／草稿预览及单实例局部覆盖。
- 计划检查、Godot 构建、[GDScript 行为绑定](docs/SCENE_BEHAVIORS.md)、无头测试、独立窗口、诊断和任务取消；[可信执行中间层](docs/BACKEND_MIDDLEWARE.md)复用冻结计划与工具校验。
- Godot／Bevy [有限控制回放](docs/RUNTIME_CONTROL.md)：全局或按实例独立方向输入、固定步骤采样和冻结运行对象观察。
- 显式工具身份检查、[验收用例](docs/RUNTIME_CASES.md)的保存与稳定身份迁移、[有序验收组](docs/RUNTIME_CASE_SUITES.md)，以及当前批次[成员详情与 JSON 导出](docs/RUNTIME_CASE_REPORTS.md)。

各平台的接入和实测范围见 [能力矩阵](docs/STATUS.md#平台接入)。Godot 产物需要 Godot 工具；Bevy 无头产物需要单独构建的可信运行程序，不编译工程中的 Rust 文本，也不提供图片或窗口渲染。原生 Nuis 执行、嵌入运行视口、GPU 计算及独立游戏程序导出仍在路线内。

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

# Viento Studio

Viento 是面向原创设定与游戏创作的实验性 IDE，正在打通 **设定 → 投影 → 场景实现 → 组装构建 → 工程交付**。工程独立保存类型、模板、正文、元数据与素材；编辑器提供内置创作工具，语义核心和执行后端分别维护。

原生方向是 **Nuislang、ns-nova 与 yalivia runtime**。目前使用 Web / Tauri 宿主，通过 Godot 4 验证二维创作与运行闭环，通过 Bevy 无头通道检验引擎间的接口边界。原生执行和 GUI 迁移仍在开发路线内。

[快速开始](docs/GETTING_STARTED.md) · [文档中心](docs/README.md) · [当前能力与平台](docs/STATUS.md) · [项目工作流](docs/PROJECT_WORKFLOW.md) · [开发路线](docs/ROADMAP.md)

## 当前状态

当前源码版本为 **0.2.3**，已收录[碰撞偏移与尺寸空间编辑](docs/SCENE_PHYSICS2D.md#在空间图中调整碰撞偏移)、[角色停止／滑动响应](docs/SCENE_PHYSICS2D.md#选择角色的碰撞响应)及现行文档重构；本机 Linux 安装验收仍停留在 **0.2.0**。版本、平台、验证证据统一见 [当前状态](docs/STATUS.md)，发布内容见 [0.2.3 记录](docs/RELEASE_0.2.3.md)。

| 创作环节 | 已有能力与操作指南 |
| --- | --- |
| 设定与资料 | [工程模板](docs/PROJECT_TEMPLATES.md)、Markdown / 文本 / JSON / YAML 的源码与[字段编辑](docs/FIELD_EDITING.md)、对象关系、中英日界面、[图片／视频／音频](docs/MEDIA_RESOURCES.md) |
| 设定投影 | 同一 OC 的独立 [RPG、视觉小说、文学与戏剧投影](docs/OBJECT_PROJECTIONS.md)，保留原对象身份与属性来源 |
| 二维场景 | 实例、分组、布局与草稿预览，[片段配方](docs/SCENE_COMPOSITION.md)、[行为](docs/SCENE_BEHAVIORS.md)、[声音](docs/SCENE_AUDIO.md)、[动画](docs/SCENE_ANIMATION.md)和[物理](docs/SCENE_PHYSICS2D.md)各自提供编辑入口 |
| 项目运行 | Godot [多场景组装](docs/PROJECT_ASSEMBLY.md)、切换、[共享状态](docs/PROJECT_SHARED_STATE.md)、[事件](docs/PROJECT_EVENTS.md)，以及独立运行观察与[验收用例](docs/RUNTIME_CASES.md) |
| 工程交付 | 检查来源、工具依赖及文件库存，导出可迁移的[后端工程](docs/BACKEND_PROJECTS.md)；作者工程、选择式资源包和单素材另走[导出流程](docs/EXPORT.md) |
| 三维实验 | 独立 [Scene3D 创作与预览](docs/SCENE3D.md)，含相机、灯光、雾和粒子场，以及 Godot 源工程导出 |

Godot 产物需要相应引擎工具。[Bevy](docs/BEVY_BACKEND.md)提供数据工程与 Rust 作者行为两条无图通道，后者可交付 Cargo 源工程；尚未接入图像窗口、项目组装、声音、动画和物理。嵌入运行视口、外部 IDE / LSP、独立游戏程序发行及原生 Nuis 执行仍待开发。细分范围与成熟度见 [功能图谱](docs/FUNCTION_ATLAS.md)。

## 从源码开始

推荐使用已验证的 Node.js 24、Rust 稳定版及 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)。

```sh
git clone --depth 1 https://github.com/Team-silvortex/viento-studio.git
cd viento-studio
rustup target add wasm32-unknown-unknown
npm ci
npm run desktop:dev
```

在首页新建工程、打开已有文件夹或导入 `.viento.zip`。浏览器启动、第一份文档和可复制的合成样例见 [快速开始](docs/GETTING_STARTED.md)；安装包构建见 [桌面说明](desktop/README.md)，Android 预览宿主见 [移动端说明](mobile/README.md)。

应用代码检查使用 `npm run check -- --app-only`，测试创建临时样例；按修改范围选择其他检查，见 [测试指南](docs/TESTING.md)。

## 工程与资料

工程的清单、正文、模板、元数据、素材和可重建缓存分开保存。应用升级、作者工程迁移和后端工程交付各有入口，目录与数据权威规则见 [工程布局](docs/WORKSPACE_LAYOUT.md)。

原作品 **Epic of Viento Line** 是独立的[官方内容示范](docs/examples/README.md)。仓库中的 [Scene2D](examples/scene2d/README.md)、[动画](examples/scene-animation/README.md)、[声音](examples/scene-audio/README.md)等合成样例用于验证工作流；新建空白或游戏模板不会自动装入这些内容。

## 参与开发

先读 [贡献指南](.github/CONTRIBUTING.md) 与 [系统架构](docs/ARCHITECTURE.md)。模块边界见 [Studio 模块](docs/STUDIO_MODULES.md)，共享语义接口见 [engine](engine/README.md)，后端接入见 [执行中间层](docs/BACKEND_MIDDLEWARE.md)。

需求和问题通过 [Issues](https://github.com/Team-silvortex/viento-studio/issues) 反馈，安全问题使用[私密报告说明](.github/SECURITY.md)。程序许可证见 [LICENSE](LICENSE)。

仓库保留早期程序、作品正文和素材的完整 Git 历史；浅克隆适合当前开发。发布、修复与验收记录从 [历史索引](docs/history/README.md) 查阅，既有工程的版本兼容见 [ADR 0001](docs/adr/0001-product-version-and-data-compatibility.md)。

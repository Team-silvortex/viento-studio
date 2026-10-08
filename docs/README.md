# 文档中心

从当前需要完成的任务进入。本文中的“工程”指一份 workspace；部分界面仍使用“作品”或“作品库”名称。

[快速开始](GETTING_STARTED.md) · [当前状态](STATUS.md) · [功能成熟度图谱](FUNCTION_ATLAS.md) · [0.0.9 版本记录](RELEASE_0.0.9.md) · [开发路线](ROADMAP.md) · [历史记录](history/README.md)

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
| 场景实例／分组、布局与源码草稿预览、构建和测试 | [构建与运行](PROJECT_BUILD.md) |
| 场景实例挂载 GDScript、参数、信号及错误定位 | [场景行为绑定](SCENE_BEHAVIORS.md) |
| 查看运行对象、检索实例／定义并返回冻结声明 | [运行对象与采样](RUNTIME_OBJECTS.md) |
| 在 Godot／Bevy 上回放全局或独立实例方向并逐步观察 | [有限控制回放](RUNTIME_CONTROL.md) |
| 保存、迁移用例并在冻结实例场景上检查逐步位置／状态预期 | [运行验收用例](RUNTIME_CASES.md) |
| 有序批量验收、成员顺序与联合预算 | [运行验收组](RUNTIME_CASE_SUITES.md) |
| 查看批次中每份用例的失败步骤并下载独立 JSON | [成员报告](RUNTIME_CASE_REPORTS.md) |
| 同一无图场景在 Godot／Bevy 上构建与无头运行 | [Bevy 第二后端](BEVY_BACKEND.md) |
| 复用片段配方、预览来源与编辑单实例局部覆盖 | [场景片段组合](SCENE_COMPOSITION.md) |

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
| 已实现的模块职责、依赖方向与完整调用路径 | [系统架构](ARCHITECTURE.md) |
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
- [Scene2D](../examples/scene2d/README.md)：仓库内合成工程，验证从设计声明到运行产物。
- [场景片段组合](../examples/scene-composition/README.md)：单文件配方展开到现有 v3；已保存／当前草稿可预览并查看贡献来源，单实例局部覆盖可检查后应用到当前原文草稿并普通保存，不自动登记生成场景。
- [场景行为](../examples/scene-behaviors/README.md)：同一 GDScript 的两个实例使用独立参数，贯通计划、构建、事件、来源诊断和依赖迁移。
- [历史索引](history/README.md)：发布、缺陷修复、平台验收、迁移及旧功能链路图。
- [验证历程](history/VALIDATION.md)：各阶段的版本、测试计数、环境和限制。

`test-results/` 保存日志、截图和源码摘要。[当前图谱](FUNCTION_ATLAS.md) 以四维坐标维护架构、功能、实现和成熟度；旧 b.4.3 图谱继续保存历史状态，不再承担当前能力目录。旧报告表示当时的状态；当前操作入口从本页进入，当前平台判断以 [STATUS](STATUS.md) 为准。

# 文档中心

当前文档对应 **0.0.5**。使用指南描述当前行为；带版本号的发布与测试记录保留当时的环境、结果和限制，不随升版改写。

## 下一代设计与施工

- [世界与对象：V-M1 / V-M2 第一条纵切](WORLD_PROJECTION.md)：投影查询、字段来源，以及 GUI / CLI / HTTP 共用的单属性预览与保存。
- [可恢复的批量提交：V-M3 第一条纵切](WORLD_TRANSACTIONS.md)：多个对象的属性修改、崩溃恢复、旧编辑器与导出读取屏障。
- [可恢复的对象创建：V-M2 / V-M3 创建纵切](WORLD_OBJECT_CREATE.md)：0.0.4 纳入，正文与登记一起发布／恢复，保留旧格式互通。
- [可恢复的对象关系：V-M2 / V-M3 关系纵切](WORLD_RELATIONS.md)：引用、共享归属、图约束及保真登记追加，支持中断恢复和归档互通。
- [可恢复的资源绑定：V-M2 / V-M3 资源纵切](WORLD_RESOURCES.md)：0.0.5 纳入，复用素材 UUID、自定义用途、离线绑定和登记恢复。

- [Viento Studio 下一代架构书](NEXT_ARCHITECTURE.zh-CN.md)：当前架构核查、目标模型、模块边界、工程类型包、Cold/Live Build、生态集成与迁移路线。第 0.3 节给出 Linux 施工起点，第 9.5 节规定官方实例数据保护门槛，第 10 节列出里程碑。
- 本书为目标架构草案；当前已实现的宿主与接口仍以 [系统架构](ARCHITECTURE.md) 为准，不把规划当作已交付能力。

## 使用与迁移

| 需要做什么 | 文档 |
| --- | --- |
| 从源码启动或构建桌面安装包 | [桌面版](../desktop/README.md) |
| 体验 Android，了解设备与数据限制 | [Android 预览版](../mobile/README.md) |
| 新建项目、定义类型和模板、编辑保存 | [项目工作流](PROJECT_WORKFLOW.md) |
| 在属性表中修改字段 | [字段编辑](FIELD_EDITING.md) |
| 引用图片、视频与音频 | [素材与音频引用](AUDIO_RESOURCES.md) |
| 分享文档或完整备份作品 | [导出](EXPORT.md) |
| 选择对象和素材，跨项目导入复用 | [资源包](RESOURCE_PACKAGES.md) |
| 单独保存图片、视频或音频原文件 | [导出说明](EXPORT.md#单个素材导出原文件) |
| 切换中英日界面 | [界面语言](LANGUAGES.md) |
| 定位本机作品、备份与设置 | [本机数据目录](LOCAL_DATA_STORAGE.md) |

## 项目格式与开发

| 主题 | 文档 |
| --- | --- |
| 新项目目录与兼容规则 | [通用项目结构](GENERIC_PROJECTS.md)、[作品库布局](WORKSPACE_LAYOUT.md) |
| 文档身份、背景故事归属和引用 | [OC 文档模型](OC_DOCUMENT_MODEL.md) |
| 素材身份、目录与迁移 | [作品库与素材布局](WORKSPACE_LAYOUT.md) |
| 清单及登记格式 | [Schemas](../schemas/README.md) |
| 桌面、浏览器、Android 的调用路径 | [系统架构](ARCHITECTURE.md) |
| 可复用解析和存储契约 | [引擎说明](../engine/README.md) |
| 本地服务、转换及维护命令 | [脚本说明](../scripts/README.md) |
| 开发约定、测试、发布检查 | [贡献指南](../.github/CONTRIBUTING.md)、[验证指南](TESTING.md) |
| 官方示范的定义与使用范围 | [Epic of Viento Line](examples/README.md) |

## 发布与验证记录

- [0.0.5 版本记录](RELEASE_0.0.5.md)：资源绑定、选择式资源包与单素材导出，以及发布前验证。
- [0.0.4 版本记录](RELEASE_0.0.4.md)：可恢复的对象创建与关系追加，以及 Linux 安装验收。

- [0.0.2 版本记录](RELEASE_0.0.2.md)：迁移交接纳入源码版本、安装计数器推进与本轮回归结果。
- [0.0.3 版本记录](RELEASE_0.0.3.md)：对象投影、统一属性命令和可恢复批量提交，以及发布前回归。
- [0.0.1 完整交接](HANDOFF_0.0.1.md)：仓库延续、新版本线、安装兼容、官方实例备份与恢复验收。
- [版本与数据兼容 ADR](adr/0001-product-version-and-data-compatibility.md)：软件版本、安装计数器与 v1/v2/v3 数据边界。

- [b.4.6 发布记录](RELEASE_b.4.6.md)：下载完成判定、Android 键盘与选择器修复，以及文档整理。
- [当前验证状态与待测链路](TESTING.md)：区分自动回归、原生交互、未验证环境和未实现能力。
- [b.4.5 开发阶段链路补测](WORKFLOW_VERIFICATION_b.4.5.md)：本版修复的复现、四组 Linux 工作流、Android 模拟器和逐文件迁移证据。
- [b.4.5 发布记录](RELEASE_b.4.5.md)：通用引擎和 Android 预览宿主；[b.4.4 发布记录](RELEASE_b.4.4.md)：字段编辑与翻译。
- [功能链路网络](FUNCTION_NETWORK.md)、[离线交互图](function-network.html)、[JSON](function-network.json)：b.4.3 历史枚举快照，适合追踪原有桌面链路；Android 与后续变化以当前架构和验证指南为准。

`test-results/` 保存对应报告引用的日志、截图和摘要。记录中的测试版本、源码指纹和失败复现均应保留；通过数只适用于记录的环境，不能推导其他平台已经通过。

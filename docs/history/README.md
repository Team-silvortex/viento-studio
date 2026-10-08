# 历史文档导航

这里集中索引历次发布、故障修复和验收记录。它们说明当时的代码、环境与结果；报告中的“当前”“已完成”只适用于对应版本或日期。查现有功能看 [开发状态](../STATUS.md)，运行测试看 [验证指南](../TESTING.md)，日常使用从 [文档中心](../README.md) 进入。

旧报告继续保留原文件位置，既有外链和证据路径不变。不要改写各期测试数字、失败／跳过状态或源码摘要来代表新一轮验证。

## 阶段验证与原始证据

- [历次验证摘要](VALIDATION.md)：原验证指南和状态页的开发阶段与发布验收记录，迁存时保留原条件并调整相对链接。
- [原始测试证据目录](../test-results/)：按版本或专题保留 `results.json`、日志、截图及来源指纹；新验证新增记录，旧记录不覆盖。
- [架构决策记录](../adr/)：保留每项设计决策及其背景；与发布验收记录分开查阅。

## 发布记录

`0.0.x` 是现行产品编号；`b.X.Y` 和更早的数字版本是历史编号。编号兼容规则见 [版本与数据兼容 ADR](../adr/0001-product-version-and-data-compatibility.md)。0.0.1 的交付与恢复记录位于下方的迁移交接分类。

| 原报告 | 主题 |
| --- | --- |
| [RELEASE_0.0.2.md](../RELEASE_0.0.2.md) | 0.0.2 版本记录 |
| [RELEASE_0.0.3.md](../RELEASE_0.0.3.md) | 0.0.3 版本记录 |
| [RELEASE_0.0.4.md](../RELEASE_0.0.4.md) | 0.0.4 版本记录 |
| [RELEASE_0.0.5.md](../RELEASE_0.0.5.md) | 0.0.5 版本记录 |
| [RELEASE_0.0.6.md](../RELEASE_0.0.6.md) | 0.0.6 模板、投影与场景工作台 |
| [RELEASE_0.0.7.md](../RELEASE_0.0.7.md) | 0.0.7 场景布局、Rust 核心与源码草稿 |
| [RELEASE_0.0.8.md](../RELEASE_0.0.8.md) | 0.0.8 片段组合、GDScript、执行中间层与 Bevy |
| [RELEASE_0.0.9.md](../RELEASE_0.0.9.md) | 0.0.9 工具检查、运行验收、工程用例、有序验收组与成员报告 |
| [RELEASE_b.2.8.1.md](../RELEASE_b.2.8.1.md) | b.2.8.1 发布记录 |
| [RELEASE_b.2.8.2.md](../RELEASE_b.2.8.2.md) | 发布编号更正 |
| [RELEASE_b.2.8.md](../RELEASE_b.2.8.md) | b.2.8 发布记录 |
| [RELEASE_b.2.9.md](../RELEASE_b.2.9.md) | b.2.9 发布记录 |
| [RELEASE_b.3.0.md](../RELEASE_b.3.0.md) | b.3.0 发布记录 |
| [RELEASE_b.3.1.md](../RELEASE_b.3.1.md) | b.3.1 发布记录 |
| [RELEASE_b.3.2.md](../RELEASE_b.3.2.md) | b.3.2 发布记录 |
| [RELEASE_b.3.3.md](../RELEASE_b.3.3.md) | b.3.3 发布记录 |
| [RELEASE_b.3.4.md](../RELEASE_b.3.4.md) | b.3.4 发布记录 |
| [RELEASE_b.3.5.md](../RELEASE_b.3.5.md) | b.3.5 发布记录 |
| [RELEASE_b.3.6.md](../RELEASE_b.3.6.md) | b.3.6 发布记录 |
| [RELEASE_b.3.7.md](../RELEASE_b.3.7.md) | b.3.7 发布记录 |
| [RELEASE_b.3.8.md](../RELEASE_b.3.8.md) | b.3.8 发布记录 |
| [RELEASE_b.3.9.md](../RELEASE_b.3.9.md) | b.3.9 发布记录 |
| [RELEASE_b.4.0.md](../RELEASE_b.4.0.md) | b.4.0 发布记录 |
| [RELEASE_b.4.1.md](../RELEASE_b.4.1.md) | b.4.1 发布记录 |
| [RELEASE_b.4.2.md](../RELEASE_b.4.2.md) | b.4.2 发布记录 |
| [RELEASE_b.4.3.md](../RELEASE_b.4.3.md) | b.4.3 发布记录 |
| [RELEASE_b.4.4.md](../RELEASE_b.4.4.md) | b.4.4 发布记录 |
| [RELEASE_b.4.5.md](../RELEASE_b.4.5.md) | b.4.5 发布记录 |
| [RELEASE_b.4.6.md](../RELEASE_b.4.6.md) | b.4.6 发布记录 |

## 缺陷修复与安全修复

这些报告保存复现条件、修复位置及当时的回归结果；同一问题后续扩展的记录可能使用不同版本号。

| 原报告 | 主题 |
| --- | --- |
| [ARCHIVE_REGISTRY_BUGFIX_b.3.7.md](../ARCHIVE_REGISTRY_BUGFIX_b.3.7.md) | 原生归档登记一致性修复 · b.3.7 工作树 |
| [ASSET_BINDING_BUGFIX_b.3.0.md](../ASSET_BINDING_BUGFIX_b.3.0.md) | 素材绑定与作品核验修复 · b.3.0 工作树 |
| [BUGFIX_0.2.1.md](../BUGFIX_0.2.1.md) | 0.2.1 故障排查与修复 |
| [CALL_PATH_BUGFIX_b.2.8.md](../CALL_PATH_BUGFIX_b.2.8.md) | b.2.8 调用链故障排查 |
| [CREATION_WORKFLOW_BUGFIX_b.3.0.md](../CREATION_WORKFLOW_BUGFIX_b.3.0.md) | 新建、保存与预览缓存修复 · b.3.0 工作树 |
| [DOCUMENT_MIGRATION_BUGFIX_b.3.7.md](../DOCUMENT_MIGRATION_BUGFIX_b.3.7.md) | 文档归属迁移与恢复日志修复 · b.3.7 工作树 |
| [EDITOR_FILTERING_BUGFIX_b.3.5.md](../EDITOR_FILTERING_BUGFIX_b.3.5.md) | 编辑中的筛选与目录刷新修复 · b.3.5 工作树 |
| [EDITOR_INDEX_REFRESH_BUGFIX_b.3.4.md](../EDITOR_INDEX_REFRESH_BUGFIX_b.3.4.md) | 保存与目录刷新修复 · b.3.4 工作树 |
| [EDITOR_LANGUAGE_BUGFIX_b.3.5.md](../EDITOR_LANGUAGE_BUGFIX_b.3.5.md) | 编辑中的语言切换修复 · b.3.5 工作树 |
| [EXPORT_BRIDGE_BUGFIX_b.3.8.md](../EXPORT_BRIDGE_BUGFIX_b.3.8.md) | 桌面导出保存回执与重试 · b.3.8 工作树 |
| [EXPORT_BROWSER_BUGFIX_b.4.0.md](../EXPORT_BROWSER_BUGFIX_b.4.0.md) | 浏览器导出失效与重试 · b.4.0 工作树 |
| [EXPORT_CANCELLATION_BUGFIX_b.3.5.md](../EXPORT_CANCELLATION_BUGFIX_b.3.5.md) | 导出完成交接时的取消修复 · b.3.5 工作树 |
| [EXPORT_CLEANUP_BUGFIX_b.3.8.md](../EXPORT_CLEANUP_BUGFIX_b.3.8.md) | 导出任务清理与失败恢复 · b.3.8 工作树 |
| [EXPORT_DOWNLOADS_BUGFIX_b.4.0.md](../EXPORT_DOWNLOADS_BUGFIX_b.4.0.md) | 导出分段下载与名额回收 · b.4.0 工作树 |
| [EXPORT_PREPARATION_BUGFIX_b.3.9.md](../EXPORT_PREPARATION_BUGFIX_b.3.9.md) | 导出准备与复查取消 · b.3.9 工作树 |
| [EXPORT_REFERENCES_BUGFIX_b.3.1.md](../EXPORT_REFERENCES_BUGFIX_b.3.1.md) | 素材引用与分享导出修复 · b.3.1 工作树 |
| [EXPORT_SNAPSHOT_BUGFIX_b.3.9.md](../EXPORT_SNAPSHOT_BUGFIX_b.3.9.md) | 完整项目导出的缺失路径快照 · b.3.9 工作树 |
| [EXPORT_STREAMS_BUGFIX_b.3.9.md](../EXPORT_STREAMS_BUGFIX_b.3.9.md) | 导出读取与文件关闭时序 · b.3.9 工作树 |
| [IMAGE_DISPLAY_BUGFIX_b.3.6.md](../IMAGE_DISPLAY_BUGFIX_b.3.6.md) | 图片地址与缺图回退修复 · b.3.6 工作树 |
| [ITEM_ATTRIBUTE_DISPLAY_b.2.8.md](../ITEM_ATTRIBUTE_DISPLAY_b.2.8.md) | b.2.8 物品属性显示修复 |
| [MEDIA_DROP_BUGFIX_b.4.0.md](../MEDIA_DROP_BUGFIX_b.4.0.md) | 素材拖放位置与窗口重开修复 · b.4.0 工作树 |
| [MEDIA_INSERTION_BUGFIX_b.3.2.md](../MEDIA_INSERTION_BUGFIX_b.3.2.md) | 结构化素材插入修复 · b.3.2 工作树 |
| [MEDIA_LOADING_BUGFIX_b.4.1.md](../MEDIA_LOADING_BUGFIX_b.4.1.md) | 素材读取失败后的重试与提示恢复 · b.4.1 工作树 |
| [MEDIA_PREVIEW_BUGFIX_b.3.2.md](../MEDIA_PREVIEW_BUGFIX_b.3.2.md) | 素材预览与编辑切换修复 · b.3.2 工作树 |
| [MEDIA_PREVIEW_CONTENT_BUGFIX_b.4.2.md](../MEDIA_PREVIEW_CONTENT_BUGFIX_b.4.2.md) | 素材说明、嵌套字段与重复引用 · b.4.2 工作树 |
| [MEDIA_PREVIEW_PARSING_BUGFIX_b.4.2.md](../MEDIA_PREVIEW_PARSING_BUGFIX_b.4.2.md) | 结构化草稿预览与解析一致性 · b.4.2 工作树 |
| [MEDIA_PREVIEW_REQUESTS_BUGFIX_b.4.1.md](../MEDIA_PREVIEW_REQUESTS_BUGFIX_b.4.1.md) | 失效素材预览请求的取消 · b.4.1 工作树 |
| [MEDIA_RECOVERY_BUGFIX_b.4.1.md](../MEDIA_RECOVERY_BUGFIX_b.4.1.md) | 部分素材导入失败后的恢复 · b.4.1 工作树 |
| [NETWORK_BUGFIX_b.2.8.1.md](../NETWORK_BUGFIX_b.2.8.1.md) | 按功能网络修复记录 · b.2.8.1 |
| [PROJECT_DEFINITION_BUGFIX_b.3.7.md](../PROJECT_DEFINITION_BUGFIX_b.3.7.md) | 项目定义采用与模板校验修复 · b.3.7 工作树 |
| [PROJECT_SETTINGS_BUGFIX_b.3.1.md](../PROJECT_SETTINGS_BUGFIX_b.3.1.md) | 项目类型与模板修复 · b.3.1 工作树 |
| [PROJECT_SNAPSHOT_BUGFIX_b.3.6.md](../PROJECT_SNAPSHOT_BUGFIX_b.3.6.md) | 项目类型读取与保存冲突修复 · b.3.6 工作树 |
| [SAVE_CONFLICT_BUGFIX_b.2.9.md](../SAVE_CONFLICT_BUGFIX_b.2.9.md) | 保存冲突与草稿保护 · b.2.9 |
| [SAVE_RECOVERY_BUGFIX_b.3.3.md](../SAVE_RECOVERY_BUGFIX_b.3.3.md) | 保存失败与重试修复 · b.3.3 工作树 |
| [SECURITY_GLIB_b.2.9.md](../SECURITY_GLIB_b.2.9.md) | glib 字符串迭代安全修复 · b.2.9 |
| [SOURCE_LOADING_BUGFIX_b.3.4.md](../SOURCE_LOADING_BUGFIX_b.3.4.md) | 原文读取与失效响应修复 · b.3.4 工作树 |
| [STRUCTURED_VALUES_BUGFIX_b.4.2.md](../STRUCTURED_VALUES_BUGFIX_b.4.2.md) | 顶层结构化值与空容器展示 · b.4.2 工作树 |
| [TEMPLATE_HTTP_BUGFIX_b.3.6.md](../TEMPLATE_HTTP_BUGFIX_b.3.6.md) | 模板网络读取与新建文档修复 · b.3.6 工作树 |
| [TEMPLATE_LOADING_BUGFIX_b.3.3.md](../TEMPLATE_LOADING_BUGFIX_b.3.3.md) | 新建模板加载与路径切换修复 · b.3.3 工作树 |

## 迁移、平台验收与维护

现行的设置、作品与缓存目录规范见 [本机数据目录](../LOCAL_DATA_STORAGE.md)；下表只列迁移和验收历史。

| 原报告 | 主题 |
| --- | --- |
| [STRUCTURE_MIGRATION.md](../STRUCTURE_MIGRATION.md) | 2026-09-09 首次目录整理、迁移核验与旧产物清理 |
| [ANDROID_FOUNDATION_b.4.4.md](../ANDROID_FOUNDATION_b.4.4.md) | Android 基础拆分记录 |
| [ANDROID_HOST_b.4.4.md](../ANDROID_HOST_b.4.4.md) | Android 宿主与本机存储（b.4.4 开发记录） |
| [ANDROID_TRANSFER_b.4.4.md](../ANDROID_TRANSFER_b.4.4.md) | Android 项目包迁移（b.4.4 开发记录） |
| [DISK_OPTIMIZATION_2026-09-24.md](../DISK_OPTIMIZATION_2026-09-24.md) | 项目磁盘清理 · 2026-09-24 |
| [HANDOFF_0.0.1.md](../HANDOFF_0.0.1.md) | 0.0.1 迁移交接 |
| [NATIVE_EXPORT_TEST_b.2.8.1.md](../NATIVE_EXPORT_TEST_b.2.8.1.md) | b.2.8.1 编辑器导出与原生保存实测 |
| [NATIVE_LIBRARY_TEST_b.2.8.1.md](../NATIVE_LIBRARY_TEST_b.2.8.1.md) | b.2.8.1 作品库原生工作流实测 |
| [NATIVE_WORKFLOW_TEST_b.2.8.1.md](../NATIVE_WORKFLOW_TEST_b.2.8.1.md) | b.2.8.1 原生桌面工作流实测 |
| [NATIVE_WORKFLOW_TEST_b.4.3.md](../NATIVE_WORKFLOW_TEST_b.4.3.md) | b.4.3 当前桌面版补充实测 |
| [WORKFLOW_VERIFICATION_b.4.5.md](../WORKFLOW_VERIFICATION_b.4.5.md) | b.4.5 功能链路补测与修复 |

## 功能增量与交互改进

此处是当时的实现及验收过程。现行操作说明已拆分到 [字段编辑](../FIELD_EDITING.md)、[素材音频](../AUDIO_RESOURCES.md)、[语言支持](../LANGUAGES.md) 和 [项目工作流](../PROJECT_WORKFLOW.md)。

| 原报告 | 主题 |
| --- | --- |
| [FIELD_EDITING_b.4.3.md](../FIELD_EDITING_b.4.3.md) | 字段编辑：b.4.3 实现与验证记录 |
| [MEDIA_EMBEDDING_b.2.8.md](../MEDIA_EMBEDDING_b.2.8.md) | 在编辑器中嵌入图片和视频 |
| [TRANSLATION_REFINEMENT_b.4.3.md](../TRANSLATION_REFINEMENT_b.4.3.md) | 翻译完善记录 |
| [TRILINGUAL_SUPPORT_b.4.3.md](../TRILINGUAL_SUPPORT_b.4.3.md) | 中英日翻译强化与验证 |
| [USABILITY_INPUT_b.4.3.md](../USABILITY_INPUT_b.4.3.md) | 多语言编辑的实际使用优化 |

## b.4.3 功能链路快照

以下四个文件固定描述 **2026-09-24、b.4.3 工作树、修订 64**。它们保留节点、连线和扫描指纹，不能用当前源码重新生成后仍称为同一份历史验收。

| 文件 | 用途 |
| --- | --- |
| [FUNCTION_NETWORK.md](../FUNCTION_NETWORK.md) | 当时的功能入口、链路说明与统计 |
| [function-network.html](../function-network.html) | 离线交互浏览器 |
| [function-network.json](../function-network.json) | 机器可读节点、连接、代码引用与指纹 |
| [function-network.mmd](../function-network.mmd) | Mermaid 总图源码 |

后续链路与实现范围从 [当前架构](../ARCHITECTURE.md) 和 [开发状态](../STATUS.md) 查阅；历史补测保存在上面的工作流报告中。

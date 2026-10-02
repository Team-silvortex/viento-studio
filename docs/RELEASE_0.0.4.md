# 0.0.4 版本记录

2026-10-02。将可恢复的对象创建与关系追加纳入桌面版本，继续使用 workspace v2 / v3 的正文和登记，保留作品身份与既有归档格式。

## 变更

- `object.create` 在 GUI、CLI、HTTP 共用预览与保存流程，校验 UUID、文档类型、可移植路径和原文，按同一事务发布正文与登记。中断后撤回创建或恢复完整对象。
- `relation.add` 支持引用和多归属，拒绝重复、自连接和归属循环。JSON 只插入新增关系，保留未知字段、原数字文本及正文；保存后更新双方的归属导航。
- 新增受限的 version 2 创建意图、version 3 关系意图，继续恢复 version 1 属性事务。外部冲突保留数据与日志；旧编辑器和导出保持读取屏障。
- 创建与关系界面支持中英日、窄屏、预览失效、关闭确认和冲突草稿保留；恢复不会自动重发未保存命令。
- 产品、锁文件和界面统一为 `0.0.4`，Android 安装编号为 `1000004`，macOS 构建编号为 `1.0.4`。应用标识仍为 `io.viento.studio`。

使用与边界见 [对象创建](WORLD_OBJECT_CREATE.md)、[对象关系](WORLD_RELATIONS.md) 和 [事务恢复](WORLD_TRANSACTIONS.md)。

## 验收与本机安装

本轮执行版本检查、应用回归、Rust 测试、原生归档互通、Linux AppImage / deb 构建及 AppImage 原生工作流验收。实际结果、安装包摘要和本机替换记录见 [发布验收记录](test-results/release-0.0.4/results.json)。应用回归启用原生归档和移动存储工具；原生界面测试使用隔离作品及独立配置。

本机桌面入口使用通过验收的同一份 AppImage，替换前保留旧程序、启动器、桌面入口和安装记录。升级不移动作品或清除配置。AppImage 与 deb 保存在本机 `dist/current/`；deb 仅构建，当前安装方式仍是 AppImage。本轮不创建 GitHub Release 或上传安装包。

开发阶段的 [创建记录](test-results/world-create/results.json) 和 [关系记录](test-results/world-relations/results.json) 保留当时 0.0.3 的版本、指纹和浏览器／SIGKILL 结果，不改写为 0.0.4 的测试。

尚未接入资源绑定命令、关系删除、通用混合 ChangeSet、workspace v4、Build 和 Android 语义写入。本轮未构建 APK，也不代表 Windows／macOS、实体手机或硬件断电验收。旧版本遇到未完成的创建／关系意图会拒绝恢复；须用支持相应协议的版本恢复后再回退程序。

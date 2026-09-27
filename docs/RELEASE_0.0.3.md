# 0.0.3 版本记录

2026-09-27。将 World / Object 查询、统一属性命令和可恢复的批量属性提交纳入 Viento Studio 源码版本，继续沿用既有作品格式和原文权威来源。

## 变更

- 旧 v1 / v2 / v3 作品映射为可查询的世界、对象、属性来源、关系与资源。GUI、CLI 和 HTTP 使用同一实验性 semantic v1 契约；大整数按文本保留，未知类型保持只读。
- `property.set` 提供单属性预览、保真保存、版本冲突检查和受版本约束的反向命令，与旧编辑器共用写锁。
- `changeset.apply` 统一预览、提交多个现有对象的属性修改；GUI 支持暂存队列、逐项移除和整批提交，冲突保留输入。首版限每个对象一个属性、最多 32 个对象。
- 通过意图、前后镜像、提交标记和独立回执实现进程中断恢复。启动及显式恢复入口遵守同一协议；旧文档读写、静态原文和 Node／Rust 导出阻止读取未完成事务。恢复保留旧编辑器已有的未保存草稿。
- 产品清单、锁文件和界面版本统一为 `0.0.3`，Android 安装编号为 `1000003`，macOS 构建编号为 `1.0.3`，应用标识继续使用 `io.viento.studio`。

操作与边界见 [世界与对象](WORLD_PROJECTION.md)、[批量提交与恢复](WORLD_TRANSACTIONS.md) 和 [下一代架构路线](NEXT_ARCHITECTURE.zh-CN.md)。

## 验证范围

0.0.3 发布前重新执行版本一致性检查、应用回归、Rust 测试、原生归档／移动存储互通及桌面／移动资源准备，结果见 [发布前记录](test-results/release-0.0.3/results.json)。

开发阶段的 [V-M1](test-results/world-m1/results.json)、[V-M2](test-results/world-m2/results.json)、[V-M3](test-results/world-m3/results.json) 保留当时 0.0.2 的版本标识和指纹。V-M3 记录包含 Linux 子进程真实 SIGKILL、恢复重入，以及真实界面的双对象提交、版本冲突、三语显示、窄屏和旧草稿保护；它们不作为新安装包或其他平台的恢复认证。

本轮交付为源码提交与推送，未构建或替换安装包，也未创建 GitHub Release。语义对象创建、关系／资源写入、通用 ChangeSet、workspace v4、Build 和 Android 事务适配仍待实现。

# 0.0.2 版本记录

2026-09-27。将前身 Epic of Viento Line 的完整交接纳入 Viento Studio 源码版本，继续使用原有编辑器、宿主和 v1 / v2 / v3 作品格式。官方作品的备份、恢复、Linux 安装及 Android 保留数据升级是在 0.0.1 完成的，原始版本和证据保留在 [交接记录](HANDOFF_0.0.1.md)。

## 变更

- npm 产品名称、仓库与问题报告入口统一到 `Team-silvortex/viento-studio`；前身 Git 历史保留。
- 清单、锁文件及界面版本统一为 `0.0.2`。应用标识仍为 `io.viento.studio`；Android 安装编号递增为 `1000002`，macOS 构建编号递增为 `1.0.2`。
- 版本解析、源码归档及安装包命名支持三段数字版本，同时保留历史 beta 版本解析。安装计数器、旧安装切换和数据边界见 [ADR 0001](adr/0001-product-version-and-data-compatibility.md)。
- 增加来自前身格式的固定 v1 / v2 / v3 合成样例及 Node / Rust 归档往返回归；CI 增加原生兼容任务。应用测试并发限制为 2，减少内存峰值。
- 纳入脱敏交接结果；官方作品、完整备份、设置及安装包保留在本机。World/Object、v4、Cold/Live Build 继续按 [下一代架构书](NEXT_ARCHITECTURE.zh-CN.md) 推进。

## 验证范围

本轮针对 0.0.2 源码重新执行应用检查、原生归档与移动存储互通回归、Rust 测试及移动资源准备；结果见 [本轮记录](test-results/release-0.0.2/results.json)。

本轮交付为源码提交与推送；不重新构建安装包或更换本机已安装的 0.0.1，也不创建 GitHub Release。0.0.1 的设备验收不作为 0.0.2 安装包验收。Windows、macOS 和 Android 实体设备仍需对应环境验证。

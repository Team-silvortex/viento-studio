# 0.2.7 发布检查

2026-10-28。此目录记录本版发布检查；升版之前的开发专题保留原时间、版本与测试范围，不将其改写为 0.2.7 重跑结果。

## 本版检查

- 版本与源码分发专项：`node --test scripts/tests/version.test.mjs scripts/tests/source-archive.test.mjs`（Node 24.21.0），8 项通过，0 项失败或跳过。完整应用和核心检查另行记录。

## 升版前 0.2.6 开发工作树证据

- [Bevy 项目入口控制回放](../bevy-project-control-replay/README.md)：完整应用检查 8,877 项中 8,277 项通过、600 项条件跳过、0 失败；随后调整执行指纹，另有 44 项真实 Bevy 专项通过。隔离 Chrome 工作流验证了入口逐实例回放与三语切换。
- [项目输入映射](../project-input-map/README.md)：真实 Godot 和隔离 X11 合成键盘验证，包含独立动作、43 个支持的物理键及 AZERTY 布局；没有使用实体键盘。映射迁移、动作缺失提示和真实构建见原专题。
- [物理回放文档](../physics-replay-documents/README.md)和[物理验收](../physics-replay-acceptance/README.md)：真实 Godot、隔离浏览器和离线迁移专项覆盖输入保存、验收通过／失败及作者数据保护；具体限制以原记录为准。
- [0.2.6 桌面包隔离测试](../desktop-rebuild-0.2.6/README.md)是当时的 DEB 与真实窗口验证，并非 0.2.7 安装或新版 Tauri 验收。

条件跳过不算通过；不同专题和全量测试可能重叠，不能相加作为覆盖率。测试不会证明全部平台、物理设备、外部引擎或实际作品均已验收。

- 0.2.7 版本一致性及源码归档：[8 项通过](version.log)。
- Rust 核心：[`npm run core:test`](core.log)，417 项通过、0 失败。
- Tauri 桌面：[`npm run desktop:test -- --locked`](desktop.log)，59 项通过、1 项忽略、0 失败。
- [真实引擎专项](engines.log)：18 项通过、1 项条件跳过；独立[窗口与 Bevy 协议复测](engines-window.log) 10 项全部通过，其中 Xvfb/XTest 为模拟键盘，不代表实体设备。

日志中的本机路径已脱敏；这些是源码工作树检查，不是安装版验收。

- 完整应用检查 `npm run check -- --app-only`：[8,877 项中 8,277 通过、600 条件跳过、0 失败](app-check-summary.log)。该日志保存最终汇总；检查期间完成了版本预检、语法检查、API 契约与完整应用测试。

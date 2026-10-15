# 场景声音链路验收

2026-10-13，0.1.2 后未发布工作树。声音规则、既有声音文档字段编辑、冻结音频、Godot 播放和工程交付作为独立链路接通；21 模块／38 项声明能力，Godot 适配器 0.6.0。使用方法见[场景声音](../../SCENE_AUDIO.md)，[汇总](summary.json)记录范围。

| 层级 | 最终结果 | 证据 |
| --- | --- | --- |
| 完整应用 | 4920 项：4807 通过、113 条件跳过、0 失败；814 个 JS、版本与 API 预检通过 | [最终日志](app-check.log) |
| 共享 Rust 核心 | 334／334；fmt、clippy 通过；新声音 JS/WASM/native 13／13 | [核心记录](core-summary.json) |
| 计划、资源和中间层 | 27／27；冻结依赖、PCM 校验、两条 Bevy 明确拒绝、来源映射 | [专项日志](planning-tests.log) |
| 编辑与相邻功能 | 201／201，含新增 25 项；字段补丁、取消、来源切换及普通保存边界 | [编辑记录](editor-summary.json) |
| 真实 Godot | 11／11，无跳过；两版计划、实际 PCM、循环、停止、精确时间、异地交付 | [后端记录](godot-summary.json) |
| 真实 Chrome | 4 组、10 图、25 项源指纹一致、0 浏览器错误 | [最终浏览器记录](browser-summary.json) |
| 准备资源 | 桌面／移动 37 项字节比对，7 项复制模块实际调用 | [准备记录](prepared.json) |
| 数据保留 | 6993 份既有示例／历史证据和已安装 AppImage 保持原字节 | [保留记录](preservation.json) |

定向 JavaScript 回归与完整应用重叠，不相加。完整应用只配置了本轮原生核心辅助程序；需要特定引擎工具的用例可跳过，不能用跳过推断能力。真实 Godot 4.7.2 专项另配置可信工具并全部执行。Rust 采用 1.95.0，Node 24.21.0，Chrome 154.0.8037.97。桌面准备资源仍按仓库固定的 Node 24.20.0 元数据构造，本轮没有重新打包或安装。

## 实际流程

最终浏览器以复制的 `examples/scene-audio` 为临时作品，完整记录在 [browser.json](browser-1791896049034/browser.json)：

1. 打开已有音频声明，修改两条轨道的音量／循环和指令时间／动作；中英日 390px 可滚动，返回、取消、审阅和应用按钮可达。
2. 取消不改草稿与磁盘；应用只改普通草稿，普通保存仅改变 `documents/audio/demo.json`，场景、登记和 WAV 保持。
3. 同场景经真实 Godot 检查、生成和运行，按 0／0.125／0.5 秒产生三条声音指令，并分别验证演员与声音完成。
4. Chrome 实际下载 58,450 字节 `.viento-build.zip`，8 个生成文件加 1 份去重 WAV；独立解包、校验后在新目录导入及运行，事件保持一致。

[初轮浏览器记录](browser-1791894941122/browser.json)保留其原指纹，不能替代最后时间修复后的最终轮。桌面及窄屏截图均保留在各自目录。

Godot 原生测试捕获了实际混音 PCM：音量 0.25 时峰值约 0.122104，音量 0 和产品停止路径后峰值为 0；复用同资源的循环／不循环轨道独立，循环轨道超过素材时长仍播放。捕获使用隔离总线并静音输出，不修改系统声音设置，也没有声称验证物理扬声器听感。

## 修复与证据时序

- 初次完整检查有 8 项失败：7 处旧模块数量断言仍为 20／37，1 处 VM 手工导入缺少新增真实依赖。更新为 21／38 并注入真实解析器，原隔离断言保持；[初次日志](app-check-initial.log)、[兼容复测](compatibility-final.log)均保留。
- 首次专项夹具错误使用了不存在的注册表 `get`，改用实际 `resolve`；不是产品缺陷。[原日志](planning-tests-initial.log)保留。
- 审查发现声音自报过短结束时间可遗漏后续指令；现交叉核对声音时钟与演员两步完成时间，并加入伪造短结束回归。
- 真实 Godot 暴露 JSON 数字舍入，导致高精度合法时间拒绝或跨步边界折叠。[失败复现](godot-precision-initial.log)保留；生成内部声明用 IEEE-754 字节传递时间，运行解码并全精度输出，作者 JSON 格式保持。最终严格验证 `0.49999999999999994` 与 `0.5000000000000001` 在 0.5 秒边界两侧，未用容差放宽协议。
- 时间修复后重跑 [11 项真实引擎](godot-final-time.log)、[完整应用](app-check.log)、[浏览器](browser-final-run.log)和准备资源。修复前的 [完整成功轮](app-check-before-clock-fix.log)仍单独保存，不重标。

## 支持边界与重跑

当前只支持非空间音乐／音效和定时播放／停止；Godot 执行标准 PCM16 WAV。用途不是混音总线，自然播放结束不由纯采样器猜测。编辑已有声明，不含创建向导、轨道／指令增删或音频选择器。Bevy 音频、行为事件触发、空间音效及控制回放组合另待实现；生成窗口运行路径已实现，实际验收范围为浏览器与原生有限无头／混音捕获。

```sh
node scripts/check-project.mjs --app-only
node --test scripts/tests/scene-audio*.test.mjs
VIENTO_GODOT_BIN=/可信/Godot路径 node --test scripts/tests/scene-audio-godot.test.mjs
VIENTO_GODOT_BIN=/可信/Godot路径 node scripts/tests/scene-audio-smoke.mjs /usr/bin/google-chrome
```

原生跨实现对比另设置 `VIENTO_AUDIO_CORE_NATIVE` 指向本地构建的 `viento-core`。新一轮浏览器结果使用新的时间目录；旧报告、示例和真实作品保持。可重建临时目录的删除证明与实际结果分别见 [清理计划](cleanup-plan.json)和[清理结果](cleanup.json)；保留记录与最终文档核对见[最终检查](final-checks.json)。本轮不升版、提交、推送或更新安装。

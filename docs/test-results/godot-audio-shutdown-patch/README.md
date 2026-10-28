# Godot 音频退出补丁验收

日期：2026-10-26。Linux x86_64 本地回移已构建、验收并安装；默认 Godot 已切换。42 个独立探针全部通过，原官方引擎保留用于回退。

本轮在原 Godot 4.7.2 源码上回移音频退出清理补丁，目标是消除已复现的 `AudioStreamWAV`／`AudioStreamPlaybackWAV` 退出残留。原有 Viento 协议、作者数据和冻结生成脚本不在修改范围内。

## 固定来源与改动

- 基线提交：`ed1daf0bf001b61586d9930840f2f1394092c079`。
- 上游来源：[Godot #122742](https://github.com/godotengine/godot/pull/122742)，作者 Decryptu。两个提交为 `7cc813110a2c961b2369573e95920026afc23859` 和 `eb5f8e774b5ca29cfbec745829767f82a7e8ec98`；第二个提交仅删除解释注释。本地回移不表示上游 PR 已合并。
- [固定来源清单](../../../scripts/patches/godot-audio-shutdown.json)、[可重建补丁](../../../scripts/patches/godot-audio-shutdown.patch)、[源码下载记录](source-origin.json)、[应用前后校验](patch-verification.json)。

最终只在 `servers/audio/audio_server.cpp` 的 `AudioServer::finish()` 增加五行（含空行）：所有音频驱动停止后，遍历剩余 playback，调用既有删除助手，再调用 `_cleanup_lists()`；随后按原流程释放 buses。它不要求作者增加等待，也不通过过滤警告改变验收结果。

源码归档 SHA-256 为 `e607e9985e1c201bc9cdc1aec8a120f0c3f53b9603f1f828e2b748534a2471ef`。仓库补丁与 `applied.patch` 的 SHA-256 为 `42c59871bc9ff3e5db34c5334a16527b423d4609c332692e7d5771ad26212cfa`；`source-origin.json` 中的 `patchSha256` 指下载的上游 `pr.diff`（`5bf8559845f1280eeb45ce1b24b44144777b8e846dcd8fea873486af4d57775b`），两者的差异是补丁上下文格式，最终源码改动由应用前后校验确认。

## 未修订引擎对照

对照工具版本为 `4.7.2.stable.official.ed1daf0bf`，二进制 SHA-256 为 `8d106cbe6144c2dc7e881d61d2429c1a8a76e6b22ef48bd5e48dcf934953f71e`。42 个独立进程串行运行，**12 通过、30 因退出泄漏失败**；运行前后工具与验证源码摘要未变。[对照汇总](harness/runs/original-regression/summary.json)

| 对照场景 | 进程数 | 结果 |
| --- | ---: | --- |
| 未播放、等待 100 ms、观察弱引用释放、32 轮创建销毁 | 12 | 全部通过 |
| stop/free、清空 stream、等待两个 process_frame | 9 | 全部报告泄漏 |
| 立即播放、停止、重播、暂停、多播放器退出 | 15 | 全部报告泄漏 |
| 非零应用退出：播放中、stop/free 后 | 6 | 全部报告泄漏 |

每种模式重复三次；循环模式每次跟踪 64 个弱引用，最终剩余数必须为零。失败退出模式要求原生退出码恰为 23，其他独立模式要求恰为 0。两帧等待不能保证清理完成；不同历史运行中是否出现退出告警受退出时机影响。

各进程的原始 stdout、stderr、参数与退出码保存在[对照运行目录](harness/runs/original-regression/standalone/)。[原调查](../godot-audio-shutdown/README.md)和本次对照均保留原样，没有用候选结果覆盖历史记录。

## 验证器修订与证据边界

旧对照对应[冻结 v1 清单](harness/revisions/v1-original-regression/manifest.json)。后续采用[冻结 v2 清单](harness/revisions/v2-capture-guards/manifest.json)，三个原生探针与 42 例矩阵保持不变，新增以下结果检查：

- 项目原生运行只接受整数退出码 0 或 1；信号退出、其他退出码、崩溃报告均失败。既有 Node 业务断言仍必须通过，受控失败不能掩盖退出阶段崩溃。
- 每次运行要求 metadata、stdout、stderr 完整对应；逐流检查 EOF 完成标记、字节数和 SHA-256。线程异常、截断、残留 pending 或临时文件均失败。
- 超时后的 TERM／KILL 与排空等待有明确上限；只向本次创建的进程组发信号，无法完整排空时判为失败。

[28 项故障注入汇总](harness/selftests/capture-guards-20261026T121310Z/summary.json)全部通过，覆盖异常退出、日志缺失与损坏、捕获线程失败，以及分离子进程持有管道。该自检没有运行原生 Godot，不能代替候选引擎验收。

新增完整日志捕获覆盖项目的**运行阶段**；`--version`、导入和语法检查仍直接执行真实工具，由既有 Node 断言负责。无退出泄漏告警只支持本报告覆盖的原生音频路径，不表示所有平台、扩展音源或全部音频分配均已完成验证。

## 候选构建与验收

成功构建版本 **`4.7.2.stable.viento_audiofix1_ed1daf0bf`**，大小 168,886,720 字节，SHA-256：

```text
d0214fafa4af018589761b772f38be02b421cd021ed69c45c1d7a4bcd2acbb04
```

[实际身份与动态库](candidate-identity.json)、[构建命令](build-command.json)、[完成记录](build-result.json)和[完整编译输出](build.log)均保留。使用 Clang／LLD 21.1.8、SCons 4.11.1、Linux x86_64 编辑器目标，`debug_symbols=no lto=none -j3`；编译退出 0，日志无编译警告或错误，未在验收后裁剪二进制。保留默认功能与 [AccessKit 0.22.3](accesskit-origin.json)。

最初尝试发现缺少 AccessKit，主动中断后补齐依赖；该中断不计为成功构建，见 [初次记录](initial-build-result.json)和[准备说明](build-setup-notes.txt)。隔离安装 SCons 时也保留了系统缺少 ensurepip 的记录，没有修改系统 Python。构建与回退步骤见[工具链指南](../../GODOT_TOOLCHAIN.md)。

[独立探针](harness/runs/candidate-standalone/summary.json) **42／42 通过**。原官方的 30 个泄漏失败路径在同一探针内容下全部通过；暂停、多播放、重播、立即关闭以及退出码 23 的受控失败均无退出残留。32 轮创建销毁的三次运行均最终回收 64 个弱引用。

[四组项目验收](harness/runs/candidate-projects/summary.json)共 **33 个 Node 用例通过／33 项，31 次原生运行**：

| 套件 | Node 结果 | 原生运行次数 | 业务日志 |
| --- | --- | ---: | --- |
| causal-visit-release | 1／1，跳过 0 | 1 | [日志](harness/runs/candidate-projects/projects/causal-visit-release/tests.stdout.log) |
| scene-switching | 8／8，跳过 0 | 8 | [日志](harness/runs/candidate-projects/projects/scene-switching/tests.stdout.log) |
| scene-audio | 11／11，跳过 0 | 7 | [日志](harness/runs/candidate-projects/projects/scene-audio/tests.stdout.log) |
| project-audio-control | 13／13，跳过 0 | 15 | [日志](harness/runs/candidate-projects/projects/project-audio-control/tests.stdout.log) |

全部原生运行通过无泄漏、退出码与双流捕获完整性检查。正常退出与受控失败保持原业务断言；声音测试包含混音缓冲验证，不等同于物理扬声器验收。两个候选阶段使用完全相同的工具身份及验证源码，阶段内、安装前均再次校验摘要。测试包装器只为运行命令加 `--verbose` 并完整保存输出；冻结临时项目记录的是包装器身份，真实候选身份由阶段摘要和上述二进制摘要另行固定。

## 安装与回退

[安装记录](installation.json)确认 `candidateInstalled=true`、`defaultSelected=true`、`appRestarted=false`。候选独立安装于 `godot/4.7.2-viento-audiofix1/linux-x86_64/`，与许可证、来源清单和切换前启动器一同保存；原官方 `4.7.2-stable` 二进制摘要不变。安装后二进制与完整验收时逐字节一致。

[安装后复核](postinstall.json)直接运行已安装二进制的 8 个播放器同时播放后立即退出的单次探针，通过且无残留；同时验证默认路径、显式 `VIENTO_GODOT_BIN` 和显式空值优先级。启动器检查使用只把末行 AppImage 启动替换为打印的临时副本，没有启动或重启 Studio。本机 AppImage 仍为 0.2.0，当前工作树为 0.2.5 开发状态，本轮只更新本机 Godot 工具链。

新启动的 Studio 使用修订默认值。旧冻结构建仍绑定旧工具版本与 SHA-256，改用新工具时应显式重新构建；不要修改旧清单摘要来跳过 `runtime_tool_changed`。回退可显式指定原官方路径，或恢复保存的启动器。作者文件与素材无需迁移。

## 保留与维护检查

[保留核对](preservation.json)检查本轮开始时已有文件；产品代码与此前所有测试报告保持原字节。[图谱核对](atlas-check.json)只补充工具链修订证据和边界，不提高功能成熟度分数。[文档链接](docs-links.json)另行检查。构建缓存的处理与保留路径见[清理记录](cleanup.json)。本轮没有重跑全量产品测试、发布新版本或验证其他平台／物理设备。

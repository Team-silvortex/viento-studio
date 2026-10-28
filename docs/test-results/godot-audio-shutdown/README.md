# Godot 音频退出对象残留调查

2026-10-26，0.2.5开发工作树，Linux x86_64、Godot4.7.2.stable.official.ed1daf0bf。调查上一轮[因果锚点测试](../runtime-causal-anchors/README.md)的2个ObjectDB对象退出警告。本轮已定位原因，**尚未修复引擎本体**；产品代码、生成器、工具链和安装均保持。

## 结论

详细输出明确对象为一个 `AudioStreamWAV` 和一个 `AudioStreamPlaybackWAV`，各剩1引用，不能把数量2解释为两条轨道。项目的 `audio_shutdown()` 已停止播放器，随后场景节点被移除并递归释放。

完全独立于Viento的Godot脚本可以复现同样结果：停止、释放节点或额外清空stream均不能使服务器立即放弃播放引用。匹配的[上游问题 #76745](https://github.com/godotengine/godot/issues/76745)和[修复提案 #122742](https://github.com/godotengine/godot/pull/122742)说明，stop只标记播放项等待删除，混音回合负责回收；引擎结束时驱动停止，剩余列表未完整清空。[当前提交源码](https://github.com/godotengine/godot/blob/ed1daf0bf/servers/audio/audio_server.cpp#L1196)与此相符。截至调查时PR仍未合并，不是已交付修复。

这是音频服务器退出清理缺口。本机无头模式可稳定触发；上游也报告真实音频设备，因此不限定为Dummy驱动问题。当前本地实验不代替物理设备或其他平台验收。

## 项目重现

[原测试输出](project/test.log)只选择实际切场景例，1项通过；[运行stdout](project/stdout.log)保存verbose对象身份，[stderr](project/stderr.log)保留原始警告。[摘要](project/summary.json)记录源码、作者摘要、会话一致性和临时运行目录清理。导入与运行均退出0，运行逻辑正常完成，但这不证明退出无残留。

此次只用[临时启动器](project/godot-verbose.sh)加入verbose；版本查询原样透传。项目摘要中的工具路径／哈希是启动器，实际二进制身份以[独立探针摘要](summary.json)为准。没有改作者脚本或冻结运行生成层。

## 独立对照

[probe.gd](probe.gd)不导入任何Viento模块，不需要工程或外部素材：内存生成静音PCM WAV，记录stream和playback弱引用。六种路径各运行3次，共18次，原始输出在 `minimal-logs/`，完整结果见[摘要](summary.json)。

| 路径 | 退出残留警告 | 退出前弱引用 | 解释 |
| --- | --- | --- | --- |
| 创建但从不播放 | 0／3 | 均归零 | 单纯创建和释放资源正常 |
| 播放→stop→free→立即退出 | 3／3 | 两对象仍存活 | 复现服务器持有播放引用 |
| 再额外清空player.stream | 3／3 | 两对象仍存活 | 只清播放器引用不能解决 |
| 等两帧再退出 | 0／3 | 两对象仍存活 | 无警告不等于退出前已回收，存在时序差异 |
| 等100毫秒 | 0／3 | 均归零 | 仅证明本次环境有时间回收，不承诺通用等待时长 |
| 按弱引用等待归零，最多500毫秒 | 0／3 | 均归零 | 观察实际完成，而非用日志安静推断 |

[循环探针](cycles.gd)另执行3轮，每轮创建、播放、停止并销毁32次，共跟踪64个对象。三轮最终均全部回收，退出无警告；停止后的瞬时待回收数量在2–8个间波动，最后等待34毫秒归零。见[循环摘要](cycles-summary.json)。这支持“本机短时运行会回收，立即退出暴露缺口”，不声称已经证明任意长时间运行或所有驱动无内存泄漏。

## 复现与处理边界

把两个gd文件复制到临时目录后，用实际Godot路径执行：

```sh
/path/to/Godot --headless --verbose --path /tmp/audio-probe --script /tmp/audio-probe/probe.gd -- stop-free
/path/to/Godot --headless --verbose --path /tmp/audio-probe --script /tmp/audio-probe/probe.gd -- never-play
/path/to/Godot --headless --verbose --path /tmp/audio-probe --script /tmp/audio-probe/cycles.gd
```

其余模式为 `clear-stream`、`two-frames`、`wait-100ms`、`observe-release`。观察字段的before／after分别对应节点已释放及等待完成时。退出码0不自动代表无残留，需同时读stderr、verbose对象列表和弱引用。

可靠修复点在Godot音频服务器关停清理。本轮没有把固定等待时间加进项目执行，没有关闭警告，也没有重编或替换本机引擎。后续采用包含修复的工具版本时，用本报告脚本核对修复后立即退出也无残留，并重跑声音播放／停止、切场景及失败关闭链路。显式有界的宿主清理阶段可以另行设计，不能把一次等待有效包装成根治。

[保留核对](preservation.json)确认原报告与产品源码保持。[图谱检查](atlas-check.json)只更新已知能力边界和证据，功能／实现／评分数量及数值未变化。[文档链接核对](docs-links.json)另行记录。本轮仅诊断脚本和文档变更，没有重新运行全量产品测试或声称警告已消失。

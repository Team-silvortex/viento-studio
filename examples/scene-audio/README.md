# 场景声音示例

先将本目录复制到新的临时工程，再用当前源码打开副本。不要在原示例或真实作品中试验。

`documents/audio/demo.json` 声明两个轨道，复用自生成的 1 秒 440 Hz PCM16 单声道 WAV。音乐轨道以 0.12 音量循环，在 0 秒播放、0.5 秒停止；音效轨道以 0.3 音量单次播放，在 0.25 秒启动。`role` 是用途标签，不是混音总线。没有绑定外部素材或作者脚本。

打开声音文档并进入 **编辑 → 原文 → 编辑场景声音**，可修改用途、音量、循环和指令时间／动作；审阅并应用后仍须普通保存。构建目标选择 `documents/scenes/demo.json`。Godot 有限无头测试执行到 0.5 秒；真实声音输出另由运行设备决定。

```sh
cp -a examples/scene-audio /tmp/my-audio-workspace
node scripts/project-build.mjs --root /tmp/my-audio-workspace --scene documents/scenes/demo.json
```

目标目录应事先不存在。配置 Godot、后端工程交付及声音关联结构见[场景声音指南](../../docs/SCENE_AUDIO.md)。Bevy 当前明确拒绝声音能力；不要将无头命令成功等同于扬声器出声。

本例的 `assets/tone.wav` 由正弦波公式生成，和本项目采用相同许可证，可自由用于本例验证。完整哈希登记在 `metadata/assets/`，声音文档同时引用场景并绑定素材，确保迁移与交付闭包完整。

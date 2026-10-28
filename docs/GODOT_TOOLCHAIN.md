# Godot 本地修订工具链

Viento 的 Godot 可执行文件由可信宿主配置 `VIENTO_GODOT_BIN` 指定；作者工程不能指定或替换它。工具放在本机缓存或专用工具目录中，不属于作者素材，也不随生成工程 ZIP 分发。

## 音频退出修订

本地修订 `viento_audiofix1_ed1daf0bf` 基于 Godot 4.7.2 提交 `ed1daf0bf001b61586d9930840f2f1394092c079`，回移上游 [#122742](https://github.com/godotengine/godot/pull/122742) 的最终五行改动。该改动在所有音频驱动停止后清理剩余播放引用，修复已定位的 WAV／PlaybackWAV 退出残留。它不更改 Viento 运行协议、作者数据或生成脚本。

[补丁](../scripts/patches/godot-audio-shutdown.patch)与[固定来源清单](../scripts/patches/godot-audio-shutdown.json)可供重建。修订名称表明这是本地回移，不能据此称上游PR已合并。具体二进制、编译参数、验证范围与安装状态见[修订验收](test-results/godot-audio-shutdown-patch/README.md)；原问题与未修复基线见[退出调查](test-results/godot-audio-shutdown/README.md)。

## 重建

1. 在项目之外准备构建目录，按来源清单下载固定提交的源码归档并核对 SHA-256。
2. 保存未修改的 `servers/audio/audio_server.cpp` 摘要，用 `git apply --check` 检查后应用补丁；确认源文件只有五行插入。
3. 使用 SCons 4.11.1。可通过 `pip --target` 安装到构建目录，避免改动系统Python；用 `PYTHONPATH` 指向该目录。
4. 保留 Godot 默认功能。Linux编辑器需要固定版本 AccessKit 0.22.3；对应源码的 `misc/scripts/install_accesskit.py` 指定官方下载地址。至少保留include和`lib/linux/x86_64/static`，传入正确 `accesskit_sdk_path` 或放在源码的 `bin/build_deps/accesskit`。
5. 在源码目录编译：

```sh
BUILD_NAME=viento_audiofix1_ed1daf0bf \
PYTHONPATH=/absolute/build/scons-site \
python3 -m SCons platform=linuxbsd target=editor arch=x86_64 \
  use_llvm=yes linker=lld debug_symbols=no lto=none -j3
```

本轮使用系统Clang／LLD并保留线程、音频、图形与屏幕阅读器支持。`target=editor`是必要条件：Viento会调用`--editor --import`，不能直接以导出模板替换。构建会生成独立版本标识；实际发布或跨平台使用仍需各自验收。

## 验证、切换与回退

先用候选二进制运行独立立即退出、暂停、多播放器、失败退出及循环释放探针，再运行场景声音、项目声音控制与场景切换用例。退出码、业务断言、完整verbose输出都必须核对；不能仅通过增加等待或过滤警告宣布修复。

验证后的二进制与Godot许可证、来源清单一起放入独立修订目录，再修改本机启动器的默认工具路径。显式传入的 `VIENTO_GODOT_BIN` 继续优先。保留原官方二进制和切换前启动器，便于恢复。已运行的Studio进程不会被这项配置更新自动重启；新启动使用新默认值。

每份冻结构建都保存工具版本和二进制SHA-256。改用修订引擎运行旧构建会得到 `runtime_tool_changed`，应显式重新构建；不要改旧清单中的工具摘要来绕过检查。作者文件和素材无需迁移，旧会话报告保持原时点。

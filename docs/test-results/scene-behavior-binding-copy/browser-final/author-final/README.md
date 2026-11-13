# Crystal Courtyard / 晶石庭院

第一份俯视收集参考游戏初稿，使用普通作者文件连接设定、玩家投影、四场景、原生物理触发、相机、HUD、动画、声音与显式重试。先复制本目录，再用当前源码 Studio 打开副本；作者操作草案、玩法与素材许可见 [工程内指南](documents/guide.md)。

方向键移动，收集三枚金色晶体后青色门开启，进入门后出口通关。红色区域每次进入扣一点生命，三点耗尽后失败；开始／通关／失败页按 Enter 或 Space 开始新尝试。Escape 结束预览。没有测试专用得分或通关键。

从仓库根目录检查和构建：

```sh
npm run project:build -- --command plan --root examples/topdown-collect --target documents/projects/game.json
VIENTO_GODOT_BIN=/绝对路径/Godot可执行文件 npm run project:build -- \
  --command build --root examples/topdown-collect --target documents/projects/game.json
```

在界面中选择 **构建与运行 → 项目组装**，打开 `documents/projects/game.json`，检查、构建后启动窗口预览。直接运行生成工程前需要用 Godot 导入素材；正常 Studio 运行链负责这一步。所有玩法只写在已登记的 TXT 行为中，不修改生成工程。玩家背景只保存在设定原文，投影保留引用；拾取后隐藏触发区并关闭监测，开门后关闭碰撞，始终保留逻辑实例直到该次场景退出。

这是有限会话下的工作流初稿，不代表 0.3 或 0.5.0 验收完成。尚无暂停、同场景即时重启、跨启动存档或独立游戏发行；当前原生运行仍需 Godot，HUD 英文避免依赖尚未接通的中日文字体资源。源码／平台／安装覆盖见 [状态](../../docs/STATUS.md)。

本目录全部为合成示范数据。六份 SVG 与三份短 WAV 为原创 **CC0-1.0** 素材；作者脚本与其余文本遵循仓库 [GNU GPL v3 许可证](../../LICENSE)。`.viento.zip` 保留工程内指南及许可说明，顶层 README 不属于作者正文。

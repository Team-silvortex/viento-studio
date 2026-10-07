# Bevy 无头样例

同一份无图片 Scene2D v2 计划可交给 Godot 或 Bevy。两份实例复用同一个 OC 定义；固定 0.25 秒移动检查后，第一个实例向右 40，第二个保持原位。

Bevy 的当前能力仅为受信本机运行器上的无头 ECS 检查，不提供渲染或作者 Rust 脚本。完整步骤见 [Bevy 接入](../../docs/BEVY_BACKEND.md)。请复制到临时工程再试用，生成产物放在作者工程之外。

```sh
# 在 Viento 仓库根目录，先按指南构建并设置 VIENTO_BEVY_BIN。
npm run project:build -- --command plan \
  --root /绝对路径/样例副本 --scene documents/scenes/demo.json --backend org.viento.bevy
npm run project:build -- --command build \
  --root /绝对路径/样例副本 --scene documents/scenes/demo.json \
  --backend org.viento.bevy --tool "$VIENTO_BEVY_BIN" --output /绝对路径/新输出目录
npm run project:build -- --command run --build /绝对路径/新输出目录 \
  --backend org.viento.bevy --tool "$VIENTO_BEVY_BIN"
```

对照 Godot 时将后端换为 `org.viento.godot4`，工具换为 `VIENTO_GODOT_BIN`，并使用另一个新输出目录。定义 `objectId` 共用，实例 `instanceId` 独立；第一份最终位置 `[240, 220]`，第二份 `[500, 220]`，状态均为 `idle`。作者正文、登记和 UUID 在运行前后应保持原样。

样例没有素材或行为清单。加入图片后 Bevy 会拒绝缺失的 `image` 能力；GDScript 行为与窗口也不在这条线的支持范围。静态预览仍可查看设计布局，与引擎运行分别验收。

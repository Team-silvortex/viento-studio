# Scene2D 独立样例

这是一份小型、合成的 v3 工程，用于验证“Viento 文档与元数据 → 构建计划 → Godot 工程 → 独立运行”。图片由本仓库直接定义为 SVG，不含外部作品素材。

`documents/scenes/demo.json` 定义 800 × 480 场景、一个带图片的角色、方向键移动和 idle / moving 状态。`documents/characters/traveler.md` 保留角色名称与背景，元数据使用稳定 UUID 记录场景引用和图片绑定。空场景模板不复用样例角色 UUID；新场景需填写自己的已登记角色后才能构建。

从仓库根目录：

```sh
npm run project:build -- --command plan --root examples/scene2d --scene documents/scenes/demo.json
VIENTO_GODOT_BIN=/绝对路径/Godot可执行文件 npm run project:build -- \
  --command build --root examples/scene2d --scene documents/scenes/demo.json
```

构建与运行参数、数据边界及限制见 [使用说明](../../docs/PROJECT_BUILD.md)。修改时先复制完整工程；生成物默认写到本机缓存，不写进此目录。示例可作为普通工程打开；Linux 编辑服务配置 Godot 后，可使用顶部“构建与运行”面板。

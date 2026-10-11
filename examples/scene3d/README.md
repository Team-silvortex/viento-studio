# 3D 原始场景样例

这是独立的实验性 `viento-scene3d` schema 1 作者文件，使用三个方块、透视相机与方向光。Y 轴向上、右手坐标系，镜头朝本地 −Z；位置与尺寸以米解释，旋转以度声明并使用 XYZ 顺序。实例 UUID 显式持有；它不是 OC／投影定义或 Scene2D 配方。

开发依赖准备后，可在仓库根目录输出独立计划：

```sh
npm run --silent scene:3d -- --input examples/scene3d/scene.json --emit plan
```

导出可检查的 Godot 工程，输出目录必须不存在：

```sh
npm run --silent scene:3d -- --input examples/scene3d/scene.json --output /tmp/viento-3d-example
```

明确提供 Godot 可执行文件，可在同一次导出中用 `--check` 检查、或 `--run` 有限无头实测。`source.json` 保留作者原字节，`plan.json` 为派生计划，`scene3d-project.json` 列出固定工程文件和指纹；不会登记为现有 2D 后端工程或改写原作者文件。

编辑器使用现有 JSON 文档创建与普通保存。在源码模式打开这份内容后点击 **3D 预览**；预览只读，视角调整不写回作者相机。更完整的边界见[3D 初步接入](../../docs/SCENE3D.md)。

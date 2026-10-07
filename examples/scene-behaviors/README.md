# 场景行为样例

将此目录复制到临时工程后，通过构建工作台或 Scene2D CLI 检查、构建并运行。两个场景实例复用同一份已登记 TXT GDScript 源码，使用独立参数，初始化信号分别产生 `checkpoint` 事件。

场景的 `behavior` 关系显式选择独立绑定文档；该文档的普通引用关系保存场景和源码的迁移闭包。作者数据仍是原文与登记，生成的 `.gd` 文件只存在于外部构建目录。脚本作为本机用户代码执行；本轮只支持独立 Node、标量导出参数与最多四个标量信号参数。

旧 `examples/scene2d` 样例和无行为场景仍使用原计划与运行协议；行为样例才使用 plan/runtime v3。


在仓库根目录准备一份独立副本：

```sh
cp -a examples/scene-behaviors /tmp/my-behavior-workspace
node scripts/project-build.mjs --root /tmp/my-behavior-workspace --scene documents/scenes/demo.json
```

先确保目标目录不存在，随后按[行为指南](../../docs/SCENE_BEHAVIORS.md#试用)配置实际 Godot 并构建到工程外。预期为两份绑定、一份源码，以及 `checkpoint` 参数 `['east', 40]` 和 `['west', 20]` 的两个独立事件。静态预览仅展示布局，不检查或执行行为。更改副本中的绑定与脚本后重新构建，不直接修改示例或旧构建产物。

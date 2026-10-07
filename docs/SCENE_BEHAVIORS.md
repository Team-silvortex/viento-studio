# 场景实例行为

0.0.8 源码已接通“已登记场景实例 → 独立绑定文档 → 已登记行为源码 → 参数 → 运行事件”。第一种实际实现是 Linux Godot 4 的 GDScript Node 行为。纯绑定规则、冻结执行中间层和 Godot 实现分别维护，界面不解析或执行 GDScript。

行为不写入 OC 定义或旧 Scene2D 的演员字段。Scene2D v2／v3 实例可引用独立 JSON 绑定文档；行为源码使用普通已登记 TXT 文档，在编辑器源码模式编辑。没有行为的场景仍产生原 plan/runtime v1／v2；明确启用行为时才产生新的 plan/runtime v3。World v1 的 `behaviorBindings` 仍为空，不因此升级 World、workspace 或 Scene2D 作者格式。

## 试用

将 [完整样例](../examples/scene-behaviors/README.md) 所在目录复制到临时工程。构建工作台会显示两份实例绑定和一份行为源码：检查计划、构建，再点击无头测试。两个演员复用同一份源码，参数分别为 `east / 40` 和 `west / 20`；列表会显示两个独立 `checkpoint` 事件。当前静态场景预览只展示布局，不校验或执行绑定；保存态绑定错误仍可能得到有效几何预览，运行事件来自实际引擎进程。

现有 CLI 同样接通，不增加加载模块或指定行为路径的 HTTP 参数：

```sh
node scripts/project-build.mjs --root /tmp/my-behavior-workspace --scene documents/scenes/demo.json
node scripts/project-build.mjs --command build --root /tmp/my-behavior-workspace --scene documents/scenes/demo.json --godot /absolute/path/to/godot --output /tmp/my-behavior-build
node scripts/project-build.mjs --command run --build /tmp/my-behavior-build --godot /absolute/path/to/godot
```

输出目录必须位于作者工程和素材目录之外，且此前不存在。修改已保存的源码或绑定后需重新检查、构建；运行始终使用冻结产物。打开的未保存文档仍触发原草稿保护。

## 作者文件与登记

三类数据各有稳定 UUID：场景文档、绑定文档和行为源码文档。场景的元数据通过 `kind: "behavior"` 关系明确指向绑定文档；最多选择一份。绑定文档通过普通的非 `part-of` 引用关系，登记其场景和每份源码依赖。正文中的 UUID 与登记边必须一致；示例用已有 `reference` 关系。

绑定文档使用严格 JSON：

```json
{
  "format": "viento-scene-behaviors",
  "schemaVersion": 1,
  "sceneObjectId": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "bindings": [
    {
      "bindingId": "99999999-9999-4999-8999-999999999991",
      "instanceId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      "implementation": {
        "backendId": "org.viento.godot4",
        "language": "gdscript",
        "sourceObjectId": "ffffffff-ffff-4fff-8fff-ffffffffffff"
      },
      "parameters": { "checkpoint": "east", "amount": 40 },
      "events": [ { "signal": "arrived", "event": "checkpoint" } ]
    }
  ]
}
```

每份绑定文档只声明一种后端和语言；`instanceId` 必须属于该场景。重复的 OC 定义允许存在，绑定和事件使用实例 UUID 区分。`bindingId` 在同一文档中唯一，同一个实例可以挂多份具有不同绑定身份的行为。

当前限制：绑定正文 32 KiB，1–32 份绑定，最多 8 份源码；每份源码 64 KiB，合计最多 512 KiB。每份绑定最多 32 个具名参数、8 个信号映射。参数和信号名使用 ASCII 标识符，参数只接受布尔值、有限数字和不超过 4096 个 UTF-16 码元的文本（如多数 Emoji 占两个码元）；整数不能超出 JavaScript 安全整数范围。不支持数组、字典、资源引用、任意 Variant 或隐式类型转换。

普通保存可保留尚未完成的绑定和源码，完整工程包继续保存其原字节。构建和选择式资源包会检查完整声明及依赖，不能用没有登记的文件或本机绝对路径补齐。源码必须是已登记 TXT 文档；无需把 `.gd` 文件或引擎缓存放入作者素材目录。

## Godot 实现与事件

样例源码是普通 TXT 原文，生成时按源码 UUID 原字节复制为 `behaviors/<UUID>.gd`：

```gdscript
extends Node

signal arrived(checkpoint: String, amount: float)
@export var checkpoint: String = "dock"
@export var amount: float = 0.0

func _ready() -> void:
    arrived.emit(checkpoint, amount)
```

适配器检查脚本编译；运行时读取脚本自己的导出属性和信号元数据，先核对类型，设置参数并连接信号，再把独立 Node 加入对应演员节点。行为须能以无参数构造函数创建 Node。参数只能写脚本自身的导出属性，不能借参数接口写 `name`、`script` 等 Node 内建属性；整数参数可赋给浮点导出属性，分数不能赋给整数导出属性。

映射信号最多携带四个明确类型的标量参数。运行事件包含 `protocol: 3`、`event: "behavior"`、`bindingId`、`instanceId`、`objectId`、声明的事件名 `name` 和参数数组 `arguments`。身份来自冻结绑定，信号参数不能改写事件归属。协议读取器检查已知身份、事件别名、标量和生命周期，拒绝在 ready 前或 finished 后发送行为事件。

脚本按当前本机用户权限运行；生成项目和独立进程不是代码沙箱。初次接入保留既有方向键移动测试，不提供跨引擎源码互译、任意方法调用 RPC、热重载、行为参数编辑表单或通用状态机。其他语言可以作为作者声明保留，但当前执行器只有 GDScript 能力，缺少对应能力时拒绝构建。

## 冻结、诊断与迁移

计划 v3 包含绑定来源、精确源码原文和实例配对；整个工程观察仍包含正文、登记与摘要。构建与运行共用同一纯规划入口，恢复时重算绑定，核对工具、生成器、执行适配器和每份生成文件，不能直接信任产物里改写的脚本或绑定。源码工程离线后仍可回放已完成构建。

编译诊断根据生成的源码 UUID 映回冻结 TXT 原文；运行参数诊断映回绑定文档的 JSON Pointer。精确范围和正文修订由冻结作者数据确定，引擎输出不能指定编辑器路径。点击诊断后沿用已有的原文导航和过期定位保护。

选择式资源包从绑定正文重新推导场景与源码 UUID，并复验元数据边、实例和内容预算；读包及导入同样复核。已锁定的外部依赖在导入时验证具体内容和摘要，场景和源码这些直接依赖不能借目标工程里碰巧存在的同 UUID 文件补缺。包内场景必须同时声明其角色定义依赖，不能借未声明的目标对象；若场景本身是已锁定的外部依赖，则可沿其已锁定元数据边读取传递角色，读取仍核对内容摘要和并发修订。场景、定义、图片、绑定和 TXT 原文随闭包迁移，生成工程和缓存不进入包；完整 `.viento.zip` 仍按原规则保存作品。

职责与后端七项能力见 [执行中间层](BACKEND_MIDDLEWARE.md)，场景操作见 [构建与运行](PROJECT_BUILD.md)，迁移见 [资源包](RESOURCE_PACKAGES.md)。本轮实际验证保存在 [行为运行记录](test-results/scene-behavior-runtime/results.json)，既有报告保留原条件。

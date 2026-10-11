# 3D 初步接入（实验性）

0.0.10 源码接入独立 `viento-scene3d` schema 1：作者以 JSON 描述方块实例、相机与方向光，共享 Rust 核心校验，独立 WebGL2 视图预览，并可导出可检查的 Godot 工程进行有限无头实测。作者原文通过现有文档编辑与普通保存持久化；3D 表示、渲染和执行适配各自分开。

## 在编辑器中预览

使用现有 JSON 文档类型创建并保存正文。可复制[三个方块样例](../examples/scene3d/scene.json)，在原文编辑模式点击 **3D 预览**。预览读取当前编辑会话，已保存内容和未保存草稿都可查看；**刷新当前草稿**读取最新原文。选择对象可查看身份、位置、旋转、尺寸和原文路径。视角操作只改变观看方式，**重置视角**回到作者相机。

预览不授予保存或引擎执行权限。原文无效时保留最近有效画面并显示诊断；切换文档或离开原文会话后，旧响应不能更新新窗口。关闭时释放渲染资源。旧核心缺少 3D 能力或宿主不支持 WebGL2 时，界面明确说明当前不可预览；普通编辑与 2D 入口继续可用。

## 作者表示

场景具有 `format: "viento-scene3d"`、`schemaVersion: 1`，以及 `name`、`viewport`、`background`、`camera`、`light`、`objects`。各级声明严格校验，规则见[JSON Schema](../schemas/scene3d-v1.schema.json)；跨字段约束和完整数值预算由 Rust 额外执行。

| 字段 | 当前语义 |
| --- | --- |
| `viewport` | 两个 1–8192 的整数，表示作者视口宽高，预览保持该比例随窗口缩放 |
| `background` | 六位十六进制颜色 |
| `camera` | `position`、`target`、透视 `fovDegrees`、`near`、`far` |
| `light` | 方向向量 `direction`、六位颜色 `color` 与 0–16 的 `energy` |
| `objects` | 1–128 个显式稳定 `instanceId`、名称、`primitive: "box"`、位置、旋转、尺寸与颜色 |

使用右手坐标系，Y 向上，镜头沿本地 −Z 观看；位置与尺寸以米解释。`rotationDegrees` 采用 XYZ 欧拉顺序，渲染矩阵为 `T · Rx · Ry · Rz · S`，Godot 适配显式指定同一顺序。绘图和 Godot 向量使用浮点表示；极远位置和很小尺寸的组合仍可能受绘图精度影响，作者声明保持原值。尺寸为 0.001–1000，位置各分量为 −100000–100000，旋转各分量为 −36000–36000；名称长度为 1–256 个 Unicode 码点。预览绘制缓冲按设备像素比例缩放，每边最多 2048 像素。

相机视点与目标至少相距 0.01，视向水平分量与总长度之比至少为 0.0001；方向光也须非零并满足同一水平比例，避免与 Y 向上约定平行。`near` 为 0.001–10000，`far` 不超过 100000，二者至少相差 0.001，且 `far` 至少为 `near` 的 1.01 倍。视角为 1–179 度。原文限制 128 KiB UTF-8；BOM、CRLF、数值拼写和稳定身份在读取与导出中保持。

派生模型和计划保持声明顺序、稳定身份和作者数值。对象来源包含 JSON Pointer 与精确 UTF-16 范围；范围只对应生成它的原文。当前几何对象不要求 OC 定义或投影依赖；后续模型素材、投影、层级和行为分别定义自己的版本与引用规则。

## 导出和实际引擎检查

在仓库根目录准备开发依赖后，可只读输出模型或计划：

```sh
npm run --silent scene:3d -- --input examples/scene3d/scene.json --emit model
npm run --silent scene:3d -- --input examples/scene3d/scene.json --emit plan
```

导出到不存在的目录：

```sh
npm run --silent scene:3d -- --input examples/scene3d/scene.json --output /tmp/viento-3d-export
```

明确提供本机 Godot 可执行文件，可在同一次导出中增加 `--check --godot-bin /absolute/path/to/godot`，或 `--run --godot-bin /absolute/path/to/godot`。运行只接受当次导出所持有的来源与文件凭据，先检查生成工程，再执行有限 3D 探针；不会扫描认领或运行已有外部工程。

| 导出文件 | 用途 |
| --- | --- |
| `source.json` | 作者原字节，可用于迁移与重新生成 |
| `plan.json` | 独立 `kind: "scene3d"` schema 1 的派生计划 |
| `project.godot`、`scene.tscn`、`runtime.gd` | 可直接检查的 Godot 工程源码 |
| `scene3d-project.json` | 原文与计划摘要、固定文件库存、大小及 SHA-256 |

引擎产生的缓存仍属于这份派生工程。现有 2D 后端工程目录、运行控制、用例和事件协议保持原有契约；3D 实测记录自己的静态树、相机、灯光、几何与变换结果。此阶段不包含物理、材质贴图、模型文件、动画、行为绑定或 3D 编辑事务。

## 模块与验证范围

`org.viento.scene3d` 只依赖文档模块，提供 `scene.representation.scene3d` 与 `scene.preview.scene3d`。工程需求是声明数据，实际核心、WebGL2 和工具可用性各自检测；预览仅取得当前来源读取接口。模板类型名和戏剧场次不会隐式变为 3D 数据。

[本轮验证](test-results/scene3d-primitives/results.json)分别记录原生／WASM、纯层、界面、实际 WebGL2、Godot 及资源副本。源码接入和浏览器证明不代表新安装包或 Android 设备验收。

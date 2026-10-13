# 二维功能对接表

核对日期：2026-10-13；源码基线 0.1.1，包含其后未发布的配方创建／生成、查找替换和任务问题列表。本页说明当前二维工作流如何交接。功能身份、实现绑定和评分以 [功能图谱 JSON](function-atlas.json) 为准；这里不另设总分或完成率，也不把引擎原生能力当作 Studio 已接入能力。

[空工程到 Godot](function-atlas.html#workflow=oc-projection-composition-runtime) · [普通二维主线](function-atlas.html#workflow=author-to-delivery) · [配方到工程交付](function-atlas.html#workflow=composition-to-delivery) · [配方与 Godot 行为](function-atlas.html#workflow=composition-godot-behaviors) · [Bevy 数据交付](function-atlas.html#workflow=bevy-data-delivery)

## 从入口到实现

| 阶段 | 内置入口与数据交接 | 实现归属与边界 |
| --- | --- | --- |
| 设定 | 普通文档／字段编辑；世界与对象创建、登记稳定身份 | `authoring.document-edit`、`world.object-create`；原文、登记和素材继续是作者数据 |
| 设定投影 | 从同一 OC 创建多份用途投影，保存后供实例引用 | `projection.authoring`；投影是独立文档，实例可继承或明确覆盖其运行字段 |
| 普通二维场景 | 构建与运行中的创建／编辑场景，默认稳定实例，可启用逻辑分组 | `scene.instances_v2`、`scene.groups_v3`；[`scene.create/update`](../engine/world-scene-create.mjs) 负责作者事务。逻辑分组不隐式变换位置 |
| 配方创作 | 新建场景配方 → 多演员对象／投影清单 → 可选起始排布 → 完整 JSON 审阅 → 普通草稿与保存；九个独立编辑区继续丰富 | `scene.composition_create`、`scene.composition`、`scene.authoring_workflow`；只读目录、Rust 校验、独立助手与普通保存分别负责 |
| 配方转运行场景 | 场景预览 → 从配方创建场景 → 审阅完整展开内容 → 保存新的 Scene2D | `scene.composition_materialize`；Rust 展开、JS 创建规划、独立对话框和共享创建事务分开。原配方不改写，生成场景不自动同步 |
| 脚本与行为（可选） | 新建脚本 → TXT 草稿 → 普通保存；添加场景行为 → 参数／信号编辑 → 保存 | `script.authoring`、`behavior.creation`、`behavior.authoring`；Godot/GDScript 路线。已有绑定清单可直接编辑，不要求先走首次创建 |
| 静态预览（可选） | 场景预览可读取保存态或当前有效草稿 | `scene.saved_preview` 与草稿预览切片；预览不执行脚本，也不证明后端运行效果 |
| 计划与构建 | 已保存 Scene2D → 检查计划 → 显式构建 | `build.snapshot_plan`、`execution.backend_middleware`、`build.workbench_lifecycle`；中立计划通过具体后端能力准入，再冻结依赖和工具身份 |
| 运行与诊断 | 显式无头测试／受支持的窗口预览；观察事件和任务问题，核对来源后打开原文 | `runtime.godot_generated_project` 或 `runtime.bevy_rust`；`build.task-problems` 保留单任务来源，修改后需要明确重验 |
| 工程管理 | 后端工程详情、文件核对、持久列表与显式运行选择 | `backend.project_management`、`backend.project_catalog`；生成工程和本机缓存不回写作者工程 |
| 工程交付 | 交付工程 → 准备包 → 下载／保存 | `backend.project_delivery`；仅打包成功登记且库存校验通过的生成文件。完整作者迁移另走作品备份，独立游戏发行仍是规划项 |

各阶段是可选择的业务路线，不是必须逐个调用的接口序列，也不是覆盖整条链路的一次原子事务。无行为场景可直接进入构建；首次行为创建与既有行为编辑是不同入口。

## 当前后端映射

以下按 [Godot 适配器](../scripts/backends/godot4-adapter.mjs) 与 [Bevy 适配器](../scripts/backends/bevy-adapter.mjs) 的能力声明及现有交付契约核对。宿主服务当前固定一个后端；界面尚无引擎切换器。

| 对接能力 | Godot 4 | Bevy |
| --- | --- | --- |
| 无行为二维计划 | plan 1／2 | plan 1／2，仅无图 |
| 作者 Scene2D v3 逻辑分组 | 保留作者结构，无行为时生成 plan 2 | 同样可生成无图 plan 2；组不是空间变换 |
| 图片资源 | 已接入 | 未接入，带图计划明确拒绝 |
| 参数／信号和作者脚本 | GDScript 行为生成 plan 3 | 未接入作者 Rust 编译，也不执行 GDScript |
| 无头逻辑运行 | 已接入 | 已接入可信固定运行程序 |
| 有限控制回放与按实例输入 | 无行为 plan 1／2；按实例输入限 plan 2 | 同范围；不是持续键盘或任意实时对象编辑 |
| 独立窗口预览／截图 | 已接入具体后端能力 | 未接入 |
| 嵌入运行视口／GPU 计算接口 | 尚未声明 | 尚未声明 |
| 工程交付内容 | `project.godot`、场景、脚本及资源 | `scene-data.json` 数据工程，不是 Cargo 作者工程 |
| 接收方需求 | 兼容的 Godot 工具 | 匹配的可信 Bevy 运行程序 |

**作者格式版本与运行计划版本属于不同接口。** 作者场景使用 v3 组织分组，并不表示使用运行 plan 3；目前显式行为才进入 plan 3。静态二维／三维预览能力也不能推导出相同的运行后端支持。

## 映射出的下一步

新建配方助手 `scene.composition_create` 已接入当前工作树，初始一片段／1–64 演员／一放置；已有编辑区负责后续结构。横排／竖排／网格只修改起始表单坐标，预览、应用与撤销独立于普通保存。操作与范围见[创建指南](SCENE_COMPOSITION.md#新建场景配方)。

- **Bevy 作者 Rust 行为**：`behavior.bevy_rust`。当前固定运行程序不编译作者源码；需要独立工具、绑定、冻结输入和诊断契约。
- **独立游戏发行**：`build.standalone_distribution`。工程 ZIP 已能迁移，但仍需引擎工具；目标平台导出和无开发引擎环境运行尚未接入。
- 现有绑定的关联管理、空间父子变换、跨视图历史、跨文件配方及大规模性能仍按各功能的“下一步”单独审查，不由这些缺口穷举。

工作流的 `gaps` 只列本次明确登记的额外缺口。旧工作流没有该字段表示尚未梳理，不能解释为没有缺口；显式空数组也只表示这次没有登记额外项。缺口单独展示，不会进入已经接通的阶段计数或继承相邻实现的评分。

## 验证边界与图谱维护

新建配方首版的独立证据见[创建验收](test-results/scene-composition-create/README.md)，多演员增删、混合继承与运行另见[多演员验收](test-results/scene-composition-multi-create/README.md)，起始排布见[排布验收](test-results/scene-composition-create-layout/README.md)。上一轮[Linux 安装验收](test-results/native-installed-0.1.1/README.md)覆盖保存态配方的后续链路；新创建助手尚未重新打包安装。各记录分别保留起点和实际运行平台。

[二维实测](test-results/two-dimensional-workflow/README.md) 的连续浏览器起点是服务夹具准备的已登记配方：界面创建独立场景、TXT 脚本和行为后，真实 Godot 无头运行、工程 ZIP 下载和异地导入通过。它不证明上游 OC／投影／配方全程 GUI、图形游戏体验、Bevy 作者行为或安装设备验收。Bevy 的已有验证仍以其独立专题为准。

前一轮映射工作只完善目录、依赖关系、步骤／缺口阅读与定位工具，没有增加引擎能力，也没有重跑上述历史产品测试。新增工具测试和真实离线浏览器验证见 [功能映射验证记录](test-results/functional-mapping/README.md)。原有评分、证据和旧 F01–F50 网络保持；本轮有意修订的说明、优先项和依赖边见 [映射审查记录](test-results/functional-mapping/catalog-review.json)。

依赖图统一采用 **前置能力 `from` → 使用者 `to`**。仅表示可选后续操作的关系放进工作流，不作为所有使用者必需的前置条件。新增能力先登记唯一功能身份，再关联实现与证据；图谱检查通过只证明引用和派生文件一致，不证明人工评分正确或功能已经验收。

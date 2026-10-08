# 有限运行验收用例（未发布增量）

本页能力已纳入 [0.0.9 源码交付](RELEASE_0.0.9.md)。保留的“未发布增量”标题和阶段验证描述对应此前 0.0.8 工作树，旧报告版本与条件保持；已安装程序需另行更新。

0.0.8 之后的工作树在[控制回放](RUNTIME_CONTROL.md)之上增加运行验收：冻结同一份方向输入与预期结果，在 Godot 或 Bevy 的真实有限无头运行中采样，再由引擎无关的纯数据层检查。断言失败与进程失败分别记录。作者场景、构建库存、旧控制程序及运行协议保持原样；没有更新安装版。

需要连续重跑多份已保存用例时，使用[有序验收组](RUNTIME_CASE_SUITES.md)。组仅保存同场景成员 UUID 和顺序，宿主一次捕获全部正文再逐份复用本页的原执行／评判；断言失败继续，执行错误或取消停止余项。

## 用例与检查

用例是 `viento-runtime-case` schema 1，顶层精确包含 `format`、`schemaVersion`、`program`、`checks`。`program` 是原控制 schema 1 或 2；此轮用例只支持无作者行为的冻结 plan 2，使用稳定实例 UUID，不把定义 UUID 当实例身份。旧 plan 1 控制回放继续使用原入口。

以下用例适用于官方 `examples/bevy-headless` 的默认场景；第二个实例默认没有方向控制。第一步右移，第二步释放，检查第一份实例的位置和状态：

```json
{
  "format": "viento-runtime-case",
  "schemaVersion": 1,
  "program": {
    "format": "viento-runtime-control",
    "schemaVersion": 2,
    "fixedDelta": 0.125,
    "steps": [
      { "inputs": [{ "instanceId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", "left": false, "right": true, "up": false, "down": false }] },
      { "inputs": [] }
    ]
  },
  "checks": [
    { "instanceId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", "stepIndex": 0, "position": { "value": [220, 220], "tolerance": 0.0001 }, "state": "moving" },
    { "instanceId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", "stepIndex": 1, "position": { "value": [220, 220], "tolerance": 0.0001 }, "state": "idle" }
  ]
}
```

每条检查精确包含 `instanceId`、`stepIndex`，以及至少一个 `position` 或 `state`。`stepIndex` 从 **0** 开始，指完成该输入步之后的样本。`position` 精确包含两个有限坐标的 `value` 和有限非负 `tolerance`；逐坐标检查 `abs(actual - expected) <= tolerance`，没有隐含 epsilon。`tolerance: 0` 表示精确比较。`state` 只接受 `idle`／`moving`。同一实例和步骤只能有一条检查，两个字段可合在同一行。

用例有 1–128 条检查，CLI JSON 文件最多 **256 KiB**；控制程序的 1–64 步、8 秒、1024 输入行及“实例数 × 步数 ≤ 1024”预算继续适用。未知实例、越界步骤、重复检查、额外字段、访问器、污染原型、循环、稀疏数组和非有限值均拒绝。没有方法、代码、引擎句柄、磁盘路径或工具选择字段。

纯层只校验和比较已准入样本，不计算应有位移、不补造缺失步骤，也不从最后一帧代替全部步骤。采样仍由旧 trace reader 严格核对 ready／finished、连续步骤、全体演员及定义／实例配对。

## 工程内保存与迁移（未发布增量）

在验收编辑区域先点击 **刷新用例**，再选择已保存用例并明确载入；选择本身不替换文本，轮询不自动刷新目录。未载入文档时，**保存用例**按位置与类型创建；已载入时更新该文档，**用例另存为**使用新位置。文件名是目录中的标题，位置与类型由本工程定义。载入替换已有修改前要求明确放弃；**作为新用例**保留当前文本、解除旧保存关联并绑定当前场景。取消、保存冲突、轮询、换语言和关闭重开保留文本及选区。没有修改的已载入文档重存保留原来的 BOM、换行和缩进。加载结果与目录每次读取当前作者文件，不把冻结构建的缓存当作最新工程内容。

切换场景不会自动重绑已载入用例，需选择原场景，或明确作为新用例。也可在当前场景完成控制回放后明确生成验收：跨场景生成会解除旧文档关联，同场景生成保留关联并形成待保存修改。断连、无有效保存回执、服务端异常或保存尚未返回时关闭面板，都会标记保存结果未确认；此时保留草稿并禁用再次保存、另存和作为新用例，须刷新后明确载入核对。仅刷新不能解除未确认状态，没有自动重试。HTTP 4xx 的明确拒绝保留草稿与旧修订，可重载或另存。

工程文档使用独立包装格式，内层运行用例与旧 DTO 保持一致：

```js
{
  format: 'viento-runtime-case-document',
  schemaVersion: 1,
  sceneObjectId: registeredSceneUuid,
  case: runtimeCase
}
```

包装精确包含这四个字段，UTF-8 JSON 原文最多 256 KiB。`sceneObjectId` 是唯一场景关联权威；文档自己的 UUID、路径、类型仍由普通元数据登记管理，不新增内嵌标题、执行结果、后端名、工具或平台路径。只支持直接 Scene2D v2／v3 的稳定实例与无行为 plan 2；组合配方和 plan 1 仍各走原流程。未知实例或缺失定义标为无效，保留原文供修复，不自动改身份或学习新的预期。

新建复用文档独占登记与原子写入，更新必须提供原文 SHA 版本；保存前后核对作者场景修订、依赖及登记身份。冲突时不会强制覆盖，也不会留下半份新登记或临时正文。作者场景改变后，刷新只更新目录修订，不替已载入文档推进保存基线；更新原用例需明确重新载入并核对，要保留当前修改可刷新后明确另存为。改变场景并不自动改变用例预期，重新运行可能明确失败。

资源包从包装正文派生 **用例 → 场景** 必要依赖，并在导出场景、启用“包含子内容”时合并关联且有效的已登记用例，与原子内容去重。无效用例不会自动成为派生子内容；明确选择无效用例时拒绝导出。无需把场景关联再次写入元数据，场景与定义的原登记关系仍必须完整。

关闭“包含依赖”时，已选条目的未选直接依赖成为锁定摘要的目标要求：仅选用例时要求目标场景，场景也已选时可要求目标角色定义。读取包先检查可见正文与声明；仅已声明文档要求的原文不可读取诊断延后，错误实例、缺少登记边、坏包装或未声明的身份仍立即拒绝。确认导入再读取目标场景及定义，核对身份、实例、关系和当前字节，并在发布前复验；校验正确的 ZIP 也不能省略依赖声明。目录迁移只改登记路径，保留全部文档／实例 UUID 和验收正文原字节；目前没有克隆身份功能。完整工程备份继续保留尚未修复的作者原文，仍遵守既有登记和文件完整性要求；选择式资源包拒绝不完整用例。

本机工作台沿原鉴权使用 `case-list`、`case-load`、`case-save` 动作；保存包含 `sceneId`、`sceneVersion`、包装原文 `content`。更新包含 `documentId`、`expectedVersion`，新建包含 `sourcePath`、`documentType`；两种输入互斥，没有 `force`。服务的保存和载入不启动引擎，也不替换正在运行的任务；界面在任务进行期间暂时禁用作者用例操作。源工程离线时不能刷新、载入或保存目录；已经载入的纯用例仍可对同场景的既有冻结构建运行。绑定场景与冻结计划不一致时，在任务或运行会话创建之前拒绝，即使两份场景偶然使用相同的实例 UUID。

CLI 的 `--runtime-case` 同时接受原纯用例与此工程包装；包装检查场景绑定后才执行，不重新打开源工程。详情及本轮结果见[文档工作流验证](test-results/runtime-case-documents/results.json)。

## 运行与结果

先保存工程，再完成 **检查计划 → 构建场景**。在构建工作台的 **编辑运行验收** 中粘贴 JSON，点击 **运行验收**；轮询、切换语言、关闭重开保持输入文本与选区。也可先完成控制回放，再点击 **从完整控制采样生成验收**，明确把当前成功运行最后一步的全部实例位置／状态作为预期，容差为 0.0001；这会替换当前用例文本，不会自动学习或覆盖输入。生成的是一次运行的参考结果，仍可编辑为设计要求；重复一致本身不证明设计语义正确。用例可作为面板草稿运行，也可明确保存到工程内；未保存作者草稿仍按原规则阻止运行和验收文档写入。

源码 CLI 使用已有的有效冻结构建目录，工具仍由可信宿主配置：

```sh
npm run project:build -- --command run \
  --build /绝对路径/冻结构建目录 \
  --backend org.viento.bevy --tool "$VIENTO_BEVY_BIN" \
  --runtime-case /绝对路径/运行用例.json
```

Godot 改用 `--backend org.viento.godot4 --tool "$VIENTO_GODOT_BIN"` 及对应冻结构建。`--runtime-case` 仅接受有限无头 `run`，与 `--control-program`、窗口、截图和交互长运行互斥；模式检查在读取用例和产物前完成。用例文件不接受最终路径符号链接。源工程暂时离线仍可消费本会话拥有或 CLI 已验证的冻结产物；新计划／构建继续需要当前作者文件。

本机服务沿原鉴权及任务所有权，仅在运行请求增加纯数据字段：

```js
{ action: 'run', buildId: verifiedBuildId, mode: 'headless', runtimeCase, runtimeCaseSceneId: boundSceneUuid }
```

独立纯用例的 `runtimeCaseSceneId` 可省略；从工程文档载入时保留绑定。它不能同时传 `controlProgram`。格式、目标、计划和联合预算在创建任务之前检查；工具、适配器、快照与生成文件仍在运行前重新核对。服务不能传工具路径、后端代码或用例文件路径。

| 结果 | 含义 |
| --- | --- |
| `passed` | 引擎成功、trace 完整、全部检查满足预期 |
| `failed` | 引擎成功且 trace 完整，至少一条已采样检查不满足预期 |
| `incomplete` | 取消、超时、运行／协议失败或样本不完整；保留已采样检查结果，缺失检查为 `unavailable` |

执行成功而断言失败时，原 `record.status`／任务状态仍是 `succeeded`，独立 `verification.evaluation.status` 为 `failed`，运行返回 `ok: false`，CLI 退出码为 1。UI 同时显示运行与验收状态。取消后不能因最后一条检查已经通过而宣称整份用例通过。最后会话保存期间收到的取消也会重存为 `cancelled`／`incomplete`；已完成持久化并返回的记录作为服务结果提交点，不再被之后的取消改判。

会话记录追加 `verification: { definition, sha256, evaluation }`。`definition` 是分离冻结的用例，`sha256` 是规范 JSON 的 SHA-256；原 `control` 仍保存实际程序、独立程序摘要与逐步样本。`evaluation` 包含完整／样本／检查计数和逐行预期、实际、位置与状态比较；不把运行状态塞进作者文件或设备句柄塞进用例。

## 实现与验收边界

`engine/runtime-verification-case.mjs` 提供 `validateRuntimeCase(input)`、`validateRuntimeCasePlan(plan, input)` 和 `evaluateRuntimeCase(plan, input, samples, { complete })`。它没有 Node、DOM 或具体引擎依赖；`complete` 是可信宿主给出的运行事实，纯函数本身不认证引擎已经执行。直接传入的样本仍检查严格连续顺序、全部演员配对、坐标及状态；非法样本抛 `runtime_case_sample_invalid`，不能作为通过证据。

宿主执行器组合现有控制回放与此评判，服务负责任务归属，GUI 负责输入和展示。Godot adapter `0.5.0`、Bevy adapter／可信运行程序 `0.3.0` 与作者／计划／trace 版本没有增加。本轮不接作者脚本断言、图像比较、连续实时控制或设备执行；纯模块打包到移动资源不表示 Android 已能运行引擎。

本轮证据见[运行验收记录](test-results/runtime-verification-cases/results.json)，测试命令见[验证指南](TESTING.md)。

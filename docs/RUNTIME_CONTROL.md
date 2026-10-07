# 有限控制回放（0.0.8 源码）

0.0.8 源码为 Godot／Bevy 提供全局与按实例独立的有限方向输入程序：在已验证的冻结场景上，按固定步长执行明确的方向键值，逐步返回全体实例的位置与状态。它用于比较两个后端的运行语义和中间层边界，不修改作者场景、元数据或原构建。普通无头测试、窗口预览和[运行对象观察](RUNTIME_OBJECTS.md)继续保留各自入口。

## 支持范围

| 项目 | 当前约定 |
| --- | --- |
| 能力 | `runtime.control-replay`；按实例另需 `runtime.control-replay.instances`，均由可信宿主注册的描述符声明 |
| 后端 | Godot 适配器 `0.5.0`；Bevy 适配器／可信运行程序 `0.3.0`，固定 Bevy `0.19.1` |
| 场景 | 全局 schema 1 支持无行为 plan／runtime 1／2；按实例 schema 2 仅支持冻结 plan／runtime 2。作者 v3 组织分组仍可生成无行为 plan 2 |
| 执行 | 仅有限无头测试；不接窗口、截图、交互长运行或 plan／runtime 3 作者行为 |
| 资源 | 延续各后端现有能力；Bevy 仍拒绝图片、音视频和作者 Rust 行为 |
| 输入方式 | 明确的有限 JSON 程序；没有实时键盘转发、stdin 命令、RPC、BRP 或反射 |

旧 Godot v1／v2 生成器、分派与运行文件保持原字节；控制回放使用独立的受信任 GDScript 驱动。Bevy 在自己的可信 Rust 工具中执行同一方向数据，没有把 Godot 节点路径或 Bevy Entity 暴露到控制契约。Bevy 工具的精确版本与 SHA-256 必须匹配，升级工具或适配器后需重建旧产物；准备应用资源并不把该工具自动放进安装包。

## 控制程序

### 全局方向（schema 1）

```json
{
  "format": "viento-runtime-control",
  "schemaVersion": 1,
  "fixedDelta": 0.25,
  "steps": [
    { "left": false, "right": true, "up": false, "down": false },
    { "left": false, "right": true, "up": true, "down": false },
    { "left": true, "right": false, "up": false, "down": false },
    { "left": false, "right": false, "up": false, "down": false }
  ]
}
```

schema 1 保持原精确字段与执行语义：每步只有四个布尔方向键，同一输入作用于场景中声明了 `controls: "arrows"` 的实例；`controls: "none"` 和零速度实例保持原规则。它支持无作者行为的冻结 plan 1／2。

### 按实例独立方向（schema 2）

```json
{
  "format": "viento-runtime-control",
  "schemaVersion": 2,
  "fixedDelta": 0.25,
  "steps": [
    { "inputs": [{ "instanceId": "11111111-1111-4111-8111-111111111111", "left": false, "right": true, "up": false, "down": false }] },
    { "inputs": [{ "instanceId": "22222222-2222-4222-8222-222222222222", "left": true, "right": false, "up": false, "down": false }] },
    { "inputs": [] }
  ]
}
```

示例 UUID 须替换为**当前冻结 plan 2 中的实例 UUID**。每步精确包含 `inputs`，每行精确包含 `instanceId` 和四个布尔方向键；同一步内不能重复实例，跨步骤可以重复。每步 0–128 行，全程序至多 1024 行。定义 UUID 不能代替实例 UUID：只有实际属于冻结实例集合的身份才准入，同一定义的多份实例可以接受不同方向。

**每步独立生效：未列出的实例在本步释放全部方向，不延续上一步输入。** 上例第二步会释放第一份实例，同时向第二份实例输入左方向；最后空 `inputs` 释放全部实例。最后一步也可显式列出实例，但每行的四个方向均须为 `false`。`controls: "none"` 和零速度仍遵守原移动规则。

schema 2 只支持冻结 plan／runtime 2，并同时要求上述两项回放能力；即使所有步骤为空，也不能用于 plan 1。未知 UUID 或不属于该实例集合的定义 UUID 返回 `runtime_control_target_missing`；版本／计划不支持返回 `runtime_control_unsupported`。实例 UUID 如果恰好与其定义 UUID 相同，仍按它是否真实属于实例集合判断。

### 共同预算与数据边界

两种程序的顶层字段均只有 `format`、`schemaVersion`、`fixedDelta`、`steps`。`fixedDelta` 必须是有限数，满足 `0 < fixedDelta <= 0.25` 秒；共 1–64 步，总模拟时长 `fixedDelta * steps.length <= 8` 秒。最后一步必须全释放。未知字段、非布尔方向、访问器、隐藏键、自定义原型、循环和稀疏数组均拒绝；不能传向量、方法、代码、Entity、节点路径、可执行文件、资源或磁盘路径。

方向键组合由具体运行后端处理：相反方向抵消，斜向输入归一化，速度单位仍为每秒像素。可移植中间层仅检查数据、身份、步骤与顺序，不自行模拟坐标或推断状态。

另有联合预算：**场景实例数 × 步数 <= 1024**。例如，128 个实例最多 8 步，两个实例可以使用 64 步；构建和控制程序均有效也不能绕过这项检查。该预算在执行前限制完整样本和状态帧，避免依赖运行日志截断后才发现超限。schema 2 的 1024 输入行预算与这项预算分别检查；稀疏输入不会减少每步全体实例的观察成本。超限返回 `runtime_control_limit`。CLI 控制文件读取上限为 schema 1 的 **16 KiB**、schema 2 的 **256 KiB**；JSON 格式和纯数据预算仍须通过。

## 在工作台使用

先保存作者草稿，选择场景并完成 **检查计划 → 构建场景**。支持回放的当前后端与无行为计划可在构建任务中编辑控制程序，再执行 **控制回放**。冻结 plan 2 且后端声明实例回放能力时，**输入示例的目标**把实例 UUID 末尾 8 位放在名称之前，窄屏也能区分同名实例；选项提示保留完整 UUID，实际目标值与生成 JSON 始终使用完整 UUID；选择全局或某份实例后，点击 **生成输入示例**才会替换 JSON，单独切换目标不会改动已有文本。示例为右／释放／左／释放四步；选实例生成 schema 2，可继续编辑 JSON 为多实例不同方向。控制程序属于当前面板与运行任务，轮询、重开面板和切换语言保留输入，不写回工程；普通 **无头测试** 仍使用原固定 smoke。窗口和作者行为场景不能使用回放入口。

[运行对象](RUNTIME_OBJECTS.md)显示已收到步数和每步时长，并区分控制步骤位置样本、状态改变后过期的位置和结束样本。界面步数从 1 开始展示，数据中的 `stepIndex`／`positionStep` 从 0 开始。任务取消、失败或超时后保留最后有效样本；切换场景、构建或任务仍核对既有身份与草稿守护。

## 从冻结产物运行

把上述程序保存到作者工程之外的本机 JSON 文件。在已有的有效冻结构建上运行：

```sh
npm run project:build -- --command run \
  --build /绝对路径/Godot构建目录 \
  --backend org.viento.godot4 --tool "$VIENTO_GODOT_BIN" \
  --control-program /绝对路径/控制程序.json

npm run project:build -- --command run \
  --build /绝对路径/Bevy构建目录 \
  --backend org.viento.bevy --tool "$VIENTO_BEVY_BIN" \
  --control-program /绝对路径/控制程序.json
```

绝对路径需要替换为实际目录和工具。两条命令分别消费对应后端的冻结产物，不重新打开作者工程；首次构建见[构建指南](PROJECT_BUILD.md)与[Bevy 指南](BEVY_BACKEND.md)。`--control-program` 仅用于 `run`，不能与 `--window`、`--capture`、`--interactive` 同用；未传时保持原运行方式。

本机服务只在 `run` 请求新增 `controlProgram` 纯数据字段：

```js
{ action: 'run', buildId: verifiedBuildId, mode: 'headless', controlProgram }
```

HTTP 不接控制文件路径、引擎工具、后端代码、Entity、节点路径或任意方法。未知字段、模式不符、计划不支持和联合超限均拒绝；工具及产物身份仍由可信宿主验证。

## 输入、采样与所有权

`engine/scene-control-program.mjs` 提供三个无 Node、DOM 或具体引擎依赖的入口：

```js
const program = validateSceneControlProgram(input); // 分离、深冻结，格式与独立预算
validateSceneControlPlan(verifiedFrozenPlan, program); // 核对计划版本、实例目标与联合预算
const trace = createSceneControlTraceReader(verifiedFrozenPlan, program, {
  onRuntime: line => existingRuntimeReader.push(line),
  onSample: sample => observer.pushSample(sample),
});
trace.push(processStdoutChunk);
trace.finish({ requireComplete: runSucceeded });
```

运行程序另外输出 `VIENTO_TRACE:` 帧，精确字段为 `format: "viento-runtime-trace"`、`schemaVersion: 1`、`protocolVersion: 1 | 2`、`event: "sample"`、`stepIndex`、`actors`。两种控制程序共用这份 trace，schema 2 不新增输入字段或改变运行协议。每份样本必须包含全部冻结演员，保持定义／实例配对，位置有限、状态为 `idle` 或 `moving`；不含作者路径或引擎句柄。样本仅在有效 ready 与 finished 之间准入，步骤必须从 0 连续增长；finished 的步长和完整演员值必须等于捕获程序与最后样本。

同一输出块按行依次处理生命周期、状态和控制样本，不能先处理整块 finished 再回填之前的步骤。无效结束帧不会覆盖最近有效样本。成功运行要求收到全部步骤及结束帧；明确取消或失败允许不完整，但仍记录无效帧。文本行与诊断有独立预算，超限不转为有效样本。

对象观察可选 `controlProgram`，旧的无控制 DTO 不新增字段。控制观察增加 `control: { stepCount, completedSteps, fixedDelta }`；采样时 actor 的 `positionSample` 为 `"control"`，`positionStep` 为零基步索引，生命周期仍为 `ready`。后续不含坐标的状态事件使该位置过期；有效 finished 恢复结束样本并移除 `positionStep`。

宿主在生成运行工程前分离和冻结输入，并把规范 JSON 的 SHA-256、程序及已准入样本保存到运行记录的 `control`。适配器只在独立会话目录暂存程序及所需驱动，结束后清理；原构建库存、作者正文和资源字节不改。控制输入的摘要用于绑定本次运行，不替代既有工具、源快照、适配器和产物校验。

## 验证与边界

有限控制与实例输入纳入 [0.0.8 源码版本](RELEASE_0.0.8.md)；[发布候选检查](test-results/release-0.0.8/results.json)在新版本重新完成应用 1774／1774及准备资源 10 次普通／全局／实例离线会话。下列开发专题保留其原 0.0.7 工作树条件，浏览器与独立 Bevy Rust证明不重标为本次新安装／设备验收。

复现步骤见[有限控制回放验证](TESTING.md#有限控制回放)。本轮按实例输入证据放入 `docs/test-results/runtime-instance-control/`，旧报告保留原字节。应用 **1774／1774**、0 失败／跳过／取消，391 JS／API／0.0.7 版本通过；新增 28 已含全量。pure **45／45**（新增实例 9）、engine **36／36**、host／UI **69／69**、CLI **7／7** 和目标标签 UI **42／42** 分别记录且有重叠；可信 Bevy Rust **25／25** 与 fmt／clippy 另计。完整条件见[本轮结果](test-results/runtime-instance-control/results.json)和[可移植规则](test-results/runtime-instance-control/portable-tests-final.log)。

[最终 Chrome](test-results/runtime-instance-control/browser-final/browser.json)完成 8 条流程、4 Bevy＋4 默认 Godot 任务、0 异常，包括实例不同方向、逐步释放、显式生成与三语 390px 的标识／JSON／草稿／光标保护。[准备资源](test-results/runtime-instance-control/packaged-resources.json)核对桌面 89／移动 68，运行 10 次普通／全局／实例离线会话；移动仅执行 4 个纯模块并准入真实输出。1668 份历史与 9 份冻结后端／WASM 原字节保持，当前 126 份源摘要复验，见[保留记录](test-results/runtime-instance-control/historical-preservation.json)。

上一轮全局有限控制的应用 **1746／1746**（新 39 项含在全量）、可信 Bevy Rust **20／20** 与 fmt／clippy 通过；真实 Chrome 8 条流程和准备资源下 8 次普通／控制离线会话另验收，移动仅执行 4 个纯模块。这些数字属于 Godot 0.4.0／Bevy 0.2.0 的条件，见[上一轮结果](test-results/runtime-control-replay/results.json)、[上一轮浏览器](test-results/runtime-control-replay/browser-final/browser.json)与[上一轮准备资源](test-results/runtime-control-replay/packaged-resources.json)。

有限固定步回放不代表墙钟时间、连续实时采样、任意状态机、运行对象修改、组件查询或渲染。浮点计算精度由后端实现决定；受控分数／斜向代表样例按 0.0001 坐标单位容差比较，不等于任意斜向或物理计算逐位相同。窗口输入、作者 Rust 行为、运行资源、跨会话恢复、性能规模、Tauri 安装包和 Android 设备需各自实现与验收。

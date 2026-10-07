# 文件内场景片段组合（实验性）

0.0.8 源码支持把场景配方作为工程中的普通已登记 JSON 文档：在一个配方中定义可复用片段，给每次放置分配稳定身份和局部覆盖，再由共享 Rust 核心展开为现有 **Scene2D v3**。正文编辑、保存、完整备份和选择式资源包复用已有流程；配方依赖从当前源码读取，不自动改写元数据。场景预览已能读取已保存配方和当前未保存原文，查看展开画面及每个字段的贡献来源。片段展开、预览和局部覆盖纳入 [0.0.8 源码交付](RELEASE_0.0.8.md)，没有新安装包或设备验收；当前源码编辑中的同一份配方还可编辑单实例局部覆盖，经检查后应用到原文草稿，再普通保存。共享片段编辑、取消覆盖及跨文件写回未接入。

配方是这条链路的作者输入，生成场景是一次展开的结果。编辑生成场景不会反向修改配方；重新展开也不会合并生成场景中后来发生的编辑。片段不嵌套、不跨文件，不引入 Scene2D v4、workspace 升级或多文件保存事务。

## 查看样例

在仓库根目录使用 Node.js 24、Rust 稳定版和 `wasm32-unknown-unknown` 目标，先按[开发说明](../.github/CONTRIBUTING.md#开始开发)准备依赖。运行：

```sh
npm run scene:compose -- --input examples/scene-composition/recipe.json
npm run scene:compose -- --input examples/scene-composition/recipe.json --emit bundle
```

默认输出 Scene2D v3 JSON；`--emit bundle` 同时输出场景、来源映射和配方原始字节的 SHA-256 修订号。`--input` 模式只读取指定的普通文件，结果写到标准输出；不保存场景、不登记工程、不启动 Godot。脚本准备共享核心时可能重建程序侧 WASM 缓存。需要把 JSON 交给另一个程序时，使用 `npm run --silent scene:compose -- ...`，避免 npm 的任务标题混入输出。

样例引用[已有 Scene2D 合成工程](../examples/scene2d/README.md)中的定义和图片 UUID。单独展开不检查这些依赖是否在某份工程中存在，也不会自动把它们复制进工程。样例说明见 [examples/scene-composition](../examples/scene-composition/README.md)。

## 作为工程文档保存与迁移

使用工程已有的文档类型创建 `.json` 正文，并按普通文档登记。脚本化创建可使用既有 `object.create`；界面中仍通过原文编辑和普通保存修改它。配方自己的文档 UUID 表示作者文件，`placementId`、生成的 `instanceId` 和 `groupId` 继续由配方显式持有。工程没有新增配方专属类型、World 命令、journal 事件或 workspace 格式。

顶层 `format: "viento-scene-composition"` 选择配方处理；文件名、目录和文档类型不参与猜测。删除顶层 `format` 后，正文按普通 JSON 处理，原先手工登记的关系和素材绑定仍然保留。未写完的配方可以普通保存，冲突仍由既有正文修订检查处理；完整项目备份保留这些作者字节。无效配方、缺失依赖、错误素材类别或不合法 UTF-8 会阻止该配方的展开与选择式资源打包，修复正文后可重试。

选择式资源包读取当前配方中**全部片段的演员定义**及**全部模板和放置覆盖中的图片 UUID**，包括未使用片段和被覆盖的原图片；`null` 或省略不产生图片依赖。依赖按 UUID 去重，并与已有元数据关系、正文素材和资源绑定合并。引用的定义必须有已登记正文，不能是配方自己或另一份配方；图片必须登记为 `image`。投影引用继续由既有投影链路收集其来源定义和图片。派生边只服务于当前检查和依赖闭包，不写回 `metadata/`。

在编辑器 **导出 → 资源包** 中选择这份普通文档，即可沿当前依赖闭包迁移原文、身份和素材。关闭自动包含依赖后，未携带的依赖必须以正确类别列入 `requirements`，并锁定登记与源文件指纹。导入会重新检查包内原始配方，不能靠删掉清单依赖或目标恰好存在同 UUID 内容绕过。资源包往返保持配方正文原字节和文档 UUID，不把展开结果替换成作者文件。完整项目包继续备份工程的原始文档，语义错误不会触发自动展开或改写。详见[资源包规则](RESOURCE_PACKAGES.md#场景配方的派生依赖)。

## 读取工程内的已登记配方

已有配方登记后，可按文档 UUID 展开并检查依赖：

```sh
npm run --silent scene:compose -- --root /临时工程 --object <配方文档UUID>
npm run --silent scene:compose -- --root /临时工程 --object <配方文档UUID> --emit bundle
npm run --silent scene:compose -- --root /临时工程 --object <配方文档UUID> --revision sha256:<原文摘要> --emit bundle
```

`--root` 与 `--object` 必须同时提供，不能与 `--input` 混用；`--revision` 只用于已登记模式，须与当前原文摘要一致。该模式从工程快照读取已登记的 `.json` 正文，核对所有派生定义和图片依赖，然后向 stdout 输出。它不创建生成场景、不修改配方或登记，也不启动构建。独立 `--input` 模式保持只检查配方结构的行为，不能替代工程依赖检查。已登记模式核对声明的引用可用性和图片登记类别；实际图片字节、投影有效值和运行可行性仍交给原有场景模型与构建流程。

已登记模式的 bundle 在原有 `sourceRevision`、`scene`、`sourceMap` 外增加 `origin`：`kind: "registered-document"`、`objectId`、工程相对 `sourcePath`、`worldId` 与 `worldRevision`。来源信息用于核对本次读取的文档和快照，没有写入授权。普通 `--emit scene` 仍只输出既有 v3。

## 在编辑器中预览配方

工程中的配方保存为普通已登记 `.json` 后，在构建工作台的 **场景预览** 选项卡选择它。预览列表同时容纳 Scene2D 和配方；构建／运行列表继续只接受实际 Scene2D 文档。配方自身不作为可执行快照交给 Godot。

预览读取配方当前原文，在内存中展开并复用 Scene2D v3 模型，显示演员、组织分组、投影继承值与图片。对当前正在源码编辑的同一份配方，可显式查看未保存草稿；投影定义和素材仍读取保存版本。预览不会保存原文、创建生成场景、登记派生关系或改动元数据。坏草稿保留最近有效画面并单独显示诊断；旧画面只保留自己的来源修订，不能指向后来改过的正文。

演员检查器显示片段、放置及局部键。字段只有一个配方来源时可直接定位；位置由模板或覆盖与偏移共同得到时，界面分别提供 **片段字段／局部覆盖／放置偏移**，每个按钮指向相应原文数值。整体合成值的主位置不声明精确可选范围。组名和父组映射也可定位，继承的宽高、图片等继续指向原投影定义。标题、画布尺寸和背景颜色均可定位到配方的 `scene` 字段。

已保存来源会核对读盘后的正文修订；草稿来源会核对当前编辑会话和精确文本摘要。定位保留未保存内容，变化后的旧来源不能误选。预览本身不开放 Scene2D 表单、位置拖动、草稿布局回写或构建／运行。同一份配方处于当前源码编辑会话时，可通过下节的独立覆盖对话框修改原文草稿；保存仍沿用主编辑器。生成 v3 若需要独立构建或编辑，按下文另行登记。

## 编辑单个实例的局部覆盖

先在原文编辑器打开一份已登记配方，并预览当前原文。在演员检查器中选择 **编辑此实例覆盖**；入口只针对当前源码会话、同一路径和同一修订的有效配方，旧画面或其他文档不能取得写入权限。

1. 调整局部位置、宽高、颜色、速度、控制方式或图片。位置是 **偏移前** 的片段内坐标，画布位置仍等于局部位置加放置偏移。图片从已登记图片中选择；只有启用投影继承的演员支持把图片明确设为 `null`。
2. 点击 **检查覆盖修改**，审阅完整修改后原文。Rust 先校验整份输入和展开，再生成精确补丁；预览服务继续检查完整模型、依赖及实际图片内容。无效修改不会启用应用按钮。
3. 点击 **应用到原文草稿**。编辑器重新核对源会话、原文摘要、保存基线和提案，将结果放入同一份原文草稿。随后在主编辑器 **保存**，才会写入工程文件；没有独立的覆盖保存事务。

未改动的字段保持原有继承或覆盖，不会把检查器显示的投影默认值全部写入配方。操作按稳定的 `placementId` 与局部 `actorKey` 定位，只设置该演员的六类覆盖字段；共用片段、其他放置、演员身份及分组保持原样。已有值只替换所需 token，新增字段或覆盖容器保留其余原始字节，包括 BOM、行尾、字段顺序、未改数字拼写和空白。

**取消修改／返回预览** 保留原源码草稿。检查之后继续改表单，需要重新检查；源码、选择或预览基线变化会使旧提案失效，迟到响应不能应用。外部文件变化仍由既有预览修订和普通保存冲突机制处理。此入口没有共享片段编辑、删除覆盖／恢复继承、从画布拖动回写、跨文件事务或统一撤销；来源导航仍只负责选中原文。

## 配方契约

顶层必须只包含：

```json
{
  "format": "viento-scene-composition",
  "schemaVersion": 1,
  "scene": {
    "title": "组合场景",
    "viewport": [800, 480],
    "background": "#0d1829"
  },
  "fragments": [],
  "placements": []
}
```

上面只展示字段位置；有效配方至少需要一个片段及一次放置。`scene` 的标题、视口和背景沿用现有场景规则：标题为 1–160 个 UTF-16 单元，不能为空白或含控制字符；视口宽高为 64–4096 的整数；颜色为六位或八位十六进制值。

| 部分 | 必需字段 | 可选字段与含义 |
| --- | --- | --- |
| 片段 | `fragmentId`、`actors`、`groups` | 无嵌套、外部引用或脚本字段 |
| 片段演员 | `key`、`objectId`、`position` | `groupKey`、`size`、`color`、`speed`、`controls`、`imageResourceId`、`useProjectionDefaults` |
| 片段组 | `key`、`name` | `parentKey` 指向同一片段的组；省略表示根组 |
| 放置 | `placementId`、`fragmentId`、`actorIds`、`groupIds` | `offset`、`overrides` |
| 单演员覆盖 | `actorKey`、`values` | `values` 仅允许 `position`、`size`、`color`、`speed`、`controls`、`imageResourceId` |

`fragmentId` 及局部 `key` 匹配 `[a-zA-Z][a-zA-Z0-9_-]{0,63}`。片段 ID 在配方内唯一；演员键与组键分别在片段内唯一，两个命名域可以使用同一键。`objectId` 引用现有定义的 UUID，不能被放置覆盖。片段演员只有 `useProjectionDefaults: true` 时才可省略尺寸、颜色、速度和控制方式；它保留投影继承声明，实际有效值由现有场景规划器读取已登记投影后解析。

`actorIds` 和 `groupIds` 是局部键到小写 UUID 的完整映射，不能缺项或多项。例如：

```json
{
  "placementId": "11111111-1111-4111-8111-111111111111",
  "fragmentId": "pair",
  "actorIds": {
    "lead": "22222222-2222-4222-8222-222222222222",
    "support": "33333333-3333-4333-8333-333333333333"
  },
  "groupIds": {
    "cast": "44444444-4444-4444-8444-444444444444"
  },
  "offset": [240, 0],
  "overrides": [
    { "actorKey": "support", "values": { "controls": "none", "speed": 0 } }
  ]
}
```

此示例要求 `pair` 已声明 `lead`、`support` 两个演员和 `cast` 一个组。配方明确持有每个生成实例与组的身份；标题、数组下标和位置不参与 UUID 生成。重排片段或放置不会改变映射中的 UUID；新增局部演员或组时，应在每个使用该片段的放置中补上新的身份映射。每个放置的 `placementId` 唯一；所有生成的演员和组 UUID 也须全局唯一，两个生成身份域不得碰撞。

## 展开与覆盖

输出始终为 `viento-scene2d`、`schemaVersion: 3`，仅包含既有场景字段。演员顺序为放置数组顺序，再按对应片段的演员顺序展开；这个顺序继续决定叠放顺序。组按相同规则展开，`groupKey` 和 `parentKey` 转为该放置的组 UUID。组织分组不产生空间变换、运行节点或额外 World 对象。

每次放置先复制演员声明，再应用该演员的覆盖，最后把 `offset` 加到位置上。覆盖位置是片段内的位置，偏移后才是生成场景中的绝对坐标。未给 `offset` 等同 `[0, 0]`；越界会拒绝整次展开，不做裁剪。组本身不接受位置偏移。

覆盖不修改共享片段，也不影响其他放置。它不能更换定义、身份、分组归属或继承开关；没有删除字段或取消覆盖的操作。省略 `imageResourceId` 保留原声明，`imageResourceId: null` 只在启用投影继承时表示明确去图；两者不能互换。保留省略和局部覆盖后，已有场景规划器仍负责投影默认值和资源依赖校验。

所有片段都会验证，包括未被放置引用的片段。未知字段、解码后重复 JSON 键、重复覆盖、无效引用和循环分组均拒绝，失败不输出部分场景。

| 预算 | 限制 |
| --- | --- |
| 配方原文与紧凑生成场景 | 各最多 128 KiB UTF-8 |
| JSON 结构 | 64 层、100000 个值节点；严格 JSON 和有效 Unicode |
| 片段 | 1–32 个 |
| 声明总量 | 所有片段合计最多 128 个演员和 128 个组；每个片段至少一个演员 |
| 放置 | 1–128 次 |
| 展开总量 | 1–128 个演员、0–128 个组，组层次最多 16 层 |
| 坐标 | 原位置、覆盖位置、偏移和最终位置各轴在 ±100000 内 |

## 来源结果与写回边界

`--emit bundle` 返回 `viento-scene-composition-result` v1，包含 `sourceRevision`、`scene`、`sourceMap`。修订号基于输入的原始 UTF-8 字节，包括 BOM 和换行，因此内容相同但编码写法不同的配方有不同修订。

`sourceMap` 是独立的 `viento-scene-composition-map` v1；`actors` 和 `groups` 与生成数组同序。每条记录给出生成 UUID、`placementId`、`fragmentId`、`localKey`、`templatePath`、`placementPath`、`identityPath`，以及字段到贡献来源的映射。路径都是该配方中的 JSON Pointer，不是文件系统路径。

位置来源指向模板位置或覆盖位置；显式偏移还会追加 `/placements/.../offset`，表示两项数值共同得到结果。演员所属组的来源同时指出模板的 `groupKey` 与该放置的组 UUID 映射；组的父身份来源同样指出模板父键与父组 UUID 映射。每条记录自身的身份由 `identityPath` 单独表示。映射不提供字符范围、不标记可直接替换的源码跨度，也不授予现有 `sceneEditing` 或 World 保存权限。投影继承仍由后续场景模型提供有效字段来源。

CLI 的这份 sidecar 用于检查展开来历。编辑器的只读配方预览另外使用当前原文的 CST 为真实贡献项补充 UTF-16 范围，不改变 sidecar 格式。多贡献字段的主范围标为 `exact: false`；`contributors` 分别携带原文位置及 `template`、`override`、`offset` 或 `identity` 角色。派生场景的 `/actors/N`、`/groups/N` 位置和摘要不会泄露为作者来源。无法索引范围时不沿用生成文本范围，也不伪造精确位置。

来源定位不等于反向写入许可。单实例覆盖使用独立的稳定目标和原文校验流程，不直接把贡献位置当作替换授权。需要改变共享片段时，修改配方并重新查看结果；保留自己需要继续编辑的生成场景副本，避免把两份内容误认为自动同步。

## 在临时工程中验证生成场景

先复制整个 `examples/scene2d` 到临时目录，保留它的正文、登记和素材。配方输出的 v3 可以作为 **新场景** 交给现有 [`scene.create`](PROJECT_BUILD.md#创建场景)：读取该临时工程当前 World 修订，提供一个新的场景 UUID、工程已有的文档类型、尚不存在的正文路径及生成内容。先用 `mode: "preview"` 检查，再以同一基线和身份使用 `mode: "apply"` 保存。命令入口是 `scripts/world.mjs --root <临时工程> --request <请求文件>`，完整字段见[场景创建命令](PROJECT_BUILD.md#场景创建命令)。

`scene.create` 会核验定义、投影和图片，并按生成场景派生依赖登记；它共同创建新正文与登记，不能用直接覆盖旧场景文件替代。创建完成后，使用[已有计划／构建命令](PROJECT_BUILD.md#运行样例)检查新场景，运行后仍得到 plan/runtime v2。图形编辑和保存只作用于这份已登记的生成场景。

生成场景进入资源包与完整工程包时沿用现有依赖规则。配方作为独立普通文档走自己的保存与迁移链路；预览派生模型不进入资源包，也不替代原文。生成场景的导出不会自动替代或更新配方。单实例覆盖可按上面的专用流程修改当前原文草稿；共享模板编辑、删除覆盖／恢复继承、跨文件片段及多文件创作事务仍是后续工作。

## 实现与验证

共享核心提供无状态 `sceneComposition.expand`，原生与 WASM 共用实现；宿主通过可选 `viento_core_scene_composition_version()` 能力导出识别支持范围。旧核心缺少此能力时拒绝组合操作，原有几何、草稿、保存和源码补丁操作保留。组合不占用布局草稿会话，也不访问文件、World 或渲染器。

`engine/scene-composition.mjs` 提供同步 `expandSceneComposition(content)`；`engine/studio-core.mjs` 校验核心响应形状，并核对贡献指针确实属于该模板、演员覆盖、放置偏移或组身份映射；不能仅因指针在配方中存在就接受它。`engine/scene-composition-document.mjs` 在 Rust 校验后提供只读文档识别与全部声明依赖；Node CLI 负责受限文件或已登记快照读取、原始字节摘要和输出。资源包目录、读取器和导入计划分别重新检查当前源码与依赖清单。测试入口及环境边界见[验证指南](TESTING.md#场景片段组合实验)。

`resolveSceneCompositionPreview(observed, recipeId, { digest })` 位于 `engine/scene-composition-preview.mjs`。它接受 workspace v2／v3 中 recipe v1 的已登记 JSON 观察；草稿先由既有只读覆盖器应用同一保存基线。接口返回 `{ recognized, ok, model, diagnostics, composition }`，内部临时观察合并派生关系与原有手工关系，复用完整场景模型校验，不返回这份合成观察或构建快照。模型的 World 修订、场景来源摘要和全部配方位置绑定实际输入原文；投影来源保持不变。`composition` 只包含格式版本、配方身份／路径／修订及片段／放置数量。宿主在同一次读取守护内冻结并验证图片字节，返回独立预览身份；Scene2D 的原构建捕获入口保持独立。


局部覆盖另用独立可选能力 `viento_core_scene_composition_patch_version() === 1` 和无状态 `sceneComposition.patchOverrides`。请求只含协议版本、操作、原文、`placementId`、`actorKey` 及非空的六字段 `values` 子集；成功回执为 `compositionPatch: { afterContent, changedPaths }`，路径按 position／size／color／speed／controls／imageResourceId 固定顺序指向真实覆盖字段。输入与输出原文各限 128 KiB UTF-8，前后均由原组合规则完整校验。数值 token 与现有源码补丁使用同一 JavaScript 数字拼写规则，没有新 recipe 或 World 协议。

桥接的 `supportsStudioCoreCompositionPatch()` 独立探测能力；旧核心没有该能力时仍可展开、检查源码和处理几何。`dispatchStudioCoreCompositionPatch(request)` 核对回执只能改变指定覆盖值、来源路径及顺序真实正确，并再次通过核心严格展开回执原文；非法回执禁用运行时，普通输入错误不禁用。`scene-composition-overrides.mjs` 提供 `createSceneCompositionOverrideDraft` 与 `prepareSceneCompositionOverrideApply`，在异步摘要前分离输入快照，检查预览身份、来源修订、局部坐标和提案。主编辑器在内存应用前再次核对当前会话；Rust、提案助手和预览服务都不保存作者文件。


当前单实例覆盖的[完整证据](test-results/scene-composition-overrides/results.json)包括 Rust／原生／WASM 回执、纯提案、主编辑器与父控制器、三语界面和实际 Chrome 保存流程。浏览器检查应用前原文件不变、普通保存仅改变配方正文，以及外部冲突取消保留双方内容；桌面／移动打包副本核对新旧核心能力。重跑入口见[单实例覆盖验证](TESTING.md#单实例局部覆盖与普通保存)。这些记录不代表新安装包、Android 界面或设备验收。

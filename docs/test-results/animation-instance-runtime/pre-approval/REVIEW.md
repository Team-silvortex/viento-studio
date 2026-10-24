# 逐实例正式动画运行：技术审阅草稿

本草稿拟把已保存动画的播放范围明确写入作者文件，并在 Godot 项目组装运行中按实例维护独立播放状态。目标是让两个角色分别选择、播放和完成自己的片段，同时保留旧项目的整场景播放语义。

**当前尚未应用到正式项目。** 实施和验证位于 `/tmp/viento-animation-instance-runtime/review-workspace`。正式仓库 `/home/chiharukiryu/cdev/viento-studio` 的本轮改动已恢复到进入本轮前的状态，前轮工作保留。协议 11／适配器 0.20.0 的正式接线仍等待用户明确许可；临时目录中的运行结果不代表已安装程序已经更新。本轮保持应用版本 **0.2.0**，没有为这份草稿提交、推送、打标签或安装。

## 1. 作者选择与保存边界

新增动画文档 `schemaVersion: 4`，在版本 3 的字段上增加必填字段：

```json
{
  "schemaVersion": 4,
  "playbackScope": "instance"
}
```

以上只是新增字段示意，不能作为完整动画文件。`playbackScope` 只接受 `scene` 或 `instance`；版本 4 仍包含 `clips`，允许空数组，沿用已有片段及轨道预算。

- `scene`：整场景共用播放状态。
- `instance`：每个有动画轨道的场景实例分别维护播放状态。调用行为只能控制其登记所属实例的轨道；不根据片段参数名称、角色显示名或对象共用身份猜测目标。
- 旧版本 1–3 打开、读取、检查或预览时不升级，也不补写范围字段。作者明确选择 `instance` 后，检查生成版本 4 候选；普通“应用到原文草稿”之后，仍须在编辑器执行保存。
- 已是版本 4 的文件切回 `scene` 时保留版本 4。取消选择或取消审阅不写文件。
- 不迁移旧状态表脚本、作者脚本、其他场景、登记信息或资源文件；范围选择与状态→片段参数配置相互独立。

动画字段界面增加“运行播放范围”，以及按实例运行目前需要项目组装的说明。中英日均有明确文案。检查、完整原文审阅、应用草稿、普通保存继续使用现有工作流；来源或可选核心能力失效会撤销旧审批，不能靠恢复旧值使失效的异步结果重新生效。

## 2. Rust、WASM 与构建计划

Rust 负责版本 4 的严格格式接纳；新增可选标记 `viento_core_scene_animation_instances_version() === 1`，JS 通过 `supportsStudioCoreSceneAnimationInstances()` 门控新格式。旧能力版本号不抬升，缺少新标记时旧格式编辑仍可用。范围不会改变单份文档的纯采样、片段、时间轴或保真补丁语义。

| 层级 | 本次草案 |
| --- | --- |
| 作者动画文档 | 版本 4，必填 `playbackScope` |
| 动画子计划 | 文档 4 对应子计划版本 3；旧映射保留 |
| 场景／项目父计划 | 不为该字段升级原有父格式 |
| 能力声明 | 仅 `instance` 范围要求 `animation.instances2d`；版本 4 仍沿用片段能力 |
| 可选 Rust 标记 | `viento_core_scene_animation_instances_version() === 1` |

批准后必须从对应 Rust 源码**重新构建 WASM 及构建元数据**，再运行完整检查。不能只放入 JS／UI 修改而继续使用旧 WASM。本轮临时 WASM 的 SHA-256 是 `24f048fc124a06338a7f9e68b8c0eb196f7df34362947530bc664d573a07ad3c`，仅标识已测试草稿产物。

## 3. 正式运行协议与兼容

只有项目组装包含至少一个显式 `instance` 动画场景时，才选取项目运行协议 **11**、生成产物适配器 **0.20.0**、`assembly.json` 清单版本 **12**。适配器声明会增加新能力，但生成产物仍按实际项目需求选择对应协议。

| 项目内容 | 继续使用的生成分支 |
| --- | --- |
| 旧项目，无动画控制 | 协议 4／适配器 0.11.0／清单 5 |
| 整场景动画，无状态表控制器 | 协议 7／适配器 0.16.0／清单 8 |
| 整场景动画及状态表控制器 | 协议 10／适配器 0.19.0／清单 11 |
| 至少一处显式逐实例范围 | 协议 11／适配器 0.20.0／清单 12 |

版本 4 配置为 `scene` 本身不要求协议 11。协议 11 的组装可以包含整场景、逐实例和无动画场景，清单明确登记各场景范围与合法实例目录。旧协议读取和精确字段校验保留，不把旧记录补成带目标的新记录。

命令的**发起来源**与**播放目标**分开记录：来源保留行为绑定、实例及对象身份；目标是严格的 `{ kind: 'scene' }` 或 `{ kind: 'instance', instanceId }`。目标由冻结场景范围和已登记绑定确认，不能由调用方任意改写绑定字段进行重定向。同一实例的多个行为绑定控制同一个播放状态；不同实例分别维护片段、位置、阶段和完成状态。

项目命令仍使用一个全局递增序号。自然完成记录另外携带 `targetCommandSequence`，表示该目标最后生效命令的序号；原 `commandSequence` 表示完成发生时全局命令截止。完成通知按目标分发和验证：其他实例的命令不会使当前目标的待投递完成通知失效，同一目标的新命令则会使旧完成通知失效。场景访问、订阅身份、目标轨道归属与队列顺序仍需校验。原有全局队列和总量预算不会按实例数量成倍放大。

已补上“整个绑定记录被替换”时的端口身份校验，并用真实 Godot 验证。动画命令、完成订阅／退订和状态进入读取实际 port 对象的冻结 visit、binding 与 behavior；公开字段偏离时拒绝并保留原来源。7 个受检公开调用全部拒绝，另一个实例的订阅保持。任意 GDScript 仍不是沙箱隔离。

## 4. 正式 stop 与临时预览的差别

逐实例正式运行进入场景时，各目标从 `stopped`、位置 0、未选择片段开始，不自动同时播放。整场景旧分支的自动播放语义保留。

正式 `stop` 停止目标，并采样**当前所选范围的局部时间 0**；若选择了具名片段，对应片段起点，而不是总动画时间 0。它保留片段选择，不等于撤销所有动画影响或还原作者静态外观。

保存态预览是独立编辑器会话。其单实例 Stop／全部停止会撤销对应临时覆盖并显示作者静态外观；预览的“整场景／按实例”切换不写入运行范围，不修改源文件，不承担运行协议授权。隐藏、关闭或替换预览快照时仍按原会话规则清理临时状态。

## 5. 当前支持范围

- 本轮正式运行目标是 **Godot 项目组装**的二维动画。现有状态表作者源码不自动升级，生成运行包装层按明确范围接线。
- 单独场景构建遇到 `instance` 范围会明确拒绝，错误码为 `build_animation_instances_require_project`；不能静默退回整场景运行。单独保存态场景预览仍可使用。
- **Bevy 尚未接入这项逐实例正式动画能力**，不能把中间层格式接纳当作后端执行能力完成。
- 没有新增原生安装验收、Android 验收、外部实体 IME 验收或 3D 动画覆盖声明。

## 6. 已完成的范围验证

以下证据均来自临时审阅副本；不同测试组有重叠，不应相加宣传为独立总数。主任务将补充最终核心／运行／回归总表。

| 验证 | 当前结果 | 证据 |
| --- | --- | --- |
| Rust 动画相关测试 | 34 通过，含本轮 4 个范围测试 | [rust-related.log](/tmp/viento-animation-runtime-scope/rust-related.log) |
| 新范围测试及原动画编辑器回归 | 69 通过：本轮 23 项＋原编辑器 46 项 | [final.log](/tmp/viento-animation-runtime-scope/final.log) |
| 较广动画／片段／时间轴／预览相关组 | 173 项，168 通过，5 个可选原生比较跳过 | [related-first.log](/tmp/viento-animation-runtime-scope/related-first.log) |
| 真实 Chrome 范围创作与构建声明 | 最终完整流程通过，5 张截图 | [browser.json](/tmp/viento-animation-instance-runtime/evidence/browser-scope-1792816336049/browser.json) |
| Godot 逐实例专项 | 18项分别完成验证：原批次17通过，最后1项修正去重断言后单独通过；生产文件保持 | `godot-target-identity-final.log`、`godot-target-port-identity-final.log` |
| 真实 Godot 旧协议7与10 | 3/3 | `godot-target-identity-legacy-final.log` |
| 最终完整应用检查、文档与图谱一致性 | 批准正式接线后执行／更新 | 待执行 |

Chrome 使用独立临时工程、配置及浏览器 profile，版本 `Chrome/154.0.8037.97`。脚本位于 [scene-animation-runtime-scope-smoke.mjs](/tmp/viento-animation-instance-runtime/review-workspace/scripts/tests/scene-animation-runtime-scope-smoke.mjs)，验证了：

1. 旧版本 3 打开、无变化检查及取消不会升级；切换 instance 后又切回 scene，可以取消局部变化。
2. 显式选择 instance 后，完整审阅只改变 `/schemaVersion` 与 `/playbackScope`；轨道、片段、身份、数值和循环属性保持。
3. 中英日 390px 下选择节点和焦点保留，检查结果和片段采样值保持，项目组装提示精确翻译，无横向溢出，取消／检查／应用按钮可见。
4. 应用仅改普通源码草稿；保存才写入版本 4。BOM／CRLF 保留，除动画 JSON 外其余 **13 个作者文件**字节不变。
5. 重新打开后 instance 选择正确恢复；切回 scene 的候选仍是版本 4，取消不写入。临时保存态预览范围切换、片段选择和 seek 不改正式范围。
6. 从真实已保存字节捕获计划，确认动画子版本 3、`animation.instances2d` 与项目父版本 1；直接调用实际适配器生成入口确认单场景拒绝，**没有启动 Godot**。

[保存后的计划](/tmp/viento-animation-instance-runtime/evidence/browser-scope-1792816336049/saved-plans.json)与以下截图均单独保存：

- [中文 390px](/tmp/viento-animation-instance-runtime/evidence/browser-scope-1792816336049/runtime-scope-zh-CN-390.png)
- [英文 390px](/tmp/viento-animation-instance-runtime/evidence/browser-scope-1792816336049/runtime-scope-en-390.png)
- [日文 390px](/tmp/viento-animation-instance-runtime/evidence/browser-scope-1792816336049/runtime-scope-ja-390.png)
- [桌面审阅](/tmp/viento-animation-instance-runtime/evidence/browser-scope-1792816336049/runtime-scope-reviewed-desktop.png)
- [独立保存态预览](/tmp/viento-animation-instance-runtime/evidence/browser-scope-1792816336049/runtime-scope-independent-saved-preview.png)

最终 Chrome 报告内所列源码哈希在该轮执行前后相同。首轮因测试错误比较翻译后的标签文本而失败，已保留原报告；修正为比较实例身份及实际采样数值后通过，后又加入三语项目组装提示精确断言并再次通过。后续运行权限修复的最终 Godot 证据应另行记录，不能借用这份 Chrome 报告证明没有覆盖的运行行为。

## 7. 正式接线前后的剩余步骤

临时副本已完成绑定身份修复及原生验证，独立 ZIP 交付已通过真实 Godot 迁移运行验证。可审阅补丁为 `wiring.patch`，逐文件基线与目标 SHA 为 `manifest.json`；已通过正式仓库上的 `git apply --check` 只读预检。取得用户对协议 11／适配器 0.20.0 升级的明确许可后，才把补丁应用到正式仓库。正式接线时重新构建 WASM，执行完整应用检查与必要真实链路复验，再更新当前文档及功能图谱，分别标明作者格式、运行能力、验证成熟度与尚未支持的后端。

这份草稿不包含自动迁移作者内容、应用版本递增、commit／push、标签／Release 或安装动作。实际交付范围由主任务在获得许可后明确记录。

## 追加回归与审查记录

以下各组范围可能重叠，不相加为覆盖率；全部结果来自 `/tmp` 审阅副本。

| 验证组 | 结果 | 证据 |
| --- | --- | --- |
| 中间层命令、完成与状态来源 | 167/167，其中新目标专项24 | `/tmp/viento-animation-target-runtime/engine-wide-final.log` |
| 后端、项目、观察与回看 | 148项：143通过、5条件跳过 | `backend-regression-final.log` |
| 命令与完成面板，新协议双目标/三语/来源撤销 | 41/41 | `observation-p11-tests.log` |
| 新协议能力、生成准入、旧协议分流与文件预算 | 3/3 | `target-backend-tests.log` |
| 清单12目标成员与旧清单11 | 6/6 | `/tmp/viento-animation-target-runtime/inventory-review-final.log` |
| 适配器与旧控制重放 | 19项：16通过、3条件跳过 | `adapter-regression-final.log` |
| 现有构建进程生命周期 | 7项：6通过、1条件跳过 | `project-build-process-final.log` |
| 真实Godot旧图像控制重放 | 1/1 | `control-godot-legacy.log` |

审查已修复：新descriptor对旧p4/p7/p10生成结果的条件准入；控制重放暂存列表误混入指纹项；清单12控制器指向无轨道实例；状态观察面板遗漏p11准入。新端口按实际port对象身份登记冻结来源，防止公开binding被整份替换后借用其他绑定；这不构成任意GDScript的安全沙箱。最终原生结果见上述18项及3项旧协议记录。

最初旧版本哨兵（把11视为非法）的断言已更新到12，同时增加11正例。构建进程测试在受限沙箱两次出现输出截断用例超时，未修改产品代码；允许临时子进程后原测试6项通过。所有失败日志与后续修复记录保留，没有覆盖为成功结果。

完整专项最后一个负例最初错误期待7条相同诊断；运行记录按既有规则去重为1条。7次接口调用拒绝、零命令和其他目标订阅保留的断言均通过。只将测试改为至少1条且全部归原来源，单项复验通过；原18项批次失败记录原样保留。

## 独立工程 ZIP 交付实测

最终1/1通过，Godot4.7.2。通过交付校验的ZIP包含42文件、26个GD脚本及清单12；解压到独立目录，再移走原作者和构建路径，完成import、script-check和run，无协议诊断。两个v5控制器分别完成idle→action→完成→idle，共12条命令、2条独立完成、6次进入。36个作者文件全部哈希不变；运行文件和状态包装器完整，生成工程无需Studio的JS模块。

证据：`/tmp/viento-animation-target-runtime/delivery-2/report.json`、`build.json`、`author-sha256.json`、`instance-targets.zip`；日志为`/tmp/viento-animation-target-runtime/delivery-second.log`。首轮Godot因受限测试环境无法创建本地socket失败，保留原记录；随后获准仅在临时目录运行引擎测试并通过，没有借此应用正式仓库的升级。

正式接线仍需明确批准。完整应用check、正式文档/图谱同步和应用后的最终源码验证尚未执行，不能将这些专项结果标为全量验收或安装验收。

# 自由平面角色的行为局部二维意图

2026-11-04，基线 `00c06ffe9bad9389f3d4aeb344064b07ec522bb6`，应用 0.2.8 之后的未发布工作树。新接入 Godot 0.41 可选平面意图层；当前 Studio 安装仍为 0.2.0，本专题不代表安装升级或其他平台验收。[多对象压力板](../scene-physics2d-sensor-occupancy/README.md)与[物理验收样本定位](../physics-case-inspection/README.md)保留之前各自的证据、计数及源码时点。

俯视角色和 NPC 现在可以通过行为局部 `viento_planar_intent` v1 提交 `submit(x,y)`，沿现有角色停止／滑动求解移动。仅授予无 `characterMotion`、`controls: none` 的物理角色。每实例保留首个有效请求，在下一接受步消费一次；短向量保留强度，长于单位长度的有效方向归一化，无新请求归零。请求接受不证明实际移动。作者设置和完整边界见[操作指南](../../SCENE_PHYSICS2D.md#用行为脚本驱动自由平面角色)。

## 检查结果与范围

| 检查 | 结果 | 依据 |
| --- | --- | --- |
| 完整应用 | 9037 项；8376 通过、661 条件跳过，零失败／取消；1536 份 JS 语法与 API 契约预检通过 | [完整日志](app-full.log) |
| 作者创建／保存／三语／旧模板 | 132/132，零跳过；目录精确为 24 项，旧内容及有序身份断言保留 | [作者日志](author-unit.log) |
| 旧输入诊断与翻译 | 24 项，22 通过、2 条既有工具条件跳过、零失败 | [诊断与翻译日志](diagnostics-i18n.log) |
| 新普通 TXT 模板真实编译 | 24 项检查，18 项预期拒绝均正确；无解析／断言／泄漏异常 | [模板证据](starter-native/starter-native.json)、[实际输出](starter-native/starter-native-stdout.log) |
| 端口组件真实 Godot | Node 1/1；8 组共 170 项原生断言，stderr 为空 | [组件报告](port-component-initial-2026-11-04/component.json) |
| 新生成层与库存／运行 | 11/11，4 个纯检查、7 个实际 Godot；181 条样本、60 次预期库存拒绝 | [后端汇总](backend-final/summary.json)、[结构化记录](backend-final/generated-native.json)、[最终日志](backend-final/generated-final.log) |
| 适配器描述符／指纹／历史生成 | 11/11，零跳过；三份历史源码快照与 HEAD 字节完全一致 | [适配器日志](backend-final/adapter-final.log)及后端汇总 |
| 旧实例输入／预算／时钟／平台 | 61 项，22 通过、39 条工具／窗口条件跳过，零失败 | [兼容日志](compatibility-final.log) |
| Chrome 作者流程 | 真实创建、取消、普通保存、双实例绑定／各四参数、审阅／取消／应用／保存／重开；中英日 390px | [浏览器报告](browser-initial-2026-11-04/browser.json) |
| 项目构建、迁移与离线交付 | 原作者、恢复和离线 ZIP 三次真实运行；实际 import 与 script-check 均成功；19 份文档恢复，57 个作者文件摘要保持 | [最终原生报告](native-source-verified-2026-11-04/native.json)、[阶段与运行输出](native-source-verified-2026-11-04/stdout.log) |

各组有交集，不把计数相加为覆盖率。组件使用真实 Godot 直接加载生产 helper／port，但受控 host 只提供访问、暂停与切场景状态，不能代替完整工程或碰撞求解。实际生成工程另由七组后端检查和独立迁移／离线运行证明。条件跳过不算真实工具通过，按键动作状态注入不冒充物理键盘设备验收。

环境为 Linux x86_64、Node 24.21.0、Chrome 156.0.8078.73、Godot `4.7.2.stable.viento_audiofix1_ed1daf0bf`。最终原生报告守卫 22 份来源的执行前后 SHA-256，浏览器及组件也各有来源守卫；与当前文件逐项核对。后端汇总的来源摘要明确是在最终检查后采集，不改称执行前后双向守卫。

## 实际作者、物理与交付链

浏览器使用新建的隔离作者夹具，预览 **Godot / 平面运动意图**，验证取消不写入，普通保存 TXT，再在两份实例绑定分别填写 `left_action`／`right_action`／`up_action`／`down_action`。应用只更新草稿，明确保存后重开核对；中英日窄屏和桌面截图在[浏览器目录](browser-initial-2026-11-04/)。工程自己的类型名称不因切语言被改写。

原生夹具包含两个共享同一 OC 和脚本的自由平面角色，分别使用停止／滑动响应；另有旧重力角色及原角色意图、传感器和移动平台。独立作者输入映射已保存并由 schema 2 项目装配引用，第二角色的四个 `p2_*` 动作来自该映射；测试 driver 只注入已存在动作的按下／释放状态，不临时注册动作。

原作者、恢复工程与离线工程每次分别检查三个角色各 30 步：斜向请求长度受速度约束、停止角色撞墙停住、滑动角色沿墙继续、第一角色释放时第二角色仍独立移动。所有样本把物理来源的 `/bodies/N` 逐条反查为对应 `bodyId` 与 `instanceId`；原生输出保留完整观察。第三角色继续受重力并接收旧意图，真实传感器发布 `physics.entered`，垂直平台从 `[800,400]` 移至 `[800,424]`。

作者资源包包含脚本、行为、场景、物理、项目映射及已登记依赖，恢复到不同正文目录后逐字核对 19 份文档，保留源码行尾及身份／关系。恢复工程通过完整 `buildProject` 的 import 和 script-check。生成工程 ZIP 为 302733 字节，原作者、恢复作品及原构建目录改名使其不可用后，搬移的工程仍通过真实 Godot 执行；原作者 57 个文件摘要与初始相同。工具仍需另行提供，归档不是独立游戏发行程序。

## 首轮发现、修复与保留

- [作者初次失败](author-initial-failure.log)是旧模板目录数量断言未更新为 24，后来修正精确数量并保留原有 ID 顺序和旧模板字节断言。
- [后端初次记录](backend-final/generated-initial-failure.log)包含测试误设固定速度 120（夹具实际为 240），以及错误代码归属断言；后续从准入计划取速度，明确新旧入口各自错误合同。
- [独立工作流首轮](native-initial-2026-11-04/native.json)真实运动成功，但恢复工程构建被新库存拒绝。旧生成层把重力／平台信息拆到侧文件，新校验误读降级 `physics.json`；此外 Godot 导入会生成 `.gd.uid`。修复后根据原运动侧文件复原资格，只允许已认证 GD 的正常有界 UID 配对，孤儿 UID、未知 GD 和链接仍拒绝；完整旧库存校验继续运行。
- 审阅阶段补了消费前的重入门控、零／非法步不吞请求、场景离树撤销以及 ready 阶段授予与 queued-switch 受理分离；不是已经复现的每项产品故障，实际回归范围见后端报告。
- [受限执行环境失败](backend-final/adapter-restricted-environment-failure.log)没有启动单项测试；同一冻结源码按已有执行环境重试为 11/11。不能将这次环境失败算作产品测试通过，也未据此改源。

[中间通过记录](native-final-2026-11-04/native.json)、[阶段明细通过记录](native-verified-2026-11-04/native.json)保持原样；最终正式依据是[精确来源复验](native-source-verified-2026-11-04/native.json)，其增加逐条 body 来源验证。所有旧专题文件字节和既有图谱坐标／评分保留，只新增本轮独立能力。

## 复现与边界

在仓库根目录使用 Node 24 执行 `npm run check -- --app-only`。提供可信 Godot 绝对路径后，可运行：

```sh
VIENTO_GODOT_BIN=<Godot绝对路径> node --test scripts/tests/project-planar-intent-godot.test.mjs scripts/tests/planar-intent-port.test.mjs scripts/tests/planar-intent-starter.test.mjs
```

完整 132 项作者范围见[作者日志](author-unit.log)；核心入口、提示与保存回归分别为 `planar-intent-starter.test.mjs`、`project-input-action-planar-diagnostics.test.mjs`、`script-authoring.test.mjs`、`script-authoring-host.test.mjs`、`script-create-ui.test.mjs` 及各旧物理 starter 测试。

完整原生／浏览器分别运行 `scripts/tests/scene-physics2d-planar-intent-smoke.mjs` 和 `scripts/tests/planar-intent-authoring-smoke.mjs`，使用 `VIENTO_GODOT_BIN` 指定可信工具，原生用 `VIENTO_PLANAR_INTENT_OUTPUT`、浏览器用 `VIENTO_PLANAR_INTENT_UI_OUTPUT` 指定本专题新的空目录；浏览器另可传 `/usr/bin/google-chrome`。不要覆盖已有证据。脚本清理临时作者、工具 profile、服务和搬移目录，不更新本机安装。

本轮没有升级作者格式、Rust／WASM 或项目／物理观察线协议；适配器 0.41 与新生成层进入执行指纹，旧冻结工程需显式重建。普通 TXT 可继续手工编辑，官方源诊断只认识原样模板。有限物理输入回放仍拒绝作者行为，不能把本端口当作已完成逐角色回放。持续接触、刚体、材质、Bevy 物理、其他宿主／设备及独立发行尚未接入；未编译或验收新 Tauri 安装包。

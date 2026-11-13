# 二维运行主相机：2026-11-11 工作树验证

应用版本保持 0.2.9；本轮未提交、发布、更新本机安装或迁移真实作品。新增可选相机作者格式 `viento-scene-camera2d` v1、能力 `scene.camera2d`，Godot 执行描述符为 0.43.0；含相机的工程使用独立 0.43 相机包装。原 Scene2D／运行观察线协议和旧永久生成脚本保持。

## 交付与职责

- 作者可在“构建与运行”选择场景后打开“运行主相机”，设置固定中心或稳定实例跟随、偏移和统一缩放，审阅后显式保存。编辑画布取景不写入相机。
- 纯合同检查独立 16 KiB 文档、双向登记、场景成员和冻结计划；无相机时不增字段或能力。缺能力标志、不支持的后端与 producer 漏报在执行前拒绝。
- `camera2d.create` 原子创建正文、登记和场景引用，日志 v13 支持中断恢复；具体补丁经用户明确允许后才应用。后续保存复用原来源修订检查，字段表单仅替换 `/camera`，语义无变化时保留全部原字节。
- Godot 可选外层只增加入口与原生 Camera2D，follow 绑定最终逻辑根。物理使用原求解器；视觉动画子节点不会带走镜头。退出／重入重新释放和绑定。
- 作者包按稳定 UUID 保存完整依赖；正文、包读取与最终目标导入都检查跟随目标及反向引用。生成工程 ZIP 则独立严格验证库存与来源。

操作与格式见[运行主相机](../../SCENE_CAMERA2D.md)。领域、事务、界面与具体引擎层均可分别替换；本轮是当前实验宿主范式验证，不是 ns-nova 原生 GUI 实现。

## 分层结果

| 证据 | 实际范围 |
| --- | --- |
| [领域与包](domain.json)、[最终日志](domain-final.log) | 初版纯12/12与资源包4/4；兼容修复后纯14/14（见[最终便携回归](portable.json)）；同OC多实例、完整4文档迁移、正确checksum伪造、外部目标最终复核。组合61项：60通过、1既有条件跳过 |
| [准入](admission.json)、[日志](admission-final.log) | 新准入7/7；standalone／assembly子场景漏cap、双层漏cap、不支持后端、未知目标和producer漏报均拒；相关组合60项：59通过、1既有条件跳过 |
| [创建规则](transaction/pure.log)、[事务](transaction/camera-final.log)、[旧物理事务](transaction/legacy-physics.log) | 新规则7/7、真实子进程事务20/20；旧物理创建恢复18/18，均无跳过；并发、SIGKILL、多阶段恢复、失联、外部替换、伪造与symlink冲突 |
| UI／作者服务／原文编辑 | 最终14项局部回归全部通过；完整执行记录包含于下方 app-only 日志。真实请求合同与真实 HTTP 错误转换参与回归 |
| [最终浏览器](browser-final-source-2026-11-11/browser.json) | Chrome156真实HTTP作者流程，117断言、0错误、20源码哈希前后及当前一致；取消无写、首次3文件、更新仅相机正文、未知目标拒绝、真实409后保留表单／外部空格并重审保存、no-op无写、三语390px可操作 |
| [原生汇总](native-frozen-final-2026-11-11/summary.json)、[最终日志](native-frozen-final-2026-11-11/native-final.log) | 真实Godot5/5无跳过；31个框架观察样本，另真实作者动画轨道补充2样本，共33；4次场景访问的5样本、fixed极值、21物理样本、窗口与离线ZIP分别留存 |
| [真实像素](native-frozen-final-2026-11-11/window-pixels.json)、[作者动画轨道](native-frozen-final-2026-11-11/animation-track-follow.json) | 5张实际窗口PNG；固定缩放、跟随同OC第二实例、视觉偏移／旋转隔离、实际VientoVisual offset2d轨道；Xvfb＋Mesa llvmpipe软件OpenGL，不是硬件GPU验收 |
| [工程ZIP](native-frozen-final-2026-11-11/camera-project.zip)、[离线执行](native-frozen-final-2026-11-11/offline-delivery.json) | 标准构建、严格库存、正式ZIP导出验证；将原作者和build目录移离，再解包、import、script-check和执行，核对相机、逻辑坐标及viewport |

最终完整应用 **9192项：8521通过、671条件跳过，零失败／取消**；1576份JS语法、版本与API契约预检通过，2589份代码／测试来源前后完全一致（[守卫](full-check-sources-after.json)）。

完整应用 `npm run check -- --app-only` 的最终计数见[执行状态](full-check-status.json)和[完整日志](full-check.log)。本轮执行时未配置原生归档／移动存储与引擎专项工具的条件项按实际日志跳过；上表真实Godot专项另在明确工具与隔离图形环境下运行，不能将跳过计作通过。完整检查前后源指纹单独保存，不将各分层组简单相加为覆盖率。

## 审查、首败与修正

1. 首轮完整应用9190项：8516通过、671条件跳过、3失败，冻结2589份源码均未变化。两项是未选相机的旧跨realm观察被新resolver过度拒绝；另一个是便携规划VM测试未加载新增真实依赖。修复保留旧测试输入、无host断言与新相机严格准入，随后独立完整重跑。原[完整日志](full-check-initial.log)、[状态](full-check-status-initial.json)和[源守卫](full-check-sources-after-initial.json)保留。
2. 新包夹具最初漏 workspace paths／assetStores、随后混用了v3与v2目录；修正夹具，未放宽生产准入。[首轮](domain-initial.log)、[第二轮](domain-second.log)保留。
3. 新准入测试最初直接修改冻结DTO；旧 VM 检查原本没有依赖装载，接入真实相机validator后需要在同一realm装入其真实依赖，保持无host globals与严格getter检查。修正和精确命令见[准入回执](admission.json)。
4. 真实Godot最初测试期望未规范化UUID节点名、并遗漏stage图片资源；只修夹具。独立动画探针起初未推进权威项目时钟，轨道正确停在0；补探针时钟后验证实际轨道取样。原日志与原因见[初版原生汇总](native-2026-11-11/summary.json)。便携兼容修复后重新录制[最终原生证据](native-frozen-final-2026-11-11/summary.json)，16项冻结源码／测试前后不变，旧专题22文件保持；补充observer仅复制后修改一处输出路径，差异与哈希见该目录 observer-provenance.json。
5. 独立审查复现确定409冲突被误作“结果未知”而卡死，以及no-op改写源格式；已修。UI必须使用真实HTTP转换后的 `error.code`，测试现通过实际 `makeRequestError`；确定业务拒绝保留表单和新基线，撤销旧票据，用户重新审阅才可提交。未知传输结果仍只读核对，不重复写。实际HTTP409→重审→200与no-op由最终Chrome证据证明。
6. [首轮浏览器](browser-2026-11-11/browser.json)发现默认文档类型可能选为角色，已改优先camera2d／camera／document；随后复测分别留在 [final](browser-final-2026-11-11/browser.json)与[审查修复版](browser-review-fixed-2026-11-11/browser.json)。审查修复版运行时最后两项错误码白名单改动导致一个源码与当前不同，故再次运行[完全冻结版](browser-frozen-2026-11-11/browser.json)，20项源码当时全部吻合。首轮完整检查发现便携兼容问题并修正后，再运行[最终源码版](browser-final-source-2026-11-11/browser.json)，20项源码含修正后的相机解析器均与当前一致。旧报告不改写为最终源码验收。

## 来源与边界

[保留证明](preservation.json)核对13020份已跟踪历史证据、之前两轮未提交专题43／39文件均不变；旧生成GD／文本按该证明和原生[source guard](native-frozen-final-2026-11-11/source-guard.json)各自明确扫描范围核对。前一轮版本、报告和来源摘要不改写为本轮重测。

当前仅Godot项目组装。运行视口仍使用组装入口尺寸；无相机场景恢复原默认取景。历史专用逻辑／物理输入回放使用原driver入口，只验证轨迹，不承担相机画面验收。现有标题标签是世界内容，本轮未增加屏幕空间HUD。平滑、死区、limits、旋转、震屏、多活动相机、镜头编排、Bevy相机、内嵌视口、硬GPU、持续输入、安装包及其他操作系统未在本轮交付或验收。

# 角色碰撞响应：停止与滑动

2026-10-25，基于源码 0.2.2 的未发布工作树。本轮接通 **角色响应选择 → 完整原文审阅／保存 → 冻结项目 → Godot 原生碰撞 → 独立工程交付**。本机安装仍为 0.2.0，没有提交、推送或制作安装包。操作见[二维物理指南](../../SCENE_PHYSICS2D.md#选择角色的碰撞响应)。

## 格式与职责

- schema 1 保持旧七字段和停止语义；schema 2 仅角色允许可选 `collisionResponse: "stop" | "slide"`，省略为停止。显式选 slide 才升级，切回 stop 不降级；静态体、传感器不接受响应字段。
- Rust 使用独立 `scenePhysics2D.inspectResponse` 和可选 WASM marker，原 `inspect`、主 ABI 与数值规则保持。来源补丁只改 schema 叶、响应字段和用户修改的字段；BOM、CRLF、转义键、无关数值拼写及其他体保持。
- 表单经检查、完整审阅、Apply 与普通 Save；首次创建复用 v12 三文件事务及恢复。偏移／尺寸几何 DTO 不承载运行策略，作者响应仍完整保留。
- 中立物理计划继续为 v1。只有实际 slide 角色要求 `physics.character-slide2d`，场景、父项目、provider 和生成回执各自核验；两个 Bevy 通道拒绝。
- Godot adapter 0.22.0，schema 2 独立响应包装 0.22.0；旧 schema 1 物理生成器仍为 0.21.0，旧物理／无物理产物字节与生成器指纹保持。执行适配器指纹变化意味着旧冻结构建需重建。项目协议按既有动画选择，本次没有新增物理线协议。
- 滑动把每次显式物理步的未完成位移投影到碰撞切面，最多继续四次；stop 保持一次 `move_and_collide`。参考 Godot 的[角色运动说明](https://docs.godotengine.org/en/stable/tutorials/physics/using_character_body_2d.html)及[碰撞剩余量接口](https://docs.godotengine.org/en/stable/classes/class_kinematiccollision2d.html)。这里没有重力、地板／斜坡策略、刚体、摩擦、3D 或 Bevy 物理。

## 实际验证

| 范围 | 结果与证据 |
| --- | --- |
| 最终完整应用检查 | 7970 项：7599 通过、371 条件跳过，零失败／取消；1318 个 JS 语法与 API 契约通过；[日志](full-check.log) |
| Rust 完整核心 | 407 通过，零失败／忽略；[日志](core-native-full.log) |
| 核心、保真补丁和创建计划 | 61／61；其中新增 20 项，含 v2 响应穿过偏移／尺寸提案后保持；[日志](domain-core.log)、[WASM 构建](wasm-build.log) |
| 首次创建与故障恢复 | 6／6；工作区 v2／v3、精确三文件发布、intent／data／commit 崩溃恢复及非法声明拒绝；[日志](creation.log) |
| 最终 UI 与相邻回归 | 108／108；新增响应测试 22 项，含摘要等待期间能力撤回；[日志](ui.log) |
| 新后端矩阵 | 7／7，无跳过，覆盖 19 个真实 Godot 运行场景；[日志](backend.log)、[实际坐标和事件](backend.json) |
| 旧物理原生回归 | 9／9，无跳过；[日志](legacy-native.log) |
| 相邻后端回归 | 52 项：38 通过，14 条件跳过；[日志](adjacent-backend.log) |
| 最终真实 Chrome | 5 条流程、4 张截图、17 个来源摘要，运行前后源码不变；[报告](browser-1792916900275/browser.json) |

各项有重叠，不能相加为覆盖率。完整应用检查使用 `npm run check -- --app-only`，不读取日常作品的正文、模板与静态索引。最终计数以 [full-check.log](full-check.log) 为准；缺少可选工具的项目保持跳过，Godot 专项另外显式启用真实工具。

最终浏览器验证：旧 schema 1 无变化检查不产生应用提案；显式 slide 审阅包括 schema 2，Apply 只改草稿，普通 Save 只改物理 JSON；重开显示 slide；改回 stop 保持 schema 2，取消保留已保存内容。390px 中英日切换保持原控件、焦点、审阅与操作页脚。它是 Chrome HTTP 编辑服务验收，不是 Tauri 安装、Android 设备或图形物理回放验收。

## 真实运动对照

作者 GDScript 使用正常绑定驱动方向键输入，没有修改生成运行脚本。每项运行约半秒，前半段移动；矩形／圆形角色起点 `[100,180]`，右侧墙在 x=150。下表取 [backend.json](backend.json) 的最终实际坐标，保留原始小数于报告。

| 场景 | 停止 | 滑动 | 验证结果 |
| --- | --- | --- | --- |
| 矩形斜向遇墙 | `[134.926,215.045]` | `[134.994,222.426]` | 滑动保留向下切向位移；v1、v2 省略 stop 和显式 stop 完全一致 |
| 圆形斜向遇墙 | `[134.939,215.040]` | `[135.001,222.427]` | 同样保留切向运动，旧停止坐标一致 |
| 无墙／mask 不相交 | `[142.426,222.426]` | 同左 | 响应选择不改变自由移动 |
| 正向撞墙 | `[134.999,180]` | 同左 | 没有切向位移时都停止 |
| 双墙转角 | — | 矩形 `[134.925,219.925]` | 有界迭代收敛，圆形也通过；闲置最后两帧稳定 |
| 碰撞偏移 `[10,0]` | — | `[124.994,222.426]` | 逻辑碰撞提前，视觉偏移仍为零 |
| 反向撤离 | — | `[92.533,179.966]` | 角色可离开接触面，无粘墙 |

普通运行对每个隔离工程的 41 个作者文件做前后 SHA-256 比较。交付样例经产品构建和 ZIP 导出，随后使原作者和构建目录离线，再从独立解包路径导入、检查全部脚本并运行：碰撞、传感器 entered／exited、动画 `idle → action → idle` 与完成来源均通过。生成文件清单还覆盖 schema 2 的 `physics-stop.gd`，缺项、额外场景、越界路径和符号链接被拒绝。

## 发现与修复

独立审核发现首次创建在 `digest` 等待期间丢失响应能力后仍能发送 schema 2 请求。已在命令发布前复核本次请求的能力依赖；撤回时保留输入并清除旧审阅，已经发布的 apply 则继续确认／恢复，避免重复创建。新增回归覆盖预览前撤回、保存前撤回、旧 stop 不受影响及发布后继续确认。修复前的[复现脚本](review-race.mjs)留作问题记录，最终可重复测试位于 `scripts/tests/scene-physics2d-response-create-ui.test.mjs`。

第一次完整检查 [7966 项日志](full-check-before-race-fix.log)为修复前版本：7595 通过、371 跳过；随后新增 4 项竞态回归并对最终源码重新跑完整检查。原始过程保留：

- [第一次原生日志](backend-attempt-1.log)：沙盒禁止 Godot 建立 socket，改用授权的本机执行后继续；不是物理实现失败。
- [第二次](backend-attempt-2.log)、[第三次](backend-attempt-3.log)：探针错误假设无动画场景也有 `VientoVisual` 专名，并逐字节比较不同输出格式的浮点数；另将 Godot 原生安全边距约 0.1px 的恢复误判为漂移。探针改为查找真实视觉节点、使用明确容差，并增加最后两帧稳定断言。生产响应算法没有因这些探针修正而更改。
- [首次 Chrome](browser-1792916420585/browser.json)在创建器竞态修复前通过编辑器流程；[最终 Chrome](browser-1792916900275/browser.json)在修复后重跑，旧报告未覆盖。

未验证实体输入窗口、安装升级、触屏设备、GPU 物理或 Bevy 响应；`moving`／`idle` 仍是输入意图，实际受阻应看位置。图谱仅追加本轮功能和证据，历史评分与报告保持。

来源与保留审计见 [provenance.json](provenance.json) 和 [preservation.json](preservation.json)。图谱原有长篇范围元数据另保存在 [prior-atlas-meta.json](prior-atlas-meta.json)，新图谱只保留当前范围说明，旧功能、评分与证据对象逐项保持。

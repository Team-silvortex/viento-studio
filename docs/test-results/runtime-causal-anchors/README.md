# 运行因果锚点与引用保留

2026-10-26，0.2.5之后开发工作树。`causalAnchors` 从已准入的完整项目观察提取必要来源，独立保存于会话和任务接口。Godot执行适配器／生成层仍为0.33.0，旧GDScript、作者格式及项目协议1–11未改变；本机安装仍为0.2.0。

## 行为与边界

纯入口 `createProjectCausalAnchors(runtimeObservation, { recentPerKind = 16 })` 先经完整运行观察查询校验，再建立稀疏节点、保留根和引用闭包。四类节点为项目事件、动画命令、动画完成和动画状态进入；ID保留原类型与序号，不重编号。每类默认保留最近16项，可显式设为0–64。

最近记录以外，尚未返回的事件／完成投递、当前访问的每播放目标最新回执和每控制器最近进入仍作为保留根。已完成投递若仍被状态进入引用，也继续保留。进入引用触发事件／完成；完成引用准确的播放命令；全局命令截止另记为 `global-watermark`，不能当作产生该结果的命令。逐实例完成的 `commandSequence` 和 `targetCommandSequence` 可以不同。场景自动播放没有显式命令时不伪造播放原因。

返回 `viento-project-causal-anchors` schema1：`nodes`保留完整冻结来源，`roots.reasons`注明最近／未决／目标基线／最近控制器进入，`edges`区分 `trigger`、`global-watermark`、`playback-command`，`retention`逐类及合计给出总量／保留／未纳入数量。根之间可共享节点，引用闭包不因尾部轮转而丢失。稀疏结果不能交回要求完整序号数组的旧reader。

宿主在通知消费者之前同时捕获运行观察和锚点；成功、取消、失败与通知异常最终都保存最后合法投影。任务接口复制实时和最终值。初始化失败保留空投影；非法原始帧不会成为来源。当前没有新增界面控件。

该投影**不精确标注业务事件发生在哪个执行窗口**：现有clock延迟合并输出，不能按日志相邻关系推断归属。没有请求ID的动画入队不被称为待执行命令；最近控制器进入也不等于实时活跃状态。原完整语义账本、退休订阅、身份去重和累计预算继续独立存在，本轮未裁剪执行器账本，也未开启连续运行。

## 验证证据

- [宿主与任务接口](host-tests.log)：4／4通过。覆盖完成保存、可变回调副本隔离、pending事件后通知抛错、初始化通知抛错，以及任务接口实时／最终值。生成与冻结校验真实，进程使用替身。
- [原有任务与收尾回归](host-regression-first.log)：17／17通过。
- [完整应用检查](full-check.log)：`npm run check -- --app-only`，8476项，7939通过、537条件跳过，零失败／取消；包括新增12项纯合同测试和4项宿主测试。[退出结果](full-check-exit.json)及[执行前后源码摘要](full-check-sources.json)留存。
- [原有真实调度回归](clock-regression.log)：9／9通过，覆盖同帧调用、物理帧、窗口轮转、七维限额、切场景、取消和观察异常；[退出及源码摘要](clock-regression-exit.json)均一致。
- [真实Godot最终矩阵](native-final.log)：4／4通过。每案保存作者摘要、冻结构建、输出、会话、回调观察及源码摘要，落盘和返回一致，运行临时副本已清理。

| 原生案例 | 检查结果 |
| --- | --- |
| 状态触发与长尾 | 42个时钟窗口仅留32；259条原始帧仅留128；91条语义记录投影为39个锚点。早期event1和command4均已离开最近16项，仍由进入／完成引用保留 |
| 逐实例播放 | 完成的全局命令截止为4、目标命令为2；两条边分别保留，其他实例命令不被当作播放原因 |
| 取消未决投递 | 原始166帧／41个窗口已轮转，取消仍保留pending事件及冻结来源 |
| 切场景与结束 | 原始187帧／42窗；最近数设0时旧访问基线释放，新访问保留自己的基线；正常结束后无剩余根 |

以上为Linux、Node24.21.0、Godot4.7.2的无头逻辑证据，不等于图形窗口或安装验收。原生脚本通过作者端口执行行为，测试探针只读引擎计数并确定性结束会话。

## 失败与记录范围

切场景案例的[原生stderr](native-final/visit-release-tail/stderr.log)仍含退出时2个ObjectDB实例未释放的警告；[上一轮切场景证据](../runtime-execution-clock/native-revalidated/matrix/session-boundaries/stderr.log)已有相同警告。本轮未确定泄漏对象身份，不能把成功退出解释为无泄漏；4项通过只涵盖所列逻辑、来源与会话断言。

[宿主首轮](host-tests-first.log)为3通过、1测试入口失败：项目组装错误使用 `sceneId`，正式服务要求 `targetId`；修正夹具后4／4通过，未放宽生产准入。

[原生首轮](native-first.log)已4／4通过，随后强化长尾场景，使事件和命令同时离开各自最近16项。首轮完整session被同目录复验覆盖，未伪造或重建旧session；最终完整证据保存于 `native-final/`，最终源码与作者摘要另外核对。

复现：

```sh
node --test scripts/tests/project-causal-anchors.test.mjs scripts/tests/project-causal-anchors-host.test.mjs
VIENTO_GODOT_BIN=/path/to/Godot node --test scripts/tests/project-causal-anchors-godot.test.mjs
```

`VIENTO_CAUSAL_ANCHORS_EVIDENCE` 可指定原生证据目录。设计见[中间层](../../BACKEND_MIDDLEWARE.md#因果锚点投影)，字段见[纯引擎说明](../../../engine/README.md#项目因果锚点)。

## 保留核对与图谱

[最终源码核对](native-source-verification.json)逐案比较38个源文件，且完整检查及旧调度回归的源码前后未变。作者摘要、会话一致性和临时目录清理均通过。专项与完整检查有交集，不相加为覆盖率。

[保留核对](preservation.json)以本轮开始的12949文件为基线，覆盖原报告、原引擎模块、全部既有后端源码、Rust与发行身份；没有删除基线文件，WASM字节保持。[评分审阅](score-review.json)仅追加新功能与证据，旧评分条目保持；新增解耦为3，尚无第二执行目标复用的验收。图谱更新为177功能、532实现、742绑定、2968评分单元、537依赖及141工作流。

[图谱检查](atlas-check.json)与[文档链接核对](docs-links.json)分别保存。本轮完成宿主侧观察投影；下一步是明确引擎侧请求身份与精确触发观察，再讨论执行账本裁剪和实时准入。

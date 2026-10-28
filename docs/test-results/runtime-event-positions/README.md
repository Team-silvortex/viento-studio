# 事件发布与逐收件者位置

2026-10-28，0.2.5之后的开发工作树。事件发布和逐收件者投递现在可以关联精确业务帧索引及Godot实际idle／physics帧，并在原始业务帧尾部淘汰后保留未决事件的位置。观察层复用现有已准入业务回执和执行帧封套，不引入新的请求ID、引擎旁路协议、生成脚本或运行预算。

## 合同与边界

`event-publish` 自带发布序号和冻结收件人；它在预算预约之后、实际队列插入之前输出。观察到发布帧证明该业务发布事实已准入，不能推定随后队列插入完成。无收件人的发布立即记为settled，不产生投递位置。每个 `event-delivery` 以(sequence, subscriptionId)识别，记录真实 `handled` 或 `skipped` 回执的执行帧索引和时钟；多收件人可分别保留结果。

回调可先产生状态修改或嵌套发布，再返回失败而没有投递回执。此时已有handled回执与其位置保留，其余收件人仍为pending；pending仅表示缺少有效回执，不能推断回调没有执行、没有副作用或已经丢弃。观察层不根据abort或stdout顺序补造清理／执行结果。完成回执中的handled表示对应回调同步返回true且宿主未失败或结束；skipped表示收件人当时不再可用，不代表回调被调用。

`eventPositions` 在会话和任务接口中保存发布来源、载荷、收件人及发布／投递位置；累计counts与retention分开。默认保留按发布序号最近32个settled事件及全部pending事件，范围可配置1–128。已有128次发布、1024次预留投递、64条待处理消息及字节预算保持；64限制的是消息而非收件人。取消、超时或观察者异常保留已准入事实并标记incomplete，不重放业务帧。节点与来源仍由冻结业务ledger核验。

仅带 `runtime.execution-frames` 的Godot项目协议3及以上选择此宿主观察器；未带能力的旧reader与其他后端保持原路径。Godot适配器描述符及生成版本没有变化，作者格式和原协议保持。执行适配器指纹增加了新reader；旧冻结构建应按现有完整指纹校验显式重建，作品文件无需迁移。

## 验证

[完整应用检查](full-check-final.log)：**8667项，8105通过、562条件跳过，零失败／取消**；版本一致性、1433个JavaScript语法检查和API契约预检通过。[来源守卫](full-check-final-exit.json)确认1406份生产／测试来源在该次完整检查期间不变。未配置原生工具的条件跳过不计作引擎验收。

- [定向集成](targeted-final.log)：**171／171通过**，无跳过；涵盖新核心与宿主、原事件、音频、动画、因果锚点和精确业务帧。[来源守卫](targeted-final-exit.json)记录冻结来源。
- [新事件真实Godot](native-first.log)：**6／6通过**，零跳过。每案在实际宿主构建后以非smoke无头模式运行，使用独立Engine帧探针核对位置；[执行记录](native-first-exit.json)确认源码未变。
- [音频与动画真实Godot回归](native-media-regression.log)：**14／14通过**，零跳过，验证外层事件观察器与既有两个请求流组合；[执行记录](native-media-regression-exit.json)确认1353份源码在该次原生运行期间不变。新事件6案与旧媒体14案合计20项真实无头案例；运行后仅调整两份非原生测试，生产与原生夹具保持。定向／完整检查互有重叠，不相加为产品覆盖率。
- [补充核心跨通道回归](core-clock-recovery.log)：**57／57通过**，其中事件位置**23项**；覆盖clock最终通知失败时事件位置仍发送incomplete、旧clock不重复通知及finish重试无业务重放。此前[纯核心回归](core-final.log)127／127通过，[宿主验证](host-first.log)12／12通过；替身的合成时钟不作为实际引擎时钟验收。

| 新原生场景 | 观察结果 |
| --- | --- |
| 作者ready／零收件人 | 2次发布，3个收件人：2 handled、1 skipped；空收件人即时settled |
| 跨帧两批 | 发布与各同步投递批次跨越真实idle／physics帧，顺序与索引匹配 |
| 嵌套发布及部分失败 | 2次发布、4收件人；第一个handled，失败回调的状态副作用可见，其余3个仍pending |
| 取消与帧尾部轮转 | 160次状态提交后取消，早期发布位置及2个pending收件人仍在 |
| 长尾留存 | 41次发布、82次handled；中途32个settled加1个pending并存，最终保留发布10–41，完整业务账本仍有41条 |
| 事件／音频／动画混合 | 三条观察流保持各自身份、原业务顺序及来源，互不推断结果 |

[核心测试首轮](core-first.log)有两项对既有最终观察者异常传播的预期不正确；修正测试后重新通过，生产收尾逻辑没有为此吞掉异常。

[完整检查首轮](full-check-first.log)有一项旧宿主测试失败：它把所有进度通道合并计数。新增eventPositions在下游结束观察出错时会发送自己的incomplete状态，独立复现确认时钟结束通知仍只有一次，详见[通道通知记录](clock-host-observer-trace.json)。该测试现分别核对starting、executionClock和eventPositions通知及落盘结果，没有压制新状态通知。新增纯核心案例另外核对下游clock失败而事件位置观察者仍可恢复的运行前和已有pending两种情况，最终定向171项全部通过。

六案中普通夹具各32份作者文件、混合案37份，均在构建和运行前后不变；每案58份源码摘要一致、session与返回值一致、临时项目已删除，stderr为空。延后夹具只控制既有flush门，没有修改时钟或回调同步性。工具为Node24.21.0、Linux x86_64上的Godot `4.7.2.stable.viento_audiofix1_ed1daf0bf`，SHA256 `d0214fafa4af018589761b772f38be02b421cd021ed69c45c1d7a4bcd2acbb04`。

## 保留与后续

[保留检查](preservation.json)核对本轮开始前Git跟踪及非忽略文件；既有报告、作者模板、Rust和WASM保持。各次检查与原生案例的[源码核对](final-source-verification.json)分别记录执行时的冻结来源。两组原生运行期间各自的1353份源码守卫均通过；随后仅调整 `scripts/tests/project-execution-clock-host.test.mjs` 的分通道通知断言，并在 `scripts/tests/project-event-positions.test.mjs` 补充跨通道收尾断言。生产模块、Godot生成器、GDScript及原生夹具均未改变；最终定向与完整检查使用这两份更新后的非原生测试，不把原生执行时点改标为测试文件更新后的重跑。重复的 `*-updates.json.gz` 快照无损压缩，[压缩记录](compressed-evidence.json)保存原始摘要；[评分审查](score-review.json)、[图谱校验](atlas-check.json)和[文档链接检查](docs-links.json)保留功能图谱与文档结果。

本轮是可移植读取器与Godot宿主会话／任务接口的增量，尚未新增界面、其他后端的精确帧观察或显式abort清理记录；仍使用有限会话预算。应用与本机安装未更新，设备和窗口行为未作为此次验收范围。

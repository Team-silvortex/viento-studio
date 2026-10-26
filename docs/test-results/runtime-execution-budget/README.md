# 共用有限执行预算

2026-10-26，**0.2.4之后开发工作树**。七维累计准入从事件、状态和媒体的身份计数中抽离，接入可移植事件账本及Godot新项目生成层。应用版本0.2.4、已安装应用0.2.0保持；Godot执行适配器与新项目生成层为0.32.0。规则说明见[后端中间层](../../BACKEND_MIDDLEWARE.md#有限执行预算)，操作与协议见[项目构建](../../PROJECT_BUILD.md#当前项目协议选择)。

## 范围

- 同一策略定义事件注册1024、发布128、投递1024、载荷字节524288、状态修改1024、音频请求256、动画请求256。整组成本先验证后提交，失败不部分扣费。
- 当前队列、待处理字节、活跃订阅和状态存储容量仍由各服务检查；重复订阅、同值写入、删除不存在的键不消耗累计额度。
- 业务序号、状态revision和动画reserved_count保持单调，动画请求与状态进入来源继续使用原身份；没有周期重置接口。
- Godot生成层只精确转换已知模板，登记独立策略文件和helper，运行前严格验证新库存。原生成器和所有旧GDScript源冻结，历史工程继续原库存路径。单场景原产物保持。
- 项目协议4／7／10／11、assembly清单及作者格式不变，没有新增生产观察帧。测试中预算快照由测试作者脚本打印，不是公开作者接口。

**仍为有限会话。** 第129次事件仍拒绝；flush、切场景及deferred不刷新预算。场景访问64、原始帧4096、媒体及状态累计上限、输出和时限保持；未裁剪语义账本，未支持无限运行，也未接入Bevy或Rust预算实现。下一阶段需要宿主控制的调度周期和有界因果记录合同。

## 验证

[最终冻结候选检查](candidate-native-final.log) **23/23通过，零跳过**，包括16项生成／库存／跨实现检查和7项真实调用链检查；其中13项实际运行Godot。普通、动画、状态机、逐实例和物理生成工程分别导入、解析、运行，JS与GDScript成本向量行为一致。[来源指纹与退出记录](candidate-native-final-exit.json)与正式应用源码逐项核对。

| 真实调用链 | 结果与证据 |
| --- | --- |
| 无变化操作 | 重复订阅不占新token，同值state与不存在delete不扣费；[快照](native/no-ops/summary.json) |
| pending数量拒绝 | 第65条待投递发布失败，累计配额和身份保持；[快照](native/pending-count/summary.json) |
| pending字节拒绝 | 超16384字节拒绝，发布／投递／字节配额均未部分增加；[快照](native/pending-bytes/summary.json) |
| 递归发布 | 第129次明确失败，接受128次历史保留；[快照](native/recursive-limit/summary.json) |
| 会话边界 | flush、A→B切换及deferred仍共用累计额度；完整回调独立于raw tail；[快照](native/session-boundaries/summary.json) |
| 混合调用 | 事件→状态／声音／动画均走同一预算实例，各维独立；[快照](native/mixed/summary.json) |
| 逐实例动画 | 请求预留戳、实际命令序号和pending保持各自含义；[快照](native/instance-stamps/summary.json) |

各案保存作者脚本、作者文件哈希、冻结构建、完整事件回调、stdout／stderr及session；核对作者文件不变、session落盘一致、临时运行副本清理。原生工具为Godot4.7.2.stable.official.ed1daf0bf，Node24.21.0。

[旧预算原生回归](legacy-native.log) **62/62通过，零跳过**，覆盖事件、共享状态、音频与动画四套原测试；[工具与来源摘要](legacy-native-summary.json)确认执行前后源码相同。完整app-only为**8419项，7895通过、524条件跳过，0失败／取消**；1398份JavaScript语法、版本一致性和API预检通过。[最终日志](full-check.log)、[退出记录](full-check-exit.json)和[21份源码／说明摘要](full-check-sources.json)均保存。专项有交集，不累计为覆盖率。本轮没有浏览器或安装验收；界面未修改。

## 修复与证据说明

隔离阶段修正了生成器模板搜索误中嵌套ScenePort方法的问题，改为匹配顶层方法。另修正测试把交互会话raw尾部误当成全历史的假设：完整回调与有限语义账本用于业务总数，raw只验证留存范围。最终23项检查在统一冻结的源码上重跑。

首次直接写入曾被自动审批以“覆盖所有项目、尚未充分验证的协议升级”拒绝；候选移入隔离副本，确认没有协议升级、完成真实运行验证后，复审批准应用。初轮测试后的未使用import清理改变过adapter哈希，因此初轮证据未充当最终精确源码验证；此目录保存的是统一冻结后的最终日志。历史生成字节断言明确调用其冻结生成层，当前适配器另由新检查验证。首次完整检查发现3项旧库存／版本断言尚未更新（7892通过、524条件跳过、3失败）；[初次原始日志](initial-full-check.log)已保留。更新这三项测试后，[定向复验](inventory-regression.log)10通过、15条件跳过，生产代码保持。

## 保留与交付边界

[保留检查](preservation.json)核对12564份起始文件，12538份本轮以外的文件保持不变，包括10507份旧报告与49份历史Godot脚本；旧图谱条目只保留并追加新功能。WASM维持745886字节，应用版本和锁文件不变。七个作者夹具各有32或37份文件，构建／运行后字节均保持；最终原生7份、旧回归96份及逐案来源摘要与正式源码一致。

当前图谱为175功能／527实现／737绑定／2948评分单元／139工作流；23模块／45项Studio声明能力保持。[图谱验证](atlas-check.log)与[本轮修改文档的链接检查](links.json)分别保存。

复现：

```sh
node --test scripts/tests/project-execution-budget.test.mjs scripts/tests/project-event-bus.test.mjs
VIENTO_GODOT_BIN=/path/to/Godot node --test scripts/tests/project-execution-budget-backends.test.mjs scripts/tests/project-execution-budget-godot.test.mjs
VIENTO_GODOT_BIN=/path/to/Godot node --test scripts/tests/project-events-godot.test.mjs scripts/tests/project-shared-state-godot.test.mjs scripts/tests/project-audio-control-godot.test.mjs scripts/tests/project-animation-control-godot.test.mjs
npm run check -- --app-only
node scripts/function-atlas.mjs --write --refresh-sources
node scripts/function-atlas.mjs --check
```

使用 `VIENTO_EXECUTION_BUDGET_EVIDENCE` 指定原生调用链证据目录。没有升级应用版本、提交推送或更新本机安装。

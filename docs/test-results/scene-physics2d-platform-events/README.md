# 平台端点通知 → 普通作者事件 → 媒体与工程交付

2026-10-26，**0.2.4之后开发工作树**，Godot执行适配器**0.31.0**。入口：**新建脚本 → Godot / 平台端点事件**，普通保存TXT，引用并绑定到已有水平往返的平台实例，再配置两个事件名。完整操作见[平台端点指南](../../SCENE_PHYSICS2D.md#用平台端点事件驱动动画与声音)。本轮未升版、提交推送或更新本机0.2.0安装。

## 已完成范围

- 独立可选能力 `physics.platform-events2d`，每个适用行为获得当前访问局部 `viento_platform_events` 版本1端口。`origin_reached`／`destination_reached` 均为零参数信号，只授予已声明运动的平台，不授予乘客、普通静止体或传感器。
- 信号表示**本次项目步内曾到达该端点**，每端每步至多一次；到达判定区间为 `(before, after]`。初始位于起点和零时间不通知，精确抵达不在下一步重复；同一步多圈合并，两端按首次抵达顺序通知，负偏移不交换起点／终点语义。它不是逐次穿越计数或时间线。
- 新薄桥继承冻结0.30控制器，调用原轨迹推进一次；场景包装在旧运动、碰撞和原生角色回调结束后派发。每次回调前重新确认当前访问、平台、行为和关闭／切换状态。退出断开，重入建立新端口，不补发旧端点通知。
- 新普通TXT起始内容提供 `origin_event`／`destination_event`，默认 `physics.platform_origin`／`physics.platform_destination`。空名各自禁用；发布载荷为本平台UUID，项目绑定来源由旧接口校验。作者可直接消费原生信号，也可选择转为已有项目事件；脚本不驱动物理、不轮询位置、不自动建立绑定或媒体。
- 新每场景包装通过 `main.tscn` 的精确脚本引用挂载，保存原入口；0.30及更早轨迹、求解、helper和运行原文保持。新增入口、wrapper/helper/port和清单受严格库存检查，再执行完整旧校验链，随工程ZIP搬迁。作者schema、Rust／WASM、项目运行和观察协议保持。
- 新脚本、关联、绑定和两个参数均复用现有编辑工作流，三语390px可达；原有19个完整起始脚本记录不变。

**已知重要限制：** 普通项目事件仍限每次运行累计128次发布，且有累计投递、订阅、字节等预算；队列排空或场景重入不重置，超限明确失败。原生端点信号可持续通知，转成项目事件后仍受旧预算约束。声音、动画、状态和观察另有有限预算，本轮不宣称长时间循环游戏已经可用。[路线](../../ROADMAP.md#内置创作到交付的推进顺序)已单列持续交互的执行预算、观察留存和因果记录改造，不能简单扩限或裁掉记录。

## 验证结果

完整app-only为**8356项，7850通过、506条件跳过，0失败／取消**；1388份JavaScript语法、版本一致性和API合同预检通过。[日志](full-check.log)、[退出记录](full-check-exit.json)和[执行前源码摘要](full-check-sources.json)分别留存。专项与完整检查互有交集，不相加为覆盖率。

| 验证 | 已取得的证据 |
| --- | --- |
| 起始脚本及相关旧目录 | [75/75，零跳过](starter-regression.log)；[汇总](starter-summary.json)，[19项旧完整记录摘要](legacy-starter-hashes.json) |
| 起始脚本真实Godot合同 | [38个场景，含29个预期拒绝](starter-native.json)；[标准输出](starter-native-stdout.log)与[有意拒绝诊断](starter-native-stderr.log)，不把预期错误误计为通过运行 |
| 普通编辑、三语与来源UI | [首轮101/101](ui-first.log)，[绑定邻接66通过、1旧工具条件跳过](ui-binding-regression.log)，均零失败 |
| 最终Godot矩阵 | [15/15，零跳过](native-final.log)，含14项真实Godot及1项纯生成；[完整数据](native-final.json)、[汇总](native-summary.json) |
| 旧水平平台原生邻接 | [5/5](previous-motion-native-regression.log)，新包装另与旧0.30的角色和平台样本逐项完全相同 |
| 修后受控运行 | [聚焦22通过、5条件跳过](adapter-control-fix-tests.log)；[真实Godot6通过、2个Bevy条件跳过](adapter-control-native-tests.log)，均零失败 |
| 严格库存与适配器 | [17通过、2旧工具条件跳过、零失败](backend-tests.log) |
| 实际Chrome | 最终[6流程／15截图](browser-control-fix/browser.json)、[58来源摘要及视觉复验](browser-verification.json)；[退出码](browser-control-fix-exit.json) |

最终原生覆盖单向／实体、负偏移、无乘客平台、多行为独立端口、短路径多圈合并、精确端点与零时长、回调重入拒绝、行为移除、平台待删除、场景请求／直接关闭／重入撤销。原生累计160次通知无trace也无项目发布；普通发布第129次明确产生 `runtime_behavior_event_limit`，此前128条正常受理。两项测试分别证明不同边界。

[生成工程ZIP](native-final-platform-events.zip)搬离原作者与构建路径后独立导入运行，SHA256为 `af343f0666b1e126076869a9e5587ab20cbcff44b30503cec301c264df8f7ec2`；[Godot窗口](native-window.png)与媒体回执分别留证。

实际编辑流程从取消创建开始，创建并保存普通TXT、显式关联、添加平台行为与两个文本参数；先取消一次绑定审阅，再检查／应用草稿／普通保存，重开核对相同平台UUID与参数。端点事件按终点→起点出现，初始起点不发；终点事件驱动现有动画与带UUID过滤的声音订阅。物理观察保持承载往返及另一角色静止。

来源边界：碰撞平台可精确选择物理正文范围；项目事件发布者、动画和声音订阅者回到冻结行为文档与 `propertyPath`，旧事件origin不携带 `sourceRange`，因此不声称它们能精确选中文字。作者文件51→53，仅4条明确的脚本保存、登记／引用与行为保存路径变化；导航和观察不写作者文件。

## 问题与修正

- [首次完整应用检查](full-check-first.log)出现3条受控运行回归：新增指纹文件时，4条URL被误加入另一处同名的会话暂存列表。修复仅删除受控暂存中的误入条目；该分支拒绝物理计划，平台生成路径未受影响。独立复核确认其余适配器变动均属预期。最终完整检查、原生与Chrome均基于修正后的适配器重新执行；[修前Chrome](browser-final/browser.json)、[修前原生](pre-control-fix-native-final.log)和失败全检查保留。
- 独立审阅发现真实生命周期缺口：同平台第一个行为回调把父平台 `queue_free()` 后，第二个行为本身仍在树内、未标记删除，可能继续收到当前端点。最终helper在每次派发前重新检查平台有效性、在树状态和待删除状态；新增原生回归，最终Chrome重跑。[首次Chrome证据](browser-1793003598952/browser.json)保留，不把旧源码结果替代最终验证。[隔离修前探针](deletion-before-fix.log)使用保存的旧helper复现第二次通知，正式生产与测试没有回退。
- 首次原生媒体断言把动画命令的嵌套 `command.action` 误读为根 `action`；仅修测试读取方式。早停场景测试一度使用smoke模式却要求提前结束，与既有固定0.5秒约定冲突，改为live模式验证主动关闭。[首次原生](native-first.log)与[首轮矩阵](native-matrix-first.log)分别保留；[首次库存测试](backend-first.log)还误修改不可变计划，改为显式克隆后通过。
- 128次项目事件上限是现有合同，本轮保持明确失败；原生连续端点通知与普通发布超限分别测试，不用前者替代长期项目事件能力。

## 复现与保留

准确命令见[作者脚本](starter-commands.txt)、[原生](native-commands.txt)、[后端](backend-commands.txt)与[根检查](root-commands.txt)。工具为Node24.21.0、Godot4.7.2.stable.official.ed1daf0bf、Chrome154.0.8037.97。原生、浏览器、UI与完整检查分别留证；窗口截图来自虚拟显示，不代表安装或硬件GPU验收，声音命令回执不代表扬声器输出。Android、Bevy物理和新安装产物未验收。

[保留检查](preservation.json)对照本轮开始的12380份文件，其中12354份非本轮修改文件全部保持，包含10339份旧报告；保护此前未提交改动、旧物理层、作者样例和版本／锁文件；本轮Rust未改，也未重跑历史Rust测试。WASM保持745886字节，SHA256 `aded22e0575b084b5b7730d62a2a1256f00b40a9c0d862aeaf088a35d489d0a3`。图谱只追加新功能，旧条目、评分与证据保持；当前173功能／522实现／732绑定／2928评分单元／137工作流，Studio仍为23模块／45项声明能力；[图谱检查](atlas-check.log)和[文档链接](links.json)记录另列。

# 0.2.9 发布检查

2026-11-11。此目录记录应用升至 **0.2.9** 后的实际发布检查。11月4日的准备曾中断，保留已完成记录和首次失败；11月11日恢复并修正测试时钟后再验证。升版前四个开发专题保留原版本、时间、日志和来源摘要，不改标为本版重跑。

## 本版执行

- **版本与源码归档 8/8、零跳过**：11月11日重新执行 `node --test scripts/tests/version.test.mjs scripts/tests/source-archive.test.mjs`，[本次日志](version-resumed.log)。产品和构建版本均为0.2.9，Android安装编号1002009、macOS构建号1.2.9，持久应用标识保持 `io.viento.studio`。11月4日[版本记录](version-source-scope.json)及[当时8/8日志](version-source.log)单独保留；首次PATH含空格的调用错误没有启动测试。
- **真实 Godot 原生组 17/17、零失败／跳过**：[本次汇总](native-resumed-2026-11-11/final-suite/summary.json)、[完整日志](native-resumed-2026-11-11/final-suite/node-tests.stdout.log)。项目专项11项包含4项纯库存检查和7项实际工程原生运行；另覆盖局部端口组件8组170断言、触发区模板28项检查／18项预期拒绝、平面模板24项检查／18项预期拒绝。顶层17项与内部断言不相加为覆盖率。
- 原生组在501个版本、引擎、后端、宿主及fixture源文件前后[摘要](native-resumed-2026-11-11/final-suite/sources-before.json)一致，[后置摘要](native-resumed-2026-11-11/final-suite/sources-after.json)保留。Godot仍为独立音频清理修订的4.7.2工具；实际路径占位符及报告环境在汇总中记录。
- **完整应用检查 9058项：8397通过、661条件跳过、零失败／取消**：本次 `npm run check -- --app-only` 在0.2.9版本下完成，覆盖1541份JavaScript语法、版本一致性及API契约预检；[完整日志](app-check.log)、[发布汇总](summary.json)。条件跳过需要各自工具或平台环境，不计为真实原生通过。

## 原生首败与确定性时钟修复

11月4日[原17项记录](native/node-tests.stdout.log)为 **16通过、1失败、零跳过**。触发区模板的恢复检查触发断言后挂至20秒子进程时限；原始调用栈、失败位置和计数保留。此前的[隔离时钟探针](native/sensor-clock-isolated/summary.json)已说明，连续两个process_frame可能都发生在下一次_physics_process之前，不能证明恢复后的dirty集合已冲刷。

11月11日仅将 `physics-sensor-occupancy-starter.test.mjs` 的 `settle()` 改为等待 **physics_frame → process_frame**：物理信号在节点回调之前发出，随后处理帧保证该物理回调已有机会完成。全部严格断言和生产模板保留，不延长超时或吞掉失败。反向恢复旧helper后的测试文件摘要精确匹配旧记录，生产模板源码也一致。

修复后先连续三轮真实Godot检查，每轮2/2通过、28项检查和18项预期拒绝，[独立汇总](native-resumed-2026-11-11/sensor-clock-summary.json)保留；随后对原四测试文件完整重跑，得到上述17/17。首轮失败不被改写成通过，组件探针也不冒充完整作者工程。

日志中本机目录及首次PATH后缀替换为占位符，失败事实与调用栈位置保留；[脱敏摘要](path-redaction.json)记录替换前后的日志SHA。未修改任何生产行为或运行协议。

## 开发阶段与平台边界

- [多对象触发区占用](../scene-physics2d-sensor-occupancy/README.md)：普通脚本、初始重叠／多对象首入末离、平台事件连接、迁移与工程交付。
- [物理验收样本定位](../physics-case-inspection/README.md)：通过／失败条目到精确实例／访问／步骤／样本，原文导航和未保存草稿守护；三语窄屏与真实引擎按原执行时点阅读。
- [自由平面行为意图](../scene-physics2d-planar-intent/README.md)：三语作者流程、实际碰撞、生命周期、严格库存、作者恢复和离线工程。
- [物理样本示意](../physics-sample-diagram/README.md)：升版前完整检查9058项（8397通过、661条件跳过）及真实Chrome／Godot碰撞和自然零位移的SVG几何、三语390px和39作者文件保真；这些是开发阶段记录，未改标为本次发布重新运行浏览器。

以上四专题共 **161份文件**，[发布前摘要](development-preservation.json)用于确认旧证据字节保持。各专项、完整应用和内部断言存在交集，不能相加作为覆盖率；条件跳过不算真实工具通过。

本轮没有编译或更新Tauri安装程序，没有Android、Windows／macOS、真实设备键盘或Bevy物理验收。源码版本、Godot0.41生成层与安装版分别说明；已安装Studio仍为0.2.0，生成工程ZIP也不是独立游戏发行物。

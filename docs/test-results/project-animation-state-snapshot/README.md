# 动画状态快照验证 · 2026-10-23

本轮在0.1.8之后的工作树接通“冻结状态脚本与绑定 → Godot退出前采样 → 严格记录 → 只读筛选 → 绑定或脚本来源”。保留上一轮有序事件分支修改。本轮没有升版、提交、推送或更新安装。

## 行为与边界

新构建的含严格v1/v2/v3控制器项目使用protocol8／Godot0.17.0／清单9，普通动画项目仍protocol7，无动画项目仍protocol4；旧协议1–7读取保持。作者生成器、Rust/WASM及已有作品不迁移。

状态来自实际脚本字段，表示选片段和播放请求已经被脚本接受；已执行命令和自然完成保留独立账本。同片段可以对应不同状态，同脚本多个绑定分别记录。只在切换、结束或错误中止的清理前采样；强制结束可以没有快照，不重建中间转换或推导实时播放。

冻结计划提供状态名、绑定与脚本来源，进程不能指定这些路径。每次访问最多一批，最多64批／2048控制器；损坏字段明确诊断。非法片段参数在构建前定位原绑定字段，库存9拥有独立4MiB预算，旧库存继续128KiB。

## 实际结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 完整应用 | 6791项，6468通过，323条件跳过，零失败/取消；1146份JS、版本/API预检通过 | [最终日志](app-check-final.log) |
| 领域与协议兼容 | 68/68，含17项新领域用例 | [日志](domain-tests-final.log) |
| 构建诊断与冻结来源 | 3/3，含真实Godot工具识别、作者捕获后变更和伪造错误路径 | [日志](build-diagnostic-tests.log) |
| 新旧观察面板、父构建宿主与翻译 | 66/66 | [日志](ui-tests.log) |
| 旧协议拒绝形状 | 28/28 | [日志](legacy-protocol-tests.log) |
| Godot分批完整回归 | 74项，74通过，0跳过，零失败/取消 | [旧控制器与项目](native-old-final.log)、[状态快照与完成通知](native-state-completion-final.log) |
| 后端声明与能力契约 | 20项，18通过，2原生条件跳过 | [日志](backend-contract.log) |
| 实际Chrome工作流 | 3组、6张截图、零页面异常 | [浏览器记录](browser-1792726774819/browser.json) |

各组有重叠，不相加。默认应用检查的323项条件跳过不计作原生通过；原生专项使用已安装Godot4.7.2绝对路径及独立临时作者目录。Chrome通过界面规划、生成和运行真实Godot：事件在第二个绑定订阅前发布，因此同脚本两个绑定保持observed／idle，而两者选择相同片段；6条实际执行回执独立显示。三语390px保留绑定筛选、无水平溢出，并通过两个来源按钮返回精确原文。运行与导航前后作者文件全量哈希一致。

[桌面状态面板](browser-1792726774819/snapshot-desktop.png) · [中文390px](browser-1792726774819/snapshot-zh-CN-390.png) · [English390px](browser-1792726774819/snapshot-en-390.png) · [日本語390px](browser-1792726774819/snapshot-ja-390.png)。截图已人工查看桌面与英文窄屏布局。

原生覆盖实际同片段不同状态、同脚本双绑定、条件/有序分支、自然完成、停用和已释放实例、创建前中止、损坏私有字段的非零退出、场景重入及BOM/CRLF脚本。独立ZIP在删除作者目录和原构建后仍可导入和运行；最大32场景×32绑定×16状态库存单独验证。

## 调试与复验记录

- [首轮应用](app-check-first.log)有2项失败：旧测试以8作为未支持协议哨兵。改为9后，旧协议专项28项和最终完整应用通过；原有1–7精确字段拒绝行为保留。
- [首轮浏览器](browser-1792726540182/browser.json)预期两个绑定同时收到事件，但夹具在第二个订阅前发布。实际快照正确返回observed／idle；最终测试以此验证同片段、同脚本、不同绑定状态，未改生产行为迎合夹具。
- 首轮领域测试的非法版本哨兵和可选核心缺失夹具已修正；[领域审阅](domain-review.json)保留细节与来源指纹。
- [原生诊断初验](native-attempt-before-diagnostic-fix.log)发现私有状态损坏诊断缺少旧behavior reader要求的前缀。改用runtime_behavior_animation_state_invalid，最终确认失败退出码1且没有伪造成功终帧。
- 长批次运行收到SIGTERM，保留[native-interrupted.log](native-interrupted.log)。已输出通过记录仅作辅助，结论来自上表两批具有完整汇总的复验。

交叉审阅另修复了构建参数诊断被组装来源覆盖，以及最大合法库存超原预算的问题。来源、字段、生命周期、旧协议与只读导航分别审查，未留下已知阻断项。

## 数据与交付保持

[保留检查](preservation.json)核对8741份既有示例及历史证据，包含上一轮尚未提交的41份分支证据；另41份Git历史与发布文件和旧2496评分／2648证据对象保持。v1/v2/v3发射器、724437字节WASM以及已安装AppImage哈希不变。当前源码版本仍0.1.8，安装未更新。

[评分审查](score-review.json)新增1功能／3实现／3绑定／12评分／1工作流，不修改旧分数。当前为141功能、426实现、627绑定、2508评分、104工作流，22模块／43项Studio声明能力保持。[源码哈希](source-hashes.json)与[结构化摘要](summary.json)单独保存。

本轮不包含Tauri安装窗口、Android设备、Bevy动画或真实窗口画面验收；没有实时状态图、逐转换追踪、断点、独立实例播放头或混合能力。

## 复验入口

```sh
node scripts/check-project.mjs --app-only
node --test scripts/tests/project-animation-states.test.mjs scripts/tests/project-animation-state-build.test.mjs scripts/tests/project-animation-state-observation-ui.test.mjs
VIENTO_GODOT_BIN=/绝对路径/Godot node --test scripts/tests/project-animation-state-godot.test.mjs
VIENTO_GODOT_BIN=/绝对路径/Godot node scripts/tests/project-animation-state-snapshot-smoke.mjs /usr/bin/google-chrome
node scripts/function-atlas.mjs --write --refresh-sources
node scripts/function-atlas.mjs --check
```

浏览器每次使用本专题下新的空目录；不覆盖已有报告。实际Node24和Godot二进制哈希保存在浏览器报告，测试作品使用临时目录，执行结束清理。

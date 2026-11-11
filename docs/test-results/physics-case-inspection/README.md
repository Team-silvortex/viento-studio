# 物理验收条目到实际样本与原文来源

日期：2026-11-04。基线 `00c06ffe9bad9389f3d4aeb344064b07ec522bb6`，0.2.8 之后的未发布工作树。本专题只验证新增调试交接及本轮发现的窄屏修复；此前[多对象压力板专题](../scene-physics2d-sensor-occupancy/README.md)及历史发布证据保持原时点。

验收通过和失败的检查都提供 **查看本步物理样本**，选中当前真实运行的实例、访问、场景、步骤和序号。选择只更新观察控件和焦点；角色／碰撞体的物理原文仍经独立来源按钮打开，普通保存与重新构建保持明确。未完成、缺失、歧义、旧任务或草稿失配不能转到另一条样本。操作见[物理指南](../../SCENE_PHYSICS2D.md#从验收条目定位物理样本)。

## 检查与范围

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 完整应用检查 | 9015 项；8363 通过、652 条件跳过、零失败／取消；1525 份 JS 语法与 API 契约预检通过 | [完整日志](app-full.log) |
| 最终受影响链回归 | 73/73 通过，零跳过；包含验收、观察、身份解析、回放与两种作者文档交接 | [最终定向日志](unit-final.log) |
| 精确选择核心／观察器 | 23/23，通过拒绝无副作用和最终焦点滚动目标断言 | [滚动修复后日志](unit-selection-scroll-final.log)；[初始日志](unit-selection.log)保持 |
| 真实 Chrome＋Godot | 5 个任务均执行成功；一项检查通过、一项故意填写错误位置而失败；两项都定位实际样本，五次旧按钮操作窗口无非 GET 请求 | [最终浏览器报告](browser-request-diagnostic-2026-11-04/browser.json) |
| 作者数据与来源 | 39 个作者文件前后 SHA-256 相同；真实原文选区包含所选角色的完整物理声明，修改只留临时未保存草稿 | 同上及[汇总／最终源码摘要](summary.json) |

完整检查在浏览器发现窄屏问题前启动；运行期间还修正了一处状态文字样式和观察器的滚动目标。随后从最终相关源码重跑完整 73 项定向及真实浏览器／Godot 链，均通过；不将上述全量日志描述为从最终冻结快照再次运行。定向、完整与原生范围有交集，不相加作覆盖率。条件跳过不算真实工具通过。

最终环境为 Node 24.21.0、Chrome 156.0.8078.73、Linux 本地 HTTP 编辑宿主，以及 Godot 4.7.2 的本机 audiofix1 工具。工具与 12 份原生／浏览器输入源码的 SHA-256 记录在最终浏览器报告，执行前后不变，并与当前文件逐项核对。

## 实际操作

真实浏览器打开隔离保存态作者工程，从工作台完成项目检查、构建、30 步物理回放，再依据实际碰撞样本创建验收。第一项核对第 4 步位置和指定碰撞体，第二项把第 1 步位置故意写为 `[9999,9999]`，后者应显示检查失败。运行成功与预期通过分别判断。

逐条点击定位，核对实例、访问、场景、步骤、序号、真实位置及碰撞位置／法线／已走位移／剩余位移。选择不打开源码或产生变更请求；样本选择器获得焦点且位于可视区域。随后明确使用既有来源按钮，核对物理原文精确范围。关闭重开、改回同一 JSON、同字节 input 和另起真实任务后，持有的旧按钮均失效。作者未保存草稿保留，作者正文、登记与素材摘要全部一致。

中英日分别在 390×844 运行，另有桌面视口。最终对话框 `clientWidth/scrollWidth` 均为 335/335，文档为 390/390；30 步时间轴继续使用设计中的局部横向滚动，不裁切其内容。七张截图保留在[最终运行目录](browser-request-diagnostic-2026-11-04/)，包括[中文结果](browser-request-diagnostic-2026-11-04/case-zh-CN-390.png)及[中文样本选择](browser-request-diagnostic-2026-11-04/sample-zh-CN-390.png)。

## 首轮发现与复验

1. [首次运行](browser-final-2026-11-04/browser.json)发现物理回放状态中的长 SHA 文本撑出窄屏对话框。[尺寸诊断](browser-diagnostic-2026-11-04/browser.json)记录状态行 303/628、对话框 335/644。仅给该状态添加 `overflow-wrap:anywhere`，保留时间轴的独立滚动。
2. [修复后运行](browser-verified-2026-11-04/browser.json)通过无横向溢出检查，但发现先聚焦样本再滚长详情会把焦点控件推离视口。改为滚动样本选择器本身，并增加滚动目标和拒绝无副作用的回归。
3. [下一运行](browser-passed-2026-11-04/browser.json)在关闭重开后的 150ms 窗口看到一个非 GET 请求，但没有采集到其路径与因果，不能认定由旧按钮触发，也不能归因于初始化。最终脚本先等待无关请求稳定，再分开记录五次旧按钮操作，均无非 GET；早期报告仍保留，未改标为通过。
4. 最终 [browser-request-diagnostic-2026-11-04/browser.json](browser-request-diagnostic-2026-11-04/browser.json) 的 `ok:true`、`errors:[]` 和 `sourceSnapshotUnchanged:true` 是正式通过依据；目录名保留当次运行实际名称。

## 复现

在仓库根目录使用 Node 24，先执行 `npm run check -- --app-only`。最终定向命令为：

```sh
node --test scripts/tests/project-physics-case-ui.test.mjs scripts/tests/project-physics-observation-build-ui.test.mjs scripts/tests/project-physics-observation-ui.test.mjs scripts/tests/project-physics2d-observation-selection.test.mjs scripts/tests/project-physics-replay-ui.test.mjs scripts/tests/project-physics-case-documents-ui.test.mjs scripts/tests/project-physics-replay-documents-ui.test.mjs
```

真实浏览器需要设置绝对路径 `VIENTO_GODOT_BIN`；用 `VIENTO_PHYSICS_CASE_INSPECTION_OUTPUT` 指定本专题内新的空目录，再运行 `node scripts/tests/physics-case-inspection-smoke.mjs /usr/bin/google-chrome`。脚本只使用临时作者夹具，结束时清理浏览器、服务、profile 和临时作品；不会更新本机安装。

仍仅支持单入口、无行为／声音／动画、30 步的 Godot 物理验收，沿用 256 条样本预算。没有新增作者格式、运行／观察协议、后端能力或适配器版本；Bevy 物理、Android／其他桌面系统、持续接触与已安装应用不在本轮验收范围。Rust/WASM 未改，本轮未重新编译 Tauri 或运行完整原生核心测试。

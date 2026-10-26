# 原始观察留存与运行生命周期分离

2026-10-26，**0.2.4之后开发工作树**。本轮是持续运行准备工作的第一段：工作台显示真实的日志／原始事件保留范围，项目交互会话使用独立原始尾部窗口，启动／结束判定和语义观察不再依赖该窗口。操作与数据说明见[运行记录与留存](../../PROJECT_BUILD.md#运行记录与留存)。应用版本0.2.4、Godot执行适配器0.31.0、已安装应用0.2.0保持。

## 已接通的行为

- 项目reader用独立累计准入计数校验4096帧上限；`retainedEvents` 可选1–4096，默认4096。`push()` 和 `onEvent` 接收全部新准入帧，保留数组只代表最后一段。非法帧不消耗准入序号，拒绝不会靠窗口轮转绕过预算。
- `retention` 记录limit／total／retained／dropped及原始帧范围；`lifecycle` 独立记录已验证的启动／结束。原始序号与业务事件序号不是同一编号。
- 非smoke项目会话保留最近128条；有限测试保留原有完整记录。宿主按原有各模式的生命周期要求判定结果，最后把范围和状态写入session.json；失败、取消及观察回调抛错均保留已接收证据。
- 语义观察内部仅保留最后一条原始帧，完整业务账本、当前对象、身份和因果来源仍按原规则维护。不会把被移出的raw消息解释为没有发生业务事件。
- 工作台公开日志32768 UTF-16代码单元、原始摘要128条的累计／保留／移出数量。日志边界避开代理对；套件切换清空旧摘要也计入移出量，取消后的管道排空继续计数。旧宿主或非法计数显示信息不可用。
- 中英日说明使用textContent；任务状态、详情展开状态与焦点独立，记录轮转不把成功改为失败。

**尚未解除执行预算。** 项目事件128次、共享状态修改1024次、音频／动画命令各256次、场景访问64次、4096协议帧、进程输出上限及时间限制仍然有效。未截断语义账本、未调整作者格式、线协议、Godot生成器或Rust／WASM。下一段需独立定义调度额度与当前队列容量，再处理因果证据留存；本轮不能宣称无限时游戏运行。

## 验证

完整app-only为**8387项，7876通过、511条件跳过，0失败／取消**；1393份JavaScript语法、版本一致性和API预检通过。[日志](full-check.log)、[退出记录](full-check-exit.json)及[执行前源码摘要](full-check-sources.json)分别留存。专项与完整检查有交集，不相加为覆盖率。

| 范围 | 证据 |
| --- | --- |
| Reader／query及账本邻接 | [99/99，零跳过](reader-query-test.log)，[源码摘要](reader-query-summary.json) |
| 真实Godot | [5/5，零跳过](native-test.log)，[工具、范围与逐案汇总](summary.json) |
| 宿主留存与任务 | [5项新增、14项旧service、17项suite全部通过；HTTP6通过3条件跳过](host-targeted-verification.json)。此文件是已执行工具结果摘要，不是原始stdout日志 |
| UI | [新增10项与既有邻接的执行记录](browser/ui-verification.txt)，原终端输出未保存，不补造原始日志；完整app-only另行包含这些测试 |
| 实际Chrome | [三语×4状态共12组390px检查](browser/browser.json)，[5份源码摘要与实际目视的3张截图清单](browser/browser-verification.json) |

真实Godot分别验证：

| 案例 | 准入／保留／移出 | 结果 |
| --- | --- | --- |
| [live](live.json) | 305／128／177 | 启动帧已移出，仍正常完成；300次状态写入均进入语义观察 |
| [smoke](smoke.json) | 305／305／0 | 原0.5秒有限运行与完整记录保持 |
| [运行错误](failure.json) | 304／128／176 | 明确failed，来源诊断保留，completed=false |
| [取消](cancelled.json) | 303／128／175 | cancelled，completed=false，接受过的状态保留 |
| [观察回调错误](observer-failure.json) | 303／128／175 | failed，completed=false，接受过的状态保留 |

每案核对共享状态revision300、冻结绑定来源、26份隔离作者文件字节不变、session落盘与返回record一致，以及临时运行工程清理。stdout约144KB，未超过现有1MiB进程输出上限；不能据此声称输出硬上限已移除。

Chrome通过本地HTTP加载当前编辑器，但构建任务响应为合成fixture：1200条原始摘要保留128条、移出1072条；86493个日志代码单元保留32768个。自动验证三语的running／succeeded／failed／cancelled、焦点与详情保持及字面注入；12张截图中实际目视3张。该证据验证界面，真实Godot运行由上表单独证明，未验收Tauri安装、Android或Bevy。

## 保留与复现

[保留检查](preservation.json)对照本轮开始的12510份文件，其中12493份非本轮修改文件保持不变，包含10458份旧报告；保护先前未提交工作、作者样例、版本和锁文件。WASM保持745886字节，SHA256 `aded22e0575b084b5b7730d62a2a1256f00b40a9c0d862aeaf088a35d489d0a3`；本轮未重跑历史Rust验证。图谱只追加本轮功能，当前174功能／525实现／735绑定／2940评分单元／138工作流；Studio保持23模块／45项声明能力。[图谱检查](atlas-check.log)与[本地文档链接](links.json)单独留证。

复现使用Node24.21.0；原生工具为Godot4.7.2.stable.official.ed1daf0bf。新专项入口：

```sh
node --test scripts/tests/project-runtime-retention.test.mjs scripts/tests/project-build-retention.test.mjs scripts/tests/project-build-retention-ui.test.mjs
VIENTO_GODOT_BIN=/path/to/Godot node --test scripts/tests/project-runtime-retention-host.test.mjs
node scripts/tests/project-build-retention-smoke.mjs
npm run check -- --app-only
node scripts/function-atlas.mjs --write --refresh-sources
node scripts/function-atlas.mjs --check
```

原生测试默认清理隔离副本，仅显式设置 `VIENTO_RUNTIME_RETENTION_EVIDENCE` 保存逐案证据；Chrome输出目录可用 `VIENTO_BUILD_RETENTION_OUTPUT` 指定。没有升级、提交推送或更新本机安装。

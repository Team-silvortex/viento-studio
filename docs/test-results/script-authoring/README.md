# 新建脚本工作流验证

本轮接通“新建脚本 → 选择 GDScript 起始内容 → 普通 TXT 原文草稿 → 普通保存登记 → 可选首次场景行为 → 参数／信号编辑 → Godot 运行”。脚本助手只准备内存草稿，保存继续使用现有文档写入与登记流程。

[服务工作流记录](workflow.log) · [最终真实浏览器／Godot／交付记录](browser-verified/browser.json) · [最终运行日志](browser-verified.log)

## 服务工作流

新增 `scripts/tests/script-authoring-workflow.test.mjs` 的 **4／4** 项通过真实本机 HTTP 服务验证：

- workspace v2 的 `design-data` 和 v3 的 `documents` 路径均可创建并登记 TXT。
- 测试工程没有 `script` 文档类型；选用已有 `character` 类型保存真实 `godot-signal` 起始内容，并验证 BOM／CRLF 字节原样保留。
- 普通保存仅增加新 TXT 和它的登记文件，旧场景、类型定义、模板、原有登记和资产字节保持不变。
- 保存后首次行为目录立即列出新源码，无须新建行为即可发现；读取和重新打开不写作者文件。
- 重复路径、文件名／目录名大小写别名、不存在的文档类型均拒绝，且不留下作者文件或登记变化。

## 真实浏览器、Godot 与交付

最终采用 [browser-verified/browser.json](browser-verified/browser.json)：`ok: true`、浏览器错误 **0**、**15** 张截图、运行期间所列源码摘要保持不变。环境为 Node **24.21.0**、Chrome **154.0.8037.97**、Godot **4.7.2**；Godot SHA-256 为 `8d106cbe6144c2dc7e881d61d2429c1a8a76e6b22ef48bd5e48dcf934953f71e`。

夹具复制现有 Scene2D 示例，再移除旧 TXT、其登记、旧行为声明和场景行为关系，并移除 `script` 类型。真实操作覆盖：

- 新脚本入口展示两种起始内容；选择 `godot-signal`、已有 `character` 类型和 TXT 路径。中／英／日 **390px** 保留所有字段和完整预览，返回／创建／取消按钮保持可见，无水平溢出，滚动后可完整读取源码。
- 取消不修改编辑器或任何作者文件；创建后只有内存草稿，普通原文编辑器获得焦点，尚无文件或登记。
- 一次普通保存仅增加 TXT 与登记，实际首次行为目录能选择该新脚本。
- 首次行为审阅／取消不写入；确认后仅增加行为声明与登记、追加原场景登记关系，并保留场景登记的 CRLF。行为原文获得焦点后，沿用既有表单编辑参数和信号映射；应用只修改草稿，普通保存才写回行为原文。
- 真实 Godot 完成 plan／build／headless run，收到新绑定的 `script_authoring_checkpoint`，参数为 `["script_authored_in_studio", 65]`。同时等待真实编辑器显示该事件后再截图：[行为事件](browser-verified/behavior-create-godot-events.png)。
- 经真实浏览器下载的生成工程 ZIP 独立校验通过，含 **9** 个项目文件和 **1** 个资产；解压到另一目录后，真实 Godot 导入退出码为 **0**，无脚本解析错误。后续步骤不再修改作者文件。

关键截图：[桌面完整预览](browser-verified/script-create-review-desktop.png) · [日语 390px 完整源码](browser-verified/script-create-ja-390-source.png) · [尚未保存的普通 TXT 草稿](browser-verified/script-create-unsaved-source-draft.png) · [普通保存后](browser-verified/script-create-ordinary-save.png)

## 保留的排查记录

[browser-first](browser-first/browser.json) 和 [browser-second](browser-second/browser.json) 都通过新脚本选择／取消／草稿／保存段，但在后续行为面板切换到日语时失败。第二轮等待 **45 秒**仍未恢复，确认是实际旧问题，并非测试时序误判：`applyEditMode(doc, false)` 在清空 `activeEditSource` 之前同步来源状态，导致状态版本延迟到下一次语言刷新才变化；已经审阅的行为面板因此错误地失去来源有效性。主编辑器已将同步移至退出状态全部清理完成后，并添加可复现旧失败的回归测试。

[browser-final](browser-final/browser.json) 是修复后首次完整通过的记录，包含真实运行与交付复验。其事件截图拍在编辑器轮询刷新前，所以最后再补“等待界面实际显示事件并滚入视口”的截图检查；[browser-verified](browser-verified/browser.json) 是最终采用的完整通过记录。四轮证据均保留，不覆盖旧专题资料。

本项验收为 Linux 本机 HTTP 编辑器、真实 Chrome、Godot 无头逻辑与生成工程导入；不代表已安装 Tauri 窗口、Android 实机、画面渲染、LSP、热重载、Bevy 作者脚本或独立游戏导出验收。

## 最终回归与资源核对

- [最终标准检查](full-check.log)：版本保持 **0.1.0**，**723** 个 JavaScript 文件语法、API 契约通过；标准逐文件隔离、并发 2 的完整测试 **4288** 项，**4182** 通过、**106** 条件跳过、**0** 失败。相较上轮新增 **53** 项。本次未为整套测试设置外部引擎／原生探针环境，因此其条件跳过保留；上文真实 Godot smoke 单独使用固定工具验证。
- [定向回归](focused-final.log) **150／150** 通过，覆盖脚本规划、UI、宿主、服务、编辑保存／恢复及模块装配。首次 [focused.log](focused.log) 的 5 个失败是原测试未纳入新增独立模块，已更新清单与无端口时的停用预期；未放宽实际功能保护。
- 编辑退出问题先由 [回归复现](source-exit-before.log) 验证原代码失败，再修正状态同步顺序；最终定向和完整回归均包含此测试。修复前 [全量检查](full-check-before-exit-fix.log) 单独保留，不能代替最终结果。
- [资源校验](resources.json)：桌面 resources-only 和移动静态资源准备均成功，新增脚本核心／界面／样式、相关宿主与三语文件与最终源文件一致；共享 WASM 及其构建元信息与原基线相同。未打安装包或安装。
- 既有 6042 份历史证据保持原字节。临时作者工程用于服务与浏览器实测，没有修改用户工程数据。

模块为 **19** 个、声明能力 **36** 项；图谱新增 `script.authoring`，旧评分不提升。实现和验证范围见[汇总](summary.json)。

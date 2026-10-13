# 内置场景行为编辑验证

本轮在 0.1.0 之后工作树接入已有绑定文档的表单编辑；未升版、提交或更新安装。

[汇总与最终源码](summary.json) · [完整回归](full-final.log) · [定向回归](focused-final.log) · [真实浏览器与 Godot](browser-smoke.json) · [资源准备](packaged-resources.json)

- 全量 4160 项：4054 通过、106 个可选环境项跳过，0 失败。新增 65 项已计入全量；99 项定向与各子组不叠加。
- 701 个 JavaScript 文件语法、API 契约及 0.1.0 版本一致性通过。
- 实际 Chrome 中英日 390px 验证绑定选择、未完成参数保留、完整审阅、取消、应用草稿及普通保存；BOM／CRLF 和其他作者文件保持。
- 实际 Godot 构建运行产生修改后的 east／65／authoring_checkpoint 与未修改的 west／20／checkpoint。浏览器交付 ZIP 经校验、解压后在新目录成功导入 Godot。
- 桌面与移动资源准备副本一致，WASM 保持原字节。没有新增安装包、Android 实机或外部 IDE／LSP 验收。

`root-tests.log` 和 `module-graph.log` 保留首次预期差异及解析依赖加载失败。`full-tests.log` 是不隔离测试文件的早期运行，受到既有全局浏览器模拟的相互影响，不作为本轮全量验收；`full-final.log` 使用项目标准隔离模式。JSON 索引修复、宿主识别缓存及最终界面均包含在最终回归和浏览器源码摘要中。

`ui/` 保存独立界面验证，`browser-first/` 保存本轮唯一实际浏览器运行和五张截图。旧专题的报告、截图与评分不改写。

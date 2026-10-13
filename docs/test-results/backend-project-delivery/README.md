# 后端工程交付验证（0.1.0 之后工作树）

本轮把现有 Scene2D 的成功后端构建接到独立审阅、生成交付包和下载／保存入口。纯契约、Node 打包和 UI 分开；作者工程仍以 `.viento.zip` 迁移，生成工程使用 `.viento-build.zip`。

[汇总与最终源码 SHA](results.json) · [全量回归](full-final.log) · [交付与翻译回归](focused-final2.log) · [真实浏览器记录](browser-release/browser.json) · [准备副本](packaged-resources.json)

- 全量 4095 项：3989 通过，106 个需另行环境的可选项跳过，0 失败。新增交付测试 37 项；交付及翻译定向 48 项全部通过。
- 689 个 JavaScript 文件语法、API 契约和 0.1.0 版本一致性通过。
- 实际 Chrome／HTTP 编辑器：检查计划、Godot 构建、工程核对、交付审阅、准备、真实下载后关闭、ZIP 内容核验、`unzip -t` 和迁址 Godot 导入成功，作者文件未变。中英日 390px 无横向溢出，返回和准备按钮可见。
- ZIP 拒绝路径／成员／符号链接／尺寸／SHA／CRC／本地与中央文件头不一致。服务检查回执、源身份、取消、关闭等待和任务占用；UI 检查迟到结果、能力撤销、浏览器下载交接以及原生保存取消与重试。
- 桌面和移动资源副本的相关文件与源码逐字节一致，共享 WASM 未改。没有新安装包、实际原生保存窗口、Android 实机或新增 Rust 编译验收。

`browser/` 是遗漏计划前置条件的测试脚本失败；`browser-final/` 记录实际窄屏按钮不可见问题；`browser-verified/` 是布局修复后通过；`browser-release/` 对应最终 UI 与翻译字节。`full-tests.log` 的唯一失败是新错误提示漏翻译，已修复并通过 `full-final.log`。这些早期记录保留原样，不标作最终成功证据。

Godot 交付仍需兼容工具；Bevy 是需要可信运行程序的场景数据，当前仅用真实生成器加执行夹具检验交付，不声称本轮真实 Bevy 执行。Scene3D／Composition 并入构建目录、专用行为表单、独立游戏发行及 LSP 服务留在各自后续工作中。

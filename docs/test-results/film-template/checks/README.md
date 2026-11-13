# 影视模板定向验证

本组 Node 测试 **33 / 33 通过，0 跳过／失败**；真实 Rust 模板测试 **5 / 5 通过，0 忽略**；完整 Chromium 工作流通过，8 张截图、17 份来源稳定。它们是本组实际结果，不代表本轮全量检查，也不与其他回归计数重复相加。

- [verification.json](verification.json)：实际命令、环境范围、二进制及来源 SHA-256、浏览器原始证据清单。
- [targeted-tests.log](targeted-tests.log)：模板目录、原生创建／BOM＋CRLF／归档恢复、桌面作品库、翻译覆盖和 HTTP 模板读取。
- [rust-template-tests.log](rust-template-tests.log)：生产 Rust 模板模块 5 项测试；41 项无关测试按名称过滤，未算通过。
- [native-build.log](native-build.log) 与 [native-wrapper](native-wrapper/Cargo.toml)：临时最小宿主编译记录、锁文件和完整 wrapper 来源。两份 wrapper 仅把既有 example 的模块引用指向真实生产 `workspace.rs`／`mobile_storage.rs`，不复制改写业务实现，不构建整套 Tauri。二进制哈希记录在 verification.json，避免把约 45 MB 二进制重复存入仓库。
- [mobile-prepare.log](mobile-prepare.log)：仅准备移动编辑器生成资源；桌面只同步共用翻译副本，没有重打桌面资源包或安装程序。
- [browser-run.log](browser-run.log)、[最终浏览器回执](../browser/browser.json)、[source-guards.json](source-guards.json)。
- [production-snapshot.json](production-snapshot.json)：旧 5 个模板与旧兼容包的 canonical 哈希逐包保全，新模板仅增加声明数据与翻译。

`driver-diagnostics/` 保留四轮测试驱动诊断的原始回执和日志。早期驱动只等按钮可用，可能早于工程目录返回便创建文档，误用旧默认模板；另会在 HTML 仍解析时导入顶层缓存 DOM 的模块，令测试自身过早初始化模块。现等待完整模板目录、正确工程 ID／名称与 DOM 解析完成；只对导航引起的两种明确 CDP 上下文销毁错误重试。未修改产品代码、未跳过旧戏剧／软件或新影视检查、未忽略任何业务响应和断言。这些失败轮次独立保留，**不计为通过，也不作为新增生产缺陷结论**。

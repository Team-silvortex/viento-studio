# 参与 Viento Studio 开发

欢迎使用中文或 English 报告问题和提交改进。Viento Studio 正从通用 OC 工作台向设计优先 IDE 演进：工程定义自己的类型、模板和字段，语义内核、GUI 宿主与运行后端分别维护。开始修改前先读 [当前状态](../docs/STATUS.md) 与 [当前架构](../docs/ARCHITECTURE.md)，未来方向见 [开发路线](../docs/ROADMAP.md)。

## 开始开发

使用 Node.js 24、Rust 稳定版与 `wasm32-unknown-unknown` 目标。应用检查会准备共享 Rust 核心，无需安装 Tauri/GTK 或提供真实作品：

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run check -- --app-only
```

完整桌面工作流需要 Rust 稳定版与 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)。运行 `npm run desktop:dev`，在首页创建临时作品，即可检查编辑、素材引用、导出和迁移。构建与原生测试步骤见 [桌面版说明](../desktop/README.md)。

仓库保留早期作品的完整历史；只开发当前程序时可使用 `git clone --depth 1`，节省下载和磁盘空间。

## 修改与验证

- 为故障提供尽量小的复现样例；涉及正文、模板或素材时，优先使用新建的测试作品。
- 保持已有作品、稳定 ID、元数据关系和原始文件的兼容性。迁移与备份的改动需要验证失败回滚和恢复后的内容一致性。
- 新增界面文字同步更新简体中文、English 和日本語；参考 [多语言支持](../docs/LANGUAGES.md)。
- 对行为变化添加能复现故障的回归测试，运行 `npm run check -- --app-only`。它覆盖语法、版本一致性、接口契约和程序测试；未提供原生归档或移动存储工具时，对应跨语言测试会明确跳过，须单独报告。完整命令与平台边界见 [验证指南](../docs/TESTING.md)。
- 修改桌面宿主时，再运行 `npm run desktop:prepare` 和 `npm run desktop:test`。原生归档往返测试与界面实测见 [桌面验证说明](../desktop/README.md#验证)。
- 不提交真实作品、本机选择配置、依赖安装目录或构建产物。历史中已有的作品记录保留；新增测试使用独立临时目录。

Pull Request 请说明遇到的问题、修改后的行为、验证方式以及尚未验证的平台。相关流程变化同步更新 [项目工作流](../docs/PROJECT_WORKFLOW.md) 或对应文档。一般修复无需自行增加版本号，发布时统一处理。

## Android 与文档维护

移动端构建需要完整 JDK 17、Android SDK / NDK 和对应 Rust 目标，见 [移动端说明](../mobile/README.md)。浏览器联调不等于 Android 设备验证；涉及键盘、系统文件选择、生命周期的修改，应使用隔离模拟器或测试手机并保留环境记录。不要重新生成 Android 工程后覆盖本项目的窗口和迁移插件定制。

文档从 [文档中心](../docs/README.md) 进入，按职责维护：

| 内容 | 主要维护位置 |
| --- | --- |
| 产品简介与首次使用 | 根 README、`docs/GETTING_STARTED.md` |
| 当前功能、未发布增量、平台和安装状态 | `docs/STATUS.md` |
| 用户操作、格式与接口 | 对应专题指南；避免将同一规则完整复制到多个页面 |
| 实际模块与依赖 | `docs/ARCHITECTURE.md` |
| 当前跨架构功能、实现与成熟度证据 | `docs/function-atlas.json`，由 `scripts/function-atlas.mjs` 生成文档／离线图／Mermaid |
| 下一阶段与验收条件、长期设计、决策原因 | `docs/ROADMAP.md`、下一代架构书、`docs/adr/` |
| 如何测试 | `docs/TESTING.md` |
| 某轮发生了什么、验证了什么 | 原报告与 `docs/test-results/`，从 `docs/history/` 索引 |

能力接入后更新当前状态、对应操作和架构入口，再把实现进度反映到路线中。同步审查功能图谱的受影响坐标、上下游、评分理由与证据，执行 `node scripts/function-atlas.mjs --write --refresh-sources` 后再 `--check`；不要只刷新指纹而沿用失效评分。安装包、源码、浏览器和设备验收分别标注，未发布源码功能不能写成所有安装版都已有。文档中的“工程”指单个 workspace；界面步骤使用实际按钮名称。

带版本号的报告、旧功能图、日志和源码指纹保留当时的结果；新一轮新增证据目录。调整导航优先保留既有路径和标题锚点；必须迁移时检查所有入链。纯文档修改检查相对链接、标题锚点、示例与实际命令／契约的一致性、历史文件字节保留，无需为排版重跑应用编译；同时修改代码时按该代码范围执行验证。

## 发布约定

新产品版本从 `0.0.1` 开始，使用无前导零的三段数字版本；日常递增 patch，不再按个位数进位。旧 `b.X.Y` 只用于历史版本兼容。`node desktop/version.mjs --next` 只显示下一版本，不修改文件。发布时同步 `VERSION`、两份 npm 清单、Tauri / Cargo 清单与锁文件、网页和作品库的版本显示，检查工具会核对一致性。Android 安装编号及 macOS 构建编号使用连续递增的纪元映射，必须一并更新，具体公式和降级安装边界见 [版本与数据兼容 ADR](../docs/adr/0001-product-version-and-data-compatibility.md)。

新建对应发布记录，列清实际验证环境与未覆盖内容，再提交版本变更。`main` / PR 自动运行基础应用检查；**Build desktop installers** 为手动工作流，只上传构件，不自动生成 GitHub Release。调试 APK、源码归档和桌面安装包的验证及签名状态分别说明。

## 报告问题

普通故障在 [Issues](https://github.com/Team-silvortex/viento-studio/issues) 提交，包含应用版本、系统、复现步骤、期望和实际结果。截图、日志及样例中请去除私人作品和凭据。涉及安全的问题请遵循 [安全报告说明](SECURITY.md)。

程序许可证见 [LICENSE](../LICENSE)；提交改进时保留第三方代码已有的来源和许可声明。

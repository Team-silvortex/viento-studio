# 验证指南

本页说明如何选择测试、运行命令和解释覆盖范围。当前功能、发布及安装状态见 [开发状态](STATUS.md)，历次数字和阶段说明见 [历史验证记录](history/VALIDATION.md)。所有常规测试使用独立临时工程。

当前保存状态与异步归属见 [Rust 保存工作流验证](test-results/rust-layout-save/results.json) 及 [真实浏览器记录](test-results/rust-layout-save/layout-browser/browser.json)。

此前 Rust 布局草稿／撤销历史见 [验证结果](test-results/rust-layout-history/results.json)、[多选与生命周期实测](test-results/rust-layout-history/selection-browser/browser.json) 和 [保存失败／冲突实测](test-results/rust-layout-history/layout-browser/browser.json)。

最新多选与批量布局见 [场景多选结果](test-results/scene-selection/results.json) 和 [浏览器记录](test-results/scene-selection/browser.json)。前一轮布局编辑回归见 [场景布局结果](test-results/scene-layout/results.json) 与 [真实浏览器记录](test-results/scene-layout/browser.json)。此前的 [场景预览结果](test-results/scene-preview/results.json) 和 [浏览器证据](test-results/scene-preview/browser.json) 覆盖完整应用检查与 Chrome 静态画布；[场景编辑结果](test-results/scene-edit/results.json) 保留原生归档／移动存储往返和真实 Godot 运行证据。此前的 [OC 投影结果](test-results/oc-projections/results.json) 还保留当时的桌面 Rust 检查。通过／跳过／忽略数及源码、安装包与设备的区别统一列在 [当前状态](STATUS.md#验证边界)；各轮原始报告保持当时的条件。

## 功能图谱与证据核对

[当前功能图谱](FUNCTION_ATLAS.md) 为架构、功能、实现与四项成熟度提供离线筛选，完整映射旧图的 F01–F50。检查命令 `node scripts/function-atlas.mjs --check` 验证坐标、引用文件、指纹、评分门槛及派生视图一致性；它不运行产品测试，也不证明评分或测试覆盖率。引用文件改变后需人工重审相关条目，再显式运行 `node scripts/function-atlas.mjs --write --refresh-sources`。旧报告只适用于其原条件。

## 选择验证范围

| 改动范围 | 应执行的验证 | 能证明的层级 |
| --- | --- | --- |
| 纯文档变更 | 检查链接／锚点、命令与事实一致性、历史报告及证据字节未变 | 文档准确性；无需重跑应用和原生测试 |
| 解析、编辑器、模板、语言及一般应用逻辑 | 应用检查；涉及交互时增加对应浏览器实测 | 临时样例回归和实际网页行为 |
| 登记、事务、迁移、完整归档或移动存储 | 应用检查 + 原生测试 + 启用两个原生工具的跨语言往返 | 正文、UUID、模板、素材及失败恢复的一致性 |
| 桌面宿主、会话与进程生命周期 | 应用检查 + `desktop:prepare` + `desktop:test`；系统交互另跑原生窗口流程 | 编译和原生逻辑；窗口流程需单独证据 |
| Scene2D 构建、HTTP 任务或运行协议 | 构建专项 + 配置真实 Godot 的应用检查 + Chrome 构建工作台 | 引擎进程、产物、状态、退出清理和网页操作 |
| Android 宿主、系统选择器与生命周期 | 移动资源／原生检查 + 独立设备工作流 | 对应设备、系统和 WebView 条件下的行为 |
| 新安装包 | 在准备交付的安装包上重跑平台关键流程 | 该产物的安装及运行；源码通过不能替代 |

涉及正文或素材时，断言内容字节、登记关系与失败后的状态；涉及任务生命周期时，核对进程退出和临时资源回收。程序自己的单元测试通过、跨语言互通通过、浏览器通过、系统窗口通过和设备通过是不同证据，分别记录。

## Rust 源码检查与坐标补丁

本轮将单场景源码布局的严格检查与精确数值补丁迁入共享 Rust，最终执行范围和数字见 [本轮记录](test-results/rust-scene-source/results.json)。原功能入口与后端完整场景模型未改变；下方源码布局、保存布局及来源模型专项仍须通过。

```sh
npm run core:test
npm run core:build
VIENTO_STUDIO_CORE_BIN=/绝对路径/viento-core \
  node --test scripts/tests/studio-core-source.test.mjs scripts/tests/scene-source-layout.test.mjs
```

运行独立核心原生测试、真实 WASM 和原生／WASM 对照，再核对冻结的旧 JS 补丁样例。有效样例须逐字匹配 `afterContent` 和有序 `changedPaths`；错误样例核对拒绝及会话未改变。覆盖 BOM／CRLF／emoji、解码后重复键、转义孤立代理字符、其他字段的极大／极小数值、未改指数／负零、变动坐标的 JavaScript 数字拼写、v1／v2／v3 身份及组关系。组名的长度与空白判断沿用 JavaScript 字符串语义，不能改用 Rust 字节数或另一套空白定义。前后 128 KiB UTF-8、64 层／100000 值节点、128 个实例／组及 16 层组关系均有边界样例。

协议测试另核对 `sceneSource.inspect`／`sceneSource.patch` 不创建或改变任何布局会话、跨操作域拒绝、响应结构校验，以及缺少可选源码能力的旧 WASM 仍能处理旧布局操作。不得用 JS 补丁回退掩盖核心缺失。浏览器实测验证应用的 HTTP 模块图不加载 YAML、旧包目录 URL 不开放，源码布局与已保存布局仍各走原流程；移动通用解析的 YAML 资源需保留。离线桌面／移动资源使用实际打包 WASM 再运行源补丁与旧布局。上述结果不能替代新安装包或设备验收。

## 场景原文草稿布局回写

[本轮结果](test-results/scene-source-layout/results.json) 汇总当前执行范围；[Chrome 草稿流程](test-results/scene-source-layout/browser-render/browser.json) 与 [旧保存布局](test-results/scene-source-layout/browser-saved-layout/browser.json) 分别验证本地应用／普通保存和事务保存；[引擎专项](test-results/scene-source-layout/engine-final.log) 覆盖新增源补丁、旧保存布局及 JSON 来源。

```sh
node --test --test-isolation=none scripts/tests/scene-source-layout.test.mjs \
  scripts/tests/scene-layout.test.mjs scripts/tests/json-source.test.mjs
node --test scripts/tests/scene-source-layout-host.test.mjs \
  scripts/tests/scene-source-layout-ui.test.mjs scripts/tests/scene-layout-ui.test.mjs scripts/tests/scene-draft-preview-ui.test.mjs
VIENTO_SCENE_SOURCE_LAYOUT_OUTPUT=/独立证据目录 node scripts/tests/scene-source-layout-smoke.mjs /浏览器绝对路径
```

核对 Scene2D v1／v2／v3、重复定义的独立实例、分组后代移动、100 批次历史、32 会话容量及退出释放。坐标补丁只替换变化数值；验证 BOM／CRLF／Unicode、未改指数／负零、解码重复键、无效身份、伪造候选、前后 128 KiB UTF-8 边界及孤立代理字符。

宿主与真实 Chrome 另验证源码模式入口、完整正文审阅、取消保留文本、应用后按原基线计算 dirty（包括回到基线）、普通保存／重开、编辑会话基线冲突、旧画面／换文档／异步 hash 的归属失效、三语窄屏与资源清理。应用前后作者文件、元数据和构建输入须原字节一致；普通保存单独检查正文的预期变化。外部文件已改动时，本地应用不读盘且仍可完成，随后的预览应报告基线冲突，普通保存必须按原版本条件拒绝覆盖并保留草稿。草稿模式不得调用 `scene.update` 或触发 World 写入忙碌状态，保存版布局仍须回归；局部历史不代表跨文本／表单／画布统一撤销，也不等于安装包或设备验收。

## 场景原文草稿预览

[本轮结果](test-results/scene-draft-preview/results.json) 与 [Chrome 自然往返流程](test-results/scene-draft-preview/browser-final-verified/browser.json) 分别记录代码／HTTP 与实际界面验证。

```sh
node --test scripts/tests/scene-draft-preview.test.mjs scripts/tests/scene-preview-service.test.mjs \
  scripts/tests/scene-preview-http.test.mjs scripts/tests/scene-preview-ui.test.mjs \
  scripts/tests/scene-draft-preview-ui.test.mjs \
  scripts/tests/source-location-ui.test.mjs scripts/tests/project-build-ui.test.mjs
VIENTO_SCENE_DRAFT_OUTPUT=/独立证据目录 node scripts/tests/scene-draft-preview-smoke.mjs /浏览器绝对路径
```

核对原文／元数据不写入、保存版构建快照不变、128 KiB 及 HTTP 总请求边界、冻结期间外部变化、错误保留最后有效画面、来源摘要与焦点、关闭往返／切场景／迟到响应，以及中英日窄屏。浏览器只测静态设计状态，不替代 Godot 运行、新安装包或 Android 设备验收。历次报告保留原样。

## 嵌套场景分组

本轮 [验证结果](test-results/scene-groups/results.json) 包含 1269 通过／19 跳过、真实 Godot、旧版兼容和离线打包。分组交互及 16 层窄屏证据见 [Chrome 实测](test-results/scene-groups/browser-final/browser.json)。

```sh
node --test scripts/tests/scene-groups.test.mjs scripts/tests/scene-layout.test.mjs \
  scripts/tests/scene-preview-service.test.mjs scripts/tests/scene-outline-ui.test.mjs
VIENTO_GODOT_BIN=/绝对路径/Godot可执行文件 \
  node --test scripts/tests/scene-group-runtime.test.mjs
VIENTO_SCENE_GROUPS_OUTPUT=/新的空证据目录 \
  node scripts/tests/scene-groups-smoke.mjs /绝对路径/chromium
```

分组语义检查覆盖 UUID、成员、父组、环、数量／深度边界、搜索时保留祖先、按作者顺序选取后代、原文片段和精确来源。真实 SIGKILL 覆盖新建、更新及升级的提交／回滚边界，伪造组树的日志即使重算摘要也拒绝恢复。资源包往返核对组与实例 UUID、原文和去重后的定义／所属故事／素材。

兼容样本分别固定旧 v1／v2 的观察输入、计划、生成文件、来源映射及后端摘要。新作者 v3 应生成 plan2，结构附加信息不进入冻结计划；真实 Godot 从冻结输入运行，源工程离线后仍可重放。布局保持分组与成员，Rust 只处理实例几何键，组选择不改变绘制顺序。

浏览器实测检查显式启用、空组删除保护、父子成员、搜索／折叠、三语窄屏、组名到真实原文选区、后代共同拖动与撤销、保存重开及外部组名变化后的冲突保留。离线打包执行仅验证桌面／移动资源中的实际模块和 WASM；安装窗口、移动设备、空间层次和片段仍需另行验收；本轮单场景源码的坐标回写另见上方专项，跨视图统一撤销未实现。

## 独立场景实例

本轮 [完整验证结果](test-results/scene-instances/results.json) 记录应用 1233 通过／19 跳过、真实 Godot、新实例 Chrome 5 条与旧 v1 11 条流程，以及离线桌面／移动打包执行。实例实测截图与步骤见 [浏览器记录](test-results/scene-instances/browser/browser.json)。

```sh
node --test scripts/tests/scene-instances.test.mjs scripts/tests/scene-model.test.mjs \
  scripts/tests/world-scene-create.test.mjs scripts/tests/world-scene-update.test.mjs
VIENTO_GODOT_BIN=/绝对路径/Godot可执行文件 \
  node --test scripts/tests/scene-instance-runtime.test.mjs
VIENTO_SCENE_INSTANCES_OUTPUT=/新的空证据目录 \
  node scripts/tests/scene-instances-smoke.mjs /绝对路径/chromium
```

`scene-instances.test.mjs` 的 16 项检查覆盖共享定义的独立身份／覆盖、重复或缺失 UUID、128 实例上限、按实例重排的原文范围与数字写法、v1 固定计划、显式升级和拒绝降级。真实子进程分别在创建、更新及 v1→v2 升级的发布与提交边界被 SIGKILL，恢复逐字比较正文／登记，并确认不覆盖崩溃后修改的定义正文；伪造实例身份即使重算日志摘要仍被拒绝。选择式资源包导出／导入核对实例原文，并只保留一份共享定义、所属故事和图片。

运行专项区分 v1／v2 生成器、来源映射和协议，核对每帧的实例／定义配对、事件顺序及诊断来源；配置真实 Godot 后验证同一对象的移动实例与静止实例。布局／画布／表单专项还需检查同一定义的多选、单实例位置修改、复制、重排、撤销重做、精确来源、三语和旧场景显式升级。所有操作使用隔离工程；Rust 核心收到不透明几何键，实例语义仍由 JS 处理。

本轮实例专项日志见 [16 项语义／事务／资源往返](test-results/scene-instances/semantics-tests.log)，旧链路联合日志见 [80 项兼容检查](test-results/scene-instances/semantics-legacy-tests.log)。日志组有重叠；这些检查不代表持久层次、片段、剧本事件、大规模场景、旧客户端全面只读或安装设备已验收。

## 场景来源模型与原文定位

```sh
node --test scripts/tests/json-source.test.mjs scripts/tests/scene-model.test.mjs scripts/tests/source-location-ui.test.mjs
VIENTO_SCENE_PREVIEW_OUTPUT=/empty/evidence/path node scripts/tests/scene-preview-smoke.mjs /usr/bin/google-chrome
```

解析测试核对严格 JSON、解码后重复键、BOM／CRLF／emoji、转义指针和大小／深度／节点预算。模型测试用拆分前的固定样例逐字段比较 v1 计划、快照摘要及 Godot 生成文件；分别检查字段继承／覆盖、缺字段近似范围、对象重排和旧事务重复键恢复，包括被覆盖值超出新索引预算时的兼容。编辑器测试使用真实 runtime 代码，验证当前正文摘要、行尾偏移转换、未保存草稿与异步导航隔离。

真实 Chrome 从预览属性点击到主编辑器，核对场景位置与继承速度的实际选区、合成尺寸的近似提示及外部修改后的过期提示。浏览器样例及模型检查均使用隔离工程，新增来源不进入冻结计划，也不改写作者数据。证据见 [来源模型验证](test-results/scene-source-model/results.json)；该历史记录不代表 Rust 语义、稳定实例、Tauri 或 Android 设备验收；稳定实例另见本页上方专项。

## 共享 Rust 核心

`npm run core:test` 不依赖 Tauri/GTK，运行独立核心的原生测试；`npm run core:build` 准备浏览器实际使用的 WASM，应用检查会自动执行该准备步骤。`scripts/tests/studio-core.test.mjs` 验证真实 WASM、数值兼容、无效批次、缓冲协议及核心缺失／损坏后的失败状态。Node 测试通过独立适配器加载二进制，`engine/` 继续禁止 Node 和前端依赖。需要核对原生与 WASM 输出时：

```sh
cargo build --locked --manifest-path crates/viento-studio-core/Cargo.toml --bin viento-core
VIENTO_STUDIO_CORE_BIN="$PWD/crates/viento-studio-core/target/debug/viento-core" \
  node --test scripts/tests/studio-core*.test.mjs
```

`studio-core-draft.test.mjs` 另验证真实 WASM 与持久 native JSON-lines 会话的草稿状态：100 步历史、128 对象批次、无操作／无效批次保留 redo、32 草稿容量、句柄释放与失效、缓冲不可重复消费。UI 和集成测试在退出时显式释放草稿，不依赖垃圾回收。

`studio-core-save.test.mjs` 验证保存阶段及错误分类、宿主可写门禁、审阅失效、原生修改冻结、重复／迟到请求与刷新阶段。原生和 WASM 对照使用持久会话，避免逐请求重启掩盖状态错误。布局 UI 另验证嵌套错误回执、刷新失败和异步会话归属。`scene-layout-smoke.mjs` 使用两份真实延迟检查响应，验证关闭重开后旧响应不能批准或解锁新草稿。

布局专项与真实浏览器仍需验证一批次撤销、检查／保存、冲突及未改字段；`scene-selection-smoke.mjs` 另连续打开／编辑／撤销／关闭 40 次，验证超过 32 个槽位后仍能创建新草稿，并核对作者文件未写入。原生／WASM 一致不等于已验 Android WebView 或 Tauri 安装包。当前保存链证据见 [Rust 保存工作流验证](test-results/rust-layout-save/results.json)，前一轮草稿证据见 [Rust 草稿历史验证](test-results/rust-layout-history/results.json)，初次几何迁移见 [Rust 核心验证](test-results/rust-studio-core/results.json)。

## 应用检查

使用 Node.js 24 和 Rust 稳定版，在仓库根目录执行：

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run core:test
npm run check -- --app-only
```

检查包含 JavaScript 语法、版本一致性、API 契约和隔离样例回归。`npm test` 可单独运行程序测试；它与检查入口都将测试文件并发限制为 2。测试输出中的 `skipped` 必须列出原因：没有配置原生工具或 Godot 时，相应互通／真实引擎检查会跳过；缺少 Python 时，源码归档语法交叉验证也会明确跳过。

`main` / PR 的 **Check application** CI 包含基础应用检查和独立的 `compatibility` 任务；后者构建真实 Rust 工具，执行原生测试、冻结 v1/v2/v3 样例及桌面／移动归档往返。两者都不操作实际设备。

要验证自己选定工程的转换结果，可另运行 `npm run rebuild` 和 `npm run check`；这两条命令使用当前工程。常规发布检查不需要读取日常作品。

## 原生代码及跨语言往返

需要 Rust 与 [桌面系统依赖](../desktop/README.md#开发和打包)。以下命令采用 POSIX shell 和默认 Cargo 输出目录；若设置 `CARGO_TARGET_DIR`，同步替换两个辅助程序路径。

```sh
npm run desktop:prepare
npm run desktop:test -- --locked
cargo build --manifest-path src-tauri/Cargo.toml --locked --example workspace-archive --example mobile-storage
VIENTO_TEST_ARCHIVE_BINARY="$PWD/src-tauri/target/debug/examples/workspace-archive" \
VIENTO_MOBILE_STORE_BIN="$PWD/src-tauri/target/debug/examples/mobile-storage" \
npm run check -- --app-only
```

`workspace-archive` 使用桌面归档实现，`mobile-storage` 调用真实 Rust 私有存储；这些联调入口只用于开发，不打进 APK。往返测试核对原文、BOM、换行、UUID、归属、类型／模板和素材摘要，并覆盖损坏输入、并发变化及失败清理。单独运行 Rust 测试不会自动补齐应用检查中跳过的跨语言测试，必须提供上述二进制路径后重跑相关应用检查。

`full_project_migration_roundtrip` 默认忽略，需要显式指定完整作品并预留归档和恢复空间。运行前阅读 [桌面验证说明](../desktop/README.md#验证)，使用专门选定的样本，不为了清零“忽略”计数擅自读取用户作品。

## 构建与运行

首个实验后端为 Linux Godot 4。工具由宿主配置，放在工程外；完整设置和产物边界见 [构建与运行](PROJECT_BUILD.md)。

```sh
VIENTO_GODOT_BIN=/绝对路径/Godot可执行文件 \
  node --test scripts/tests/project-build.test.mjs \
  scripts/tests/project-build-service.test.mjs scripts/tests/project-build-http.test.mjs \
  scripts/tests/build-runtime-protocol.test.mjs scripts/tests/project-build-ui.test.mjs

VIENTO_GODOT_BIN=/绝对路径/Godot可执行文件 \
  node scripts/tests/project-build-smoke.mjs /绝对路径/chromium
```

专项覆盖冻结输入、UUID 依赖、资源摘要、产物复核、HTTP 边界、流式协议、任务互斥、取消和宿主退出清理。浏览器脚本复制独立 Scene2D 样例，实跑计划 → 构建 → 无头测试；有 Linux 图形会话时另跑窗口预览、关闭重开面板和取消，并验证错误回源、草稿／光标、中英日及窄屏布局。测试默认将报告和截图写入 `docs/test-results/build-workbench/`；新一轮应通过 `VIENTO_BUILD_TEST_OUTPUT=/新证据目录` 保存，避免覆盖已有记录。

场景创建另外使用新空白工程，验证 `scene.create` 的预览／事务中断／恢复、登记闭包及完整迁移：

```sh
VIENTO_GODOT_BIN=/绝对路径/Godot可执行文件 \
  node --test scripts/tests/world-scene-create.test.mjs scripts/tests/scene-authoring.test.mjs \
  scripts/tests/scene-create-ui.test.mjs
VIENTO_GODOT_BIN=/绝对路径/Godot可执行文件 \
VIENTO_SCENE_TEST_OUTPUT=/新的空证据目录 \
  node scripts/tests/scene-authoring-smoke.mjs /绝对路径/chromium
```

该浏览器脚本用模板目录构造空白工程，通过现有 World 界面创建角色、HTTP 导入图片、新场景表单保存并实跑 Godot；并检查外部修改后的草稿、三语、390px 布局及重新打开。原生空白创建与完整包往返由集成测试在提供 `VIENTO_TEST_ARCHIVE_BINARY` 时另外执行。未设置场景证据路径时使用新的临时目录，脚本拒绝覆盖非空证据目录。

无头运行只验证逻辑；窗口到达 `ready` 不等于实体键盘输入已验收。当前产物需要记录中的 Godot 运行，不是独立游戏可执行文件。正常退出、取消与超时的证据不包含宿主 SIGKILL／断电后的恢复。

## OC 子模板与投影

同一 OC 的子模板、独立配置、Scene2D 继承及资源包闭包需要一起验证：

```sh
VIENTO_GODOT_BIN=/绝对路径/Godot \
VIENTO_TEST_ARCHIVE_BINARY=/绝对路径/workspace-archive \
VIENTO_MOBILE_STORE_BIN=/绝对路径/mobile-storage \
  node --test scripts/tests/world-object-projection.test.mjs \
  scripts/tests/world-projection-update.test.mjs scripts/tests/projection-build.test.mjs \
  scripts/tests/projection-edit.test.mjs scripts/tests/object-projection-ui.test.mjs

VIENTO_GODOT_BIN=/绝对路径/Godot \
VIENTO_PROJECTION_TEST_OUTPUT=/新的空证据目录 \
  node scripts/tests/object-projection-smoke.mjs /绝对路径/chromium

VIENTO_GODOT_BIN=/绝对路径/Godot \
VIENTO_PROJECTION_EDIT_OUTPUT=/新的空证据目录 \
  node scripts/tests/object-projection-edit-smoke.mjs /绝对路径/chromium
```

专项检查模板继承／快照摘要、同一来源的不同 UUID、字段类型与范围、事务各发布点中断恢复、单投影与场景资源包依赖、改包后重算摘要的导入校验、完整 Node／Rust／移动存储归档往返，以及真实 Godot 两个角色的独立事件。完整备份继续保留损坏原文。

Chrome 脚本从空白工程创建 OC 和图片，通过三语表单创建玩家、NPC 和复用子模板；验证窄屏、外部修改冲突、预览无写入、场景继承、实际运行与重开。编辑脚本接着通过同一表单修改既有投影的名称、数值和图片，核对 UUID、模板锁、原 OC、其他投影及场景原文均不变，BOM／CRLF 保留，旧图片绑定继续可用，重新构建采用新配置。

`projection.update` 专项检查 version 7 两文件事务的中断、重复恢复、伪造日志拒绝、完全无变化时不写日志；迁移专项同时覆盖单投影资源包与完整 Node／Rust／移动存储往返。没有原生辅助程序或 Godot 的专项会明确跳过；浏览器／原生存储联调不等于新版安装包和 Android 设备验收。

## 既有场景编辑

```sh
VIENTO_GODOT_BIN=/绝对路径/Godot \
VIENTO_TEST_ARCHIVE_BINARY=/绝对路径/workspace-archive \
VIENTO_MOBILE_STORE_BIN=/绝对路径/mobile-storage \
  node --test scripts/tests/world-scene-update.test.mjs \
  scripts/tests/scene-edit.test.mjs scripts/tests/scene-edit-ui.test.mjs

VIENTO_GODOT_BIN=/绝对路径/Godot \
VIENTO_SCENE_EDIT_OUTPUT=/新的空证据目录 \
  node scripts/tests/scene-edit-smoke.mjs /绝对路径/chromium
```

专项覆盖 Scene2D 更新的第 8 版事务、正文／登记守护、标题／画布／角色增删与重排、JSON 字节保真、局部继承和覆盖，以及历史依赖保留。修改场景后旧计划不能重新构建，当前角色才进入运行；单场景资源包及完整 Node／Rust／移动存储包都核对身份、原文、素材和构建语义。

浏览器从空白工程创建 OC、多份投影和场景，再读取含局部覆盖与 `imageResourceId: null` 的手写声明，先无改动保存，再修改画布、角色和运行覆盖。它核对准确预览、中英日、390px、外部冲突草稿、保存后旧计划失效、真实 Godot 重建及重开；表单能保存不等于图形窗口或 Android 设备已验收。新证据见 [场景编辑记录](test-results/scene-edit/results.json)。

## 场景预览

```sh
node --test scripts/tests/scene-preview*.test.mjs scripts/tests/project-build-tabs.test.mjs
node scripts/tests/scene-preview-smoke.mjs /绝对路径/chromium
```

预览专项无需 Godot，验证保存快照、图片摘要、内存上限、释放／过期、迟到请求、本机访问和构建任务隔离。真实 Chrome 核对图片像素、投影继承／覆盖、叠放与选择、缩放／平移／网格、三语窄屏、切换竞态和保存后刷新。原始证据保存在 [场景预览记录](test-results/scene-preview/results.json)。静态布局验收不代替 Godot 图形运行、实体键盘或 Tauri／Android 设备验收。

## Linux 原生界面

先运行 `npm run desktop:build -- --debug --no-bundle`，准备 tauri-driver、匹配系统的 WebKitWebDriver、Xvfb、D-Bus、xdotool、xclip、xprop 和具备所需编码器的 ffmpeg。脚本创建独立设置、显示器与临时工程：

```sh
python3 desktop/tests/native-smoke.py /path/to/tauri-driver /path/to/WebKitWebDriver /path/to/viento-studio
python3 desktop/tests/native-library.py /path/to/tauri-driver /path/to/WebKitWebDriver /path/to/viento-studio
```

| 设置 | 扩展覆盖 |
| --- | --- |
| `VIENTO_TEST_GENERIC_CREATE=/path/to/workspace-archive` | 通用工程、类型和模板创建，以及完整归档恢复 |
| `VIENTO_TEST_FIELDS=1` | 配合通用工程执行字段修改、模式往返和字节核对 |
| `VIENTO_TEST_LANGUAGE=1` | 英日语言保存、重启和草稿保护 |
| `VIENTO_TEST_EDITOR_EXPORT=1` | 在 library 流程中执行原生导出保存、过期、取消与重试 |
| `VIENTO_TEST_SCREENSHOT_DIR=/path/to/new-evidence` | 保留本轮截图及日志；默认随测试目录清理 |

系统选择器、覆盖确认、媒体解码和关闭确认需在原生窗口验收。构建安装包后，可将主程序或 AppImage 作为第三个参数再次运行；调试程序通过不代表安装包已经通过。以前的窗口和安装记录从 [历史平台验收](history/README.md#迁移平台验收与维护) 查阅。

## Android 设备工作流

构建及 SDK 要求见 [移动端说明](../mobile/README.md)。浏览器与真实 Rust 存储联调替代了 IPC 传输，不能代替 Android 设备测试。

使用独立模拟器或专用测试手机，按以下顺序验证：导入桌面项目包 → 字段和源码修改 → 保存／重开 → 未保存草稿中断恢复 → 保留数据覆盖安装 → 导出并在桌面恢复 → 逐文件比较。另测新建工程与文档、键盘遮挡、三语切换、连续取消、损坏包、重复包及错误后重试。

使用新安装包时记录版本、签名类型、ABI、APK 摘要、系统／WebView 版本和设备条件。模拟器通过不等于 ARM64 实体手机通过；已有证据需区分触屏、系统选择器与 WebView DOM 操作。当前移动端功能边界见 [开发状态](STATUS.md)，不要把尚未接入的功能列成已通过或仅待补测。

## 仍需验证

| 范围 | 后续验收重点 |
| --- | --- |
| 新的桌面安装包 | 构建工作台在 Tauri 窗口中的入口、工具配置、退出收尾；原生保存和升级流程 |
| Windows / macOS | 系统文件选择、覆盖确认、媒体解码、生命周期及发行签名；Linux 结果不外推 |
| Android 实体设备 | 中日输入法候选字、低内存回收、不同 Android／WebView、屏幕与厂商系统 |
| Android 文件提供方 | 第三方云盘、外置设备、传输途中进程结束；商店签名更新需单独验收 |
| 完整大工程与容量边界 | 多 GiB 迁移、长期压力、空间不足、不同文件系统及接近移动限制时的性能 |
| Scene2D 人工交互 | 实体键盘、长时间窗口运行和更多图形设备；原生引擎或其他平台必须在接入后建立各自测试 |

尚未实现的原生 Nuis/ns-nova/yalivia、第二后端、嵌入视口、GPU 计算及宿主崩溃恢复等内容，以 [开发状态](STATUS.md) 和 [构建说明](PROJECT_BUILD.md) 为准；补测不能替代实现。

## 证据与清理

每轮记录基础提交、源码摘要、命令与退出码、通过／失败／跳过／忽略数、实际平台及限制。已有报告的数字属于当时配置；增加或减少辅助工具会改变跳过数，不直接将总数当作覆盖率。复现失败与修复后的结果分别保存。

将新日志、截图和摘要放入独立证据目录，链接到对应变更说明。历史阶段摘要见 [验证历史](history/VALIDATION.md)，全部版本化和日期型报告见 [历史导航](history/README.md)；`test-results/` 中的旧日志、指纹及历史功能图不覆盖。

测试结束后先退出进程、保留需要交付的产物，再用 `npm run clean -- --dry-run` 核对清理范围。自定义 Cargo target 和本轮新建的模拟器不在默认清理范围内，按实际创建路径单独处理；用户工程、已有模拟器、全局 SDK 和待交付产物保留。完整说明见 [桌面交付与清理](../desktop/README.md#交付与清理)。

## 场景布局编辑

```sh
node --test scripts/tests/scene-layout*.test.mjs scripts/tests/project-build-ui.test.mjs scripts/tests/desktop-close.test.mjs
VIENTO_SCENE_LAYOUT_OUTPUT=/绝对路径/新的空证据目录 node scripts/tests/scene-layout-smoke.mjs /绝对路径/chromium
```

布局专项验证位置草稿、100 步撤销／重做、拖动和取消、数值输入、版本前置条件、继承及 JSON 原文保真、资源包往返与生成产物中的坐标。界面回归覆盖保存响应校验、丢失响应后的只读核对，以及场景身份或路径变化时保留草稿。

真实 Chrome 使用临时空白工程和真实 HTTP 服务，覆盖拖动、32 像素吸附、平移、检查／保存、放弃确认、中英日和 390px 布局。保存后预览刷新、旧构建计划失效；外部冲突和响应丢失均不重复写入。浏览器专项无需配置 Godot；完整应用回归另外提供真实 Godot、原生归档与移动存储辅助程序，避免集成测试跳过。桌面关闭脚本的草稿／忙碌保护有回归，实际 Tauri 窗口与 Android 设备仍需单独验收。

## 场景多选与批量布局

```sh
node --test --test-isolation=none scripts/tests/scene-layout.test.mjs scripts/tests/scene-layout-integration.test.mjs scripts/tests/scene-layout-canvas.test.mjs scripts/tests/scene-layout-ui.test.mjs scripts/tests/scene-preview-ui.test.mjs
VIENTO_SCENE_SELECTION_OUTPUT=/绝对路径/新的空证据目录 node scripts/tests/scene-selection-smoke.mjs /绝对路径/chromium
```

专项使用三个不同尺寸、图片继承方式不同的对象，核对组合键和列表选择、全选／清选、共同位移、实际抓取对象作为吸附基准、六向对齐以及批次撤销／重做。边界回归包括浮点坐标、整组限制范围、无效批次原子拒绝及未完成数值输入保护。多选时隐藏单对象坐标框，切回单选恢复。

真实 Chrome 检查批量保存、冲突草稿、三语与 390px 布局；保存只修改场景位置，保留 UUID、BOM／CRLF、元数据、OC、投影和素材。集成测试另外核对资源包迁移及生成 Godot 场景中的全部坐标。原有只读预览和单对象布局测试继续保留。

# 验证指南

本页说明如何选择测试、运行命令和解释覆盖范围。当前功能、发布及安装状态见 [开发状态](STATUS.md)，历次数字和阶段说明见 [历史验证记录](history/VALIDATION.md)。所有常规测试使用独立临时工程。

最近保存的 [场景预览结果](test-results/scene-preview/results.json) 和 [浏览器证据](test-results/scene-preview/browser.json) 覆盖完整应用检查与 Chrome 静态画布；[场景编辑结果](test-results/scene-edit/results.json) 保留原生归档／移动存储往返和真实 Godot 运行证据。此前的 [OC 投影结果](test-results/oc-projections/results.json) 还保留当时的桌面 Rust 检查。通过／跳过／忽略数及源码、安装包与设备的区别统一列在 [当前状态](STATUS.md#验证边界)；各轮原始报告保持当时的条件。

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

## 应用检查

使用 Node.js 24，在仓库根目录执行：

```sh
npm ci
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

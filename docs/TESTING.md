# 验证指南

本页提供当前可用的验证入口和证据要求。当前源码为 **0.2.4**，已收录物理观察、角色重力／跳跃、运动与移动碰撞事件及静态单向平台，安装验收仍为 **0.2.0**；具体范围见[当前状态](STATUS.md)。逐轮日志、旧命令上下文和历史计数完整迁入[验证指南历史快照](history/testing-2026-10-25.md)，原 `test-results/` 报告不改写。

## 最近的功能证据

最新[角色移动碰撞事件专题](test-results/scene-physics2d-contact-events/README.md)记录升版前 **0.2.3 工作树**的完整应用检查 **8199 项：7761 通过、438 条件跳过，零失败／取消**，以及普通作者脚本、独立原生端口、双方实例身份、项目事件与媒体、实际 Chrome 及工程交付。Rust 核心和作者格式保持；0.2.4 的版本／源码分发专项与发布预检另记于[发布检查](test-results/release-0.2.4/README.md)，不替代安装或其他后端验收。

上一轮[单向平台专题](test-results/scene-physics2d-one-way/README.md)覆盖schema 4独立规则、静态矩形参数、保真保存、原生上穿／承重、旧运动事件与媒体、实际Chrome三语流程及异地工程交付。首次原生测试的时间窗口断言修正、定向复验和旧事件回归分别留证；没有把工作树测试视作安装验收。

本版的升版前开发验证还包括[角色重力与跳跃专题](test-results/scene-physics2d-character-motion/README.md)，覆盖独立Rust/WASM规则、保真编辑、中立计划、三语UI、实际Godot和可搬迁工程。此前的[二维物理观察专题](test-results/scene-physics2d-observation/README.md)包含独立trace／宿主、真实Godot、Chrome和异地ZIP验证；各项条件与完整检查统计在该专题记录，未更新本机0.2.0安装。

升版前 **0.2.2 工作树**在 2026-10-25 的[碰撞响应验收](test-results/scene-physics2d-response/README.md)记录最终完整应用检查 **7970 项：7599 通过、371 条件跳过，零失败／取消**；Rust 完整核心 407 项，UI 专项 108 项，实际 Chrome 5 流程／4 张截图／17 个来源摘要。真实 Godot 新矩阵 7 项含 19 个运行场景，另有旧物理原生 9 项全部通过。首次检查、能力撤回问题修复及最终复验分别留证；未重跑日常作品文档／模板／索引或安装验收。专项与完整检查有交集，不相加为覆盖率。升版后的版本一致性、源码分发与发布预检单独记录于 [0.2.3 发布检查](test-results/release-0.2.3/README.md)，不把上述开发成绩改标为升版重跑。

## 选择验证范围

| 修改范围 | 应验证什么 | 能证明的层级 |
| --- | --- | --- |
| 纯文档 | 路径与锚点、命令存在及语义、版本与能力事实、旧报告保留 | 文档准确性；无需重跑应用或原生测试 |
| 纯领域、解析、编辑、模板与翻译 | 相关规则／来源／控制器测试，适用时完整应用检查 | 隔离样例和接口边界；有布局或输入变化需实际浏览器 |
| Rust 核心／WASM | Rust 测试、WASM 构建、原生／WASM 对照和相关应用链 | 两端同规则与回执；纯模块不代表设备交互 |
| 登记、事务、迁移与归档 | 故障／冲突／恢复、原生工具及跨语言往返 | 正文、UUID、模板、关系和素材的一致性 |
| 场景、后端、任务与运行协议 | 冻结计划、真实工具、旧兼容、取消与诊断、Chrome 工作流 | 对应后端实际执行；替代工具夹具不授予产品能力 |
| 桌面宿主与安装包 | 准备资源、原生检查、准备交付的程序／AppImage窗口流程 | 具体产物和宿主；源码结果不能替代安装验收 |
| Android 宿主 | 移动准备资源、Rust 存储往返、独立设备流程 | 指定设备、系统、WebView、签名和 ABI 的范围 |

正文和素材相关修改核对最终字节及失败现场；异步操作核对来源、会话和迟到响应；任务修改核对进程退出和临时资源回收。测试自身、浏览器、实际后端、系统窗口与设备各自记录，避免用一种证据代替另一种。

## 应用检查

以下命令从仓库根目录执行，使用 Node.js 24 和 Rust 稳定工具链；安装依赖和 WASM 目标只需在环境未准备时执行。

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run core:test
npm run check -- --app-only
```

`check-project.mjs` 准备核心后检查版本、JavaScript 语法、API 契约，并以并发 2 运行应用测试。`--app-only` 跳过当前作品的标准文档、模板对齐和静态索引检查；`npm test` 只运行应用测试，执行前也会准备核心。

需要核对所选作者工程时，在明确选定的隔离工程环境运行 `npm run rebuild` 和 `npm run check`。完整检查会读取当前工程，不为文档维护或减少跳过数擅自切换到日常作品。缺少原生工具、Godot、Python 等条件时，相关测试按自身逻辑跳过；记录所缺条件，不能将 skipped 写成通过。

源码发布专项可单独运行：

```sh
node --test scripts/tests/version.test.mjs scripts/tests/source-archive.test.mjs
```

## 共享 Rust 核心

```sh
npm run core:test
npm run core:build
cargo build --locked --manifest-path crates/viento-studio-core/Cargo.toml --bin viento-core
VIENTO_STUDIO_CORE_BIN="$PWD/crates/viento-studio-core/target/debug/viento-core" \
  node --test scripts/tests/studio-core*.test.mjs
```

设置自定义 `CARGO_TARGET_DIR` 时，辅助程序路径须使用实际输出位置。修改严格解析、几何、补丁或格式时核对原生／WASM 输入输出、旧可选能力、合法及拒绝边界、原文字节和来源回执；单元测试数量不与应用总数相加。

## 二维角色移动碰撞事件

普通脚本及端口测试为 `character-contact-event-starter.test.mjs`；真实后端与浏览器入口：

```sh
VIENTO_GODOT_BIN=/absolute/path/to/Godot node --test scripts/tests/scene-physics2d-contact-events-backends.test.mjs
VIENTO_GODOT_BIN=/absolute/path/to/Godot node scripts/tests/scene-physics2d-contact-events-smoke.mjs /absolute/path/to/chromium
```

核对仅运动角色获得独立版本1端口，本步碰撞集合按对方身份去重、结束差项先于开始差项；持续阻挡不重复，未知原生碰撞体不认领登记身份，关闭不合成结束事件。作者载荷为对方实例UUID，自身保留在来源；实际媒体执行、无trace交互运行、重入及异地ZIP分别核对。普通TXT创建、参数审阅、保存、三语和来源导航另做Chrome验证；详细命令与边界见[移动碰撞事件专题](test-results/scene-physics2d-contact-events/README.md)。

## 二维静态单向平台

核心、保真编辑、中立计划和UI入口为 `scene-physics2d-one-way-{core,edit,plan,ui}.test.mjs`。原生与浏览器入口：

```sh
VIENTO_GODOT_BIN=/absolute/path/to/Godot node --test scripts/tests/scene-physics2d-one-way-backends.test.mjs
VIENTO_GODOT_BIN=/absolute/path/to/Godot node scripts/tests/scene-physics2d-one-way-smoke.mjs /absolute/path/to/chromium
```

验证静态矩形及有限容差1–64、拒绝旧格式夹带字段、独立检查能力、启用／关闭保真保存和关闭不降格式；核对上穿、从上承重、碰撞掩码、偏移、圆形角色、旧停止／滑动、重入与无trace交互运行。落地事件和动画／声音分别观察结果，工程ZIP搬迁后独立运行。完整原生截图需另设 `VIENTO_PHYSICS_ONE_WAY_CAPTURE`；执行命令与日志见[专题](test-results/scene-physics2d-one-way/README.md)。

## 二维角色运动事件

开发工作树专题见[角色事件验证](test-results/scene-physics2d-character-events/README.md)。普通起始脚本测试为 `character-motion-event-starters.test.mjs`，真实工具入口为：

```sh
VIENTO_GODOT_BIN=/absolute/path/to/Godot node --test scripts/tests/scene-physics2d-character-events-backends.test.mjs
VIENTO_GODOT_BIN=/absolute/path/to/Godot node scripts/tests/scene-physics2d-character-events-smoke.mjs /absolute/path/to/chromium
```

核对实际接受起跳、初次／再次着地、持续站立、长按／空中按键、碰顶、禁用跳跃、实例和访问隔离；真实事件继续保留作者发布及订阅来源。动画与声音各看执行结果，不把发布成功当作播放成功；交互运行不依赖物理观察流。模板创建、显式参数、普通保存和三语入口另做浏览器验证，工程ZIP另验证原路径失效后的运行。新专题记录本轮结果，旧运动／观察证据不改标。

## 二维角色重力与跳跃

核心及保真编辑入口为 `scene-physics2d-motion-core.test.mjs`、`scene-physics2d-motion-edit.test.mjs`；中立计划与UI分别为 `scene-physics2d-character-motion-plan.test.mjs` 和 `scene-physics2d-character-motion-ui.test.mjs`。

```sh
VIENTO_GODOT_BIN=/absolute/path/to/Godot node --test scripts/tests/scene-physics2d-character-motion-backends.test.mjs
VIENTO_GODOT_BIN=/absolute/path/to/Godot node scripts/tests/scene-physics2d-character-motion-smoke.mjs /absolute/path/to/chromium
```

验证实际落地横移、单次跳跃、长按／空中不连跳、碰顶／墙、速度上限、零起跳速度、无输入重力、混合角色和场景重入。交互运行与smoke共用同一次移动，原观察协议保持；测试输入按实际已完成逻辑步安排，不把引擎等待帧当成作者步。另核对关闭模式后的schema 3构建、缺能力拒绝、旧生成字节、原文叶保真以及导出后失去原路径仍能运行。专题保留失败、复验与准确工具条件。

## 二维物理运行观察

纯契约和宿主入口为 `project-physics2d-trace.test.mjs`、`project-physics2d-host.test.mjs`；界面为 `project-physics-observation-ui.test.mjs` 和 `project-physics-observation-build-ui.test.mjs`。真实工具测试需显式设置 `VIENTO_GODOT_BIN`：

```sh
VIENTO_GODOT_BIN=/absolute/path/to/Godot node --test scripts/tests/scene-physics2d-observation-backends.test.mjs
VIENTO_GODOT_BIN=/absolute/path/to/Godot node scripts/tests/scene-physics2d-observation-smoke.mjs /absolute/path/to/chromium
```

检查输出必须区分完整、限额部分和中断；未知碰撞体不能伪造来源，观察不写作者文件。真实窗口截图需要显示环境；旧生成器与运行脚本另有字节冻结断言。

## 二维物理空间编辑

当前定向入口覆盖字段、来源宿主、创建事务、目标／空间读取、偏移和尺寸提案及渲染：

```sh
node --test scripts/tests/scene-physics2d-*.test.mjs
```

真实引擎用例需显式提供可信工具。尺寸浏览器脚本默认创建本专题中的新时间戳目录，并拒绝复用非空目录：

```sh
VIENTO_GODOT_BIN=/absolute/path/to/Godot \
  node scripts/tests/scene-physics2d-space-resize-smoke.mjs /absolute/path/to/chromium
```

如指定 `VIENTO_PHYSICS2D_SPACE_RESIZE_OUTPUT`，目录必须位于仓库的 `docs/test-results/scene-physics2d-space-resize/` 内且为空。偏移对应 `scene-physics2d-space-edit-smoke.mjs` 和 `VIENTO_PHYSICS2D_SPACE_EDIT_OUTPUT`，同样使用自己专题下的新目录。

核对真实命中而非只看 DOM：选择与调整模式互斥、缩放／留白下逆 CTM、临时轮廓、松手才更新字段、取消／多指／失焦／过期来源、越界拒绝、键盘／按钮、中英日窄屏及原文数字写法。Check、Review、Apply 和普通 Save 分别断言；普通保存仅改目标正文，场景位置、登记和素材保持。最后以已保存工程实际构建运行验证碰撞、触发和动画，空间图本身不当作物理模拟器。

## 角色碰撞响应

新响应格式、原文保真、字段／首次创建和事务回归包含在 `scene-physics2d-*.test.mjs` 中。真实 Godot 比较另行启用工具；浏览器验证只写隔离作者工程和本专题中新时间戳证据目录：

```sh
VIENTO_GODOT_BIN=/absolute/path/to/Godot \
  node --test scripts/tests/scene-physics2d-response-backends.test.mjs
node scripts/tests/scene-physics2d-response-smoke.mjs /absolute/path/to/chromium
```

浏览器可通过 `VIENTO_PHYSICS2D_RESPONSE_OUTPUT` 指定 `docs/test-results/scene-physics2d-response/` 内的空目录；不覆盖旧报告。重点核对 schema 1 默认停止、显式滑动升级、回到停止不降级、能力撤回后不发送失去能力支持的请求，以及偏移／尺寸编辑仍保留响应字段。真实运动矩阵使用普通作者行为驱动输入，生成脚本不打补丁；浮点数采用明确容差，松手最后两帧须稳定。详见[本轮专题](test-results/scene-physics2d-response/README.md)。

## 构建与运行

```sh
VIENTO_GODOT_BIN=/absolute/path/to/Godot \
  node --test scripts/tests/project-build.test.mjs scripts/tests/project-build-service.test.mjs \
  scripts/tests/project-build-http.test.mjs scripts/tests/build-runtime-protocol.test.mjs
```

测试分别核对工具版本／完整摘要、保存态依赖、冻结输入、生成物、运行身份、旧协议、错误定位、取消／超时和进程清理。无头成功不证明图形窗口、实体输入、安装包或独立游戏发行。新引擎版本和新协议须保留旧读取分支并用实际工具验证；专题入口见[构建指南](PROJECT_BUILD.md)。

## Bevy 第二后端

数据运行程序和作者 Rust 源工程是两条独立通道；前者的验证不能代替后者。已缓存依赖时可执行：

```sh
CARGO_TARGET_DIR=/tmp/viento-bevy-verification-target \
  cargo test --manifest-path crates/viento-bevy-runtime/Cargo.toml --locked --offline -j2
VIENTO_BEVY_BIN=/absolute/path/to/viento-bevy-runtime \
  VIENTO_GODOT_BIN=/absolute/path/to/Godot \
  node --test scripts/tests/bevy-adapter.test.mjs scripts/tests/bevy-workflow.test.mjs
node --test scripts/tests/bevy-rust-adapter.test.mjs scripts/tests/bevy-rust-project.test.mjs \
  scripts/tests/bevy-rust-fixed-step.test.mjs
```

依赖和工具准备按[Bevy 指南](BEVY_BACKEND.md)执行。记录真实 Cargo／运行程序是否参与、离线缓存、取消清理与源码交付；未知或缺少能力的计划必须明确拒绝。数据通道的有限回放、Rust 通道的就绪／固定步、图片、窗口、声音、物理和 GPU 分别判断。

## 原生代码及跨语言往返

需要 [桌面系统依赖](../desktop/README.md#开发和打包)。默认 Cargo 输出路径下：

```sh
npm run desktop:prepare
npm run desktop:test -- --locked
cargo build --manifest-path src-tauri/Cargo.toml --locked --example workspace-archive --example mobile-storage
VIENTO_TEST_ARCHIVE_BINARY="$PWD/src-tauri/target/debug/examples/workspace-archive" \
  VIENTO_MOBILE_STORE_BIN="$PWD/src-tauri/target/debug/examples/mobile-storage" \
  npm run check -- --app-only
```

设置自定义 Cargo 输出目录后同步调整工具路径。两个辅助程序使用实际 Rust 归档／私有存储实现，不打进 APK；往返核对原文、BOM、换行、UUID、归属、模板、素材、损坏输入、并发变化和失败清理。单跑 Rust 测试不补齐应用中因未提供二进制而跳过的跨语言用例。

`full_project_migration_roundtrip` 默认忽略，需显式选定完整作品并预留空间；阅读[桌面验证](../desktop/README.md#验证)后使用专门样本。

## Linux 原生界面

准备 tauri-driver、匹配系统的 WebKitWebDriver、Xvfb、D-Bus、xdotool、xclip、xprop 和所需 ffmpeg 编码器。调试程序可用 `npm run desktop:build -- --debug --no-bundle` 构建；验证已有 release AppImage 无需另建 debug 程序。

```sh
python3 desktop/tests/native-smoke.py /path/to/tauri-driver /path/to/WebKitWebDriver /path/to/Viento-Studio.AppImage
python3 desktop/tests/native-library.py /path/to/tauri-driver /path/to/WebKitWebDriver /path/to/viento-studio
```

`native-smoke.py` 可自动将 AppImage 解包到测试自己的临时目录，结束后清理；`native-library.py` 应传可运行的主程序或私有解包后的 `squashfs-root/AppRun`。测试创建独立设置、显示器和工程，不操作日常作品。

| 环境变量 | 扩展范围／约束 |
| --- | --- |
| `VIENTO_TEST_GENERIC_CREATE=/path/to/workspace-archive` | 通用工程、类型、模板和完整归档恢复 |
| `VIENTO_TEST_FIELDS=1` | 配合通用工程验证字段修改、模式往返和字节 |
| `VIENTO_TEST_LANGUAGE=1` | 英日切换、重启和草稿保护 |
| `VIENTO_TEST_2D_WORKFLOW=1` | 配方生成、原文诊断、Godot构建与有限无头运行；不可与 GENERIC_CREATE 同启 |
| `VIENTO_TEST_ANIMATION_TRIAL_CASE=1` | 新建状态表的单步／连续试算和用例 JSON 编辑；可与二维专项串行，不与 GENERIC_CREATE 同启 |
| `VIENTO_EXPECT_APP_VERSION`／`VIENTO_EXPECT_BUILD_VERSION` | 检查实际目标程序版本；最近已验安装值均为 `0.2.0`，不能把源码版本填作安装事实 |
| `VIENTO_TEST_XDOTOOL=/path/to/xdotool` | 指定测试显示器使用的键盘／窗口工具 |
| `VIENTO_TEST_EDITOR_EXPORT=1` | library 流程的原生导出、失效、取消与重试 |
| `VIENTO_TEST_SCREENSHOT_DIR=/path/to/new-evidence` | 保留新一轮截图与日志 |
| `TMPDIR=/path/to/disk-scratch` | 放置测试临时工程和 AppImage 解包，避免小容量 tmpfs 耗尽 |

二维专项另需 `VIENTO_GODOT_BIN`；原生最小视口是 760px。系统选择器、覆盖确认、媒体解码、关闭与实际键盘必须在窗口内验证。Blob／File 的前端传输不等于系统选择器或下载已验，合成输入法保护和真实键盘分别记录。

`VIENTO_EXPECT_OLD_VERSION_REJECTION=1` 只验证旧程序打开隔离 guard 样例后拒绝并退出，不执行正常功能流程。最近安装的初次失败、修复、重打包和最终复测见[0.2.0 安装记录](test-results/native-installed-0.2.0/README.md)。

## Android 设备工作流

SDK、构建与宿主范围见[移动端说明](../mobile/README.md)。浏览器和 Rust 存储联调替代 IPC 传输，不能代替 Android 设备。

在独立模拟器或专用手机上验证：导入桌面包 → 字段／源码修改 → 保存重开 → 草稿中断恢复 → 保留数据覆盖安装 → 导出并在桌面恢复 → 逐文件比较。另测新建、键盘遮挡、中日输入法、三语、连续取消、损坏／重复包和错误重试。

记录版本、签名类型、ABI、APK 摘要、Android／WebView 和设备条件；模拟器、实体 ARM64、系统选择器和 WebView DOM 分开描述。尚未接入移动宿主的场景编辑与引擎执行不列为“只差设备补测”。

## 功能图谱与证据核对

```sh
node scripts/function-atlas.mjs --check
node --test scripts/tests/function-atlas*.test.mjs
```

图谱引用当前源文件时，变更后需按[图谱维护说明](FUNCTION_ATLAS.md)更新生成物和指纹；新能力追加坐标与证据，旧评分理由、报告和历史版本保持原时点。仅修改文档时只做适用的结构／链接／事实检查，图谱受影响才运行图谱检查，不把结果描述为应用或引擎重测。

## 仍需验证

| 范围 | 重点 |
| --- | --- |
| 新安装产物 | 0.2.1–0.2.4 的源码增量尚未随新安装程序验收；安装包应覆盖新增界面和原有关键路径 |
| 桌面扩展 | Windows／macOS 的选择器、解码、生命周期与签名；更多 3D、后端和长任务关闭场景 |
| Android 实体设备 | 输入法候选、低内存回收、不同 WebView／厂商、云盘／外置存储及商店签名更新 |
| 大工程 | 多 GiB 迁移、长期压力、空间不足、不同文件系统与接近各域预算的性能 |
| 图形与运行 | 实体键盘、更多图形设备、3D 物理 GPU 与各后端新增能力；按真实接入范围建样例 |

尚未实现的 LSP、原生 Nuis/ns-nova、内嵌视口、GPU 计算等先按[路线图](ROADMAP.md)建立能力；补测不能代替实现。

## 证据与清理

每轮保留基础提交、源码摘要、命令／退出码、通过／失败／跳过／忽略数、工具版本与平台限制。首次失败与修复后的复测分别保存。浏览器截图之外，还需核对完整数据、作者文件变更范围、来源指纹及异步请求归属。

新日志写入独立空证据目录；`test-results/` 旧日志、截图、摘要和历史图谱不覆盖。专题结果可从[历史导航](history/README.md)查找，较早阶段摘要见[验证历史](history/VALIDATION.md)。

结束后先退出进程并保留需交付的产物，再执行 `npm run clean -- --dry-run` 核对清理范围。自定义 Cargo target 和本轮新建模拟器按实际创建路径单独处理；用户工程、现有模拟器、全局 SDK、工具和待交付产物保留。见[桌面清理说明](../desktop/README.md#交付与清理)。

## 专题验证入口

下面保留原指南的专题锚点。当前操作以对应指南为准；具体旧命令、计数、环境与失败条件仍在历史快照，不将旧结果重标为新测试。

### 配方与场景创作

<a id="整份配方放置管理"></a>

- 整份配方放置管理：[历史验证方法](history/testing-2026-10-25.md#整份配方放置管理)。

<a id="独立场景创作流程与宿主接口"></a>

- 独立场景创作流程与宿主接口：[历史验证方法](history/testing-2026-10-25.md#独立场景创作流程与宿主接口)。

<a id="场景片段组合实验"></a>

- 场景片段组合实验：[历史验证方法](history/testing-2026-10-25.md#场景片段组合实验)。

<a id="已保存与未保存配方预览"></a>

- 已保存与未保存配方预览：[历史验证方法](history/testing-2026-10-25.md#已保存与未保存配方预览)。

<a id="单实例局部覆盖与普通保存"></a>

- 单实例局部覆盖与普通保存：[历史验证方法](history/testing-2026-10-25.md#单实例局部覆盖与普通保存)。

<a id="恢复继承与混合补丁"></a>

- 恢复继承与混合补丁：[历史验证方法](history/testing-2026-10-25.md#恢复继承与混合补丁)。

<a id="配方单实例画布与原文草稿"></a>

- 配方单实例画布与原文草稿：[历史验证方法](history/testing-2026-10-25.md#配方单实例画布与原文草稿)。

<a id="配方多实例批次画布与原文草稿"></a>

- 配方多实例批次画布与原文草稿：[历史验证方法](history/testing-2026-10-25.md#配方多实例批次画布与原文草稿)。

<a id="共享片段字段与普通保存"></a>

- 共享片段字段与普通保存：[历史验证方法](history/testing-2026-10-25.md#共享片段字段与普通保存)。

<a id="共享声明恢复与原子设置删除"></a>

- 共享声明恢复与原子设置删除：[历史验证方法](history/testing-2026-10-25.md#共享声明恢复与原子设置删除)。

<a id="放置偏移与全成员原文审批"></a>

- 放置偏移与全成员原文审批：[历史验证方法](history/testing-2026-10-25.md#放置偏移与全成员原文审批)。

<a id="共享片段演员结构与普通保存"></a>

- 共享片段演员结构与普通保存：[历史验证方法](history/testing-2026-10-25.md#共享片段演员结构与普通保存)。

当前能力与操作见[配方与场景创作](SCENE_COMPOSITION.md)。

### 系统装配

<a id="系统装配与模板需求"></a>

- 系统装配与模板需求：[历史验证方法](history/testing-2026-10-25.md#系统装配与模板需求)。

当前能力与操作见[系统装配](STUDIO_MODULES.md)。

### 布局、实例与来源

<a id="rust-源码检查与坐标补丁"></a>

- Rust 源码检查与坐标补丁：[历史验证方法](history/testing-2026-10-25.md#rust-源码检查与坐标补丁)。

<a id="场景原文草稿布局回写"></a>

- 场景原文草稿布局回写：[历史验证方法](history/testing-2026-10-25.md#场景原文草稿布局回写)。

<a id="场景原文草稿预览"></a>

- 场景原文草稿预览：[历史验证方法](history/testing-2026-10-25.md#场景原文草稿预览)。

<a id="嵌套场景分组"></a>

- 嵌套场景分组：[历史验证方法](history/testing-2026-10-25.md#嵌套场景分组)。

<a id="独立场景实例"></a>

- 独立场景实例：[历史验证方法](history/testing-2026-10-25.md#独立场景实例)。

<a id="场景来源模型与原文定位"></a>

- 场景来源模型与原文定位：[历史验证方法](history/testing-2026-10-25.md#场景来源模型与原文定位)。

<a id="oc-子模板与投影"></a>

- OC 子模板与投影：[历史验证方法](history/testing-2026-10-25.md#oc-子模板与投影)。

<a id="既有场景编辑"></a>

- 既有场景编辑：[历史验证方法](history/testing-2026-10-25.md#既有场景编辑)。

<a id="场景预览"></a>

- 场景预览：[历史验证方法](history/testing-2026-10-25.md#场景预览)。

<a id="场景布局编辑"></a>

- 场景布局编辑：[历史验证方法](history/testing-2026-10-25.md#场景布局编辑)。

<a id="场景多选与批量布局"></a>

- 场景多选与批量布局：[历史验证方法](history/testing-2026-10-25.md#场景多选与批量布局)。

当前能力与操作见[布局、实例与来源](PROJECT_BUILD.md)。

### 执行中间层与行为

<a id="场景实例行为"></a>

- 场景实例行为：[历史验证方法](history/testing-2026-10-25.md#场景实例行为)。

<a id="执行后端中间层"></a>

- 执行后端中间层：[历史验证方法](history/testing-2026-10-25.md#执行后端中间层)。

<a id="显式工具身份检查"></a>

- 显式工具身份检查：[历史验证方法](history/testing-2026-10-25.md#显式工具身份检查)。

当前能力与操作见[执行中间层与行为](BACKEND_MIDDLEWARE.md)。

### 运行观察与验收

<a id="成员详情与报告导出未发布"></a>

- 成员详情与报告导出（未发布）：[历史验证方法](history/testing-2026-10-25.md#成员详情与报告导出未发布)。

<a id="有序验收组工作流未发布"></a>

- 有序验收组工作流（未发布）：[历史验证方法](history/testing-2026-10-25.md#有序验收组工作流未发布)。

<a id="工程验收文档工作流未发布"></a>

- 工程验收文档工作流（未发布）：[历史验证方法](history/testing-2026-10-25.md#工程验收文档工作流未发布)。

<a id="运行验收用例未发布"></a>

- 运行验收用例（未发布）：[历史验证方法](history/testing-2026-10-25.md#运行验收用例未发布)。

<a id="有限控制回放"></a>

- 有限控制回放：[历史验证方法](history/testing-2026-10-25.md#有限控制回放)。

<a id="运行对象观察"></a>

- 运行对象观察：[历史验证方法](history/testing-2026-10-25.md#运行对象观察)。

当前能力与操作见[运行观察与验收](RUNTIME_CASES.md)。

### 组装与声音

<a id="首次场景声音创建013-后工作树"></a>

- 首次场景声音创建（0.1.3 后工作树）：[历史验证方法](history/testing-2026-10-25.md#首次场景声音创建013-后工作树)。

<a id="项目组装工作树验证"></a>

- 项目组装工作树验证：[历史验证方法](history/testing-2026-10-25.md#项目组装工作树验证)。

<a id="项目内场景切换验证"></a>

- 项目内场景切换验证：[历史验证方法](history/testing-2026-10-25.md#项目内场景切换验证)。

当前能力与操作见[组装与声音](PROJECT_ASSEMBLY.md)。

### 动画

<a id="动画控制器运行记录回看"></a>

- 动画控制器运行记录回看：[历史验证方法](history/testing-2026-10-25.md#动画控制器运行记录回看)。

<a id="动画共享状态条件"></a>

- 动画共享状态条件：[历史验证方法](history/testing-2026-10-25.md#动画共享状态条件)。

<a id="动画组合条件"></a>

- 动画组合条件：[历史验证方法](history/testing-2026-10-25.md#动画组合条件)。

当前能力与操作见[动画](SCENE_ANIMATION.md)。

### 旧源码发布检查

<a id="009-源码发布检查"></a>

- 0.0.9 源码发布检查：[历史验证方法](history/testing-2026-10-25.md#009-源码发布检查)。

<a id="008-源码发布检查"></a>

- 0.0.8 源码发布检查：[历史验证方法](history/testing-2026-10-25.md#008-源码发布检查)。

当前能力与操作见[旧源码发布检查](RELEASE_0.0.9.md)。

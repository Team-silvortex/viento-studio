# 验证指南

本页说明如何选择测试、运行命令和解释覆盖范围。当前功能、发布及安装状态见 [开发状态](STATUS.md)，历次数字和阶段说明见 [历史验证记录](history/VALIDATION.md)。所有常规测试使用独立临时工程。

当前保存状态与异步归属见 [Rust 保存工作流验证](test-results/rust-layout-save/results.json) 及 [真实浏览器记录](test-results/rust-layout-save/layout-browser/browser.json)。

此前 Rust 布局草稿／撤销历史见 [验证结果](test-results/rust-layout-history/results.json)、[多选与生命周期实测](test-results/rust-layout-history/selection-browser/browser.json) 和 [保存失败／冲突实测](test-results/rust-layout-history/layout-browser/browser.json)。

最新多选与批量布局见 [场景多选结果](test-results/scene-selection/results.json) 和 [浏览器记录](test-results/scene-selection/browser.json)。前一轮布局编辑回归见 [场景布局结果](test-results/scene-layout/results.json) 与 [真实浏览器记录](test-results/scene-layout/browser.json)。此前的 [场景预览结果](test-results/scene-preview/results.json) 和 [浏览器证据](test-results/scene-preview/browser.json) 覆盖完整应用检查与 Chrome 静态画布；[场景编辑结果](test-results/scene-edit/results.json) 保留原生归档／移动存储往返和真实 Godot 运行证据。此前的 [OC 投影结果](test-results/oc-projections/results.json) 还保留当时的桌面 Rust 检查。通过／跳过／忽略数及源码、安装包与设备的区别统一列在 [当前状态](STATUS.md#验证边界)；各轮原始报告保持当时的条件。

## 功能图谱与证据核对

[当前功能图谱](FUNCTION_ATLAS.md) 为架构、功能、实现与四项成熟度提供离线筛选，完整映射旧图的 F01–F50。检查命令 `node scripts/function-atlas.mjs --check` 验证坐标、引用文件、指纹、评分门槛及派生视图一致性；它不运行产品测试，也不证明评分或测试覆盖率。引用文件改变后需人工重审相关条目，再显式运行 `node scripts/function-atlas.mjs --write --refresh-sources`。旧报告只适用于其原条件。

## 0.0.8 源码发布检查

本次[发布候选](test-results/release-0.0.8/results.json)重新执行 0.0.8 下的完整应用 **1774／1774**，0 失败／跳过／取消，**391** JS／API／版本检查通过；启用两个真实引擎、原生核心和归档／移动存储辅助程序。共享编辑核心 Rust **75／75** 与 fmt／clippy另计，版本／源码归档专项 **8／8** 与应用重叠。

[资源清单](test-results/release-0.0.8/prepared-manifests.json)核对桌面资源 496／作品库 11／移动 192 份；[准备模块运行](test-results/release-0.0.8/packaged-resources.json)另核对 89／68，实际 10 次离线会话，移动只执行 4 个纯模块。实际[临时源码归档](test-results/release-0.0.8/source-archive.json)2573 文件／68 关键项回读核对两 crate、四官方样例和排除生成物／作品；快照在最终发布审计文字之前生成，已删除，不重标为最终提交归档。

1733 历史／9 冻结原字节保持、138 当前源码摘要核对；7 新生成目录与 1 验证归档清理回收 2058166272 字节／1.917 GiB。近期 Chrome、Bevy 独立 Rust和其他专题保留原执行条件；本轮不做新安装、浏览器、Tauri 窗口或 Android 设备实测。下列数字段保留各专题原版本，不因源码发布改写。

## 选择验证范围

| 改动范围 | 应执行的验证 | 能证明的层级 |
| --- | --- | --- |
| 纯文档变更 | 检查链接／锚点、命令与事实一致性、历史报告及证据字节未变 | 文档准确性；无需重跑应用和原生测试 |
| 解析、编辑器、模板、语言及一般应用逻辑 | 应用检查；涉及交互时增加对应浏览器实测 | 临时样例回归和实际网页行为 |
| 登记、事务、迁移、完整归档或移动存储 | 应用检查 + 原生测试 + 启用两个原生工具的跨语言往返 | 正文、UUID、模板、素材及失败恢复的一致性 |
| 桌面宿主、会话与进程生命周期 | 应用检查 + `desktop:prepare` + `desktop:test`；系统交互另跑原生窗口流程 | 编译和原生逻辑；窗口流程需单独证据 |
| Scene2D 构建、HTTP 任务或运行协议 | 构建专项 + 配置真实 Godot 的应用检查 + Chrome 构建工作台 | 引擎进程、产物、状态、退出清理和网页操作 |
| 场景行为清单、源码或事件 | 可移植／包依赖专项 + 冻结宿主与真实 Godot + 真实浏览器 | 实例独立参数、类型／签名拒绝、可信来源、原字节迁移及旧计划兼容 |
| 执行后端中间层、描述符或适配器 | 纯能力／宿主／具体适配器专项 + 已有冻结样例 + 真实 Godot／Bevy／浏览器 + 桌面和移动打包模块 | 能力隔离、可信注入、输出边界、冻结回放与界面审批；测试后端不代表产品引擎接入 |
| 全局／按实例有限方向回放、步骤采样或工具升级 | 纯控制／观察、宿主／UI、Rust 工具及两引擎实际回放 + Chrome + 准备资源 | 数据与联合预算、身份／步骤／生命周期、冻结离线、取消保样本和原字节清理；不证明实时输入、反射或渲染 |
| 运行对象观察、检索和来源导航 | 纯观察／宿主／UI 专项 + 同计划真实 Godot／Bevy + Chrome + 准备资源 | 稳定身份、启动／结束／过期样本、任务归属、只读 inspect、事件环独立、草稿与光标保护；不证明反射／RPC |
| Android 宿主、系统选择器与生命周期 | 移动资源／原生检查 + 独立设备工作流 | 对应设备、系统和 WebView 条件下的行为 |
| 新安装包 | 在准备交付的安装包上重跑平台关键流程 | 该产物的安装及运行；源码通过不能替代 |

涉及正文或素材时，断言内容字节、登记关系与失败后的状态；涉及任务生命周期时，核对进程退出和临时资源回收。程序自己的单元测试通过、跨语言互通通过、浏览器通过、系统窗口通过和设备通过是不同证据，分别记录。

## 有限控制回放

[有限控制回放](RUNTIME_CONTROL.md)采用独立的纯数据程序和 trace，不升级作者 Scene2D 或旧 plan／runtime 1／2。程序专项验证精确布尔字段、1–64 步、`0 < fixedDelta <= 0.25`、总时长至多 8 秒、最后全释放，以及实例数 × 步数至多 1024；拒绝访问器、隐藏键、原型、循环、路径、Entity 和超限。步骤准入核对完整身份集合、连续索引、ready／finished 顺序及最终样本一致；一个输出块的回调必须保持原行序，无效结束不能覆盖有效样本。

```sh
node --test scripts/tests/scene-control-program.test.mjs \
  scripts/tests/scene-instance-control.test.mjs \
  scripts/tests/scene-runtime-query.test.mjs scripts/tests/scene-runtime-events.test.mjs

CARGO_TARGET_DIR=/tmp/viento-bevy-control-target \
  CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 \
  cargo test --manifest-path crates/viento-bevy-runtime/Cargo.toml --locked --offline -j2
```

schema 2 另验证每步 0–128 行、总行数至多 1024、重复目标拒绝、定义 UUID 不能冒充实例、未知实例提前拒绝、plan 1 即使空输入也不支持，以及未列每步释放；schema 1 的精确结构、旧执行语义和 16 KiB 文件限制保留，schema 2 文件至多 256 KiB。最终按实例纯专项与相邻模块 **45／45** 通过，见[本轮纯规则](test-results/runtime-instance-control/portable-tests-final.log)。另回归合法 11／64 步 × 128 行超限在深拷贝节点防御前返回 `runtime_control_limit`，预算预检只读描述符，访问器仍不执行；初始 44 项日志保留。

实际工具升级后，以 `VIENTO_BEVY_BIN` 和 `VIENTO_GODOT_BIN` 指向真实工具，再运行应用与控制宿主／界面专项。对照同一 plan 1／2 的多步方向、反向抵消、斜向归一化、none／零速度、重复定义实例；位置浮点误差与状态序列分开比较。另验证 `--control-program` 从冻结产物离线运行、严格 HTTP 白名单、窗口／行为拒绝、cancel／timeout 最后样本、原构建与作者字节不变。Chrome 另检查全局／实例选择仅改变示例目标、显式生成才替换 JSON、多实例不同方向与逐步释放、同名且 UUID 前缀相同的实例以末尾短标识区分、完整 UUID 提示与实际值保持、JSON 编辑和错误保留输入、控制进度、三语 390px、来源与草稿守护；桌面准备资源执行两个真实后端，移动仅验证纯模块，不把它计为 Android 执行或 UI。

本轮按实例最终结果见[实例控制记录](test-results/runtime-instance-control/results.json)：应用 **1774／1774**、0 失败／跳过／取消，**391** JS／API／0.0.7 版本通过；新增 **28**（纯实例 9、后端 4、宿主 6、UI 6、CLI 3）已含全量。pure **45／45**、engine **36／36**、host／UI **69／69**、CLI **7／7** 与窄屏标签 UI **42／42** 是相关或重叠专项，不能再次加到应用总数；可信 Rust **25／25**（16 单元＋9 实际 CLI）和 fmt／clippy 另计。最终 Chrome 8 条流程／4 Bevy＋4 默认 Godot 任务／0 异常，三语 390px 的短标识、JSON 与光标保留分别检查，见[最终浏览器](test-results/runtime-instance-control/browser-final/browser.json)。

[准备资源](test-results/runtime-instance-control/packaged-resources.json)核对桌面 **89**／移动 **68**，内置 Node 实际运行 **10 次离线会话**（4 普通＋4 全局＋2 实例）；移动仅执行 4 个纯模块并准入 10 份真实输出。1668 历史／9 冻结文件原字节保持、当前 126 源码摘要复验，旧120中96未变／24按范围改动；8 个新生成目录清理释放 2404941824 字节／约 **2.240 GiB**，三代可信 Bevy 缓存保留。证据不代表实时、运行组件修改、Bevy 图形、作者 Rust、Tauri 新安装或 Android 执行／界面验收。

上一轮全局有限控制结果集中于[上一轮有限控制记录](test-results/runtime-control-replay/results.json)，不修改旧报告。应用 **1746／1746**、0 失败／跳过／取消，385 JS／API／0.0.7 版本通过；新增 39（纯控制 15、实际后端 8、宿主／UI 12、CLI 4）已计入全量。相关专项为 pure 36／36、engine 32／32、host／UI 47／47、CLI 4／4；升级可信 Bevy Rust **20／20** 及 fmt／clippy 另计。Chrome 8 流程／4 Bevy＋4 默认 Godot 服务任务／0 异常，准备资源桌面 89／移动 68、8 次离线普通／控制会话与 4 个移动纯模块。1612 历史／9 冻结文件原字节保持；源码指纹、环境与该轮临时产物清理以该轮记录为准。代表分数／斜向样例按 **0.0001 坐标单位**容差比较，不能推广为任意浮点过程逐位相等。

## 运行对象观察

[运行对象](RUNTIME_OBJECTS.md)的普通观察消费既有 plan／runtime 1／2／3，不升级作者格式或改运行脚本。纯观察专项核对完整身份集合、生命周期、位置采样失效、来源权威、分离输出、AND 查询与数据预算；宿主专项核对只在冻结验证后建立视图、原始事件环淘汰、严格 inspect 白名单、当前任务／服务归属、响应隔离，以及取消／超时／错误保留最后样本。界面核对最新场景／后端／构建／快照归属、本地检索、迟到导航、名称安全文本、中英日标签和草稿／光标保护。

```sh
node --test scripts/tests/scene-runtime-query.test.mjs \
  scripts/tests/scene-runtime-query-ui.test.mjs
VIENTO_BEVY_BIN=/绝对路径/viento-bevy-runtime \
  VIENTO_GODOT_BIN=/绝对路径/Godot可执行文件 \
  node --test scripts/tests/scene-runtime-query-host.test.mjs
```

必须配置实际两个工具后再记录宿主成功／跳过数：Godot／Bevy 分别执行同一 plan 1／2，Godot 单独执行行为协议 3；另核对 CLI 离线回放、真实取消、作者与原构建字节。Chrome 和准备资源检查另列；移动只能复用纯观察，未接运行对象 UI 或执行器。运行对象首轮的数字、环境与清理统一保存于[运行对象验证目录](test-results/runtime-object-inspection/results.json)，已有后端接入报告保持当时条件。

运行对象首轮应用 **1707／1707**、0 失败／跳过，378 份 JavaScript 及 API／版本预检通过；新增 34（纯观察 15／宿主 8／UI 11）已计入，UI 新旧专项合计 45／45。实际 Chrome 7 条流程、3 Bevy＋3 默认 Godot 服务任务、0 异常；准备资源 86／67，四次同计划离线观察／查询一致，移动只执行三个纯模块。1581 历史／9 冻结字节保持、109 源码摘要复验；7 个临时目录回收 1.828 GiB。此前 Bevy Rust 14 项属于首轮工具证据，该轮复用该二进制，不重复计作新 Rust 验收。

## Bevy 第二后端

[Bevy 指南](BEVY_BACKEND.md)在 0.0.8 纳入源码的切片使用固定 Bevy 0.19.1 的真实可信程序，消费与 Godot 相同的无图 plan 1／2。先构建 `crates/viento-bevy-runtime/`，把 `VIENTO_BEVY_BIN` 指向其绝对路径；Cargo 目标目录放在工程之外，获取依赖后使用锁文件离线重建。仅 JavaScript 夹具或描述符不能代替 Bevy 工具验收。

```sh
CARGO_TARGET_DIR=/tmp/viento-bevy-prototype-target \
  cargo test --manifest-path crates/viento-bevy-runtime/Cargo.toml --locked --offline -j2
VIENTO_BEVY_BIN=/绝对路径/viento-bevy-runtime \
  node --test scripts/tests/bevy-adapter.test.mjs scripts/tests/scene-runtime-events.test.mjs
VIENTO_BEVY_BIN=/绝对路径/viento-bevy-runtime \
  VIENTO_GODOT_BIN=/绝对路径/Godot可执行文件 npm run check -- --app-only
```

核对同一定义的两个实例保留不同身份，固定 0.25 秒受控右向输入只移动 `controls: "arrows"` 的实例，释放后状态回到 `idle`。运行事件必须匹配冻结身份、完整演员集合、有限数值、协议和生命周期；伪造实例／定义配对、额外字段、重复 ready、结束后事件及帧预算均拒绝。无头输入不证明实体键盘或图形渲染。

宿主集成另检查旧中立计划与显式后端检查的区别、旧 `--godot` 别名、Bevy 版本／工具 SHA、离线冻结回放、产物修改、取消／超时及源工程原字节。Bevy 缺 `image`、不接受 GDScript plan 3、禁用窗口／截图；HTTP 不得因新增宿主选择而接收工具、后端代码或磁盘路径。桌面资源副本能加载适配器不表示安装包已带 Bevy 二进制；移动仅复用纯事件规则，没有引擎执行器。

Bevy 首轮接入结果统一保存在[Bevy 首轮记录](test-results/bevy-backend/results.json)，已有 Godot、行为绑定、编辑核心和历史报告保持原条件。应用、可信 Rust 程序、浏览器与打包验证分别报告；没有重新发布安装包或验收 Android 引擎运行。

该轮最终应用 **1673／1673**、0 失败／跳过，最终 373 份 JavaScript 语法及 API／版本预检通过（初次全量为 372，补入浏览器脚本后补查）。新增 25 项（中立事件 6、适配器 13、宿主 6）已计入全量；可信 Bevy 程序另有 Rust 14 项（9 单元＋5 CLI）。Chrome 5 条流程／3 Bevy 任务＋1 默认 Godot 计划、0 异常。准备资源核对桌面 84／移动 65 份文件；内置 Node 24.20.0 与两引擎的 plan 1／2 共四个离线会话一致，移动仅构造／执行两个纯模块并准入实际输出，不构成 Android 引擎或设备验收。具体事实见[运行程序证明](test-results/bevy-backend/runtime-proof.json)、[浏览器](test-results/bevy-backend/browser/browser.json)与[打包记录](test-results/bevy-backend/packaged-resources.json)。

## 场景实例行为

[行为指南](SCENE_BEHAVIORS.md)在 0.0.8 纳入源码的功能单独验证可移植清单、包依赖、冻结宿主、真实 Godot 和界面。计划 3 仅对明确选择行为清单的场景启用；旧无行为计划／生成器摘要和静态预览必须保持。最终证据见[行为运行记录](test-results/scene-behavior-runtime/results.json)，旧预研报告仅证明当时的独立探针。

最终应用 **1648／1648**、0 失败／跳过，365 份 JavaScript 及 API／版本预检通过。新增 55 项（纯规则 17、包 10、Godot 行为 12、UI 6、宿主 10）已计入全量；Godot 新旧适配器 23、相关 UI 67 与全量重叠。Chrome 5 条流程、8 个任务、0 异常；本轮没有另做图形窗口或安装／设备验收。实际打包核对桌面 81／移动 64 份文件，内置 Node 24.20.0 与 Godot 4.7.2 验证离线双事件回放；移动隔离构造并执行 84 个可移植模块，仅证明规则、计划与能力契约。原生辅助程序参与全量，Rust／WASM 未改动，独立 Rust 测试未重复运行。

```sh
node --test scripts/tests/scene-behaviors.test.mjs scripts/tests/scene-behavior-packages.test.mjs \
  scripts/tests/scene-behavior-ui.test.mjs
VIENTO_GODOT_BIN=/绝对路径/Godot可执行文件 \
  node --test scripts/tests/scene-behavior-workflow.test.mjs scripts/tests/godot4-behaviors.test.mjs

# Chrome + HTTP + 实际 Godot；证据目录必须不存在或为空
VIENTO_GODOT_BIN=/绝对路径/Godot可执行文件 \
  VIENTO_BEHAVIOR_TEST_OUTPUT=/tmp/viento-behavior-evidence \
  node scripts/tests/scene-behavior-smoke.mjs /绝对路径/chromium
```

纯规则检查格式、重复键、身份、出向登记边、预算、标量和跨实例引用；包检查实际原文派生依赖、缺项后重算摘要、外部 requirements 与读取屏障。普通保存和完整备份继续保留未完成原文，选择式迁移严格拒绝无效绑定。包内场景不能借未声明的目标角色；外部场景须先被锁定，传递角色再沿其登记边读取并复验。

真实 Godot 核对同一 TXT 两个独立绑定、整数到 float 导出参数、信号签名、身份／事件／生命周期防伪、编译错误与冻结回放。`amount` 为合法标量文本但不符合 float 导出类型时，应在计划和脚本编译通过后由运行反射拒绝，不能把阶段混为一谈。静态预览只返回几何，不负责行为校验。

Chrome 的五条流程完成双实例事件、三语 390px、运行参数字段精确定位、TXT 编译错误行定位及未保存草稿／光标保护；UI 专项检查文本安全与数量显示，不在浏览器执行 GDScript。打包资源和无 Node／DOM 的可移植模块检查另取证，不代表 Tauri 安装、Android 行为界面或移动执行器验收。

## 执行后端中间层

当前[中间层契约](BACKEND_MIDDLEWARE.md)有独立专项，该轮范围见[此前中间层记录](test-results/backend-middleware/results.json)。先核对纯描述符的字段、预算、数据所有权、访问器拒绝和七种独立操作；在无 Node／DOM 全局的隔离环境执行能力模块。宿主专项使用可信替代夹具验证非 Godot 的阶段和文件布局、资源映射、注册身份、产物路径／碰撞／预算以及旧记录和新 `executionAdapter` 指纹回放。夹具只证明接口编排，不宣称第二引擎、GPU 或原生运行。

最终应用 **1593／1593**、0 跳过，357 份 JavaScript 及 API／版本检查通过。新增 45 项为纯契约 15、Godot 适配器 11、宿主 10 和 UI 能力 9；相关 UI／三语 154 项、真实宿主 41 项均与全量重叠。Chrome [4 条真实流程](test-results/backend-middleware/browser/browser.json)分别核对构建／无头、真实窗口取消和关闭重开、源诊断与日文 390px、草稿／光标保护，异常为 0；它不替代新安装包或设备验收。

```sh
node --test scripts/tests/backend-capabilities.test.mjs \
  scripts/tests/backend-middleware.test.mjs scripts/tests/godot4-adapter.test.mjs \
  scripts/tests/backend-capability-ui.test.mjs

VIENTO_GODOT_BIN=/绝对路径/Godot可执行文件 \
  node --test scripts/tests/project-build.test.mjs scripts/tests/project-build-service.test.mjs \
  scripts/tests/project-build-http.test.mjs scripts/tests/build-runtime-protocol.test.mjs
VIENTO_GODOT_BIN=/绝对路径/Godot可执行文件 npm run check -- --app-only
```

Godot 包装适配器必须逐字节核对原 v1／v2 生成文件、脚本、来源映射和历史后端摘要；执行参数、环境与缓存回收也单独验证。真实 Godot 验收需记录版本及平台，核对构建、无头和窗口模式、冻结源工程离线回放、工具／适配器／产物变化拒绝及进程退出。界面专项验证能力分别开放、未知／缺失描述符失败关闭、描述符变化撤销旧计划／产物、后端身份不符和迟到响应；Chrome 实测与三语窄屏另存新目录。

桌面准备和移动准备后核对实际副本摘要：内置 Node 执行新宿主及既有 Godot 场景链路，移动在无 Node／DOM 全局的隔离环境执行纯能力契约。该轮[打包记录](test-results/backend-middleware/packaged-resources.json)检查桌面 74／移动 63 份文件；移动只加载 1 个新纯模块，没有执行适配器、Android 构建服务或 UI 实测。内置 Node 24.20.0 和真实 Godot 4.7.2 完成新构建／无头与缺少 `executionAdapter` 的旧记录回放。新安装包、Tauri 窗口和设备分别验收。所有验证在临时工程完成，历史报告与旧生成器原字节保持。

## 场景片段组合实验

文件内组合使用独立 [recipe 样例](../examples/scene-composition/README.md)，输出已有 v3。首轮纯组合、来源及真实后端执行范围见[组合实验记录](test-results/scene-composition/results.json)；普通文档登记／保存、源码派生依赖及包迁移的后续证据见[配方文档工作流记录](test-results/scene-composition-workflow/results.json)。上述历史记录覆盖已有源码编辑与资源包界面；当前另有已保存／未保存配方预览、贡献来源定位及单实例覆盖原文草稿编辑，验证方法见下节。共享模板编辑、覆盖删除、拖动回写和跨文件事务尚未接入。

```sh
npm run core:test
npm run core:build
VIENTO_STUDIO_CORE_BIN=/绝对路径/viento-core \
  VIENTO_GODOT_BIN=/绝对路径/Godot \
  node --test scripts/tests/scene-composition.test.mjs
node --test scripts/tests/scene-composition-document.test.mjs scripts/tests/scene-composition-workflow.test.mjs
npm --silent run scene:compose -- --input examples/scene-composition/recipe.json --emit bundle
```

原生辅助程序可用 `cargo build --manifest-path crates/viento-studio-core/Cargo.toml --bin viento-core` 构建，显式设置 `VIENTO_STUDIO_CORE_BIN` 指向其产物。分别核对 Rust 单元、原生／WASM 相同请求、CLI 和现有场景规划／构建集成；未配置原生程序或 Godot 时，相关跳过须单独报告。

重点验证稳定显式 UUID 不随重排变化、同一片段多次放置的覆盖隔离、继承字段省略和明确去图、局部位置先覆盖再偏移、组身份及父组重映射、输出顺序、碰撞／循环／超预算拒绝、解码重复键和未知字段拒绝。来源映射须指回模板、放置、身份映射及具体覆盖的 JSON Pointer；显式偏移是额外贡献项，不能声明精确可写范围。CLI 的 bundle 摘要基于输入原字节，标准输出只能包含所选 JSON，输入文件及工程目录保持原样；旧核心缺少可选能力时仍应能使用旧布局操作。

集成测试须在临时工程用正常 `scene.create` 创建生成场景，核对新正文与定义／图片依赖登记，再验证 plan/runtime v2 和真实 Godot。编辑或归档这份已登记的生成场景沿用旧契约，与配方作者文档分别核对。旧场景 v1／v2／v3 计划、源码补丁和布局操作仍须通过原回归。新增证据放入本轮目录，已有报告保持原字节。

文档工作流专项从普通已登记 JSON 创建开始，核对原字节保存、修订冲突、原文改变后的当前依赖及包往返后的身份／展开结果。未使用片段、被覆盖的模板图片、覆盖图片和投影的来源闭包都必须保留，派生依赖不能写入作者元数据。关闭依赖收集时校验带指纹的 requirements；伪造包即使重写 manifest／hash，仍须因删掉真实依赖而在目标写入前被拒绝，目标已存在同 UUID 内容也不能绕过。

同时检查未完成配方可普通保存与完整备份，选择式导出／已登记展开报告错误，修复恢复可用；无效 UTF-8 不被替换解码后当作合法配方。顶层 `format` 删除后按普通 JSON 处理，嵌套样例标记不误判为配方。只读 CLI 分别核对独立文件和 `--root/--object/--revision`，登记模式 bundle 的 origin 与当前 World／源修订对应。原生归档和移动辅助程序需实际构建并显式配置才计入执行，不能用 Node 探针代替目标设备验收。

真实浏览器复验使用现有源码编辑和资源包界面。执行前指定一个尚未包含 `browser.json` 的新证据目录；脚本拒绝覆盖已保存报告：

```sh
VIENTO_COMPOSITION_SMOKE_OUTPUT=/tmp/viento-composition-browser-new \
  node scripts/tests/scene-composition-workflow-smoke.mjs /usr/bin/google-chrome
```

探针只使用临时工程、独立浏览器配置和本机 HTTP 服务，完成普通创建／源码编辑保存、依赖自动选择、真实下载、日文目标预览和确认导入。检查原文、元数据、对象／素材 UUID、图片字节、重建索引、界面错误面板及 Runtime 异常。最终[浏览器记录](test-results/scene-composition-workflow/browser/browser.json)及同目录截图只证明这些既有界面承载普通配方文档；不是专用配方预览或覆盖编辑验收。

### 已保存与未保存配方预览

配方预览使用独立纯引擎、宿主和 UI 专项；不修改原配方规则或 Rust 协议。最终执行范围见[本轮结果](test-results/scene-composition-preview/results.json)，引擎日志见[只读模型专项](test-results/scene-composition-preview/engine.log)，实际 Chrome 流程见[浏览器记录](test-results/scene-composition-preview/browser/browser.json)，打包副本与移动隔离模块验证见[资源记录](test-results/scene-composition-preview/packaged-resources.json)。

```sh
node --test scripts/tests/scene-composition-preview.test.mjs \
  scripts/tests/scene-composition-preview-host.test.mjs \
  scripts/tests/scene-composition-preview-ui.test.mjs
VIENTO_COMPOSITION_PREVIEW_OUTPUT=/tmp/viento-composition-preview-new \
  node scripts/tests/scene-composition-preview-smoke.mjs /usr/bin/google-chrome
```

浏览器输出目录必须为空，探针拒绝覆盖已有证据。它通过本机 HTTP 和独立 Chrome 配置打开临时已登记配方，核对已保存／未保存原文的画布和大纲、图片真实像素、来源选区与只读入口；同时检查无效草稿、外部保存冲突、迟到响应、返回保存画面时保留编辑草稿，以及中英日 390px 窄屏。模板声明、单实例身份、覆盖位置、偏移、场景标题和组名都执行实际源码导航；原始作者文件与元数据前后保持一致，SVG 不得执行脚本或发起外联。

引擎专项核对 workspace v2／v3 中的 recipe v1：投影继承的复合尺寸和独立轴来源保持原修订；偏移与覆盖为独立精确贡献项，主合成位置为近似范围。标题、视口、背景、组父身份及诊断全部指向配方原字节，不能泄露生成 `/actors/N`、`/groups/N` 路径或范围。全部声明依赖在展开前检查，未知字段、解码重复键、缺失定义、错误图片类别、自引、嵌套和未使用片段错误均不给部分模型。深度冻结输入仍可预览，输出不暴露内部观察、`sceneEditing` 或可执行 snapshot。

宿主专项继续核对源观察前后修订、图片大小／摘要、并发变更拒绝及缓存释放。预览清单与构建 Scene2D 清单分开；配方不能创建构建任务，Scene2D 原有快照、草稿和布局链路仍须通过回归。这些证据覆盖本机编辑服务，不表示配方覆盖写回、Tauri 新安装或 Android 设备接入。

### 单实例局部覆盖与普通保存

局部覆盖使用独立可选的核心操作，不改变 recipe、World 或原展开协议。最终[结果](test-results/scene-composition-overrides/results.json)记录应用 1548／1548、0 跳过、350 份 JavaScript 语法检查和 Rust 75 项；新增 54 个应用测试已计入全量，不重复相加。核心桥接 12 项含 55 次真实原生／WASM 对照和 17 类坏回执；纯提案 12、主编辑器新增 8、父控制器 6、界面新增 16 均通过。专项分别检查 Rust 原文补丁、桥接回执、纯提案、主编辑器应用、父预览会话及三语界面；真实浏览器单独使用临时工程，不能把 DOM 测试或打包模块执行当作安装／设备验收。

```sh
npm run core:test
npm run core:build
VIENTO_STUDIO_CORE_BIN=/绝对路径/viento-core \
  node --test scripts/tests/studio-core-composition-patch.test.mjs
node --test scripts/tests/scene-composition-overrides.test.mjs \
  scripts/tests/scene-composition-overrides-host.test.mjs \
  scripts/tests/scene-composition-overrides-bridge.test.mjs \
  scripts/tests/scene-composition-overrides-ui.test.mjs
VIENTO_COMPOSITION_OVERRIDES_OUTPUT=/tmp/viento-composition-overrides-new \
  node scripts/tests/scene-composition-overrides-smoke.mjs /usr/bin/google-chrome
```

浏览器输出目录必须为空，不覆盖旧证据。原生／WASM 对照需显式提供新核心原生程序；缺失时跳过必须单独报告。检查六类字段 set 的确定顺序、偏移前坐标、仅实际改字段写入、投影继承与明确去图、同一片段不同放置隔离，以及数组重排后稳定目标。三种插入分支分别为缺字段、缺演员覆盖、缺覆盖数组；替换与插入均需保留 BOM、CRLF、字段顺序、未改空白和数字 token。输入和输出各 128 KiB、完整原文前后校验、无状态操作不占历史槽、旧核心无新能力仍可使用原能力均需覆盖。

桥接测试伪造回执中的另一演员／放置、共享模板、身份或其他字段变化，以及错误／乱序路径、非法原文与解码重复键；坏回执关闭运行时，合法输入错误不关闭。纯提案与主编辑器检查摘要、保存基线、稳定目标、精确回执复算，以及异步等待期间输入被修改、旧提案重放和晚到焦点。来源贡献、生成坐标和预览结果不能冒充可写范围。

真实流程应从当前原文的有效预览打开“编辑此实例覆盖”，检查完整候选和实际图片，应用后确认只有内存草稿改变，再执行普通保存和重开；配方资源包迁移继续沿用文档工作流回归。同时验证取消、未改字段不取消继承、无效数字／缺依赖图片不能应用、外部保存冲突、检查后源码变化及迟到响应；中英日窄屏保留表单内容。本轮[Chrome 记录](test-results/scene-composition-overrides/browser/browser.json)完成 6 条流程和 11 次预览捕获，Runtime 异常／SVG 外联为 0；普通保存仅改变配方正文，元数据和图片保持原字节。资源包往返的历史证据仍见上面的文档工作流，不把本轮浏览器流程算作新增迁移实测。[打包记录](test-results/scene-composition-overrides/packaged-resources.json)核对桌面 68／移动 64 份文件，内置 Node 与移动无 Node 全局的 110 个隔离模块执行新覆盖助手及旧能力；覆盖后 89 个配方位置逐项核对。共享片段编辑、删除覆盖／恢复继承、配方拖动回写、多文件事务和目标设备界面不在本轮范围。

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

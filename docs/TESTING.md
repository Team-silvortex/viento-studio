# 验证指南

**0.1.3 源码交付**收录下列五项 0.1.2 工作树开发专题。[本版发布预检](test-results/release-0.1.3/preflight.json)记录版本／源码归档回归 **8／8**、**814** 个应用 JS 及 **2** 个桌面脚本语法／API 检查、真实 `target` 缓存排除探针，以及 **37 项准备字节比对／7 项复制模块调用**。本次不重跑功能全量；专题日志、截图、计数和来源指纹保持原样，不把开发验收重标为新版功能重跑。交付边界见[版本记录](RELEASE_0.1.3.md)。

新增[场景声音验收](test-results/scene-audio/README.md)：严格 Rust／WASM／原生规则、保真字段编辑、冻结 PCM16 WAV、来源诊断、独立协议和工程迁移。完整应用 **4920 项（4807 通过／113 条件跳过／0 失败）**、**814 个 JS**；共享 Rust **334／334**，真实 Godot 声音 **11／11**，Chrome **4 组／10 图**，准备资源 **37 项比对／7 项调用**。真实引擎另验混音 PCM、零音量、循环、停止及双精度时间边界；浏览器完成取消、保存、三语与 ZIP 异地重建。条件跳过和各层证据分别记录，专项与全量不累加；不代表物理扬声器、新安装或 Android 声音验收。

新增 [Bevy Rust 固定步验收](test-results/bevy-rust-fixed-step/README.md)：自身实例位置、固定步顺序、回调失败回滚、累计事件预算和旧就绪脚本兼容。完整应用 **4859 项（4751 通过／108 条件跳过／0 失败）**、**799 个 JS**；真实 Rust 模板 17／17，实际 Cargo 固定步 16／16（19 场景）及旧生成器 8／8，Chrome 7 组流程含原样移动模板与 ZIP 异地重建。准备资源 31 项比对／8 项调用。专项与全量重叠；Linux 有限无头结果不代表窗口、GPU、Android 或新安装验收。

新增 [Bevy Rust 行为验收](test-results/bevy-rust-behaviors/README.md)：独立适配器工具身份与取消边界、Cargo 原文诊断、固定 Bevy ECS／就绪接口、共用中立事件，以及真实浏览器创建、编辑、运行、ZIP 异地重建。完整应用 4858 项（4751 通过／107 条件跳过），797 个 JS；独立实际 Cargo 和浏览器、Godot 回归与准备副本分别记证据。当前未更新安装，不扩大到图片／窗口／GPU 或 Android 执行。

新增[已有行为脚本引用验收](test-results/scene-behavior-links/README.md)：单快照目录、固定关系请求、完整回执、鉴权、取消／未知提交和独立编辑交接。真实流程使用 `VIENTO_GODOT_BIN=/可信/Godot路径 node scripts/tests/scene-behavior-links-smoke.mjs /usr/bin/google-chrome`，复制示例并创建第二脚本，关联后新增第三绑定，普通保存、Godot运行及ZIP异地导入。完整应用4806项（4700通过／106条件跳过）、790个JS；桌面Rust59通过／1忽略；准备资源另留证据，不代表安装窗口或Android设备。

新增[首次多绑定行为验收](test-results/scene-behavior-multi-create/README.md)：独立纯规划与界面、真实 Workspace v2／v3 事务、脚本并发变化和路径占用保护；实际脚本为 `VIENTO_GODOT_BIN=/可信/Godot路径 node scripts/tests/scene-behavior-multi-create-smoke.mjs /usr/bin/google-chrome`。本轮完整回归 4727 项（4621 通过／106 条件跳过）、781 个 JS；真实浏览器的第二脚本创建、三绑定、三语窄屏、Godot 事件及工程交付另留独立证据，不增加安装或设备声明。

**0.1.2 发布检查**单独保存在[发布预检](test-results/release-0.1.2/preflight.json)，验证版本、源码归档、JavaScript 语法、API 契约及本次退出保护修复。下列 4698 项完整回归运行于升版前 0.1.1 工作树，保留其原始版本、指纹和条件；本次不将历史结果改标为新版重跑。

新增[起始排布验收](test-results/scene-composition-create-layout/README.md)：纯位置规划检查横排／竖排／网格、预算、原子越界拒绝，界面检查显式预览／应用、精确一次撤销及过期保护，普通宿主检查保存内容保留身份和继承。真实脚本为 `node scripts/tests/scene-composition-create-layout-smoke.mjs /usr/bin/google-chrome`，需设置可信 `VIENTO_GODOT_BIN`。本轮完整应用 4698 项中4592通过、106条件跳过；8组真实流程和准备副本另记，不代表安装或Android设备。

新增[多演员配方专题](test-results/scene-composition-multi-create/README.md)：在同一创建核心／UI／宿主测试中追加多演员、重复引用、身份冲突、未完成坐标与整体保存；旧单演员请求继续回归。真实脚本为 `node scripts/tests/scene-composition-multi-create-smoke.mjs /usr/bin/google-chrome`，需设置可信 `VIENTO_GODOT_BIN`。本轮 4676 项中 4570 通过、106 条件跳过，另有三演员真实 Godot 与准备副本记录；不替代旧专题，也不计为新安装验收。

新增[配方创建验收](test-results/scene-composition-create/README.md)：专项覆盖纯候选、只读目录、HTTP、独立表单、普通草稿／保存与模块门槛；可运行 `node --test scripts/tests/scene-composition-create*.test.mjs`。设置 `VIENTO_GODOT_BIN` 后运行 `node scripts/tests/scene-composition-create-smoke.mjs /usr/bin/google-chrome`，实际从空工程 GUI 创建 OC、投影、配方，再生成 Scene2D 并运行 Godot。完整应用 4653 项中 4547 通过、106 条件跳过；浏览器 6 组与准备资源分别记录。首次完整回归的 7 个旧目录计数断言已按 20 模块／37 能力更新；没有弱化端口隔离断言。新助手尚未重新安装，不将本次浏览器结果合并为上一轮安装结论。

[0.1.0 源码交付](RELEASE_0.1.0.md)汇总当前主线及其验证时序；[本版发布预检](test-results/release-0.1.0/preflight.json)完成8项版本／源码归档回归与647文件语法／API检查。下列专题及旧版发布检查继续保留当时版本、来源摘要及平台边界。源码发布不重标历史日志，也不等于新安装包或 Android 设备验收。

新增[3D 初步接入验证](test-results/scene3d-primitives/results.json)分别检查独立作者格式、Rust／WASM、GPU API 预览、原文会话守护及 Godot 导出／有限无头实测，旧 2D 路径另行回归。实际图形后端、准备副本和工具环境在本轮证据中记录，不能扩大为安装或设备结论。

新增[片段重命名专题](test-results/scene-composition-fragment-rename/results.json)验证 Rust 独立可选能力、原始值 token 保真、全部放置引用更新、完整候选来源、旧三动作兼容、实际浏览器保存重开及桌面／移动准备副本。专项与全量重叠；真实失败和修正均保留新日志，旧证据和示范作者文件不改。本轮不代表安装窗口或 Android 设备验收。

片段定义新增、CST 复制与未引用移除的验证另保留[独立记录](test-results/scene-composition-definition-authoring/results.json)。专项核对原文保真、声明预算、删除引起的来源路径变化、全部既有实例／组织语义及普通保存；真实浏览器与准备副本分别记录，前轮八入口历史保持原条件。

组织分组新增、改名／改父级、演员归组和空叶组移除的验证另保留[独立记录](test-results/scene-composition-group-authoring/results.json)。专项、原生／WASM、真实浏览器、完整应用与准备副本分别记录；前轮放置管理及七入口历史保持原条件，该轮八个配方编辑入口没有新增安装或设备验收。

## 整份配方放置管理

新增、复制、移除分别检查原文保真、全演员／组身份、声明缺省、最终展开预算及旧接口拒绝跨域操作。纯提案和完整候选／工作流专项检查过期来源、伪造回执及删除原选中演员；真实浏览器检查取消、审阅、普通保存和重开。原生与 WASM 为同一共享 Rust 规则，完整应用、准备副本与浏览器日志分别存于[独立记录](test-results/scene-composition-placement-structure/results.json)，不替代桌面安装或 Android 设备验收。

## 系统装配与模板需求

系统注册／规划、GUI 装配和声明采用的专项分别见 `scripts/tests/studio-modules.test.mjs`、`studio-system-ui.test.mjs` 和 `studio-profile-project.test.mjs`。最后一组的原生备份往返需提供 `VIENTO_MOBILE_STORE_BIN`；原生模板及未来声明读取测试在桌面 Rust `--lib` 集合。新增配置严格拒绝坏声明，已有未来声明继续保留与普通编辑；实际浏览器证明和 prepared 副本核对见[本轮证据](test-results/studio-system-modules/results.json)。3D、动态插件和 Android 设备不在本轮验收中。

本轮[后端工程持久恢复验收](test-results/backend-project-catalog/results.json)验证成功登记、跨服务只读恢复、明确选择后的运行／控制／用例／验收组对接，另检查损坏索引、并发写入、目录／清单替换、关闭与过期选择、旧工程保留和三语界面。固定 Node **24.20.0** 的完整应用 **2504／2504**（491 个 JavaScript、API／版本预检，0 失败／跳过／取消／todo）与新增专项 **65／65**（索引 15、服务 10、独立边界 14、控制器 15、父集成 11）通过；这些用例包含于本轮完整应用，不与旧回归总数相加。真实 Godot／Bevy 四种工程均经过重启／离线运行，两个实例场景另完成四步控制、三项断言、两成员验收组及四份成员报告。首轮实例夹具误用禁用输入的示范演员，仅新夹具显式声明 arrows 后通过；原失败证据保留。浏览器发现手动刷新命中目录缓存，已改为强制读取并增加父控制器回归；独立故障注入发现临时发布文件消失导致宿主锁未释放，已在任何临时清理结果下释放自己拥有的锁，原索引精确保持且后续更新成功。共享 Rust／WASM 和后端生成器／运行协议未改，新行为只在 Node 宿主与三语 GUI，对应安装窗口／Android 执行仍未验收。

后端工程管理专项覆盖纯清单、只读检查、CLI 冻结后端工具选择、宿主工程归属、改动保护与三语详情。实际 Godot / Bevy 工具验证与浏览器界面证据分别列在[本轮记录](test-results/backend-project-management/results.json)，不计为新安装版或 Android 设备验收。 本轮全量 2438/2438、零失败和跳过；新增领域最终 86/86 与全量重叠，其中一条失败阶段清理测试在全量启动后追加，另在领域检查中通过。实际工具四种场景、Chrome 五条流程与资源副本 32 组分别报告；共享 Rust／WASM 未改，无新 Rust 测试或设备结论。

本页说明如何选择测试、运行命令和解释覆盖范围。当前功能、发布及安装状态见 [开发状态](STATUS.md)，历次数字和阶段说明见 [历史验证记录](history/VALIDATION.md)。所有常规测试使用独立临时工程。

当前保存状态与异步归属见 [Rust 保存工作流验证](test-results/rust-layout-save/results.json) 及 [真实浏览器记录](test-results/rust-layout-save/layout-browser/browser.json)。

此前 Rust 布局草稿／撤销历史见 [验证结果](test-results/rust-layout-history/results.json)、[多选与生命周期实测](test-results/rust-layout-history/selection-browser/browser.json) 和 [保存失败／冲突实测](test-results/rust-layout-history/layout-browser/browser.json)。

最新多选与批量布局见 [场景多选结果](test-results/scene-selection/results.json) 和 [浏览器记录](test-results/scene-selection/browser.json)。前一轮布局编辑回归见 [场景布局结果](test-results/scene-layout/results.json) 与 [真实浏览器记录](test-results/scene-layout/browser.json)。此前的 [场景预览结果](test-results/scene-preview/results.json) 和 [浏览器证据](test-results/scene-preview/browser.json) 覆盖完整应用检查与 Chrome 静态画布；[场景编辑结果](test-results/scene-edit/results.json) 保留原生归档／移动存储往返和真实 Godot 运行证据。此前的 [OC 投影结果](test-results/oc-projections/results.json) 还保留当时的桌面 Rust 检查。通过／跳过／忽略数及源码、安装包与设备的区别统一列在 [当前状态](STATUS.md#验证边界)；各轮原始报告保持当时的条件。

## 独立场景创作流程与宿主接口

[创作接口说明](SCENE_AUTHORING.md)区分纯候选、注入工作流、浏览器连接、各独立表单及原文宿主。[本轮完整证据](test-results/scene-authoring-workflow/results.json)以固定 Node **24.20.0** 完成 **2629／2629** 全量和 **506** 个 JavaScript／API／版本预检，均无失败、跳过、取消或 todo；新增候选 **15**／工作流 **31**／接线 **5** 共 **51** 项，含旧编辑回归的 **388** 项与全量重叠。重点检查同源归属、await 前输入快照、迟到／重叠请求、恶意 JSON 数据、临时预览释放、合法令牌推进、私有回执、关闭与跨区重放；六个子 UI 保留独立审批及历史。

真实 Chrome 六个入口共 **37** 条回归通过，记录在[浏览器汇总](test-results/scene-authoring-workflow/browser-regression.json)；**9** 张六入口及中英日窄屏代表图已目视。已有 smoke 脚本原字节复用，各脚本的输出环境变量指定新空目录，不能覆盖旧证据。桌面／移动[准备副本](test-results/scene-authoring-workflow/packaged-resources.json)各在标准 VM 实际加载 **86** 本地模块／保留 WASM，执行 **12** 新流程组与 **28** 旧组，共 **80** 组；库存 **529／216／11** 文件和 **610** 冻结源码一致。无 Node、DOM 或 fetch 全局的执行证明模块可移植，不是恶意代码隔离或设备验收。

首轮旧专项 **336／337** 唯一失败是强制实例属性和画布共用同一函数引用；新架构改为独立函数，并保留双方完整 POST、DELETE、原文载荷和零应用断言，见[契约审查](test-results/scene-authoring-workflow/old-test-contract-review.json)。新候选初次错误投影尺寸只修夹具，初次日志保留。Rust／WASM 和实际源编辑／普通保存宿主未改，Rust 只为全量重新构建原生辅助工具，没有宣称重跑独立 Rust 套件或安装／Android 编辑设备实测。

可单独运行 `node --test scripts/tests/scene-authoring-*.test.mjs`，完整应用仍使用本页常规命令。只测试回调桩不能代替原文宿主的最后核对、真实预览依赖或普通保存回归。

## 功能图谱与证据核对

[当前功能图谱](FUNCTION_ATLAS.md) 为架构、功能、实现与四项成熟度提供离线筛选，完整映射旧图的 F01–F50。检查命令 `node scripts/function-atlas.mjs --check` 验证坐标、引用文件、指纹、评分门槛及派生视图一致性；它不运行产品测试，也不证明评分或测试覆盖率。引用文件改变后需人工重审相关条目，再显式运行 `node scripts/function-atlas.mjs --write --refresh-sources`。旧报告只适用于其原条件。

## 0.0.9 源码发布检查

[本版发布候选](test-results/release-0.0.9/results.json)以固定 Node **24.20.0** 重新执行应用 **2017／2017**，0 失败／跳过／取消，**430** 个 JavaScript 文件及 API／版本检查通过。两个实际引擎和本轮新构建的核心、归档／移动存储辅助程序参与回归；版本／源码打包规则专项 **7／7** 已包含在应用总数内。独立 Rust 测试、Chrome、Tauri 窗口和 Android 设备未在本轮重跑。

[完整准备清单](test-results/release-0.0.9/prepared-manifests.json)核对桌面 **511**／作品库 **11**／移动 **201** 份文件，[准备模块执行](test-results/release-0.0.9/packaged-resources.json)另核对重点源码 **125／79** 份。Godot／Bevy 得到 **5** 份批次回执、**9** 个真实会话与 **9** 份独立成员报告，含断言失败继续和 **4** 次作者来源及构建清理后的回读。实际取消保留 **64／64** 步样本，执行为取消、评价为未完成；不据此宣称在引擎步骤中途截断。移动仅运行隔离纯模块，**18** 接受／**10** 拒绝，不代表 Android 执行。

[临时源码归档](test-results/release-0.0.9/source-archive.json)在最终发布审计元数据之前生成，逐项回读并核对源码、两独立 crate、官方样例和排除规则，验收后删除；不重标为最终提交 ZIP。旧专题原始证据与冻结后端／WASM／Rust 源码按原条件保留。本轮先前资源检查准确拒绝一次准备副本与更新后文档的摘要差异；重新准备后通过，初次失败日志保留。下列开发专题记录保持当时版本与范围。 最后清理一处新增文件末尾空行，语法与相关 **31／31** 专项通过，见[严格单字节格式记录](test-results/release-0.0.9/final-formatting.json)；全量／准备／归档仍标记为格式清理前的候选，最终摘要另列。

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

## 成员详情与报告导出（未发布）

[成员报告](RUNTIME_CASE_REPORTS.md)专项覆盖完整重新评价、上下文／终态／身份／Unicode／预算、真实文件 pin、符号链接与读取中替换、独占发布与自身清理、前面失败成员独立、运行中只读、取消采样前缀、预会话失败、保存失败保留断言、作者及构建离线、当前任务与服务关闭竞态、明确鉴权、三语和显式下载。

```sh
node --test scripts/tests/runtime-case-report.test.mjs \
  scripts/tests/runtime-case-reports-host.test.mjs \
  scripts/tests/runtime-case-report-service.test.mjs \
  scripts/tests/runtime-case-report-ui.test.mjs \
  scripts/tests/project-build-http.test.mjs
```

本轮完整应用检查 **2017／2017**，0 失败／跳过／取消，**430** 个 JavaScript 文件与 API／版本预检通过；新增 **55** 项已包含在全量，定向重复不累加。真实 Chrome **6** 流程、**5** 个唯一任务，中英日 390px、成员详情与显式 JSON 下载通过，作者原字节、编辑草稿和光标保留。准备资源使用固定 Node 24.20.0，核对桌面 **511**／移动 **201** 文件，重点源码 **125**／**79** 份；Godot／Bevy 两个实际后端的报告执行与独立回读见[准备资源记录](test-results/runtime-case-reports/packaged-resources.json)。移动仅执行隔离纯模块，不代表 Android 报告宿主或引擎执行。

新增 55 项为纯报告 12、文件宿主 18、服务／调度 13、界面 11 和真实 HTTP 1，均在应用总数内。初次定向 67 项中 66 通过、1 个新 UI 测试夹具缺少既有路径常量而失败，修正夹具后冻结测试；不当作产品缺陷。新 UI 另增加当前成员评价／计数绑定，拒绝内部自洽但与当前成员不符的报告。 实际初次窄屏截图另发现英文标题被关闭按钮挤窄，随后只用一条窄屏 CSS 规则让标题占整行；保留原浏览器功能通过记录、截图和下载，最终界面重新实测。准备探针在修改期间准确拒绝混用的 CSS 指纹，未启动引擎，最终资源重新生成。

1945 份历史证据、9 份冻结后端／WASM、19 份 Rust 源码及 520 份最终产品／测试摘要核对。使用本轮新构建的原生辅助程序完成应用检查，未重跑独立 Rust 测试或准备探针中的原生完整归档迁移。只清理初始不存在的 7 个本轮生成目录，回收 **1.831 GiB**，既有作品、工具、偏好和安装保留；源码仍为 0.0.8 未发布工作树。 最终浏览器和资源证据与相同产品摘要绑定，完整执行边界见[本轮结果](test-results/runtime-case-reports/results.json)。

## 有序验收组工作流（未发布）

[验收组](RUNTIME_CASE_SUITES.md)复用已保存用例和已有无头会话。专项检查严格四字段／唯一顺序、共享场景准入、联合预算、精确 BOM／CRLF 保存、版本与发布保护、一次捕获、准入期间构建清理、每成员冻结身份、断言失败继续、取消等待退出、总截止、独立回执、包要求与路径迁移。

```sh
node --test scripts/tests/runtime-case-suite.test.mjs \
  scripts/tests/runtime-case-suite-host.test.mjs \
  scripts/tests/runtime-case-suite-packages.test.mjs \
  scripts/tests/runtime-case-suite-ui.test.mjs \
  scripts/tests/project-build-http.test.mjs
```

上一轮有序验收组应用检查 **1962／1962**，0 失败／跳过／取消，**423** 个 JavaScript 文件与 API／版本预检通过；新增 **60** 项已计入全量。真实 Chrome 8 流程、5 个唯一任务、中英日 390px 与草稿／光标保护通过。准备资源使用固定 Node 24.20.0，核对桌面 **508**／移动 **199** 文件，重点源码 **122**／**77** 份；Godot／Bevy 2 次原生完整迁移、**8** 份批次回执和 **18** 个真实会话，含通过、断言失败继续、UUID／路径 CLI 与捕获后源离线。移动仅 3 个纯入口／81 个依赖模块、22 接受／8 拒绝，不执行 Android 引擎或作者宿主。

新增 60 项由纯规则 14、作者／调度宿主 17、资源包 14、界面 14、HTTP 1 组成，已包含在应用总数，定向重复执行不再累加。准备 desktop archive 只核对标准工程数据根；样例根 README 不属于归档数据。Chrome 的 7 份新登记文档产生 14 份新正文／元数据，原作者文件保留。

1866 份历史证据、9 份冻结后端／WASM、19 份 Rust 源码及 513 份最终产品／测试摘要核对；未重跑独立 Rust 测试。只清理初始不存在的 7 个本轮生成目录，回收 **1.829 GiB**，既有工具、作品、偏好与安装保留。首次包读取缺陷、浏览器模块依赖 404 和初次全量失败均保留原日志；修复后的最终证据绑定同一源码。 最终模块图还验证 GUI 轻量契约不引入 YAML／Node 依赖，HTTP 的既有私有模块边界保持。复现和保留的初次失败见[本轮记录](test-results/runtime-case-suites/results.json)。

## 工程验收文档工作流（未发布）

[用例文档](RUNTIME_CASES.md#工程内保存与迁移未发布增量)新增纯包装、fresh 作者目录、版本保护写入与稳定身份迁移。原运行 case 与 trace 保持。定向检查包括：包装格式／UTF-8／重复键及实例预算、BOM／CRLF 无改动保存、正文与场景外部冲突、发布前变更拒绝、创建登记撤回、无配置工具时的作者写入鉴权，以及源工程离线后已载入用例对同场景冻结构建的重跑。

```sh
node --test scripts/tests/runtime-case-document.test.mjs \
  scripts/tests/runtime-case-documents-host.test.mjs \
  scripts/tests/runtime-case-packages.test.mjs \
  scripts/tests/runtime-case-documents-ui.test.mjs \
  scripts/tests/project-build-http.test.mjs
```

资源包另验证多个用例共享场景的去重、选择依赖／子内容开关、包含场景但锁定定义要求、校验正确但删除依赖声明或引用错误实例的包拒绝、目标场景在预览后改变时不发布、v3 `documents/` 向合法 v2 `design-data/` 路径迁移保留 UUID 和原字节。完整工程包仍保存尚未修复的原文，不从选择式迁移的严格语义推导删除作者数据。

真实 Chrome 单独使用临时工程，检查明确保存／载入、取消替换、冲突保留及另存、运行通过／失败、关闭重开与作者草稿守护，中英日 390px。准备资源用固定内置 Node 执行同一保存文档在 Godot／Bevy 的离线用例，再使用原生归档辅助程序回读原文和身份；移动只构造纯模块并核对包装与冻结计划，不执行引擎或作者服务。复现脚本与限定结果见[本轮记录](test-results/runtime-case-documents/results.json)。

上一轮保存文档的冻结检查 **1902／1902**、0 失败／跳过／取消，412 JS／API／0.0.8 预检通过。新增 48（纯包装 11、作者宿主 9、资源包 13、用例界面 14、HTTP 1）已计入全量；界面定向 48／48 包含新 14 与旧 34，不能再次相加。最终 Chrome 6 流程／三语 390px／6 唯一任务／0 异常，保存及外部冲突只新增两份正文与两份登记，原 8 份作者文件原字节不变。

最终准备资源核对桌面 502／移动 196 文件，重点源码 116／74 份；固定 Node 24.20.0 与 Godot／Bevy 分别保存并载入 BOM／CRLF 包装，原生完整归档导入后核对标准工程数据根的全部字节和 UUID，再对源离线的冻结构建完成通过、单条断言失败及 CLI 包装运行，共 6 会话。样例根 README 不在归档数据根内，原工程全量字节仍在执行前后对照；本轮不据此宣称任意根文件都进入工程归档。移动仅 2 纯入口／79 依赖模块、14 接受／6 拒绝，使用桌面实际采样，不证明 Android 引擎或作者服务。

1814 份历史证据、9 份冻结后端／WASM、19 份 Rust 源码及 502 份最终产品／测试摘要保持；未重跑旧独立 Rust 测试。仅清理本轮初始不存在的 7 个临时目录，回收 **1.831 GiB**，既有工具、作者数据、偏好与安装保留。详见[保存与迁移验收](test-results/runtime-case-documents/results.json)。

## 运行验收用例（未发布）

[运行验收用例](RUNTIME_CASES.md)复用控制 schema 1／2 和旧 trace，只在冻结 plan 2 比较位置／状态。专项覆盖严格分离、预算与实例／步骤目标、显式容差、完整／中断／缺样本区别、持久记录与任务所有权、模式互斥及编辑器文本保留。真实两引擎使用完全相同输入：全部检查通过，再只改变一条预期得到单条断言失败；进程仍成功。源离线回放与作者／产物保真分别检查。

```sh
node --test scripts/tests/runtime-verification-case.test.mjs \
  scripts/tests/runtime-case-host.test.mjs \
  scripts/tests/runtime-case-service.test.mjs \
  scripts/tests/runtime-case-ui.test.mjs \
  scripts/tests/runtime-case-cli.test.mjs \
  scripts/tests/runtime-case-boundary.test.mjs
```

真实 CLI 项沿用 `VIENTO_GODOT_BIN`／`VIENTO_BEVY_BIN` 的可信 Linux 工具，未提供时明确跳过；全量使用两者并提供原生辅助程序。Chrome／准备资源／纯移动模块分别记录，不把它们写成 Tauri 窗口或 Android 执行验收。本轮原始环境与结果见[运行验收记录](test-results/runtime-verification-cases/results.json)；旧工具身份检查和 0.0.8 发布证据保持原条件。

上一轮运行验收用例的冻结回归 **1854／1854**、0 失败／跳过／取消，405 JS／API／0.0.8 版本预检通过，新增 40 已计入全量。Chrome 4 流程／三语窄屏／6 唯一任务，准备资源共 6 个双引擎离线会话；移动只执行 2 个纯模块／桌面采样评判。末次保存取消与提交后取消分别回归，先前能力字段兼容回归已修并复核最终源码；历史／冻结／Rust 源字节保持，独立 Rust 75／25 旧报告未重标本轮。临时目录回收 1.829 GiB，详见[最终结果](test-results/runtime-verification-cases/results.json)。

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

### 显式工具身份检查

未发布工具状态／宿主／CLI 回归可独立执行；真实工具测试须显式提供 `VIENTO_GODOT_BIN`、`VIENTO_BEVY_BIN`，旧版拒绝测试另用 `VIENTO_BEVY_OLD_BIN` 指向已有 0.2.0 可信工具，不自动下载或构建：

```sh
node --test scripts/tests/execution-tool-status.test.mjs scripts/tests/execution-tool-probe.test.mjs scripts/tests/execution-tool-cli.test.mjs scripts/tests/execution-tool-probe.integration.test.mjs
node --test scripts/tests/project-build-service.test.mjs scripts/tests/project-build-ui.test.mjs scripts/tests/project-build-http.test.mjs
```

验证边界包括纯 DTO 的无宿主运行、错版与错配拒绝、候选替换、预算和取消回收、GET 不识别、严格 POST、并发／关闭、草稿与已有产物保护。真实工具识别不等于场景执行；本轮另在隔离浏览器和准备资源运行双后端链路，记录见[工具检查结果](test-results/runtime-tool-probe/results.json)。不将移动纯模块验证写成 Android 引擎接入。

## 场景片段组合实验

文件内组合使用独立 [recipe 样例](../examples/scene-composition/README.md)，输出已有 v3。首轮纯组合、来源及真实后端执行范围见[组合实验记录](test-results/scene-composition/results.json)；普通文档登记／保存、源码派生依赖及包迁移的后续证据见[配方文档工作流记录](test-results/scene-composition-workflow/results.json)。上述历史记录覆盖已有源码编辑与资源包界面；当前另有已保存／未保存配方预览、贡献来源定位及单实例覆盖原文草稿编辑，验证方法见下节。0.0.10 源码另接恢复继承、单实例位置画布及独立多实例移动／对齐批次，见下方各专题；共享片段字段、声明恢复、偏移和结构创作已另接独立入口，跨文件事务尚未接入。

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

局部覆盖使用独立可选的核心操作，不改变 recipe、World 或原展开协议。本节保留原 set 专题的条件和数字；0.0.9 发布后恢复继承的新增验证见下一节。原最终[结果](test-results/scene-composition-overrides/results.json)记录应用 1548／1548、0 跳过、350 份 JavaScript 语法检查和 Rust 75 项；新增 54 个应用测试已计入全量，不重复相加。核心桥接 12 项含 55 次真实原生／WASM 对照和 17 类坏回执；纯提案 12、主编辑器新增 8、父控制器 6、界面新增 16 均通过。专项分别检查 Rust 原文补丁、桥接回执、纯提案、主编辑器应用、父预览会话及三语界面；真实浏览器单独使用临时工程，不能把 DOM 测试或打包模块执行当作安装／设备验收。

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

真实流程应从当前原文的有效预览打开“编辑此实例覆盖”，检查完整候选和实际图片，应用后确认只有内存草稿改变，再执行普通保存和重开；配方资源包迁移继续沿用文档工作流回归。同时验证取消、未改字段不取消继承、无效数字／缺依赖图片不能应用、外部保存冲突、检查后源码变化及迟到响应；中英日窄屏保留表单内容。原专题的[Chrome 记录](test-results/scene-composition-overrides/browser/browser.json)完成 6 条流程和 11 次预览捕获，Runtime 异常／SVG 外联为 0；普通保存仅改变配方正文，元数据和图片保持原字节。资源包往返的历史证据仍见上面的文档工作流，不把该浏览器流程算作新增迁移实测。[打包记录](test-results/scene-composition-overrides/packaged-resources.json)核对桌面 68／移动 64 份文件，内置 Node 与移动无 Node 全局的 110 个隔离模块执行新覆盖助手及旧能力；覆盖后 89 个配方位置逐项核对。该历史 set 专题未覆盖恢复继承；当前新增验证见下节。共享片段编辑、配方拖动回写、多文件事务和目标设备界面仍未接入。

### 恢复继承与混合补丁

当前 **0.0.9 发布后未发布工作树**在上述链路加入六字段恢复，独立 edit 能力不更改旧 set／expand 请求。新[验证记录](test-results/scene-composition-inheritance/results.json)与旧证据分开。固定内置 Node **24.20.0** 的[完整应用回归](test-results/scene-composition-inheritance/app-check.log)通过 **2037／2037**、0 失败／跳过／取消，**431** 个 JavaScript 文件及 API／版本预检通过。共享 Rust 原生 **87** 项及 fmt／clippy 通过，最终[专项日志](test-results/scene-composition-inheritance/focused-tests.log)为 **74／74**，含真实原生／WASM 对照；专项已计入全量，不重复相加。准备资源实际范围按本轮结果记录。

本轮[准备资源记录](test-results/scene-composition-inheritance/prepared-resources.json)核对完整桌面资源 **511**、移动资源 **201**、作品库界面 **11** 份文件及重点副本 **80／76** 份。桌面用固定 Node **24.20.0** 执行准备模块，隔离移动环境加载 **111** 个 ESM 模块和真实 WASM；两端各通过相同 **5** 类继承案例，不相加为 10 种功能。覆盖显式清图 `null`、图片恢复、同值恢复、混合 set／reset、六字段恢复删除条目，以及无覆盖的 no-op、作者字节不写和精确提案／回执一致；旧 set／expand／源码与几何能力继续验证。隔离移动环境不包含 Node、DOM 或网络全局，不表示 Android 界面、宿主或设备已接入。

```sh
npm run core:test
npm run core:build
VIENTO_STUDIO_CORE_BIN=/绝对路径/viento-core \
  node --test scripts/tests/studio-core-composition-patch.test.mjs \
  scripts/tests/scene-composition-overrides.test.mjs \
  scripts/tests/scene-composition-overrides-host.test.mjs \
  scripts/tests/scene-composition-overrides-bridge.test.mjs \
  scripts/tests/scene-composition-overrides-ui.test.mjs
VIENTO_COMPOSITION_OVERRIDES_OUTPUT=/tmp/viento-composition-inheritance-new \
  node scripts/tests/scene-composition-inheritance-smoke.mjs /usr/bin/google-chrome
```

核心检查 set／reset 不重叠、六字段固定路径顺序、位置／尺寸成对恢复、仅删除目标成员、最后字段删除后移除演员覆盖条目但保留空数组、无覆盖时不创建空条目，以及数组重排后的稳定身份。BOM、CRLF、转义字段、数字写法与无关空白保真；恢复图片、显式图片 `null` 和片段内图片各自处理。新能力缺失时旧 set／expand／源码／几何继续可用，原生与真实 WASM 回执必须一致。

提案与 UI 检查同值恢复仍为源码修改、混合 set／reset 的单次候选、无效废弃输入与取消恢复、完整原文审阅，以及来源／token／批准／能力失效和迟到响应。新增 UI 的提案边界替身只证明界面委托；真实 Rust、候选预览与普通保存由其他专项及浏览器实际运行验证。边界审阅另保存[最终结论](test-results/scene-composition-inheritance/boundary-review.json)；严格重验输入和候选，恶意回执不能删除输入中的非法重复键来伪造成功。

实际浏览器使用独立临时配方工程，验证同值恢复取消、混合设置与恢复、删除所选演员全部覆盖、完整候选、普通保存与再预览、外部文件冲突及过期源码保护。新[Chrome 记录](test-results/scene-composition-inheritance/browser/browser.json)使用 **154.0.8037.97**，完成 **9** 条流程，中英日 **390px** 恢复入口和审阅流程分别截图；只有普通保存改变配方正文，元数据、图片、共享片段与实例 UUID 保留。它独立于旧专题，不等同新安装窗口、Android 宿主或设备验收。

### 配方单实例画布与原文草稿

当前 **0.0.9 发布后未发布工作树**复用既有 Rust 几何／历史和 position-only 覆盖提案，新增独立画布 owner。结果单独保存于[画布专题](test-results/scene-composition-canvas/results.json)，不改写上轮继承或普通 Scene2D 布局证据。最终固定 Node **24.20.0** 完成应用 **2082／2082**，0 失败／跳过／取消，**436** 个 JavaScript 文件及 API／版本预检通过。[相关专项](test-results/scene-composition-canvas/focused-tests.log) **128／128** 已计入全量，其中新纯适配 **15** 项执行真实共享 WASM，新位置界面 **19** 项通过。共享画布 **30** 项由全量验证；初次位置界面及画布合计 **49／49** 来自系统 Node **24.21.0**，保留原条件。专项不与全量重复相加。

```sh
node --test scripts/tests/scene-composition-layout.test.mjs \
  scripts/tests/scene-composition-layout-ui.test.mjs \
  scripts/tests/scene-layout-canvas.test.mjs \
  scripts/tests/scene-composition-overrides-ui.test.mjs
```

纯适配回归覆盖保存态和未保存原文、稳定 UUID 兄弟实例、首次覆盖与显式无图片、局部／场景位置及偏移边界、原位 no-op、小数未动轴、撤销／重做和 100 步预算、32 槽释放、坏模型／来源、异步输入分离与 128 KiB 候选限制。非目标或局部越界操作必须保留位置、dirty、历史和 redo；候选重新展开并通过既有 apply 复算，只有 `position` 改变。

画布和 GUI 验证固定可移动实例的指针／键盘门禁、一次拖动一次提交、网格／缩放、Esc／取消、未完成输入、批准失效、当前源码 token／父 owner 和迟到响应。真实浏览器应使用隔离配方工程，另核对完整候选、普通保存／重开、外部冲突、元数据／图片／UUID／兄弟实例原字节、中英日及窄屏。准备资源分别执行实际桌面副本和无 Node／DOM／网络全局的移动 ESM／WASM；移动纯模块不代表 Android 位置编辑宿主、界面或设备。

实际[准备副本记录](test-results/scene-composition-canvas/packaged-resources.json)核对桌面完整 **513**／重点源码 **111**、移动完整 **203**／重点源码 **81** 份文件，固定 Node **24.20.0** 执行桌面复制模块，移动在隔离 VM 中加载 **9** 个纯模块及未改动的 Rust WASM。两端各通过同一 **5** 组位置案例，共 **10** 组；移动显式拒绝 **13** 个非法操作，无 Node／DOM／网络全局或宿主导入。案例核对保存及草稿回执、范围外原字节、局部／场景边界、小数未动轴、原位和历史、伪造／过期回执、首次 await 前分离及释放。准备资源初次版本假设和缺少定义来源的测试 fixture 失败单独保留，修正的是验证脚本；此记录不证明作者磁盘写入、安装窗口、引擎执行、Android 设备或新增独立 Rust 测试。

共享父回调另验证两个子对话框的合法复制提案：完整规范化内容和同一结果回执匹配后允许结束并返回编辑器，改变任一字段仍拒绝。初次浏览器脚本调用了不存在的语言函数，失败记录保留原条件；修正为实际 `applyLanguage` 后，[最终画布实测](test-results/scene-composition-canvas/browser-final/browser.json)在 Chrome **154.0.8037.97** 完成 **7** 条流程，0 页面异常、0 SVG 外部访问，桌面与中英日 **390px** 截图另经视觉核对。旧六字段／恢复流程在新目录[重跑 **9** 条](test-results/scene-composition-canvas/inheritance-regression/browser.json)，0 异常；这是本轮共享父回调回归，原继承报告保持原字节。

### 配方多实例批次画布与原文草稿

本段仍是 **0.0.9 发布后未发布工作树**，独立记录于[批次画布专题](test-results/scene-composition-batch-canvas/results.json)，不改写单实例、恢复继承或旧布局报告。新增可选 `sceneComposition.patchPositions` 原子生成多目标位置补丁，既有 set／edit／expand、作者格式与普通保存保持。共享核心原生 **93** 项及 fmt／clippy 通过；[最终相关专项](test-results/scene-composition-batch-canvas/focused-tests.log)使用固定 Node **24.20.0** 完成 **249／249**，0 失败／跳过／取消。新纯适配 15、核心桥接 10、批次界面 24、父控制器 7、主编辑器 8 及预览新增 2 项共 66 项，均已包含在专项和[本轮完整应用](test-results/scene-composition-batch-canvas/app-check.log) **2148／2148** 内；固定 Node 24.20.0 完成 **444** 个 JavaScript 文件及 API／版本预检，0 失败／跳过／取消，不与专项相加。界面初次最终 24 项使用系统 Node 24.21.0，真实大纲、helper 和 Rust 执行，画布绘制为测试替身。

```sh
npm run core:test
npm run core:build
VIENTO_STUDIO_CORE_BIN=/绝对路径/viento-core \
  node --test scripts/tests/studio-core-composition-batch-patch.test.mjs \
  scripts/tests/scene-composition-batch-layout.test.mjs \
  scripts/tests/scene-composition-batch-layout-ui.test.mjs \
  scripts/tests/scene-composition-batch-layout-host.test.mjs \
  scripts/tests/scene-composition-batch-layout-bridge.test.mjs
VIENTO_COMPOSITION_BATCH_CANVAS_OUTPUT=/tmp/viento-composition-batch-new \
  node scripts/tests/scene-composition-batch-canvas-smoke.mjs /usr/bin/google-chrome
```

原生和实际 WASM 回执逐字核对，检查独立 probe／调度域、1–128 唯一目标、规范作者顺序、同放置多个新增覆盖合并插入、已有数值 token 与其他覆盖字段保真、净无变化不创建空覆盖，以及最终候选 128 KiB 预算。严格输入和完整展开在补丁前后均检查，不能把依次完成的单实例补丁当作原子批次。缺 positions 能力时旧 set／edit／expand 和几何仍可用；坏回执改变非目标语义、路径或身份必须拒绝并禁用运行时。

纯适配验证当前保存／草稿来源、全部实例与组织侧带、每目标独立 offset、世界及局部双边界、未动轴小数、同定义不同 UUID、净变化候选、真实六向对齐和一个会话的 100 步批次历史。任一目标失败不得改变任一位置、dirty 或 redo；未提交的选择集不会成为作者保存权限。准备应用必须重算所有稳定目标和精确回执，顺序、重复、过期、伪造及异步变动输入均拒绝。

GUI 检查真实大纲的搜索、后代选择及多选切换，完整候选和目标列表、批次历史、未完成原始坐标、取消与图片副本释放。静默改变字段后不能靠换选、对齐、拖动或应用绕过批准；检查和应用期间锁定作者操作，关闭或换源后的迟到打开／失败／检查／应用不影响新 owner。共享父回调接受合法分离提案并严格核对规范化内容及同一完成回执。

实际[Chrome 实测](test-results/scene-composition-batch-canvas/browser/browser.json)使用 **154.0.8037.97** 完成 **5** 条流程，0 页面异常、0 SVG 外部访问，中英日 **390px** 截图另经视觉核对。临时工程通过分组选择和真实拖动／方向键跨两放置修改四个目标，按尺寸对齐并整批撤销／重做，审阅完整原文后应用和普通保存／重开；原始字段批准失效及外部冲突保留原草稿。旧单实例脚本在[本轮独立目录](test-results/scene-composition-batch-canvas/single-regression/browser.json)另实跑 **7** 条流程，0 异常和 SVG 外部访问，原专题保持其原条件。

本轮[准备副本](test-results/scene-composition-batch-canvas/packaged-resources.json)核对桌面完整 **515**／重点源码 **113**、移动完整 **205**／重点源码 **83**、作品库 **11** 份文件和真实共享 WASM。桌面用固定 Node **24.20.0** 执行准备模块，移动在无 Node／DOM／网络或宿主导入的隔离环境中加载 **84** 个本地 ESM 模块（含 vendor YAML）。两端各通过同一 **8** 组案例，共 **16** 组执行；覆盖保存／未保存来源、多放置和同放置位置批次、局部／场景边界、未动轴小数、历史／净变化／生命周期、精确回执和非法目标拒绝。重点副本 SHA 与来源逐一匹配，**543** 份最终源码前后稳定；案例类别和实际范围以报告为准，不累计为 16 种功能。准备纯模块不等于 Tauri 安装、Android 画布宿主／界面／设备或新引擎验收。初次专项的 dirty 条件 fixture 错误、界面重复统计组按钮和复选框的 fixture 错误、准备过程覆盖正在执行的 Node 二进制导致的 `ETXTBSY` 均保留原始记录，不能改写为产品失败或最终通过证据。准备验证首次隔离链接器只允许 engine 路径，实际 JSON 范围工具还依赖已准备的本地 vendor YAML；修正的是 proof 的本地导入白名单，产品及副本未改，仍拒绝宿主导入和 Node／DOM／网络全局。

### 共享片段字段与普通保存

本轮仍是 **0.0.9 发布后未发布工作树**，新证据独立保存于[共享字段专题](test-results/scene-composition-fragment-editor/results.json)。操作见[共享片段表单](SCENE_COMPOSITION.md#编辑共享片段的演员声明)，Rust、纯提案、GUI、来源宿主及真实浏览器分别核对；原单实例、恢复、批次画布和冻结后端证据保持原条件。

```sh
npm run core:test
npm run core:build
VIENTO_STUDIO_CORE_BIN=/绝对路径/viento-core \
  node --test scripts/tests/studio-core-composition-fragment-patch.test.mjs \
  scripts/tests/scene-composition-fragments.test.mjs \
  scripts/tests/scene-composition-fragments-ui.test.mjs \
  scripts/tests/scene-composition-fragments-host.test.mjs \
  scripts/tests/scene-composition-fragments-bridge.test.mjs
VIENTO_COMPOSITION_FRAGMENT_OUTPUT=/tmp/viento-composition-fragment-new \
  node scripts/tests/scene-composition-fragments-smoke.mjs /usr/bin/google-chrome
```

原生与真实 WASM 回执逐字核对：独立 fragment probe／操作域、六字段非空 SET 白名单、未知或重复键、现有模板身份、位置／尺寸成对和图片 null 限制、全部放置偏移后的坐标、前后 128 KiB UTF-8、BOM／CRLF／Unicode 与范围外数值字节。旧 set／edit／positions／expand 域拒绝新操作；缺新能力时保留旧功能，坏回执改变其他声明、覆盖、身份或来源路径时应拒绝。

纯提案分别核对作者 raw 声明与所选实例的有效／覆盖值，全部相关 targets 的源码顺序及六字段覆盖列表；未声明字段明确设为当前有效同值仍新增声明，已声明相同值不产生候选，全实例掩蔽仍允许修改声明。首次 await 前分离全部输入，prepare 重算精确候选与来源摘要、保存基线、引用集合、掩蔽和路径；错误来源、遗漏／重复／乱序目标、伪造候选或检查期间作者变化不得应用。

GUI 逐字段明确勾选，未声明字段空白且未选输入禁用，位置和尺寸成对；选中的局部覆盖不会初始化为模板值。核对选择后影响清单、全遮蔽提示、完整原文审阅、合法分离提案／完成回执、取消返回、raw 字段及 checkbox 静默改变失效、pending 锁定、父 owner／token 和 late open／check／apply。此表单没有几何历史、Canvas 或独立图片副本，不能以渲染替身宣称画布操作。

浏览器使用隔离配方工程，检查全部相关放置与覆盖掩蔽、取消、普通保存／重开、共享与单实例入口分离、原作者关系／资源字节／UUID／组／偏移保持；中英日 390px 图片另经视觉核对。准备副本分别执行完整桌面资源与无 Node／DOM／网络或宿主导入的移动 ESM／WASM，覆盖声明设置和精确应用回执；纯移动模块不代表 Android 编辑入口、设备或引擎执行。

本轮实际共享 Rust 原生 **101** 项及 fmt／clippy 通过；固定 Node **24.20.0** 的[正式相关专项](test-results/scene-composition-fragment-editor/focused-tests-final.log) **358／358**、[完整应用](test-results/scene-composition-fragment-editor/app-check.log) **2223／2223**，0 失败／跳过／取消／todo；**453** 个 JavaScript 文件与 API／版本预检通过。新增 **75**（helper 16／核心桥接 11／UI 28／父控制器 9／主编辑器 8／入口 3）全部计入全量。核心定向 161 和正式专项 358 有旧回归重叠，不与全量相加。UI [独立 28 项](test-results/scene-composition-fragment-editor/ui-tests.acceptance.log)使用系统 Node 24.21.0，真实 helper／Rust；产品无画布或历史替身。

[真实 Chrome](test-results/scene-composition-fragment-editor/browser/browser.json)使用 **154.0.8037.97** 完成 **6** 条共享字段流程，0 页面异常／SVG 外部访问；中英日 **390px** 和审阅页可见区域截图已另经视觉核对；完整候选原文由浏览器逐字断言核对。原[单实例脚本](test-results/scene-composition-fragment-editor/single-regression/browser.json) **7** 条与[批次脚本](test-results/scene-composition-fragment-editor/batch-regression/browser.json) **5** 条在新目录实际回归，均 0 异常／SVG，原脚本不变。

本轮[准备副本](test-results/scene-composition-fragment-editor/packaged-resources.json)完整核对桌面资源 **517**／移动 **207**／作品库界面 **11** 份文件，逐份源码复制或明确变换匹配。固定 Node **24.20.0** 的桌面副本和隔离移动 ESM／实际 WASM 各通过 **9** 组新共享字段案例及 **2** 组真实旧单实例／批次 helper 回归，共 **22** 组执行（新 18／旧 4）。移动加载 **85** 个本地模块，含 vendor YAML，无 Node／DOM／网络全局或宿主导入；只验证纯声明编辑和回执，不替代 Android 作者编辑、安装窗口、持久化或引擎执行。本轮 **553** 份产品／测试源码摘要与副本执行绑定。

[本轮保真核对](test-results/scene-composition-fragment-editor/historical-preservation.json)确认 **2257** 份旧历史、**7** 份冻结 Godot 后端、**9** 份旧单实例／批次／覆盖切片和 **553** 份最终源码保持；旧评分和报告执行条件不改写。仅[清理](test-results/scene-composition-fragment-editor/cleanup.json) **8** 个最初不存在的本轮生成目录，按 inode 去重的已分配磁盘块回收 **4879388672** 字节，即 **4.544 GiB**；共享重建 WASM、外部工具、作者数据、偏好及已有安装保留。

[独立边界审查](test-results/scene-composition-fragment-editor/boundary-review.json)没有发现本切片的阻塞问题；[核心边界探针](test-results/scene-composition-fragment-editor/boundary-probe.json)和[回执／能力探针](test-results/scene-composition-fragment-editor/boundary-receipt-probe.json)另执行显式拒绝、缺新能力保留旧操作及原生／WASM 对照，不加入应用测试计数。审查结论只适用于现有演员六字段设置与单份原文会话。

本轮初次夹具对数字写法／插入缩进、非法无继承图片 null、删除必需位置、跨 VM 数组及缺少回调集合的假设均保留原日志。初次核心／相关专项未提供所需工具而分别跳过 1／2 项，正式同一套专项补齐后无跳过；初次完整检查因启动参数中的重复 Godot 路径被主动终止，不记为完成的失败全量。独立伪造 UUID 夹具使用了原身份，及汇总脚本读取边界报告 schema 的误配只修验证脚本；汇总在写最终报告／清理前停止，修正后完成。全部初次条件与正式结果由[本轮记录](test-results/scene-composition-fragment-editor/results.json)分别列出，准备副本首次执行即通过。

### 共享声明恢复与原子设置删除

当前 **0.0.9 发布后未发布工作树** 在原共享字段表单增加可选声明恢复，新证据独立保存于[共享继承专题](test-results/scene-composition-fragment-inheritance/results.json)。原 SET 专题、实例覆盖、两个画布及后端报告保留原条件；使用方法见[恢复共享片段](SCENE_COMPOSITION.md#恢复共享片段的投影继承)。

```sh
npm run core:test
npm run core:build
VIENTO_STUDIO_CORE_BIN=/绝对路径/viento-core \
  node --test scripts/tests/studio-core-composition-fragment-edit.test.mjs \
  scripts/tests/scene-composition-fragment-inheritance.test.mjs \
  scripts/tests/scene-composition-fragment-inheritance-ui.test.mjs \
  scripts/tests/scene-composition-fragment-inheritance-host.test.mjs \
  scripts/tests/scene-composition-fragment-inheritance-bridge.test.mjs
VIENTO_COMPOSITION_FRAGMENT_INHERITANCE_OUTPUT=/tmp/viento-fragment-inheritance-new \
  node scripts/tests/scene-composition-fragment-inheritance-smoke.mjs /usr/bin/google-chrome
```

真实原生与 WASM 核对独立 `fragment_edit` probe／操作域：设置和 reset 不重叠，位置不可删，四属性仅 source 开启投影继承可删，图片任一状态可删；显式图片 null 与删除分别验收。检查缺失字段恢复、净无变化、所有放置偏移、前后 128 KiB UTF-8、BOM／CRLF、必要分隔符、极端未改数值和范围外字节；旧 SET 与缺新能力兼容仍真实执行，不能拿 fake values 模拟删除。

纯 helper 的 `proposeEdit({ values, reset })` 验证原始意图再规范净设置／实际删除，新形状始终携带 reset；原 `propose(values)` 与旧提案形状保持。prepare 在摘要 await 前分离来源及提案，重新计算完整引用集合、顺序、掩蔽、精确正文和路径；错误／遗漏／重排目标、坏回执或异步输入变动不得应用。

GUI 五个恢复选择默认不勾，未声明或不允许删除时禁用，位置没有恢复控件；同字段 SET／RESET 互斥，原始输入不抹去。核对 pure reset、mixed set-reset、null 删除重继承、无继承图片删除无图、全部实例掩蔽仍只改声明、净影响列表、完整原文和图片依赖检查。原始输入／checkbox 静默变化、pending／owner／token／迟到完成、合法分离回执、取消及普通保存冲突各有专项；旧 SET-only 原测试保持原字节。

浏览器应使用真实投影默认值，删除后再次预览确认实际继承；完整候选、全部 targets 和覆盖掩蔽用逐字断言核对，三语 390px 可见界面另经目视检查。准备副本用实际 WASM 执行原子删除与旧 SET／单实例／批次 helper，移动只加载本地纯模块，不替代 Android 编辑入口或设备验收。本轮实际计数以[结果](test-results/scene-composition-fragment-inheritance/results.json)与独立日志为准，专项和浏览器流程不累计为应用覆盖率。

本轮共享 Rust 原生 **110** 项（新增 9）及 fmt／clippy 通过；固定 Node **24.20.0** 的[完整应用](test-results/scene-composition-fragment-inheritance/app-check.log) **2283／2283**、[正式相关专项](test-results/scene-composition-fragment-inheritance/focused-tests.log) **418／418** 均 0 失败／跳过／取消／todo，**459** 个 JavaScript 文件及 API／版本预检通过。新增 **60** 项（helper 16／协议桥接 11／UI 20／父控制器 5／主编辑器 8）已包含在全量，核心专项 **88**、相关专项和界面回归互相重叠，不相加。UI [新 20 项](test-results/scene-composition-fragment-inheritance/ui-tests-initial.log)和[旧 SET 原测试 28 项](test-results/scene-composition-fragment-inheritance/ui-regression-initial.log)首次均通过，使用系统 Node **24.21.0** 与真实 helper／Rust，无 Canvas 或几何历史替身。

实际 Chrome **154.0.8037.97** 的[共享声明恢复实测](test-results/scene-composition-fragment-inheritance/browser-second/browser.json)完成 **6** 条流程；[旧共享 SET](test-results/scene-composition-fragment-inheritance/set-regression/browser.json) **6** 条、[旧实例恢复](test-results/scene-composition-fragment-inheritance/override-regression/browser.json) **9** 条和[旧批次画布](test-results/scene-composition-fragment-inheritance/batch-regression/browser.json) **5** 条分别实际回归，均 0 页面异常。新流程使用真实投影和图片，检查 null 删除后重继承、无继承图片删除无图、原子混合设置／恢复、局部掩蔽、普通保存和冲突。中英日 **390px** 及审阅页的可见区域共 4 张截图另经目视核对；完整候选原文由浏览器逐字断言核对。

[准备副本](test-results/scene-composition-fragment-inheritance/packaged-resources.json)完整核对桌面资源 **517**／移动 **207**／作品库界面 **11** 份文件，逐份源码复制或明确变换匹配。两端各执行 **10** 组新恢复和 **11** 组旧 SET／单实例／批次 helper，共 **42** 组（新 20／旧 22），首跑通过。移动加载 **85** 个本地 ESM 模块及实际重建 WASM，无 Node／DOM／网络全局或宿主导入；这是纯规则可移植验证，不等同 Android 编辑／持久化／设备或安全沙箱验收。[最终结果](test-results/scene-composition-fragment-inheritance/results.json)绑定 **560** 份产品／测试源码与四个 fresh 原生 helper。

[保真报告](test-results/scene-composition-fragment-inheritance/historical-preservation.json)确认 **2339** 份旧历史、**16** 份受保护旧切片、**7** 份冻结 Godot 后端和 **560** 份最终源码保持。仅[清理](test-results/scene-composition-fragment-inheritance/cleanup.json) **9** 个确属本轮的生成目录：8 个在起始基线不存在，额外 default target 的生成时间与归属有独立证据。按 inode 去重已分配磁盘块回收 **4896763904** 字节，即 **4.560 GiB**；共享重建 WASM、外部工具、作者数据、偏好与已有安装保持，版本仍为 0.0.9。

[独立审查](test-results/scene-composition-fragment-inheritance/boundary-review.json)未发现本有界切片的阻塞问题。[声明边界探针](test-results/scene-composition-fragment-inheritance/boundary-probe.json)另执行 10 组／37 个明确拒绝及 93 种 token 组合；[回执与能力探针](test-results/scene-composition-fragment-inheritance/boundary-receipt-probe.json)另执行 13 组，含 9 类伪造回执、3 类缺新能力仍真实执行旧 SET 和 12 个原生／WASM 请求对照，不加入应用总数。

初次核心测试的语法及无继承 null 夹具、helper 对原始速度值的假设、宿主／父完成回调的夹具断言和浏览器素材库相对路径仅修验证文件；原日志均保留。准备启动使用不支持的参数，随后在资源准备前终止；提前编译 helper 缺资源，正式准备和编译后通过。额外默认构建目录有独立生成时间／归属记录并列入清理。完整应用、准备副本和最终汇总首跑成功；具体初次条件由[本轮结果](test-results/scene-composition-fragment-inheritance/results.json)分别列出，未改产品绕过失败。

### 放置偏移与全成员原文审批

当前 **0.0.9 发布后未发布工作树** 增加独立 placement 表单和原子 offset 补丁，[新专题](test-results/scene-composition-placement-offset/results.json)与旧字段／继承／批次证据分别保存。操作见[整组放置偏移](SCENE_COMPOSITION.md#调整整组放置偏移)，组织组仍不提供空间变换。

```sh
npm run core:test
npm run core:build
VIENTO_STUDIO_CORE_BIN=/绝对路径/viento-core \
  node --test scripts/tests/studio-core-composition-placement-patch.test.mjs \
  scripts/tests/scene-composition-placement.test.mjs \
  scripts/tests/scene-composition-placement-ui.test.mjs \
  scripts/tests/scene-composition-placement-host.test.mjs \
  scripts/tests/scene-composition-placement-bridge.test.mjs \
  scripts/tests/scene-composition-placement-preview.test.mjs
VIENTO_COMPOSITION_PLACEMENT_OUTPUT=/tmp/viento-placement-new \
  node scripts/tests/scene-composition-placement-smoke.mjs /usr/bin/google-chrome
```

真实原生与 WASM 核对独立 placement cap1／`editPlacementOffset` 域、稳定 placement 身份、有限数值对及 null 删除、缺省与显式零的双向变化。偏移在演员局部覆盖之后相加，任一成员世界坐标越界须原子拒绝；核对正负边界、前后 128 KiB、BOM／CRLF、极端未改数值、删除首／中／末 token 与插入，保留其他放置、共享片段、局部覆盖、全部演员／组 UUID 及范围外字节。缺新能力继续真实执行旧操作，坏回执不能改变非目标语义或路径。

纯 helper 在首次 await 前分离源及有效模型，绑定 selected actor 所属的全部 placement targets 和 groups，顺序来自片段声明。propose(pairOrNull) 只产生净源码变化；prepare 重新核对源摘要、保存基线、完整演员／组来源、映射／顺序、精确候选和 changedPaths。完整／遗漏／重复／乱序／foreign actor 或 group 回执分别检验；输入／提案嵌套值异步修改不得绕过校验。

GUI 显示 raw 声明和当前预览生效偏移，缺失不自动填零，数值对必须完整；恢复保持用户输入，未声明时不能删除。影响列表覆盖全体成员，差异只读，完整候选与 canonical 批准独立绑定。核对静默 raw／reset 改变、pending 锁全部操作、owner／token／path／保存基线、late open/check/apply、新开覆盖旧请求、取消／焦点和幂等销毁；没有 Canvas、媒体副本或几何会话。

真实浏览器应验证多成员局部覆盖后统一偏移、缺省与显式零、恢复、完整 targets／groups／候选、普通保存及外部冲突。完整候选逐字断言，三语 390px 的可见表单和审阅区域另经目视检查；可滚动选项不能误称已在所有截图内可见。准备副本使用实际 WASM 执行偏移提案及旧 SET／恢复／批次 helper，移动只验证隔离本地纯模块，不提升 Android 编辑宿主或设备成熟度。

正式结果如下；应用、相关专项和核心专项具有重叠，不能累加为覆盖率。

本轮共享 Rust 原生 **119** 项（新增 9）及 fmt／clippy 通过；固定 Node **24.20.0** 的[完整应用](test-results/scene-composition-placement-offset/app-check.log) **2353／2353**、[相关专项](test-results/scene-composition-placement-offset/focused-tests.log) **488／488** 和[核心专项](test-results/scene-composition-placement-offset/core-focus.log) **155／155** 均 0 失败／跳过／取消／todo，**468** 个 JavaScript 文件及 API／版本预检通过。[新增 70 项](test-results/scene-composition-placement-offset/new-test-counts.json)为 helper 16／协议 11／UI 24／父控制器 7／预览 4／主编辑器 8，已包含在全量；专项互相重叠，不相加。系统 Node **24.21.0** 的新 UI **24** 项及原共享 SET／恢复测试 **48** 项实际通过，真实 helper／Rust 执行，无 Canvas 或媒体替身。

实际 Chrome **154.0.8037.97** 的[放置偏移实测](test-results/scene-composition-placement-offset/browser/browser.json)完成 **5** 条流程；[旧共享恢复](test-results/scene-composition-placement-offset/inheritance-regression/browser.json) **6** 条和[旧批次画布](test-results/scene-composition-placement-offset/batch-regression/browser.json) **5** 条另实际回归，均 0 页面异常。新流程检查全成员偏移、缺省与显式零、恢复、完整候选、普通保存与外部冲突。中英日 **390px** 和审阅页可见区域共 4 张截图另经目视核对；完整候选原文由浏览器逐字断言核对。本轮没有单独重跑旧 SET 浏览器流程。

[准备副本](test-results/scene-composition-placement-offset/packaged-resources.json)完整核对桌面资源 **519**／移动 **209**／作品库界面 **11** 份文件，源码复制或明确变换逐份匹配。桌面与隔离移动各执行 **14** 组新偏移和 **21** 组旧 SET／恢复／单实例／批次 helper，共 **70** 组（新 28／旧 42），首跑通过。移动加载 **86** 个本地 ESM 模块及实际重建 WASM，无 Node／DOM／网络全局或宿主导入；这是纯层可移植验证，不等同 Android 作者编辑／持久化／设备、安全沙箱、安装窗口或引擎执行验收。

[保真报告](test-results/scene-composition-placement-offset/historical-preservation.json)确认 **2430** 份旧历史、**23** 份受保护旧切片、**7** 份冻结 Godot 后端和 **571** 份最终产品／测试源码保持。仅[清理](test-results/scene-composition-placement-offset/cleanup.json) **8** 个最初不存在的本轮生成目录，按 inode 去重已分配磁盘块回收 **4887965696** 字节，即 **4.552 GiB**；共享重建 WASM、依赖、外部工具、作者数据、偏好和已有安装保留。版本仍为 **0.0.9**，新能力属于未发布工作树。

独立[边界复核](test-results/scene-composition-placement-offset/boundary-review.json)检查 9 份源码，最终 findings 为空；[纯边界探针](test-results/scene-composition-placement-offset/boundary-probe.json)另执行 14 组、54 次明确拒绝，[回执探针](test-results/scene-composition-placement-offset/boundary-receipt-probe.json)另执行 18 组，含 14 类伪造回执、3 类缺能力时旧操作可用、15 个旧操作与 19 个原生／WASM 请求对照。这些独立探针不加入应用总数。

初次新浏览器发现父检查与新夹具错误地从预览顶层读取 groups；实际 v2 组织组位于 `sceneStructure.groups`，新父检查和新夹具已修正。新核心 reset 夹具位置、late-open 等待屏障、浏览器语言切换调用和边界探针缩进假设仅修验证文件；日志按初次条件保留。成功的旧批次浏览器初用错误输出环境变量，证据按[迁移记录](test-results/scene-composition-placement-offset/batch-evidence-relocation.json)逐字节搬入本轮目录，原报告条件未重写。完整应用、准备副本和最终汇总首跑成功，具体初次条件见[本轮结果](test-results/scene-composition-placement-offset/results.json)。

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
| `VIENTO_TEST_2D_WORKFLOW=1` | 默认隔离样例中的配方生成 Scene2D、源码替换及原生撤销／重做、问题回源修复、Godot 构建与无头运行；不可与 GENERIC_CREATE 同时启用 |
| `VIENTO_TEST_EDITOR_EXPORT=1` | 在 library 流程中执行原生导出保存、过期、取消与重试 |
| `VIENTO_TEST_SCREENSHOT_DIR=/path/to/new-evidence` | 保留本轮截图及日志；默认随测试目录清理 |

二维专项另需 `VIENTO_GODOT_BIN=/可信本机Godot绝对路径` 和 xdotool（可用 `VIENTO_TEST_XDOTOOL` 指定）。OC、已登记图片及保存后的配方在启动前作为隔离样例准备；本专项从预览配方开始，不替代上游界面创作。按钮与快捷键走真实 Tauri/WebKit，撤销／重做还通过独立 Xvfb 的键盘事件复核；表单赋值会发送输入事件。Godot 有限无头运行通过，不代表渲染游戏或独立发行包已验。复现安装验证可同时设置 `VIENTO_EXPECT_APP_VERSION=0.1.1`、`VIENTO_EXPECT_BUILD_VERSION=0.1.1` 和 `VIENTO_TEST_LANGUAGE=1`；[2026-10-13 安装记录](test-results/native-installed-0.1.1/README.md) 保留失败复现和修复后结果。

系统选择器、覆盖确认、媒体解码和关闭确认需在原生窗口验收。构建安装包后，可将主程序或 AppImage 作为第三个参数再次运行；调试程序通过不代表安装包已经通过。以前的窗口和安装记录从 [历史平台验收](history/README.md#迁移平台验收与维护) 查阅。

## Android 设备工作流

构建及 SDK 要求见 [移动端说明](../mobile/README.md)。浏览器与真实 Rust 存储联调替代了 IPC 传输，不能代替 Android 设备测试。

使用独立模拟器或专用测试手机，按以下顺序验证：导入桌面项目包 → 字段和源码修改 → 保存／重开 → 未保存草稿中断恢复 → 保留数据覆盖安装 → 导出并在桌面恢复 → 逐文件比较。另测新建工程与文档、键盘遮挡、三语切换、连续取消、损坏包、重复包及错误后重试。

使用新安装包时记录版本、签名类型、ABI、APK 摘要、系统／WebView 版本和设备条件。模拟器通过不等于 ARM64 实体手机通过；已有证据需区分触屏、系统选择器与 WebView DOM 操作。当前移动端功能边界见 [开发状态](STATUS.md)，不要把尚未接入的功能列成已通过或仅待补测。

## 仍需验证

| 范围 | 后续验收重点 |
| --- | --- |
| 桌面安装扩展范围 | 本轮已验 Linux 0.1.1 工作树的编辑、配方生成、Godot 无头链、作品库和导出；其他后端、3D、上游全部创作及长任务中退出需分别补验 |
| Windows / macOS | 系统文件选择、覆盖确认、媒体解码、生命周期及发行签名；Linux 结果不外推 |
| Android 实体设备 | 中日输入法候选字、低内存回收、不同 Android／WebView、屏幕与厂商系统 |
| Android 文件提供方 | 第三方云盘、外置设备、传输途中进程结束；商店签名更新需单独验收 |
| 完整大工程与容量边界 | 多 GiB 迁移、长期压力、空间不足、不同文件系统及接近移动限制时的性能 |
| Scene2D 人工交互 | 实体键盘、长时间窗口运行和更多图形设备；原生引擎或其他平台必须在接入后建立各自测试 |

尚未实现的原生 Nuis/ns-nova/yalivia、嵌入视口、GPU 计算及宿主崩溃恢复等内容，以 [开发状态](STATUS.md) 和 [构建说明](PROJECT_BUILD.md) 为准；补测不能替代实现。

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

## 共享片段演员结构与普通保存

新增／移除片段演员使用独立 Rust 结构能力，测试同时覆盖所有相关放置映射、局部覆盖清理、未放置片段、最后成员保护、完整原文回执与来源冲突。产品格式继续 recipe v1 → Scene2D v3。

```sh
cargo test --locked --manifest-path crates/viento-studio-core/Cargo.toml
node scripts/build-studio-core.mjs
node --test scripts/tests/studio-core-composition-structure-patch.test.mjs scripts/tests/scene-composition-structure*.test.mjs
VIENTO_COMPOSITION_STRUCTURE_OUTPUT=/empty/evidence/path node scripts/tests/scene-composition-structure-smoke.mjs /usr/bin/google-chrome
```

真实浏览器脚本创建临时作品，检查固定两放置身份、投影／图片／组来源、取消／原始输入失效、普通保存与重开、移除覆盖和未放置片段、图片不可用及外部保存冲突，并保留中英日 390px 截图。未放置片段检查声明和登记依赖，没有渲染实例，不扩大为所有投影有效默认值验收。对应准备副本验证纯 helper 与实际 WASM，无 Node／DOM／网络全局；这是标准 VM 可移植性验证，不是恶意代码安全沙箱，也不代表 Android 设备编辑或新版安装窗口。新证据位于 [结构创作专题](test-results/scene-composition-structure/results.json)，旧证据和评分按原条件保留。

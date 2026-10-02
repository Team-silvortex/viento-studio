# 验证指南与覆盖状态

本页对应 **0.0.5**。当前源码发布见 [版本记录](RELEASE_0.0.5.md) 和 [发布验证记录](test-results/release-0.0.5/results.json)。最近一次 Linux 安装验收仍为 [0.0.4](test-results/release-0.0.4/results.json)，0.0.1 安装与数据恢复验收见 [交接记录](HANDOFF_0.0.1.md)。下表同时保留继承自前身的功能覆盖；历史原生交互证据见 [b.4.5 工作树补测](WORKFLOW_VERIFICATION_b.4.5.md)，原始版本和指纹保留，不能替代新版安装包验收。

**0.0.5 发布前验证**：231 个 JavaScript 文件通过语法检查，版本一致性与 API 契约预检通过；应用回归 **852 项通过、0 失败、0 跳过**，启用本轮编译的原生归档和移动存储工具。完整桌面宿主编译与 Rust 测试通过，合计 **46 项通过、0 失败、1 项大作品测试按配置忽略**；包含原格式保存、资源包事务屏障、桌面生命周期和优化构建的 GLib 回归。桌面／移动资源准备及生产依赖收集通过。本轮提交源码，没有重新制作或安装发行包，也未启动 Android 设备或验收新的原生保存窗口。

**0.0.4 发布验收**：213 个 JavaScript 文件通过语法检查，应用回归 **768 项通过、0 失败、0 跳过**，使用本轮重建的原生归档和移动存储工具；Rust **44 项通过、0 失败、1 项大作品测试按配置忽略**。Linux AppImage 与 deb 构建通过；实际 AppImage 在隔离配置和作品中通过三语、字段编辑、模板、媒体、导出／导入及字节一致的备份恢复流程。本机已安装同一摘要的 AppImage，并从原有启动器打开 0.0.4 作品库窗口；旧程序已备份。deb 未安装，Android APK 本轮未构建。

后续开发已加入 [世界与对象](WORLD_PROJECTION.md) 及 [V-M3 批量提交与恢复](WORLD_TRANSACTIONS.md)。0.0.3 发布前在包含最终草稿保护的源码上完成应用回归 708 项（启用原生互通工具，0 失败、0 跳过），原生测试 44 项通过、1 项完整作品迁移大样本按配置跳过，见 [发布前记录](test-results/release-0.0.3/results.json)。开发阶段另有 63 项语义／迁移专项回归和真实浏览器恢复验收：真实 SIGKILL 验证提交前回退、提交后前进和恢复重入；真实界面验证双对象保存、整批冲突保留、恢复时原编辑器草稿保留及后续过期保存拒绝。开发证据 [V-M1](test-results/world-m1/results.json) / [V-M2](test-results/world-m2/results.json) / [V-M3](test-results/world-m3/results.json) 保留原样。

0.0.3 之后源码的 [对象创建](WORLD_OBJECT_CREATE.md) 阶段通过 **737 项应用回归（0 失败、0 跳过）**，启用原生归档与移动存储工具。新增 29 项回归覆盖创建、正文／登记恢复、空文件与不存在的区分、外部冲突保护、GUI 草稿、v2 / v3 原生及移动归档往返。真实浏览器检查保存、重名拒绝、同长度保留 mtime 的外部修改冲突、中英日切换和 390 CSS 像素单列布局；[创建验收记录](test-results/world-create/results.json) 包含当时的源码指纹，保留原样。

随后 [对象关系](WORLD_RELATIONS.md) 开发阶段通过 **768 项应用回归（0 失败、0 跳过）**，新增 31 项覆盖关系图约束、保真 JSON 插入、并发命令、登记事务恢复与 GUI 草稿保护。真实浏览器已验证共享归属保存及导航更新、重复／循环拒绝、同长度且保留精确 mtime 的外部修改冲突、SIGKILL 后从界面恢复、三语切换和 390 CSS 像素单列布局。v2 / v3 共享归属经过原生桌面／移动存储归档往返；桌面及移动资源准备通过，见 [关系验收记录](test-results/world-relations/results.json)。该阶段复用已有 0.0.3 原生工具，未重跑完整 Rust 单元测试、验收新安装包或启动 Android 模拟器；本轮 Linux 发布补测见上文。资源绑定在后续开发源码接入，见 [资源绑定](WORLD_RESOURCES.md)；Build 仍未实现。

0.0.4 之后的开发源码接入 [资源绑定](WORLD_RESOURCES.md)。本轮应用检查 **801 项通过、0 失败、0 跳过**（216 个 JavaScript 文件语法通过），新增 33 项回归。专项回归覆盖自定义用途、六类登记素材、离线资源、保真 JSON 插入、并发与真实 SIGKILL 恢复；浏览器检查保存、冲突、GUI 恢复、三语和窄屏布局。v2 / v3 绑定经原生桌面／移动存储归档往返，逐文件字节核对通过。完整桌面构建因本机缺少 GLib 开发依赖受阻，本轮改以独立 Cargo 测试清单编译未改动的原生存储源码及既有 examples，验证不等同于新安装包或 Android 设备验收。详见 [本轮源码验证记录](test-results/world-resources/results.json)。

随后已补齐本机 GLib、GTK 3、WebKitGTK 4.1 和 librsvg 开发包，`pkg-config` 检测及原生头文件编译、链接、运行探针全部通过，见 [依赖安装验证](test-results/world-resources/native-dependencies.json)。此前缺少 GLib 的环境阻塞已解除；这次安装验证不代表重新构建了桌面安装包。

随后源码加入 [选择式资源包](RESOURCE_PACKAGES.md)：实际浏览器完成对象／依赖勾选、ZIP 下载、另一个空项目的日文导入预览、确认导入及编辑器索引重建，核对正文原字节与 UUID。34 项资源包专项覆盖六类素材、依赖开关、类型／模板、v2/v3 目录映射、冲突、损坏包、鉴权、关闭重开、恢复和 ZIP 打开期间取消；完整应用检查 **835 项通过、0 失败、0 跳过**，228 个 JavaScript 文件通过语法检查，见 [资源包验证记录](test-results/resource-packages/results.json)。本轮用独立 Cargo 清单编译当前原生归档与移动存储源码：30 项单元测试通过，1 项需指定完整作品目录的大样本测试按配置忽略；原生备份新增未完成资源包导入屏障。未重新构建／安装完整 Tauri 应用，也未验收 Android 设备上的资源包界面。

单素材导出随后接入 **插入素材** 卡片和资源包清单。完整应用检查 **852 项通过、0 失败、0 跳过**，231 个 JavaScript 文件通过语法检查；新增 17 项专项覆盖 v2/v3 外置素材、原字节与文件名、缺失／指纹／快照冲突、鉴权、MIME、范围与空文件、流式取消收尾、浏览器和原生桥重试、三语与草稿保护。Chrome 实际完成两个入口的 PNG／MP4／WAV 下载，逐字节比较，并核对光标、勾选、继续插入和 390 像素布局。独立 Cargo 清单编译项目中的归档、移动存储、保存、偏好及关闭状态源码：**38 项通过、1 项完整作品测试按配置忽略**，含原格式保存、覆盖和缓存过期后继续保存。结果及源码指纹见 [单素材导出验证记录](test-results/asset-export/results.json)。本轮没有构建或安装完整 Tauri 应用、实测新的系统选择器窗口或接入 Android 单素材界面；视频样本用于文件传输保真，不代表播放解码验收。

## 已验证到哪一层

| 链路 | 自动回归 | 实际运行覆盖 |
| --- | --- | --- |
| 通用解析、类型、模板、布局 | Markdown / TXT / JSON / YAML、项目规则、原文保护 | Linux v2 / v3 项目；浏览器编辑；Android 读取导入定义 |
| 源码 / 分段 / 字段编辑 | 草稿往返、无效值、冲突、新建身份、保存后刷新 | Linux 字段修改与三语切换；Android 数字 / 英文键盘、新建与重开 |
| World 查询 / 单属性命令 | 版本校验、零写入预览、跨格式单文件保存、CLI / HTTP 一致、旧编辑器互斥、反向请求与草稿保留 | 隔离样例的浏览器保存和真实 409 冲突；官方实例只读预览；Android 未接入 |
| 批量属性事务 / 恢复 | 前后镜像与意图、提交标记、整体校验、读取／导出屏障、恢复重入、受鉴权的恢复入口 | Linux 子进程 SIGKILL；真实浏览器双对象提交和旧草稿保护；不宣称断电或其他操作系统认证 |
| 对象创建 / 关系追加 | 新身份与路径、JSON 保真、共享归属、引用、图约束、并发及登记恢复 | 合成工程浏览器保存／冲突／恢复；v2 / v3 原生与移动归档往返；移动语义写入未接入 |
| 对象资源绑定（开发源码） | 对象／资源版本、重复用途组合、离线绑定、字节保真、登记恢复 | 浏览器保存／冲突／SIGKILL 后恢复；v2 / v3 原生存储归档往返；移动端仍仅保留数据 |
| 选择式资源包（开发源码） | 依赖闭包、UUID 与字节保真、模板／解析规则、冲突预览、持久恢复、ZIP 校验与取消 | Chromium 实际下载／跨项目导入／索引重建；原生完整迁移兼容；选择式包尚未接入 Android |
| 单素材导出（开发源码） | 图片／视频／音频原字节、文件名与 MIME、取消／重试、缺失与变化拒绝、草稿保护 | Chrome 双入口下载和三语／窄屏；原生保存模块通过，完整桌面选择器待新版验收；Android 未接入 |
| 图片 / 视频 / 音频 | 引用、登记、导入失败、预览竞态、导出保真 | Linux 导入、复用、拖入、播放 / 暂停 / 跳转；Android 只核对包内字节 |
| 文档分享与完整项目包 | Node ↔ Rust 往返、损坏登记、路径边界、变化检测、失败回滚 | Linux GTK 保存 / 取消 / 重试；Android DocumentsUI 导入 / 导出及桌面恢复 |
| 下载收尾与名额回收 | 完整响应、空文件、范围响应、中断、多读者；额外 EOF 读取的确定性复现 | 实际 HTTP 收发后再次导出；旧代码两项失败、修复后通过 |
| 语言与设置 | 三语词典、参数、通知顺序、失败 / 超时、草稿保留 | Linux 英日设置经完整重启保持；Android 中英日切换 |
| 生命周期与恢复 | 写入冲突、创建意图、迁移互斥、恢复草稿 | Linux 关闭确认与子进程退出；Android Home / Back / 强制结束 / 覆盖安装 |
| 原生选择器回执 | 迁移桥的状态及互斥检查 | Android 修复后连续 20 次交替取消、错误后重试，无按钮滞留 |

历史 Linux 四组流程使用 Ubuntu 24.04、WebKitGTK 2.52.6；历史 Android 使用隔离的 Android 15 / API 35 模拟器、WebView 124。0.0.1 另完成两组 Linux 调试宿主及实际 AppImage 流程，以及 API 35 上旧 APK 的保留数据覆盖安装，见 [本次交接](HANDOFF_0.0.1.md)。媒体播放测试静音，不代表实体扬声器测试；Android 测试素材用于文件保真，不代表移动播放已支持。

## 仍需验证

- **Android 实体设备**：中文 / 日文输入法候选字、系统低内存回收、更多 Android / WebView 版本、不同屏幕及厂商系统。
- **Android 文件提供方**：目前验证系统 DocumentsUI 的本地文件；第三方云盘、外置设备和传输途中进程被杀仍待覆盖。调试签名也不等于商店签名更新验证。
- **Windows / macOS 原生交互**：桌面构建配置已经提供，仍需实测文件选择、覆盖确认、媒体解码、生命周期与发行签名。
- **完整大作品和容量边界**：常规测试使用小型隔离样例；多 GiB 迁移、长时间压力、空间不足、不同文件系统，以及临近移动限制的性能仍需专项测试。本次官方作品的独立恢复见 [交接记录](HANDOFF_0.0.1.md)，不据此推导其他磁盘或容量边界已通过。

以下是**尚未实现**，不能通过补测视为已支持：Android 素材访问 / 插入 / 播放、模板配置界面、HTML / Markdown 文档分享、任意外部目录持续编辑；iOS 宿主也未完成。

## 应用检查

使用 Node.js 24，在仓库根目录执行：

```sh
npm ci
npm run check -- --app-only
```

检查包含脚本语法、版本一致性、API 契约和临时样例测试。`npm test` 与检查入口都把测试文件并发限制为 2，避免多核机器同时启动大量临时服务；源码归档语法交叉验证在缺少 Python 时明确跳过。测试输出中的 `skipped` 必须单独记录：未提供原生归档和移动存储工具时，对应跨语言测试跳过，不能计为全部链路通过。`main` / PR 的 **Check application** CI 包含基础应用检查，以及独立的 `compatibility` 任务：构建真实 Rust 工具，执行原生测试、冻结 v1/v2/v3 样例和桌面 / 移动归档互通；这两个任务都不操作实际设备。

要验证自己选定作品的转换结果，再运行 `npm run rebuild` 和 `npm run check`。这两条命令使用当前作品；发布检查使用隔离样例即可，不要求读取日常作品。

## 原生代码及跨语言往返

需要桌面 Rust / 系统依赖。下面采用 POSIX shell 和默认 Cargo 输出路径；使用自定义 `CARGO_TARGET_DIR` 时替换二进制位置。

```sh
npm run desktop:prepare
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo build --manifest-path src-tauri/Cargo.toml --locked --example workspace-archive --example mobile-storage
VIENTO_TEST_ARCHIVE_BINARY="$PWD/src-tauri/target/debug/examples/workspace-archive" \
VIENTO_MOBILE_STORE_BIN="$PWD/src-tauri/target/debug/examples/mobile-storage" \
npm run check -- --app-only
```

`workspace-archive` 使用桌面归档实现，`mobile-storage` 调用真实 Rust 私有存储；联调入口只用于开发，不打进 APK。回归核对原文、BOM、换行、UUID、归属、模板及素材摘要，覆盖 v2 / v3 双向迁移和失败清理。

`full_project_migration_roundtrip` 默认忽略：它需要显式指定大作品并额外占用归档和恢复空间。需要运行时先阅读 [桌面验证说明](../desktop/README.md#验证)，不要为了消除“忽略”计数擅自选择用户作品。

## Linux 原生界面

先构建 `npm run desktop:build -- --debug --no-bundle`，准备 tauri-driver、匹配系统的 WebKitWebDriver、Xvfb、D-Bus、xdotool、xclip、xprop 和具备所需编码器的 ffmpeg。测试脚本自己创建独立设置、显示器与临时作品：

```sh
python3 desktop/tests/native-smoke.py /path/to/tauri-driver /path/to/WebKitWebDriver /path/to/viento-studio
python3 desktop/tests/native-library.py /path/to/tauri-driver /path/to/WebKitWebDriver /path/to/viento-studio
```

通过环境变量扩展覆盖：

| 设置 | 作用 |
| --- | --- |
| `VIENTO_TEST_GENERIC_CREATE=/path/to/workspace-archive` | 在 smoke 流程中创建通用项目、类型和模板，完整归档恢复 |
| `VIENTO_TEST_FIELDS=1` | 配合通用项目执行字段修改、模式往返和字节核对 |
| `VIENTO_TEST_LANGUAGE=1` | 英日语言保存、重启和草稿保护 |
| `VIENTO_TEST_EDITOR_EXPORT=1` | 在 library 流程中执行原生导出保存、过期、取消与重试 |
| `VIENTO_TEST_SCREENSHOT_DIR=/path/to/evidence` | 保留截图及日志；默认随测试目录清理 |

最新四组步骤与日志保存在 [原生流程清单](test-results/native-b.4.5/workflow-milestones.json)。构建安装包后，可将主程序或 AppImage 作为第三个参数再次验收；调试程序通过不代表安装包已经通过。

## Android 设备工作流

构建与 SDK 要求见 [移动端说明](../mobile/README.md)。浏览器联调可以检查编辑器和 Rust 存储，但替代了 IPC 传输，不能代替 Android 设备测试。

新建独立模拟器或使用专用测试手机，按以下顺序验证：导入桌面项目包 → 字段和源码修改 → 保存 / 重开 → 未保存草稿中断恢复 → 保留数据覆盖安装 → 导出并在桌面恢复 → 逐文件比较。另测新建作品与文档、键盘遮挡、三语切换、连续取消、损坏包、重复包及错误后重试。

使用新安装包时记录版本、签名类型、ABI、APK 摘要、系统 / WebView 版本和设备条件。相同代码在模拟器通过也不等于 ARM64 实体手机通过。已有的 [Android 证据](WORKFLOW_VERIFICATION_b.4.5.md#android-原生补测)区分实际触屏 / 系统选择器与 WebView DOM 操作。

## 证据与清理

当前指南说明支持范围；带版本号的报告保存当时的事实。每轮记录基础提交、源码摘要、命令与退出码、通过 / 跳过 / 忽略数、平台和限制。失败复现与修复后结果分别保存，不能删除失败日志后只报通过。

只保留有助于复核的日志、截图和摘要。结束测试进程后，先将需要的产物复制到 `dist/`，再用 `npm run clean -- --dry-run` 核对并清理生成目录。外置 Cargo 目录和自己新建的模拟器不在此命令范围内，应按该轮实际创建的路径单独清理；用户作品、已有模拟器和全局 SDK 保留。

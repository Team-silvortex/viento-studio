# ZIP 双头一致性安全修复

2026-11-04，基于 0.2.8 提交 `7bf21dd4` 的后续源码修复。对应 [GHSA-m665-v7pm-7grj](https://github.com/advisories/GHSA-m665-v7pm-7grj)／CVE-2026-115905，依赖从 zip 4.6.1 更新为 9.0.5，桌面与移动端都显式验证本地文件头与中央目录的一致性。

## 修复及验证边界

- 导入先检查文件数量，再调用上游 `validate_header_consistency()`，通过后才解析清单、读取元数据或创建恢复目录；路径、大小、SHA-256 和登记检查继续保留。
- zip 9 的文件名解码接口返回 `Result<Cow<str>>`，两个原生入口都显式处理错误；移动预检仍返回有界的 400 错误。
- 修复版要求 Rust 1.88，因此仅将宿主 crate 的最低版本从 1.85 调至 1.88；本次运行工具为 Rust 1.95.0。应用版本和作者归档格式未升级，旧安装程序不因此获得修复。
- 锁文件只保留 ZIP 必需更新及三个新依赖，保留其他包原有依赖选择。没有关闭或手工忽略 GitHub 告警；默认分支采用修复后由 GitHub 重新判定。

## 回归结果

旧 zip 4.6.1 下，两条新测试都失败，证明桌面与移动导入会接受 LFH 文件名被篡改的归档。修复后两条均通过：清单与正文各变异一次，拒绝导入且不改原稿／已有项目，不留下目标或移动暂存目录。正常包先作为成功对照，使用无害正文，不执行任何攻击载荷。

隔离原文模块 harness 已按生产最终锁文件验证依赖图；Rust 45 通过、零失败、保留 1 条原有大型真实作品迁移忽略项。Node 原生互通专项 87 通过、零失败／跳过，覆盖桌面与移动、前身 v1/v2/v3、正文／元数据／素材逐字节恢复与 HTTP 导出。完整 Tauri 宿主测试 61 通过、零失败、1 条同名原有忽略项。首次完整应用检查发现新增文件名错误缺少英日翻译；补齐后翻译专项 11/11，随后重跑完整应用检查，最终零失败，结果见下表。

harness 直接编译生产 `workspace.rs`、`mobile_storage.rs` 及官方 CLI 入口，不将其结果误写为 Tauri GUI 或 Android 设备验收。原生程序与编译缓存只在本轮临时目录中生成。

## 命令与证据

| 范围 | 本轮实际结果 | 原始证据 |
| --- | --- | --- |
| 旧依赖安全回归 | 0 通过／2 预期失败，退出 101 | [旧版实际日志](rust-security-before.log)、[基线重建与摘要](baseline-reconstruction.json) |
| 生产原文模块 | 45 通过／0 失败／1 原有忽略 | [日志](rust-core-final.log)、[harness 与命令](native-harness.json)、[66 包依赖子图](native-dependency-graph.json) |
| 正常原生互通 | 87 通过／0 失败／0 跳过 | [日志](node-compatibility-final.log) |
| 完整 Tauri Rust | 61 通过／0 失败／1 原有忽略 | [日志](rust-tauri-final.log)、[命令及环境](rust-tauri-status.json) |
| 首次完整应用 | 8343 通过／1 失败／651 条件跳过；缺英日翻译 | [失败及总计摘录](app-check-initial-failure.log) |
| 翻译补齐专项 | 11 通过／0 失败／0 跳过 | [日志](i18n-final.log) |
| 最终完整应用 | 8344 通过／0 失败／651 条件跳过，零取消 | [完整日志](app-check-final.log) |

Tauri 检查使用 `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml`，仅以 `TAURI_CONFIG` 关闭本轮测试不需要的打包资源和外部程序，做法与 CI 一致；没有生成或更新安装包。应用检查使用 `npm run check -- --app-only`，包含版本、1517 个 JavaScript 文件语法与 API 契约预检；条件跳过不算实际引擎或设备通过。Rust 忽略项为既有 `full_project_migration_roundtrip`，需要额外完整作者作品夹具；本轮另外显式运行了前身 v1/v2/v3 及桌面／移动迁移专项。

所有日志／元数据将本机路径替换为 `<repo>`、`<harness>`、`<baseline-harness>`、`<tauri-target>`、`<cargo-home>`、`<node>`，复现时分别使用本机仓库、全新临时目录与工具路径。

## 复现隔离验证

以 Python 3.11+ 执行 [prepare-native-harness.py](prepare-native-harness.py)，参数为仓库和不存在的新临时目录。默认通过 `#[path]` 直接编译生产原文模块及原 CLI 入口；只把新 harness 的根依赖缩减到归档所需集合。脚本先复制生产锁文件，自动运行离线 metadata 整理子图，并逐包逐边核对源锁；之后运行输出的 Cargo 测试命令。需要离线缓存中的对应依赖；没有缓存时先正常下载。

加上 `--baseline-ref 7bf21dd4d0ef96f20ab6f086b777f2b00f312a70` 可重建旧版最小 Git 快照，仅注入本轮两条新回归，使用旧 zip 4.6.1，预期两条测试失败。脚本不编辑正式仓库文件；记录保存源文件与注入测试摘要。新版本的完整图比对见子图 JSON；两种脚本模式的额外 metadata 核对见 [参数化验证](parameterized-harness-metadata-check.json)，完整原生测试另以正式 Cargo.lock 编译验证。

互通复现先在修复版 harness 中构建 `workspace-archive` 与 `mobile-storage` 两个二进制，随后将其路径传给 `VIENTO_TEST_ARCHIVE_BINARY`、`VIENTO_MOBILE_STORE_BIN`，运行 [native-harness.json](native-harness.json) 所列五个 Node 测试文件。核对完成后可删除自己的临时 harness 和 target；不要把编译产物放进作者工程或本证据目录。

本轮汇总与环境见 [summary.json](summary.json)，对应生产源、测试及复现脚本的 SHA-256 见 [source-hashes.json](source-hashes.json)。未将本轮结果套用到旧发布或旧安装证据。

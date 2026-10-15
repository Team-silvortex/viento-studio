# Bevy Rust 作者行为验收

2026-10-13，0.1.2 后未发布工作树。独立 `org.viento.bevy-rust` 接通已登记 TXT → 显式实例绑定 → 参数／信号编辑 → Cargo 检查 → Bevy 无头运行 → Cargo 源工程交付。旧 `org.viento.bevy` 0.3.0 数据通道继续保留；20 模块／37 项声明能力不变。

## 实现和边界

- 新适配器固定实际 Cargo／rustc 1.95.0，拒绝 rustup 代理；Cargo 文件摘要与包含 rustc 摘要的版本参与冻结工具身份。
- 作者源码原字节复制到 UUID 命名模块；Bevy 0.19.1 的锁文件和固定运行模板随源工程交付。ECS 中保留实例／定义／绑定身份，`ready` 回调读取文本、数字、布尔参数并发送声明过的事件。
- `engine/scene-behavior-events.mjs` 承担共同的 plan／runtime 3 事件准入，Godot 与 Rust 生成和执行分别保留在各自适配器。
- Cargo 使用 `--locked --offline`；依赖需预先缓存。生成清单不含 `target`、二进制或本机配置，临时编译目录在成功、失败、取消和超时后回收。
- 当前只支持 Linux 无图二维行为场景，未接图片、窗口、GPU、行为输入回放、逐帧作者钩子、LSP、热更新或成品游戏发行。源码 ZIP 的接收方仍需要工具链及依赖缓存。

## 验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 完整应用 | 4858 项：4751 通过、107 条件跳过、0 失败；797 个 JS、版本及 API 预检通过 | [最终日志](app-check.log) |
| 适配器边界 | 21／21：取消、超时、观察失败、工具漂移、清理、恶意诊断形状与原文范围 | [最终适配器日志](adapter-final-after-json.log) |
| 生成器与实际 Cargo | 8／8，含双脚本三绑定、迁移执行、错误参数及源字节漂移 | [生成器日志](generator-tests.log) |
| 固定 Rust 模板 | 5／5；格式和 Clippy 通过；包含 JSON 转义后事件帧上限 | [Rust 日志](runtime-template-tests.log)、[Clippy](runtime-template-clippy.log) |
| 共用事件准入／Godot 行为 | 31／31，包含实际 Godot 4.7.2 | [事件回归](neutral-events.log) |
| 界面与脚本起始内容 | 96／96，含新增 8 项 | [UI 日志](ui.log) |
| 宿主与旧后端选择 | 20 项：16 通过、4 条件跳过；编译预算传递到构建及运行，HTTP 无权覆盖 | [宿主日志](host-regression.log) |
| Godot 适配器／控制回放回归 | 19 项：16 通过、3 条件跳过；另跑实物 Godot 控制初始化，8 项中6通过、2双引擎条件跳过 | [回归](godot-adapter-regression.log)、[实物运行](godot-control-real.log) |
| 实际浏览器 | 7 组流程、10 张截图；双脚本、三绑定、三语 390px、编译错误回源及修复、Bevy 三事件、ZIP 异地重建 | [浏览器汇总](browser-summary.json)、[完整记录](browser-1791891439479/browser.json) |
| 准备资源 | 31 项字节一致、8 项复制模块调用通过 | [准备资源](prepared.json) |

专项与全量存在重叠，不相加。完整应用未提供真实工具环境，107 条件跳过包含新 Cargo 实编测试；实际 Cargo／Bevy 和 Godot 分别由表中独立记录补充，不把这些工具测试扩写为其他安装或设备验收。

真实浏览器故意保存 `pub fn broken( {`，Cargo 返回原 TXT 第 11 行，编辑器选择 UTF-16 范围 336–352。经普通编辑和保存修复后，三个绑定分别产生 `multi_0 / 65`、`multi_1 / 20`、`multi_2 / 7`，其中两个绑定在同一实例。截图记录当时界面；精确诊断、选区和运行事件以 JSON 记录为准。

实际下载包为 **77,406 字节**，清单登记 **10 个生成文件、0 个图片资源**，含 Cargo 入口、锁文件、固定运行代码及两份作者 Rust 副本。解包到新目录后离线从零编译并运行，三条行为事件与 Studio 一致。25 项产品／测试源码摘要在最终浏览器流程中保持，浏览器异常为 0。

## 本轮发现与修复

1. Cargo 的 `json-render-diagnostics` 把错误渲染成文本，无法定位原文；改为 `--message-format=json`，真实浏览器证明诊断回源和修复后的运行。
2. 编译取消被后续工具探针覆盖；失败终态现在直接保留，工具检查也分别报告取消与超时。
3. 编译诊断范围不符合原文接口、异常 JSON 形状可抛错；改为受信 UUID 映射、UTF-16 范围与安全回退。
4. 四个合法长字符串经 JSON 转义可超过单帧预算；`emit` 检查含身份、别名、前缀及换行的完整字节，超限归属对应绑定且不入队。
5. 本轮更新共用模块指纹时误将两个模块条目加入 Godot 临时控制文件列表，完整回归发现后移除误加条目，保留正确指纹并验证旧控制回放。

[初次全量失败](app-check-initial.log)、适配器首轮失败和三个浏览器未完成轮次均保留。浏览器第一、三轮分别是测试脚本未进入编辑态、未明确选择成功工程，修正测试脚本后最终完成；第二轮暴露的 Cargo 产品问题已修复。[浏览器汇总](browser-summary.json)逐轮说明。

## 复现

使用 Node 24、Linux Chrome、实际 Cargo／rustc 1.95.0，并先缓存锁文件依赖：

```sh
VIENTO_BEVY_RUST_CARGO=/绝对路径/实际工具链/bin/cargo \
  node scripts/tests/bevy-rust-behavior-smoke.mjs /usr/bin/google-chrome
node scripts/check-project.mjs --app-only
```

普通编辑服务还需选择 `VIENTO_EXECUTION_BACKEND=org.viento.bevy-rust`，并设置 `VIENTO_EXECUTION_TIMEOUT_MS=300000` 为每次冷编译留出预算；操作见 [Bevy 指南](../../BEVY_BACKEND.md)。测试只使用示例的临时副本。

原 **6885** 份历史证据和示例保持原字节。安装中的 0.1.1 AppImage 摘要仍为 `22fb45a03fe2a698ad1eec0b7c655161bd47d1769b5cf6ca7f65b12bce5ccc48`；本轮未更新安装、升版、提交或推送。桌面／移动仅准备资源验证；不代表 Tauri 窗口、Android 设备或移动编译器验收。清理和保留记录见 [汇总](summary.json)、[模板编译清理](runtime-cleanup.json)。

# Bevy Rust 固定步行为验收

2026-10-13，0.1.2 后未发布工作树。`org.viento.bevy-rust` 适配器与固定模板升至 **0.2.0**，Bevy 仍为 **0.19.1**。脚本现在可以按固定时间步移动绑定实例；旧 `ready` 脚本保持兼容。应用版本、20 模块／37 项声明能力、作者格式及 plan／runtime 3 保持。

## 实现范围

- `ready` 可以显式注册一次固定步函数；回调收到从 0 开始的 `tick` 和秒单位的 `delta_seconds`，通过 `position`、`set_position`、`translate` 访问自身实例。
- 内置移动先执行，随后按清单顺序调用行为；同实例后续绑定可见前一绑定成功提交的位置。`idle`／`moving` 根据整个固定步的净位移确定。
- 每次回调暂存位置、注册和事件；成功且未发生接口错误才提交。返回错误、panic 或忽略掉的接口错误均不提交当前回调。已经成功的其他绑定保持；作者 Rust 的任意本机副作用不在回滚范围内。
- 作者写入位置必须有限且在 ±100000 内。每份绑定从就绪到全部固定步累计最多 64 条事件；完整序列化帧仍受 65536 字节预算限制。
- 新增中英日 **Bevy Rust / 固定步移动**起始内容；参数 `velocity_x`／`velocity_y` 和 `moved` 信号仍由独立行为编辑器明确配置。GUI 只创建源码和声明，回调生命周期及位置规则在 Rust 执行层。

Studio 当前执行两步、每步 0.25 秒的有限无头测试。没有新增图片、窗口、GPU、行为输入回放、LSP、热更新、3D 行为或跨实例写入。交付仍是含锁文件的 Cargo 源工程，需要接收方自己的匹配工具链和依赖缓存。

## 验证结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 完整应用 | 4859 项：4751 通过、108 条件跳过、0 失败；799 个 JS、版本及 API 预检通过 | [完整日志](app-check.log) |
| Rust 固定运行模板 | 17／17；格式与禁止警告的 Clippy 通过 | [单元测试](rust-test.log)、[格式](rust-fmt.log)、[Clippy](rust-clippy.log) |
| 原生固定步执行 | 16／16；一次离线编译、19 份异地场景 | [执行日志](native-workflow.log)、[工具及源码摘要](native-workflow-summary.json) |
| 旧就绪脚本／生成器 | 8／8，包含实际 Cargo、独立绑定与异地执行 | [兼容回归](legacy-generator.log) |
| 起始内容与界面 | 37／37，含原样草稿、三语切换及旧模板保持 | [作者侧回归](authoring.log)、[摘要](authoring-summary.json) |
| 适配器／生成器／共用事件 | 42 项：41 通过、1 原生条件跳过、0 失败 | [定向回归](backend-regression.log) |
| 真实 Chrome | 7 组流程、10 张截图、0 浏览器异常；编译失败回源修复及 ZIP 异地重建 | [浏览器汇总](browser-summary.json)、[完整记录](browser-1791892801455/browser.json) |
| 桌面／移动准备资源 | 31 项字节比对、8 项复制模块调用通过 | [副本记录](prepared.json) |

专项与全量重叠，不相加。全量未配置实际引擎，108 条条件跳过包括原生 Cargo 测试；本轮实际 Cargo／Bevy 由独立记录补充。未重跑桌面宿主 Rust 安装套件；准备副本不代表 Tauri 窗口、Android 设备或移动编译器验收。

原生场景覆盖关闭输入后的作者移动、独立实例、就绪初始位置、同实例顺序、内置输入叠加／抵消、净位移状态、错误／panic、NaN／Infinity／越界、重复／过晚注册、参数归属、累计事件上限和 32 绑定预算。Rust 单元直接断言失败回调的位置回滚；进程级测试断言失败回调没有事件泄露、没有成功结束帧。

真实浏览器通过内置入口原样创建移动脚本，再配置双脚本三绑定。旧脚本两次产生就绪事件；新脚本的 `velocity_x=24`、`velocity_y=-8` 将关闭方向控制的实例从 `[500,220]` 依次移动到 `[506,218]`、`[512,216]`。另一个旧实例保留内置移动，最终 `[220,220]`、`idle`；作者移动实例最终为 `moving`。

故意保存的语法错误定位到原 TXT 第 16 行，选中 UTF-16 范围 489–505；普通编辑与保存修复后成功运行。实际下载 ZIP 为 **100094 字节**、**10 个生成文件／0 个素材**；在新目录离线从零编译，事件及最终坐标与 Studio 一致。25 份源码摘要保持。已目视运行面板与日语窄屏绑定清单；截图反映捕获时界面状态，运行图尚在启动，最终事件和精确选区以 JSON 断言为准。

首轮定向回归唯一失败是测试把旧 ECS 元组组件的源码写法当成契约；移除该实现形状断言，保留实际 ECS 执行、来源及编译验证。[原始失败日志](backend-regression-initial.log)继续保留。

## 复现与保留

使用 Node 24、实际 Cargo／rustc 1.95.0、Linux Chrome，并预先缓存锁文件依赖：

```sh
VIENTO_BEVY_RUST_TEST_CARGO=/绝对路径/实际工具链/bin/cargo \
  node --test scripts/tests/bevy-rust-fixed-step.test.mjs scripts/tests/bevy-rust-project.test.mjs
VIENTO_BEVY_RUST_CARGO=/绝对路径/实际工具链/bin/cargo \
  node scripts/tests/bevy-rust-fixed-step-smoke.mjs /usr/bin/google-chrome
node scripts/check-project.mjs --app-only
```

浏览器测试只使用示例的临时副本，不读取真实作品。**6956** 份旧验收文件与示例逐字节保持；现有 AppImage 摘要不变，详见[保留检查](preservation.json)。清理经指纹确认的本轮编译缓存及桌面准备副本，共 **476102277 字节**（约 454 MiB），移动准备资源及已有依赖保留，详见[清理记录](cleanup.json)。本轮未更新安装、提交、推送或发布。

接口与操作详见[Bevy 指南](../../BEVY_BACKEND.md)、[固定步行为](../../SCENE_BEHAVIORS.md#bevy-rust-固定步行为)；机器可读结果见[本轮汇总](summary.json)。

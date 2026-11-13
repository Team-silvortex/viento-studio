# 场景 HUD 分层验证（0.2.9 之后工作树）

2026-11-11。新增独立 HUD 作者文档、文本／状态条编辑、三文件创建恢复、冻结准入、Godot 屏幕显示及迁移。应用源码仍为0.2.9，本机安装仍为0.2.0。本轮没有提交、发布或安装。

## 通过范围

| 层次 | 结果与实际条件 | 原始记录 |
| --- | --- | --- |
| 全部新增测试 | 76项：72通过、4原生环境条件跳过，零失败／取消；2634来源守卫与完整检查起点一致 | [定向回执](targeted/final-source.json)、[日志](targeted/new-hud-tests.log) |
| 纯作者／显示／创建 | 25/25；严格UTF-8、码点／控制字符、九锚、状态显示、空HUD、版本与来源 | [纯与宿主回执](pure-host/viento-hud2d-pure-host-evidence.json) |
| 独立冻结准入 | 9/9；Scene1/2/3、member／assembly并集、provider／producer独立拒绝能力省略，noHUD旧回执保持 | 同上，另见定向日志 |
| 真实创建恢复 | 20/20；workspace2/3、9处SIGKILL、提交前后重入恢复、外部冲突、伪造证据、响应丢失与并发 | 同上；旧相机纯32项另作对照，总组86/86，不与新76项相加 |
| 作者服务／界面／迁移 | host2/2、UI8/8、包5/5；Scene1/2版本保存、顺序和样本、原字节保留、新根目录重建、伪造包与最终外部依赖复验 | [新增测试日志](targeted/new-hud-tests.log) |
| Chrome实际作者链 | Chrome156，105断言、33源码守卫、31作者文件；三语390px、9张截图，真实409保留草稿→重新审阅→仅HUD正文更新／重开 | [最终报告](browser-final-2026-11-11/browser.json) |
| 真实 Godot | 4/4；Godot4.7.2本机独立音频清理修订、Xvfb／Mesa llvmpipe软件OpenGL；15观察、九锚、4PNG、6次作者状态事件且HUD不增状态；相机移动／缩放／边界、resize、场景重入释放、冻结同帧像素及标准ZIP离线运行 | [汇总](native-frozen-final-2026-11-11/summary.json)、[来源](native-frozen-final-2026-11-11/source-guard.json)、[实际作者状态／窗口](native-frozen-final-2026-11-11/window-author-state.json)、[离线交付](native-frozen-final-2026-11-11/offline-delivery.json) |
| 后端回归 | 新3/3，连同旧相机／边界共9/9；无HUD plain23文件/0.34、camera1 30文件/0.43、camera2 32文件/0.44，全部字节／sourceMap／cap／生成版本保持 | [后端日志](native-frozen-final-2026-11-11/backend-final.log)、[无HUD回执](native-frozen-final-2026-11-11/nohud-receipt.json) |
| 完整应用 | `npm run check -- --app-only`：版本、1617JS语法及API预检通过；9370项：8690通过、680环境条件跳过，零失败／取消；2634源码前后不变 | [状态](full-check-status.json)、[完整日志](full-check.log)、[运行前来源](full-check-sources-before.json)、[运行后来源](full-check-sources-after.json) |
| 保全与图谱 | 此前5专题292文件、13020份HEAD历史证据和83个已有GD／文本逐字节保持；图谱只追加新条目，旧全部对象和评分保留 | [保全](preservation.json)、[图谱追加回执](atlas-append-receipt.json) |

## 发现并修复的实际问题

- **冻结同帧渲染**：仅在 `frame_pre_draw` 改数值条节点时，节点已经75%而该帧PNG仍50%。新增HUD层在继承的禁用通知中同步刷新，原场景和旧smoke渲染边界保持；严格同帧像素回归通过，没有多等待一帧来掩盖。原失败见 [像素日志](native-frozen-final-2026-11-11/exploratory-pixel-failure.log)。
- **多行示意**：原Canvas单行绘制会误示作者允许的CR/LF；现按真实Godot探针逐换行绘制并裁剪，TAB保留同行。字形／行距明确只是示意，不承诺与引擎逐像素一致。
- **HUD确定拒绝恢复**：字段／依赖的422属于写入前或锁内确定拒绝，现保留表单并允许核对重审，不再误判为未知提交结果。

首轮测试自身问题亦保留：纯测试括号笔误；旧隔离VM未加载新的多行依赖／指纹顺序不匹配；新native测试误读旧事件前缀。对应原败分别在 [纯日志回执](pure-host/viento-hud2d-pure-host-evidence.json)、[最初旧构建回归](targeted/viento-hud2d-legacy-focus.log)、[native探索日志](native-frozen-final-2026-11-11/exploratory-first.log)。修正仅对应问题；随后完整源码冻结重新检查通过。早期Chrome记录保留原时点，最终报告含多行修正和最终英日文案。

## 合同与未证明部分

操作与作者合同见 [场景HUD](../../SCENE_HUD2D.md)，目标见 [0.5.0完整游戏出口](../../MILESTONE_0.5.0.md)。首次显式创建HUD使用事务v14；Scene2D与运行事件协议不升级，旧日志继续读取。Godot执行descriptor和HUD外层为0.45.0，无HUD生成版本按原内容选择，源码fingerprint按实际实现更新。

本轮HUD只有只读文本／数值条，忽略鼠标与焦点。未证明菜单按钮、图标／字体资源、暂停／重开全流程、跨启动存档、30分钟持续交互或独立游戏发行。`.viento-build.zip` 仍需引擎工具；离线ZIP验证不是无需Godot的发行。Xvfb软件图形不证明硬件GPU、Bevy、Windows／macOS／Android或新安装程序。

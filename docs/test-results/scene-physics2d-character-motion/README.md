# 二维角色重力与跳跃验证

2026-10-25；基线 **0.2.3 / `eb1e08984fad04722c54f682c1ceba9b531f8fe0`**，接在物理观察开发工作树之后。本轮新增显式物理作者 **schema 3** 的 `characterMotion`、独立核心检查能力和 Godot **0.24.0** 运动包装。应用未升版，本机安装仍为 0.2.0。

## 完成范围

既有物理字段编辑器中选择重力与跳跃，设置重力、起跳速度、最大下落速度，经检查、完整原文审阅、应用草稿与普通保存，再从项目组装构建运行。角色使用显式 delta 积分、左右运动和着地后的按键边沿跳跃；真实碰撞仍由 Godot 求解。可通过原观察协议查看位移和碰撞，参数及脚本随生成工程交付。

核心、原文提案、计划与能力、字段控制器、宿主和 Godot 求解保持分层。`scenePhysics2D.inspectMotion` 独立于旧 schema 1／2 操作；新运动需要滑动响应，关闭后保留 schema 3，旧文档不会自动迁移。项目协议 4／7／10／11、观察协议 1、Scene2D 和项目组装格式保持。

## 实际验证

| 范围 | 结果与证据 |
| --- | --- |
| Rust 原生 | [完整 411/411](rust-full.log)，包含362个单元与49个集成测试；[物理定向12/12](rust-targeted.log) |
| 同源 WASM | [构建日志](wasm-build.log)，744693 bytes，SHA-256 `6bd689796b0c6de18c8b129b8811e88abc7d4f140cf8ff71d489ed3539a9a014` |
| 核心、保真编辑 | [新旧68/68](core-edit-js.log)，新 motion core9项、edit11项；[旧ABI/创建/空间47/47](core-edit-regression.log)，准确命令见[记录](core-edit-commands.txt) |
| 中立计划及构建准入 | [31/31](plan.log)，含新7项：冻结来源、独立能力、关闭后格式保持、伪造能力与不支持后端拒绝 |
| 界面及邻接 | [新motion20＋旧response12](ui-tests.log)；[定向99/99](ui-regression.log)，包括空间手势和翻译；[命令](ui-commands.txt) |
| 真实 Godot | [15/15、0跳过](backend-native.log)，其中2个兼容/库存测试、13个原生场景；[完整机器证据](backend-native.json) |
| 真实 Chrome | [成功报告](browser-1792921479654/browser.json)：8条流程、8张截图、28个源码摘要、39个作者文件；仅显式Save修改1份物理文档，30条真实观察样本 |
| 完整应用检查 | [8081项：7688通过、393条件跳过、0失败/取消](full-check.log)；版本、1336个JS语法与API预检通过；[退出状态0](full-check-exit.json) |

各组存在交集，不相加为覆盖率。工具为 Node.js 24、Godot **4.7.2.stable.official.ed1daf0bf** 与 **Chrome/154.0.8037.97**；真实浏览器使用隔离本地 HTTP 服务和临时作者工程。原生工具身份与摘要见机器报告。

## 验收结果

- 角色先下落、落地后继续沿地面水平移动；短跳上升后落回地面，长按和空中再次按键只产生一次起跳。碰顶、墙面碰撞、下落限速、`controls:none` 受重力和零起跳速度分别验证。
- 同场景内旧自由平面角色仍接受原四方向运动，未配置物理的实例仍按原规则移动。场景重入重建速度、着地及按键状态；实时运行与烟测共用同一次运动，实时运行不发 smoke 观察流。
- [窗口截图](backend-window.png)来自实际窗口截图通道；[生成工程 ZIP](character-motion.zip)在原 author/build 目录改名后搬迁解包，重新 import、script-check 与运行，通过30条观察验证。ZIP仍是需要Godot工具的工程，不是独立游戏安装包。
- 浏览器由 schema 1 开始，经表单显式启用新模式，保留 BOM、CRLF、转义键及原有数字写法；应用草稿时未写磁盘，普通保存只修改目标物理 JSON。重新打开可关闭模式并审阅，取消保持保存内容。
- Chrome观察记录第7步起跳、第22步落地，早期沿地移动与接触法线可核对。筛选、步骤前后选择和碰撞双方原文导航不改运行位置或作者文件。
- [桌面字段](browser-1792921479654/motion-review-desktop.png)、[英文390px](browser-1792921479654/motion-values-en-390.png)与[日文390px](browser-1792921479654/motion-values-ja-390.png)已目视；三语均保持焦点、审阅内容和可达按钮，无横向溢出。
- 可选核心能力按候选格式选择：schema 3 不依赖旧 response marker，但即使关闭全部 motion 仍需要 motion marker；打开、检查及应用阶段的能力撤回/恢复和迟到结果均受保护。

## 边界与保留

本轮只提供基础 platformer 控制；没有动态刚体、材质、关节、平台吸附、单向／移动平台、跳跃缓冲、土狼时间或正式着地事件。法线接触用于当前控制器的下一步起跳判定，不能当作对外的持续接触状态接口。普通半秒烟测不自动按跳跃键；验收行为按已完成逻辑步给测试输入，内部 observation_step 不是公开作者API。起跳速度120用于在既有半秒内覆盖完整跳跃，不把结果写成默认360速度的完整周期验收。

Bevy、3D物理、Android、新Tauri安装和实体键盘验收不在本轮范围。旧物理、响应、观察8个生成器/runtime文件、历史报告与作者样例通过[保留摘要](preservation.json)核对；旧图谱对象只追加新功能，不重标旧评分。文档[链接检查](links.json)和[图谱检查](atlas-check.log)另行保存。

[后端调试摘要](backend-attempts.log)记录测试输入过早与混合角色预期错误；初次失败的原始终端输出未另行归档，最终原生矩阵的完整日志已保存并全部通过。第一轮[浏览器失败报告](browser-1792921421837/browser.json)记录验收脚本误把落地后的水平位移也要求为正，但通用烟测已在第15步释放右键；修正断言后通过，产品代码未改。[首次完整检查日志](full-check-interrupted.log)只完成预检，进程退出143，没有完整测试结论；单独保留，不记为通过。

## 复现

```sh
cargo test --manifest-path crates/viento-studio-core/Cargo.toml --locked
node scripts/build-studio-core.mjs
node --test scripts/tests/scene-physics2d-motion-core.test.mjs scripts/tests/scene-physics2d-motion-edit.test.mjs scripts/tests/scene-physics2d-character-motion-plan.test.mjs scripts/tests/scene-physics2d-character-motion-ui.test.mjs
VIENTO_GODOT_BIN=/absolute/path/to/Godot node --test scripts/tests/scene-physics2d-character-motion-backends.test.mjs
VIENTO_GODOT_BIN=/absolute/path/to/Godot node scripts/tests/scene-physics2d-character-motion-smoke.mjs /absolute/path/to/google-chrome
npm run check -- --app-only
```

窗口截图测试另需 `VIENTO_PHYSICS_MOTION_CAPTURE` 和显示服务；机器结果可通过 `VIENTO_PHYSICS_MOTION_REPORT` 写入新的独立路径，不能覆盖既有证据。运动使用显式步长而非隐式 `move_and_slide()` 时钟，API语义参考[Godot CharacterBody2D](https://docs.godotengine.org/en/stable/classes/class_characterbody2d.html#class-characterbody2d-method-move-and-slide)；具体接入以本轮实测为准。

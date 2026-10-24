# 逐实例动画正式运行验收

应用版本保持 **0.2.0**。用户明确批准后，58文件补丁已应用到正式项目，Rust/WASM已重建；接通动画作者格式4、动画子计划3，以及仅instance项目使用的运行协议11／Godot适配器0.20.0／生成清单12。见[应用回执](application.json)、[最终汇总](summary.json)与[使用说明](../../SCENE_ANIMATION.md#为正式运行选择播放范围)。

## 完成的工作流

1. 动画编辑器显式选择“每个实例独立播放”，检查、审阅并应用普通草稿，再由主编辑器保存。旧格式1–3读取不升级；返回scene并取消不写入。
2. 项目组装从保存态冻结范围。逐实例播放以访问、场景和实例为身份，默认停止；多个绑定属于同一实例时共享播放状态并按队列执行。整场景范围保留原行为。
3. 运行命令携带明确目标，完成通知保存本目标最后命令序号与全部命令截止。其他实例命令不撤销本实例完成；同目标新命令使旧通知失效。状态进入、事件投递和来源回看分别校验。
4. 运行面板展示实例目标及完成锚点，并保留共享状态、事件、音频、控制器历史和来源导航。独立工程ZIP脱离作者／原构建路径后运行通过。

正式stop保留当前片段并采样局部0；临时图形预览stop撤销覆盖、恢复静态，两者是独立会话。单独场景构建明确拒绝instance范围，需使用项目组装；已保存场景的图形预览仍可独立使用。

## 正式源码验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 完整 `npm run check` | 7415项：7054通过、361条件跳过、0失败／取消 | [最终日志](app-check.log) |
| Rust完整核心 | 399/399通过 | [日志](rust.log)、[WASM构建摘要](core-build.json) |
| 运行面板及相邻契约 | 59项：57通过、2条件跳过、0失败 | [日志](host-contracts.log) |
| Chrome正式创作流程 | 6条链路、5张截图，零页面异常 | [浏览器报告](browser-scope-1792819557897/browser.json) |
| Godot逐实例运行 | 18/18通过，零跳过 | [日志](native/target.log) |
| Godot旧p7／p10兼容 | 3/3通过，零跳过 | [日志](native/legacy.log) |
| 独立工程ZIP | 1/1通过，零跳过 | [报告](native/delivery/report.json)、[日志](native/delivery.log) |

1230份JavaScript语法、应用版本与API契约预检、885份文档严格校验、19份模板及885唯一索引均通过。各组覆盖重叠，不相加；全量中的条件跳过不计作真实后端通过。此次源码验证不代表已安装Tauri、Android或Godot图形窗口验收。

Chrome验证旧schema3无迁移、scope完整审阅、BOM／CRLF保真、普通保存、取消与临时预览独立、中英日390px焦点与无横向溢出；保存只改变指定动画，13份其他作者文件保持。实际正式运行需要项目组装的限制也由真实适配器生成入口验证。

Godot涵盖同定义双实例不同播放进度、多个绑定共用目标、全部片段／四视觉属性及序列帧、独立自然完成、跨目标命令、状态控制器、混合范围、多场景重入和端口身份固定。ZIP包含42文件／26份GDScript，移走原作者及构建路径后产生12条命令、2次完成、6次状态进入；36份交付作者夹具字节保持，见[原生汇总](native/summary.json)。

最终源码与浏览器报告29份来源、原生报告241份来源及66份示例的SHA一致，见[完整性核对](source-integrity.json)。10份旧Godot模板与HEAD保持原字节，既有作者v1–v5脚本不重写。WASM为736460字节，SHA256 `24f048fc124a06338a7f9e68b8c0eb196f7df34362947530bc664d573a07ad3c`。

## 全量检查发现并修复的遗漏

新增的真实构建宿主集成测试发现：协议11动画数据已准入，但共享状态／事件／音频／事件回看四个入口仍只放行至协议10，导致相应面板隐藏。已修复四处过滤，并增加协议11事件→动画进入→控制器回看的联动回归。首轮全量7414项中仅此1项失败；[原始失败](app-check-first.log)与[修复后的最终日志](app-check.log)分别保留。[补丁应用后的调整](post-application-adjustments.json)同时记录当前descriptor断言及未知未来协议测试的更新。

## 契约与范围

- Rust增加可选能力标记，旧ABI／能力不改；旧格式1–3及协议1–10继续严格读取。scene范围的普通动画／状态控制器分别保持p7／p10，无动画项目保持p4。
- Godot目标端口按实际对象身份登记冻结visit／binding／behavior，公开binding字段替换不能冒用其他绑定。此约束不构成任意GDScript沙箱。
- 暂不包含Bevy、3D、骨骼、动画混合或同实例多控制器仲裁。源码版本未递增，本轮未提交推送、发布或更新安装。
- 架构、操作、后端、事件、行为、状态、路线和测试文档已同步；图谱为154功能／459实现／667绑定／2668评分／117工作流。既有2640评分及2781证据对象原样保留。新能力交付评分仍为工作树范围。

## 重跑

在项目根目录，使用本机Node24与Rust工具链：

```bash
npm run core:build
cargo test --manifest-path crates/viento-studio-core/Cargo.toml --locked
npm run check
node scripts/tests/scene-animation-runtime-scope-smoke.mjs /usr/bin/google-chrome
VIENTO_GODOT_BIN=/绝对路径/Godot node --test scripts/tests/project-animation-target-godot.test.mjs
VIENTO_GODOT_BIN=/绝对路径/Godot node --test scripts/tests/project-animation-target-delivery.test.mjs
node scripts/function-atlas.mjs --check
```

旧协议专项使用 `VIENTO_GODOT_BIN=/绝对路径/Godot node --test --test-name-pattern='real old author format naturally completes|real v1 preserves initial' scripts/tests/project-animation-completion-godot.test.mjs scripts/tests/project-animation-state-entry-trigger-godot.test.mjs`，结果见[原生日志](native/legacy.log)。测试只使用临时作品副本。每次浏览器生成新证据目录；安装版和用户作品不是写入目标。`pre-approval/`保留批准前隔离草案的原始结果，其中“未应用”描述属于历史时点；正式源码结果以上述记录为准。文档新增链接通过；状态类文档中20处既存旧锚点单独记在[链接报告](status-doc-links.json)，不改写历史专题。

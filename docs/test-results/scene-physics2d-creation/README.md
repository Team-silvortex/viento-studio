# 从场景首次创建二维物理

本轮在 0.2.1 后工作树补齐“保存态场景 → 物理创建审阅 → 三文件保存 → 已有字段编辑 → 普通保存 → 项目构建运行”。当前 23 模块／45 项声明能力，版本保持 0.2.1，安装保持 0.2.0；没有提交、推送或安装更新。

## 保存与模块边界

`physics2d.create` 独立验证 64 KiB 物理正文、稳定实例归属、世界和场景修订。一次创建新正文、新登记和场景元数据关联，保持场景正文与素材。日志 v12 保存有界冻结依赖证据，保留旧日志兼容；恢复不复原作者依赖正文。UI 只通过窄端口读取、预览、保存、刷新和导航，未知保存结果重新读取核对，禁止重复提交。

默认创建一个 character / box 32×32 物理体，可选择静态或传感器、圆形、偏移及层掩码。已有关联时直接打开文档。静态／传感器有效 controls none、speed 0 仍由构建预检检查。没有新增动态刚体、重力、材质、关节、3D 或 Bevy 物理实现；没有改变物理作者 schema、Rust/WASM、Godot 适配器或运行协议。

## 验证记录

最终定向测试 **101/101 通过**；[完整检查](full-check.log) **7762 项：7395 通过、367 条件跳过、零失败／取消**。1289 份 JavaScript、版本与 API 预检、885 份文档／索引和 19 份模板检查通过。数字见 [checks.json](checks.json)，专项日志见 [focused-final.log](focused-final.log)。条件跳过保留各测试原工具约束，不算原生设备通过。

[最终浏览器报告](browser-1792834009110/browser.json)覆盖 **6 条流程／12 张截图**：挂起目录请求时取消、显式形状参数与完整审阅、中英日 390px 焦点和未完成数字保留、丢失真实提交响应后的只读核对、进入已有字段编辑器和普通保存、重开已有声明。36 份执行依赖指纹与当前实现完全一致。

临时作者工程 37 份文件在创建后为 39 份：仅新增物理正文和登记、修改场景元数据，原场景／素材／其它作者字节保持。后续字段编辑将角色改为圆形半径 12、偏移 X=2，并添加传感器与墙；应用只改草稿，普通保存只改物理正文。真实 GUI Plan／Build／Run 成功，Godot 角色停止于 **x=130.9958038330078**，收到 `physics.entered`／`physics.exited`，动画状态 **idle → action → idle**；该工程仍使用既有项目协议 10。

实际 HTTP 测试发现新路由漏接认证／JSON 请求分类，修复后四项测试通过；独立审查发现合法长元数据被误套物理正文 64 KiB 上限，改为结果单字符串 1 MiB、合计 4 MiB，物理源文本继续严格 64 KiB，并补回归。九处 SIGKILL、可重入恢复、冲突和伪造证据测试通过；旧事务专项另为 224 通过／6 条件跳过，各专项与全量重叠，不相加。

前三次浏览器运行的记录各自保留，最终结论使用上述报告。完整检查首轮的 10 项失败记录见 [初次日志](full-check-first.log)：9 项是旧能力总数断言，1 项是英文重复词条；修正后受影响测试 [85/85 通过](regression-fixes.log)，再重跑上述全量。截图已人工查看完整原文／双向关联、英文窄屏字段、日文窄屏操作及运行记录。

[保留审计](preservation.json)确认 **9743 份既有作者／示例／历史报告文件无变化**；旧图谱轴和数组对象保持前缀一致，包括 2736 个评分及 2899 条证据。新图谱为 **160 功能／478 实现／688 绑定／2752 评分／124 工作流**。当前工作树 23 模块／45 项声明能力；该增量未发布或更新安装。

复现：

```sh
node --test scripts/tests/world-physics2d-create*.test.mjs scripts/tests/scene-physics2d-create*.test.mjs scripts/tests/scene-physics2d-creation*.test.mjs
VIENTO_GODOT_BIN=/absolute/path/to/Godot node scripts/tests/scene-physics2d-create-smoke.mjs /usr/bin/google-chrome
node scripts/check-project.mjs
```

本轮验证范围为 Linux HTTP 编辑器、Chrome 和受支持的 Godot 无头工程执行；未验收 Tauri 原生窗口、Android、其他平台设备或新的安装产物。

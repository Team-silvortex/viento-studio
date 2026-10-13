# 多演员起始配方验收

2026-10-13，源码版本仍为 0.1.1，本轮功能属于未发布工作树。结构化结果见 [summary.json](summary.json)。

## 新增行为

“新建场景配方”提供 1–64 项演员列表。每项独立选择对象／二维投影、局部标识、位置和继承方式；同一对象可以多次实例化。添加只初始化新项，删除只移除当前项，存留实例及放置身份保持。切换保留未完成坐标与已有审阅；实际编辑、增删会撤销审阅，任一行无效会拒绝整份创建。

完整审阅后仍进入一份普通 JSON 草稿，保存才创建文件和登记。纯规划兼容旧单演员请求，共享 Rust 继续检查原配方格式；服务、普通保存、后端协议及模块数量均不扩张。仍为 **20 模块／37 项声明能力**。

普通对象沿用原先的方向键控制，界面明确提示多个演员会共同移动；更细控制继续交给已有片段编辑器。起始助手的 64 项上限与已有配方格式预算分别维护。

## 验证

- [完整应用](full.log)：**4676** 项中 **4570 通过、106 条件跳过、0 失败／取消**，774 个 JavaScript 文件语法及 API／版本预检通过。
- 新增 **23** 项测试：纯核心 10、独立 UI 10、普通保存宿主 3；均包含于完整应用。核心共 [22](core.log)、UI 共 [29](ui.log)、宿主与只读服务共 [19](host-service.log)、翻译与原脚本助手兼容共 [22](ui-compatibility.log)，各组与全量重叠，不相加。
- [真实 Chrome／Godot](browser-1791883500843/browser.json)：**6 组、16 张截图，首次运行通过**。空工程 GUI 创建 OC／游戏投影及三个演员，保存、预览、生成独立 Scene2D、计划／构建／运行连续完成。两个同投影演员各移动 45px，普通 OC 移动 40px；同源不同实例、混合继承和坐标保持。
- 浏览器还覆盖移除中间项时其他身份保持、未完成负号切换保留、字段修改使审阅失效、取消无写及中英日 390px；关键截图已目检。路径冲突后完整三演员草稿重试另由宿主测试验证。
- [准备资源](packaged-resources.json)：39 次精确字节比对，桌面／移动两套复制的核心与 WASM 执行旧单演员和三演员草稿；重复身份、过期 World 拒绝及实际副本界面门槛 10 项通过。

代表截图：[演员列表](browser-1791883500843/multi-actor-zh-CN-390-list.png)、[未完成坐标](browser-1791883500843/unfinished-coordinate-preserved.png)、[日文审阅](browser-1791883500843/multi-actor-ja-390-source.png)、[Godot 结果](browser-1791883500843/multi-actor-godot-result.png)。

## 保留范围

17 份产品／验收脚本在实际浏览器运行前后以及最终核对时保持相同。隔离临时工程已清理；原 OC、投影、模板等作者文件保持，正常创建只新增所需正文与登记。安装包摘要保持上一轮值，未替换或重启正在运行的应用。[保留审计](preservation.json)还核对 866 份旧记录／示范文件；1796 个评分值及 1776 个无关功能单元保持。

旧单演员专题记录继续保留，不重写或重标为本轮多演员证据。106 条件跳过不计通过；真实 Godot 在独立浏览器流程启用。本轮不包含新安装、Android 设备、媒体导入、作者行为、工程 ZIP、Bevy 或图形游戏验收。

## 复现

专项：`node --test scripts/tests/scene-composition-create*.test.mjs`。完整应用：`node scripts/check-project.mjs --app-only`。

设置 `VIENTO_GODOT_BIN` 为可信 Godot 可执行文件绝对路径，运行 `node scripts/tests/scene-composition-multi-create-smoke.mjs /usr/bin/google-chrome`。它在本专题新建唯一证据目录，不覆盖旧报告。

准备资源使用 `node desktop/prepare.mjs --resources-only` 和 `node mobile/prepare.mjs`，再运行本目录 [verify-prepared-resources.mjs](verify-prepared-resources.mjs)。仅核对报告列出的文件与复制模块，不等同安装包验收。

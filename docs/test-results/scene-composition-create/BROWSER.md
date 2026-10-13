# 新建场景配方：实际浏览器验收

2026-10-13；最终报告：[browser-1791881088567/browser.json](browser-1791881088567/browser.json)。紧凑摘要及文件摘要：[browser-acceptance.json](browser-acceptance.json)。

6 组工作流、14 张截图全部通过；Chrome、Node、Godot 版本与 SHA-256 在报告中。17 项产品与验收脚本在运行前后字节一致。隔离作品库、浏览器配置、缓存均已清理。

1. 从空白工程开始，新配方入口显示缺少对象的提示，禁止凭空创建演员，取消无写。
2. 通过普通“世界与对象”界面创建 OC，再创建 RPG 玩家投影；设置宽高 72×88、移动速度 180、蓝色外观，投影关联原 OC。
3. 读取目录期间允许取消，迟到响应不恢复旧对话框；显式审阅完整 JSON。中文、英文、日文 390px 下保留设置，标题及返回、审阅、创建、取消始终可达，正文独立滚动。取消不改编辑器或作者文件。
4. 创建进入普通未保存原文草稿。审阅后外部占用目标文件，普通保存拒绝覆盖，既有字节和草稿均保留，也不登记元数据；只移除测试占位文件后重试，保存准确的审阅内容与一份登记。
5. 新配方进入实际场景预览，正确使用投影宽高、颜色、控制和移动速度；已有材料化入口生成独立 Scene2D，保留相同演员身份与 `useProjectionDefaults`，不把有效值填平为显式覆盖。
6. 实际 Godot 检查计划、生成工程、无头运行全部成功；演员沿 X 移动 45px（速度 180），身份不变。等待界面同步显示“已完成”后截图；运行不改作者数据。

原 OC、投影、项目清单和模板逐文件比较；配方保存仅新增 JSON 与登记，材料化再仅新增独立 Scene2D 与登记。

## 截图

- [中文表单](browser-1791881088567/recipe-zh-CN-390.png)
- [英文表单](browser-1791881088567/recipe-en-390.png)
- [日文 JSON 审阅](browser-1791881088567/recipe-ja-390-source.png)
- [路径占用后草稿保留](browser-1791881088567/occupied-path-draft-preserved.png)
- [Godot 完成状态](browser-1791881088567/godot-inherited-player-result.png)

## 范围与重跑

实际 Chrome + HTTP 编辑器与可信 Godot。空白项目由生产模板目录生成；项目库新建入口、Tauri 安装、Android、原生文件选择器、资源导入、作者行为脚本、ZIP 交付、图形游戏画面及独立游戏可执行文件不计入本次范围。后续阶段沿用其各自验收证据。

设置 `VIENTO_GODOT_BIN` 为可信 Godot 绝对路径，然后以 Node 运行 `scripts/tests/scene-composition-create-smoke.mjs /usr/bin/google-chrome`。默认在本目录新建唯一 `browser-*` 证据目录；可通过 `VIENTO_COMPOSITION_CREATE_OUTPUT` 指定本目录内尚未使用的目录。脚本不会覆盖旧证据。

保留了两次测试自身错误的失败记录：临时项目名称误含路径分隔符，以及 CDP 多语句表达式遗漏包装。另有一轮全通过记录；最终轮补强了界面完成状态等待和三语截图取景。均未通过放松产品断言取得通过。

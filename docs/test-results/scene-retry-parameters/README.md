# 官方重试脚本：参数起始项与空白两场景试点

2026-11-13；源码保持 **0.2.9**，本机安装保持 **0.2.0**。当前用法见[行为参数](../../SCENE_BEHAVIORS.md#官方重试脚本的参数起始项)与[重试配置](../../SCENE_RETRY.md#在内置编辑器中配置)。本轮不改官方脚本、运行协议、作者格式、后端或现有示范。

## 新增行为

保存当前 **Godot / 按动作重试关卡** TXT 并关联到实例后，首次绑定仍为空参数。**脚本参数接口 → 补齐缺失参数** 明确加入缺少的三项String：`action_name = ui_accept`、`target_scene_id = ""`、`state_values_json = {"score":0,"health":100}`。已有同名项不被覆盖，未知参数、不完整数字和其他绑定保持。选入保存动作／另一个成员、手动修改初始JSON后，仍沿完整原文检查、审阅、应用草稿与普通保存。

只为当前官方完整正文的LF／统一CRLF及可选一个开头BOM提供接口。额外注释、手改默认值、混合换行或其他脚本直接回到普通手输；没有新增标记或任意导出字段解析。此识别只影响参数辅助，原专用构建预检仍按官方原始字节完全匹配。

这一提供器不依赖动画核心，动画状态脚本继续使用自己的标记／生成器规则。重新检查时若可选接口改变或丢失，只更新相应脚本的辅助所有权，旧按钮失效，原表单节点、已有值与普通审阅保持。未发生变化的脚本辅助也不因此重建。

## 已执行验证

| 入口 | 结果及证据 |
| --- | --- |
| 专项与相邻回归 | [160项](focused.log)：159通过、1项原生条件跳过、零失败／取消；包括提供器、接口发现、原行为／动画参数／名称参考与翻译覆盖。新增服务／工作流／实际控制器专项[13/13](new-tests/focused-final.json)分别覆盖无可选核心、v2/v3正文目录布局、普通HTTP保存、陈旧依赖与原值／按钮所有权 |
| 空白结构后的真实界面 | [Chrome记录](browser-final/browser.json)：测试仅初始化官方 `org.viento.blank` 的工程和一个文档模板，起点为零正文、零素材、零登记。之后通过真实Studio界面创建定义、两份场景、官方TXT、空参数行为、输入映射、组装和HUD，共8文档／18文件；没有预置场景或玩法绑定 |
| 参数操作与保存 | 首次补齐后取消保持全部文件；再次明确补齐，名称选择 `start_retry` 与 `Level`，手动设 `{"score":0,"health":3}`。检查、应用草稿、普通保存及重新加载通过；最终阶段仅一份行为正文变化，脚本保持官方原字节 |
| 三语与来源 | 13张PNG、9组中英日390px无溢出版式、浏览器错误0；[独立回执](browser-guard.json)复核26份产品来源、测试驱动、98份正式示范及全部截图。可重建的[18文件作者工程](browser-final/author-final/)保留界面实际保存内容 |
| 实际游戏窗口 | [原生回执](native-final/verification.json)及[键盘记录](native-final/keyboard.json)：标准生成项目，XTest Enter进入Level，HUD显示Score:0／Health:3，Escape正常结束。2访问、2截图、10条经既有读者验证的事件；38份生成文件与18份作者文件前后不变 |
| 完整应用 | 最终9515项：8827通过、688条件跳过、零失败／取消，退出0；2940份受检来源前后不变。[最终回执](final-verification.json)与[完整记录](full-check-final/status.json) |
| 数据保全 | 13,934份旧证据、86份旧后端GD／文本、15份历史文档、98份示范文件与HEAD保留；图谱旧对象／坐标／评分不改，最终[保全回执](preservation-final.json)逐项核对 |

实际窗口为Godot4.7.2音频清理修订版，运行在Xvfb/Mesa软件OpenGL中；键盘为XTest合成输入，不声称物理设备或硬件GPU验收。只读观察器复用前轮工具，把物理回调的两个名称换成此无物理项目的idle回调；仅调用一次 `super._process(delta)`，不额外推进项目、不调用重试端口、不改状态或作者脚本。截图在渲染完成后读取；[观察器](native-final/observer.gd)与[键盘驱动](native-final/keyboard-driver.py)保留本次实际字节。

## 过程记录与界限

[首次浏览器](initial/browser-first/)已完成组装保存，但测试驱动未等待异步保存结束便点取消，随后等待关闭超时。只修正驱动等待条件后全程重跑，没有因此改产品。新增测试首轮的夹具问题（旧模板位置、计划附加来源、textarea换行和同定义名称一致性）与最终13项结果分别保留在[new-tests](new-tests/)，没有通过放松产品校验规避失败。

本专题覆盖**初始化空白结构后的作者操作纵切**，不表示桌面作品库／原生目录选择器的创建入口已实测。它不是整款四场景收集游戏从空白复建、完整0.3或0.5出口；没有暂停菜单、同场景重启、存档、长期运行、独立发行、Bevy对等、Android或新安装验收。原始[晶石庭院玩法](../topdown-collect/README.md)、[参数名称选择](../scene-behavior-reference-picker/README.md)与[重试运行语义](../scene-retry/README.md)仍按各自独立记录阅读。

## 复验

```sh
node --test --test-concurrency=2 scripts/tests/godot-scene-retry-parameters.test.mjs scripts/tests/script-parameter-discovery.test.mjs scripts/tests/scene-retry-parameter*.test.mjs
VIENTO_RETRY_PARAMETERS_OUTPUT=/tmp/新的空目录 node scripts/tests/scene-retry-parameters-smoke.mjs /usr/bin/google-chrome
VIENTO_GODOT_BIN=/绝对路径/Godot xvfb-run -a node scripts/tests/scene-retry-parameters-native-smoke.mjs /tmp/浏览器输出/author-final /tmp/新的原生结果目录
npm run check -- --app-only
```

浏览器原始目录中的 `author-final` 可直接用于同一原生复验；复制或迁移作者工程不需要修改其登记。生成输出、工具和系统缓存始终在作者工程之外。

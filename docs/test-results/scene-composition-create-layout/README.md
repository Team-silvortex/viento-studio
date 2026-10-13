# 新配方起始排布验收

2026-10-13；源码版本仍为 0.1.1，新增内容属于未发布工作树，未重新安装。结构化结果见 [summary.json](summary.json)。

## 功能与边界

多演员创建助手内增加横排、竖排、网格。先预览每项旧／新坐标，再明确应用；只修改创建表单的位置，不改变身份、顺序、对象和投影继承。一次撤销恢复上次应用前的原数字输入，包含 `0140.00`、`1.8e2` 等写法。

任何演员或主字段修改会使旧排布／撤销失效；切换演员和语言只改变视图。修改排布设置撤销位置预览，不移动演员，也不影响尚有效的完整 JSON 审阅。应用或撤销位置后必须重新审阅完整 JSON，之后仍通过普通草稿与保存落盘。未应用的排布设置参加退出确认。

纯坐标规划器只处理有界身份和数值坐标，任一越界整体拒绝，不裁剪或部分应用；它不读取对象尺寸、素材或引擎。间距表示中心距离，不保证避免重叠。共享 Rust 仍负责最终配方语义；不增加作者格式、写接口、引擎权限或模块能力。

## 验证结果

- [完整应用](full.log)：**4698** 项中 **4592 通过、106 条件跳过、0 失败／取消**；777 个 JavaScript 文件语法及 API／版本预检通过。
- 新增 **22** 项：纯排布 10、界面 11、普通保存宿主 1；包含于全量。相关 [核心10](core.log)、[UI40](ui.log)、[宿主／旧创建42](host-core-regression.log)及[翻译／原脚本助手22](ui-compatibility.log)与全量重叠，不能相加。
- [真实 Chrome／Godot](browser-1791884664281/browser.json)：**8 组、15 图，首次运行通过**。从空工程 GUI 创建 OC／投影／三演员，依次检查三种只读排布预览、显式应用、精确撤销、过期保护、未完成／越界拒绝、中英日390px与取消无写。
- 最终网格起点为 `[100,120]`、`[250,120]`、`[100,220]`；普通保存、预览、材料化和实际 Godot 检查／构建／无头运行后，终点为 `[145,120]`、`[295,120]`、`[140,220]`。实例身份及符号继承保持。
- [准备副本](packaged-resources.json)：**41** 次文件精确比对，两份复制核心的单／多演员与配方交接、**6** 次三种排布、越界整体拒绝及 **10** 个实际复制界面门槛场景通过。属于准备副本与内存 VM 验收，不计安装或 Android 设备。

代表截图：[横排预览](browser-1791884664281/starter-row-preview.png)、[中文窄屏](browser-1791884664281/starter-layout-zh-CN-390-preview.png)、[日文设置](browser-1791884664281/starter-layout-ja-390-settings.png)、[Godot结果](browser-1791884664281/layout-godot-result.png)。关键截图已目检。

## 数据保护与复现

18 份产品／实测脚本在运行前后及最终核对时摘要相同。临时作者工程已清理；OC／投影正文保持，创建只新增期望的配方与场景正文和登记。安装包未替换或重启；[保留核对](preservation.json)还确认 867 份旧证据／示范文件、1796 个评分值及1776个无关功能单元保持。

专项命令为 `node --test scripts/tests/scene-composition-create*.test.mjs`；完整应用为 `node scripts/check-project.mjs --app-only`。设置 `VIENTO_GODOT_BIN` 为可信工具绝对路径后，运行 `node scripts/tests/scene-composition-create-layout-smoke.mjs /usr/bin/google-chrome`；它创建新的唯一证据目录，保留旧记录。准备副本由标准 `desktop/prepare.mjs --resources-only` 和 `mobile/prepare.mjs` 生成，再运行本目录 [verify-prepared-resources.mjs](verify-prepared-resources.mjs)。

首轮纯核心测试有一个浮点夹具错误：极小增量与100000相加被舍入成原值，并未越界；改为可表示的越界增量后通过，[原失败](core-initial.log)保留，产品约束没有放松。106 项条件跳过不计通过；真实 Godot 独立启用。本轮不新增安装、Android、作者行为、资源导入、工程 ZIP、Bevy 或图形游戏验收。

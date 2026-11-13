# 晶石庭院：俯视收集参考游戏初稿

2026-11-13；应用源码保持 **0.2.9**，已安装程序保持 **0.2.0**。普通[作者工程](../../../examples/topdown-collect/README.md)组合现有能力，不增加运行协议、不改旧后端脚本。本报告不表示 0.3／0.5.0 已通过。

## 可直接使用的工程

- [完整作者包](delivery/crystal-courtyard.viento.zip)：在当前源码 Studio 导入或复制示范目录后继续编辑；包含工程内指南和素材许可。
- [组装资源包](delivery/crystal-courtyard.viento-package.zip)：33份文档与9份素材的完整依赖闭包，包含指南，可按现有资源包入口导入。
- [Godot生成工程包](native-final/game.viento-build.zip)：已在原作者和原构建路径不可用后实测；接收方仍需 Godot 工具，尚非独立游戏发行。

## 已验证的范围

| 入口 | 结果与证据 |
| --- | --- |
| 普通作者数据与分发 | [专项日志](focused.log) 5/5：四场景及投影／碰撞／媒体／HUD／输入交叉验证、标准生成器、两种作者包迁移和源码包包含。完整作者ZIP由独立读者核对库存／SHA后隔离解包重建；资源包沿正常预览／导入入口换正文根并移离源副本 |
| 原窗口真实玩法 | [键盘记录](native-final/keyboard/keyboard.json)、[协议](native-final/keyboard/protocol.json)：10阶段、6次访问、11张PNG；锁门真实阻挡，三枚晶体各计一次，集齐开门、进入出口通关；危险区每次进入扣血，停留不重复，死亡后失败并重试复位 |
| 标准生成工程离线 | [交付核验](native-final/offline-delivery.json)、[离线协议](native-final/offline-keyboard/protocol.json)：另一个窗口重复相同10阶段／6访问／11PNG；原作者／构建路径均已移离，生成文件原字节保持 |
| 当前编辑器 | [Chrome报告](browser-final/browser.json)：11张PNG、九组中英日390px无溢出版式；真实HTTP原文Cancel／Save／重开、场景／物理／HUD检查、HUD候选取消，以及界面计划／Godot构建通过，浏览器错误0。只编辑临时副本的指南注释，原98份样例文件与14份应用来源不变 |
| 完整应用检查 | 最终9442项：8754通过、688条件跳过、零失败／取消，退出0；2771份代码／示范文件检查前后不变。执行、冻结来源及首轮收集边界见[最终回执](final-verification.json) |
| 数据保全 | 13,781份旧证据、86份旧后端GD／文本、15份历史文档与HEAD保留，新增证据仅本专题；最终复核见[最终回执](final-verification.json) |

Godot为4.7.2音频清理修订版，窗口为Xvfb＋Mesa软件OpenGL，键盘是XTest合成事件；不代表实体键盘、硬件GPU或扬声器听感验收。声音事件及回执有运行记录，通关音轨由胜利场景0.05秒提示播放。

## 实现与失败记录

玩法只存在于保存的普通TXT中。晶体隐藏并关闭触发监测，门隐藏并关闭碰撞；实例一直保留到场景退出，不声称通用动态销毁能力。共享重试初始值为 `{"score":0,"health":3,"door_open":false}`，收集去重保存在本次场景局部状态。

[早期记录](initial/)保留测试工具的首次失败：直接运行窗口前遗漏素材导入；只读观察工具最初误用idle更新而实际项目采用物理更新；浏览器工具最初未处理索引前缀及重新加载等待。均修正测试工具后重跑，没有借此修改产品后端。

审阅后仅修正示范README与指南：GPL v3名称、通关音轨时间提示、实际动作名和局部收集状态解释。[说明差异](sample-doc-corrections.json)及[交付核验](delivery/verification.json)证明最终生成游戏文件仍与两个通过的原窗口逐字节相同；修正后5项专项和浏览器均重跑。

第一次完整应用已打印9442项、8754通过／688条件跳过、零失败／取消，但外层收集进程以143结束，未取得成功CLI退出；原[汇总及来源保全](full-check-initial/status.json)保留这一边界。最终使用独立收集进程重跑，结论以最终回执为准。

## 尚未覆盖

这是可编辑的有限会话游戏初稿。尚未完成从空白工程的逐步界面复建、成员／实例／动作选择优化、暂停／鼠标菜单、同场景即时重启、跨启动存档、30分钟游玩、字体随包与无引擎工具发行，也未更新或验收安装程序。后续顺序见[路线图](../../ROADMAP.md)。

## 复验

在仓库根目录执行：

```sh
node --test --test-isolation=none scripts/tests/topdown-collect.test.mjs scripts/tests/source-archive.test.mjs
VIENTO_GODOT_BIN=/绝对路径/Godot VIENTO_XVFB_TEST=1 xvfb-run -a node --test --test-isolation=none scripts/tests/topdown-collect-native.test.mjs
VIENTO_GODOT_BIN=/绝对路径/Godot VIENTO_TOPDOWN_BROWSER_OUTPUT=/tmp/新的空目录 node scripts/tests/topdown-collect-smoke.mjs /usr/bin/google-chrome
npm run check -- --app-only
```

素材均为原创：六份SVG和三份PCM16／22050Hz短WAV，共38,928字节，采用CC0-1.0；登记字节／SHA见[素材记录](assets.json)。作者脚本与其余文本遵循仓库GPL v3，源码与素材许可分别说明。

# 行为配置复制：从独立实例到真实拾取玩法

2026-11-13；源码版本仍为 **0.2.10**，本轮是工作树增量，下一次计划发布 **0.3.0**。本机安装仍为0.2.0。操作见[复制当前绑定到场景实例](../../SCENE_BEHAVIORS.md#复制当前绑定到场景实例)，阶段出口见[路线图](../../ROADMAP.md)。

## 新增行为与边界

在已有行为编辑器选择一个来源绑定，再明确选择复制目标实例，点击 **复制当前绑定**。它复制当前脚本引用、参数原始输入及信号顺序，只分配新 `bindingId` 并设置明确的 `instanceId`；参数里的UUID不推断改写。选择目标本身不修改表单或已有审阅，复制后需重新检查、审阅、应用草稿并普通保存。32条上限、来源失效和身份分配失败保留输入；取消不写作者数据。

纯草稿复制模块不持有DOM、文件、随机服务或运行后端；界面把当前原始数据与目录交给规则，新行辅助身份重新分配。旧参数／信号控件、参考／音轨／片段／参数接口等辅助不能修改新行。未完成数字和换行可先复制为草稿；普通语义检查及新条目的JSON序列化继续使用原规则，不把新条目描述成原JSON词法复制。

本轮不新增作者格式、元数据关系、事务日志、服务写入入口或运行协议，Godot描述符保持0.46.0；生成工程不做玩法修补。它解决重复实例接线，不等于整款游戏从空白界面创建。

## 已执行验证

| 入口 | 结果与证据 |
| --- | --- |
| 专项及相邻回归 | [最终130项](focused-final.log)全部通过、零跳过／失败；含新增纯规则12项、真实界面控制器14项，以及原保真提案、参数／参考／默认项／翻译回归。不同组有交集，不相加为覆盖率 |
| 真实Chrome作者流程 | [浏览器记录](browser-final/browser.json)：独立参考工程副本移除两条收集绑定，只保留一条；通过实际Studio界面明确选入另外两枚晶体，生成两个新绑定身份，检查、审阅、应用草稿、普通保存并重开。四场景计划恢复为11条关卡绑定 |
| 取消与原文保真 | 浏览器取消阶段复制未完成数字和信号，后续检查拒绝并保留输入，取消后作者文件不变。最终保存只改变关卡行为正文，原9条绑定的完整JSON片段、BOM／CRLF、`3.000`与Unicode转义保持。正式98份示范文件不改；[作者副本](browser-final/author-final/)保留真实保存结果 |
| 三语与来源 | 11张PNG、9组中英日390px布局、浏览器错误0；19份实现来源、驱动和98份正式样例前后摘要一致。独立[复核](independent-review.json)还核对所有截图、作者文件与原生交付来源 |
| Godot实际游戏 | [原生2/2日志](native-final/native.log)：原窗口与标准生成ZIP离线各完成10阶段／6次场景访问／11PNG。三个晶体分别只计一次，实体门阻挡与开启、通关、危险区伤害、失败及不同成员重试复位通过；没有测试专用拾取按键 |
| 交付一致性 | 每次103份生成文件与[交付ZIP](native-final/evidence/final/game.viento-build.zip)摘要一致；离线阶段原作者／构建路径已移离。两次原生作者98份文件均等于浏览器最终保存副本，独立复核的构建快照身份一致 |
| 完整应用 | 最终9541项：8853通过、688条件跳过、零失败／取消，退出0；2237份产品／作者／测试来源前后不变（Markdown文档另行审查）。[执行状态](full-check-final/status.json)、[完整日志](full-check-final/check.log)、[最终回执](final-verification.json) |

实际窗口使用Godot4.7.2音频清理修订、Xvfb/Mesa软件OpenGL与XTest合成键盘。观察脚本和场景临时加入生成目录以读取状态／截图，结束时移除；103份正式生成文件仍逐字节核对，不声称运行目录中从未存在测试文件。输入和观察不直接调用收集／伤害／重试端口，不改作者脚本。

## 驱动与历史

原生验收复用既有[参考游戏测试](../../../scripts/tests/topdown-collect-native.test.mjs)。临时副本只将相对导入解析到原模块、将证据根改为本轮临时目录；[转换记录](native-final/harness/changes.json)证明反向重建的SHA精确等于原驱动，测试正文和断言保持。首次临时副本遗漏`yauzl`定位，在运行前加载失败，[首轮日志](native-final/native-initial-loader-failure.log)保留；解析到原依赖后完整两项重跑，没有因此修改产品。

初步[74项回归](focused-initial.log)与最终130项分开保存。新增UI专项[首轮14项中的一项](initial/ui-first-tool-output.txt)曾把原序列化对新`-0`条目的规范化误认成复制错误；[最终14项](initial/ui-final-tool-output.txt)明确验证原始草稿保留，既有序列化规则保持，不扩大本轮范围。这两份文件是完整工具返回输出的逐字副本，并非当时重定向的原始日志，[来源说明](initial/ui-output-provenance.json)保留该边界。最终130项是独立实际执行的原始重定向日志。

最终[保全](preservation-final.json)确认14,015份旧证据、98份正式示范、86份后端GD／文本、51份旧发布记录、15份历史文档原字节保持；旧图谱3260坐标评分及全部旧对象保持。[文档审查](doc-links.json)另核对相对路径和原锚点。本轮只新增一个功能与两份实现，既有平台范围不提高。

## 尚未完成

当前任务从参考工程副本开始，未证明完整四场景游戏从空白复建或作品库新建入口。没有同场景即时重启、暂停恢复、鼠标菜单、跨启动存档、长期运行、字体随包、无引擎工具发行、Bevy对等、Android或新安装验收；0.3.0与0.5.0出口仍按路线图逐项推进。

## 复验

```sh
node --test --test-concurrency=2 scripts/tests/scene-behavior-binding-copy*.test.mjs scripts/tests/scene-behaviors-edit.test.mjs scripts/tests/scene-behaviors-editor-ui.test.mjs
VIENTO_BEHAVIOR_COPY_OUTPUT=/tmp/新的空目录 node scripts/tests/scene-behavior-binding-copy-smoke.mjs /usr/bin/google-chrome
VIENTO_TOPDOWN_SOURCE=/tmp/浏览器输出/author-final VIENTO_GODOT_BIN=/绝对路径/Godot VIENTO_XVFB_TEST=1 xvfb-run -a node --test --test-isolation=none scripts/tests/topdown-collect-native.test.mjs
npm run check -- --app-only
```

最后一条原生复验默认将运行副本放在临时目录并清理，不覆盖历史证据。需要保留截图时使用本轮已记录的证据路由副本；不要将旧专题目录作为新一轮输出覆盖。

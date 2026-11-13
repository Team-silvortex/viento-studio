# 0.2.10 发布检查

2026-11-13。本目录记录应用升为 **0.2.10** 后的实际发布检查。功能收录见[版本记录](../../RELEASE_0.2.10.md)，发布前审查基线为 `82baaea9024bda118cc301c28f68d6a6bc4b1282`；开发专题继续保留0.2.9时的原结果和来源摘要，不改标为本版重新执行。

## 本版执行

- **完整应用 9515项：8827通过、688条件跳过、零失败／取消，退出0。** `npm run check -- --app-only` 在0.2.10下完成，包含1664份JavaScript语法、版本一致性、API契约预检及应用回归。[完整日志](full-check/check.log)、[执行状态](full-check/status.json)、[发布汇总](summary.json)。条件跳过不算原生工具或设备通过。
- **版本与源码归档8/8、零跳过。** 使用明确逐项TAP记录的版本／源码分发专项，[日志](version-source.log)。Android编号1002010、macOS构建号1.2.10，应用标识保持 `io.viento.studio`。临时归档验证两份Rust crate、后端与全部官方示范闭包，排除作品、本机状态和构建缓存；该归档不是最终提交的发行包。首次默认报告器只列2个文件级条目的[原日志](version-source-initial.log)保留，不把它当作8项逐项结果。
- 检查期间 **2265份Git清单内作者／产品／测试来源前后不变**，[前置摘要](full-check/sources-before.json)、[后置摘要](full-check/sources-after.json)。它们不包含被忽略的旧安装／派生资源。完整应用后只同步了 `engine/README.md` 的当前版本和发布链接；该文档变化单列于汇总，没有后续功能代码修改。
- 文档路径／锚点核对见[链接审查](doc-links.json)，图谱原对象和评分审查、旧数据保全见[范围核对](scope-audit.json)。图谱现为198功能／600实现／815绑定／3260评分／163工作流；11项功能、39个交付评分改为源码交付，其余坐标和原证据保持。旧图谱说明另存[发布前元信息](atlas-meta-before.json)。

## 开发证据与保全

| 本版增量 | 原始开发记录 |
| --- | --- |
| 逐角色物理回放与作者世界工作平面 | [逐实例回放](../physics-instance-replay/README.md)、[世界平面](../scene2d-world-workspace/README.md) |
| 相机、构图与世界边界 | [运行相机](../scene-camera2d/README.md)、[逻辑构图](../scene-camera2d-composer/README.md)、[世界边界](../scene-camera2d-limits/README.md) |
| HUD、导航与重试 | [屏幕HUD](../scene-hud2d/README.md)、[导航](../scene-navigation/README.md)、[重试](../scene-retry/README.md) |
| 参考游戏与参数辅助 | [晶石庭院](../topdown-collect/README.md)、[名称参考](../scene-behavior-reference-picker/README.md)、[官方参数及空白两场景试点](../scene-retry-parameters/README.md) |

本次核对保留 **14,002份既有证据、50份旧发布记录、14份历史正文、86份后端GD／文本及98份正式参考工程文件** 的原字节；历史索引可追加新版入口。开发记录中的首次失败、修正、工具条件和精确范围均保留，不将各组交叉测试相加为覆盖率。

本轮没有重跑真实浏览器／Godot窗口：这些专题仍按原0.2.9开发时点阅读。已有证据使用Linux Chrome156、Godot4.7.2音频清理修订、Xvfb/Mesa软件图形与XTest合成输入，分别说明实际作者操作、有限游戏会话和离线工程。它们不表示实体键盘、硬件GPU、扬声器听感或整款游戏从空白界面复建。

没有构建或更新Tauri安装包，没有新增Android、Windows／macOS、Bevy对等或独立游戏发行验收。本机安装仍为 **0.2.0**。源码推送、作者包和需要Godot工具的生成工程ZIP分别说明；0.3／0.5.0阶段出口仍待后续开发。

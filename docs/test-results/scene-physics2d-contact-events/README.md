# 角色移动碰撞集合 → 作者事件 → 动画与声音

2026-10-25，**0.2.3之后的开发工作树**。本轮接通角色移动碰撞开始／结束，复用普通脚本、行为绑定、项目事件和媒体工作流。使用步骤见[物理指南](../../SCENE_PHYSICS2D.md#用角色移动碰撞驱动项目事件)。未升版、提交、推送或更新本机0.2.0安装；使用隔离作者工程，不操作日常作品。

## 实现与边界

- Godot0.27.0独立包装提供可选 `physics.character-contacts2d`。仅启用 `characterMotion` 的角色行为获得自己的 `viento_character_contacts` 端口，协议1；`started`／`ended` 各传递对方碰撞体和实例两个字符串编号。
- 读取原有唯一一次移动返回的碰撞集合。上一步未报告、本步报告的对方产生started，反之产生ended；同一对去重，所有结束差项先于开始差项，稳定排序。未知碰撞体不猜测身份；不是传感器进出、持续几何接触或着地接口，停止向墙移动也可能结束本步阻挡。
- 旧运动和起跳／落地回调后派发；重入受守护，场景关闭撤销连接、集合及旧访问端口，不补发ended。正式运行不依赖smoke trace及其256条预算。
- 新普通TXT模板 **Godot / 角色移动碰撞**（`godot-character-contact-events`）校验端口和身份，按 `started_event`／`ended_event` 发布原有标量项目事件；载荷为**对方实例UUID**，自身在发布来源中。`other_instance_id` 留空接受全部对方，填写只接受该实例；默认事件名为 `physics.contact_started`／`physics.contact_ended`。
- 独立helper、port、原场景脚本与库存随生成工程交付。新生成层保留已有runtime.gd，不修改旧15份物理生成／运行文件、Rust核心、同源WASM或17项旧模板。没有运动角色时使用旧生成分支；作者schema、项目wire与物理观察协议保持。
- 自由平面角色、静态体、传感器和Bevy不提供新端口。本轮未增加移动平台、动态刚体、持续接触查询或独立游戏程序发行。

## 本轮验证

完整应用检查[首轮通过](full-check.log)，[退出码0](full-check-exit.json)：**8199项，7761通过、438条件跳过，0失败／取消**；版本一致性、1358份JavaScript语法及API预检通过。缺少原生环境的项目仍按条件跳过，实际Godot另行启用。

| 验证 | 实际结果与证据 |
| --- | --- |
| 作者模板与邻接 | [39/39](author-starters-tests.log)，包括新真实Godot端口30场景／24条预期诊断及旧19场景；[17项旧完整目录摘要](legacy-starter-hashes.json)逐项保持 |
| UI与翻译 | [68/68](ui-regression.log)，含4项新增；复用普通脚本创建、事件观察和参数保存 |
| 适配器、指纹与实例通道 | [15项](backend-adapter-tests.log)：13通过，2未设置原生条件而跳过；新增三份文件纳入执行指纹 |
| 实际Chrome | [首轮通过](browser-1792927451814/browser.json)：6流程、15截图、32源码摘要，真实创建TXT、保存／登记、显式行为引用与参数、构建运行和来源导航 |
| 新真实Godot矩阵 | [18/18，无跳过](backend-native.log)，含3项生成／库存规则及15项真实运行；[运行记录](backend-native.json)、[窗口截图](backend-window.png)分别留证 |
| 历史生成器兼容 | [精准11/11，无跳过](legacy-native.log)，覆盖0.25及0.26生成、库存、真实运行、ZIP搬迁及截图；[旧事件3条实际运行](legacy-events-native.json)、[旧单向平台3条实际运行](legacy-one-way-native.json) |

Chrome验证共9条项目事件，其中新碰撞事件为started→ended→started；相应载荷为地板实例，发布来源为角色实例，两者虽共享同一个设定对象编号仍准确分开。6条动画命令和2条声音播放分别取得执行记录。物理观察取得30条样本，直接跳至对方碰撞体原文精确选区，再分别打开发布者、动画订阅者及声音订阅者的绑定来源。三语390px保留焦点、完整审阅和按钮可达。

作者文件由49个变为51个，仅4条明确操作路径发生变化：新增TXT及登记、显式关联脚本引用、普通保存行为JSON。观察、来源导航和运行保持保存后的作者字节；声音回执不代替扬声器输出验收。专项与完整应用检查存在交集，不能累加为覆盖率；条件跳过不算通过。

已验证[当前生成工程ZIP](contact-events.zip)搬离原路径后独立运行，SHA256 `48df2c1438981deb6cf75bb71fc288d1bfce7ed99ac2207f71f8986a962acc85`。旧[事件ZIP](character-events.zip)及[单向平台ZIP](one-way.zip)也分别完成搬迁运行。所有本轮原生矩阵首轮通过。

## 兼容与证据

旧0.25事件与0.26单向平台套件明确使用对应历史生成器，并在构建和检查中传同一冻结注册表；新0.27套件使用当前适配器。旧报告保持，不把历史生成器通过冒充当前生成器验证。Rust与同源WASM保持上一轮内容，WASM为745603字节、SHA256 `fd5d3699ae7508c3f50383e3600ce384dc44833d07d0e496ee6934c2c63b3a0c`；本轮没有将旧414项Rust结果改标为重跑。

精确命令见[模板](author-starters-commands.txt)、[UI](ui-commands.txt)、[浏览器](browser-commands.txt)、[原生](backend-commands.txt)及[根检查](root-commands.txt)。工具为Node24.21.0、Godot4.7.2.stable.official.ed1daf0bf、Chrome154.0.8037.97；Godot SHA256 `8d106cbe6144c2dc7e881d61d2429c1a8a76e6b22ef48bd5e48dcf934953f71e`。

[保留检查](preservation.json)以本轮开始的脏工作树为基线，核对历史报告、作者样例、Rust及旧物理源码，重验浏览器来源摘要；功能图谱只追加本轮对象和评分。[文档链接](links.json)及[图谱检查](atlas-check.log)独立留证。

收尾保留检查核对10204份受保护文件及32份浏览器源码摘要，均保持；图谱为169功能／511实现／721绑定／2884评分／133工作流。首次文档链接扫描仅报告尚未生成的本报告links.json自引用（[首次记录](links-first.json)）；生成后重验，结果见最终links.json。

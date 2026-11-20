# 首次行为创建的参数配置

2026-11-13，**0.3.0 后的工作树增量**。首次添加行为现可保存每条绑定的原始参数 JSON，选择已识别脚本后明确补齐缺失默认项，再一次审阅并沿既有 `behavior.create` 保存正文与关系。没有升版、提交推送、新安装或格式迁移。

## 实际验证

- 参数规则／旧创建界面／新目录组合 **55/55 通过、0 跳过**，其中纯规则 11、原创建 36、新目录 8。覆盖原文词元、负零、重复键、未完成输入、恶意数据描述符、32 KiB 前置拒绝与完整合并预算。[原日志](checks/parameter-integration.log)。
- 新参数界面 18、原创建 36、首次脚本往返 17、普通脚本创建 49，共 **120/120 通过、0 跳过**，正式来源前后相同。[回执](checks/ui-regression.json)、[原日志](checks/ui-regression.log)。这些回归与上项存在重叠，不相加为独立覆盖率。
- 来源目录与相邻服务 **28/28 通过、0 跳过**；固定 retry／restart／pause／menu 与可选动画接口、core 不可用、读取期间外部改源、真实鉴权 HTTP/no-store、作者字节保持分别验证。[回执](checks/creation-catalog-regression.json)。
- 真实 Chrome 从官方空白模板的 **零正文／零登记／零素材** 开始，经普通编辑器和各专用窗口创建定义、两份 Scene2D、官方 retry TXT、输入映射、项目组装、HUD 和首次行为，共 **8 文档／18 作者文件／0 素材**。[浏览器记录](browser/browser.json)、[18 文件作者工程](browser/author-final/)。项目库的原生目录选择由夹具初始化，未把这一环节算作界面实测。
- 中英日 390px，8 张实际截图；明确选择脚本不自动补参数，未完成／重复键输入保留；双绑定切换与语言切换、原词元审阅后取消均不写作者数据。最终只保留一条完整 retry，首次保存即带三项参数，**恰好一次 apply、仅正文／登记／场景关系三路径变化**，重开内容相同。正式示范的 98 文件与捕获的 33 个生产来源保持。[精确回执](checks/browser-receipt.json)。
- 在以上实际界面保存的工程上，原有真实 Godot 键盘驱动通过：Enter 从第一场景进入第二场景，初始化 `score=0`／`health=3`，HUD 显示 `Score: 0`／`Health: 3`，Escape 正常结束；**10 事件／43 份生成文件／18 作者文件**，作者及生成玩法字节保持。[原生验证](native/verification.json)、[按键样本](native/keyboard.json)、[日志](checks/native.log)。该只读观察器继续复用既有非物理项目适配，不替换作者脚本或生成玩法。

本轮完整应用检查 `npm run check -- --app-only` 已通过：**9796 项，9096 通过，700 跳过，0 失败**；捕获的 2325 份来源前后摘要一致。见 [本轮回执](checks/application-status.json)、[完整日志（gzip）](checks/application-check.log.gz)、[执行前来源](checks/application-sources-before.json.gz)、[执行后来源](checks/application-sources-after.json.gz)。跳过项未计为工具或平台通过；本次不另声称 Rust／Android／桌面打包回归。测试驱动在首次捕获后纠正刷新时丢失请求记录的问题，早期未完成运行已停止并单独留存[真实状态](checks/early-driver-revision/status.json)，不算完整通过；正式驱动实跑首轮通过，未改生产实现。

## 边界与保真

作者格式、事务日志、宿主 API 和 Godot／Bevy 版本保持；原身份专用规划器仍拒绝额外字段。纯参数规则不获得 I/O，来源目录不执行或泄露源码，独立视图只提出本地修改，最终正文仍由原全量校验与三文件事务准入。读取目录、选择脚本、无变化和失败不暗加默认值、关系或保存；补缺成功才撤销原审阅。

便携规则另覆盖 BOM／CRLF、指数数值与 Unicode 转义。浏览器 textarea 直接输入的行尾按标准规范化为 LF；实际审阅中验证 `1e2`、`-0` 及字符串内转义 CRLF，不能把它外推为浏览器直接输入原始 CRLF 文件的逐字节保全。最终可运行 retry 只使用实际导出的三项 String，未声明数值仅用于取消阶段。

原文与接口审查见[纯规则审查](checks/pure-review.json)、[集成审查](checks/integration-review.json)及[预算探针](checks/parse-budget-probe.log)。这是一条首次行为参数作者纵切，**不是从空白完成整款游戏**；已有行为原文 dirty 往返、存档、长期运行、独立发行、物理设备及新安装仍未完成。原生图形使用 Xvfb／Mesa 与 XTest 合成键盘，不能外推硬 GPU 或实体设备。

最终保真检查见[旧数据与图谱保全](checks/preservation.json)、[文档链接（gzip）](checks/doc-links.json.gz)、[完整结论](final-verification.json)。

# 首次行为创建的名称连接

2026-11-13，**0.3.0 后的工作树增量**。在首次添加行为时，从真实保存态目录选择本场景实例、显式组装的成员场景或输入动作，填入作者指定的现有 String 参数，再沿原审阅和 `behavior.create` 保存。原参数配置专题和 0.3.0 发布记录保持。

## 实际验证

- 新纯规则 **12/12、0 跳过**：独立创建来源品牌、场景修订绑定、现有 String 选择、同值原文、BOM／CRLF／负零／指数词元、伪造输入、恶意访问器和预算前置拒绝。[原日志](checks/pure.log)、[独立只读复审](checks/pure-review.json)。独立六项反例探针另记，不加作正式新增项。
- 新名称界面 **25 项**，连同旧参数、首次创建、脚本往返和普通脚本创建，共 **145/145、0 跳过**。[来源回执](checks/ui-regression.json)、[原日志](checks/ui-regression.log)。覆盖来源变化、会话／绑定／脚本／实例／语言切换、迟到回复、普通审阅期间失效、同值与预算失败保留。
- 预算修复前，只读端口与相邻接线 **123/123、0 跳过**，其中新增 5 项；捕获的端口／接线测试三份来源此后保持，预算修复后的父流程另由上述回归和完整应用重验。复用既有目录 API 和服务，能力不可用时保留手工输入；没有借用旧行为原文的来源品牌。[回执](checks/transport-regression.json)、[原日志](checks/transport-regression.tap)。这些定向组合有交集，不能相加为独立覆盖率。
- 真实 Chrome 从官方空白模板的 **零正文／零登记／零素材** 开始，经普通控件创建定义、两份 Scene2D、官方 retry TXT、输入映射、组装、HUD 和首次行为，共 **8 文档／18 作者文件／0 素材**。目标场景与输入动作均由本轮可见名称控件填入，只有 `state_values_json` 手工设置 `score=0`／`health=3`。[浏览器记录](browser/browser.json)、[作者工程](browser/author-final/)、[精确回执](checks/browser-receipt.json)。项目库／原生目录选择由夹具初始化，没有算作界面验收。
- **20 次真实目录读取**；2 次暂停并放行实际 HTTP，请求期间改输入或切绑定均不让迟到结果覆写。Load／全部选择保留参数和审阅；真改才撤审阅，同值 fresh 填入保留精确原文与审阅；同定义双实例显示不同身份。双绑定取消零写入，最终只保存一条 retry，**恰好一次 apply、三条预期作者路径变化**，重开相同。中英日 390px、8 张实际截图、36 个生产来源与示范 98 文件保持。[窄屏人工检查](checks/visual-review.json)。
- 在上述最终界面保存的工程上，复用未改的真实 Godot 键盘驱动：Enter 进入第二成员场景，初始化 `score=0`／`health=3`，实际 HUD 为 `Score: 0`／`Health: 3`，Escape 正常结束；**10 事件／43 份生成文件／18 作者文件**，作者和生成玩法摘要保持。[原生回执](native/verification.json)、[按键样本](native/keyboard.json)、[日志](checks/native.log)。只读观察器仍使用既有非物理项目适配，未替换作者脚本或生成玩法。

完整应用检查 `npm run check -- --app-only`：**9838 项，9138 通过，700 跳过，0 失败／取消**；2331 份冻结来源执行前后相同。[本轮回执](checks/application-status.json)、[完整日志（gzip）](checks/application-check.log.gz)、[前](checks/application-sources-before.json.gz)／[后](checks/application-sources-after.json.gz)来源。跳过仍是跳过，本轮不另声称 Rust、Android 或桌面打包通过。

## 修复与保真

复审发现：有完整审阅的两条绑定合计恰为 **32768 字节**，单 String 的有效增长仍可能超出整份行为上限。旧最终检查已拒绝保存，但辅助先修改草稿并撤销审阅。现将原身份规划器和完整参数合并校验复用到写入前：**已有有效完整审阅时，总量超限也保留原 JSON、审阅与保存资格**，只显示失败提示。[修复前观察](checks/combined-budget-before-fix.json)、[最终集成复审](checks/integration-review.json)。尚未形成完整审阅时，当前绑定可独立使用名称辅助，整份清单继续由普通检查和创建事务准入。

首次浏览器驱动误以为目录使用场景标题 `Level`；实际只读投影显示 `level`。仅修正唯一可见名称匹配，保留[首轮失败](checks/first-browser-fixture-failure.json.gz)。其后的[预算修复前浏览器成功](checks/browser-before-budget-fix.json.gz)和[原生成功](checks/native-before-budget-fix.json)保留原始范围；最终浏览器和原生使用修复后来源重新运行。两次尚未完成的应用检查分别因[驱动修订](checks/early-driver-revision/interruption.json)和[预算修复](checks/early-budget-revision/interruption.json)停止留证，均不计为完整通过。

纯词元规则、独立选择界面、只读宿主端口和原创建事务各有边界；不自动猜参数、增键、加关联或建立共享状态，不执行／返回作者代码。作者格式、日志、宿主 API、Godot／Bevy 版本和安装保持。便携规则覆盖原始 BOM／CRLF；浏览器 textarea 按标准规范化输入行尾，界面验证的是 `1e2`／`-0` 和字符串内转义 CRLF，不外推为原始文件逐字节往返。

本轮是首次名称连接作者纵切，**不是完整参考游戏从空白、已有 dirty 行为往返、长期运行、跨启动存档、独立发行或设备／安装验收**。原生运行使用 Xvfb／Mesa 和 XTest 合成键盘，不代表硬 GPU、扬声器或实体设备；可选外部输入映射改源用例本轮未跑。

最终[旧数据和图谱保全](checks/preservation.json)、[文档链接（gzip）](checks/doc-links.json.gz)与[完整结论](final-verification.json)单独记录。

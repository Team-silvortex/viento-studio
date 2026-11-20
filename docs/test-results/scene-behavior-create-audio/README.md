# 首次行为创建的音轨连接

2026-11-20，**0.3.0 后的工作树增量**。首次添加行为时可从当前场景已保存的声音声明选择音轨，填入指定现有 String 参数，再沿原有完整审阅和三文件事务保存。解决拾取／受伤声音须抄编号或先保存再重开的问题；声音声明、素材、参数、运行播放分别负责。

## 实际验证

- 领域规则 **37/37、0 跳过**，包括新增首次音轨 15 项、原名称连接 12 项及旧音轨目录 10 项。覆盖独立来源品牌、同资源不同音轨、原文词元、空目录、坏声明、访问器、预算与缺少 native/WASM 校验时的手工回退。[回执](checks/pure-final.json)、[日志](checks/pure-final.log)。
- 真实首次创建与相邻界面 **172/172、0 跳过**，其中新增音轨界面 27 项。覆盖双辅助独立、实例／绑定／脚本／脚本语言／会话切换、迟到回复、同值保审阅、32 KiB 全清单预算及未完成兄弟绑定不阻当前编辑。[回执](checks/ui-final.json)、[日志](checks/ui-final.log)。首轮测试把第二绑定切回它原本已用的实例，未触发真正切换；仅修正夹具，保留[26 过／1 失败原日志](checks/ui-initial-fixture-failure.log)。
- 只读宿主端口与旧声音／构建接线 **81/81、0 跳过**，其中新增 5 项。严格能力开关、现有鉴权 POST 和无源码读取／写入权分别核对。[回执](checks/transport-final.json)、[日志](checks/transport-final.log)。定向组合存在重叠，不相加为独立覆盖率。
- 独立复审的 **5 个补充反例**通过：双面板并发鲜读后，一个有效填入使另一个迟到提案失效；明确重试可保留两字段；音轨与名称辅助各自保住 32768 字节已审阅原文和旧保存入口；无核心时保留空目录／手工参数。12 份来源摘要保持，无未解决发现。[复审](checks/integrated-review.json)、[探针](checks/integrated-probes.json)、[日志](checks/integrated-probes.log)。这些探针不计入正式新增测试数。

## 从空白到实际播放

真实 Chrome 从官方空白模板的零正文／零登记／零素材开始，经可见素材导入和普通编辑／创建窗口建立 **7 文档／1 个 PCM16 WAV／18 作者文件**：定义、Scene2D、两份原样官方 TXT、双音轨声音声明、单成员组装和双绑定行为。项目库／原生目录选择由夹具初始化，未计为界面通过。音轨均由行为触发，无时间提示冒充播放；同资源两轨分别是 effect／0.25／不循环与 music／0.15／循环。

作者手工填写官方事件声音脚本的三个 String（`event_name=checkpoint`、空 `track_id`、空 `instance_id`），再用本轮选择器将**第二条 music 音轨**写入 `track_id`；官方事件发布脚本保持空参数。未从普通源码猜接口，也不为测试新增参数 provider。第一次驱动误以为该脚本可自动补缺，保留[失败回执](checks/browser-first-fixture-failure.json.gz)；改为正常手工路径后，[第二轮](checks/browser-second-success.json.gz)及最终独立重跑通过，生产代码未改。

最终 **13 次真实只读目录请求、2 次 CDP 暂停后放行的实际 HTTP、一次行为 apply／三条预期作者路径变化**。读取／选择／同值保留 JSON 与审阅，真改撤审阅；坏输入、双绑定取消零写、保存重开与有效计划通过。中英日 390px、7 张实际截图、44 份生产来源与示范 98 文件摘要保持。[精确回执](checks/browser-receipt.json)、[完整浏览器记录](browser/browser.json)、[作者工程](browser/author-final/)、[计划](browser/plan.json)、[视觉检查](checks/visual-review.json)。

上述最终作者直接进入真实 Godot：官方发布脚本发送 `checkpoint/hello`，两个真实回调分别写 `last_event=hello` 与请求播放所选第二音轨。**12 个业务事件／23 次原生观察**确认仅第二 `AudioStreamPlayer` 播放，持续 **1.25 秒**超过 WAV 的 **1 秒**时长；第一轨保持停止，两条轨道的音量、循环和独立流符合声明，普通关闭产生 `finished`。18 作者文件、38 份规范生成文件及实际 WAV 资源保持原字节。观察器只读，不发布事件或调用播放／停止，不替换作者或生成玩法。[原生结论](native/verification.json)、[观察](native/observer-result.json)、[业务事件](native/events.json)、[实际输出](native/native-output.log)、[执行日志](checks/native.log)。

这里使用 **Headless Godot + Dummy 音频驱动**，验证解码后流与播放器状态、循环及业务命令，**没有扬声器听测或物理设备出声结论**。没有借旧音轨选择器的缺素材样本充当播放证据。

## 完整检查与边界

`npm run check -- --app-only`：**9885 项，9185 通过，700 条件跳过，0 失败／取消**；2338 份来源执行前后相同。[状态](checks/application-status.json)、[完整日志（gzip）](checks/application-check.log.gz)、[执行前](checks/application-sources-before.json.gz)／[执行后](checks/application-sources-after.json.gz)摘要。跳过仍是跳过，本轮不另声称 Rust、Android、安装包或物理设备验收。

首次音轨使用独立创建来源品牌和共享严格 origin 捕获；复用旧 native/WASM 声音校验及只读 API。声音校验不可用时 ready 读取失败，empty/null 仍为空目录，手工 JSON 和普通审阅可继续；不加 JS 替代规则。只有已声明的音轨身份可选，素材身份不能替代它。目录保存声音声明的来源修订与身份，不保留源码，也不认证伪造受信宿主的同摘要响应。

不新增作者格式、事务日志、宿主 API 或 Godot／Bevy 版本。文本填入不建立隐藏关系、不防止以后删除音轨；真实播放与资源闭包仍由构建／运行验证。浏览器 textarea 规范化直接输入行尾；便携 BOM／CRLF 保真与界面数字／负零原文分别测试。整款参考游戏从空白、首次动画片段选择、已有 dirty 行为脚本往返、存档、长期运行、独立发行与候选安装仍未完成。

本轮继续时已有未完成音轨代码，因此[保真审计](checks/preservation.json)明确区分继续前现状快照和上一轮完成的 2331 来源检查，不重造丢失的临时基线。旧两专题库存、已有作者数据、示范、版本与图谱旧对象／评分分别核对；[文档链接](checks/doc-links.json.gz)及[最终结论](final-verification.json)在归档后检查。

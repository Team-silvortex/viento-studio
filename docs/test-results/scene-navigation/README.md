# 场景导航验证（2026-11-13）

新增 **按动作切换场景**、**按事件切换场景** 两个普通 Godot 作者脚本，复用现有行为、输入映射、项目事件及场景请求端口。接通开始→游玩→结果的导航入口与迁移；胜负规则、鼠标菜单、暂停、重开、存档、长期运行和独立发行仍是[0.5.0 的独立门槛](../../MILESTONE_0.5.0.md)。使用方法见[操作指南](../../SCENE_NAVIGATION.md)。

## 最终结果

| 验证层 | 实际结果与范围 | 原始记录 |
| --- | --- | --- |
| 官方参数／组装准入／资源包 | 纯模型8、真实宿主7、包迁移3，共18项通过；仅精确官方源码，原文范围与UUID、参数边界、诊断上限；真实计划、命令、HTTP构建拒绝，以及换根恢复和原根离线重建 | [最终专项](targeted/new-navigation-tests.log)、[最终源码守卫](targeted/final-source.json)；较早17项时点见[pure-host记录](pure-host/evidence.json) |
| 作者草稿／三语界面／输入提示 | 作者6、输入提示4，共10项通过；普通草稿不拥有IO权，dirty／过期会话拒绝；默认与自定义动作、原文范围与自定义源码不推断 | [专项日志](targeted/new-navigation-tests.log) |
| 真实 Chrome 作者链 | 两模板分别走真实HTTP编辑、普通保存、行为参数审阅及保存；中英日390px，各7截图、15份源码前后及最终摘要一致，无浏览器错误 | [动作](browser-action-final-2026-11-13/browser.json)、[事件](browser-event-final-2026-11-13/browser.json) |
| 真实 Godot 脚本合同 | 1项：真实引擎中受控端口返回、InputEventAction与焦点回调；与操作系统窗口输入分别记录 | [最终原生专题](native-post-preflight-2026-11-13/summary.json) |
| Godot 窗口与离线工程 | 2项：原作者工程与标准ZIP迁移后工程，各6访问，共12访问、16次发布、16次投递、12旧访问拒绝、6PNG。实际XTest窗口合成按键、GUI明确处理、窗口失焦／回焦；原作者与build移离后仍运行 | [原生回执](native-post-preflight-2026-11-13/summary.json)及同目录原始日志、运行观察和图片 |
| 完整应用 | **9401项：8718通过、683环境条件跳过，零失败／取消**；2648份代码、测试及准备来源前后不变。包括版本一致性、1628份JS语法、API预检及全部应用测试；不包含Rust全量或安装验收 | [状态](full-check-status.json)、[完整日志](full-check.log)、[来源前](full-check-sources-before.json)、[来源后](full-check-sources-after.json) |
| 原证据与后端保全 | 旧6专题360文件、全部85份后端GD／文本及HEAD中的13020份历史证据保持原路径和字节；两份Chrome15源守卫另行核对 | [开发阶段保全](preservation.json)、[最终保全](final-preservation.json)、[最终核对](final-verification.json) |

新专项31项中28通过、3原生条件跳过；原生3/3在另行指定真实工具和窗口条件下运行。各组与完整回归有交集，不相加为覆盖率，也不把条件跳过记为真实工具通过。

## 发现与修复

1. 交叉复核发现：目标场景自身损坏时，该场景未进入有效计划，合法UUID被连带误报为组装外目标。修复为先返回原始场景／资源错误，再对完整成员计划执行导航检查；新增真实宿主负例，恢复场景后真正组装外目标仍拒绝，作者文件各步不变。保留[原复现](pure-host/viento-scene-navigation-partial-member-probe.json)、[未修复红灯](pure-host/partial-member-fix-unpatched-regression-failure.log)、[补丁准备和隔离验证](pure-host/partial-member-fix-preparation.json)。
2. 初次图形探针假设聚焦BaseButton会消耗激活键；该Godot修订中按钮触发但按键仍继续传播。最终探针由GUI明确accept_event，并核对handled=true；生产模板未因此修改。旧探索和[修复前首轮原生](native-final-2026-11-13/summary.json)保留，最终规划器上的重跑见post-preflight目录。
3. 首次纯／host／包测试分别有数字UUID大小写未变化、工具未配置而提前拒绝、音轨属性名错误的夹具问题，全部纠正且保留原失败日志；作者Chrome首次探针漏点“开始编辑”，仅修正操作脚本。原始记录不改写为产品错误或成功。
4. [首轮完整回归](full-check-initial/full-check-status.json)为9400项、8717通过、683跳过，源码不变；它早于诊断顺序修复。最终修复与新增回归后重新执行完整检查，以上最终结果才对应当前源码。早期30项专项保留于[targeted初次记录](targeted/initial-before-preflight-fix/final-source.json)。

## 工具与边界

应用保持0.2.9；Godot执行描述符保持0.45.0，源码指纹包含新脚本和预检。作者格式、事务日志、运行协议及既有GD／文本不升级；不修改已安装0.2.0程序，也不发布版本。两脚本仍是作者可编辑TXT，改写后不再被官方模板预检推断。

图形使用Godot4.7.2音频清理修订、隔离Xvfb和软件OpenGL；XTest事件证明实际窗口输入路径，不证明物理键盘设备或硬件GPU。事件结果探针由普通演示行为发布，不代表真实得分／通关逻辑。Chrome156的作者保存、受控脚本合同与实际原生窗口各自验收。当前五分钟、访问与事件预算保持；Escape仍结束运行，不是暂停或返回。

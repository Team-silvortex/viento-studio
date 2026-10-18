# 场景首次动画创建验收

2026-10-18，0.1.5 后工作树。入口为 **构建与运行 → 场景动画**，从已有保存态 Scene2D v2/v3 开始。按名称与完整实例编号配置一条线性轨道、起止两帧，审阅后一次保存新动画 JSON、新登记、场景登记；新动画 `references` 回链场景，素材绑定为空。之后通过原文导航进入已有字段编辑器，再走普通草稿和保存。

## 本轮结果

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| 纯计划／目录／命令与旧契约 | 68/68，含30项新专项 | [core-regression.log](core-regression.log) |
| Node目录、HTTP、v11及v9/v10、BOM | 72/72；含真实SIGKILL、再次中断、外改／伪造日志、跨进程并发 | [host-transaction.log](host-transaction.log) |
| UI／三语／传输／模块接线 | 117/117 | [ui-regression.log](ui-regression.log) |
| 首次创建→目标目录→冻结计划→Godot | 5/5，四属性、两版场景；真实Godot采样与Rust一致 | [workflow-godot.log](workflow-godot.log) |
| 实际Chrome | 5组／10图、0 JS异常、22个观察来源指纹保持 | [browser.json](browser-1792292923679/browser.json)、[视觉检查](visual-review.json) |
| 完整应用 | 5886 项，5716通过／170条件跳过／0失败；980份JS预检 | [application.log](application.log) |

分组有重叠，不相加。首次全应用5886项中有1条旧目标目录测试仍期待没有animation命令，结果保留在[application-initial.log](application-initial.log)；修正为明确的animation.create边界后，[HTTP兼容8/8](http-compatibility.log)与最终完整应用重新通过。仅调整过时测试，产品代码未改。未配置工具的测试按既有条件跳过；实际 Godot 路径另由新端到端定向执行。旧v1–v10恢复174/174结果发生在BOM单行修复之前，保留为[检查点](legacy-recovery-before-bom.log)，BOM之后v9/v10已重跑，全应用亦完整重跑。

## 使用与恢复

真实浏览器验证取消迟到目录、四属性起始值、同定义两实例、中英日390px输入与焦点保留、真实三文件提交、故意丢弃已提交HTTP响应后的只读核对、打开新动画→独立字段编辑→普通Save，以及已有动画再次导航。创建仅改三份作者文件，后续普通Save仅改动画正文。界面创建不依赖Godot；实际执行仍由冻结计划和后端负责。

BOM+CRLF端到端暴露原readRegistry拒绝单个前导BOM的问题。本轮只去单个前缀解析，保持原始字节；v10/v11分别验证apply、data中断回滚与commit后恢复，未改字段的大整数、换行与0640权限保持。v9保留旧发布前拒绝边界。旧拒绝断言的失败留在[bom-old-expectations.log](bom-old-expectations.log)，没有把失败写成通过。

新目录下另保留两次浏览器测试检查点：第一次期望漏写规范 `slot`，第二次在异步目标目录完成前点击Check导致检查被正确撤销。两次仅修测试，最终从头跑完整流程；最终报告为 `browser-1792292923679/browser.json`，生产指纹保持。

职责边界与复核见[design-review.json](design-review.json)，机器汇总见[summary.json](summary.json)。

## 数据与范围

[preservation.json](preservation.json)核对7925份既有示例／历史／报告、2204旧评分、2335旧证据及版本／安装。只追加新功能评分；旧作者示例和旧验收专题不修改。测试都使用临时副本。

本轮真实Godot在新生成临时工程运行，观察选中实例的实际变换与Rust样本一致；未重跑旧多场景ZIP或Godot窗口验收。未更新准备副本、桌面安装或Android设备，不改变Rust ABI、动画schema或后端版本；Bevy视觉动画、图集／序列帧、骨骼、行为播放控制与3D仍不在范围。未升版、commit或push。

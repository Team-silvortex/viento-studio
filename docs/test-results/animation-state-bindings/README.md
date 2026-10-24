# 状态与动画片段配置验收

2026-10-24，0.2.0 后工作树。新配置从严格生成的状态表读取当前绑定所需参数，按名称选择已保存场景片段，经显式参数表合并、普通原文审阅和 Save 后进入既有运行流程。

## 结果与证据

- [定向回归](related.log)：145 项，143 通过、2 项真实 Godot 条件跳过、0 失败。含新领域 21、服务 5、独立 UI 16 和实际行为编辑器 50 项，其余为参数／目录／来源／保存回归；各组重叠不相加。
- [最终浏览器与 Godot](browser-authoring-1792813246200/browser.json)：Chrome 真实界面，Godot 4.7.2-stable；3 个 GUI 规划／构建／运行任务成功，11 张截图，生产来源指纹全程一致。中英日 390px 保留选择、焦点，无横向溢出。
- [完整应用检查](full-test.log)与[源码预检](check.log)的最终计数见 [summary.json](summary.json)。条件跳过及重跑范围单列，不以浏览器检查替代原生安装验收。

运行夹具使用 v5 组合条件：共享状态 `combat.enabled=true` 且事件载荷为数字 `3`。在界面为 `idle`、`attack` 选择命名片段，保存后的实际协议 10 回执为三次进入 `idle → attack → idle`、6 条选择／播放命令、1 次非循环片段自然完成；事件和完成来源分别关联。只有当前行为文档发生作者修改，其余绑定、脚本、场景、动画、登记和身份保持；执行后所有已保存作者文件保持。

首轮 [run1](browser-authoring-1792813014654/browser.json) 的功能断言通过，但运行中生产 UI 修复了异步票据撤销，最终来源指纹检查失败，不能作为冻结验收。随后 [run2](browser-authoring-1792813061424/browser.json) 完整通过；最终宿主再修正原参数行身份的保留方式后重新运行 run3。三个目录分别保留当时证据。

## 行为与边界

- 严格完整 v1–v5 生成源码才提供可选声明；普通、手改、未知版本及缺核心不借名称猜测状态用途。可选声明沿现有依赖摘要隔离，未改变作者文件和运行协议。
- 下拉选择和重置不改参数表。显式应用前重新读取并比对目录；片段删除、场景或来源变动、关闭／切换绑定／实例／脚本、参数变化及已观测的其他审阅操作撤销旧请求。迟到结果不能重新取得修改权限。
- 只合并当前声明对应的参数，原行顺序、其他参数值和行身份保留，缺项末尾追加。缺片段、无动画、重复目标、错误类型及 32 项预算阻止该助手应用；循环片段有完成转换时仅警告。普通参数编辑仍独立可用。
- 空值明确选择完整动画，旧目录不提供整段循环属性，因此界面提示作者在动画文档核对。目录检查是读取时快照，不提供持续引用保护或自动删除迁移。
- 仍为场景共享播放头，不增加每实例独立播放、混合、骨骼、Bevy 动画或运行用例断言。本轮没有重新安装、提交或推送。

## 复现

```sh
node --test scripts/tests/animation-state-bindings.test.mjs scripts/tests/scene-behavior-state-bindings-*.test.mjs scripts/tests/scene-behaviors-editor-ui.test.mjs
VIENTO_GODOT_BIN=/absolute/path/to/trusted/Godot node scripts/tests/scene-behavior-state-bindings-smoke.mjs
npm test
npm run check
```

烟测仅写临时作品和新的专题证据目录。前一次已安装 AppImage 与用户作品不参与本轮写入。

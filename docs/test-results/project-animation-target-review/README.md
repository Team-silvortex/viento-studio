# 按动画目标回看运行记录

已接通“命令／完成条目 → 动画目标回看 → 目标最后命令 → 原文来源”的只读工作流。运行记录按本次访问、场景和显式目标归组，同一实例的多个绑定共同展示，其他实例与场景重入分别维护。操作见[动画指南](../../SCENE_ANIMATION.md#按动画目标回看运行记录)，精确结果见[汇总](summary.json)。

## 验证结果

- 正式完整 `npm run check`：**7448项，7087通过、361条件跳过，0失败／取消**。1235份JavaScript、版本／API、885份文档、19份模板和885唯一索引检查通过，见[日志](app-check.log)。
- 本轮新增33项已纳入全量：领域11、独立UI16、实际宿主4、旧平铺列表入口2；不与全量相加。覆盖同实例跨绑定、同定义多实例、重入、scene自动播放零锚点、两个序号域、深冻结与不可信输入、异步来源撤销及Close恢复原入口。
- 真实Chrome HTTP编辑器通过界面检查计划、构建并启动Godot **4.7.2**，三个任务成功，得到**6条命令、2次自然完成**。三语390px、精确来源导航与焦点保留通过，保存**10张截图**，零页面异常；见[浏览器及原始运行报告](browser-1792821220904/browser.json)。
- 图谱现为**155功能／461实现／669绑定／2676评分／118工作流**，既有2668评分及2817证据对象保持。新增两层验证分数4仅表示本轮源码实测，交付仍为工作树2；图谱生成与前缀核对见[最终审计](final-audit.json)。

全量中的条件跳过保持为跳过，不计作本轮实际后端通过。最初85项定向验证见[宿主日志](host-integration-before-focus-refinement.log)；它早于Close独立opener完善，最终关闭行为由完整回归和真实Chrome验证，未将早期结果冒充最终源码。

## 实际场景

临时作品中，目标A有两个行为绑定，合计执行命令1–4；目标B执行5–6。A自然完成关联目标锚点4、全局截止6，B关联6／6。回看A不会混入B的命令；A的两个控制来源均保留。两份列表分别使用命令序号和完成序号，锚点只定位原有记录，不推测额外因果。

Chrome验证两类入口、分组选择、原列表过滤独立、锚点跳转后关闭返回原完成入口，以及切组后旧来源按钮不能导航。英文、中文、日文切换保留同一组选择节点、焦点与已选记录，390px无横向溢出。七类原文入口验证两个A绑定、B绑定、动画、两个片段与B完成订阅来源的精确UTF-16范围。

36份作者文件前后逐字节一致；22份本轮关键源码SHA与浏览器实测时一致。原始摘要和Godot回执保存在报告内，脚本清理了临时作品，不修改用户作品、旧专题或已安装应用。

## 分层与边界

`project-animation-target-review.mjs`只从完整protocol11观察建立品牌冻结模型；`create/query/find`接口不接收DOM、文件或后端工具。独立UI只持有选择与来源票据；构建宿主以显式回调连接两个原列表。来源读取保留自身加载过程，换目标、换运行、原文草稿、关闭及记录身份变化撤销迟到回复；无关追加和订阅状态变化保留有效票据。

只列有命令或完成证据的目标，不补造完整实例清单；记录中的状态与播放位置不代表当前画面。scene目标的自动播放完成可没有命令，零锚点明确为空。协议1–10不推断目标，继续原列表。此回看没有播放、保存或执行权限，也不提供实际运行断言、未进入分支诊断或时间倒放。

应用保持0.2.0，作者schema4／动画子计划3／协议11／Godot0.20.0／清单12和Rust/WASM保持。本轮没有新增Bevy动画、单场景实例构建、骨骼、混合、3D动画、安装更新或Android验收；既有逐实例运行和ZIP证据保留在[前轮专题](../animation-instance-runtime/README.md)，没有改标为本轮重跑。

## 重跑

```bash
node --test scripts/tests/project-animation-target-review.test.mjs scripts/tests/project-animation-target-review-ui.test.mjs scripts/tests/project-animation-observation-build-ui.test.mjs scripts/tests/project-animation-observation-ui.test.mjs scripts/tests/project-animation-completion-observation-ui.test.mjs
VIENTO_GODOT_BIN=/绝对路径/Godot node scripts/tests/project-animation-target-review-smoke.mjs /usr/bin/google-chrome
npm run check
node scripts/function-atlas.mjs --check
```

浏览器脚本只使用临时复制作品，每次写入新的证据目录。已安装Tauri、原生图形窗口及设备执行分别验收，本记录不覆盖这些范围。

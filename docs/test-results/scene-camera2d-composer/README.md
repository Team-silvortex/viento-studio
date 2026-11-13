# 二维相机可视构图：2026-11-11 工作树验证

应用版本保持0.2.9，Godot执行描述符保持0.43.0。本轮在已有运行主相机设置中接通逻辑构图、拖动候选及场景设计／组装入口视口参照，没有增加作者格式、事务日志或运行协议版本。未提交、发布、更新安装程序或迁移真实作品。

## 已交付的操作

保存的Scene2D → “构建与运行” → “运行主相机” → “相机构图示意”。橙框内拖动或方向键调整固定中心／跟随偏移，Shift每次10世界单位；适配、平移、示意缩放和切换视口参照只改变本地视图。拖动期间不改表单，正常结束只回填候选坐标；旧审阅失效，仍须重新审阅和显式保存。取消、失效owner、关闭或销毁均不提交手势。

同一快照中的共享场景解析器提供继承后的逻辑尺寸、颜色与位置；跟随使用稳定实例UUID，区分共用OC定义的多个实例。视口参照独立携带来源与修订，组装参照仅表示入口尺寸，不表示已通过完整构建。几何或可选来源失效仅关闭相关示意，数字表单保持可用；恢复相同来源后可重新显示。

此示意不读取素材字节、不显示材质／动画、不模拟物理或运行状态。纯几何、只读宿主DTO、Canvas临时手势和父表单保存权分开；未来ns-nova原生GUI可替换现宿主，保留语义和验收样例。操作见[相机指南](../../SCENE_CAMERA2D.md)。

## 验证结果与来源

| 记录 | 实际范围 |
| --- | --- |
| [最终定向日志](targeted/final-source.log)、[来源守卫](targeted/final-source.json) | 新增55/55，零失败／跳过。纯模型15、严格上下文10、宿主4、真实Canvas工厂17、父表单审阅保存6、真实setup恢复3。12份核心代码与测试前后不变 |
| [最终真实浏览器与窗口](browser-recovery-fixed-2026-11-11/browser.json) | Chrome156，132断言、零浏览器错误；33份来源前后及当前一致，31份作者文件留存快照。实际HTTP创建／更新、取消零写、固定与follow拖动、无效参数隐藏旧框、视口切换不写、重新审阅、同OC第二实例及三语390px |
| [固定取景](browser-recovery-fixed-2026-11-11/godot-fixed.png)、[跟随取景](browser-recovery-fixed-2026-11-11/godot-follow.png) | 浏览器保存后的同一作者工程，经标准buildProject／import／script-check及Godot `windowCapture`。组装入口800×480，目标场景640×480；实际进入第二场景。固定色块bounds `[348,209,368,229]`、20×20；跟随bounds `[408,168,488,248]`、80×80，与纯构图计算一致 |
| [完整应用日志](full-check.log)、[状态](full-check-status.json)、[前](full-check-sources-before.json)／[后](full-check-sources-after.json) | 执行 `npm run check -- --app-only`，9247项：8576通过、671按环境条件跳过，零失败／取消；1587份JS语法、版本一致性及API预检通过；2600份代码／测试／准备来源前后不变。条件跳过不计作通过 |
| [保留证明](preservation.json) | 13020份已跟踪历史证据与78份旧后端GD／文本逐字节等于HEAD；之前三个未提交专题43／39／104份文件与开工快照一致 |

真实窗口使用Godot 4.7.2独立音频清理修订版与Xvfb／Mesa llvmpipe软件图形；工具SHA及实际阶段在browser.json中。它不证明硬件GPU、其他操作系统、Bevy相机、HUD、安装产物或连续游戏模拟。Canvas工厂测试使用记录绘制操作的假Canvas，不单独承担像素验收；三语截图及两张Godot窗口分别实际目检。

## 首败、修复与重跑

- [首轮Canvas](targeted/viento-camera2d-composer-canvas-initial.log)14项中2败，发现其他pointer的cancel会抢占当前手势，以及destroy后迟到setModel可复活画布。[第二轮](targeted/viento-camera2d-composer-canvas-second.log)运行时销毁修补尚未落地，16项中仍1败；修复后[32项工厂＋模型组合](targeted/viento-camera2d-composer-canvas-final.log)全过。随后补齐最终pointerup坐标、非有限坐标取消、DPR8时每轴最多4096像素的绘制预算和销毁终态回归。
- 宿主首轮夹具使用缺revision的旧投影stub，严格来源捕获正确拒绝；改用真实WorldProjection构建夹具，不放宽身份校验。[首轮](targeted/viento-camera-framing-initial.log)、[次轮](targeted/viento-camera-framing-second.log)、[43项扩展回归](targeted/viento-camera-framing-final.log)保留；JSON形似assembly的Markdown不作为合法参照。
- [浏览器探索](browser-exploratory-2026-11-11/browser.json)功能与窗口断言已完成，最终因开发中源变化触发守卫而失败，不能算冻结源码验收。[第一份冻结实测](browser-frozen-2026-11-11/browser.json)当时132断言通过，随后独立审查发现同owner的A→失效→A上下文恢复缺陷；清理失效缓存、补3项真实setup回归后，重新运行[最终修复源码实测](browser-recovery-fixed-2026-11-11/browser.json)。旧两份记录保留原指纹，不改写成最终源码结论。
- `/tmp`原始定向回执已按原字节复制到`targeted/`，其中原路径和当时哈希保留；它们不是当前源码的前后证明。修复后的统一来源依据是`targeted/final-source.json`、最终浏览器报告和完整应用守卫，三类测试不简单相加为覆盖率。

本轮未重新执行上一专题的作者包／工程ZIP离线专项，不把已有相机迁移结论改称本轮验收。旧运行生成器、作者保存与迁移通道保持；本轮范围是可视构图到既有保存和实际取景的交接。

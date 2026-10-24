# 按实例预览已保存场景动画

本轮在 0.2.0 后工作树接通独立播放会话、逐实例 Rust 采样、整层视觉准入与场景预览入口。操作见[动画文档](../../SCENE_ANIMATION.md#按实例预览已保存动画)。

进入场景预览后，切换“动画预览范围”为“按实例预览”，两个同定义但不同编号的角色可以独立选片段、播放、暂停、定位与停止。切换选择保持其他目标播放；全部还原保留片段选择。非循环停末帧、循环各自循环，后台暂停保留最后画面；隐藏、换快照、改范围和失效回调清理整个会话。

- [联合专项](focused.log)：58/58 通过，包含新会话 16、新视觉层 5、独立控件 15、父控制器 12 和 Canvas 10；各组与全套测试重叠，不相加。
- [完整项目检查](check.log)：包括版本、JavaScript 语法、API、模板、索引及完整应用测试。最终计数见 [summary.json](summary.json)。本轮只运行一次完整检查，不另行重复全套应用测试。
- [最终浏览器结果](browser-1792814726419/browser.json)：真实 Chrome 154、临时双实例场景、5 张截图；不同片段与时间实际 Canvas 像素、独立完成与循环、单目标/全部还原、三语 390px 焦点和尺寸、后台暂停、旧 rAF 回放及迟到 HTTP 清理全部通过。

最终浏览器检查中，10 份作者文件路径和字节保持，无作者写请求或构建任务；4 次 DELETE 只释放临时预览租约。生产来源摘要在运行前后相同。截图已目视检查，窄屏采用纵向滚动。

首次浏览器记录 [browser-1792814697479](browser-1792814697479/browser.json) 因测试把释放临时预览的 DELETE 误记为作者删除而失败；此前产品步骤已通过。修正新测试的请求分类后重跑通过，未修改产品或覆盖旧证据。

## 分层与范围

`engine/scene-animation-instance-playback.mjs` 只接收经过品牌准入的保存态目录，按稳定 instanceId 建立独立播放头，调用既有 Rust transport/sample。推进所有实例与采样先计算、后统一提交；任一失败保留原状态。每份样本保留自己的时间和完成状态，不伪造共同播放头。

`engine/scene-animation-instance-visual-frame.mjs` 校验整层样本的目标、通道、身份与预算，再交给 Canvas 一次替换视觉。独立界面只持有会话、时钟和渲染端口；场景宿主负责来源、布局编辑权限及范围切换。作者 schema 1/2/3、Rust/WASM ABI、运行协议及后端适配器没有变化。

这是临时图形预览。当前项目执行仍使用整场景动画播放头；本轮不执行行为/状态脚本、声音或物理，不证明 Godot/Bevy 逐实例播放、3D、骨骼混合、原生安装或 Android 能力。后续执行端需显式目标与逐目标命令/完成身份，不能把命令来源直接等同于目标，也不能让一个角色的命令撤销另一个角色的完成通知。

## 复现

```sh
node --test --test-isolation=none scripts/tests/scene-animation-instance-playback.test.mjs scripts/tests/scene-animation-instance-visual-frame.test.mjs scripts/tests/scene-animation-preview-canvas.test.mjs scripts/tests/scene-preview-animation-ui.test.mjs scripts/tests/scene-preview-instance-animation-ui.test.mjs
node scripts/tests/scene-animation-instance-preview-smoke.mjs
npm run check
```

Chrome 脚本仅复制临时示例，每次生成新证据目录。源码仍为 0.2.0，本轮未提交、推送或更新安装。

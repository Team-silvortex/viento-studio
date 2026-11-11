# 物理样本的位移与碰撞示意

本专题记录 **2026-11-04、0.2.8 后续未发布工作树**的只读物理调试增量：在选中样本中比较请求／实际端点、实际接触位置和法线。应用版本保持 0.2.8，Godot 执行描述符保持 0.41.0；安装版仍为此前验收的 0.2.0。本轮没有修改作者格式、运行协议、求解器或后端能力。

操作见[物理指南](../../SCENE_PHYSICS2D.md#查看位移与碰撞示意)，实现边界见[纯模型接口](../../../engine/README.md#物理样本的只读示意模型)。前三轮[触发区占用](../scene-physics2d-sensor-occupancy/README.md)、[验收样本定位](../physics-case-inspection/README.md)和[平面意图](../scene-physics2d-planar-intent/README.md)保留原日志与源码摘要，不合并改标为本轮重跑。

## 实现与边界

- `createProjectPhysics2DSampleDiagram(observation, sequence)` 完整验证全部观察，再取精确序号；无效或缺失返回 `null`，不回退。深冻结副本保留原始样本与 assemblyId。
- 请求和实际端点都相对移动前原点；请求直接使用 `requestedMotion`，实际使用已验证的 `displacement`。接触位置独立相减，travel／remainder 继续是数值，不拼成路径。没有作者几何、墙体推测或第二次求解。
- 两轴统一除以 `2^scaleExponent`，安全处理极大相减与 subnormal。极端动态范围下丢失非零投影时明确提示 `degraded`，原数值保留；正常样本各自取景，不能以图上长度直接比较不同样本速度。
- 独立 SVG 端口只消费 DTO；起点十字、请求方框／虚线、实际圆环／实线和编号接触点不依赖颜色区分。法线单位化后固定绘制 20 单位方向箭头；运动没有固定箭头头部，避免夸大微小位移。实际线是端点连线，不能当作真实运动路径或持续接触证据。
- 观察控制器负责当前样本归属及焦点。缓存包含组装身份，同样数据换组装也重新产生 DTO；同样样本刷新／换语言保留图元和选择器焦点，关闭、失效或新任务撤销旧图。独立来源按钮继续走已有原文和草稿守护。

## 定向检查与首轮失败

| 执行 | 结果与证据 |
| --- | --- |
| 纯模型 | 12/12、零跳过；[日志](model-unit.log)、[范围及摘要](model-evidence.json)；包括 100 组极端数值网格、平移不变、MIN_VALUE、极大坐标小请求、非法非选中行、getter／serializer 拒绝、深冻结和精确序号 |
| 初始已有 UI 链 | 40/40、零跳过；[原始日志](ui-initial-existing-40.log) |
| 首批图形回归 | 46/48，两个数量断言失败；[原始日志](ui-initial-failure-48.log)。图例和 SVG 都使用 data-role，选择器多算了一个图例。将图例改为 data-legend，保留图元数量与几何的严格断言 |
| 修复后中间检查 | 104/104；[日志](ui-intermediate-104.log)。之后复核发现缓存还需包含 assemblyId，补入同样样本换组装的回归 |
| 最终受影响链 | **105/105，零失败／跳过**；[日志](ui-final-105.log)、[准确命令与最终源码摘要](ui-evidence.json)；包含上述模型检查、真实 renderer 的 DOM harness、观察／构建接线、选择／来源守护、回放／验收作者界面和三语 |

105 项已经包含 12 项纯模型，不相加为覆盖率。DOM harness 执行真实 renderer，显式支持 SVG namespace；完整严格选择 helper 在同一 VM realm 执行，不通过 JSON 克隆请求来隐藏访问器或身份问题。UI 摘要在最终成功命令之后捕获，不宣称为该命令前后的双向守卫。

## 真实 Chrome 与 Godot

环境：Node.js **v24.21.0**，Chrome **156.0.8078.73**；独立修订 Godot **4.7.2.stable.viento_audiofix1_ed1daf0bf**，可执行文件 SHA-256 为 `d0214fafa4af018589761b772f38be02b421cd021ed69c45c1d7a4bcd2acbb04`。使用独立临时作品、缓存、配置和浏览器 profile，不运行已安装 Studio。

[首轮报告](browser-initial-2026-11-04/browser.json)通过后，为直接目检窄屏零位移重合标记，补充对应截图并重跑相同独立流程；[正式报告](browser-final-2026-11-04/browser.json)及其 6 张截图保留最终脚本与生产源码的前后摘要守卫。首轮记录保持原字节。

正式流程产生 5 个成功任务：检查计划、构建、物理输入回放、含一条正确预期及一条故意错误预期的验收、不同输入的新回放。验收任务正常执行完成，但结果如预期为失败，逐条结果为 `[true, false]`。

1. 真实角色斜向墙面滑动，样本 **9** 有一条已映射接触。请求位移为 `[2.828427314758301, 2.828427314758301]`，实际位移为 `[2.3699111938476562, 2.82843017578125]`。从原始 observation 独立计算相同的等比投影，逐项核对 SVG 线段端点、方框／圆环位置、接触点、法线起止及箭头臂方向，法线显示长度为 20。
2. 自然释放输入后的样本 **16** 为真实零请求、零位移、无碰撞；三种标记同心，没有运动或法线箭头，页面明确说明零位移。不是手工制造的运行观察。
3. 图元 title 逐项包含原始精度的移动前后位置、请求／实际位移、接触位置、法线、travel 与 remainder；选择条目与该次真实样本对应，故意错误预期不替代实际值。
4. 同一记录刷新和切中英日保留 SVG、线段节点和样本选择器焦点；三语 **390×844** 的图均为 **281×281**，保持等比，无外层横向溢出。桌面及窄屏截图均目检，图例可读；零位移方框、圆环、十字可区分并有文字解释。
5. 切换样本移除旧碰撞图元；关闭移除旧图，重开按当前样本重建；不同输入的新任务移除旧 SVG，图与新任务的首条实际样本一致。
6. 选择／看图不发起变更 HTTP 请求，不自动打开原文或新运行。明确点击来源按钮才打开精确 body 范围；**39 个作者文件前后摘要完全一致**，没有自动保存。临时 profile、服务与测试目录按清理回调释放，报告中无本机绝对路径。

复现命令（输出目录必须是未使用的新目录）：

```sh
VIENTO_GODOT_BIN=/absolute/path/to/Godot \
VIENTO_PHYSICS_SAMPLE_DIAGRAM_OUTPUT="$PWD/docs/test-results/physics-sample-diagram/browser-new-run" \
node scripts/tests/physics-sample-diagram-smoke.mjs /usr/bin/google-chrome
```

截图：[桌面碰撞](browser-final-2026-11-04/diagram-desktop.png)、[中文](browser-final-2026-11-04/diagram-zh-CN-390.png)、[English](browser-final-2026-11-04/diagram-en-390.png)、[日本語](browser-final-2026-11-04/diagram-ja-390.png)、[零位移窄屏](browser-final-2026-11-04/diagram-zero-390.png)。

## 完整应用检查与最终守卫

最终 `npm run check -- --app-only` 成功：**9058 项，8397 通过、661 条件跳过，零失败／取消**；JavaScript 语法检查覆盖 1541 文件，版本一致性和 API 契约预检通过。[完整日志](app-final.log)保留输出并将本机绝对路径替换为占位符；[汇总与最终源码摘要](summary.json)记录实际计数与范围。

第一次完整检查在产生最终测试计数前以退出码 143 中断；[当时日志](app-interrupted.log)仅含版本、语法和 API 预检，不视为通过或测试断言失败。源码与单元测试保持冻结后重新执行，以上计数来自完成的第二次检查。

条件跳过需要各自的原生归档、移动存储、Bevy 或工具环境；本轮真实 Chrome／Godot 流程另行执行，不把条件跳过称为原生通过。最终源码摘要与 UI／模型／正式浏览器证据逐项一致；前三轮 **136 份证据文件**和图谱全部旧数组前缀通过[字节及结构保留审计](preservation.json)。

本轮不覆盖已安装 Tauri、Android、Windows／macOS、Bevy 物理、真实设备键盘、持续运行、完整运动轨迹、持续接触或所有碰撞体类型。原生无头回执和浏览器排版各按自身范围解释，不外推安装或图形 GPU 验收。

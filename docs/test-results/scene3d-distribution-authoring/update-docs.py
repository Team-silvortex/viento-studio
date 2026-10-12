from pathlib import Path
p=Path('/tmp/viento-scene3d-distribution-n4tesgxn/project')
summary='当前 0.0.10 之后的工作树新增[独立 3D 位置等距分布](SCENE3D.md#等距分布多个对象的位置未发布增量)：显式选择 3–128 个对象及作者轴，Rust 按原坐标与声明顺序排序，保留两端原位置，只保真修改中间对象该轴的净变化词元。完整候选审阅后应用草稿并普通保存；非零跨度无法在浮点精度内严格排列时整次拒绝。第十五模块仅依赖文档模块，七份作者审批独立，预览、schema 与执行后端保持。当前十五模块、31 项声明能力，版本保持 0.0.10。'
for name in ['ARCHITECTURE.md','ROADMAP.md','STATUS.md']:
 f=p/'docs'/name;s=f.read_text();line,rest=s.split('\n',1)
 if rest.startswith('\n当前 0.0.10 之后的工作树新增[独立 3D 参照位置对齐]'):rest=rest.replace('\n当前 0.0.10 之后的工作树新增[独立 3D 参照位置对齐]','\n上一对齐专题在 0.0.10 之后的工作树新增[独立 3D 参照位置对齐]',1)
 f.write_text(line+'\n\n'+summary+'\n'+rest)
f=p/'docs/SCENE3D.md';s=f.read_text();marker='## 管理方块对象（未发布增量）';assert marker in s
section='''## 等距分布多个对象的位置（未发布增量）

在 JSON 原文会话点击 **等距分布3D位置**，勾选 3–128 个对象，再选择作者 X、Y 或 Z 轴。点击 **检查等距分布**后，Rust 按各对象该轴的原坐标从小到大排列，同坐标按原声明顺序排列；点击顺序不会改变结果。审阅中的分布顺序来自同份原文，与原文顺序的全部所选前后声明分别展示。筛选隐藏的已选对象仍参与，默认不选择对象。

原排序两端的坐标与数字拼写保持。中间坐标按 `start + (end - start) * (i / (n - 1))` 的二进制64位浮点运算顺序计算，只修改所选轴；未选对象、其他轴、旋转、尺寸、名称颜色、相机与光照保持。分布对象的作者位置，与屏幕视角和外形边缘无关。原坐标全同或没有净变化时没有可应用审批；非零跨度的计算结果若因精度不足不能严格递增，整次拒绝并保留原文，不自动挤压或合并对象。

检查后审阅分布顺序、完整前后对象、净变化路径及完整候选，再 **应用到原文草稿**，最后使用普通保存。对象、轴、查询、原文、文档或会话变化都会撤销审批；关闭、取消和旧列表事件不能影响重新打开的操作。已有未保存草稿也可作为来源。查看结果时刷新独立预览。

Rust 校验原文、所有目标和完整最终模型，只拼接净变化数字词元；BOM、CRLF、转义键及其他原字节保持。最终 UTF-8 预算为128KiB，在合并所有修改后一次判断；无效输入、精度不足或超限均不会产生部分结果。独立可选核心能力、第十五模块及第七私有作者提案只取得自己的五字段来源和草稿接口。缺新能力只关闭此入口；对象格式、只读渲染器、旧六作者域与执行后端分别保持。接口见[核心契约](../engine/README.md#3d-单轴等距分布未发布增量)。

'''
s=s.replace(marker,section+marker);s=s.replace('当前工作树共声明 12 个模块、28 项能力；','当前工作树共声明 15 个模块、31 项能力；')
needle='## 模块与验证范围\n';s=s.replace(needle,needle+'\n`org.viento.scene3d-translation`、`org.viento.scene3d-alignment` 与 `org.viento.scene3d-distribution` 分别取得独立的五字段来源和自己的草稿应用接口，只依赖文档模块，分别声明 `scene.authoring.translation3d`、`scene.authoring.alignment3d` 与 `scene.authoring.distribution3d`；共享宿主末端守护不共享审批。\n')
f.write_text(s)
f=p/'docs/STUDIO_MODULES.md';s=f.read_text().replace('整体移动与位置对齐模块；当前共十四个固定模块、30 项声明能力','整体移动、位置对齐与等距分布模块；当前共十五个固定模块、31 项声明能力')
row='| `org.viento.scene3d-alignment` | 独立 2–128 个所选对象沿作者单轴对齐到明确所选参照，完整审阅与草稿应用；只依赖文档模块，提供 `scene.authoring.alignment3d` |';assert row in s
s=s.replace(row,row+'\n| `org.viento.scene3d-distribution` | 独立 3–128 个所选对象按原坐标／声明序排序、保留两端的单轴等距分布；完整审阅与草稿应用；只依赖文档模块，提供 `scene.authoring.distribution3d` |')
s=s.replace('六种创作提案','七种创作提案').replace('七个 3D 视图','八个 3D 视图').replace('六份作者品牌互不替代','七份作者品牌互不替代')
s+='\n`scene3dDistribution` 独立取得 `getContext`／`getSource`／`applyDraft`，缺端口或同名 feature 为 false 只关闭该区。排序、数值规则和保真补丁在 Rust，界面仅持有选择、轴及自己的审阅；第七私有作者品牌不能跨入口应用。无新 distribution ABI 时旧六作者域保持，普通保存仍负责磁盘与外部冲突。见[位置等距分布](SCENE3D.md#等距分布多个对象的位置未发布增量)。\n';f.write_text(s)
f=p/'engine/README.md';s=f.read_text().replace('当前共十四模块、30 项声明能力；作者 schema','该对齐专题当时共十四模块、30 项声明能力；作者 schema')
s+='''
## 3D 单轴等距分布（未发布增量）

独立可选 `viento_core_scene3d_distribution_version() === 1` 与既有 `scene3d.parse` 共同决定 `supportsStudioCoreScene3DDistributionPatch()`。`dispatchStudioCoreScene3DDistributionPatch(request)` 接受精确五字段请求：

```js
{
  protocolVersion: 1,
  operation: 'scene3d.distributeObjects',
  content: originalText,
  instanceIds: [firstUuid, secondUuid, thirdUuid],
  axis: 'x',
}
```

目标为3–128个不同且已存在的稳定UUID。原生从同份完整原文按该轴数值升序排序，相等数值（含正／负零）按声明序，不采用调用者顺序。原排序两端直接保留作者数值和词元；内部点使用 `start + (end - start) * (i / (n - 1))` 的 binary64 运算次序，不采用融合乘加。跨度为0合法返回无净变化；非零跨度若最终序列含两端不能严格递增，整次 `scene3d_distribution_invalid`，没有部分回执或自行修正。其他作者约束及最终128KiB UTF-8预算在完整候选上核对，增长与收缩共同结算。

精确回执 `scene3dDistributionPatch` 为 `{ instanceIds, orderedInstanceIds, axis, beforeContent, afterContent, changedPaths }`：`instanceIds`按原声明序，`orderedInstanceIds`按分布序，路径只列净变化该轴token并按原文对象序。桥接核对两套完整UUID、轴、前后模型及词元之间的全部未授权字节；不允许伪造重排或额外数字修改。未变内部点、两端、其他轴与对象、键拼写、指数／负零、BOM及CRLF保持。原生与桥接接受no-op，作者提案以 `scene3d_distribution_unchanged` 拒绝审批。

`scene3d-distribution.mjs` 提供 `createScene3DDistributionProposal(source, { instanceIds, axis })`、`isScene3DDistributionProposal()` 和 `prepareScene3DDistributionApply(source, proposal, { digest })`。来源精确为 `{ sourcePath, token, content, baseSourceRevision, sourceRevision }`；独立深冻结提案携带原文、前后所选完整对象、两套身份顺序、轴与路径，具有第七私有品牌。序列化、克隆及旧六域提案不授予应用权。准备在await前分离来源，核对身份与摘要并重算完整原生补丁；宿主最后复核当前会话和审批，才一次写入原文内存，普通保存负责持久化和冲突。

`org.viento.scene3d-distribution`仅依赖文档模块，贡献 `scene.authoring.distribution3d`，通过独立 `scene3dDistribution` 端口装配。当前15模块、31项声明能力，schema、只读预览、渲染、2D和执行后端保持。缺新探针仅禁用本域；用户步骤见[等距分布](../docs/SCENE3D.md#等距分布多个对象的位置未发布增量)。
''';f.write_text(s)
print('Six docs updated with exact independent distribution contract; stale SCENE3D current module count corrected.')

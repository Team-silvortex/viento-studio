from pathlib import Path
p=Path('/tmp/viento-scene3d-copy-jxe_q12r/project')
summary='当前 0.0.10 之后的工作树新增[独立 3D 批量复制](SCENE3D.md#批量复制对象未发布增量)：显式选择现有对象，为每个来源分配独立新 UUID，并设置共同 XYZ 偏移；Rust 保留全部原声明，按来源顺序一次追加保真副本。名称与其余属性继承，零偏移仍是可审阅的结构复制，可能重叠。最终场景最多128个对象，一轮成功复制最多64个且受当前剩余容量限制。第十六模块仅依赖文档模块，八份作者审批独立，原格式、预览和后端保持；当前16模块、32项声明能力，版本仍为0.0.10。'
for name in ['ARCHITECTURE.md','ROADMAP.md','STATUS.md']:
 f=p/'docs'/name;s=f.read_text();line,rest=s.split('\n',1)
 rest=rest.replace('\n当前 0.0.10 之后的工作树新增[独立 3D 位置等距分布]','\n上一分布专题在 0.0.10 之后的工作树新增[独立 3D 位置等距分布]',1)
 rest=rest.replace('本轮[等距分布验收]','上一[等距分布验收]',1)
 f.write_text(line+'\n\n'+summary+'\n'+rest)
f=p/'docs/SCENE3D.md';s=f.read_text();marker='## 管理方块对象（未发布增量）';assert marker in s
section='''## 批量复制对象（未发布增量）

在 JSON 原文会话点击 **批量复制3D对象**，勾选要复制的原对象，填写 XYZ 共同位置偏移，再点击 **检查3D复制**。默认不选择对象，偏移为零；零偏移会生成独立身份的副本，可以审阅与应用，画面可能与原对象重叠。这里的偏移作用于作者世界位置，旋转和尺寸不会改变偏移方向。

每个来源在本次表单会话中只分配一次新的 UUID。重新检查、更改偏移、查询或取消后重新勾选会复用该身份；关闭并重新打开会创建新的一组身份。审阅明确列出来源 UUID→副本 UUID、完整原对象与副本声明、新对象路径及完整候选。副本名称直接继承，不自动加后缀；之后可使用独立属性入口修改名称。

搜索只筛选列表，隐藏的已选对象仍参与。本次最多复制 `min(当前原对象数, 128 - 当前原对象数)` 个对象；每个来源最多复制一次，所以64原件＋64副本是单次最大成功批次。界面分别显示剩余对象名额及本次容量；超出容量不会静默截断选择。已经128个对象时不能追加。

共同偏移各轴为有限数，范围±200000米；每个副本最终位置各轴仍须在±100000米内。任一来源缺失、身份重复或新UUID冲突、目标越界、原文无效、最终对象数或128KiB UTF-8预算超限，都整批拒绝。浮点舍入没有改变位置时仍会复制，原数值拼写保持。Rust 不循环调用单对象复制，不验证或提交中间文档；所有副本在一处插入，最终完整候选一次校验。

原对象、身份、顺序及其所有字节保持。每个副本从来源完整 CST 声明复制，只替换新UUID值及净变化位置数字词元；名称、颜色、尺寸、旋转、键转义、其他数值写法、内部空白与字符串转义保持。副本按原来源的声明顺序追加，点击顺序不影响追加顺序，也不会重配来源与新UUID。

完整审阅后 **应用到原文草稿**，再普通保存。选择、偏移、查询、身份映射、原文或会话变化会撤销旧审批；取消、关闭和旧列表事件不能改变新的表单操作。查看结果时刷新独立预览；预览选择不会自动跳到副本，原来的遮挡与声明顺序规则继续有效。

第十六模块与第八私有作者提案只取得自己的五字段来源与草稿接口，缺新可选核心能力只关闭批量复制。旧七作者域、原格式、渲染、2D、执行后端与磁盘保存分别保持。接口见[核心契约](../engine/README.md#3d-批量复制未发布增量)。

'''
s=s.replace(marker,section+marker).replace('当前工作树共声明 15 个模块、31 项能力；','当前工作树共声明 16 个模块、32 项能力；')
s=s.replace('## 模块与验证范围\n','## 模块与验证范围\n\n`org.viento.scene3d-copy`仅依赖文档模块，贡献`scene.authoring.copy3d`，独立读取作者来源与应用草稿；结构复制审批不能与旧七域互换。\n')
f.write_text(s)
f=p/'docs/STUDIO_MODULES.md';s=f.read_text().replace('整体移动、位置对齐与等距分布模块；当前共十五个固定模块、31 项声明能力','整体移动、位置对齐、等距分布与批量复制模块；当前共十六个固定模块、32 项声明能力')
row='| `org.viento.scene3d-distribution` | 独立 3–128 个所选对象按原坐标／声明序排序、保留两端的单轴等距分布；完整审阅与草稿应用；只依赖文档模块，提供 `scene.authoring.distribution3d` |';assert row in s
s=s.replace(row,row+'\n| `org.viento.scene3d-copy` | 独立现有对象的一对一新身份及共同偏移、保真批量复制；总数最多128，完整审阅与草稿应用；仅依赖文档模块，提供 `scene.authoring.copy3d` |')
s=s.replace('七种创作提案','八种创作提案').replace('八个 3D 视图','九个 3D 视图').replace('七份作者品牌互不替代','八份作者品牌互不替代')
s+='\n`scene3dCopy`独立取得`getContext`／`getSource`／`applyDraft`，缺端口或同名feature为false仅关闭本区。第八私有作者品牌与旧七域互拒；来源五字段和最后内存守护属于共享文档宿主，不共享控制器或审批。UUID按本次会话每来源一次分配，检查不会再生；Rust一次追加完整副本，普通保存负责磁盘及外部冲突。见[批量复制](SCENE3D.md#批量复制对象未发布增量)。\n';f.write_text(s)
f=p/'engine/README.md';s=f.read_text().replace('当前15模块、31项声明能力，schema','该分布专题当时15模块、31项声明能力，schema')
s+='''
## 3D 批量复制（未发布增量）

独立可选 `viento_core_scene3d_copy_version() === 1` 与既有 `scene3d.parse` 共同决定 `supportsStudioCoreScene3DCopyPatch()`。`dispatchStudioCoreScene3DCopyPatch(request)` 只接受精确五字段：

```js
{
  protocolVersion: 1,
  operation: 'scene3d.copyObjects',
  content: originalText,
  copies: [
    { sourceInstanceId: firstUuid, newInstanceId: firstCopyUuid },
    { sourceInstanceId: secondUuid, newInstanceId: secondCopyUuid },
  ],
  offset: [3, 0, 2],
}
```

`copies`准入为1–127份精确两字段映射，来源不同且存在，新UUID不同且不与任何原对象冲突。成功复制同时要求`originalCount + copies.length <= 128`，因此实际批次最大64，且不超过当前来源数与剩余名额；不 silently 降低或截断请求。offset是作者世界位置的binary64逐分量加法，各轴±200000，副本最终每轴±100000。原解析错误沿用原域，语义身份／位置无效用`scene3d_copy_invalid`，最终对象／UTF-8预算超限用`scene3d_limit`；请求结构不合法用`studio_core_request_invalid`。零偏移和舍入后未净移动都仍合法结构复制，没有`unchanged`审批分支。

精确原生`scene3dCopyPatch`为`{ copies, offset, beforeContent, afterContent, changedPaths }`。映射按来源在原文中的声明顺序返回、保持源→新UUID对应，副本同序追加；路径仅为顺序新项`/objects/<originalCount>`等。原完整文档在最后原对象末尾只有一处插入，每份为`,`＋原数组首项前空白＋副本完整声明，原前后字节保持。副本从来源CST复制，只修改新UUID值和净变化position数字词元，名称不加后缀；原位置未净变化时词法保持。整个候选一次校验128KiB UTF-8和作者约束，不循环调用旧copy或解析中间态。

桥接使用原生前后sourceLocations、完整model witness和字符串／数字联合词元清单，限定UUID值槽及position数字槽，所有键、其他值、内部空白和原文前后段byte固定；名称恰等于旧UUID、位置与旋转/尺寸同数值时也不能扩大授权。来源UUID词法只在其副本的instanceId值被替换，其他相同字符串保持。

`scene3d-copy.mjs`提供`createScene3DCopyProposal(source, { copies, offset })`、`isScene3DCopyProposal()`与`prepareScene3DCopyApply(source, proposal, { digest })`。五字段来源`{ sourcePath, token, content, baseSourceRevision, sourceRevision }`在await前分离；深冻结第八私有品牌提案包含完整原文、规范映射、共同偏移、新项路径及原selected `beforeObjects`与新clone `afterObjects`，两套诊断同source-order mapping。准备核对源身份／两修订／摘要并重算精确补丁；宿主最后守护才更新源内存，普通保存继续负责持久化与冲突。克隆、序列化及旧七域提案无跨入口权限。

`org.viento.scene3d-copy`仅依赖文档模块，贡献`scene.authoring.copy3d`，通过独立`scene3dCopy`端口装配；当前16模块、32项声明能力。作者schema、原七域、只读预览／渲染、2D与执行后端保持。缺新探针只禁用本域。用户步骤见[批量复制](../docs/SCENE3D.md#批量复制对象未发布增量)。
'''
f.write_text(s)
print('Six docs describe exact batch-copy contract and real capacity.')

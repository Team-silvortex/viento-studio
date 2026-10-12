from pathlib import Path
R=Path('/tmp/viento-scene3d-removal-71u64wrk/project')
intro='当前 0.0.10 之后的工作树新增[独立 3D 批量移除](SCENE3D.md#批量移除对象未发布增量)：按稳定身份明确选择多个对象，Rust 一次生成保真删除区间与完整候选；未选对象的顺序、身份和原文写法保留，场景至少保留一个对象。全选不会静默调整，审阅后只应用原文草稿，普通保存负责持久化与冲突。第十七模块仅依赖文档模块，九份作者审批独立；当前17模块、33项声明能力，版本仍为0.0.10。\n\n'
for name in ['docs/ARCHITECTURE.md','docs/ROADMAP.md','docs/STATUS.md']:
 p=R/name;s=p.read_text();a=s.index('\n\n')+2;s=s[:a]+intro+s[a:];s=s.replace('当前 0.0.10 之后的工作树新增[独立 3D 批量复制]','上一复制专题在 0.0.10 之后的工作树新增[独立 3D 批量复制]',1);p.write_text(s)
p=R/'docs/SCENE3D.md';s=p.read_text();marker='## 批量复制对象（未发布增量）';assert marker in s
section='''## 批量移除对象（未发布增量）

在已登记 JSON 场景的原文编辑会话中点击 **批量移除3D对象**，勾选待移除对象，再点击 **检查3D移除**。默认不选择任何对象；名称／UUID搜索只过滤列表，隐藏的已选对象仍参与操作。列表和计数明确显示完整选择，不根据只读预览的选中状态猜测输入。

审阅待移除和保留对象的完整声明、原文变更路径和全部候选，再点击 **应用到原文草稿**。路径使用删除前的数组索引，目标按原声明顺序列出，与勾选顺序无关。场景至少保留一个对象；一轮最多移除当前对象数减一，128个对象可以移除127个。全选会明确阻止检查，不会自动保留某个对象或截断选择。取消与返回不修改原文。

Rust基于同一份有效原文一次删除选中声明及必要逗号／邻近布局，并完整检查最终场景。全部幸存对象的顺序、UUID、属性和声明文本原样保留，删除区间之外的原字节也保留；被删项之间的空白不属于保留承诺。无效原文不能靠删除修复，整个操作一起成功或拒绝。移除场景对象不删除素材。

应用只更新草稿，仍需编辑器普通保存，保存继续检测外部文件冲突。随后可刷新独立预览；预览选择只按自己的现有刷新规则回退，不参与作者审批。此入口有自己的第九私有提案和来源端口，仅依赖文档模块；缺新核心能力只禁用批量移除，其他作者能力保持。具体契约见[核心接口](../engine/README.md#3d-批量移除未发布增量)。

'''
s=s.replace(marker,section+marker,1).replace('16 个固定模块、32 项声明能力','17 个固定模块、33 项声明能力').replace('16模块、32项','17模块、33项');p.write_text(s)
p=R/'docs/STUDIO_MODULES.md';s=p.read_text().replace('等距分布与批量复制模块；当前共十六个固定模块、32 项声明能力','等距分布、批量复制与批量移除模块；当前共十七个固定模块、33 项声明能力').replace('八份作者品牌互不替代','九份作者品牌互不替代')
line='| `org.viento.scene3d-copy` | 独立现有对象的一对一新身份及共同偏移、保真批量复制；总数最多128，完整审阅与草稿应用；仅依赖文档模块，提供 `scene.authoring.copy3d` |';assert line in s;s=s.replace(line,line+'\n| `org.viento.scene3d-removal` | 独立多选保真移除，至少保留一个对象；明确删除与幸存声明、完整审阅及草稿应用；仅依赖文档模块，提供 `scene.authoring.removal3d` |',1)
s+='\n`scene3dRemoval`独立取得`getContext`／`getSource`／`applyDraft`。缺端口或同名feature为false只关闭本区，第九私有作者品牌与旧八域互拒。来源五字段与最后内存守护属于文档宿主，不共享选择或审批。Rust一次计算完整删除区间及最终候选，UI不循环单对象remove，也不删除资源。普通保存仍是持久化入口；见[批量移除](SCENE3D.md#批量移除对象未发布增量)。\n';p.write_text(s)
p=R/'engine/README.md';s=p.read_text().replace('通过独立`scene3dCopy`端口装配；当前16模块、32项声明能力','通过独立`scene3dCopy`端口装配；该复制专题当时16模块、32项声明能力');s+='''
## 3D 批量移除（未发布增量）

新增可选ABI `viento_core_scene3d_removal_version() === 1`、`supportsStudioCoreScene3DRemovalPatch()`与`dispatchStudioCoreScene3DRemovalPatch()`。精确四键请求为`{ protocolVersion: 1, operation: 'scene3d.removeObjects', content, instanceIds }`，数组允许1–128个不同现有小写UUID；必须至少保留一个对象，因此最多成功移除127项。空选择、重复／未知身份或移除全部以`scene3d_removal_invalid`拒绝，原文解析和128KiB预算优先，不能通过删除绕过无效来源。

原生`scene3dRemovalPatch`回执精确四键`{ instanceIds, beforeContent, afterContent, changedPaths }`。身份与路径按原声明顺序规范化，`/objects/i`使用删除前索引。基于原CST复用连续选中项的删除区间，一次合并拼接和最终完整解析；不循环旧单对象接口。幸存对象声明和删除区间之外的字节保留，必要逗号及邻近空白会随被删区间去除。

桥接以原生model及sourceLocations独立重建完整预期切区间，要求afterContent逐字相同，并核对所有幸存对象模型。不接受语义相同的重排、数值改写或布局整理，不引入第二套JS语义解析器。

`scene3d-removal.mjs`提供`createScene3DRemovalProposal(source, { instanceIds })`、`isScene3DRemovalProposal()`及`prepareScene3DRemovalApply(source, proposal, { digest })`。五字段来源在await前分离；第九私有WeakSet品牌和深冻结提案有11键：`kind: 'scene3d-removal'`、`sourcePath`、`sourceToken`、`baseSourceRevision`、`sourceRevision`、`instanceIds`、`beforeContent`、`afterContent`、`changedPaths`、`removedObjects`、`remainingObjects`。前者为源序待删对象，后者为全部源序幸存对象。准备核对摘要／身份／修订并重算完整补丁；宿主等待后复核会话和审批，才更新草稿，普通保存处理磁盘和冲突。旧八域及克隆不授予本域权限，没有无变化审批。

`org.viento.scene3d-removal`仅依赖文档模块，贡献`scene.authoring.removal3d`并装配独立`scene3dRemoval`来源端口。当前17模块、33项声明能力；预览、schema、2D、执行后端及旧八作者域保持，用户步骤见[批量移除](../docs/SCENE3D.md#批量移除对象未发布增量)。
''';p.write_text(s)
print('Six docs updated for source-only batch removal; historical proof files untouched')

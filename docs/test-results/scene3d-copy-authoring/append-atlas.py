from pathlib import Path
from datetime import datetime,timezone
import json
OUT=Path(__file__).resolve().parent;ROOT=OUT.parents[2];p=ROOT/'docs/function-atlas.json'
data=json.loads(p.read_text());old=json.loads((OUT/'atlas-baseline.json').read_text());result=json.loads((OUT/'results.json').read_text())
assert result['ok'] and result['status']=='stage-tested-awaiting-actual-checkout-apply'
assert result['fullApplication']['counts']['pass']==3752 and result['prepared']['groups']==362
assert result['browserFlowTotals']['new']==8 and result['browserFlowTotals']['legacy']==32
assert data['axes']==old['axes'] and data['sourceSnapshot']==old['sourceSnapshot'] and data['meta']['historicalSha256']==old['meta']['historicalSha256']
for k in ['bindings','cells','evidence','dependencies','workflows','legacyCoverage','priorities']:assert data[k]==old[k]
with (OUT/'atlas-source-snapshot-before.json').open('x') as f:json.dump(old['sourceSnapshot'],f,ensure_ascii=False,indent=2);f.write('\n')
feature='scene.copy_authoring3d'
data['axes']['function'].append({'id':feature,'label':'3D多对象原文保真批量复制','group':'场景与构建','entry':'独立选择来源与新UUID／共同XYZ位移→Rust原子保真副本→完整审阅→当前原文草稿→普通保存','boundary':[
 '0.0.10之后未发布增量；十六固定模块／32声明能力。作者schema、预览、后端及原七创作域保持。',
 '每个不同现有来源UUID对应独立新UUID，规范映射和追加副本按原声明顺序；全部原声明及其文本原样保留。',
 '请求1–127对映射，实际同时受来源数量和最终128对象预算限制，最大成功批次64；不截断超量选择。',
 '共同XYZ按binary64逐分量相加，偏移每轴±200000，副本最终位置每轴±100000；名称、旋转、尺寸和颜色继承。零偏移也创建新身份，可能重叠。',
 '复制整段来源CST，仅替换新UUID及净变化位置数字词元。单次固定尾部插入和完整最终解析／128KiB预算，任一目标无效整批拒绝。',
 '独立可选ABI与第八私有提案品牌，五字段来源、前后对象诊断和完整回执绑定。七旧域和克隆不能借用审批。',
 '桥接以原生model／sourceLocations及联合字符串数字词元见证定位身份与位置槽位；名称等于UUID或旋转等于位置也不能授权修改别的槽位。',
 '独立来源端口只改草稿；查询、表单、映射、来源、取消、旧行和异步归属变化撤销审批，普通Save处理持久化及冲突。',
 '全3752、Rust290、准备副本362及真实Chrome40流程在隔离副本完成；实际工程写回单独记录，不提高安装、设备或硬件GPU成熟度。'],
 'next':'包围盒布局、层级、模型资源、gizmo和跨视图统一历史需分别设计。','platforms':['Linux隔离HTTP/Chrome三语390px与SwiftShader','desktop/mobile准备副本标准VM'],'delivery':'working-tree'})
units=[('rust-core','原子保真副本、身份与最终场景预算','Rust',['crates/viento-studio-core/src/scene3d_copy_patch.rs','crates/viento-studio-core/src/lib.rs']),('semantic-js','独立copy桥接与槽位保真完整回执见证','JavaScript',['engine/studio-core.mjs']),('semantic-js','第八私有复制提案及五字段摘要准备','JavaScript',['engine/scene3d-copy.mjs','engine/index.mjs']),('ui','显式UUID映射、动态容量与三语复制审阅','JavaScript',['web/modules/app-scene3d-copy.js','web/scene3d-copy.css','web/i18n/en.js','web/i18n/ja.js']),('ui','第十六模块独立来源及完整草稿最终守护','JavaScript',['engine/studio-modules.mjs','web/modules/app-studio-system.js','web/modules/app-runtime.js'])]
paths=[];bound=[];start=max(int(r['id'][1:]) for r in data['axes']['implementation'])+1
for n,(arch,label,lang,files) in enumerate(units,start):
 ident=f'i{n}';data['axes']['implementation'].append({'id':ident,'label':label,'kind':'product','language':[lang],'paths':files});paths+=files;bound.append((arch,ident))
paths+=['scripts/tests/'+n for n in ['studio-core-scene3d-copy.test.mjs','scene3d-copy.test.mjs','scene3d-copy-ui.test.mjs','scene3d-copy-source-host.test.mjs','scene3d-copy-system-ports.test.mjs','scene3d-copy-smoke.mjs']]
paths+=['docs/SCENE3D.md','engine/README.md','docs/STUDIO_MODULES.md','docs/STATUS.md']
paths+=['docs/test-results/scene3d-copy-authoring/'+n for n in ['baseline.json','source-hashes-final.json','source-freeze-final.json','core-build-freeze.json','core-results.json','quality-initial.json','ui-quality-initial.json','web-validation.json','legacy-addon.json','visual-review.json','visual-review-independent.json','packaged-resources.json','prepared-final-binding.json','stage-review.json','stage-preservation.json','results.json','application-timing.json','implementation-ready.json','application-checks.log','core-native-tests-initial.log','core-js-tests-initial.log','core-regression.log','ui-and-i18n-confirmed.log','host-tests.log','module-tests.log']]
ids=[];start=max(int(r['id'][1:]) for r in data['evidence'])+1
for n,path in enumerate(dict.fromkeys(paths),start):
 assert (ROOT/path).is_file(),path
 ident=f'e{n}';kind='test' if path.startswith('scripts/tests/') else 'report' if path.startswith('docs/test-results/') else 'design' if path.endswith('.md') else 'source'
 data['evidence'].append({'id':ident,'kind':kind,'path':path,'note':'当前3D保真原子批量复制的隔离源码、完整候选审批、普通Save及full/native/copied/browser分证；本轮首跑通过，旧评分与历史前缀保持，实际写回另记录。'});ids.append(ident)
start=max(int(r['id'][1:]) for r in data['bindings'])+1
scores=[('implementation',4,'有界显式UUID批量复制形成Rust→完整候选→草稿→普通Save闭环；包围盒、层级、gizmo和统一历史仍待设计。'),('verification',3,'隔离3752应用、290Rust、362准备副本、40实际浏览器流程、native/WASM及独立来源归属分证；非安装／设备／硬件GPU验收。'),('decoupling',3,'Rust持有保真复制和预算语义；桥及第八私有品牌独立，新模块仅文档端口，旧七创作表单、预览和后端无权限互借。'),('delivery',2,'0.0.10之后未发布增量；具体源码写回另确认，没有新的提交、安装或设备交付。')]
for n,(arch,ident) in enumerate(bound,start):
 data['bindings'].append({'id':f'b{n}','architecture':arch,'function':feature,'implementation':ident,'role':'Independent atomic CST copying, complete slot-aware receipt bridge, eighth private proposal, explicit UI or guarded source-host port. No renderer/backend/Save grant.','evidence':ids})
 for dim,score,reason in scores:data['cells'].append({'coordinates':[arch,feature,ident,dim],'value':score,'reason':reason})
for target in ['scene.primitives3d','authoring.document-edit','studio.system_modules']:data['dependencies'].append({'from':feature,'to':target,'relation':'requires','reason':'复用严格3D解析、普通文档来源与独立模块装配，不依赖旧七表单、预览选择或执行后端。'})
data['workflows'].append({'id':'scene3d-copy-authoring','label':'来源选择／新UUID／共同位移→整批检查→完整审阅→一次草稿应用→普通保存／冲突','steps':['authoring.document-edit','studio.system_modules','scene.primitives3d',feature],'boundary':'零偏移仍创建副本；所有原声明不变，新副本仅身份和净位置变化。一项失败整批拒绝，来源归属守护只授权草稿。'})
data['meta']['date']='2026-10-12';data['meta']['scope']='追加独立3D保真批量复制；94功能/231实现/365绑定/1460单元，十六模块／32能力。未发布0.0.10后增量，隔离测试及准备副本分证，实际写回另确认，安装和设备评分不提高。此前时点：'+data['meta']['scope']
assert data['sourceSnapshot']==old['sourceSnapshot']
for k,v in old['axes'].items():assert data['axes'][k][:len(v)]==v
for k in ['bindings','cells','evidence','dependencies','workflows','legacyCoverage','priorities']:assert data[k][:len(old[k])]==old[k]
p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
counts={'axes':{k:len(v) for k,v in data['axes'].items()},**{k:len(data[k]) for k in ['bindings','cells','dependencies','workflows','evidence']}}
with (OUT/'atlas-append-receipt.json').open('x') as f:json.dump({'ok':True,'createdAt':datetime.now(timezone.utc).isoformat(),'oldPrefixesAndScoresExact':True,'added':{'function':1,'implementation':5,'bindings':5,'cells':20,'dependencies':3,'workflows':1,'evidence':len(ids)},'counts':counts,'futureClosingEvidenceReferenced':False,'snapshotPreservation':'Original complete1350-entry map retained separately; current source hashes refresh after closing docs without modifying historical proofs.'},f,ensure_ascii=False,indent=2);f.write('\n')
print(json.dumps(counts))

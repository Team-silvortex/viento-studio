from pathlib import Path
from datetime import datetime, timezone
import json
OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[2]
p=ROOT/'docs/function-atlas.json';data=json.loads(p.read_text());old=json.loads((OUT/'atlas-baseline.json').read_text())
assert data['axes']==old['axes']
for key in ['bindings','cells','evidence','dependencies','workflows','legacyCoverage','priorities']:assert data[key]==old[key],key
result=json.loads((OUT/'results.json').read_text());assert result['ok']
feature='scene.translation_authoring3d'
data['axes']['function'].append({'id':feature,'label':'3D多对象原子整体移动','group':'场景与构建','entry':'独立多选／偏移→Rust一次计算校验→完整候选审阅→当前原文草稿→普通保存','boundary':['0.0.10之后未发布增量；十三固定模块／29声明能力，scene3d schema与后端、原四域、renderer保持。','1–128个现有不同UUID，共同XYZ偏移各轴±200000，全部最终position各轴±100000。','一份原model/CST合并位置数字词元，完整最终原文≤128KiB；任一失败无部分移动，目标与路径按sourceorder。','五字段来源、本域私有品牌、完整before/afterObjects与候选；复制／另外四域品牌不能转移审批。','独立UI选择不借preview选择；检索保持隐藏目标，zero或全部舍入无净变化不形成审批。','原文／表单／query／owner／关闭撤销approval；三digest与最后会话守护，完整内存write一次，Save继续基线冲突。','全应用、Rust、portable和真实Chrome分别记录，重叠测试不相加；真实Save与Conflict只在disposable workspace。','标准VM只证明实际copied模块，不取得Node/DOM/fetch/process；Chrome软件GPU与设备／安装交付分开。'],'next':'空间结构、模型素材、批次旋转缩放和统一历史仍分别设计；本域不构成层级、gizmo或跨文件提交。','platforms':['Linux实际HTTP/Chrome中英日390px与SwiftShader','desktop/mobile prepared标准VM纯入口与隔离端口'],'delivery':'working-tree'})
units=[('rust-core','原子共同偏移与保真位置数字补丁','Rust',['crates/viento-studio-core/src/scene3d_translation_patch.rs','crates/viento-studio-core/src/lib.rs']),('semantic-js','可选translation桥接与完整回执数字词元见证','JavaScript',['engine/studio-core.mjs']),('semantic-js','独立私有多对象提案与来源摘要准备','JavaScript',['engine/scene3d-translation.mjs','engine/index.mjs']),('ui','独立多选偏移表单与三语完整候选审批','JavaScript',['web/modules/app-scene3d-translation.js','web/scene3d-translation.css','web/i18n/en.js','web/i18n/ja.js']),('ui','第十三模块独立端口与共享最后草稿守护','JavaScript',['engine/studio-modules.mjs','web/modules/app-studio-system.js','web/modules/app-runtime.js'])]
start=max(int(v['id'][1:]) for v in data['axes']['implementation'])+1
paths=[];bound=[]
for n,(arch,label,lang,files) in enumerate(units,start):
 ident=f'i{n}';data['axes']['implementation'].append({'id':ident,'label':label,'kind':'product','language':[lang],'paths':files});paths+=files;bound.append((arch,ident))
paths+=['scripts/tests/'+n for n in ['studio-core-scene3d-translation.test.mjs','scene3d-translation.test.mjs','scene3d-translation-ui.test.mjs','scene3d-translation-source-host.test.mjs','scene3d-translation-system-ports.test.mjs','scene3d-translation-smoke.mjs']]
paths+=['docs/SCENE3D.md','engine/README.md','docs/STUDIO_MODULES.md']
paths+=['docs/test-results/scene3d-translation-authoring/'+n for n in ['baseline.json','source-freeze-confirmed.json','source-hashes-confirmed.json','source-phase-confirmation.json','core-results.json','quality-initial.json','host-quality-initial.json','web-validation.json','packaged-resources-confirmed.json','prepared-confirmation-confirmed.json','ui-lifecycle-fix.json','ui-late-checkbox-confirmed.json','ui-late-checkbox-after-fix.json','review.json','preservation-audit-before-cleanup.json','results.json','cleanup.json','application-timing.json','atlas-preservation-review.json']]
paths=list(dict.fromkeys(paths));ids=[];start=max(int(v['id'][1:]) for v in data['evidence'])+1
for n,path in enumerate(paths,start):
 if not path.endswith('/atlas-preservation-review.json'):assert(ROOT/path).is_file(),path
 ident=f'e{n}';kind='test' if path.startswith('scripts/tests/') else 'report' if path.startswith('docs/test-results/') else 'design' if path.endswith('.md') else 'source';data['evidence'].append({'id':ident,'kind':kind,'path':path,'note':'当前3D多对象整体移动的独立语义、完整来源审批、实际Save及copied/full/native证据；初败fixtures保持，旧时点与交付评分不改。'});ids.append(ident)
start=max(int(v['id'][1:]) for v in data['bindings'])+1
for n,(arch,ident) in enumerate(bound,start):
 data['bindings'].append({'id':f'b{n}','architecture':arch,'function':feature,'implementation':ident,'role':'Independent native atomic semantic, accessor-safe optional bridge, privately branded proposal, isolated UI or source host; explicit port and draft ownership, no renderer/backend/Save grant.','evidence':ids})
 for dim,score,reason in [('implementation',4,'所声明有界整体移动形成Rust→完整候选→草稿→普通保存闭环；层级、gizmo和统一历史仍待设计。'),('verification',3,'真实HTTP/Chrome、全应用、Rust、native/WASM、独立并发守护与prepared分证；非安装／设备／硬件GPU验收。'),('decoupling',3,'Rust持有原子语义，纯提案和五字段来源独立；UI/模块仅文档端口，共享宿主仍保留现有文本架构。'),('delivery',2,'0.0.10后未发布源码与准备副本，没有新commit/push/安装或平台交付。')]:data['cells'].append({'coordinates':[arch,feature,ident,dim],'value':score,'reason':reason})
for target in ['scene.primitives3d','authoring.document-edit','studio.system_modules']:data['dependencies'].append({'from':feature,'to':target,'relation':'requires','reason':'复用严格3D解析、普通作者文档来源与固定独立装配；不依赖原四表单、预览选择或执行后端。'})
data['workflows'].append({'id':'scene3d-translation-authoring','label':'多选现有方块→共同偏移原子检查→完整审阅→一次内存应用→普通保存／冲突','steps':['authoring.document-edit','studio.system_modules','scene.primitives3d',feature],'boundary':'独立selection与私有brand，Rust一次CST补丁；审批变化撤销，来源并发只有赢家write一次，磁盘仍普通Save。'})
counts={'axes':{k:len(v) for k,v in data['axes'].items()},**{k:len(data[k]) for k in ['bindings','cells','dependencies','workflows','evidence']}}
data['meta']['date']='2026-10-12';data['meta']['scope']='追加独立3D多对象整体移动；十三模块／29能力，原作者schema/渲染/后端保持；本轮各fresh证据分列，不提升安装设备交付。此前时点：'+data['meta']['scope']
p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
with(OUT/'atlas-preservation-review.json').open('x') as f:json.dump({'createdAt':datetime.now(timezone.utc).isoformat(),'ok':True,'oldPrefixesAndScoresExact':True,'added':{'function':1,'implementation':5,'bindings':5,'cells':20,'dependencies':3,'workflows':1,'evidence':len(ids)},'counts':counts},f,ensure_ascii=False,indent=2);f.write('\n')
print(json.dumps(counts))

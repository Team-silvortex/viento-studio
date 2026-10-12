from pathlib import Path
import json,hashlib
from datetime import datetime,timezone
OUT=Path(__file__).resolve().parent;ROOT=OUT.parents[2]
p=ROOT/'docs/function-atlas.json';j=json.loads(p.read_text());old=json.loads((OUT/'atlas-baseline.json').read_text())
for k in ['bindings','cells','evidence','dependencies','workflows']:assert j[k]==old[k],k
feature='scene.environment_authoring3d'
assert not any(f['id']==feature for f in j['axes']['function'])
j['axes']['function'].append({'id':feature,'label':'独立3D作者相机、方向光与背景编辑','group':'场景与构建','entry':'当前JSON原文→显式环境字段→完整候选审阅→原文草稿→普通保存','boundary':['0.0.10/base3a91e84之后未发布工作树；第十一固定模块、27项声明能力，旧readonly来源端口不扩权。','严格非空camera/light/background叶字段；原文及完整最终场景各验证一次，跨字段原子候选允许有效最终结果，不验证临时中间状态。','仅净变化数字/颜色值token可替换，固定净路径顺序；保留全部对象、所有键、未选字段、BOM/CRLF及词法。','环境、对象与变换提案各有私有冻结品牌；共享五字段来源守护与文档宿主审批，草稿改变使其他旧审批失效。','作者环境只读原文声明，预览临时orbit/zoom不填入表单；WebGL/World/build/其他创作入口缺失不关闭独立环境编辑。','三语表单显式勾选、完整候选审阅、取消与失主等待守护；Apply仅改草稿，普通Save处理磁盘持久化及外部冲突。','独立审核实证回执字段名交换错误；修后property key tokens不可替换，完整语义及净value token联合绑定。初始失败与修后记录均保存。','原生/WASM、完整应用、实际Chrome/SwiftShader和prepared标准VM各自验证，不作重复加总，未作新安装、Android设备或硬件GPU验收。'],'next':'模型资源、空间层级、材料和多对象编辑事务分别定义；此字段编辑不代表3D gizmo、场景运行或全局撤销实现。','platforms':['Linux实际HTTP/Chrome三语390px与软件GPU预览','共享Rust原生/WASM与桌面/移动prepared纯层；非安装或设备'],'delivery':'working-tree'})
products=[('i195','3D环境原子CST叶值补丁与完整候选校验',['Rust'],['crates/viento-studio-core/src/scene3d_environment_patch.rs','crates/viento-studio-core/src/lib.rs']),('i196','可选环境补丁桥与原文值库存及独立品牌',['JavaScript'],['engine/studio-core.mjs','engine/scene3d-environment.mjs','engine/scene3d-authoring.mjs','engine/index.mjs']),('i197','独立三语环境字段审阅和取消',['JavaScript','CSS'],['web/modules/app-scene3d-environment.js','web/scene3d-environment.css','web/i18n/en.js','web/i18n/ja.js']),('i198','文档来源会话守护与独立环境模块接线',['JavaScript'],['web/modules/app-runtime.js','web/modules/app-studio-system.js','engine/studio-modules.mjs'])]
for identity,label,languages,paths in products:j['axes']['implementation'].append({'id':identity,'label':label,'kind':'product','language':languages,'paths':paths})
paths=[]
for *_,files in products:
 for file in files:
  if file not in paths:paths.append(file)
paths+=['scripts/tests/'+f for f in ['studio-core-scene3d-environment.test.mjs','scene3d-environment.test.mjs','scene3d-environment-source-host.test.mjs','scene3d-environment-system-ports.test.mjs','scene3d-environment-ui.test.mjs','scene3d-environment-smoke.mjs']]
reports=['baseline.json','source-freeze.json','core-results.json','core-document-review.json','source-quality-initial.json','receipt-key-swap-initial.json','receipt-key-slot-final.json','packaged-resources.json','review.json','preservation-audit-before-cleanup.json','results.json','cleanup.json','application-timing.json','atlas-preservation-review.json']
paths+=['docs/test-results/scene3d-environment-authoring/'+f for f in reports]
paths+=['docs/SCENE3D.md','engine/README.md','docs/STUDIO_MODULES.md']
ids=[]
for number,file in enumerate(paths,1225):
 # Report existence and source bytes are checked by the final generator after proof and cleanup.
 identity=f'e{number}';ids.append(identity)
 kind='test' if file.startswith('scripts/tests/') else 'report' if file.startswith('docs/test-results/') else 'design' if file.endswith('.md') else 'source'
 j['evidence'].append({'id':identity,'kind':kind,'path':file,'note':'独立3D环境原子编辑、原文会话和品牌隔离的本轮源码/实际验证；保存初始发现与修后结果，旧专题保持各自时点，专项不与全量叠加。'})
for number,(architecture,implementation,role) in enumerate([('rust-core','i195','atomic complete environment patch'),('semantic-js','i196','private environment intent and bound raw value receipt'),('ui','i197','independent localized author environment review'),('ui','i198','document-owned guarded unsaved source apply'),('semantic-js','i198','optional authoring-only environment module')],328):
 j['bindings'].append({'id':f'b{number}','architecture':architecture,'function':feature,'implementation':implementation,'role':role,'evidence':ids})
 for dimension,value,reason in [('implementation',4,'本声明背景/相机/方向光形成审阅、草稿应用和普通Save闭环；模型资源/材料/层级另列。'),('verification',3,'实际原生/WASM、完整应用、会话等待守护、三语Chrome与prepared纯层分别绑定；新安装与设备未验。'),('decoupling',3 if implementation=='i198' and architecture=='ui' else 4,'Rust完整规则、JS品牌/回执、独立环境GUI和文档宿主分别拥有职责；正文生命周期仍集中但不共享兄弟控制器或渲染权限。'),('delivery',2,'0.0.10之后未发布工作树；prepared复制验证与发布/新安装分别处理。')]:j['cells'].append({'coordinates':[architecture,feature,implementation,dimension],'value':value,'reason':reason})
for target in ['scene.primitives3d','authoring.document-edit','studio.system_modules']:j['dependencies'].append({'from':feature,'to':target,'relation':'requires','reason':'只依赖严格3D原文与文档草稿/Save及系统装配；不依赖preview渲染、其他3D创作控制器、World或后端执行。'})
j['workflows'].append({'id':'scene3d-environment-source-authoring','label':'作者环境字段→完整最终候选→原文草稿→普通保存','steps':['authoring.document-edit','studio.system_modules','scene.primitives3d',feature],'boundary':'最终相机/光规则一次原子校验；只改获准值词元及当前内存草稿，临时预览视角不可充当作者参数，普通Save保持持久和冲突权威。'})
j['meta']['scope']='0.0.10/base3a91e84之后工作树新增独立3D环境编辑：86功能/198实现/331绑定/1324单元，11模块/27能力；旧85/194/326/1304所有评分、理由和历史前缀保持。本轮原子值补丁、独立brand、GUI/宿主来源/普通Save、实际浏览器和prepared证据分别绑定，无新发布、安装或设备验收。此前时点：'+j['meta']['scope']
p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
report={'createdAt':datetime.now(timezone.utc).isoformat(),'ok':True,'oldAxesBindingsCellsEvidenceDependenciesWorkflowsPrefixExact':True,'oldScoresAndReasonsExact':True,'added':{'function':1,'implementation':4,'bindings':5,'cells':20,'dependencies':3,'workflows':1,'evidence':len(ids)},'counts':{'axes':{k:len(v) for k,v in j['axes'].items()},**{k:len(j[k]) for k in ['bindings','cells','dependencies','workflows','evidence']}},'scope':'Append-only new environment feature, conservative unreleased delivery2/verification3. No old score or reason overwritten; actual fresh evidence separately linked.'}
(OUT/'atlas-preservation-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report['counts']))

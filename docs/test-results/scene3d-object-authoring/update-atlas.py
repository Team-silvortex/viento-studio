from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[3]
OUT=Path(__file__).resolve().parent
p=ROOT/'docs/function-atlas.json';a=json.loads(p.read_text())
f='scene.object_authoring3d'
if not any(x['id']==f for x in a['axes']['function']):
 a['axes']['function'].append({'id':f,'label':'独立 3D 对象新增、复制与移除','group':'场景与构建','entry':'已有 JSON 编辑会话→选择对象操作／新身份→完整候选审阅→原文草稿→普通保存','boundary':[
 '0.0.10/base3a91e84 之后未发布工作树；第十固定模块、26项声明能力，不扩充旧只读预览端口。',
 '严格 schema1 方块，1–128对象及128KiB UTF-8整份输入／候选预算；新身份拒绝冲突，删除最后对象拒绝。',
 '复制完整原CST对象，只替换新UUID与明确改变的名称词元；同值escaped名称、escaped键、数值词元及全部源对象保持。',
 '增删只改对象数组必要结构，保留其他对象身份、顺序与原声明，以及相机、光、顶层原文和BOM/CRLF。',
 '与变换提案各有私有冻结品牌；共享五字段来源检查及宿主应用守护，不共享控制器、审批或Save/World/渲染/执行权限。',
 '路径/token/当前raw/保存基线/当前SHA、文档与加载／草稿epoch每次等待后复核；并发赢家保留，迟到回执不覆盖。',
 '普通Save仍保护外部冲突；关闭预览/变换/World/build或缺失WebGL不关闭结构审阅；三语切换保留作者名称、新身份及审批。',
 '实际原生/WASM、浏览器、完整应用及prepared纯层证据分别记录，不代表新安装、Android设备或硬件GPU验收。'],
 'next':'空间层级、模型资源及多对象事务分别设计；不把结构表单当成3D gizmo、执行场景或128对象以上规模验收。','platforms':['Linux实际HTTP/Chrome与三语390px；软件GPU预览另记','共享Rust原生/WASM和桌面/移动prepared纯层；非设备验收'],'delivery':'working-tree'})
 a['axes']['implementation'] += [
 {'id':'i191','label':'3D对象数组CST结构补丁与完整候选验证','kind':'product','language':['Rust'],'paths':['crates/viento-studio-core/src/scene3d_objects_patch.rs','crates/viento-studio-core/src/lib.rs']},
 {'id':'i192','label':'可选对象补丁桥与独立冻结品牌及来源快照','kind':'product','language':['JavaScript'],'paths':['engine/studio-core.mjs','engine/scene3d-objects.mjs','engine/scene3d-authoring.mjs','engine/index.mjs']},
 {'id':'i193','label':'独立三语对象管理及数量／身份完整审阅','kind':'product','language':['JavaScript','CSS'],'paths':['web/modules/app-scene3d-objects.js','web/scene3d-objects.css','web/i18n/en.js','web/i18n/ja.js']},
 {'id':'i194','label':'共享文档来源守护与独立对象端口及能力注册','kind':'product','language':['JavaScript'],'paths':['web/modules/app-runtime.js','web/modules/app-studio-system.js','engine/studio-modules.mjs']},]
 for b,arch,impl,role in [('b323','rust-core','i191','strict structure patch'),('b324','semantic-js','i192','private object intent and complete receipt validation'),('b325','ui','i193','independent source review and cancellation'),('b326','ui','i194','document-owned guarded in-memory apply'),('b327','semantic-js','i194','optional authoring-only module registration')]:
  a['bindings'].append({'id':b,'architecture':arch,'function':f,'implementation':impl,'role':role,'evidence':[]})
  scores={'implementation':(4,'所声明方块增/复制/删形成完整候选、草稿应用和普通Save闭环；层级/资源/跨对象事务另列。'),'verification':(3,'真实原生/WASM、共享guard并发、三语HTTP浏览器和prepared纯层验证分别绑定；新安装与设备未验。'),'decoupling':(3 if b=='b326' else 4,'Rust语义、可移植独立品牌、对象GUI和文档宿主权限分层；宿主正文生命周期仍集中，旧readonly不扩权。'),'delivery':(2,'0.0.10之后未发布工作树增量；准备副本可移植验证与源码发布、安装分开。')}
  for k,(v,reason)in scores.items():a['cells'].append({'coordinates':[arch,f,impl,k],'value':v,'reason':reason})
 for target in ['scene.primitives3d','authoring.document-edit','studio.system_modules']:
  a['dependencies'].append({'from':f,'to':target,'relation':'requires','reason':'依赖严格3D原文、普通文档草稿／Save及独立系统装配；不要求变换、渲染、World或执行后端。'})
 a['workflows'].append({'id':'scene3d-object-source-authoring','label':'3D对象新增/复制/移除→完整原文→草稿→普通保存','steps':['authoring.document-edit','studio.system_modules','scene.primitives3d',f],'boundary':'结构审阅没有写入权限，Apply只改当前内存草稿；新旧两种创作入口独立审批，普通Save保留原外部冲突守护。'})
 a['meta']['scope']='0.0.10/base3a91e84之后工作树新增独立3D对象管理：85功能/194实现/326绑定/1304单元，10模块/26能力。此前84/190/321/1284全部坐标、评分、理由及旧证据前缀保持。当前验证与prepared复制独立记录，无发布或新安装/设备验收。此前时点：'+a['meta']['scope']
source=['crates/viento-studio-core/src/scene3d_objects_patch.rs','engine/scene3d-objects.mjs','engine/scene3d-authoring.mjs','web/modules/app-scene3d-objects.js','web/scene3d-objects.css','engine/studio-core.mjs','engine/studio-modules.mjs','web/modules/app-runtime.js','web/modules/app-studio-system.js']
tests=['scripts/tests/studio-core-scene3d-objects.test.mjs','scripts/tests/scene3d-objects.test.mjs','scripts/tests/scene3d-objects-source-host.test.mjs','scripts/tests/scene3d-objects-system-ports.test.mjs','scripts/tests/scene3d-objects-ui.test.mjs','scripts/tests/scene3d-objects-smoke.mjs']
design=['docs/SCENE3D.md','docs/ARCHITECTURE.md','docs/STATUS.md','docs/STUDIO_MODULES.md','engine/README.md']
reports=['core-results.json','core-native-test.log','core-clippy.log','core-fmt-check.log','core-bridge-tests.log','core-regression-final.log','web-validation.json','ui-tests-layout-final.log','application-timing.json','portable-host-initial.log','source-boundary-initial.json','ui-boundary-final.json','host-boundary-initial.json','app-check.log','packaged-resources.json','review.json','preservation-audit-before-cleanup.json','results.json','cleanup.json','atlas-preservation-review.json']
paths=[*(('source',x) for x in source),*(('test',x) for x in tests),*(('design',x) for x in design)]
# Add only completed reports; application completion is checked by root before
# running this script. Source signatures are refreshed by the standard generator.
paths += [('report',str((OUT/x).relative_to(ROOT))) for x in reports if (OUT/x).is_file()]
paths += [('report',str(x.relative_to(ROOT))) for x in sorted(OUT.glob('browser*/browser.json')) if json.loads(x.read_text()).get('ok') is True]
new=[];existing={(x['kind'],x['path']):x['id'] for x in a['evidence']}
next_id=max(int(x['id'][1:]) for x in a['evidence'])+1
for kind,path in paths:
 if not (ROOT/path).is_file():continue
 key=(kind,path)
 if key not in existing:
  ident=f'e{next_id}';next_id+=1;existing[key]=ident
  a['evidence'].append({'id':ident,'kind':kind,'path':path,'note':'独立3D对象增删/复制、品牌与来源/并发守护的当前源码或实际验证；旧报告保持其原时点，专项不与全量相加。'})
 new.append(existing[key])
for b in a['bindings']:
 if b['function']==f:b['evidence']=new
p.write_text(json.dumps(a,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'axes':{k:len(v) for k,v in a['axes'].items()},'bindings':len(a['bindings']),'cells':len(a['cells']),'evidence':len(a['evidence']),'dependencies':len(a['dependencies']),'workflows':len(a['workflows'])}))

from pathlib import Path
from datetime import datetime,timezone
import json
O=Path(__file__).resolve().parent;R=O.parents[2];p=R/'docs/function-atlas.json'
j=json.loads(p.read_text());old=json.loads((O/'atlas-baseline.json').read_text())
assert j['axes']==old['axes']
for k in ['bindings','cells','evidence','dependencies','workflows']:assert j[k]==old[k],k
feature='scene.navigation3d'
j['axes']['function'].append({'id':feature,'label':'3D对象检索、临时聚焦与原文定位','group':'场景与构建','entry':'当前JSON原文→Rust有效模型→独立文字检索／临时聚焦→稳定UUID重解析→返回原文声明','boundary':['0.0.10/base3a91e84之后未发布增量，仍十二固定模块／28项能力，没有作者格式或执行协议升级。','索引只投影已通过Rust校验的对象名称、UUID与来源，字面大小写查询只影响显示，不重新解析作者语义。','筛选隐藏选择时保留UUID和声明并提示；有效刷新重排保留身份，无效原文保留最近有效画面。','按实际GPU画布视场角和包围球聚焦完整方块，临时裁剪及浮动原点属于渲染；重置和刷新恢复作者相机。','只读来源仍为sourcePath/token/content三字段，可选locateSource只拥有selection/scroll/once-focus；不取得草稿应用、Save、World或后端。','宿主重新native parse定位UUID，完整内容/文档/会话/基线/版本和调用方审批在等待后保持，拒绝旧范围和晚到焦点。','BOM/CRLF/CR/nonBMP的native原文UTF16范围仅映射到完整匹配的textarea LF显示，raw作者字节与Save基线保持。','实际Chrome/软件WebGL、完整应用和桌面/移动纯准备副本分别记录，不声称新安装/Android/硬件GPU验收。'],'next':'空间层级、模型素材、行为与多对象创作分别实现；当前检索列表不形成3D树、碰撞或gizmo。','platforms':['Linux实际HTTP/Chrome中英日390px与SwiftShader','共享Rust有效来源与桌面/移动prepared纯模块'],'delivery':'working-tree'})
units=[('i203','只读显示索引与私有原文定位回执',['JavaScript'],['engine/scene3d-navigation.mjs','engine/index.mjs']),('i204','完整方块临时镜头与浮动原点渲染',['JavaScript'],['web/modules/scene3d-math.js','web/modules/scene3d-renderer.js']),('i205','独立3D检索选择与聚焦／返回原文界面',['JavaScript','CSS'],['web/modules/app-scene3d-preview.js','web/scene3d.css','web/i18n/en.js','web/i18n/ja.js']),('i206','当前原文选择与一次性焦点宿主守护',['JavaScript'],['web/modules/app-runtime.js'])]
paths=[]
for ident,label,lang,files in units:
 j['axes']['implementation'].append({'id':ident,'label':label,'kind':'product','language':lang,'paths':files})
 for f in files:
  if f not in paths:paths.append(f)
paths+=['scripts/tests/'+f for f in ['scene3d-navigation.test.mjs','scene3d-navigation-source-host.test.mjs','scene3d-system-ports.test.mjs','scene3d-math-navigation.test.mjs','scene3d-renderer.test.mjs','scene3d-preview-ui.test.mjs','scene3d-navigation-smoke.mjs']]
paths+=['docs/test-results/scene3d-navigation/'+f for f in ['baseline.json','source-freeze-verified.json','renderer-results.json','renderer-document-review-confirmed.json','quality-confirmed.json','web-validation.json','packaged-resources-verified.json','review.json','preservation-audit-before-cleanup.json','results.json','cleanup.json','application-timing.json','atlas-preservation-review.json']]
paths+=['docs/SCENE3D.md','engine/README.md','docs/STUDIO_MODULES.md']
ids=[];start=max(int(x['id'][1:])for x in j['evidence'])+1
for n,f in enumerate(paths,start):
 ident=f'e{n}';ids.append(ident);kind='test'if f.startswith('scripts/tests/')else'report'if f.startswith('docs/test-results/')else'design'if f.endswith('.md')else'source'
 j['evidence'].append({'id':ident,'kind':kind,'path':f,'note':'当前独立只读3D浏览导航源码和实际验收；历史报告不重写，软件GPU与prepared不替代设备或发布。'})
start=max(int(x['id'][1:])for x in j['bindings'])+1
for n,(architecture,implementation,role)in enumerate([('semantic-js','i203','validated-model display index and native exact-location private receipt'),('ui','i204','temporary whole-box framing and view-local float32 origin'),('ui','i205','localized readonly stable selection and independent view navigation'),('ui','i206','document-owned selection and guarded once-only focus')],start):
 j['bindings'].append({'id':f'b{n}','architecture':architecture,'function':feature,'implementation':implementation,'role':role,'evidence':ids})
 for dimension,value,reason in [('implementation',4,'有效模型检索、临时完整聚焦及原文选择闭环实现；空间树/模型/行为不在本切片。'),('verification',3,'完整应用与原生核心、实际Chrome三语、软件WebGL和prepared分别验证；新安装/Android/硬件GPU未验。'),('decoupling',3 if implementation=='i206' else 4,'作者语义仍在Rust；显示索引、视角、独立GUI与来源selection职责分开，正文生命周期仍集中。'),('delivery',2,'0.0.10之后未发布工作树；准备副本证明复制及纯层可移植性，不等于新版分发或安装。')]:
  j['cells'].append({'coordinates':[architecture,feature,implementation,dimension],'value':value,'reason':reason})
for target in ['scene.primitives3d','authoring.document-edit','studio.system_modules']:
 j['dependencies'].append({'from':feature,'to':target,'relation':'requires','reason':'需要有效3D来源、当前普通编辑器和既有只读模块；不要求任一作者编辑表单或执行后端。'})
j['workflows'].append({'id':'scene3d-readonly-object-navigation','label':'3D检索／临时聚焦→稳定UUID→当前原文选择','steps':['authoring.document-edit','studio.system_modules','scene.primitives3d',feature],'boundary':'检索和临时相机不编辑作者数据；完整当前来源重解析后仅selection/scroll/一次focus，旧raw范围不用于新草稿。'})
counts={'axes':{k:len(v)for k,v in j['axes'].items()},**{k:len(j[k])for k in ['bindings','cells','dependencies','workflows','evidence']}}
j['meta']['scope']='0.0.10/base3a91e84之后追加只读3D浏览导航；88功能/206实现/340绑定/1360单元，仍12模块/28能力，旧全部轴/关系/评分/理由和历史前缀保持。检索/临时视角/源selection分开；软件GPU及prepared不提升未验证设备和发布范围。此前时点：'+j['meta']['scope']
p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
(O/'atlas-preservation-review.json').write_text(json.dumps({'createdAt':datetime.now(timezone.utc).isoformat(),'ok':True,'oldPrefixesAndScoresExact':True,'added':{'function':1,'implementation':4,'bindings':4,'cells':16,'dependencies':3,'workflows':1,'evidence':len(ids)},'counts':counts},ensure_ascii=False,indent=2)+'\n')
print(json.dumps(counts))

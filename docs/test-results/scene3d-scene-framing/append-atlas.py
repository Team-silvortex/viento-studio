from pathlib import Path
import json,datetime
S=Path('/tmp/viento-scene3d-framing-xmbbbvr9/project');O=S/'docs/test-results/scene3d-scene-framing';p=S/'docs/function-atlas.json';d=json.loads(p.read_text());old=json.loads((O/'atlas-before.json').read_text());assert d==old
feature='scene.framing3d'
d['axes']['function'].append({'id':feature,'label':'3D全场景临时取景','group':'场景与构建','entry':'当前有效预览模型→全部旋转角点包围→实际画布比例临时相机→三语取景／重置','boundary':['完整当前有效预览的1–128个方块参与，不受搜索、隐藏选择或当前所选对象影响。','纯数学保守包围、GPU适配和可选界面方法分开；17模块／33能力，无新作者ABI、宿主端口或引擎协议。','取景保持当前观看方向与FOV，临时裁剪及缩放范围独立；重置与成功刷新恢复作者相机。','无效草稿继续查看旧有效模型且保留诊断；取景不会授权原文定位、草稿应用或普通保存。','实际绘图失败清除命中资格并报告绘制中断，校验拒绝不修改相机；细小远物体不承诺像素可辨识。','只验证源码、复制资源与软件WebGL，不提升安装、设备或硬件GPU验收。'],'next':'标准方向需要独立相机上方向及极点导航约定；模型素材、空间层级另行接入。','platforms':['本机浏览器和桌面源码；实际Chrome显式ANGLE/SwiftShader，默认headless合成异常单独保留','桌面与移动准备副本的纯模块；设备未验收'],'delivery':'working-tree'})
nextid=lambda rows,prefix:max(int(x['id'][len(prefix):]) for x in rows)+1
evidencePaths=['web/modules/scene3d-math.js','web/modules/scene3d-renderer.js','web/modules/app-scene3d-preview.js','web/i18n/en.js','web/i18n/ja.js','scripts/tests/scene3d-scene-framing-math.test.mjs','scripts/tests/scene3d-scene-framing-renderer.test.mjs','scripts/tests/scene3d-preview-ui.test.mjs','scripts/tests/scene3d-framing-smoke.mjs','docs/SCENE3D.md']+[str(O.relative_to(S)/n) for n in ['regression.json','browser-verified/browser.json','legacy-browser/browser.json','prepared.json','independent-review.json']]
ids=[]
for rel in evidencePaths:
 assert (S/rel).is_file(),rel
 n='e'+str(nextid(d['evidence'],'e'));d['evidence'].append({'id':n,'kind':'report' if '/test-results/' in rel else 'test' if '/tests/' in rel else 'design' if rel.endswith('.md') else 'source','path':rel,'note':'全场景取景的当前源码／针对性回归／实际浏览器或准备副本证据；范围分开，不复用上轮完整3811或Rust307计数。'});ids.append(n)
implementations=[('旋转方块全景包围与临时相机纯数学',['web/modules/scene3d-math.js']),('全景GPU取景、手势清理与绘制失败反馈',['web/modules/scene3d-renderer.js']),('现有只读预览的可选全景入口与三语状态',['web/modules/app-scene3d-preview.js','web/i18n/en.js','web/i18n/ja.js'])]
for label,paths in implementations:
 impl='i'+str(nextid(d['axes']['implementation'],'i'));d['axes']['implementation'].append({'id':impl,'label':label,'kind':'product','language':['JavaScript'],'paths':paths});b='b'+str(nextid(d['bindings'],'b'));d['bindings'].append({'id':b,'architecture':'ui','function':feature,'implementation':impl,'role':'View-only full loaded scene framing; no author state, source-write port or backend authority.','evidence':ids[:]})
 for maturity,score,reason in [('implementation',4,'完整有效场景取景已接入现有预览，保留作者内容和稳定选择。'),('verification',3,'针对性回归、独立数值检查与实际Chrome流程和资源副本分证；本轮未重复全应用或原生核心检查。'),('decoupling',3,'纯数学、只读GPU适配与可选界面方法分离，不扩大作者或宿主权限。'),('delivery',2,'0.0.10之后工作树增量，未发布新版本或安装验收。')]:
  assert maturity in [x['id'] for x in d['axes']['maturity']]
  d['cells'].append({'coordinates':['ui',feature,impl,maturity],'value':score,'reason':reason})
for dep in ['scene.primitives3d','scene.navigation3d']:d['dependencies'].append({'from':feature,'to':dep,'relation':'requires','reason':'消费原有有效模型与只读预览，不依赖各作者编辑表单。'})
d['workflows'].append({'id':'scene3d-scene-framing','label':'有效预览→全场景取景→筛选与单对象浏览→重置作者相机','steps':['authoring.document-edit','scene.primitives3d','scene.navigation3d',feature],'boundary':'始终只操作临时视角，保留正文、选择和保存基线；无效草稿继续查看最近有效模型。'})
d['meta']['date']='2026-10-12';d['meta']['scope']='追加只读3D全场景取景；96功能/239实现/373绑定/1492单元，仍17模块/33能力。针对性测试和软件GPU／准备副本分证。此前时点：'+d['meta']['scope']
for k,v in old['axes'].items():assert d['axes'][k][:len(v)]==v
for k in ['bindings','cells','evidence','dependencies','workflows','legacyCoverage','priorities']:assert d[k][:len(old[k])]==old[k]
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'ok':True,'functions':len(d['axes']['function']),'implementations':len(d['axes']['implementation']),'bindings':len(d['bindings']),'cells':len(d['cells']),'dependencies':len(d['dependencies']),'workflows':len(d['workflows']),'evidence':len(d['evidence'])}))

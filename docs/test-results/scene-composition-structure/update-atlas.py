from pathlib import Path
import json
r=Path.cwd();o=r/'docs/test-results/scene-composition-structure';p=r/'docs/function-atlas.json';x=json.loads(p.read_text());f='scene.composition_structure_editor'
assert not any(a['id']==f for a in x['axes']['function'])
x['axes']['function'].append({'id':f,'label':'共享片段演员增删、全放置身份与原文创作','group':'场景与构建','entry':'源码配方预览→编辑片段结构→新增/移除成员→全放置身份和覆盖影响→完整检查→原文草稿→普通保存',
 'boundary':['0.0.9发布后未发布工作树；已有recipe v1生成普通Scene2D v3，不升级作者/World/执行格式。',
 '一个操作原子新增完整演员声明与全部相关放置显式instance UUID，或移除模板演员/所有actorIds成员/该键覆盖条目；组和其他身份/字段/原文保持。',
 '新ID拒已有实例/组/placement和配方身份碰撞，不从局部key/数组索引派生；每放置ID在一次待审操作和重检间保持，Rust/helper不分配ID。',
 '全部相关placement必须按作者顺序完整映射；未放置fragment可空targets/instances，所有fragment至少一演员、声明与展开128/source128KiB/最终坐标各自准入。',
 '未放置片段检查声明及登记依赖，没有有效实例渲染；未声明投影默认资源的实际字节/effective值在将来放置时另外检查，不声明此处已验。',
 'Rust独立可选structure cap/dispatcher保真splice；旧expand/fragment/set/reset/positions/placement操作与探针保持，缺cap仅关新入口，无JS规则回退。',
 '纯helper在首次await前分离source/model；冻结public片段目录，私有snapshot生成exact edit/targets/afterContent/changedPaths；prepare重算来源hash/base/影响/精确回执。',
 'GUI toolbar不依赖选中演员，允许unused；注册定义/兼容游戏投影/已登记图片/组织组选项，中英日及390px；原始输入/owner/完整候选审批绑定。',
 '父控制器完整preview+真实依赖，并从Rust展开核对全演员/组身份和来源；允许selected opener删除。主编辑器最后核owner/token仅内存应用，ordinarySave保存/外部冲突。',
 '真实Chrome新增/移除/取消/保存重开/图片拒绝/外部冲突与旧single/batch回归另证；prepared桌面及标准VM移动pure+WASM不代表新版安装或Android编辑/设备。',
 '片段/组/placement增删、跨文件/嵌套、空间transform、统一历史、可执行recipe和运行引擎扩展不在此切片。'],
 'next':'逐步增加片段/放置/组织组结构创作与场景文本组织，空间层次和跨视图历史分别定义作者合同。',
 'platforms':['Linux本机编辑服务和Chrome三语配方结构表单；Rust原生/WASM','prepared桌面/移动纯helper一致性；无Android编辑宿主或设备验收'],'delivery':'working-tree'})
impl=[{'id':'i162','label':'scene_composition_structure_patch.rs：原子模板演员和全放置身份增删','kind':'product','language':['Rust','JavaScript'],'paths':['crates/viento-studio-core/src/scene_composition_structure_patch.rs','crates/viento-studio-core/src/lib.rs','engine/studio-core.mjs']},
 {'id':'i163','label':'scene-composition-structure.mjs：冻结原文目录与exact结构提案','kind':'product','language':['JavaScript'],'paths':['engine/scene-composition-structure.mjs']},
 {'id':'i164','label':'app-scene-composition-structure.js：成员创作与全放置审阅','kind':'product','language':['JavaScript','CSS'],'paths':['web/modules/app-scene-composition-structure.js','web/modules/app-scene-preview.js','web/project-build.css','web/i18n/en.js','web/i18n/ja.js']}]
x['axes']['implementation'].extend(impl)
files=[('source','crates/viento-studio-core/src/scene_composition_structure_patch.rs'),('source','engine/scene-composition-structure.mjs'),('source','web/modules/app-scene-composition-structure.js'),('source','web/modules/app-project-build.js'),('source','web/modules/app-runtime.js'),
 ('test','scripts/tests/studio-core-composition-structure-patch.test.mjs'),('test','scripts/tests/scene-composition-structure.test.mjs'),('test','scripts/tests/scene-composition-structure-bridge.test.mjs'),('test','scripts/tests/scene-composition-structure-host.test.mjs'),('test','scripts/tests/scene-composition-structure-ui.test.mjs'),('test','scripts/tests/scene-composition-structure-preview-ui.test.mjs'),('test','scripts/tests/scene-composition-structure-smoke.mjs'),
 ('design','docs/SCENE_COMPOSITION.md'),('report','docs/test-results/scene-composition-structure/results.json'),('report','docs/test-results/scene-composition-structure/core-native-test.log'),('report','docs/test-results/scene-composition-structure/app-check.log'),('report','docs/test-results/scene-composition-structure/focused-tests.log'),('report','docs/test-results/scene-composition-structure/browser-confirmed/browser.json'),('report','docs/test-results/scene-composition-structure/single-regression/browser.json'),('report','docs/test-results/scene-composition-structure/batch-regression/browser.json'),('report','docs/test-results/scene-composition-structure/packaged-resources.json'),('report','docs/test-results/scene-composition-structure/boundary-review.json'),('report','docs/test-results/scene-composition-structure/host-review.json'),('report','docs/test-results/scene-composition-structure/cleanup.json'),('report','docs/test-results/scene-composition-structure/final-audit.json')]
eids=[]
for index,(kind,path) in enumerate(files,842):
 assert (r/path).is_file(),path
 eid=f'e{index}';eids.append(eid);x['evidence'].append({'id':eid,'kind':kind,'path':path,'note':'当前未发布共享演员结构切片；原生/真实浏览器/准备副本/源码与失败初轮分别记录，不提升旧平台评分。'})
for index,(architecture,implementation,role) in enumerate([('rust-core','i162','独立structure能力与原子保真全映射增删'),('semantic-js','i163','未放置片段原文目录、影响身份与精确回执'),('ui','i164','显式成员创作、稳定UUID、全影响与原文审阅'),('ui','i102','复用父完整候选和主编辑器来源守护/普通保存')],285):
 x['bindings'].append({'id':f'b{index}','architecture':architecture,'function':f,'implementation':implementation,'role':role,'evidence':eids})
 for maturity,value,reason in [('implementation',3,'首个受限演员结构创作接入当前源码；片段/组/放置结构和跨视图事务仍分开开发，未重标其他作者能力。'),('verification',3,'共享Rust/native-WASM、完整应用、当前Linux浏览器真实往返与旧画布回归；无其他作者宿主/安装/设备验收。'),('decoupling',4,'Rust字节规则与纯source proposal、GUI、预览和普通保存宿主分开；actual prepared桌面/标准VM移动复用同一pure/WASM。'),('delivery',2,'未发布工作树和准备副本，尚未提交发布版本或验收安装窗口/设备。')]:
  x['cells'].append({'coordinates':[architecture,f,implementation,maturity],'value':value,'reason':reason})
for dep in ['scene.composition','scene.source_model','scene.composition_inheritance','scene.text_draft_preview']:
 x['dependencies'].append({'from':f,'to':dep,'relation':'requires','reason':'结构创作复用recipe展开、稳定来源模型、投影语义与完整源码预览/普通保存，后端实现独立。'})
x['workflows'].append({'id':'scene-composition-member-authoring','label':'配方源码→共享演员增删→全放置身份及覆盖→候选预览→内存应用→普通保存重开','steps':['scene.composition','scene.composition_structure_editor','scene.text_draft_preview','scene.source_model'],'boundary':'单文件/一次一操作/显式全部放置UUID；unused仅声明和登记依赖，不提供运行/跨文事务或新版安装验收。'})
x['meta']['scope']='0.0.9发布后base9065667新增共享演员结构创作scene.composition_structure_editor，新i162–164/b285–288/16cells 3/3/4/2，复用i102宿主。当前源码Rust/native-WASM/Chrome/准备副本独立证据；2695旧历史、原atlas前缀、作者/工具/旧场景/冻结后端保持。原core仅注册独立结构域及新Rust文件；无版本/commit/push/安装或设备交付。'
p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'newFunction':f,'newImplementations':3,'newBindings':4,'newCells':16,'newEvidence':len(files),'functions':len(x['axes']['function'])}))

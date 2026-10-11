from pathlib import Path
import json
r=Path.cwd();o=r/'docs/test-results/studio-system-modules';p=r/'docs/function-atlas.json';x=json.loads(p.read_text());f='studio.system_modules'
assert not any(item['id']==f for item in x['axes']['function'])
x['axes']['function'].append({'id':f,'label':'Studio 系统装配与工程增量能力需求','group':'工程与工作台','entry':'工程模板／清单需求→固定模块规划→各区显式接口→宿主服务准入→原文普通保存',
 'boundary':['0.0.9发布后未发布工作树，系统基础边界而非全部功能内部拆分。','7固定模块22能力按依赖注册；重复提供者／缺依赖／循环／版本错误闭合拒绝，没有动态代码路径。','工程studioProfile是增量required／optional数据；缺3D／Rust作者执行／未来API不关闭普通正文模块，静态active不授予写或运行权限。','新增配置严格校验并在await前分离，已有未来／无效声明原样读取和备份迁移，仅产生局部诊断。','GUI只在启动时装配六区，各区拿自己的端口，media可选拿导出函数；私有controller和作者内容不外泄，只读snapshot供后续诊断面板。','正文宿主保留source／草稿／普通Save权威，语言先初始化；实际capability检测与工程加载接入compositionroot。','原生模板可选复制studioProfile，有字段纳入provenance；无字段旧包序列化和digest不变，戏剧scene依旧prose。','World与构建区内部仍聚合，当前预览仍受构建区可用性约束；无热卸载、插件执行、3D实现或权限沙箱。','全量Node、51新专项、53原生PASS与1旧full-size忽略、7实际Chrome流程和prepared标准VM分别保留；无安装／Android设备验收。'],
 'next':'沿接口拆正文生命周期、World命令与场景预览／执行贡献；3D先独立作者表示和计划，再接模板需求、视图和后端。','platforms':['Linux实际HTTP／Chrome','原生模板归档与prepared桌面／移动纯层；非安装／设备'],'delivery':'working-tree'})
x['axes']['implementation'].extend([
 {'id':'i168','label':'studio-modules.mjs：系统注册与增量需求规划','kind':'product','language':['JavaScript'],'paths':['engine/studio-modules.mjs','engine/index.mjs']},
 {'id':'i169','label':'app-studio-system.js：六区装配与宿主诊断','kind':'product','language':['JavaScript'],'paths':['web/modules/app-studio-system.js','web/modules/app-runtime.js']},
 {'id':'i170','label':'studioProfile：工程定义、原生模板与迁移声明','kind':'product','language':['JavaScript','Rust','JSON'],'paths':['engine/project.mjs','scripts/lib/project-definition.mjs','src-tauri/src/project_templates.rs','src-tauri/src/workspace.rs','schemas/studio-profile-v1.schema.json','schemas/workspace-v2.schema.json','schemas/workspace-v3.schema.json']}])
files=[('source','engine/studio-modules.mjs'),('source','web/modules/app-studio-system.js'),('source','web/modules/app-runtime.js'),('source','engine/project.mjs'),('source','scripts/lib/project-definition.mjs'),('source','src-tauri/src/project_templates.rs'),('source','src-tauri/src/workspace.rs'),('source','schemas/studio-profile-v1.schema.json'),('test','scripts/tests/studio-modules.test.mjs'),('test','scripts/tests/studio-system-ui.test.mjs'),('test','scripts/tests/studio-profile-project.test.mjs'),('test','scripts/tests/studio-system-smoke.mjs'),('design','docs/STUDIO_MODULES.md')]
files += [('report',f'docs/test-results/studio-system-modules/{name}') for name in ['results.json','app-check.log','new-tests.log','native-unit-tests.log','native-provenance-regression.log','native-provenance-review.json','core-boundary-review.json','final-boundary-review.json','native-test-review.json','profile-snapshot-initial.json','browser-system/browser.json','packaged-resources.json','source-delta.json','cleanup.json','final-audit.json']]
files += [('report',f'docs/test-results/studio-system-modules/{name}') for name in ['final-doc-review.json','native-helpers.json','native-target-relocation.json','native-tools-build-final.log']]
ids=[];start=max(int(item['id'][1:]) for item in x['evidence'])+1
for index,(kind,name) in enumerate(files,start):
 assert (r/name).is_file(),name
 eid=f'e{index}';ids.append(eid);x['evidence'].append({'id':eid,'kind':kind,'path':name,'note':'全系统装配／声明切片；专项、初次fixture失败、原生忽略、实际浏览器与prepared单独记录，不提升安装／设备成熟度。'})
start=max(int(item['id'][1:]) for item in x['bindings'])+1
for index,(architecture,implementation,role,decoupling) in enumerate([('semantic-js','i168','固定注册、依赖和局部需求诊断',4),('ui','i169','启动装配与各区窄接口',3),('definition','i170','工程声明与新增配置快照',3),('desktop-host','i170','原生模板复制、旧摘要和迁移保留',3)],start):
 x['bindings'].append({'id':f'b{index}','architecture':architecture,'function':f,'implementation':implementation,'role':role,'evidence':ids})
 for maturity,value,reason in [('implementation',3,'真实宿主接入系统入口与模板声明；内部聚合继续拆分。'),('verification',3,'固定Node全量／新专项、原生模板迁移、真实Chrome和prepared标准VM；原生旧full-size测试1ignored，无新设备验收。'),('decoupling',decoupling,'纯规划无宿主依赖；GUI显式装配和原生声明边界已接，旧正文／World／构建区内部仍聚合。'),('delivery',2,'未发布工作树与准备副本，HEAD／版本未改，没有新安装包。')]:
  x['cells'].append({'coordinates':[architecture,f,implementation,maturity],'value':value,'reason':reason})
for target in ['project.starter-packs','project.type-templates','authoring.document-edit','media.embed-play','export.jobs-delivery','scene.authoring_workflow','backend.project_catalog']:
 assert any(item['id']==target for item in x['axes']['function'])
 x['dependencies'].append({'from':f,'to':target,'relation':'requires','reason':'系统装配保留现有领域契约、正文保存与宿主准入，能力需求不替代各区验证。'})
x['workflows'].append({'id':'studio-module-profile-boundary','label':'工程声明→模块规划→宿主装配→独立领域接口','steps':['project.starter-packs',f,'authoring.document-edit','media.embed-play','scene.authoring_workflow'],'boundary':'需求为增量数据；当前2D／执行聚合界面另保留，缺未来能力不封闭普通文字，非热插件或3D交付。'})
x['meta']['scope']='0.0.9发布后base9065667新增studio.system_modules/i168–170及4bindings/16cells；7module/22声明能力，工程／模板／GUI装配／宿主权限分开，现有聚合债务明确。旧图谱前缀／评分、2910历史文件及作者／共享核心WASM／后端协议保持。全量、51新增、原生53PASS+1ignored、7实际Chrome、prepared分别记录；无版本／发布／安装／设备交付。'
p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:len(x[k]) for k in ['bindings','cells','evidence','dependencies','workflows']}))

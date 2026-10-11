"""Append fragment rename evidence without changing any previous atlas score."""
from pathlib import Path
import json
root=Path.cwd(); out=root/'docs/test-results/scene-composition-fragment-rename'; path=root/'docs/function-atlas.json'
atlas=json.loads(path.read_text()); baseline=json.loads((out/'atlas-baseline.json').read_text())
feature='scene.composition_definition_rename'
assert not any(v['id']==feature for v in atlas['axes']['function'])
for axis,values in baseline['axes'].items(): assert atlas['axes'][axis]==values
for key in ['bindings','cells','evidence','dependencies','workflows','legacyCoverage','priorities']: assert atlas[key]==baseline[key]
results=json.loads((out/'results.json').read_text()); verify=results['verification']
app=verify['application']['tests']; rust=verify['sharedCore']['total']; prepared=verify['prepared']['totalCases']; browser=verify['browser']['stepsPassed']
atlas['axes']['function'].append({'id':feature,'label':'共享片段重命名与全部放置引用同步','group':'场景与构建','entry':'原文配方预览→管理片段定义→重命名→完整来源候选审阅→草稿应用→普通保存','boundary':[
'0.0.9未发布工作树；recipe/Scene2D/World/元数据/构建及后端协议不变，九创作域与7系统模块/22声明能力不增加。',
'独立可选definition_rename_version=1；Rust原子修改定义及所有匹配放置fragmentId值；旧definitions三动作和只读locator保持。',
'区分大小写的原有64字符本地标识，重名冲突拒绝；同decoded标识原生严格byte-noop，纯提案拒绝unchanged。',
'前后完整展开及128KiB预算；保留UUID/局部键/顺序/坐标/覆盖/偏移/BOM/CRLF/数值拼写等无关字节，没有隐式生成实例或重排。',
'既有八字段提案/空targets和definitions工作流；source-ordered路径与完整actor/group贡献及UTF-16定位重新校验，旧片段标识不能伪装新来源。',
'JS桥完整意图语义和原始字符串token清单复核，Rust保持修改权威，无Node/DOM/文件IO或新JSON/YAML解析器。',
'能力缺失或不支持仅禁用重命名；新增/复制/未引用删除仍可审阅应用，普通Save承担持久化与冲突。',
f'{app}完整应用、{rust}Rust、{browser}实际Chrome流程及{prepared}prepared标准VM案例分别记录；专项与全量重叠，不代表安装或Android设备。',
'作者/历史日志/外部工具保持，当前文档与新增证据单独绑定，初次准备与浏览器失败保留。'],
'next':'独立定义片段重排、空间层次、跨文件复用及跨视图历史契约。','platforms':['Linux实际HTTP/Chrome中英日390px','Rust原生/WASM与桌面/移动实际准备副本；非安装或设备'],'delivery':'working-tree'})
atlas['axes']['implementation'].extend([
{'id':'i180','label':'definition_rename.rs：保真标识与全部引用原子修改','kind':'product','language':['Rust'],'paths':['crates/viento-studio-core/src/scene_composition_definition_rename.rs','crates/viento-studio-core/src/lib.rs']},
{'id':'i181','label':'定义rename提案与独立核心桥的完整意图/字节复核','kind':'product','language':['JavaScript'],'paths':['engine/studio-core.mjs','engine/scene-composition-definitions.mjs']},
{'id':'i182','label':'定义管理内重命名、引用审阅及可选能力守护','kind':'product','language':['JavaScript'],'paths':['web/modules/app-scene-composition-definitions.js','web/i18n/en.js','web/i18n/ja.js']}])
files=[('source',p)for p in ['crates/viento-studio-core/src/scene_composition_definition_rename.rs','crates/viento-studio-core/src/lib.rs','engine/studio-core.mjs','engine/scene-composition-definitions.mjs','web/modules/app-scene-composition-definitions.js']]
files += [('test',f'scripts/tests/{p}')for p in ['scene-composition-definition-rename.test.mjs','studio-core-composition-definition-rename.test.mjs','scene-composition-definition-rename-ui.test.mjs','scene-composition-definition-rename-workflow.test.mjs','scene-composition-definition-rename-smoke.mjs']]
files += [('design',p)for p in ['docs/SCENE_COMPOSITION.md','docs/SCENE_AUTHORING.md','engine/README.md']]
files += [('report',f'docs/test-results/scene-composition-fragment-rename/{p}')for p in ['results.json','core-results.json','core-independent-audit.json','core-native-test.log','core-fmt-check.log','core-clippy.log','core-pure-tests.log','core-bridge-tests.log','core-regression-final.log','web-validation.json','web-focused-final.log','workflow-tests-final.log','app-check.log','review.json','document-review.json','browser-final/browser.json','browser-initial/browser.json','browser-second/browser.json','browser-third/browser.json','browser-fourth/browser.json','reviewer-native-provenance.json','packaged-resources.json','prepared-check.log','prepared-check-initial.log','prepared-check-second.log','boundary-cases.mjs','boundary-source-results.json','source-hashes.json','source-delta.json','native-helpers.json','fixed-node.json','native-tools-build-initial.log','native-tools-build-second.log','native-tools-build.log','cleanup.json','preservation-audit.json']]
evidence_ids=[]; start=max(int(v['id'][1:])for v in atlas['evidence'])+1
for index,(kind,name)in enumerate(files,start):
 assert (root/name).is_file(),name
 eid=f'e{index}';evidence_ids.append(eid);atlas['evidence'].append({'id':eid,'kind':kind,'path':name,'note':'片段重命名单独增量；真实准备/交互与标准VM证明分别记录，旧评分保持，不授予发布/安装/设备成熟度。'})
start=max(int(v['id'][1:])for v in atlas['bindings'])+1
for index,(architecture,implementation,role,decoupling)in enumerate([('rust-core','i180','保真原子更新及完整原文/展开预算',4),('semantic-js','i181','完整意图/精确字节复核及九域既有候选来源',4),('ui','i182','三语重命名表单、引用及稳定身份审阅',3),('persistence','i182','仅应用内存，普通保存负责持久化',3)],start):
 atlas['bindings'].append({'id':f'b{index}','architecture':architecture,'function':feature,'implementation':implementation,'role':role,'evidence':evidence_ids})
 for maturity,value,reason in [('implementation',3,'本文件片段重命名闭环；空间层次/跨文件/历史另立契约。'),('verification',3,'全应用/Rust/WASM/真实浏览器及准备副本分别通过，无安装/设备验收。'),('decoupling',decoupling,'Rust负责源码修改，桥与纯提案复核，GUI复用已有独立definitions域；宿主聚合债务保持可见。'),('delivery',2,'未发布工作树和实际资源准备，无版本/提交/安装包变更。')]:
  atlas['cells'].append({'coordinates':[architecture,feature,implementation,maturity],'value':value,'reason':reason})
for target in ['scene.composition','scene.composition_definitions_editor','scene.authoring_workflow','authoring.document-edit','studio.system_modules']:
 assert any(v['id']==target for v in atlas['axes']['function'])
 atlas['dependencies'].append({'from':feature,'to':target,'relation':'requires','reason':'保留作者格式、完整来源、身份与普通保存；新动作不扩张其他编辑域或执行后端权限。'})
atlas['workflows'].append({'id':'scene-composition-fragment-rename-source','label':'原/新片段标识→全部引用审阅→完整候选来源→原文草稿→普通保存','steps':['scene.composition',feature,'scene.authoring_workflow','authoring.document-edit'],'boundary':'同一recipe原子替换定义和全部放置引用；actor/group/placement身份及有效场景保持，普通Save仍是持久权威；能力缺失仅禁用新动作。'})
atlas['meta']['scope']=f'0.0.9发布后base9065667新增{feature}/i180–182/4bindings/16cells；九域不变的片段重命名及全部放置引用同步。原评分/历史前缀不改，3341历史证据、39作者文件与4工具保持。{app}全应用、{rust}Rust、{browser}真实Chrome、{prepared}prepared标准VM分别绑定；无发布/安装/Android设备验收。'
path.write_text(json.dumps(atlas,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:len(atlas[k])for k in ['bindings','cells','evidence','dependencies','workflows']}))

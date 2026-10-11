#!/usr/bin/env python3
"""Bounded source-release adoption, preserving other maturity dimensions."""
import copy
import datetime
import hashlib
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[3]
EVIDENCE = pathlib.Path(__file__).resolve().parent
ATLAS = ROOT / 'docs/function-atlas.json'
BEFORE = EVIDENCE / 'atlas-before-delivery.json'
old = json.loads(BEFORE.read_text())
assert ATLAS.read_bytes() == BEFORE.read_bytes(), 'Run once against the exact pre-delivery atlas'
data = copy.deepcopy(old)
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
assert head == '9065667363a99a28aa64855f49052f5ee1d6f581'
committed = json.loads(subprocess.check_output(['git', 'show', 'HEAD:docs/function-atlas.json'], cwd=ROOT))
known = {feature['id'] for feature in committed['axes']['function']}
features = {feature['id']: feature for feature in data['axes']['function']}
released = [feature['id'] for feature in data['axes']['function'] if feature['delivery'] == 'working-tree']
assert len(released) == 16
assert set(released) == set(features) - known
promoted = [cell for cell in data['cells'] if cell['coordinates'][3] == 'delivery' and cell['value'] == 2]
assert len(promoted) == 68 and all(cell['coordinates'][1] in released for cell in promoted)

data['meta']['version'] = '0.0.10'
data['meta']['date'] = '2026-10-11'
data['meta']['commit'] = head
data['meta']['scope'] = ('0.0.10源码发布提交：纳入0.0.9基线之后16项新增功能，将68个交付单元2→3；'
    '实现、验证、解耦及安装/设备评分不变。当前83功能/186实现、九配方创作入口/八候选kind、'
    '八系统模块/24声明能力，独立只读3D视图与静态Godot导出不加入2D执行协议。'
    '发布记录和release-0.0.10证据单独附加；无tag、GitHub Release或新安装/设备验收。'
    '此前专题记录保留当时条件（当时未发布）：' + old['meta']['scope'])
for feature_id in released:
    feature = features[feature_id]
    feature['delivery'] = 'source-release'
    suffix = feature['boundary'][0].split('；', 1)
    if len(suffix) == 2:
        feature['boundary'][0] = '0.0.10源码交付（审查基线9065667）；' + suffix[1]
features['scene.composition_inheritance']['boundary'][0] = '0.0.10源码交付；独立于既有场景组合的单实例六字段恢复能力，原recipe/World/Scene2D/运行协议保持。'
features['studio.system_modules']['boundary'][0] = '0.0.10源码交付；系统基础边界，而非全部功能内部拆分。'
features['scene.composition_definition_rename']['boundary'][0] = '0.0.10源码交付；recipe/Scene2D/World/元数据/构建及后端协议不变；重命名复用九创作入口／八候选kind，当前系统另有八模块／24声明能力。'

f = features['scene.composition']
f['boundary'][13] = ('0.0.10源码纳入单实例六字段恢复、单/多位置画布、共享演员声明SET/恢复、整组offset，'
    '以及独立演员/放置/组织组/定义结构创作和定义重命名；九入口分离审批与局部历史，'
    '生成场景编辑不反向修改配方。空间层次、其他字段批次与跨视图历史仍未接入。')
f['next'] = '在字段、位置及独立演员/放置/组/定义结构和重命名切片之后，分别定义空间层次与跨视图历史；嵌套/跨文件/多文件提交另立契约。'
for feature_id in ['scene.composition_inheritance','scene.composition_canvas','scene.composition_batch_canvas',
        'scene.composition_fragment_editor','scene.composition_fragment_inheritance','scene.composition_placement_editor']:
    features[feature_id]['next'] = ('现有字段/画布/偏移入口保持；共享演员、整份放置、组织组、定义增删和定义重命名各列独立切片。'
        '后续空间层次、跨视图历史、嵌套/跨文件/规模以及多placement偏移或其他字段批次单独定义和验收。')

f = features['backend.project_management']
f['boundary'][4] = '详情仅opaque buildId；本会话创建时物理目录inode/Symbol ledger/manifest hash不能从磁盘清单重新伪造删除所有权。跨服务恢复另列backend.project_catalog，恢复条目统一preserved。'
f['boundary'][-1] = '持久catalog与冻结工程选择另列backend.project_catalog；本清单切片不提供生成工程回导／手动强删／任意独立发行／新ns-nova执行／Androidhost能力。'
f['next'] = '持久创建者索引和跨服务恢复已另列backend.project_catalog；继续定义生成工程作者化／导入、显式删除、跨缓存迁移和独立发行，不扫描缓存自动收养。'
f = features['scene.composition_structure_editor']
f['next'] = '整份放置、组织组、定义增删与定义重命名已分别列为独立切片；继续定义空间层次、场景文本组织和跨视图历史合同。'

f = features['scene.authoring_workflow']
f['boundary'][0] = '0.0.10源码交付；九创作入口分别维护输入、审批、选择和局部历史，没有跨区统一撤销。'
f['boundary'][1] = '纯candidate固定八种kind：instance（覆盖／单实例布局共用）、positions、fragment、placement、structure、placements、groups、definitions；核对摘要、来源及完整目标，unknown kind与bad shape闭合拒绝。'
f['boundary'][6] = 'web adapter绑定九创作UI及HTTP/catalog；构建父仅交接窗口归属和成功导航，source host保留最后检查、内存应用、baseline和普通Save。3D只读来源视图独立，不借用配方候选或执行权限。'
f['boundary'][7] = '最初六入口抽取时，Rust/WASM、recipe/World/runtime格式、六domain补丁和UI/sourcehost原字节保持；旧桥接测试仅更新共享函数identity断言并保留双方完整审阅/释放保护。后续结构领域按各自专题证据接入，未改原数据协议。'
f['boundary'][8] = '最初抽取专题的固定Node全量、51新专项与37真实Chrome流程按当时六入口范围保留；后续三个结构入口的验证另列各专题。prepared标准VM复用不计安装窗口／Android编辑设备验收。'

f = features['studio.system_modules']
f['boundary'][1] = '当前八固定模块／24声明能力按依赖注册；重复提供者／缺依赖／循环／版本错误闭合拒绝，没有动态代码路径。3D模块依赖普通文档模块，不依赖World或构建。'
f['boundary'][2] = '工程studioProfile是增量required／optional数据；缺实际3D核心／Rust作者执行／未来API不关闭普通正文模块，静态active不授予写或运行权限，也不证明工具已安装。'
f['boundary'][4] = 'GUI只在启动时装配七个区域（原六区加独立3D视图），各区拿自己的端口；正文模块保留既有宿主权威，media可选拿导出函数；私有controller和作者内容不外泄，只读snapshot供后续诊断面板。'
f['boundary'][7] = 'World与构建区内部仍聚合，原2D预览仍受构建区可用性约束；独立3D只读视图另列scene.primitives3d。不提供热卸载、插件执行或权限沙箱，也不声称全部内部功能已拆分。'
f['boundary'][8] = '系统基础专题当时七模块／22能力，51新专项、53原生PASS与1旧full-size忽略、7实际Chrome流程和prepared标准VM分别保留；后续第八3D模块与24声明能力的验证另列scene.primitives3d。无安装／Android设备验收。'
f['next'] = '沿接口继续拆正文生命周期、World命令与2D场景预览／执行贡献；独立3D表示、计划和视图已列首切片，资源、空间层级、行为和进一步工程模板需求分别接入。'

features['scene.composition_placements_editor']['next'] = '片段演员、组织组、定义结构与重命名已另列独立创作能力；继续定义放置重排、空间层次、跨视图历史和规模边界。'
features['scene.composition_groups_editor']['next'] = '定义结构与重命名已另列独立能力；继续定义组空间变换、重排及跨视图历史，保持组织组与空间层级分离。'
features['scene.composition_definitions_editor']['next'] = '片段重命名另列scene.composition_definition_rename；继续定义重排、空间层次、嵌套或跨文件复用及跨视图历史合同。'

# Historical source-release features retain their recorded protocol and test
# scope while distinguishing the publication date from earlier worktree probes.
for feature in data['axes']['function']:
    if feature['id'] in released:
        continue
    for index, boundary in enumerate(feature['boundary']):
        boundary = boundary.replace('未发布配方增量', '0.0.10配方增量').replace('未发布配方保存态', '0.0.8已交付配方保存态').replace('未发布配方预览', '0.0.8已交付配方预览')
        boundary = boundary.replace('未发布行为另列', '0.0.8已交付行为另列')
        boundary = boundary.replace('0.0.8之后未发布的显式工具身份检查', '0.0.9已交付的显式工具身份检查')
        boundary = boundary.replace('未发布中间层包装', '0.0.8已交付中间层包装').replace('未发布界面按完整descriptor', '已交付界面按完整descriptor')
        boundary = boundary.replace('0.0.8后的未发布工作树增量；', '原专题在0.0.8之后、0.0.9交付前核验；')
        boundary = boundary.replace('0.0.8之后未发布工作树；', '原专题在0.0.8之后、0.0.9交付前核验；')
        boundary = boundary.replace('0.0.8之后未发布工作树，', '原专题在0.0.8之后、0.0.9交付前核验；')
        feature['boundary'][index] = boundary

for workflow in data['workflows']:
    if workflow['id'] == 'W04':
        workflow['boundary'] = workflow['boundary'].replace('当前工作树v2', '已纳入源码交付的v2')
    if workflow['id'] == 'execution-tool-identity':
        workflow['boundary'] = workflow['boundary'].replace('0.0.8之后未发布，无新安装/设备。', '原专题在0.0.8之后、0.0.9交付前核验；无新安装/设备。')
priority = data['priorities'][0]
priority['label'] = '在字段与独立结构创作之后推进空间层次和跨视图历史'
priority['reason'] = ('0.0.10纳入恢复、单/多位置画布、共享声明SET/恢复、offset与演员/放置/组织组/定义结构及重命名；'
    '各入口保持独立原文审批，空间层次、其他字段批次与跨视图历史仍需独立合同。')
priority['acceptance'] = ('保留原文/稳定身份/localoverrides/ordinarySave；后续空间层次和统一历史须单独定义事务与撤销，'
    '不能借组织组隐式施加transform，跨文件和规模独立验收。')

release_evidence = []
for path, note in [
    ('docs/RELEASE_0.0.10.md', '0.0.10源码提交范围；不等于安装包、tag、GitHub Release或设备验收。'),
    ('docs/test-results/release-0.0.10/atlas-delivery.json', '精确16功能／68交付坐标2→3清单，其余成熟度与历史证据保持。'),
    ('docs/test-results/release-0.0.10/results.json', '0.0.10本轮实际验证、源码冻结及交付边界；旧专题按其原条件保留。')]:
    identifier = f"e{max(int(item['id'][1:]) for item in data['evidence']) + 1:03d}"
    data['evidence'].append({'id': identifier, 'kind': 'report', 'path': path, 'note': note})
    release_evidence.append(identifier)
for binding in data['bindings']:
    if binding['function'] in released:
        binding['evidence'].extend(release_evidence)
for cell in promoted:
    cell['value'] = 3
    cell['reason'] = '纳入0.0.10源码发布提交；只更新源码交付状态，当前安装产物／Tauri窗口／Android设备未新增验收，其余成熟度不变。'

# Prove the declared permission boundary before writing the authority file.
for dimension in ['architecture', 'implementation', 'maturity']:
    assert data['axes'][dimension] == old['axes'][dimension]
for dimension in data['axes']:
    assert [entry['id'] for entry in data['axes'][dimension]] == [entry['id'] for entry in old['axes'][dimension]]
changes = []
for before, after in zip(old['cells'], data['cells']):
    assert before['coordinates'] == after['coordinates']
    if before != after:
        assert before['coordinates'][3] == 'delivery' and before['value'] == 2 and after['value'] == 3
        changes.append({'coordinates': before['coordinates'], 'before': before, 'after': after})
assert len(changes) == 68
assert data['evidence'][:len(old['evidence'])] == old['evidence']
assert data['dependencies'] == old['dependencies'] and data['legacyCoverage'] == old['legacyCoverage']
for before, after in zip(old['bindings'], data['bindings']):
    assert {key:value for key,value in before.items() if key != 'evidence'} == {key:value for key,value in after.items() if key != 'evidence'}
    assert after['evidence'][:len(before['evidence'])] == before['evidence']
for before, after in zip(old['workflows'], data['workflows']):
    assert {key:value for key,value in before.items() if key != 'boundary'} == {key:value for key,value in after.items() if key != 'boundary'}

canonical = lambda value: json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
sha = lambda value: hashlib.sha256(value).hexdigest()
notes = []
for before, after in zip(old['axes']['function'], data['axes']['function']):
    changed = {key:{'before':before.get(key),'after':after.get(key)} for key in after if before.get(key) != after.get(key)}
    if changed:
        notes.append({'function':before['id'],'fields':changed})
ledger = {
    'format':'viento-atlas-source-release-adoption','schemaVersion':1,
    'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'version':'0.0.10','auditBaseCommit':head,
    'deliveryScope':'Source publication commit only; no tag, GitHub Release, installer or new installed/device maturity.',
    'beforeAtlasPath':'docs/test-results/release-0.0.10/atlas-before-delivery.json','beforeAtlasSha256':sha(BEFORE.read_bytes()),
    'committedBaselineAxes':{key:len(value) for key,value in committed['axes'].items()},
    'currentAxes':{key:len(value) for key,value in data['axes'].items()},
    'releasedFunctions':released,'deliveryCellChanges':changes,'activeBoundaryChanges':notes,
    'preservation':{
        'oldAxisIds':{key:[entry['id'] for entry in value] for key,value in old['axes'].items()},
        'architectureImplementationMaturityExact':True,'nonDeliveryCellsExact':True,
        'oldEvidenceEntriesExactPrefix':len(old['evidence']),'oldEvidencePrefixSha256':sha(canonical(old['evidence'])),
        'bindingIdsCoordinatesRolesAndEvidencePrefixExact':True,'dependenciesExact':True,'legacyChainsExact':True,
        'workflowIdsStepsOrderExact':True,'otherDeliveryValuesAndReasonsExact':True,
        'sourceSnapshotDeferredToRootFinalFreeze':True},
    'appendedEvidence':data['evidence'][-3:],
    'unchangedMaturityDimensions':['implementation','verification','decoupling'],
    'counts':{'functions':83,'implementations':186,'bindings':len(data['bindings']),'cells':len(data['cells']),
        'releasedFunctions':16,'delivery2To3':68,'appendedEvidence':3},
    'historicalCondition':'Old evidence notes and report bytes retain the dates, versions, case counts and environments they actually verified. Current boundary wording distinguishes those past assertions from the new source release.',
    'finalReceipt':'docs/test-results/release-0.0.10/results.json',
    'views':'Root regenerates views and sourceSnapshot once release results and all final documentation exist.',
    'findings':[]}
(EVIDENCE/'atlas-delivery.json').write_text(json.dumps(ledger,ensure_ascii=False,indent=2)+'\n')
ATLAS.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'ok':True,'releasedFunctions':16,'deliveryCells':68,'evidence':release_evidence,
    'atlasSha256':sha(ATLAS.read_bytes()),'ledgerSha256':sha((EVIDENCE/'atlas-delivery.json').read_bytes())},indent=2))

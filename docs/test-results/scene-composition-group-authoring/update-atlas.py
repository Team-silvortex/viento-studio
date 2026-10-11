"""Append this slice without rewriting previous maturity assessments or evidence."""
from pathlib import Path
import json

root = Path.cwd()
out = root / 'docs/test-results/scene-composition-group-authoring'
path = root / 'docs/function-atlas.json'
atlas = json.loads(path.read_text())
baseline = json.loads((out / 'atlas-baseline.json').read_text())
feature = 'scene.composition_groups_editor'
assert not any(item['id'] == feature for item in atlas['axes']['function'])
for axis, values in baseline['axes'].items():
    assert atlas['axes'][axis] == values
for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']:
    assert atlas[key] == baseline[key]

atlas['axes']['function'].append({
    'id': feature, 'label': '共享片段组织组新增、名称／父组编辑、演员归组与空叶组移除', 'group': '场景与构建',
    'entry': '当前配方原文预览→编辑组织分组→全放置组织关系及候选审阅→应用原文草稿→普通保存',
    'boundary': [
        '0.0.9发布后未发布工作树；recipe/World/Scene2D/后端协议不变，未增加系统注册模块或声明能力。',
        '新增共享片段组织组，一次分配各引用放置的新group UUID；现有组局部键与全部actor/placement身份保持，未放置片段使用空目标列表。',
        '名称和父组全量编辑、单演员归组或取消归组仅改共享声明；无净变化保留原字节，name保留原字符串，父组不得形成环或超过16层。',
        '仅删除无直接演员和直接子组的空叶组并移除各放置映射；无隐式提升/成员转移，可删除最后组，保留groups:[]与groupIds:{}。',
        '独立可选groups_version=1和四操作；缺能力只关闭新入口，旧核心/七编辑入口保持。128KiB和完整展开的128演员/组/放置及16层预算继续生效。',
        '纯接口在await前分离输入；宿主重构动作、全部身份与精确原文补丁，完整候选检查投影/图片、全部actor/group贡献来源以及组名/父组/有序演员归属。',
        '独立创作kind=groups与其余七区分开；各区不互相导入，源宿主仍只应用内存后普通Save处理持久化和外部冲突。',
        '2816全应用、72新增JS、150共享核心（12新增）、10实际Chrome流程及142桌面/移动prepared标准VM案例分别记录，专项与全量重叠。',
        '新操作仅组织分组；演员有效字段/绘制顺序/offset/局部覆盖原文保持；无片段定义编辑、重排、空间变换、多文件事务或跨视图统一历史，无安装/设备验收。',
    ],
    'next': '分别定义片段定义结构、空间层次及跨视图历史；后续呈现方式消费独立提案与创作接口。',
    'platforms': ['Linux实际HTTP/Chrome中英日390px原文创作', '共享Rust原生/WASM和实际桌面/移动准备副本；非安装或Android设备'],
    'delivery': 'working-tree',
})
atlas['axes']['implementation'].extend([
    {'id': 'i174', 'label': 'groups_patch.rs：独立组织组四动作CST补丁', 'kind': 'product', 'language': ['Rust'],
     'paths': ['crates/viento-studio-core/src/scene_composition_groups_patch.rs', 'crates/viento-studio-core/src/lib.rs']},
    {'id': 'i175', 'label': 'scene-composition-groups.mjs：全放置组织提案与创作回执', 'kind': 'product', 'language': ['JavaScript'],
     'paths': ['engine/scene-composition-groups.mjs', 'engine/studio-core.mjs', 'engine/scene-authoring-candidate.mjs', 'engine/scene-authoring-workflow.mjs']},
    {'id': 'i176', 'label': '组织组创作：独立表单、预览连接与原文宿主', 'kind': 'product', 'language': ['JavaScript', 'CSS'],
     'paths': ['web/modules/app-scene-composition-groups.js', 'web/modules/app-scene-authoring.js', 'web/modules/app-scene-preview.js', 'web/modules/app-project-build.js', 'web/modules/app-runtime.js', 'web/project-build.css']},
])
files = [
    ('source', 'crates/viento-studio-core/src/scene_composition_groups_patch.rs'),
    ('source', 'engine/scene-composition-groups.mjs'),
    ('source', 'engine/studio-core.mjs'),
    ('source', 'engine/scene-authoring-workflow.mjs'),
    ('source', 'engine/scene-authoring-candidate.mjs'),
    ('source', 'web/modules/app-scene-composition-groups.js'),
    ('source', 'web/modules/app-scene-authoring.js'),
    ('source', 'web/modules/app-runtime.js'),
    ('test', 'scripts/tests/scene-composition-groups.test.mjs'),
    ('test', 'scripts/tests/studio-core-composition-groups-patch.test.mjs'),
    ('test', 'scripts/tests/scene-composition-groups-ui.test.mjs'),
    ('test', 'scripts/tests/scene-composition-groups-host.test.mjs'),
    ('test', 'scripts/tests/scene-composition-groups-preview.test.mjs'),
    ('test', 'scripts/tests/scene-composition-groups-workflow.test.mjs'),
    ('test', 'scripts/tests/scene-composition-groups-smoke.mjs'),
    ('design', 'docs/SCENE_COMPOSITION.md'),
    ('design', 'docs/SCENE_AUTHORING.md'),
]
files.extend(('report', f'docs/test-results/scene-composition-group-authoring/{name}') for name in [
    'results.json', 'app-check.log', 'core-results.json', 'core-native-test.log',
    'core-pure-tests.log', 'core-bridge-tests.log', 'core-regression-final.log', 'web-focused-second.log',
    'web-regression.log', 'workflow-tests-final.log', 'review.json', 'document-review.json',
    'browser-confirmed/browser.json', 'packaged-resources.json', 'source-delta.json',
    'source-hashes.json', 'native-helpers.json', 'cleanup.json', 'preservation-audit.json',
])
evidence_ids = []
start = max(int(item['id'][1:]) for item in atlas['evidence']) + 1
for index, (kind, name) in enumerate(files, start):
    assert (root / name).is_file(), name
    evidence_id = f'e{index}'
    evidence_ids.append(evidence_id)
    atlas['evidence'].append({'id': evidence_id, 'kind': kind, 'path': name,
        'note': '组织组独立增量；原文保真/身份/组织关系/普通保存与初次失败另存，准备副本不提升安装或设备交付。'})
start = max(int(item['id'][1:]) for item in atlas['bindings']) + 1
for index, (architecture, implementation, role, decoupling) in enumerate([
    ('rust-core', 'i174', '严格组动作/全展开预算及原文CST修改', 4),
    ('semantic-js', 'i175', '来源提案、全身份及组名/父组/成员复核和独立创作回执', 4),
    ('ui', 'i176', '各自表单、目录与完整预览连接', 3),
    ('persistence', 'i176', '原文内存应用及既有普通Save冲突边界', 3),
], start):
    atlas['bindings'].append({'id': f'b{index}', 'architecture': architecture, 'function': feature,
        'implementation': implementation, 'role': role, 'evidence': evidence_ids})
    for maturity, value, reason in [
        ('implementation', 3, '限定共享组织组的四种动作接入当前源码；片段定义/空间层次/历史仍另立契约。'),
        ('verification', 3, '全应用、原生/WASM、实际Chrome和prepared纯层分别通过；无安装/设备验收。'),
        ('decoupling', decoupling, '纯核心和提案在不同目标复用；GUI显式各自接口，既有主编辑器和构建区仍有聚合债务。'),
        ('delivery', 2, '当前未发布工作树与资源准备，无版本变更、提交或新安装包。'),
    ]:
        atlas['cells'].append({'coordinates': [architecture, feature, implementation, maturity], 'value': value, 'reason': reason})
for target in ['scene.composition', 'scene.authoring_workflow', 'scene.composition_structure_editor', 'authoring.document-edit', 'studio.system_modules']:
    assert any(item['id'] == target for item in atlas['axes']['function'])
    atlas['dependencies'].append({'from': feature, 'to': target, 'relation': 'requires',
        'reason': '保留原配方格式、来源、稳定身份和普通保存；新能力不授予其他编辑区或运行后端权限。'})
atlas['workflows'].append({'id': 'scene-composition-organizational-groups-source',
    'label': '组织组意图→全放置身份/名称/父组/归属→完整候选→原文草稿→普通保存',
    'steps': ['scene.composition', feature, 'scene.authoring_workflow', 'authoring.document-edit'],
    'boundary': '组织组和有序归属的完整候选/全actor-group来源验证后只改当前原文内存；仅空叶组可删，坐标与旧编辑区/执行后端保持独立。'})
atlas['meta']['scope'] = '0.0.9发布后base9065667新增scene.composition_groups_editor/i174–176与4bindings/16cells；独立共享组织组新增/改名与父组/演员归组/空叶组移除，8配方编辑入口。保留既有图谱前缀评分、3111历史证据和39作者文件、4工具。共享核心新增可选能力/WASM；2816全应用、72新JS、150原生、10实际Chrome、142prepared分别记录。7系统module/22声明能力及作者/后端协议未改；无版本/发布/安装/设备交付。'
path.write_text(json.dumps(atlas, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: len(atlas[key]) for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows']}))

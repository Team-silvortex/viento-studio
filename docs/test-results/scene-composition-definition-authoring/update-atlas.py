"""Append this slice without rewriting previous maturity assessments or evidence."""
from pathlib import Path
import json

root = Path.cwd()
out = root / 'docs/test-results/scene-composition-definition-authoring'
path = root / 'docs/function-atlas.json'
atlas = json.loads(path.read_text())
baseline = json.loads((out / 'atlas-baseline.json').read_text())
feature = 'scene.composition_definitions_editor'
assert not any(item['id'] == feature for item in atlas['axes']['function'])
for axis, values in baseline['axes'].items():
    assert atlas['axes'][axis] == values
for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']:
    assert atlas[key] == baseline[key]

results = json.loads((out / 'results.json').read_text())
app = results['verification']['application']['tests']
rust = results['verification']['sharedCore']['total']
newjs = results['verification']['newJavaScript']['total']
prepared = results['verification']['prepared']['totalCases']
atlas['axes']['function'].append({
    'id': feature, 'label': '共享片段定义新增、独立复制与未放置定义移除', 'group': '场景与构建',
    'entry': '当前配方原文预览→管理片段定义→完整来源与候选审阅→应用原文草稿→普通保存；放置仍由独立入口处理',
    'boundary': [
        '0.0.9发布后未发布工作树；recipe/World/Scene2D/后端协议不变，未增加系统注册模块或声明能力。',
        '新增完整原始片段定义，界面先选择一个演员；复制仅替换所复制fragmentId值token并追加独立未放置定义；全原始声明和局部键保持。',
        '仅移除没有任何原始placement引用的定义；至少保留一个定义，没有隐式删除放置或实例、身份分配、重排或重命名。',
        '定义操作targets严格为空；完整展开后有效演员字段、绘制顺序和组织关系保持；删除未使用定义后重新验证JSON Pointer、UTF-16范围和有序贡献来源。',
        '独立可选definitions_version=1与Rust CST操作；缺能力只关闭新入口，旧八个入口保持，128KiB、32定义和完整展开128演员/组/放置预算继续生效。',
        '未放置定义候选校验全部原始对象和显式图片注册引用；有效投影和实际图片字节仍在首次放置复核，未扩大未放置依赖协议。',
        '纯提案与独立kind=definitions接入第九创作域；宿主先分离输入、完整候选校验，再只应用内存原文，普通Save仍处理持久化及外部冲突。',
        f'{app}全应用、{newjs}新增JS、{rust}共享核心、11实际Chrome流程及{prepared}桌面/移动prepared标准VM案例分别记录，专项与全量重叠。',
        '浏览器不能访问Node依赖；来源范围校验复用Rust CST定位接口，保持原静态资源边界；初次全量及浏览器失败保留。',
    ],
    'next': '独立定义片段重命名/重排、空间层次、嵌套或跨文件复用及跨视图历史契约。',
    'platforms': ['Linux实际HTTP/Chrome中英日390px原文创作', '共享Rust原生/WASM和实际桌面/移动准备副本；非安装或Android设备'],
    'delivery': 'working-tree',
})
atlas['axes']['implementation'].extend([
    {'id': 'i177', 'label': 'definitions_patch.rs：定义三动作及来源定位CST接口', 'kind': 'product', 'language': ['Rust'],
     'paths': ['crates/viento-studio-core/src/scene_composition_definitions_patch.rs', 'crates/viento-studio-core/src/lib.rs']},
    {'id': 'i178', 'label': 'scene-composition-definitions.mjs：完整原始定义提案与来源创作回执', 'kind': 'product', 'language': ['JavaScript'],
     'paths': ['engine/scene-composition-definitions.mjs', 'engine/studio-core.mjs', 'engine/scene-authoring-candidate.mjs', 'engine/scene-authoring-workflow.mjs']},
    {'id': 'i179', 'label': '片段定义：独立表单、预览连接与原文宿主', 'kind': 'product', 'language': ['JavaScript', 'CSS'],
     'paths': ['web/modules/app-scene-composition-definitions.js', 'web/modules/app-scene-authoring.js', 'web/modules/app-scene-preview.js', 'web/modules/app-project-build.js', 'web/modules/app-runtime.js', 'web/project-build.css']},
])
files = [
    ('source', 'crates/viento-studio-core/src/scene_composition_definitions_patch.rs'),
    ('source', 'engine/scene-composition-definitions.mjs'),
    ('source', 'engine/studio-core.mjs'),
    ('source', 'engine/scene-authoring-workflow.mjs'),
    ('source', 'engine/scene-authoring-candidate.mjs'),
    ('source', 'web/modules/app-scene-composition-definitions.js'),
    ('source', 'web/modules/app-scene-authoring.js'),
    ('source', 'web/modules/app-runtime.js'),
    ('test', 'scripts/tests/scene-composition-definitions.test.mjs'),
    ('test', 'scripts/tests/studio-core-composition-groups-patch.test.mjs'),
    ('test', 'scripts/tests/scene-composition-definitions-ui.test.mjs'),
    ('test', 'scripts/tests/scene-composition-definitions-host.test.mjs'),
    ('test', 'scripts/tests/scene-composition-definitions-preview.test.mjs'),
    ('test', 'scripts/tests/scene-composition-definitions-workflow.test.mjs'),
    ('test', 'scripts/tests/scene-composition-definitions-smoke.mjs'),
    ('design', 'docs/SCENE_COMPOSITION.md'),
    ('design', 'docs/SCENE_AUTHORING.md'),
]
files.extend(('report', f'docs/test-results/scene-composition-definition-authoring/{name}') for name in [
    'results.json', 'app-check.log', 'core-results.json', 'core-native-test.log',
    'core-pure-tests.log', 'core-bridge-tests.log', 'core-regression-final.log', 'web-focused-second.log',
    'web-regression.log', 'workflow-tests-final.log', 'review.json', 'document-review.json',
    'browser-final/browser.json', 'packaged-resources.json', 'source-delta.json',
    'source-hashes.json', 'native-helpers.json', 'cleanup.json', 'preservation-audit.json',
    'browser-module-graph-final.log', 'app-check-initial.log', 'prepared-check-initial.log',
    'boundary-cases.mjs', 'boundary-source-results.json', 'prepared-check.mjs',
    'browser-third/browser.json',
])
evidence_ids = []
start = max(int(item['id'][1:]) for item in atlas['evidence']) + 1
for index, (kind, name) in enumerate(files, start):
    assert (root / name).is_file(), name
    evidence_id = f'e{index}'
    evidence_ids.append(evidence_id)
    atlas['evidence'].append({'id': evidence_id, 'kind': kind, 'path': name,
        'note': '片段定义独立增量；原文保真/来源/普通保存与启动依赖失败另存，准备副本不提升安装或设备交付。'})
start = max(int(item['id'][1:]) for item in atlas['bindings']) + 1
for index, (architecture, implementation, role, decoupling) in enumerate([
    ('rust-core', 'i177', '定义三动作/全展开预算及原文CST定位与修改', 4),
    ('semantic-js', 'i178', '来源提案、完整有效字段及贡献来源复核和独立创作回执', 4),
    ('ui', 'i179', '各自表单、目录与完整预览连接', 3),
    ('persistence', 'i179', '原文内存应用及既有普通Save冲突边界', 3),
], start):
    atlas['bindings'].append({'id': f'b{index}', 'architecture': architecture, 'function': feature,
        'implementation': implementation, 'role': role, 'evidence': evidence_ids})
    for maturity, value, reason in [
        ('implementation', 3, '限定共享定义新增/独立复制/未放置移除接入当前源码；重命名/空间层次/历史仍另立契约。'),
        ('verification', 3, '全应用、原生/WASM、实际Chrome和prepared纯层分别通过；无安装/设备验收。'),
        ('decoupling', decoupling, '纯核心和提案在不同目标复用；GUI显式各自接口，既有主编辑器和构建区仍有聚合债务。'),
        ('delivery', 2, '当前未发布工作树与资源准备，无版本变更、提交或新安装包。'),
    ]:
        atlas['cells'].append({'coordinates': [architecture, feature, implementation, maturity], 'value': value, 'reason': reason})
for target in ['scene.composition', 'scene.authoring_workflow', 'scene.composition_structure_editor', 'authoring.document-edit', 'studio.system_modules']:
    assert any(item['id'] == target for item in atlas['axes']['function'])
    atlas['dependencies'].append({'from': feature, 'to': target, 'relation': 'requires',
        'reason': '保留原配方格式、来源、稳定身份和普通保存；新能力不授予其他编辑区或运行后端权限。'})
atlas['workflows'].append({'id': 'scene-composition-fragment-definitions-source',
    'label': '定义意图→原始定义/空目标/完整来源→完整候选→原文草稿→普通保存',
    'steps': ['scene.composition', feature, 'scene.authoring_workflow', 'authoring.document-edit'],
    'boundary': '完整有效场景和actor/group贡献来源验证后只改当前原文内存；仅无放置引用的定义可删，新定义首次放置仍复核投影与图片，旧编辑区/执行后端保持独立。'})
atlas['meta']['scope'] = f'0.0.9发布后base9065667新增scene.composition_definitions_editor/i177–179与4bindings/16cells；共享定义新增/独立复制/未放置移除，第九配方创作入口，Rust CST来源校验保持浏览器资源边界。保留既有图谱前缀评分、3215历史证据和39作者文件、4工具。共享核心新增可选能力/WASM；{app}全应用、{newjs}新JS、{rust}原生、11实际Chrome、{prepared}prepared分别记录。7系统module/22声明能力及作者/后端协议未改；无版本/发布/安装/设备交付。'
path.write_text(json.dumps(atlas, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: len(atlas[key]) for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows']}))

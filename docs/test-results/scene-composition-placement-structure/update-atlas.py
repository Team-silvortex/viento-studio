"""Append this slice without rewriting previous maturity assessments or evidence."""
from pathlib import Path
import json

root = Path.cwd()
out = root / 'docs/test-results/scene-composition-placement-structure'
path = root / 'docs/function-atlas.json'
atlas = json.loads(path.read_text())
baseline = json.loads((out / 'atlas-baseline.json').read_text())
feature = 'scene.composition_placements_editor'
assert not any(item['id'] == feature for item in atlas['axes']['function'])
for axis, values in baseline['axes'].items():
    assert atlas['axes'][axis] == values
for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']:
    assert atlas[key] == baseline[key]

atlas['axes']['function'].append({
    'id': feature, 'label': '整份片段放置新增、保真复制与移除', 'group': '场景与构建',
    'entry': '当前配方原文预览→管理片段放置→完整候选及身份审阅→应用原文草稿→普通保存',
    'boundary': [
        '0.0.9发布后未发布工作树；recipe/World/Scene2D/后端协议不变，未增加系统注册模块或声明能力。',
        '新增已有片段（含原未使用片段）或复制已有放置均追加一个数组项，分配一次新的placement/全actor/group UUID；定义objectId可复用。',
        '复制原placement CST，仅替换身份值token；保留原offset省略/显式零、六字段局部覆盖/null、顺序、空数组、数值词法和原文格式。',
        '移除一份已有放置及其全部映射/覆盖，允许移除预览选中演员；不能删除最后一份放置。',
        '独立可选placements_version=1和三操作；缺能力只关闭新入口，旧核心/六编辑入口保持。128KiB和完整展开的128演员/组/放置预算继续生效。',
        '纯接口在await前分离输入；宿主重构动作、全部身份与原文补丁，完整候选检查新消费的投影/图片及全部actor/group贡献来源。',
        '独立创作kind=placements与单placement offset编辑分开；各区不互相导入，原文仍只应用内存后普通Save处理持久化和外部冲突。',
        '2744全应用、64新增JS、138共享核心（10新增）、8实际Chrome流程及114桌面/移动prepared标准VM案例分别记录，专项与全量重叠。',
        '新操作只追加/移除整份放置；无重排、片段/组定义结构编辑、空间变换、多文件事务或跨视图统一历史，无安装/设备验收。',
    ],
    'next': '分别定义片段和组织组结构、空间层次及跨视图历史；后续呈现方式消费独立提案与创作接口。',
    'platforms': ['Linux实际HTTP/Chrome中英日390px原文创作', '共享Rust原生/WASM和实际桌面/移动准备副本；非安装或Android设备'],
    'delivery': 'working-tree',
})
atlas['axes']['implementation'].extend([
    {'id': 'i171', 'label': 'placements_patch.rs：独立整份放置CST补丁', 'kind': 'product', 'language': ['Rust'],
     'paths': ['crates/viento-studio-core/src/scene_composition_placements_patch.rs', 'crates/viento-studio-core/src/lib.rs']},
    {'id': 'i172', 'label': 'scene-composition-placements.mjs：纯提案与创作回执', 'kind': 'product', 'language': ['JavaScript'],
     'paths': ['engine/scene-composition-placements.mjs', 'engine/studio-core.mjs', 'engine/scene-authoring-candidate.mjs', 'engine/scene-authoring-workflow.mjs']},
    {'id': 'i173', 'label': '整份放置管理：独立表单、预览连接与原文宿主', 'kind': 'product', 'language': ['JavaScript', 'CSS'],
     'paths': ['web/modules/app-scene-composition-placements.js', 'web/modules/app-scene-authoring.js', 'web/modules/app-scene-preview.js', 'web/modules/app-project-build.js', 'web/modules/app-runtime.js', 'web/project-build.css']},
])
files = [
    ('source', 'crates/viento-studio-core/src/scene_composition_placements_patch.rs'),
    ('source', 'engine/scene-composition-placements.mjs'),
    ('source', 'engine/studio-core.mjs'),
    ('source', 'engine/scene-authoring-workflow.mjs'),
    ('source', 'engine/scene-authoring-candidate.mjs'),
    ('source', 'web/modules/app-scene-composition-placements.js'),
    ('source', 'web/modules/app-scene-authoring.js'),
    ('source', 'web/modules/app-runtime.js'),
    ('test', 'scripts/tests/scene-composition-placements.test.mjs'),
    ('test', 'scripts/tests/studio-core-composition-placements-patch.test.mjs'),
    ('test', 'scripts/tests/scene-composition-placements-ui.test.mjs'),
    ('test', 'scripts/tests/scene-composition-placements-host.test.mjs'),
    ('test', 'scripts/tests/scene-composition-placements-preview.test.mjs'),
    ('test', 'scripts/tests/scene-composition-placements-workflow.test.mjs'),
    ('test', 'scripts/tests/scene-composition-placements-smoke.mjs'),
    ('design', 'docs/SCENE_COMPOSITION.md'),
    ('design', 'docs/SCENE_AUTHORING.md'),
]
files.extend(('report', f'docs/test-results/scene-composition-placement-structure/{name}') for name in [
    'results.json', 'app-check.log', 'core-results.json', 'core-native-test-final.log',
    'core-js-tests-final.log', 'core-regression-final.log', 'web-focused-initial.log',
    'web-regression.log', 'workflow-tests.log', 'review.json', 'final-doc-review.json',
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
        'note': '整份放置独立增量；原文保真/身份/候选/普通保存及初次失败另存，准备副本不提升安装或设备交付。'})
start = max(int(item['id'][1:]) for item in atlas['bindings']) + 1
for index, (architecture, implementation, role, decoupling) in enumerate([
    ('rust-core', 'i171', '严格输入/展开预算及原文CST修改', 4),
    ('semantic-js', 'i172', '来源提案、全身份复核和独立创作回执', 4),
    ('ui', 'i173', '各自表单、目录与完整预览连接', 3),
    ('persistence', 'i173', '原文内存应用及既有普通Save冲突边界', 3),
], start):
    atlas['bindings'].append({'id': f'b{index}', 'architecture': architecture, 'function': feature,
        'implementation': implementation, 'role': role, 'evidence': evidence_ids})
    for maturity, value, reason in [
        ('implementation', 3, '限定整份放置的三种动作接入当前源码；更广泛结构/历史仍另立契约。'),
        ('verification', 3, '全应用、原生/WASM、实际Chrome和prepared纯层分别通过；无安装/设备验收。'),
        ('decoupling', decoupling, '纯核心和提案在不同目标复用；GUI显式各自接口，既有主编辑器和构建区仍有聚合债务。'),
        ('delivery', 2, '当前未发布工作树与资源准备，无版本变更、提交或新安装包。'),
    ]:
        atlas['cells'].append({'coordinates': [architecture, feature, implementation, maturity], 'value': value, 'reason': reason})
for target in ['scene.composition', 'scene.authoring_workflow', 'scene.composition_structure_editor', 'authoring.document-edit', 'studio.system_modules']:
    assert any(item['id'] == target for item in atlas['axes']['function'])
    atlas['dependencies'].append({'from': feature, 'to': target, 'relation': 'requires',
        'reason': '保留原配方格式、来源、稳定身份和普通保存；新能力不授予其他编辑区或运行后端权限。'})
atlas['workflows'].append({'id': 'scene-composition-whole-placement-source',
    'label': '整份放置意图→独立身份→完整候选→原文草稿→普通保存',
    'steps': ['scene.composition', feature, 'scene.authoring_workflow', 'authoring.document-edit'],
    'boundary': '新消费依赖与全actor/group来源验证后只改当前原文内存；最后一份不能移除，旧偏移编辑与执行后端独立。'})
atlas['meta']['scope'] = '0.0.9发布后base9065667新增scene.composition_placements_editor/i171–173与4bindings/16cells；独立整份放置新增/复制/移除，7配方编辑入口。保留既有图谱前缀评分、3012历史证据和39作者文件、4工具。共享核心新增可选能力/WASM；2744全应用、64新JS、138原生、8实际Chrome、114prepared分别记录。7系统module/22声明能力及作者/后端协议未改；无版本/发布/安装/设备交付。'
path.write_text(json.dumps(atlas, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: len(atlas[key]) for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows']}))

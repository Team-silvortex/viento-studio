from pathlib import Path
from datetime import datetime, timezone
import json

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
p = ROOT / 'docs/function-atlas.json'
j = json.loads(p.read_text())
old = json.loads((OUT / 'atlas-baseline.json').read_text())
for k in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows']:
    assert j[k] == old[k], k
assert j['axes'] == old['axes']
feature = 'scene.properties_authoring3d'
j['axes']['function'].append({'id': feature, 'label': '独立3D对象名称与颜色编辑', 'group': '场景与构建',
    'entry': '当前JSON原文→指定稳定UUID与明确名称／颜色→完整候选审阅→原文草稿→普通保存',
    'boundary': ['0.0.10/base3a91e84之后未发布工作树，第十二固定模块、28项声明能力，只依赖文档模块。',
        '名称沿用旧解析规则：1–256个Unicode码点，不trim或规范化空白；颜色六位hex及大小写原样。',
        '原文与完整最终场景各验证一次，只替换净授权字符串值词元；保留全部键、数字、BOM/CRLF、几何与非目标对象。',
        '四种3D提案各有私有冻结品牌，共享五字段来源与宿主等待守护；旧readonly端口保持三字段。',
        '三语表单默认不选字段，原name含CRLF/CR时未编辑选中保留作者原串；完整审阅、取消及失主等待守护独立。',
        'Apply仅修改内存草稿，普通Save保持持久及外部冲突权威；不依赖preview、World、build或其他编辑控制器。',
        '原生/WASM、完整应用、实际Chrome/SwiftShader与prepared纯层分别验证，无新安装或设备验收。'],
    'next': '模型素材、空间层级、材料、多对象事务与gizmo分别定义；属性字段不构成完整材料编辑。',
    'platforms': ['Linux实际HTTP/Chrome三语390px与软件GPU预览', '共享Rust原生/WASM及桌面/移动prepared纯层'], 'delivery': 'working-tree'})
products = [
    ('i199', '3D名称与颜色CST值补丁及完整候选验证', ['Rust'], ['crates/viento-studio-core/src/scene3d_properties_patch.rs', 'crates/viento-studio-core/src/lib.rs']),
    ('i200', '可选属性补丁桥与独立冻结品牌', ['JavaScript'], ['engine/studio-core.mjs', 'engine/scene3d-properties.mjs', 'engine/scene3d-authoring.mjs', 'engine/index.mjs']),
    ('i201', '独立三语对象属性审阅与原名称保留', ['JavaScript', 'CSS'], ['web/modules/app-scene3d-properties.js', 'web/scene3d-properties.css', 'web/i18n/en.js', 'web/i18n/ja.js']),
    ('i202', '文档来源守护与独立属性模块装配', ['JavaScript'], ['web/modules/app-runtime.js', 'web/modules/app-studio-system.js', 'engine/studio-modules.mjs'])]
paths = []
for identity, label, languages, files in products:
    j['axes']['implementation'].append({'id': identity, 'label': label, 'kind': 'product', 'language': languages, 'paths': files})
    for file in files:
        if file not in paths: paths.append(file)
paths += ['scripts/tests/' + file for file in ['studio-core-scene3d-properties.test.mjs', 'scene3d-properties.test.mjs', 'scene3d-property-source-host.test.mjs', 'scene3d-property-system-ports.test.mjs', 'scene3d-properties-ui.test.mjs', 'scene3d-properties-smoke.mjs']]
paths += ['docs/test-results/scene3d-property-authoring/' + file for file in ['baseline.json', 'source-freeze-confirmed.json', 'core-results.json', 'core-document-review.json', 'source-quality-initial.json', 'packaged-resources-confirmed.json', 'review.json', 'preservation-audit-before-cleanup.json', 'results.json', 'cleanup.json', 'application-timing.json', 'atlas-preservation-review.json']]
paths += ['docs/SCENE3D.md', 'engine/README.md', 'docs/STUDIO_MODULES.md']
ids = []
start = max(int(e['id'][1:]) for e in j['evidence']) + 1
for number, file in enumerate(paths, start):
    identity = f'e{number}'; ids.append(identity)
    kind = 'test' if file.startswith('scripts/tests/') else 'report' if file.startswith('docs/test-results/') else 'design' if file.endswith('.md') else 'source'
    j['evidence'].append({'id': identity, 'kind': kind, 'path': file, 'note': '本轮独立3D对象名称/颜色编辑源码与实际验证；历史专题保持其时点，专项和全量不重复加总。'})
start = max(int(b['id'][1:]) for b in j['bindings']) + 1
for number, (architecture, implementation, role) in enumerate([
    ('rust-core', 'i199', 'atomic string-value patch and complete scene validation'),
    ('semantic-js', 'i200', 'private property intent and bound raw string receipt'),
    ('ui', 'i201', 'independent localized property review and original name retention'),
    ('ui', 'i202', 'document-owned guarded unsaved source apply'),
    ('semantic-js', 'i202', 'optional independent authoring property module')], start):
    j['bindings'].append({'id': f'b{number}', 'architecture': architecture, 'function': feature, 'implementation': implementation, 'role': role, 'evidence': ids})
    for dimension, value, reason in [
        ('implementation', 4, '名称与颜色具备完整审阅、草稿应用和普通Save闭环；材料/层级/多对象另列。'),
        ('verification', 3, '实际原生/WASM、全量应用、等待会话守护、三语Chrome与prepared分别绑定；新安装/设备未验。'),
        ('decoupling', 3 if implementation == 'i202' and architecture == 'ui' else 4, 'Rust规则、JS品牌/回执、独立GUI和文档宿主各自拥有职责；正文生命周期仍集中，不共享兄弟控制器。'),
        ('delivery', 2, '0.0.10之后未发布工作树，prepared复制与发布/新安装分别处理。')]:
        j['cells'].append({'coordinates': [architecture, feature, implementation, dimension], 'value': value, 'reason': reason})
for target in ['scene.primitives3d', 'authoring.document-edit', 'studio.system_modules']:
    j['dependencies'].append({'from': feature, 'to': target, 'relation': 'requires', 'reason': '只依赖严格3D原文、文档草稿/Save与系统装配，不依赖preview、World、build及其他创作控制器。'})
j['workflows'].append({'id': 'scene3d-properties-source-authoring', 'label': '对象属性→完整最终候选→原文草稿→普通保存', 'steps': ['authoring.document-edit', 'studio.system_modules', 'scene.primitives3d', feature], 'boundary': '只替换指定稳定实例的净字符串值词元；字段审批不共享，普通Save保持磁盘持久和外部冲突权威。'})
j['meta']['scope'] = '0.0.10/base3a91e84之后工作树新增独立3D名称/颜色编辑：87功能/202实现/336绑定/1344单元，12模块/28能力；旧86/198/331/1324全部评分和理由及历史前缀保持。本轮原文补丁、品牌、GUI/宿主/Save、浏览器与prepared分别绑定，无新安装和设备验收。此前时点：' + j['meta']['scope']
p.write_text(json.dumps(j, ensure_ascii=False, indent=2) + '\n')
report = {'createdAt': datetime.now(timezone.utc).isoformat(), 'ok': True, 'oldAxesBindingsCellsEvidenceDependenciesWorkflowsPrefixExact': True, 'oldScoresAndReasonsExact': True,
    'added': {'function': 1, 'implementation': 4, 'bindings': 5, 'cells': 20, 'dependencies': 3, 'workflows': 1, 'evidence': len(ids)},
    'counts': {'axes': {k: len(v) for k, v in j['axes'].items()}, **{k: len(j[k]) for k in ['bindings', 'cells', 'dependencies', 'workflows', 'evidence']}},
    'scope': 'Append-only independent object properties feature. Conservative unreleased delivery2/verification3, actual fresh evidence separately linked.'}
(OUT / 'atlas-preservation-review.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report['counts']))

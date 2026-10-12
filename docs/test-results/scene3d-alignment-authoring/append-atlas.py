from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
p = ROOT / 'docs/function-atlas.json'
data = json.loads(p.read_text())
old = json.loads((OUT / 'atlas-baseline.json').read_text())
assert data['axes'] == old['axes']
for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']:
    assert data[key] == old[key], key
assert data['sourceSnapshot'] == old['sourceSnapshot']
assert data['meta']['historicalSha256'] == old['meta']['historicalSha256']
result = json.loads((OUT / 'results.json').read_text())
assert result['ok'] and result['status'] == 'stage-tested-awaiting-actual-checkout-apply'
assert result['fullApplication']['counts']['pass'] == 3593 and result['prepared']['groups'] == 330
assert result['browserFlowTotals'] == {'new': 8, 'legacy': 25, 'scope': 'Distinct actual reported flow counts; not additive test coverage.'}
with (OUT / 'atlas-source-snapshot-before.json').open('x') as stream:
    stream.write(json.dumps(old['sourceSnapshot'], ensure_ascii=False, indent=2) + '\n')
feature = 'scene.alignment_authoring3d'
data['axes']['function'].append({
    'id': feature, 'label': '3D多对象参照轴位置对齐', 'group': '场景与构建',
    'entry': '独立多选／所选参照／世界轴→Rust原子位置词元补丁→完整审阅→当前原文草稿→普通保存',
    'boundary': [
        '0.0.10之后未发布增量；十四固定模块／30声明能力，作者schema、预览渲染、后端及原五创作域保持。',
        '2–128个现有不同小写UUID，参照必须由用户明确指定且属于所选；axis只接受作者世界x/y/z。',
        '直接设置为原参照对象该轴position坐标，不做差值累加、AABB、旋转包围盒、表面或视角对齐；不改其他轴、尺寸、旋转或身份。',
        '同份原model/CST合并净变化位置数字词元，完整原文与最终原文各≤128KiB；目标／路径按sourceorder，不净变的指数／负零词元保持。',
        '独立可选ABI仅依赖parse；第六私有提案品牌与五字段来源、完整before/afterObjects绑定；克隆及原五域提案不能借用审批。',
        '独立UI不借预览选择或相机；检索保持隐藏目标／明确参照，撤销参照不会自动重选，原文／表单／query／关闭／owner变更撤销approval。',
        '异步摘要前捕获来源与意图，宿主重核会话与整份候选并仅一次写内存；普通Save继续拥有磁盘、基线和冲突权威。',
        '本轮全应用／native／WASM／prepared／真实Chrome分证，实际测试在隔离副本及临时作品执行；源码写回另由具体审阅记录确认，不提高安装／设备成熟度。',
        '标准VM无Node/DOM/fetch/process，只取得注入DTO/hash与fakeGL端口；Chrome为SwiftShader软件WebGL，不作硬件GPU、Android或已安装版验收。'
    ],
    'next': '旋转包围盒／表面对齐、批量复制、空间层级、模型素材、gizmo与统一历史仍分别设计，不以位置坐标对齐冒充几何布局。',
    'platforms': ['Linux隔离副本实际HTTP/Chrome三语390px与SwiftShader', 'desktop/mobile prepared标准VM与注入端口'],
    'delivery': 'working-tree'
})
units = [
    ('rust-core', '明确所选参照的原子世界轴位置数字补丁', 'Rust', ['crates/viento-studio-core/src/scene3d_alignment_patch.rs', 'crates/viento-studio-core/src/lib.rs']),
    ('semantic-js', '独立alignment可选桥接与完整位置词元回执见证', 'JavaScript', ['engine/studio-core.mjs']),
    ('semantic-js', '第六私有对齐提案与五字段来源摘要准备', 'JavaScript', ['engine/scene3d-alignment.mjs', 'engine/index.mjs']),
    ('ui', '独立多选参照轴表单与三语完整候选审批', 'JavaScript', ['web/modules/app-scene3d-alignment.js', 'web/scene3d-alignment.css', 'web/i18n/en.js', 'web/i18n/ja.js']),
    ('ui', '第十四模块明确来源端口与最后整份草稿守护', 'JavaScript', ['engine/studio-modules.mjs', 'web/modules/app-studio-system.js', 'web/modules/app-runtime.js'])
]
start = max(int(row['id'][1:]) for row in data['axes']['implementation']) + 1
paths, bound = [], []
for number, (arch, label, language, files) in enumerate(units, start):
    ident = f'i{number}'
    data['axes']['implementation'].append({'id': ident, 'label': label, 'kind': 'product', 'language': [language], 'paths': files})
    paths += files
    bound.append((arch, ident))
paths += ['scripts/tests/' + name for name in ['studio-core-scene3d-alignment.test.mjs', 'scene3d-alignment.test.mjs', 'scene3d-alignment-ui.test.mjs', 'scene3d-alignment-source-host.test.mjs', 'scene3d-alignment-system-ports.test.mjs', 'scene3d-alignment-smoke.mjs']]
paths += ['docs/SCENE3D.md', 'engine/README.md', 'docs/STUDIO_MODULES.md', 'docs/STATUS.md']
paths += ['docs/test-results/scene3d-alignment-authoring/' + name for name in [
    'baseline.json', 'source-hashes-browser-final.json', 'source-phase-confirmation.json',
    'core-results.json', 'quality-initial.json', 'ui-quality-initial.json', 'web-validation.json',
    'web-legacy-addendum.json', 'visual-review-web.json', 'visual-review-independent.json',
    'packaged-resources-browser-final.json', 'prepared-final-binding.json', 'prepared-confirmation-browser-final.json',
    'stage-review.json', 'stage-preservation.json', 'results.json', 'application-timing.json',
    'implementation-ready.json', 'application-check-confirmed.log', 'core-native-tests-confirmed.log',
    'core-bridge-initial.log', 'core-proposal-initial.log', 'core-regression.log', 'ui-and-i18n-confirmed.log',
    'host-tests-initial.log', 'module-tests-isolation-diagnostic.log'
]]
paths = list(dict.fromkeys(paths))
ids, start = [], max(int(row['id'][1:]) for row in data['evidence']) + 1
for number, path in enumerate(paths, start):
    assert (ROOT / path).is_file(), path
    ident = f'e{number}'
    kind = 'test' if path.startswith('scripts/tests/') else 'report' if path.startswith('docs/test-results/') else 'design' if path.endswith('.md') else 'source'
    data['evidence'].append({'id': ident, 'kind': kind, 'path': path,
        'note': '当前3D参照世界轴位置对齐的隔离源码／完整候选审批／普通Save及full/native/copied/browser证据；各执行时点与初始工具／测试夹具记录保持。旧评分和历史前缀不改，具体源码写回另确认，不提升安装或设备交付。'})
    ids.append(ident)
start = max(int(row['id'][1:]) for row in data['bindings']) + 1
for number, (arch, ident) in enumerate(bound, start):
    data['bindings'].append({'id': f'b{number}', 'architecture': arch, 'function': feature, 'implementation': ident,
        'role': 'Independent native position semantics, optional accessor-safe receipt bridge, sixth private proposal, explicit UI or guarded source-host port. Authored world-axis reference only; no renderer, bounding-box, backend or Save grant.', 'evidence': ids})
    for dim, score, reason in [
        ('implementation', 4, '明确所选参照的有界位置对齐在隔离副本形成Rust→完整候选→草稿→普通保存闭环；包围盒、层级、gizmo与统一历史仍待设计。'),
        ('verification', 3, '实际隔离HTTP/Chrome、3593应用、258Rust、native/WASM、独立来源／owner与330prepared分证；非已安装／设备／硬件GPU验收。'),
        ('decoupling', 3, 'Rust持有原子位置语义，桥／第六私有提案独立；新模块仅文档端口，预览／原五表单／后端不授予权限，共享宿主文本架构仍保留。'),
        ('delivery', 2, '0.0.10之后未发布增量及隔离准备副本；具体实际源码写回另记录，无新commit/push/安装或平台交付。')
    ]:
        data['cells'].append({'coordinates': [arch, feature, ident, dim], 'value': score, 'reason': reason})
for target in ['scene.primitives3d', 'authoring.document-edit', 'studio.system_modules']:
    data['dependencies'].append({'from': feature, 'to': target, 'relation': 'requires',
        'reason': '复用严格3D解析、普通作者文档来源与独立模块装配；不依赖原五创作表单、渲染／预览选择、AABB或执行后端。'})
data['workflows'].append({'id': 'scene3d-alignment-authoring', 'label': '显式多选／参照／世界轴→原子位置检查→完整审阅→一次内存应用→普通保存／冲突',
    'steps': ['authoring.document-edit', 'studio.system_modules', 'scene.primitives3d', feature],
    'boundary': '独立选择和第六私有品牌，原参照坐标只作用于所选position轴；来源和owner并发只允许赢家写一次完整草稿，磁盘仍普通Save。'})
data['meta']['date'] = '2026-10-12'
data['meta']['scope'] = '追加独立3D参照世界轴位置对齐；92功能/221实现/355绑定/1420单元，十四模块／30能力。0.0.10后未发布增量，实际测试在隔离副本执行；原作者schema、渲染、后端与五域保持，具体源码写回另确认，安装／设备交付不提高。此前时点：' + data['meta']['scope']
assert data['meta']['historicalSha256'] == old['meta']['historicalSha256']
assert data['sourceSnapshot'] == old['sourceSnapshot']
for axis in old['axes']:
    assert data['axes'][axis][:len(old['axes'][axis])] == old['axes'][axis], axis
for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']:
    assert data[key][:len(old[key])] == old[key], key
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
counts = {'axes': {key: len(value) for key, value in data['axes'].items()}, **{key: len(data[key]) for key in ['bindings', 'cells', 'dependencies', 'workflows', 'evidence']}}
with (OUT / 'atlas-append-receipt.json').open('x') as stream:
    json.dump({'ok': True, 'createdAt': datetime.now(timezone.utc).isoformat(), 'oldPrefixesAndScoresExact': True,
        'added': {'function': 1, 'implementation': 5, 'bindings': 5, 'cells': 20, 'dependencies': 3, 'workflows': 1, 'evidence': len(ids)}, 'counts': counts,
        'futureClosingEvidenceReferenced': False, 'snapshotPreservation': 'Original complete1277 map retained in baseline and atlas-source-snapshot-before. Current-source refresh follows separately; historical metadata remains unchanged.'}, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
print(json.dumps(counts))

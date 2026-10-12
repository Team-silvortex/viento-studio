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
assert result['fullApplication']['counts']['pass'] == 3671 and result['prepared']['groups'] == 346
assert result['browserFlowTotals'] == {'new': 8, 'legacy': 33, 'scope': 'Distinct actual reported flow counts; not additive test coverage.'}
with (OUT / 'atlas-source-snapshot-before.json').open('x') as stream:
    stream.write(json.dumps(old['sourceSnapshot'], ensure_ascii=False, indent=2) + '\n')
feature = 'scene.distribution_authoring3d'
data['axes']['function'].append({
    'id': feature, 'label': '3D多对象单轴位置等距分布', 'group': '场景与构建',
    'entry': '独立多选／作者世界轴→原坐标排序与固定两端→Rust原子位置词元补丁→完整审阅→当前原文草稿→普通保存',
    'boundary': [
        '0.0.10之后未发布增量；十五固定模块／31声明能力，作者schema、预览渲染、后端及原六创作域保持。',
        '显式选择3–128个不同现有小写UUID，axis只接受作者世界x/y/z；原轴坐标数值升序，重合坐标包括±0均以原声明顺序打破平局。',
        '两端保留原坐标与原数字词元；中间位置严格按binary64 start+(end-start)*(i/(n-1))先比例、乘跨度、再加起点，不作AABB、尺寸、表面、屏幕或透视分布。',
        '零跨度合法原文无净变化；正跨度完整计算序列包括两端必须有限、在position边界内且严格递增，精度不足整批拒绝，不把折叠或重叠默认为成功。',
        '一份原model/CST合并所有净变化位置数字词元，完整原文与最终候选各≤128KiB；instanceIds及净路径按sourceorder，orderedInstanceIds另表原数值排序；其他轴、UUID、旋转、尺寸、环境和词法保持。',
        '独立可选ABI只依赖parse；第七私有品牌与五字段来源及完整before/afterObjects绑定；六个原域品牌和克隆不能借用审批。',
        '独立UI不借预览选择或临时相机；检索保持隐藏目标，不在UI计算分布；表单、query、原文、归属、旧行事件和关闭改变撤销approval，异步摘要前捕获全部来源。',
        '宿主重核会话与整份候选，仅一次写内存草稿；普通Save仍掌管磁盘、基线及外部冲突，原世界查询及后端不授予新编辑权。',
        '本轮full/native/WASM/copied/实际Chrome分别记录，测试在隔离副本及临时作品执行；实际源码写回由独立记录确认，无新commit/push/安装或设备交付。',
        '标准VM无Node/DOM/fetch/process，只有显式DTO/hash/fakeGL端口；Chrome使用SwiftShader软件WebGL，不宣称Android或硬件GPU验收。'
    ],
    'next': '批量复制、几何包围盒布局、空间层级、模型素材、gizmo和跨视图统一历史仍需分别设计，不以作者位置等距分布代替。',
    'platforms': ['Linux隔离副本实际HTTP/Chrome三语390px与SwiftShader', 'desktop/mobile prepared标准VM与注入端口'],
    'delivery': 'working-tree'
})
units = [
    ('rust-core', '固定两端并验证精度的原子等距位置数字补丁', 'Rust', ['crates/viento-studio-core/src/scene3d_distribution_patch.rs', 'crates/viento-studio-core/src/lib.rs']),
    ('semantic-js', '独立distribution可选桥接与双顺序完整词元回执见证', 'JavaScript', ['engine/studio-core.mjs']),
    ('semantic-js', '第七私有分布提案与五字段来源摘要准备', 'JavaScript', ['engine/scene3d-distribution.mjs', 'engine/index.mjs']),
    ('ui', '独立多选世界轴表单与原生排序三语候选审批', 'JavaScript', ['web/modules/app-scene3d-distribution.js', 'web/scene3d-distribution.css', 'web/i18n/en.js', 'web/i18n/ja.js']),
    ('ui', '第十五模块明确来源端口与最后整份草稿守护', 'JavaScript', ['engine/studio-modules.mjs', 'web/modules/app-studio-system.js', 'web/modules/app-runtime.js'])
]
start = max(int(row['id'][1:]) for row in data['axes']['implementation']) + 1
paths, bound = [], []
for number, (arch, label, language, files) in enumerate(units, start):
    ident = f'i{number}'
    data['axes']['implementation'].append({'id': ident, 'label': label, 'kind': 'product', 'language': [language], 'paths': files})
    paths += files
    bound.append((arch, ident))
paths += ['scripts/tests/' + name for name in ['studio-core-scene3d-distribution.test.mjs', 'scene3d-distribution.test.mjs', 'scene3d-distribution-ui.test.mjs', 'scene3d-distribution-source-host.test.mjs', 'scene3d-distribution-system-ports.test.mjs', 'scene3d-distribution-smoke.mjs']]
paths += ['docs/SCENE3D.md', 'engine/README.md', 'docs/STUDIO_MODULES.md', 'docs/STATUS.md']
paths += ['docs/test-results/scene3d-distribution-authoring/' + name for name in [
    'baseline.json', 'source-hashes-final.json', 'source-freeze-final.json', 'core-build-freeze.json',
    'core-results.json', 'quality-initial.json', 'ui-quality-initial.json', 'web-validation.json',
    'web-legacy-addendum.json', 'visual-review-web.json', 'visual-review-independent.json',
    'packaged-resources.json', 'prepared-final-binding.json', 'stage-review.json', 'stage-preservation.json',
    'results.json', 'application-timing.json', 'implementation-ready.json', 'application-check.log',
    'core-native-tests-confirmed.log', 'core-native-tests-initial.log', 'initial-producer/scene3d_distribution_patch.rs',
    'core-js-tests-initial.log', 'core-regression.log', 'ui-and-i18n-confirmed.log', 'host-tests.log', 'module-tests.log'
]]
paths = list(dict.fromkeys(paths))
ids, start = [], max(int(row['id'][1:]) for row in data['evidence']) + 1
for number, path in enumerate(paths, start):
    assert (ROOT / path).is_file(), path
    ident = f'e{number}'
    kind = 'test' if path.startswith('scripts/tests/') else 'report' if path.startswith('docs/test-results/') else 'design' if path.endswith('.md') else 'source'
    data['evidence'].append({'id': ident, 'kind': kind, 'path': path,
        'note': '当前3D固定两端单轴位置等距分布的隔离源码／完整候选审批／普通Save及full/native/copied/browser分证；初次两处NEW Rust测试夹具失败及后续原断言边界保持。旧评分和历史前缀不改，源码写回另确认，不提高安装或设备交付。'})
    ids.append(ident)
start = max(int(row['id'][1:]) for row in data['bindings']) + 1
for number, (arch, ident) in enumerate(bound, start):
    data['bindings'].append({'id': f'b{number}', 'architecture': arch, 'function': feature, 'implementation': ident,
        'role': 'Independent native equal-gap position semantics, strict binary64 representability and fixed endpoints, optional complete receipt bridge, seventh private proposal, explicit UI or guarded source-host port. No geometry, renderer, backend or Save grant.', 'evidence': ids})
    for dim, score, reason in [
        ('implementation', 4, '有界单轴等距位置分布在隔离副本形成Rust→完整候选→草稿→普通Save闭环；固定两端与严格浮点递增保证，包围盒／层级／gizmo／统一历史仍待设计。'),
        ('verification', 3, '隔离实际HTTP/Chrome41流程、3671应用、274Rust、native/WASM回执、独立来源／owner与346prepared分证；非已安装／设备／硬件GPU验收。'),
        ('decoupling', 3, 'Rust持有原子位置语义，桥及第七私有品牌独立；新模块仅文档端口，预览／原六表单／后端不授予权限，共享宿主文本架构仍保持。'),
        ('delivery', 2, '0.0.10之后未发布增量及隔离准备副本；具体源码写回另记录，无新commit/push/安装或平台交付。')
    ]:
        data['cells'].append({'coordinates': [arch, feature, ident, dim], 'value': score, 'reason': reason})
for target in ['scene.primitives3d', 'authoring.document-edit', 'studio.system_modules']:
    data['dependencies'].append({'from': feature, 'to': target, 'relation': 'requires',
        'reason': '复用严格3D解析、普通作者文档来源和独立模块装配；不依赖原六创作表单、预览选择／视角、几何包围盒或执行后端。'})
data['workflows'].append({'id': 'scene3d-distribution-authoring', 'label': '独立多选／世界轴→原坐标排序固定两端→原子位置检查→完整审阅→一次内存应用→普通保存／冲突',
    'steps': ['authoring.document-edit', 'studio.system_modules', 'scene.primitives3d', feature],
    'boundary': '独立选择与第七私有品牌，只改中间对象所选position轴；两端词元保持，非零跨度不足严格精度整批拒绝，来源与owner守护只允许一次完整草稿，磁盘仍普通Save。'})
data['meta']['date'] = '2026-10-12'
data['meta']['scope'] = '追加独立3D固定两端单轴位置等距分布；93功能/226实现/360绑定/1440单元，十五模块／31能力。0.0.10后未发布增量，实际测试在隔离副本执行；原作者schema、渲染、后端与六域保持，具体源码写回另确认，安装／设备交付不提高。此前时点：' + data['meta']['scope']
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
        'futureClosingEvidenceReferenced': False, 'snapshotPreservation': 'Original complete1313-entry sourceSnapshot retained in atlas-baseline.json and atlas-source-snapshot-before.json. Current source refresh follows separately; old historical evidence hashes and metadata stay byte-identical.'}, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
print(json.dumps(counts))

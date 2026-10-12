from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
p = ROOT / 'docs/function-atlas.json'
data = json.loads(p.read_text())
old = json.loads((OUT / 'atlas-baseline.json').read_text())
core = json.loads((OUT / 'core-results.json').read_text())
assert core['status'] == 'passed' and core['productFrozen'] is True
assert core['nativeRust']['pass'] == 307 and core['nativeRust']['newRemovalUnitTests'] == 17
assert sum(row['pass'] for row in core['newJavaScript'].values()) == 24
assert core['oldJavaScriptRegression']['pass'] == 245
assert core['capability']['brandRejectionDirections'] == 16
assert core['capability']['rawCliWasmParityVectors'] == 30
assert core['wasm']['buildCount'] == 1 and core['wasm']['predecessorEightAuthorDomainsVerified'] is True
assert data == old, 'Append starts from the untouched current atlas baseline.'
for rel, info in core['freeze'].items():
    assert hashlib.sha256((ROOT / rel).read_bytes()).hexdigest() == info['sha256'], rel
feature = 'scene.removal_authoring3d'
assert feature not in {row['id'] for row in data['axes']['function']}
prepared = json.loads((OUT / 'prepared-binding.json').read_text())
independent = json.loads((OUT / 'independent-review.json').read_text())
assert prepared['ok'] and prepared['cases'] == 378 and prepared['previousCaseReceiptsDeepExact']
assert independent['ok'] and independent['passed'] == 16 and independent['failed'] == 0
with (OUT / 'atlas-source-snapshot-before.json').open('x') as f:
    json.dump(old['sourceSnapshot'], f, ensure_ascii=False, indent=2)
    f.write('\n')

data['axes']['function'].append({
    'id': feature,
    'label': '3D多对象原文保真原子批量移除',
    'group': '场景与构建',
    'entry': '显式来源选择→Rust一次原子移除→待删除与全部保留声明审阅→当前原文草稿→普通保存／冲突',
    'boundary': [
        '0.0.10之后未发布增量；十七固定模块／33声明能力。严格3D作者schema、旧八创作域、只读预览和后端语义保持。',
        '精确四字段请求 scene3d.removeObjects；选择1–128个不同现有小写UUID，必须至少保留一个对象，实际最大成功移除127。全选、重复、未知或空选择整批拒绝，不截断选择。',
        '完整原文解析和128KiB／128对象预算优先于移除意图；删除无效对象不能修复无效原文，超预算来源不能靠删除绕过预算。',
        '复用原CST连续run分隔符切除，一组原区间、一次拼接、一次完整最终解析；保留声明及原文区间外字节不变，幸存对象顺序、身份、名称、变换、颜色和场景环境保持。',
        '独立可选ABI viento_core_scene3d_removal_version v1；四字段回执规范instanceIds按原声明顺序，changedPaths用原objects索引，而非删除后索引。',
        '桥接以原生model和UTF16 sourceLocations独立复现原文删除区间，要求完整afterContent相等，再要求完整过滤后model相等；无需引入新JSON作者语义解析器。',
        '第九WeakSet私有品牌与精确十一字段深冻结提案；五字段来源在异步摘要前捕获，摘要后重算完整候选。旧八品牌十六方向及序列化克隆不能借用移除审批。',
        '独立document来源端口只改草稿，默认不选择；查询只过滤列表，隐藏已选对象仍参与。全选保留完整选择并解释必须保留一对象，raw checkbox/query/source与旧行变化撤销审批。',
        '已记录307 Rust（新17）、新增桥接与纯提案24、旧核心作者245、30 CLI／WASM向量、独立16及准备副本378项。HTTP／Chrome报告按各自来源SHA和当轮流程判定；最终来源刷新与全链复验由收尾记录，不把准备副本或软件GPU当成安装／设备验收。'
    ],
    'next': '包围盒布局、层级、模型资源、gizmo和跨视图统一历史需分别设计。',
    'platforms': ['Linux隔离HTTP／Chrome三语390px与软件WebGL实测', 'desktop／mobile准备副本标准VM'],
    'delivery': 'working-tree'
})
units = [
    ('rust-core', '原CST连续run原子移除与完整来源预算', 'Rust', ['crates/viento-studio-core/src/scene3d_removal_patch.rs', 'crates/viento-studio-core/src/lib.rs']),
    ('semantic-js', '独立removal桥接与UTF16完整切除回执见证', 'JavaScript', ['engine/studio-core.mjs']),
    ('semantic-js', '第九私有移除提案与五字段摘要重算守护', 'JavaScript', ['engine/scene3d-removal.mjs', 'engine/index.mjs']),
    ('ui', '显式选择、保留对象数量与三语移除完整审阅', 'JavaScript', ['web/modules/app-scene3d-removal.js', 'web/scene3d-removal.css', 'web/i18n/en.js', 'web/i18n/ja.js']),
    ('ui', '第十七模块独立来源与当前草稿最终归属守护', 'JavaScript', ['engine/studio-modules.mjs', 'web/modules/app-studio-system.js', 'web/modules/app-runtime.js'])
]
paths = []
bound = []
start = max(int(row['id'][1:]) for row in data['axes']['implementation']) + 1
for n, (arch, label, language, files) in enumerate(units, start):
    identity = f'i{n}'
    data['axes']['implementation'].append({'id': identity, 'label': label, 'kind': 'product', 'language': [language], 'paths': files})
    paths += files
    bound.append((arch, identity))
paths += ['scripts/tests/' + name for name in [
    'studio-core-scene3d-removal.test.mjs', 'scene3d-removal.test.mjs', 'scene3d-removal-ui.test.mjs',
    'scene3d-removal-source-host.test.mjs', 'scene3d-removal-system-ports.test.mjs', 'scene3d-removal-smoke.mjs'
]]
paths += ['docs/test-results/scene3d-removal-authoring/' + name for name in [
    'baseline.json', 'core-results.json', 'core-fmt-initial.log', 'core-fmt.log', 'core-test.log',
    'core-clippy.log', 'core-cli-build.log', 'core-wasm-build.log', 'core-bridge.log', 'core-proposal.log',
    'core-old-authors.json', 'core-old-authors.log', 'previous-studio-core.wasm', 'previous-studio-core.build.json',
    'module-tests.log', 'host-tests.log', 'ui-tests-confirmed.log', 'application-checks.log',
    'application-environment-correction.json', 'native-cli-path-binding.json', 'prepared-binding.json',
    'packaged-resources.json', 'independent-review.mjs', 'independent-review.json', 'portable-removal-cases.mjs',
    'prepared-check.mjs', 'prepared-check.log', 'browser-removal/browser.json', 'browser-copy/browser.json',
    'browser-objects/browser.json', 'browser-preview/browser.json'
]]
ids = []
start = max(int(row['id'][1:]) for row in data['evidence']) + 1
for n, relative in enumerate(dict.fromkeys(paths), start):
    assert (ROOT / relative).is_file(), relative
    identity = f'e{n}'
    kind = 'test' if relative.startswith('scripts/tests/') else 'report' if relative.startswith('docs/test-results/') else 'source'
    data['evidence'].append({'id': identity, 'kind': kind, 'path': relative, 'note': '独立3D原子批量移除源码及已存在验证证据；回执／私牌／普通Save／native／准备副本／浏览器各按当轮来源和执行范围分证。旧评分与历史前缀不变，当前来源刷新和实际工程应用另记。'})
    ids.append(identity)
scores = [
    ('implementation', 4, '有界显式UUID批量移除形成Rust原CST一次切除→完整删除／保留声明审阅→当前草稿→普通Save闭环；层级、gizmo与统一历史仍待设计。'),
    ('verification', 3, '已有307 Rust、24新桥／纯提案、245旧作者回归、30 native／WASM向量、16独立案例和378准备副本分证；HTTP报告各自绑定当轮来源，最终收尾复验另记，非安装／设备／硬件GPU验收。'),
    ('decoupling', 3, 'Rust持有原文保真移除和预算语义，桥与第九私有品牌独立；第十七模块只接document来源端口，旧八作者域、只读选择与后端无权限互借。'),
    ('delivery', 2, '0.0.10之后未发布增量；当前仅隔离副本可审阅实现，实际工程写回另确认，没有新提交、安装或设备交付。')
]
start = max(int(row['id'][1:]) for row in data['bindings']) + 1
for n, (arch, identity) in enumerate(bound, start):
    data['bindings'].append({'id': f'b{n}', 'architecture': arch, 'function': feature, 'implementation': identity,
        'role': 'Independent atomic CST removal, exact UTF16 complete-cut receipt bridge, ninth private proposal, explicit survivor-aware UI or guarded source-host port. No renderer/backend/Save grant.', 'evidence': ids})
    for dimension, score, reason in scores:
        data['cells'].append({'coordinates': [arch, feature, identity, dimension], 'value': score, 'reason': reason})
for target in ['scene.primitives3d', 'authoring.document-edit', 'studio.system_modules']:
    data['dependencies'].append({'from': feature, 'to': target, 'relation': 'requires', 'reason': '复用严格3D解析、普通文档来源与独立模块装配，不依赖旧八作者表单、只读预览选择或执行后端。'})
data['workflows'].append({'id': 'scene3d-removal-authoring', 'label': '显式来源选择→整批移除检查→删除／保留声明与完整原文审阅→一次草稿应用→普通保存／冲突',
    'steps': ['authoring.document-edit', 'studio.system_modules', 'scene.primitives3d', feature],
    'boundary': '至少保留一个对象；全选、重复、未知或空选择整批拒绝。删除路径沿用原声明索引，保留声明与区间外字节不变；来源归属与私牌守护只授权草稿。'})
data['meta']['date'] = '2026-10-12'
data['meta']['scope'] = '追加独立3D原文保真原子批量移除；95功能／236实现／370绑定／1480单元，十七模块／33能力。未发布0.0.10后增量，仅隔离副本与已有验证分证；来源刷新及实际应用另记，安装／设备评分不提高。此前时点：' + old['meta']['scope']
assert data['sourceSnapshot'] == old['sourceSnapshot']
assert data['meta']['historicalSha256'] == old['meta']['historicalSha256']
for key, values in old['axes'].items():
    assert data['axes'][key][:len(values)] == values
for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']:
    assert data[key][:len(old[key])] == old[key]
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
counts = {'axes': {key: len(values) for key, values in data['axes'].items()}, **{key: len(data[key]) for key in ['bindings', 'cells', 'dependencies', 'workflows', 'evidence']}}
receipt = {'ok': True, 'createdAt': datetime.now(timezone.utc).isoformat(), 'feature': feature, 'oldPrefixesAndScoresExact': True,
    'added': {'function': 1, 'implementation': 5, 'bindings': 5, 'cells': 20, 'dependencies': 3, 'workflows': 1, 'evidence': len(ids)},
    'counts': counts, 'futureClosingEvidenceReferenced': False, 'sourceRefreshDeferred': True,
    'snapshotPreservation': 'Original complete sourceSnapshot preserved separately and unchanged in atlas JSON. Refresh sources and generate views only after final product/document freeze.',
    'modifiedFiles': ['docs/function-atlas.json', 'docs/test-results/scene3d-removal-authoring/append-atlas.py', 'docs/test-results/scene3d-removal-authoring/atlas-source-snapshot-before.json', 'docs/test-results/scene3d-removal-authoring/atlas-append-receipt.json']}
with (OUT / 'atlas-append-receipt.json').open('x') as f:
    json.dump(receipt, f, ensure_ascii=False, indent=2)
    f.write('\n')
print(json.dumps(counts))

from pathlib import Path
from datetime import datetime, timezone
import json

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
path = ROOT / 'docs/function-atlas.json'
data = json.loads(path.read_text())
old = json.loads((OUT / 'atlas-baseline.json').read_text())
assert data['axes'] == old['axes']
for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']:
    assert data[key] == old[key], key

feature = 'scene.selection_feedback3d'
data['axes']['function'].append({
    'id': feature, 'label': '3D稳定选择的实体边缘反馈', 'group': '场景与构建',
    'entry': '列表／画布稳定UUID→只读临时选择→原实体同pass边带→原遮挡／裁剪→明确双击临时聚焦',
    'boundary': [
        '0.0.10之后未发布视图增量；十二模块／28声明能力、原文作者格式、Rust／WASM、宿主和后端保持。',
        '原实体片元着色通过局部面坐标和导数辨识真实边缘；双tone不修改作者颜色或几何。',
        '单一原实体pass，Float32矩阵、LEQUAL深度和声明顺序保持；没有对角线、裁剪cap、膨胀几何或透视通道。',
        '几何完全一致的私有反馈重绘保留tap.frame，普通重绘、模型、相机、尺寸和分配变化仍撤销旧资格。',
        '独立GUI selected仍为唯一选择事实源；可选setter仅消费UUID/null，重复值不重绘，不取得写入或Save资格。',
        '过滤、Reset、lastvalid画面保持选择；刷新重排／删除身份按原选择守护，原文定位仍须完整来源一致。',
        '相关442/renderer67/UI196/独立23/portable298与真实Chrome33分别记录，重叠计数不相加。',
        '首次浏览器近裁剪错误属于producer假设，初败与完整脚本保持；最终两harness变化由source phase明确绑定。',
        '导数线宽近似；极细几何不保证内部可辨，隐藏对象通过列表／声明／聚焦确认；不宣称像素ID、安装或设备验收。',
    ],
    'next': '空间结构、模型素材与作者批次继续各自推进；本反馈不构成gizmo、层级、材质或统一场景事务。',
    'platforms': ['Linux实际HTTP/Chrome中英日390px与SwiftShader', '桌面／移动prepared实际copiedrenderer＋注入GLspy'],
    'delivery': 'working-tree',
})
units = [
    ('i210', '原实体单pass视觉选择及几何帧守护', ['web/modules/scene3d-renderer.js']),
    ('i211', '独立预览的稳定选择反馈同步与三语说明', ['web/modules/app-scene3d-preview.js', 'web/i18n/en.js', 'web/i18n/ja.js']),
]
paths = []
for ident, label, files in units:
    data['axes']['implementation'].append({'id': ident, 'label': label, 'kind': 'product', 'language': ['JavaScript'], 'paths': files})
    paths.extend(files)
paths += ['scripts/tests/' + name for name in ['scene3d-renderer.test.mjs', 'scene3d-preview-ui.test.mjs',
    'scene3d-selection-smoke.mjs', 'scene3d-picking-smoke.mjs', 'scene3d-navigation-smoke.mjs']]
paths += ['docs/SCENE3D.md', 'engine/README.md', 'docs/STUDIO_MODULES.md']
paths += ['docs/test-results/scene3d-selection-feedback/' + name for name in [
    'baseline.json', 'source-freeze-confirmed.json', 'source-phase-confirmation.json', 'renderer-results.json',
    'quality-initial.json', 'web-validation.json', 'packaged-resources.json', 'prepared-confirmation.json',
    'review.json', 'preservation-audit-before-cleanup.json', 'results.json', 'cleanup.json',
    'application-timing.json', 'atlas-preservation-review.json',
]]
ids = []
start = max(int(e['id'][1:]) for e in data['evidence']) + 1
for n, name in enumerate(paths, start):
    if not name.endswith('/atlas-preservation-review.json'):
        assert (ROOT / name).is_file(), name
    ident = f'e{n}'
    kind = 'test' if name.startswith('scripts/tests/') else 'report' if name.startswith('docs/test-results/') else 'design' if name.endswith('.md') else 'source'
    data['evidence'].append({'id': ident, 'kind': kind, 'path': name,
        'note': '当前稳定选择视觉反馈的源码、实测与source phase；原几何深度与作者字节保持，先前full/Rust与初败保持其真实时点。'})
    ids.append(ident)
start = max(int(b['id'][1:]) for b in data['bindings']) + 1
for n, (ident, _, _) in enumerate(units, start):
    data['bindings'].append({'id': f'b{n}', 'architecture': 'ui', 'function': feature, 'implementation': ident,
        'role': 'Renderer-owned display feedback and private geometric frame identity, or independent model-owned selection synchronization; no semantic or source-writing grant.', 'evidence': ids})
    for dimension, score, reason in [
        ('implementation', 4, '有界方块选择反馈、遮挡和原生双击形成所声明闭环；空间树、材质、gizmo和作者批次不在范围。'),
        ('verification', 3, '真实Chrome/SwiftShader、相关回归、独立矩阵手势与copiedVM分别证明；非安装／设备／硬件GPU验收。'),
        ('decoupling', 3, '选择只消费稳定身份，渲染持有私有帧；作者、宿主和后端不变，GUI与Shader实现仍为现有适配。'),
        ('delivery', 2, '0.0.10之后未发布工作树与准备资源，无新安装、提交或平台交付提升。'),
    ]:
        data['cells'].append({'coordinates': ['ui', feature, ident, dimension], 'value': score, 'reason': reason})
for target in ['scene.picking3d', 'scene.navigation3d']:
    data['dependencies'].append({'from': feature, 'to': target, 'relation': 'requires',
        'reason': '复用当前有效模型的稳定选择、已有列表／画布和临时聚焦；不依赖任何作者表单或执行后端。'})
data['workflows'].append({'id': 'scene3d-selection-feedback', 'label': '稳定选择→原实体边缘反馈→同几何双击聚焦／严格原文定位',
    'steps': ['authoring.document-edit', 'studio.system_modules', 'scene.primitives3d', 'scene.navigation3d', 'scene.picking3d', feature],
    'boundary': '输入、提示和临时镜头只改变视图；来源定位独立核完整原文，保存与作者提案不进入反馈。'})
counts = {'axes': {k: len(v) for k, v in data['axes'].items()},
          **{k: len(data[k]) for k in ['bindings', 'cells', 'dependencies', 'workflows', 'evidence']}}
data['meta']['date'] = '2026-10-12'
data['meta']['scope'] = '追加只读3D选中实体边缘反馈；90功能/211实现/345绑定/1380单元，仍十二模块/28能力。原几何深度、作者格式、Rust/WASM、宿主和后端保持；相关及browser/source phases不提升安装或设备交付。此前时点：' + data['meta']['scope']
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
with (OUT / 'atlas-preservation-review.json').open('x') as stream:
    json.dump({'createdAt': datetime.now(timezone.utc).isoformat(), 'ok': True, 'oldPrefixesAndScoresExact': True,
        'added': {'function': 1, 'implementation': 2, 'bindings': 2, 'cells': 8, 'dependencies': 2, 'workflows': 1, 'evidence': len(ids)},
        'counts': counts}, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
print(json.dumps(counts))

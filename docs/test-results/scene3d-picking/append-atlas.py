from pathlib import Path
from datetime import datetime, timezone
import json

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
path = ROOT / 'docs/function-atlas.json'
data = json.loads(path.read_text())
old = json.loads((OUT / 'atlas-baseline.json').read_text())
assert data['axes'] == old['axes']
for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows']:
    assert data[key] == old[key], key

feature = 'scene.picking3d'
data['axes']['function'].append({
    'id': feature, 'label': '3D画布几何选择与双击聚焦', 'group': '场景与构建',
    'entry': '有效Rust模型→实际Float32绘图帧→可见方块表面命中→稳定UUID选择／明确临时聚焦',
    'boundary': [
        '0.0.10之后未发布视图增量，保持12固定模块／28声明能力、作者格式、Rust／WASM及后端协议。',
        '纯命中仅消费最近绘图的矩阵与CSS坐标，不读作者正文、原文范围、宿主或具体引擎。',
        '使用相同浮动原点及实际上传矩阵，真实入口／出口表面必须在齐次裁剪内，近面不形成新几何。',
        '最近表面遮挡优先，完全同深度按现有LEQUAL顺序选择后声明；不宣称抗锯齿与深度量化逐像素ID一致。',
        '超过4CSSpx才旋转，返回起点仍为拖动；取消、多指、滚轮、手势中的位置／尺寸变化、模型变化及意外丢失捕获撤销旧手势；正常抬起释放保持原生双击。',
        '渲染只通知UUID与冻结focus提示；独立预览核当前画布／适配器／文档／模型后共用选择路径。',
        '筛选及空白点击保持当前选择；旧有效画面可查看，但其原文定位仍须宿主完整来源一致。',
        'Chrome软件WebGL、正式应用、独立三角面参考及prepared纯VM分别记录，不提升安装／设备成熟度。',
    ],
    'next': '空间结构、素材和多对象创作分别推进；点击选择不构成编辑gizmo、碰撞、像素ID缓冲或新的作者规则。',
    'platforms': ['Linux实际HTTP/Chrome中英日390px与SwiftShader', '桌面／移动prepared纯Float32命中模块'],
    'delivery': 'working-tree',
})
units = [
    ('i207', '实际绘图矩阵的纯方块表面命中', ['JavaScript'], ['web/modules/scene3d-picking.js']),
    ('i208', '私有绘图帧与可撤销画布手势适配', ['JavaScript'], ['web/modules/scene3d-renderer.js']),
    ('i209', '独立预览的稳定选择与临时聚焦接线', ['JavaScript'], ['web/modules/app-scene3d-preview.js', 'web/i18n/en.js', 'web/i18n/ja.js']),
]
paths = []
for ident, label, languages, files in units:
    data['axes']['implementation'].append({'id': ident, 'label': label, 'kind': 'product', 'language': languages, 'paths': files})
    paths.extend(files)
paths += ['scripts/tests/' + name for name in ['scene3d-picking.test.mjs', 'scene3d-renderer.test.mjs', 'scene3d-preview-ui.test.mjs', 'scene3d-picking-smoke.mjs']]
paths += ['docs/test-results/scene3d-picking/' + name for name in [
    'baseline.json', 'source-freeze-final.json', 'renderer-results.json', 'web-validation.json',
    'quality-confirmed.json', 'extreme-frame-final.json', 'packaged-resources.json', 'review.json',
    'preservation-audit-before-cleanup.json', 'results.json', 'cleanup.json', 'application-timing.json', 'atlas-preservation-review.json',
]]
paths += ['docs/SCENE3D.md', 'engine/README.md', 'docs/STUDIO_MODULES.md']
ids = []
start = max(int(e['id'][1:]) for e in data['evidence']) + 1
for n, name in enumerate(paths, start):
    ident = f'e{n}'
    kind = 'test' if name.startswith('scripts/tests/') else 'report' if name.startswith('docs/test-results/') else 'design' if name.endswith('.md') else 'source'
    data['evidence'].append({'id': ident, 'kind': kind, 'path': name, 'note': '当前只读3D画布选择及真实验收；旧报告和安装范围保持其执行时点，几何命中不声称逐像素ID一致。'})
    ids.append(ident)
start = max(int(b['id'][1:]) for b in data['bindings']) + 1
for n, (ident, _, _, _) in enumerate(units, start):
    data['bindings'].append({'id': f'b{n}', 'architecture': 'ui', 'function': feature, 'implementation': ident,
                            'role': 'Renderer-owned geometry and gestures, or model-owned independent readonly selection; no author or host grant.', 'evidence': ids})
    for dimension, score, reason in [
        ('implementation', 4, '合格单击／双击、真实表面命中和稳定选择形成所声明闭环；编辑gizmo、空间树、素材不在范围。'),
        ('verification', 3, '正式完整应用、真实Chrome/软件WebGL、独立几何和prepared分别核对；未作安装／设备／硬件GPU验收。'),
        ('decoupling', 4 if ident == 'i207' else 3, '纯几何在两准备副本复用；绘图帧与输入归适配器，GUI只接稳定身份，作者与宿主边界保持。'),
        ('delivery', 2, '0.0.10之后未发布工作树和资源准备；复制及浏览器证明不替代新版安装分发。'),
    ]:
        data['cells'].append({'coordinates': ['ui', feature, ident, dimension], 'value': score, 'reason': reason})
for target in ['scene.navigation3d', 'scene.primitives3d', 'studio.system_modules']:
    data['dependencies'].append({'from': feature, 'to': target, 'relation': 'requires', 'reason': '有效3D来源、当前只读预览与稳定选择是前置；不要求任一作者表单或执行后端。'})
data['workflows'].append({'id': 'scene3d-canvas-picking', 'label': '有效3D绘图→画布命中→稳定选择／临时聚焦→可选原文定位',
    'steps': ['authoring.document-edit', 'studio.system_modules', 'scene.primitives3d', 'scene.navigation3d', feature],
    'boundary': '输入手势和几何命中只更新视图；原文定位仍使用已有宿主完整来源守护，不添加作者提案或普通保存。'})
counts = {'axes': {k: len(v) for k, v in data['axes'].items()}, **{k: len(data[k]) for k in ['bindings', 'cells', 'dependencies', 'workflows', 'evidence']}}
data['meta']['date'] = '2026-10-12'
data['meta']['scope'] = '追加只读3D画布选择与双击聚焦；89功能/209实现/343绑定/1372单元，仍12模块/28能力。旧轴/坐标/评分/理由/历史前缀保持，作者和后端不变；实际绘图矩阵几何不宣称逐像素ID。此前时点：' + data['meta']['scope']
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
with (OUT / 'atlas-preservation-review.json').open('x') as stream:
    json.dump({'createdAt': datetime.now(timezone.utc).isoformat(), 'ok': True, 'oldPrefixesAndScoresExact': True,
               'added': {'function': 1, 'implementation': 3, 'bindings': 3, 'cells': 12, 'dependencies': 3, 'workflows': 1, 'evidence': len(ids)},
               'counts': counts}, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
print(json.dumps(counts))

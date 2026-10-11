"""Append independent 3D prototype evidence; keep every prior atlas row intact."""
from pathlib import Path
import json

root = Path.cwd()
out = root / 'docs/test-results/scene3d-primitives'
path = root / 'docs/function-atlas.json'
atlas = json.loads(path.read_text())
baseline = json.loads((out / 'atlas-baseline.json').read_text())
feature = 'scene.primitives3d'
assert not any(item['id'] == feature for item in atlas['axes']['function'])
for axis, entries in baseline['axes'].items():
    assert atlas['axes'][axis] == entries
for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']:
    assert atlas[key] == baseline[key]
results = json.loads((out / 'results.json').read_text())
verify = results['verification']
app = verify['application']['tests']
rust = verify['sharedCore']['total']
prepared = verify['prepared']['totalCases']
browser = verify['browser']['stepsPassed']
atlas['axes']['function'].append({
    'id': feature, 'label': '独立 3D 方块表示、只读 GPU 预览与静态 Godot 导出', 'group': '场景与构建',
    'entry': 'JSON 原文→可选 Rust 校验→独立 WebGL2 预览；同源 CLI→3D 派生计划→可检查 Godot 工程→有限探针',
    'boundary': [
        '0.0.9 发布后未提交工作树；新增独立 schema1，不改变原 2D 作者格式、创作域、构建及运行协议。',
        '严格 128KiB JSON、1–128 方块、稳定 UUID、透视相机和方向光；Rust 定位原文对象 UTF-16 范围。',
        'RH/Y-up/−Z forward、米、度、显式 EulerXYZ；归一化极小方向向量，保留作者原数值与顺序。',
        '第八系统模块仅依赖文档模块；24 声明能力与实际核心、WebGL2、工具检测分离，缺失读取端口仅关闭新视图。',
        '来源只读端口绑定文档、会话和原文字节；旧响应无权更新新窗口；普通 Save 持久化，视角操作不改原文。',
        'WebGL2 窗口关闭释放资源，无效草稿保留最近有效模型；中英日窄屏及真实软件 GPU 像素证明单独记录。',
        '独立 kind:scene3d 计划与 Godot 适配，原始 source.json 和五文件库存可检查；旧后端能力注册不变。',
        '全新目录排他导出、私有当前创建凭据、一次有限执行和生成文件核验；不认领外部工程，也不声称同 UID 进程沙箱。',
        f'{app} 全应用、{rust} Rust、{browser} 实际浏览器流程、{prepared} prepared VM 案例及实际 Godot 探针分开记录；专项重叠，不作合计。',
        '39 旧作者文件、3457 旧证据及 4 外部工具原字节保留；新增两个 3D 作者示例。没有安装包或 Android 设备验收。'],
    'next': '分别定义模型资源引用、空间层级、OC 投影、作者修改事务和行为能力，后续独立接 Bevy/NS-Nova。',
    'platforms': ['Linux 实际 HTTP/Chrome WebGL2 软件 GPU，中英日 390px', 'Rust 原生/WASM、实际 Godot4.7.2 无头探针、桌面/移动准备副本；非安装/设备'],
    'delivery': 'working-tree'})
implementations = [
    ('i183', '严格 3D 图元校验与精确来源范围', ['Rust'], ['crates/viento-studio-core/src/scene3d.rs', 'crates/viento-studio-core/src/lib.rs']),
    ('i184', '可选核心桥、只读模型与独立 3D 计划', ['JavaScript'], ['engine/studio-core.mjs', 'engine/scene3d.mjs', 'engine/studio-modules.mjs']),
    ('i185', '独立只读来源端口、WebGL2 视图和三语交互', ['JavaScript', 'CSS'], ['web/modules/app-scene3d-preview.js', 'web/modules/scene3d-math.js', 'web/modules/scene3d-renderer.js', 'web/modules/app-studio-system.js', 'web/modules/app-runtime.js', 'web/scene3d.css']),
    ('i186', '可检查 Godot3D 工程导出与有限实际探针', ['JavaScript', 'GDScript'], ['scripts/backends/godot4-scene3d.mjs', 'scripts/backends/godot3d/runtime.gd', 'scripts/adapters/node-scene3d-export.mjs', 'scripts/scene3d.mjs'])]
for ident, label, languages, paths in implementations:
    atlas['axes']['implementation'].append({'id': ident, 'label': label, 'kind': 'product', 'language': languages, 'paths': paths})
files = [('source', name) for _, _, _, paths in implementations for name in paths]
files += [('test', 'scripts/tests/' + name) for name in ['scene3d.test.mjs', 'studio-core-scene3d.test.mjs', 'scene3d-module-boundary.test.mjs', 'scene3d-preview-ui.test.mjs', 'scene3d-renderer.test.mjs', 'scene3d-system-ports.test.mjs', 'scene3d-export.test.mjs', 'scene3d-preview-smoke.mjs']]
files += [('design', name) for name in ['docs/SCENE3D.md', 'docs/STUDIO_MODULES.md', 'schemas/scene3d-v1.schema.json', 'examples/scene3d/README.md', 'examples/scene3d/scene.json']]
files += [('report', 'docs/test-results/scene3d-primitives/' + name) for name in ['results.json', 'core-results.json', 'core-final-confirmation-label.json', 'core-independent-audit.json', 'core-cross-review.json', 'core-backend-boundary-review.json', 'core-native-test.log', 'core-fmt-check.log', 'core-clippy.log', 'core-regression-final.log', 'web-validation.json', 'web-focused-label-final.log', 'backend-results.json', 'export-tests-final.log', 'godot-final.json', 'browser-label-final/browser.json', 'app-check.log', 'review.json', 'document-review.json', 'boundary-source-results.json', 'packaged-resources.json', 'prepared-check-label-final.log', 'source-hashes.json', 'source-delta.json', 'native-helpers.json', 'fixed-node.json', 'cleanup.json', 'preservation-audit.json']]
ids = []
start = max(int(item['id'][1:]) for item in atlas['evidence']) + 1
for index, (kind, name) in enumerate(dict.fromkeys(files), start):
    assert (root / name).is_file(), name
    ident = f'e{index}'
    ids.append(ident)
    atlas['evidence'].append({'id': ident, 'kind': kind, 'path': name, 'note': '独立 3D 图元首切片；实际软件 GPU、有限引擎和准备副本分别记录，历史评分保持。'})
start = max(int(item['id'][1:]) for item in atlas['bindings']) + 1
for index, (architecture, implementation, role, decoupling) in enumerate([
    ('rust-core', 'i183', '严格源校验、预算与身份来源', 4),
    ('semantic-js', 'i184', '完整语义/范围复核及后端独立计划', 4),
    ('ui', 'i185', '来源只读、独立 GPU 视图、失败与释放', 3),
    ('node-service', 'i186', '新目录导出、库存和私有执行凭据', 3),
    ('runtime-backend', 'i186', '静态 Godot 图元与有限树/变换探针', 3)], start):
    atlas['bindings'].append({'id': f'b{index}', 'architecture': architecture, 'function': feature, 'implementation': implementation, 'role': role, 'evidence': ids})
    for maturity, value, reason in [
        ('implementation', 3, '原文→方块预览/静态导出首切片；模型素材、层级、行为和修改事务后续独立实现。'),
        ('verification', 3, '原生/WASM、全应用、实际软件 GPU 和 Godot 探针及准备副本；无安装/设备验收。'),
        ('decoupling', decoupling, '作者校验、可移植计划、只读视图及实际后端职责分开，原 2D 协议未扩张。'),
        ('delivery', 2, '当前未发布工作树及实际资源准备，版本/提交/安装产物保持。')]:
        atlas['cells'].append({'coordinates': [architecture, feature, implementation, maturity], 'value': value, 'reason': reason})
for target in ['authoring.document-edit', 'studio.system_modules']:
    assert any(item['id'] == target for item in atlas['axes']['function'])
    atlas['dependencies'].append({'from': feature, 'to': target, 'relation': 'requires', 'reason': '读取当前原文会话、独立模块装配及普通保存；不授予旧 2D 或后端执行权限。'})
atlas['workflows'].append({'id': 'scene3d-source-preview-export', 'label': '严格 3D 原文→只读视图/独立计划→Godot 工程→有限探针', 'steps': ['authoring.document-edit', 'studio.system_modules', feature], 'boundary': '作者原文和普通 Save 保持权威；两个展示/后端适配消费独立数据，不复用原 2D 行为协议。'})
atlas['meta']['scope'] = f'0.0.9/base9065667 未发布新增 {feature}/i183–186/5bindings/20cells，独立3D方块首切片；8模块/24声明能力，原2D与后端协议不变。旧评分/历史前缀、3457历史/39旧作者/4工具保留，另加2作者示例。{app}应用/{rust}Rust/{browser}浏览器/{prepared}prepared和实际Godot分别记录；无发布、安装、设备验收。'
path.write_text(json.dumps(atlas, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: len(atlas[key]) for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows']}))

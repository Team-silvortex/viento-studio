from pathlib import Path
import json

r = Path.cwd()
o = r / 'docs/test-results/scene-authoring-workflow'
p = r / 'docs/function-atlas.json'
x = json.loads(p.read_text())
f = 'scene.authoring_workflow'
assert not any(item['id'] == f for item in x['axes']['function'])
x['axes']['function'].append({
    'id': f, 'label': '独立场景创作流程、候选验收与宿主接口', 'group': '场景与构建',
    'entry': '六个独立配方编辑区→自身能力与来源→完整候选审阅→同源草稿应用→宿主导航→普通保存',
    'boundary': [
        '0.0.9发布后未发布工作树；six editor入口分别维护输入、审批、选择和局部历史，没有跨区统一撤销。',
        '纯candidate固定instance/positions/fragment/placement/structure语义，核对摘要、来源和目标；unknown kind与bad shape闭合拒绝。',
        '纯workflow使用注入来源/目录/预览/摘要/应用/成功通知接口，不导入DOM、HTTP、Node或具体执行引擎。',
        '每入口仅暴露六个公共来源字段和自己的能力，不读取兄弟flag、构建结果或后端工程；执行中编辑等原权限仍关闭。',
        '提案与model/actor在await前分离，open/review/apply各自epoch拒绝late/reentrant响应；关闭/文档/source token变化失效，旧临时preview仍尽力释放。',
        '应用成功合法推进source token，完成仅接纳本入口exact结果回执/完整提案/当前owner；跨区回执和重放拒绝，纯层不聚焦或关闭窗口。',
        'web adapter绑定六个旧UI及HTTP/catalog；构建父仅交接窗口归属和成功导航，source host保留最后检查、内存应用、baseline和普通Save。',
        'Rust/WASM、recipe/World/runtime格式、六domain补丁和UI/sourcehost原字节保持；旧桥接测试仅更新共享函数identity断言并保留双方完整审阅/释放保护。',
        '固定Node全量、51新专项与37真实Chrome流程分开记录，prepared实际标准VM纯层复用不计安装窗口/Android编辑设备验收。',
        '普通场景事务、执行生命周期、人机工程新面板/键盘/焦点交互、跨文件历史和自动保存不在这次接口拆分。',
    ],
    'next': '沿独立来源、审阅、应用和导航接口继续场景结构创作，再逐区验证面板、键盘、焦点与跨区历史。',
    'platforms': ['Linux本机服务/Chrome六创作入口', 'prepared桌面和标准VM移动纯层；非安装/设备'],
    'delivery': 'working-tree',
})
x['axes']['implementation'].extend([
    {'id': 'i165', 'label': 'scene-authoring-candidate.mjs：固定语义候选回执验收', 'kind': 'product', 'language': ['JavaScript'], 'paths': ['engine/scene-authoring-candidate.mjs']},
    {'id': 'i166', 'label': 'scene-authoring-workflow.mjs：独立入口生命周期与窄状态', 'kind': 'product', 'language': ['JavaScript'], 'paths': ['engine/scene-authoring-workflow.mjs']},
    {'id': 'i167', 'label': 'app-scene-authoring.js：来源、目录、预览与界面连接', 'kind': 'product', 'language': ['JavaScript'], 'paths': ['web/modules/app-scene-authoring.js', 'web/modules/app-project-build.js']},
])
files = [
    ('source', 'engine/scene-authoring-candidate.mjs'), ('source', 'engine/scene-authoring-workflow.mjs'),
    ('source', 'web/modules/app-scene-authoring.js'), ('source', 'web/modules/app-project-build.js'), ('source', 'web/modules/app-runtime.js'),
    ('test', 'scripts/tests/scene-authoring-candidate.test.mjs'), ('test', 'scripts/tests/scene-authoring-workflow.test.mjs'),
    ('test', 'scripts/tests/scene-authoring-ui.test.mjs'), ('test', 'scripts/tests/scene-composition-overrides-bridge.test.mjs'),
    ('design', 'docs/SCENE_AUTHORING.md'),
]
files += [('report', f'docs/test-results/scene-authoring-workflow/{name}') for name in [
    'results.json', 'app-check.log', 'new-tests.log', 'focused-tests-initial.log', 'boundary-review.json',
    'independent-review.json', 'packaged-resources.json', 'source-delta.json', 'old-test-contract-review.json', 'cleanup.json', 'final-audit.json',
    'browser-override/browser.json', 'browser-canvas/browser.json', 'browser-batch/browser.json',
    'browser-fragment-inheritance/browser.json', 'browser-placement/browser.json', 'browser-structure/browser.json',
]]
ids = []
start = max(int(item['id'][1:]) for item in x['evidence']) + 1
for index, (kind, name) in enumerate(files, start):
    assert (r / name).is_file(), name
    eid = f'e{index}'
    ids.append(eid)
    x['evidence'].append({'id': eid, 'kind': kind, 'path': name, 'note': '独立创作流程切片；全量/专项/实际浏览器/准备副本和初次失败分别保留，不提升旧交付评分。'})
start = max(int(item['id'][1:]) for item in x['bindings']) + 1
for index, (architecture, implementation, role) in enumerate([
    ('semantic-js', 'i165', '来源摘要和独立domain目标验收'),
    ('semantic-js', 'i166', '可注入异步owner、窄状态和私有回执'),
    ('ui', 'i167', '六独立UI的browser连接和宿主导航交接'),
    ('ui', 'i102', '复用未改原文宿主最后检查与普通保存'),
], start):
    x['bindings'].append({'id': f'b{index}', 'architecture': architecture, 'function': f, 'implementation': implementation, 'role': role, 'evidence': ids})
    for maturity, value, reason in [
        ('implementation', 3, '六个配方入口接入独立创作接口；普通场景事务及执行任务仍各自维护。'),
        ('verification', 3, '固定Node全量、新模块/接线专项、实际Chrome六入口及prepared标准VM；没有新安装或Android编辑设备验收。'),
        ('decoupling', 4, '纯候选、注入workflow、browser adapter、独立UI及source host分离；实际prepared纯层跨宿主复用，没有后端对象和全局事件总线。'),
        ('delivery', 2, '当前未发布工作树/准备副本，版本HEAD不变，未交付新安装包。'),
    ]:
        x['cells'].append({'coordinates': [architecture, f, implementation, maturity], 'value': value, 'reason': reason})
for to in ['scene.composition', 'scene.source_model', 'scene.text_draft_preview']:
    x['dependencies'].append({'from': f, 'to': to, 'relation': 'requires', 'reason': '创作接口保留完整配方/来源/草稿预览及普通保存规则。'})
for source in ['scene.composition_inheritance', 'scene.composition_canvas', 'scene.composition_batch_canvas', 'scene.composition_fragment_editor', 'scene.composition_fragment_inheritance', 'scene.composition_placement_editor', 'scene.composition_structure_editor']:
    x['dependencies'].append({'from': source, 'to': f, 'relation': 'requires', 'reason': '当前入口通过独立workflow连接来源与候选；各UI和domain原契约保持。'})
x['workflows'].append({'id': 'scene-authoring-host-ports', 'label': '独立编辑区→来源/审阅/应用→中性成功通知→原文普通保存',
    'steps': ['scene.composition', f, 'scene.text_draft_preview', 'scene.source_model'],
    'boundary': '六入口私有会话与回执；单文件内存草稿，ordinarySave保留；非统一历史、自动保存或新设备交付。'})
x['meta']['scope'] = '0.0.9发布后base9065667新增scene.authoring_workflow/i165–167及4binding/16cells 3/3/4/2，复用i102未改source host。六配方编辑区独立连接pure candidate/workflow与browser adapter，当前源码610/2799旧历史及作者/工具/Rust/WASM/冻结后端保持。全量/51新增/37实际Chrome/prepared各自记录；无版本/commit/push/安装或设备交付。'
p.write_text(json.dumps(x, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'functions': len(x['axes']['function']), 'implementations': len(x['axes']['implementation']), 'bindings': len(x['bindings']), 'cells': len(x['cells']), 'evidence': len(x['evidence']), 'dependencies': len(x['dependencies']), 'workflows': len(x['workflows'])}))

import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectProjectInputActionReferences } from '../../engine/project-input-action-diagnostics.mjs';
import { GODOT_ACTION_SCENE_RETRY_SCRIPT as GODOT_ACTION_SCENE_SWITCH_SCRIPT } from '../../engine/godot-scene-retry-script.mjs';
import { GODOT_EVENT_SCENE_SWITCH_SCRIPT } from '../../engine/godot-scene-navigation-scripts.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const id = n => `61616161-6161-4161-8161-${String(n).padStart(12, '0')}`;
function fixture(parameters = {}, content = GODOT_ACTION_SCENE_SWITCH_SCRIPT) {
  const sourcePath = 'documents/behaviors/menu.json', sourceRevision = 'sha256:' + '1'.repeat(64);
  const binding = { bindingId: id(4), instanceId: id(5), parameters, implementation: { sourceObjectId: id(3) } };
  const source = { record: { id: id(2), sourcePath }, sourcePath, sourceRevision, content: JSON.stringify({ bindings: [binding] }, null, 2) };
  const scenes = [{ scene: { objectId: id(1) }, behaviors: { backendId: 'org.viento.godot4', language: 'gdscript',
    manifest: { objectId: id(2), sourcePath, sourceRevision }, sources: [{ objectId: id(3), content }], bindings: [binding] } }];
  return { scenes, source, diagnostics: map => inspectProjectInputActionReferences(scenes, map, [source]) };
}
test('official action retry uses its built-in default and explicit mapped action without warnings', () => {
  assert.deepEqual(fixture().diagnostics(null), []);
  assert.deepEqual(fixture({ action_name: 'menu_confirm' }).diagnostics({ actions: [{ name: 'menu_confirm', keys: ['Enter'] }] }), []);
});
test('missing custom retry action preserves binding identity and exact parameter range', () => {
  const f = fixture({ action_name: 'menu_confirm' }), [warning] = f.diagnostics({ actions: [{ name: 'move_left', keys: ['KeyA'] }] });
  assert.equal(warning.severity, 'warning'); assert.equal(warning.code, 'build_input_action_unmapped');
  assert.equal(warning.parameter, 'action_name'); assert.equal(warning.sceneId, id(1)); assert.equal(warning.bindingId, id(4));
  assert.equal(warning.propertyPath, '/bindings/0/parameters/action_name'); assert.equal(warning.sourceRange.exact, true);
  assert.equal(f.source.content.slice(warning.sourceRange.start, warning.sourceRange.end), '"menu_confirm"');
  assert.equal(f.diagnostics(null)[0].code, 'build_input_action_unconfigured');
});
test('event navigation and edited retry scripts do not acquire inferred input semantics', () => {
  for (const content of [GODOT_EVENT_SCENE_SWITCH_SCRIPT, GODOT_ACTION_SCENE_SWITCH_SCRIPT + '\n# author extension\n']) {
    assert.deepEqual(fixture({ action_name: 'unmapped_custom' }, content).diagnostics(null), []);
  }
});
test('retry and generalized behavior action messages are translated in English and Japanese', () => {
  const keys = ['Godot / 按动作重试关卡',
    "关卡重试目标无效。请选择组装中的其他成员场景，并填写完整的小写 UUID。",
    "关卡重试动作无效。请填写已注册的非空动作名称。",
    "关卡重试初始值无效。请输入最多16个标量键、4096 UTF-8字节的严格 JSON 对象。",
    "关卡重试诊断过多，部分问题已省略。请先修复已列出的行为绑定。",
    "关卡重试声明不可用，请重新读取并检查行为原文。",
    "冻结工程的关卡重试文件已变化，请重新构建。",
    '场景导航目标无效。请选择组装中的其他成员场景，并填写完整的小写 UUID。',
    '场景导航参数无效。请检查动作名称、事件名称和载荷筛选。',
    '行为动作未在项目输入映射中找到。请检查行为参数和映射；脚本也可能在运行时注册该动作。'];
  for (const dictionary of [en, ja]) for (const key of keys) { assert.ok(dictionary[key]); assert.notEqual(dictionary[key], key); }
});

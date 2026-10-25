import { GODOT_CHARACTER_CONTACT_EVENTS_SCRIPT } from './godot-character-contact-events-script.mjs';
import { GODOT_CHARACTER_MOTION_EVENTS_SCRIPT } from './godot-character-motion-events-script.mjs';
import { GODOT_PROJECT_EVENT_AUDIO_SCRIPT } from './godot-project-event-audio-script.mjs';
import { GODOT_PHYSICS_SENSOR_SCRIPT } from './godot-physics-sensor-script.mjs';
// Known starters prepare ordinary text drafts. Saving, registration, scene
// relationships, language services and execution belong to their own hosts.
import { getCreatePathError } from './document-contract.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE } from './godot-animation-state-script.mjs';
import { generateEditableGodotAnimationStateScript as generateGodotAnimationStateScript, DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT as DEFAULT_GODOT_ANIMATION_STATE_SCRIPT } from './animation-state-script-source.mjs';
import { supportsStudioCoreAnimationStateTable } from './studio-core.mjs';

export { DEFAULT_ANIMATION_STATE_TABLE };
export const supportsAnimationStateScript = () => supportsStudioCoreAnimationStateTable();
const animationStateStarter = 'godot-project-animation-state-table';

const proposals = new WeakSet();
const contextKeys = ['sourceToken', 'documentRoot', 'documentTypes'];
const requestKeys = ['starterId', 'documentType', 'sourcePath'];
const reserved = new Set(['constructor', '__proto__', 'prototype']);
const error = (kind = 'invalid') => Object.assign(new TypeError('The script draft does not match the current creation context.'), {
  errorCode: `script_authoring_${kind}`,
});
const fail = () => { throw error(); };
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const starters = freeze([
  { id: 'godot-node', languageId: 'gdscript', backendId: 'org.viento.godot4', label: '空 Node',
    description: '从空 Node 开始编写行为。', content: 'extends Node\n' },
  { id: 'godot-signal', languageId: 'gdscript', backendId: 'org.viento.godot4', label: '参数与信号示例',
    description: '使用参数并在就绪时发出信号；参数和信号映射需在行为文档中设置。',
    content: 'extends Node\n\nsignal arrived(checkpoint: String, amount: float)\n@export var checkpoint: String = "dock"\n@export var amount: float = 0.0\n\nfunc _ready() -> void:\n\tarrived.emit(checkpoint, amount)\n' },
  { id: 'bevy-rust', languageId: 'rust', backendId: 'org.viento.bevy-rust', label: 'Bevy Rust / 空行为',
    description: '从空 ready 函数开始编写 Bevy Rust 行为。',
    content: 'use crate::runtime::BehaviorContext;\n\npub fn ready(_ctx: &mut BehaviorContext) -> Result<(), String> {\n    Ok(())\n}\n' },
  { id: 'bevy-rust-signal', languageId: 'rust', backendId: 'org.viento.bevy-rust', label: 'Bevy Rust / 参数与信号示例',
    description: '使用 Bevy Rust 参数接口并在就绪时发出信号；参数和信号映射需在行为文档中设置。',
    content: 'use crate::runtime::BehaviorContext;\n\npub fn ready(ctx: &mut BehaviorContext) -> Result<(), String> {\n    let checkpoint = ctx.string("checkpoint")?.to_owned();\n    let amount = ctx.number("amount")?;\n    ctx.emit("arrived", vec![checkpoint.into(), amount.into()])?;\n    Ok(())\n}\n' },
  { id: 'bevy-rust-motion', languageId: 'rust', backendId: 'org.viento.bevy-rust', label: 'Bevy Rust / 固定步移动',
    description: '按固定时间步移动当前实例并发出 moved 信号；速度参数和信号映射需在行为文档中设置。',
    content: 'use crate::runtime::{BehaviorContext, FixedStep};\n\npub fn ready(ctx: &mut BehaviorContext) -> Result<(), String> {\n    ctx.on_fixed_update(fixed_update)\n}\n\nfn fixed_update(ctx: &mut BehaviorContext, step: FixedStep) -> Result<(), String> {\n    let vx = ctx.number("velocity_x")?;\n    let vy = ctx.number("velocity_y")?;\n    ctx.translate([vx * step.delta_seconds, vy * step.delta_seconds])?;\n    let [x, y] = ctx.position();\n    ctx.emit("moved", vec![x.into(), y.into()])?;\n    Ok(())\n}\n' },
  { id: 'godot-scene-switch', languageId: 'gdscript', backendId: 'org.viento.godot4', label: 'Godot / 场景切换',
    description: '在组装运行中请求切换到 target_scene_id 指定的成员场景；请在行为参数中填写目标场景标识。单场景运行时不切换。',
    content: "extends Node\n\n@export var target_scene_id: String = \"\"\n\nfunc _ready() -> void:\n\tif target_scene_id.is_empty() or not has_meta(\"viento_project\"):\n\t\treturn\n\tget_meta(\"viento_project\").request_scene(target_scene_id)\n" },
  { id: 'godot-project-state', languageId: 'gdscript', backendId: 'org.viento.godot4', label: 'Godot / 共享状态',
    description: '在当前项目运行中累加 visit_count；状态跨场景保留，重新运行后清空。单场景运行时不写入。',
    content: "extends Node\n\nfunc _ready() -> void:\n\tif not has_meta(\"viento_project\"):\n\t\treturn\n\tvar project = get_meta(\"viento_project\")\n\tvar previous = project.read_state(\"visit_count\")\n\tvar count := 0.0\n\tif previous is int or previous is float:\n\t\tcount = float(previous)\n\tproject.write_state(\"visit_count\", count + 1)\n" },
  { id: 'godot-project-events', languageId: 'gdscript', backendId: 'org.viento.godot4', label: 'Godot / 项目事件',
    description: '订阅 checkpoint 并延迟发布一个值；接收后写入 last_event。仅项目运行生效，离开场景后撤销订阅。',
    content: "extends Node\n\nvar _project\n\nfunc _ready() -> void:\n\tif not has_meta(\"viento_project\"):\n\t\treturn\n\t_project = get_meta(\"viento_project\")\n\t_project.subscribe_event(\"checkpoint\", _on_checkpoint)\n\tcall_deferred(\"_publish_checkpoint\")\n\nfunc _publish_checkpoint() -> void:\n\t_project.publish_event(\"checkpoint\", \"hello\")\n\nfunc _on_checkpoint(value) -> bool:\n\treturn _project.write_state(\"last_event\", value)\n" },
  { id: 'godot-physics-sensor', languageId: 'gdscript', backendId: 'org.viento.godot4', label: 'Godot / 物理触发区',
    description: '绑定到物理触发区实例。进入和离开时发布项目事件，载荷为对方实例编号；事件名称可在行为参数中设置。', content: GODOT_PHYSICS_SENSOR_SCRIPT },
  { id: 'godot-character-motion-events', languageId: 'gdscript', backendId: 'org.viento.godot4', label: 'Godot / 角色起跳与落地',
    description: '绑定到已启用重力与跳跃的角色实例，真实起跳、首次接触地面及之后重新着地时发布项目事件，载荷为自身实例编号。可用 jumped_event／landed_event 改名，留空禁用；退出时断开连接。', content: GODOT_CHARACTER_MOTION_EVENTS_SCRIPT },
  { id: 'godot-character-contact-events', languageId: 'gdscript', backendId: 'org.viento.godot4', label: 'Godot / 角色移动碰撞',
    description: '绑定到已启用重力与跳跃的角色实例，按每步实际移动碰撞集合发布开始和结束项目事件，载荷为对方实例编号。started_event／ended_event 可改名，留空禁用；other_instance_id 留空接受所有对方，填写时只接受该实例。没有本步碰撞即结束；退出场景只断开连接，不补发结束事件。', content: GODOT_CHARACTER_CONTACT_EVENTS_SCRIPT },
  { id: 'godot-project-event-audio', languageId: 'gdscript', backendId: 'org.viento.godot4', label: 'Godot / 项目事件播放声音',
    description: '订阅 event_name（默认 physics.landed），收到事件后播放 track_id 指定的已声明音轨。instance_id 留空接受全部载荷，填写时只响应相同的实例编号；就绪时不发布事件，退出时取消订阅。', content: GODOT_PROJECT_EVENT_AUDIO_SCRIPT },
  { id: 'godot-project-audio', languageId: 'gdscript', backendId: 'org.viento.godot4', label: 'Godot / 事件声音',
    description: "填写已声明的音轨 UUID；订阅 sound 后，true 请求播放、false 请求停止。仅当前项目场景访问生效，也可在行为中直接调用声音接口。",
    content: "extends Node\n\n@export var track_id: String = \"\"\nvar _project\n\nfunc _ready() -> void:\n\tif track_id.is_empty() or not has_meta(\"viento_project\"):\n\t\treturn\n\t_project = get_meta(\"viento_project\")\n\tif _project.subscribe_event(\"sound\", _on_sound) == 0:\n\t\treturn\n\tcall_deferred(\"_publish_sound\")\n\nfunc _publish_sound() -> void:\n\t_project.publish_event(\"sound\", true)\n\nfunc _on_sound(value) -> bool:\n\tif typeof(value) != TYPE_BOOL:\n\t\treturn false\n\tif value:\n\t\treturn _project.play_audio(track_id)\n\treturn _project.stop_audio(track_id)\n" },
  { id: 'godot-project-animation', languageId: 'gdscript', backendId: 'org.viento.godot4', label: "Godot / 项目动画控制",
    description: "在场景组装项目中控制当前场景的整份动画。command 可选 play、pause、stop、seek；seek 使用 time_seconds 并暂停，play 在末尾重新播放。单场景运行时不控制动画。",
    content: "extends Node\n\n@export var command: String = \"play\"\n@export var time_seconds: float = 0.0\n\nfunc _ready() -> void:\n\tif not has_meta(\"viento_project\"):\n\t\treturn\n\tvar project = get_meta(\"viento_project\")\n\tif not project.has_method(\"play_animation\"):\n\t\treturn\n\tmatch command:\n\t\t\"play\":\n\t\t\tproject.play_animation()\n\t\t\"pause\":\n\t\t\tproject.pause_animation()\n\t\t\"stop\":\n\t\t\tproject.stop_animation()\n\t\t\"seek\":\n\t\t\tproject.seek_animation(time_seconds)\n" },
  { id: 'godot-project-animation-clip', languageId: 'gdscript', backendId: 'org.viento.godot4', label: "Godot / 命名动画片段",
    description: "填写当前场景的动画片段 UUID，选择后从片段起点播放。clip_id 留空时选择完整动画。仅支持动画片段的场景组装项目生效；更名不影响编号引用。",
    content: "extends Node\n\n@export var clip_id: String = \"\"\n\nfunc _ready() -> void:\n\tif not has_meta(\"viento_project\"):\n\t\treturn\n\tvar project = get_meta(\"viento_project\")\n\tif not project.has_method(\"select_animation_clip\"):\n\t\treturn\n\tvar selection = null if clip_id.is_empty() else clip_id\n\tif project.select_animation_clip(selection):\n\t\tproject.play_animation()\n" },
  {"id": "godot-project-animation-event", "languageId": "gdscript", "backendId": "org.viento.godot4", "label": "Godot / 事件动画片段", "description": "订阅 event_name（默认 checkpoint）；收到事件后从头播放 clip_id 指定的片段，留空则播放完整动画。仅支持片段的项目运行生效；就绪时不发布事件，退出时取消订阅。", "content": "extends Node\n\n@export var event_name: String = \"checkpoint\"\n@export var clip_id: String = \"\"\nvar _project\nvar _subscription: int = 0\n\nfunc _ready() -> void:\n\tif event_name.is_empty() or not has_meta(\"viento_project\"):\n\t\treturn\n\tvar project = get_meta(\"viento_project\")\n\tif typeof(project) != TYPE_OBJECT or not is_instance_valid(project):\n\t\treturn\n\tfor method in [\"subscribe_event\", \"unsubscribe_event\", \"select_animation_clip\", \"play_animation\"]:\n\t\tif not project.has_method(method):\n\t\t\treturn\n\t_project = project\n\t_subscription = _project.subscribe_event(event_name, _on_event)\n\nfunc _on_event(_value) -> bool:\n\tif _subscription == 0 or typeof(_project) != TYPE_OBJECT or not is_instance_valid(_project):\n\t\treturn false\n\tvar selection = null if clip_id.is_empty() else clip_id\n\tif not _project.select_animation_clip(selection):\n\t\treturn false\n\treturn _project.play_animation()\n\nfunc _exit_tree() -> void:\n\tvar project = _project\n\tvar subscription = _subscription\n\t_project = null\n\t_subscription = 0\n\tif subscription != 0 and typeof(project) == TYPE_OBJECT and is_instance_valid(project) and project.has_method(\"unsubscribe_event\"):\n\t\tproject.unsubscribe_event(subscription)\n"},
  {"id": "godot-project-animation-completion", "languageId": "gdscript", "backendId": "org.viento.godot4", "label": "Godot / 动画完成后衔接片段", "description": "订阅当前场景动画自然完成；finished_clip_id 匹配后选择 next_clip_id 并从头播放，空编号表示完整动画。就绪时不改变播放；退出时取消订阅，仅支持完成通知的项目运行生效。", "content": "extends Node\n\n@export var finished_clip_id: String = \"\"\n@export var next_clip_id: String = \"\"\nvar _project\nvar _subscription: int = 0\n\nfunc _ready() -> void:\n\tif not has_meta(\"viento_project\"):\n\t\treturn\n\tvar project = get_meta(\"viento_project\")\n\tif typeof(project) != TYPE_OBJECT or not is_instance_valid(project):\n\t\treturn\n\tfor method in [\"subscribe_animation_completed\", \"unsubscribe_animation_completed\", \"select_animation_clip\", \"play_animation\"]:\n\t\tif not project.has_method(method):\n\t\t\treturn\n\t_project = project\n\t_subscription = _project.subscribe_animation_completed(_on_animation_completed)\n\nfunc _on_animation_completed(clip_id) -> bool:\n\tif _subscription == 0 or typeof(_project) != TYPE_OBJECT or not is_instance_valid(_project):\n\t\treturn false\n\tvar finished = null if finished_clip_id.is_empty() else finished_clip_id\n\tif clip_id != finished:\n\t\treturn true\n\tvar selection = null if next_clip_id.is_empty() else next_clip_id\n\tif not _project.select_animation_clip(selection):\n\t\treturn false\n\treturn _project.play_animation()\n\nfunc _exit_tree() -> void:\n\tvar project = _project\n\tvar subscription = _subscription\n\t_project = null\n\t_subscription = 0\n\tif subscription != 0 and typeof(project) == TYPE_OBJECT and is_instance_valid(project) and project.has_method(\"unsubscribe_animation_completed\"):\n\t\tproject.unsubscribe_animation_completed(subscription)\n"},

  { id: animationStateStarter, languageId: 'gdscript', backendId: 'org.viento.godot4', label: 'Godot / 动画状态表',
    description: '配置初始状态以及事件或自然完成转换，生成普通脚本。各状态的 clip_ 参数在行为编辑器中选入片段；运行时启动初始状态，共用当前场景播放头。生成后继续编辑普通源码。',
    content: DEFAULT_GODOT_ANIMATION_STATE_SCRIPT },
]);

// Inspect own data descriptors before reading values. Unknown keys, accessors,
// serializers and inherited records never acquire draft authority.
function record(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail();
  const names = Reflect.ownKeys(input);
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))) fail();
  const output = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
    output[key] = descriptor.value;
  }
  return output;
}
function text(value, maximum, budget) {
  if (typeof value !== 'string' || !value.length || value.length > maximum) fail();
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) fail();
  }
  if ((budget.bytes += new TextEncoder().encode(value).length) > 32768) fail();
  return value;
}
function captureTypes(input, budget) {
  if (!Array.isArray(input) || ![Array.prototype, null].includes(Object.getPrototypeOf(input))) fail();
  const length = Object.getOwnPropertyDescriptor(input, 'length')?.value;
  if (!Number.isInteger(length) || length < 1 || length > 256) fail();
  const names = Reflect.ownKeys(input);
  if (names.length !== length + 1 || names.some(key => key !== 'length'
    && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length))) fail();
  const ids = new Set(), output = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
    const item = record(descriptor.value, ['id', 'label']);
    text(item.id, 64, budget); text(item.label, 4096, budget);
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(item.id) || reserved.has(item.id) || ids.has(item.id)) fail();
    ids.add(item.id); output.push(item);
  }
  return output;
}
function captureContext(input, budget = { bytes: 0 }) {
  const value = record(input, contextKeys);
  text(value.sourceToken, 256, budget); text(value.documentRoot, 900, budget);
  if (value.documentRoot.split('/')[0] === 'docs-standard' || getCreatePathError(`${value.documentRoot}/script.txt`)) fail();
  value.documentTypes = captureTypes(value.documentTypes, budget);
  return value;
}
function captureRequest(input, context, budget) {
  const value = record(input, requestKeys);
  text(value.starterId, 64, budget); text(value.documentType, 64, budget); text(value.sourcePath, 1024, budget);
  if (!starters.some(starter => starter.id === value.starterId)
    || !context.documentTypes.some(type => type.id === value.documentType)
    || !value.sourcePath.startsWith(`${context.documentRoot}/`) || !/\.txt$/i.test(value.sourcePath)
    || value.sourcePath.split('/')[0] === 'docs-standard' || getCreatePathError(value.sourcePath)) fail();
  return value;
}
function sameContext(left, right) {
  return left.sourceToken === right.sourceToken && left.documentRoot === right.documentRoot
    && left.documentTypes.length === right.documentTypes.length
    && left.documentTypes.every((type, index) => type.id === right.documentTypes[index].id && type.label === right.documentTypes[index].label);
}

export function listScriptStarters() { return starters; }

export function prepareScriptDraft(context, request) {
  const budget = { bytes: 0 }, captured = captureContext(context, budget), selected = captureRequest(request, captured, budget);
  const starter = starters.find(item => item.id === selected.starterId);
  const content = starter.id === animationStateStarter
    ? generateGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE).content : starter.content;
  return brandDraft(captured, selected, starter, content);
}

// Only the fixed generator can produce custom source under the existing draft
// brand. Callers cannot inject arbitrary content or acquire Save authority.
export function prepareAnimationStateScriptDraft(context, request, table) {
  const budget = { bytes: 0 }, captured = captureContext(context, budget), selected = captureRequest(request, captured, budget);
  if (selected.starterId !== animationStateStarter) fail();
  const starter = starters.find(item => item.id === animationStateStarter);
  return brandDraft(captured, selected, starter, generateGodotAnimationStateScript(table).content);
}
function brandDraft(captured, selected, starter, content) {
  const proposal = freeze({ format: 'viento-script-draft', schemaVersion: 1, ...captured, ...selected,
    languageId: starter.languageId, backendId: starter.backendId, content });
  proposals.add(proposal);
  return proposal;
}

export function isScriptDraftProposal(value) {
  return Boolean(value && typeof value === 'object' && proposals.has(value));
}

export function prepareScriptDraftApply(currentContext, proposal) {
  if (!isScriptDraftProposal(proposal)) throw error('conflict');
  let current;
  try { current = captureContext(currentContext); } catch { throw error('conflict'); }
  if (!sameContext(current, proposal)) throw error('conflict');
  const { starterId, languageId, backendId, documentType, sourcePath, content } = proposal;
  return freeze({ starterId, languageId, backendId, documentType, sourcePath, content });
}

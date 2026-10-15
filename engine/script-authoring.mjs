// Known starters prepare ordinary text drafts. Saving, registration, scene
// relationships, language services and execution belong to their own hosts.
import { getCreatePathError } from './document-contract.mjs';

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
  { id: 'godot-project-audio', languageId: 'gdscript', backendId: 'org.viento.godot4', label: 'Godot / 事件声音',
    description: "填写已声明的音轨 UUID；订阅 sound 后，true 请求播放、false 请求停止。仅当前项目场景访问生效，也可在行为中直接调用声音接口。",
    content: "extends Node\n\n@export var track_id: String = \"\"\nvar _project\n\nfunc _ready() -> void:\n\tif track_id.is_empty() or not has_meta(\"viento_project\"):\n\t\treturn\n\t_project = get_meta(\"viento_project\")\n\tif _project.subscribe_event(\"sound\", _on_sound) == 0:\n\t\treturn\n\tcall_deferred(\"_publish_sound\")\n\nfunc _publish_sound() -> void:\n\t_project.publish_event(\"sound\", true)\n\nfunc _on_sound(value) -> bool:\n\tif typeof(value) != TYPE_BOOL:\n\t\treturn false\n\tif value:\n\t\treturn _project.play_audio(track_id)\n\treturn _project.stop_audio(track_id)\n" },
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
  const proposal = freeze({ format: 'viento-script-draft', schemaVersion: 1, ...captured, ...selected,
    languageId: starter.languageId, backendId: starter.backendId, content: starter.content });
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

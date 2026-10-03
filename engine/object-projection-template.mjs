// UI-safe declarative templates: no parser, host APIs or executable templates.
import { canonicalJson } from './canonical-json.mjs';

export const OBJECT_PROJECTION_FORMAT = 'viento-object-projection';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, required, optional = []) => plain(value) && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => [...required, ...optional].includes(key));
const text = (value, max = 160) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
  && !/[\x00-\x1f\x7f]/.test(value) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const packageId = value => typeof value === 'string' && value.length <= 160 && /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/.test(value);
const version = value => typeof value === 'string' && /^(?:0|[1-9]\d{0,8})(?:\.(?:0|[1-9]\d{0,8})){2}$/.test(value);
const fieldId = value => typeof value === 'string' && /^[a-z][a-zA-Z0-9_-]{0,63}$/.test(value)
  && !['__proto__', 'constructor', 'prototype'].includes(value);
const copy = value => JSON.parse(JSON.stringify(value));
const fail = (message, propertyPath = '') => { throw Object.assign(new Error(message), { propertyPath }); };
const color = value => typeof value === 'string' && /^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(value);

function validFieldValue(field, value) {
  if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12
    && (field.limits?.min === undefined || value >= field.limits.min) && (field.limits?.max === undefined || value <= field.limits.max);
  if (field.type === 'boolean') return typeof value === 'boolean';
  if (field.type === 'enum') return typeof value === 'string' && field.options.includes(value);
  if (field.type === 'image') return value === '' || uuid(value);
  return typeof value === 'string' && value.length <= (field.limits?.maxLength ?? 4096)
    && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}

export function validateProjectionTemplate(snapshot) {
  if (!exact(snapshot, ['id', 'version', 'label', 'family', 'lineage', 'fields'], ['runtime'])
    || !packageId(snapshot.id) || !version(snapshot.version) || !text(snapshot.label) || !fieldId(snapshot.family)
    || !Array.isArray(snapshot.lineage) || snapshot.lineage.length > 16
    || !Array.isArray(snapshot.fields) || !snapshot.fields.length || snapshot.fields.length > 32) fail('Invalid projection template snapshot', '/template/snapshot');
  const ancestors = new Set([snapshot.id]);
  for (const item of snapshot.lineage) {
    if (!exact(item, ['id', 'version']) || !packageId(item.id) || !version(item.version) || ancestors.has(item.id)) fail('Invalid template lineage', '/template/snapshot/lineage');
    ancestors.add(item.id);
  }
  const ids = new Set();
  for (const [index, field] of snapshot.fields.entries()) {
    const pointer = `/template/snapshot/fields/${index}`;
    if (!exact(field, ['id', 'label', 'type', 'default'], ['limits', 'options']) || !fieldId(field.id) || ids.has(field.id)
      || !text(field.label) || !['number', 'string', 'boolean', 'enum', 'image'].includes(field.type)) fail('Invalid template field', pointer);
    ids.add(field.id);
    if (field.limits !== undefined) {
      const allowed = field.type === 'number' ? ['min', 'max'] : field.type === 'string' ? ['maxLength'] : [];
      if (!allowed.length || !exact(field.limits, [], allowed) || !Object.keys(field.limits).length
        || Object.values(field.limits).some(value => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12)
        || field.type === 'number' && field.limits.min !== undefined && field.limits.max !== undefined && field.limits.min > field.limits.max
        || field.type === 'string' && (!Number.isInteger(field.limits.maxLength) || field.limits.maxLength < 1 || field.limits.maxLength > 16384)) fail('Invalid field limits', `${pointer}/limits`);
    }
    if (field.type === 'enum') {
      if (!Array.isArray(field.options) || !field.options.length || field.options.length > 32
        || field.options.some(value => !text(value, 128)) || new Set(field.options).size !== field.options.length) fail('Invalid enum options', `${pointer}/options`);
    } else if (field.options !== undefined) fail('Only enum fields declare options', `${pointer}/options`);
    if (!validFieldValue(field, field.default)) fail('Invalid field default', `${pointer}/default`);
  }
  if (snapshot.runtime !== undefined) {
    const runtime = snapshot.runtime;
    if (!exact(runtime, ['kind', 'width', 'height', 'color', 'speed', 'controls'], ['image']) || runtime.kind !== 'scene2d-actor') fail('Unsupported projection runtime mapping', '/template/snapshot/runtime');
    for (const [key, type] of Object.entries({ width: 'number', height: 'number', color: 'string', speed: 'number', controls: 'enum', image: 'image' })) {
      if (key === 'image' && runtime.image === undefined) continue;
      const field = snapshot.fields.find(item => item.id === runtime[key]);
      if (!field || field.type !== type || key === 'controls' && field.options.some(value => !['arrows', 'none'].includes(value))) fail('Runtime mapping has an incompatible field', `/template/snapshot/runtime/${key}`);
    }
    renderProjectionRuntime({ template: { snapshot }, configuration: Object.fromEntries(snapshot.fields.map(field => [field.id, field.default])) });
  }
  return snapshot;
}

export function validateProjectionConfiguration(snapshot, configuration) {
  if (!exact(configuration, snapshot.fields.map(field => field.id))) fail('Configuration must supply exactly the declared fields', '/configuration');
  for (const field of snapshot.fields) if (!validFieldValue(field, configuration[field.id])) fail('Configuration value does not match the template field', `/configuration/${field.id}`);
  renderProjectionRuntime({ template: { snapshot }, configuration });
  return configuration;
}

// The adapter receives these effective values; scene position and explicit
// scene overrides remain owned by the scene declaration.
export function renderProjectionRuntime(declaration) {
  const mapping = declaration.template.snapshot.runtime;
  if (!mapping) return null;
  const configuration = declaration.configuration;
  const get = key => configuration[mapping[key]];
  for (const [key, min, max] of [['width', 1, 2048], ['height', 1, 2048], ['speed', 0, 2000]]) {
    if (!Number.isFinite(get(key)) || get(key) < min || get(key) > max) fail('Scene2D runtime value is outside its supported range', `/configuration/${mapping[key]}`);
  }
  if (!color(get('color'))) fail('Scene2D color must be hex RGB or RGBA', `/configuration/${mapping.color}`);
  if (!['arrows', 'none'].includes(get('controls'))) fail('Scene2D controls must be arrows or none', `/configuration/${mapping.controls}`);
  const image = mapping.image ? get('image') : '';
  if (image !== '' && !uuid(image)) fail('Scene2D image must be a resource identity', `/configuration/${mapping.image}`);
  return { size: [get('width'), get('height')], color: get('color'), speed: get('speed'), controls: get('controls'),
    ...(image ? { imageResourceId: image } : {}) };
}

export async function lockProjectionTemplate(snapshot, { digest }) {
  validateProjectionTemplate(snapshot);
  const frozen = copy(snapshot), hash = await digest(canonicalJson(frozen));
  if (!/^[a-f0-9]{64}$/.test(hash)) fail('Template digest must be SHA-256 hex');
  return { packageId: frozen.id, version: frozen.version, digest: `sha256:${hash}`, snapshot: frozen };
}

export function deriveProjectionTemplate(snapshot, configuration, { id, label }) {
  validateProjectionTemplate(snapshot); validateProjectionConfiguration(snapshot, configuration);
  const derived = { ...copy(snapshot), id, version: '1.0.0', label,
    lineage: [...copy(snapshot.lineage), { id: snapshot.id, version: snapshot.version }],
    // Asset identities belong to a project, so a reusable default never
    // silently acquires a dependency on an earlier projection's image store.
    fields: snapshot.fields.map(field => ({ ...copy(field), default: field.type === 'image' ? '' : configuration[field.id] })) };
  validateProjectionTemplate(derived); return derived;
}

const numeric = (id, label, value, min, max) => ({ id, label, type: 'number', default: value, limits: { min, max } });
const string = (id, label, value = '') => ({ id, label, type: 'string', default: value, limits: { maxLength: 4096 } });
const actorFields = [numeric('width', '宽度', 80, 1, 2048), numeric('height', '高度', 80, 1, 2048), string('color', '颜色', '#ffffff'),
  numeric('speed', '移动速度', 160, 0, 2000), { id: 'controls', label: '移动控制', type: 'enum', default: 'arrows', options: ['arrows', 'none'] },
  { id: 'image', label: '图片', type: 'image', default: '' }];
const runtime = { kind: 'scene2d-actor', width: 'width', height: 'height', color: 'color', speed: 'speed', controls: 'controls', image: 'image' };
const base = { id: 'org.viento.projection.character', version: '1.0.0', label: '角色投影', family: 'game', lineage: [], fields: [string('role', '角色定位')] };
const child = (parent, id, label, family, fields, mapping) => {
  const merged = new Map(parent.fields.map(field => [field.id, copy(field)]));
  for (const field of fields) merged.set(field.id, copy(field));
  return { id, version: '1.0.0', label, family, lineage: [...copy(parent.lineage), { id: parent.id, version: parent.version }],
    fields: [...merged.values()], ...(mapping ? { runtime: copy(mapping) } : parent.runtime ? { runtime: copy(parent.runtime) } : {}) };
};
const game = child(base, 'org.viento.projection.game', '游戏角色', 'game', actorFields, runtime);
const rpg = child(game, 'org.viento.projection.rpg', 'RPG 角色', 'game', [numeric('level', '等级', 1, 1, 999), numeric('health', '生命值', 100, 0, 1000000)]);
const templates = [
  child(rpg, 'org.viento.projection.rpg-player', 'RPG 玩家角色', 'game', []),
  child(rpg, 'org.viento.projection.rpg-npc', 'RPG NPC', 'game', [{ id: 'interactable', label: '可交互', type: 'boolean', default: true },
    { id: 'controls', label: '移动控制', type: 'enum', default: 'none', options: ['arrows', 'none'] }, numeric('speed', '移动速度', 0, 0, 2000)]),
  child(base, 'org.viento.projection.visual-novel', '视觉小说角色', 'game', [string('arc', '人物弧光'), string('voice', '叙述声音'), { id: 'image', label: '图片', type: 'image', default: '' }]),
  child(base, 'org.viento.projection.literature', '文学人物', 'literature', [string('arc', '人物弧光'), string('voice', '叙述声音')]),
  child(base, 'org.viento.projection.drama', '戏剧人物', 'drama', [string('goal', '舞台目标'), string('direction', '表演提示')]),
];
export function getProjectionTemplates() { return copy(templates); }

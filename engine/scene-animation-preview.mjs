// A saved visual-animation attachment over a static scene snapshot. This module
// owns neither capture IO, images, playback clocks, scripts nor author writes.
import { inspectSceneAnimation } from './scene-animation-core.mjs';
import { resolveSceneAnimation } from './scene-animation.mjs';
import { normalizeSourcePath } from './source-path.mjs';

const catalogs = new WeakSet();
const envelopeKeys = ['format', 'schemaVersion', 'status', 'snapshotId', 'scene', 'manifest', 'document', 'diagnostics'];
const locationKeys = ['objectId', 'sourcePath', 'sourceRevision'];
const fail = () => { throw Object.assign(new TypeError('Invalid saved scene animation preview.'), { errorCode: 'scene_animation_preview_invalid' }); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const unicode = value => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const text = (value, maximum, empty = false) => typeof value === 'string' && (empty || value.length > 0) && value.length <= maximum && unicode(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') || Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')) fail();
  return value;
}
function field(value, key, optional = false) {
  plain(value); const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor && optional) return undefined;
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}
function record(value, keys, exact = true) {
  plain(value);
  if (exact) { const own = Reflect.ownKeys(value); if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) fail(); }
  return Object.fromEntries(keys.map(key => [key, field(value, key)]));
}
function list(value, limit, item) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail();
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > limit || Reflect.ownKeys(value).length !== length + 1) fail();
  const result = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
    result.push(item(descriptor.value, index));
  }
  return result;
}
function location(value, exact = true) {
  const result = record(value, locationKeys, exact);
  if (!uuid(result.objectId) || !revision(result.sourceRevision) || !text(result.sourcePath, 4096)
    || !/\.json$/i.test(result.sourcePath) || normalizeSourcePath(result.sourcePath) !== result.sourcePath
    || /[\x00-\x1f\x7f:\\]/.test(result.sourcePath)) fail();
  return result;
}
const equalLocation = (a, b) => locationKeys.every(key => a[key] === b[key]);
function actors(value, schemaVersion) {
  const identities = new Set();
  const rows = list(value, 128, input => {
    const objectId = field(input, 'objectId'), instanceId = field(input, 'instanceId', schemaVersion === 1);
    if (!uuid(objectId) || (schemaVersion === 1 ? instanceId !== undefined : !uuid(instanceId))) fail();
    const identity = schemaVersion === 1 ? objectId : instanceId;
    if (identities.has(identity)) fail(); identities.add(identity);
    return { objectId, ...(schemaVersion === 1 ? {} : { instanceId }) };
  });
  if (!rows.length) fail(); return rows;
}
// Image membership is read only for frame tracks. Legacy snapshots keep their
// narrow identity-only boundary and never evaluate unrelated actor fields.
function spriteMembers(rawActors, members, document, rawResources, fullResources = false) {
  const targets = new Set(document.tracks.filter(track => track.property === 'spriteFrame2d').map(track => track.instanceId));
  if (!targets.size) return { members, resources: [] };
  const source = list(rawActors, 128, value => value);
  const resources = list(rawResources, 4096, value => {
    const id = field(value, 'id'); if (!uuid(id)) fail();
    return fullResources ? { id, extension: field(value, 'extension'), sha256: field(value, 'sha256'), size: field(value, 'size'),
      ...(field(value, 'kind', true) === undefined ? {} : { kind: field(value, 'kind') }) } : { id };
  });
  if (new Set(resources.map(value => value.id)).size !== resources.length) fail();
  return { resources, members: members.map((actor, index) => {
    if (!targets.has(actor.instanceId)) return actor;
    const imageResourceId = field(source[index], 'imageResourceId', true);
    if (!uuid(imageResourceId) || !resources.some(value => value.id === imageResourceId)) fail();
    return { ...actor, imageResourceId };
  }) };
}
// The native validator receives detached ordinary data, never executable getters
// or custom serializers. Its compact 64KiB / 512-keyframe budget still applies.
function documentData(input) {
  let nodes = 0, bytes = 0;
  const active = new Set();
  const copy = (value, depth = 0) => {
    if (++nodes > 8192 || depth > 12) fail();
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') { if (!text(value, 131072, true) || (bytes += new TextEncoder().encode(value).length) > 131072) fail(); return value; }
    if (!value || typeof value !== 'object' || active.has(value)) fail();
    active.add(value); let output;
    if (Array.isArray(value)) output = list(value, 512, item => copy(item, depth + 1));
    else {
      plain(value); const keys = Reflect.ownKeys(value);
      if (keys.length > 32 || keys.some(key => typeof key !== 'string' || key.length > 64 || ['__proto__', 'constructor', 'prototype'].includes(key))) fail();
      output = Object.fromEntries(keys.map(key => [key, copy(field(value, key), depth + 1)]));
    }
    active.delete(value); return output;
  };
  return inspectSceneAnimation(copy(input)).document;
}
function checkedDiagnostics(input, scene, manifest) {
  return list(input, 32, raw => {
    const value = record(raw, ['severity', 'code', 'message', ...locationKeys, 'propertyPath']);
    const at = location(value, false);
    if (value.severity !== 'error' || value.code !== 'build_animation_invalid' || !text(value.message, 512)
      || !text(value.propertyPath, 256, true) || value.propertyPath !== '' && !value.propertyPath.startsWith('/')
      || !equalLocation(at, scene) && !(manifest && equalLocation(at, manifest))) fail();
    return value;
  });
}
function envelope(input, scene, snapshotId, members, schemaVersion) {
  const value = record(input, envelopeKeys);
  if (value.format !== 'viento-scene-animation-preview' || value.schemaVersion !== 1 || !['none', 'ready', 'invalid'].includes(value.status)
    || value.snapshotId !== snapshotId || !equalLocation(location(value.scene), scene)) fail();
  const manifest = value.manifest === null ? null : location(value.manifest);
  if (manifest && (manifest.objectId === scene.objectId || manifest.sourcePath === scene.sourcePath || members.some(actor => actor.objectId === manifest.objectId))) fail();
  const diagnostics = checkedDiagnostics(value.diagnostics, scene, manifest);
  let document = null;
  if (value.status === 'ready') {
    if (schemaVersion !== 2 || !manifest || diagnostics.length) fail();
    document = documentData(value.document);
    if (document.sceneObjectId !== scene.objectId || document.tracks.some(track => !members.some(actor => actor.instanceId === track.instanceId))) fail();
  } else if (value.document !== null || (value.status === 'none' ? manifest !== null || diagnostics.length !== 0 : diagnostics.length === 0)) fail();
  return freeze({ status: value.status, snapshotId, scene, manifest, document, diagnostics });
}
export function captureSceneAnimationPreview(preview) {
  try {
    plain(preview);
    if (Object.hasOwn(preview, 'draft') || Object.hasOwn(preview, 'composition') || field(preview, 'ok') !== true
      || field(preview, 'format') !== 'viento-scene-preview') fail();
    const schemaVersion = field(preview, 'schemaVersion'), snapshotId = field(preview, 'snapshotId');
    if (![1, 2].includes(schemaVersion) || !revision(snapshotId)) fail();
    const scene = location(field(preview, 'scene'), false), members = actors(field(preview, 'actors'), schemaVersion);
    if (members.some(actor => actor.objectId === scene.objectId)) fail();
    const catalog = envelope(field(preview, 'animationPreview'), scene, snapshotId, members, schemaVersion);
    if (catalog.document?.tracks.some(track => track.property === 'spriteFrame2d'))
      spriteMembers(field(preview, 'actors'), members, catalog.document, field(preview, 'resources'));
    catalogs.add(catalog); return catalog;
  } catch { fail(); }
}
export const isSceneAnimationPreview = value => Boolean(value && typeof value === 'object' && catalogs.has(value));

function registration(input) {
  const value = record(input, ['format', 'version', 'id', 'sourcePath'], false);
  if (value.format !== 'viento-document' || value.version !== 1 || !uuid(value.id) || !text(value.sourcePath, 4096)) fail();
  const relations = field(input, 'relations', true);
  value.relations = relations === undefined ? [] : list(relations, 1024, input => {
    const kind = field(input, 'kind'), targetId = field(input, 'targetId');
    if (!text(kind, 512) || !kind.trim() || !uuid(targetId)) fail();
    return { kind, targetId };
  });
  return value;
}
function sourceLocation(input) {
  const recordId = field(field(input, 'record'), 'id');
  return location({ objectId: recordId, sourcePath: field(input, 'sourcePath'), sourceRevision: field(input, 'sourceRevision') });
}
function sourceDocument(input, withContent = false) {
  const record = registration(field(input, 'record')), at = sourceLocation(input);
  if (record.sourcePath !== at.sourcePath) fail();
  let content;
  if (withContent) {
    content = field(input, 'content');
    if (!text(content, 131072) || new TextEncoder().encode(content).length > 131072) fail();
  }
  return { record, sourcePath: at.sourcePath, sourceRevision: at.sourceRevision, ...(withContent ? { content } : {}) };
}
export function resolveSceneAnimationPreview(observed, plan, snapshotId) {
  let scene, schemaVersion, members;
  // Invalid static snapshot identities cannot be repaired by inventing source
  // locations. Hosts may omit this optional attachment if their capture is bad.
  try {
    if (!revision(snapshotId) || field(plan, 'format') !== 'viento-build-plan' || field(plan, 'kind') !== 'scene2d') fail();
    scene = location(field(plan, 'scene'), false); schemaVersion = field(plan, 'schemaVersion');
    if (![1, 2, 3].includes(schemaVersion)) fail();
    members = actors(field(plan, 'actors'), schemaVersion === 1 ? 1 : 2);
    if (members.some(actor => actor.objectId === scene.objectId)) fail();
  } catch { fail(); }
  let manifest = null;
  const result = (status, document = null, diagnostics = []) => freeze({ format: 'viento-scene-animation-preview', schemaVersion: 1,
    status, snapshotId, scene, manifest, document, diagnostics });
  const issue = (message = 'The saved animation declaration is unavailable or invalid.', propertyPath = '', at = manifest || scene) => ({
    severity: 'error', code: 'build_animation_invalid', message: text(message, 512) ? message : 'The saved animation declaration is unavailable or invalid.',
    ...at, propertyPath: text(propertyPath, 256, true) && (!propertyPath || propertyPath.startsWith('/')) ? propertyPath : '',
  });
  try {
    const source = field(observed, 'source'), raw = list(field(source, 'documents'), 65536, value => value), indexed = new Map();
    for (const item of raw) {
      const record = field(item, 'record', true); if (record === null || record === undefined) continue;
      const id = field(record, 'id'); if (!uuid(id) || indexed.has(id)) fail(); indexed.set(id, item);
    }
    const rawScene = indexed.get(scene.objectId), sceneDocument = sourceDocument(rawScene);
    if (!equalLocation(sourceLocation(rawScene), scene)) fail();
    const selected = sceneDocument.record.relations.filter(relation => relation.kind === 'animation');
    if (!selected.length) return result('none');
    if (selected.length !== 1) return result('invalid', null, [issue('A scene may reference one animation declaration.', '', scene)]);
    const rawManifest = indexed.get(selected[0].targetId);
    if (rawManifest) {
      try {
        const at = sourceLocation(rawManifest);
        if (at.objectId !== scene.objectId && at.sourcePath !== scene.sourcePath && !members.some(actor => actor.objectId === at.objectId)) manifest = at;
      } catch { /* Retain the valid scene location for an unavailable declaration. */ }
    }
    if (!manifest) return result('invalid', null, [issue()]);
    const declaration = sourceDocument(rawManifest, true);
    const declared = JSON.parse(declaration.content.replace(/^\uFEFF/, ''));
    const sprites = declared?.tracks?.some?.(track => track?.property === 'spriteFrame2d')
      ? spriteMembers(field(plan, 'actors'), members, declared, field(plan, 'resources'), true) : { members, resources: [] };
    const resolved = resolveSceneAnimation({ source: { documents: [sceneDocument, declaration] } },
      { schemaVersion, scene, actors: sprites.members, resources: sprites.resources });
    if (!resolved.ok) {
      const diagnostics = resolved.diagnostics.slice(0, 32).map(diagnostic => {
        const at = location(diagnostic, false);
        return issue(diagnostic.message, diagnostic.propertyPath, equalLocation(at, scene) || equalLocation(at, manifest) ? at : manifest);
      });
      return result('invalid', null, diagnostics.length ? diagnostics : [issue()]);
    }
    const document = resolved.animation?.document;
    if (!document || schemaVersion === 1) return result('invalid', null, [issue()]);
    return result('ready', document);
  } catch { return result('invalid', null, [issue()]); }
}

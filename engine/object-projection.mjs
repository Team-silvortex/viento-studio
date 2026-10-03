import { parseDocument } from 'yaml';
import { canonicalJson } from './canonical-json.mjs';
import { OBJECT_PROJECTION_FORMAT, validateProjectionTemplate, validateProjectionConfiguration } from './object-projection-template.mjs';
export * from './object-projection-template.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, required, optional = []) => plain(value) && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => [...required, ...optional].includes(key));
const text = (value, max = 160) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
  && !/[\x00-\x1f\x7f]/.test(value) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const fail = (message, propertyPath = '') => { throw Object.assign(new Error(message), { propertyPath }); };

export function inspectObjectProjection(content, record = {}) {
  const registered = record?.relations?.some(item => item.kind === 'references' && item.slot === 'projection-source');
  let value;
  try { value = JSON.parse(typeof content === 'string' ? content.replace(/^\uFEFF/, '') : ''); } catch { /* recognized malformed sources still receive diagnostics */ }
  const recognized = registered || value?.format === OBJECT_PROJECTION_FORMAT
    || typeof content === 'string' && /^\s*\{/.test(content.replace(/^\uFEFF/, '')) && /"format"\s*:\s*"viento-object-projection"/.test(content);
  if (!recognized) return { recognized: false, ok: true, value: null, diagnostics: [] };
  try {
    if (typeof content !== 'string' || content.length > 262144 || !exact(value,
      ['format', 'schemaVersion', 'title', 'sourceObjectId', 'template', 'configuration'])
      || value.format !== OBJECT_PROJECTION_FORMAT || value.schemaVersion !== 1 || !text(value.title) || !uuid(value.sourceObjectId)) fail('Invalid object projection declaration');
    if (parseDocument(content.replace(/^\uFEFF/, ''), { uniqueKeys: true }).errors.length) fail('Projection JSON must have unique keys');
    if (!exact(value.template, ['packageId', 'version', 'digest', 'snapshot']) || !/^sha256:[a-f0-9]{64}$/.test(value.template.digest)) fail('Invalid template lock', '/template');
    validateProjectionTemplate(value.template.snapshot);
    if (value.template.packageId !== value.template.snapshot.id || value.template.version !== value.template.snapshot.version) fail('Template identity does not match its snapshot', '/template');
    validateProjectionConfiguration(value.template.snapshot, value.configuration);
    return { recognized: true, ok: true, value, diagnostics: [] };
  } catch (error) {
    return { recognized: true, ok: false, value: null, diagnostics: [{ severity: 'error', code: 'object-projection-invalid',
      message: error.message, propertyPath: error.propertyPath || '' }] };
  }
}

export async function validateObjectProjection(content, record = {}, { digest }) {
  const checked = inspectObjectProjection(content, record);
  if (checked.recognized && checked.ok && `sha256:${await digest(canonicalJson(checked.value.template.snapshot))}` !== checked.value.template.digest) {
    return { recognized: true, ok: false, value: null, diagnostics: [{ severity: 'error', code: 'object-projection-invalid',
      message: 'Template snapshot does not match its locked digest', propertyPath: '/template/digest' }] };
  }
  return checked;
}

export function projectionRegistration(record, declaration) {
  const images = declaration.template.snapshot.fields.filter(field => field.type === 'image').map(field => declaration.configuration[field.id]).filter(Boolean);
  return { ...record, relations: [{ kind: 'references', targetId: declaration.sourceObjectId, slot: 'projection-source' }],
    assetBindings: [...new Set(images)].map(assetId => ({ assetId, role: 'image' })) };
}

export function validateProjectionDependencies(declaration, record, source) {
  const diagnostics = [];
  const issue = (message, propertyPath, details = {}) => diagnostics.push({ severity: 'error', code: 'object-projection-invalid', message, propertyPath, ...details });
  const core = source.documents.find(item => item.record?.id === declaration.sourceObjectId);
  if (!core || core.content === null || core.content === undefined || declaration.sourceObjectId === record.id
    || inspectObjectProjection(core.content, core.record).recognized) issue('Projection source must be another available ordinary registered document', '/sourceObjectId', { relatedObjectId: declaration.sourceObjectId });
  const origins = (record.relations || []).filter(item => item.slot === 'projection-source');
  if (origins.length !== 1 || origins[0].kind !== 'references' || origins[0].targetId !== declaration.sourceObjectId) issue('Projection source and registration disagree', '/sourceObjectId');
  for (const field of declaration.template.snapshot.fields.filter(field => field.type === 'image')) {
    const id = declaration.configuration[field.id]; if (!id) continue;
    const asset = (source.assets || []).find(item => item.record.id === id)?.record;
    if (!asset || asset.kind !== 'image' || !(record.assetBindings || []).some(item => item.assetId === id)) {
      issue('Projection image must have a registered image and binding', `/configuration/${field.id}`, { resourceId: id });
    }
  }
  return diagnostics;
}

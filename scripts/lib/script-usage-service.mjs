// A bounded read of current-workspace registered script references. No source
// execution, scene validation, asset read, dependency creation or author write.
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { captureScriptUsageDirectory, SCRIPT_USAGE_LIMITS } from '../../engine/script-usage.mjs';
import { normalizeSourcePath } from '../../engine/source-path.mjs';
import { createError } from '../../engine/service-error.mjs';

const matches = (expression, value) => typeof value === 'string' && expression.exec(value)?.[0] === value;
const uuid = value => matches(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, value);
const revision = value => matches(/^sha256:[a-f0-9]{64}$/, value);
const unicode = value => [...value].every(character => { const code = character.codePointAt(0); return code < 0xd800 || code > 0xdfff; });
const path = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && unicode(value)
  && !/[\u0000-\u001f\u007f]/.test(value) && !/^[A-Za-z]:/.test(value) && normalizeSourcePath(value) === value;
const fail = kind => { throw createError({ invalid: 400, conflict: 409, unavailable: 422, limit: 413 }[kind], {
  invalid: 'Invalid saved script usage request or directory.', conflict: 'Script usage sources changed; read again.',
  unavailable: 'The registered script usage source is unavailable.', limit: 'The complete script usage directory exceeds its limits.',
}[kind], {}, `script_usage_${kind}`); };
const registered = document => document?.record?.format === 'viento-document' && document.record.version === 1 && uuid(document.record.id)
  && path(document.sourcePath) && document.record.sourcePath === document.sourcePath;
const describe = document => ({ objectId: document.record.id, sourcePath: document.sourcePath, sourceRevision: document.sourceRevision });
function requestPath(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail('invalid');
  const properties = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(properties), property = properties.sourcePath;
  if (keys.length !== 1 || keys[0] !== 'sourcePath' || !property?.enumerable || !Object.hasOwn(property, 'value')
    || !path(property.value) || !property.value.toLowerCase().endsWith('.txt')) fail('invalid');
  return property.value;
}
export function createScriptUsageService(root) {
  return Object.freeze({ async inspect(input) {
    const sourcePath = requestPath(input);
    let observed;
    try { observed = await readWorldSnapshot(root); }
    catch (error) {
      if (['world_read_conflict', 'world_recovery_required', 'world_journal_invalid'].includes(error.errorCode)) fail('conflict');
      fail(error.statusCode === 413 ? 'limit' : 'unavailable');
    }
    const { source, projection } = observed;
    if (![2, 3].includes(source.workspace?.version)) fail('unavailable');
    const script = source.documents.find(document => document.sourcePath === sourcePath);
    if (!registered(script) || typeof script.content !== 'string' || !revision(script.sourceRevision)) fail('unavailable');
    if (script.content.length > SCRIPT_USAGE_LIMITS.scriptBytes || Buffer.byteLength(script.content, 'utf8') > SCRIPT_USAGE_LIMITS.scriptBytes) fail('limit');
    const references = [];
    for (const document of source.documents) {
      if (!document.record) continue;
      const linked = (document.record.relations || []).filter(relation => relation.kind !== 'part-of' && relation.targetId === script.record.id);
      if (!linked.length) continue;
      if (!registered(document)) fail('invalid');
      if (references.length >= SCRIPT_USAGE_LIMITS.references) fail('limit');
      const relationKinds = [...new Set(linked.map(relation => relation.kind))].sort();
      if (relationKinds.length > SCRIPT_USAGE_LIMITS.relationKinds) fail('limit');
      if (document.content !== null && (typeof document.content !== 'string' || !revision(document.sourceRevision))) fail('unavailable');
      if (document.content !== null && (document.content.length > SCRIPT_USAGE_LIMITS.documentBytes || Buffer.byteLength(document.content, 'utf8') > SCRIPT_USAGE_LIMITS.documentBytes)) fail('limit');
      references.push({ ...describe(document), relationKinds, content: document.content });
    }
    references.sort((a, b) => a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0);
    try { return captureScriptUsageDirectory({ format: 'viento-script-usage', schemaVersion: 1, worldId: projection.world.id, revision: projection.world.revision,
      script: describe(script), references }, sourcePath); }
    catch (error) { fail(error.errorCode === 'script_usage_limit' ? 'limit' : 'invalid'); }
  } });
}

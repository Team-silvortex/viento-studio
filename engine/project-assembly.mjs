// Portable project membership. Stable registered document identities are the
// only links; engines and generated paths are deliberately absent.
import { parseJsonSource } from './json-source.mjs';
import { inspectProjectInputMap } from './project-input-map.mjs';

export const PROJECT_ASSEMBLY_FORMAT = 'viento-project-assembly';
export const PROJECT_ASSEMBLY_FILE_MAX_BYTES = 32768;
export const PROJECT_ASSEMBLY_MAX_SCENES = 32;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const issue = (code, message, propertyPath = '', details = {}) => ({ severity: 'error', code, message, propertyPath, ...details });
const invalid = (message, propertyPath = '') => Object.assign(new TypeError(message), {
  errorCode: 'build_assembly_invalid', propertyPath,
});

function fields(value, array = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value) !== array) throw invalid('Expected plain assembly data.');
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw invalid('Expected plain assembly data.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)
      || !Object.hasOwn(descriptors[key], 'value') || !(array && key === 'length') && !descriptors[key].enumerable) throw invalid('Expected plain assembly data.');
  }
  return descriptors;
}

export function validateProjectAssembly(input) {
  const data = fields(input), version = data.schemaVersion?.value, keys = ['format', 'schemaVersion', 'title', 'entrySceneId', 'sceneIds', ...(version === 2 ? ['inputMapId'] : [])];
  if (Reflect.ownKeys(data).length !== keys.length || !keys.every(key => Object.hasOwn(data, key))) throw invalid('Expected only the project assembly declaration fields.');
  if (data.format.value !== PROJECT_ASSEMBLY_FORMAT || ![1, 2].includes(version)) throw invalid('Expected viento-project-assembly schemaVersion 1 or 2.');
  const title = data.title.value;
  if (typeof title !== 'string' || !title.trim() || title.length > 160 || /[\x00-\x1f\x7f]/.test(title)) throw invalid('Provide an assembly title of 1–160 characters.', '/title');
  for (const character of title) if (character.codePointAt(0) >= 0xd800 && character.codePointAt(0) <= 0xdfff) throw invalid('Use valid Unicode in the assembly title.', '/title');
  const members = fields(data.sceneIds.value, true), count = members.length.value;
  if (!Number.isSafeInteger(count) || count < 1 || count > PROJECT_ASSEMBLY_MAX_SCENES || Reflect.ownKeys(members).length !== count + 1) throw invalid('Select 1–32 unique registered scenes.', '/sceneIds');
  const sceneIds = [];
  for (let index = 0; index < count; index++) {
    const id = members[String(index)]?.value;
    if (!uuid(id) || sceneIds.includes(id)) throw invalid('Scene identities must be unique lowercase UUIDs.', `/sceneIds/${index}`);
    sceneIds.push(id);
  }
  const entrySceneId = data.entrySceneId.value;
  if (!uuid(entrySceneId) || !sceneIds.includes(entrySceneId)) throw invalid('The entry scene must be included in the assembly.', '/entrySceneId');
  if (version === 2 && (!uuid(data.inputMapId.value) || sceneIds.includes(data.inputMapId.value))) throw invalid('The input map must be a distinct registered document.', '/inputMapId');
  return Object.freeze({ format: PROJECT_ASSEMBLY_FORMAT, schemaVersion: version, title, entrySceneId, sceneIds: Object.freeze(sceneIds), ...(version === 2 ? { inputMapId: data.inputMapId.value } : {}) });
}

// Recognize malformed declarations too, without mistaking nested JSON examples
// for a top-level assembly. Escaped property names follow JSON semantics.
function hasMarker(content) {
  if (!/^\uFEFF?\s*\{/.test(content)) return false;
  let depth = 0, keyExpected = false;
  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (character === '"') {
      const start = index++;
      for (; index < content.length; index++) {
        if (content[index] === '\\') index++;
        else if (content[index] === '"') break;
      }
      if (index >= content.length) break;
      if (depth !== 1 || !keyExpected) continue;
      keyExpected = false;
      if (index - start > 64) continue;
      let key; try { key = JSON.parse(content.slice(start, index + 1)); } catch { continue; }
      if (key !== 'format') continue;
      let cursor = index + 1;
      while (cursor < content.length && /\s/.test(content[cursor])) cursor++;
      if (content[cursor++] !== ':') continue;
      while (cursor < content.length && /\s/.test(content[cursor])) cursor++;
      if (content[cursor] !== '"') continue;
      const startValue = cursor++;
      for (; cursor < content.length && cursor - startValue <= 256; cursor++) {
        if (content[cursor] === '\\') cursor++;
        else if (content[cursor] === '"') break;
      }
      try { if (content[cursor] === '"' && JSON.parse(content.slice(startValue, cursor + 1)) === PROJECT_ASSEMBLY_FORMAT) return true; } catch { /* Strict parser reports malformed JSON. */ }
    } else if (character === '{' || character === '[') { depth++; if (depth === 1) keyExpected = true; }
    else if (character === '}' || character === ']') { if (--depth <= 0) break; }
    else if (character === ',' && depth === 1) keyExpected = true;
  }
  return false;
}

export function inspectProjectAssembly(content) {
  if (typeof content !== 'string' || !hasMarker(content)) return { recognized: false, ok: true, value: null, diagnostics: [] };
  const fail = diagnostics => ({ recognized: true, ok: false, value: null, diagnostics });
  if (content.length > PROJECT_ASSEMBLY_FILE_MAX_BYTES || new TextEncoder().encode(content).length > PROJECT_ASSEMBLY_FILE_MAX_BYTES) {
    return fail([issue('build_assembly_limit', 'A project assembly must not exceed 32 KiB.')]);
  }
  const parsed = parseJsonSource(content);
  if (!parsed.ok) return fail(parsed.diagnostics.map(item => issue('build_assembly_invalid', item.message, item.propertyPath)));
  try { return { recognized: true, ok: true, value: validateProjectAssembly(parsed.value), diagnostics: [] }; }
  catch (error) { return fail([issue(error.errorCode || 'build_assembly_invalid', error.message, error.propertyPath || '')]); }
}

export function projectAssemblyDocumentIds(value) { const assembly = validateProjectAssembly(value); return [...assembly.sceneIds, ...(assembly.schemaVersion === 2 ? [assembly.inputMapId] : [])]; }

export function validateProjectAssemblyDependencies(input, record, source = {}) {
  const value = validateProjectAssembly(input), diagnostics = [];
  const documents = new Map((source.documents || []).filter(item => item.record).map(item => [item.record.id, item]));
  for (const [index, id] of value.sceneIds.entries()) {
    const propertyPath = `/sceneIds/${index}`, document = documents.get(id);
    if (id === record?.id || !document || typeof document.content !== 'string' || !document.sourcePath?.toLowerCase().endsWith('.json')) {
      diagnostics.push(issue('build_assembly_scene_missing', 'An assembly member must be another available, registered Scene2D document.', propertyPath, { relatedObjectId: id }));
      continue;
    }
    const parsed = parseJsonSource(document.content);
    if (!parsed.ok || parsed.value?.format !== 'viento-scene2d' || ![1, 2, 3].includes(parsed.value.schemaVersion)) {
      diagnostics.push(issue('build_assembly_scene_invalid', 'An assembly member must contain an unambiguous Scene2D declaration.', propertyPath, { relatedObjectId: id }));
    }
  }
  if (value.schemaVersion === 2) {
    const document = documents.get(value.inputMapId);
    if (value.inputMapId === record?.id || !document || typeof document.content !== 'string' || !document.sourcePath?.toLowerCase().endsWith('.json')) {
      diagnostics.push(issue('build_assembly_input_missing', 'The input map must be another available registered JSON document.', '/inputMapId', { relatedObjectId: value.inputMapId }));
    } else {
      try { inspectProjectInputMap(document.content); }
      catch { diagnostics.push(issue('build_assembly_input_invalid', 'The input map declaration is invalid.', '/inputMapId', { relatedObjectId: value.inputMapId })); }
    }
  }
  return diagnostics;
}

// Recipe recognition and dependency inspection are portable, read-only views of
// author source. Rust remains the only validator and expander of recipe rules.
import { expandSceneComposition } from './scene-composition.mjs';

const FORMAT = 'viento-scene-composition';
const emptyDependencies = () => ({ objectIds: [], imageResourceIds: [] });
const issue = (message, propertyPath = '', details = {}) => ({ severity: 'error', code: 'composition-document-invalid', message, propertyPath, ...details });

function parsedSource(content) {
  if (typeof content !== 'string') return { value: null, recognized: false };
  const source = content.replace(/^\uFEFF/, '');
  try {
    const value = JSON.parse(source);
    // A successfully parsed ordinary document exits the recipe workflow when
    // its top-level format is removed, even if examples contain recipe markers.
    return { value, recognized: value?.format === FORMAT };
  } catch { /* A partial recipe with its top-level marker still gets diagnostics. */ }
  if (!/^\s*\{/.test(source)) return { value: null, recognized: false };
  // Only classify a top-level JSON string key/value pair. This small token walk
  // is deliberately not a JSON parser: malformed recipes are rejected by Rust.
  // It ignores markers in strings, nested examples, arrays, or unrelated fields.
  let depth = 0, expectingKey = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      const start = index;
      index += 1;
      for (; index < source.length; index += 1) {
        if (source[index] === '\\') index += 1;
        else if (source[index] === '"') break;
      }
      if (index >= source.length) break;
      let token;
      try { token = JSON.parse(source.slice(start, index + 1)); } catch { continue; }
      if (depth === 1 && expectingKey) {
        expectingKey = false;
        if (token !== 'format') continue;
        const remainder = source.slice(index + 1);
        const match = /^\s*:\s*("(?:[^"\\]|\\.)*")/.exec(remainder);
        if (match) {
          try { if (JSON.parse(match[1]) === FORMAT) return { value: null, recognized: true }; } catch { /* Invalid marker string. */ }
        }
      }
    } else if (character === '{' || character === '[') {
      depth += 1;
      if (depth === 1) expectingKey = true;
    } else if (character === '}' || character === ']') {
      depth -= 1;
      if (depth <= 0) break;
    } else if (character === ',' && depth === 1) expectingKey = true;
  }
  return { value: null, recognized: false };
}

function references(value) {
  const objects = new Map(), images = new Map();
  for (const [fragmentIndex, fragment] of value.fragments.entries()) {
    for (const [actorIndex, actor] of fragment.actors.entries()) {
      const pointer = `/fragments/${fragmentIndex}/actors/${actorIndex}`;
      if (!objects.has(actor.objectId)) objects.set(actor.objectId, `${pointer}/objectId`);
      if (typeof actor.imageResourceId === 'string' && !images.has(actor.imageResourceId)) images.set(actor.imageResourceId, `${pointer}/imageResourceId`);
    }
  }
  for (const [placementIndex, placement] of value.placements.entries()) {
    for (const [overrideIndex, override] of (placement.overrides || []).entries()) {
      const id = override.values.imageResourceId;
      if (typeof id === 'string' && !images.has(id)) images.set(id, `/placements/${placementIndex}/overrides/${overrideIndex}/values/imageResourceId`);
    }
  }
  return { objects, images };
}

export function inspectSceneComposition(content) {
  const parsed = parsedSource(content);
  if (!parsed.recognized) return { recognized: false, ok: true, value: null, dependencies: emptyDependencies(), diagnostics: [] };
  try {
    expandSceneComposition(content);
    const value = parsed.value ?? JSON.parse(content.replace(/^\uFEFF/, ''));
    const { objects, images } = references(value);
    return { recognized: true, ok: true, value,
      dependencies: { objectIds: [...objects.keys()].sort(), imageResourceIds: [...images.keys()].sort() }, diagnostics: [] };
  } catch (error) {
    return { recognized: true, ok: false, value: null, dependencies: emptyDependencies(),
      diagnostics: [issue(error.message || 'Invalid scene composition document.', '', typeof error.errorCode === 'string' ? { reasonCode: error.errorCode } : {})] };
  }
}

export function validateSceneCompositionDependencies(checked, record = {}, source = {}) {
  if (!checked?.recognized) return [];
  if (!checked.ok) return [...checked.diagnostics];
  const { objects, images } = references(checked.value), diagnostics = [];
  for (const id of [...objects.keys()].sort()) {
    const document = (source.documents || []).find(item => item.record?.id === id);
    if (id === record.id || !document || typeof document.content !== 'string' || parsedSource(document.content).recognized) {
      diagnostics.push(issue('A composition actor must reference another available registered document, not a composition recipe.', objects.get(id), { relatedObjectId: id }));
    }
  }
  for (const id of [...images.keys()].sort()) {
    const asset = (source.assets || []).find(item => item.record?.id === id)?.record;
    if (!asset || asset.kind !== 'image') diagnostics.push(issue('A composition image must reference an available registered image.', images.get(id), { resourceId: id }));
  }
  return diagnostics;
}

// Read-only composition model: the author recipe stays authoritative. The
// generated Scene2D observation exists only while reusing ordinary model rules.
import { expandSceneComposition } from './scene-composition.mjs';
import { inspectSceneComposition, validateSceneCompositionDependencies } from './scene-composition-document.mjs';
import { resolveScene2DModel } from './scene-model.mjs';
import { sceneCreateRegistration } from './world-scene-create.mjs';
import { createWorldProjection, canonicalJson } from './world-projection.mjs';
import { parseJsonSource, locateJsonSource } from './json-source.mjs';

const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const combine = (original = [], derived = []) => [...new Map([...original, ...derived].map(value => [canonicalJson(value), value])).values()];

export async function resolveSceneCompositionPreview(observed, recipeId, { digest }) {
  const document = observed?.source?.documents?.find(item => item.record?.id === recipeId);
  const checked = inspectSceneComposition(document?.content);
  const result = (ok, model, diagnostics, composition = null) => ({ recognized: checked.recognized, ok, model, diagnostics, composition });
  if (!checked.recognized) return result(true, null, []);
  const content = document.content, sourcePath = document.sourcePath;
  const sourceRevision = `sha256:${await digest(content)}`;
  if (!revision(sourceRevision)) throw new TypeError('Composition preview requires SHA-256 source digests.');
  const parsed = parseJsonSource(content);
  const location = (propertyPath = '', { exact = true } = {}) => {
    const range = parsed.ok && locateJsonSource(parsed, propertyPath, { nearest: true });
    return { objectId: recipeId, sourcePath, sourceRevision, propertyPath,
      ...(range ? { sourceRange: { ...range, exact: range.exact && exact } } : {}) };
  };
  const diagnostic = (code, message, propertyPath = '', extra = {}) => ({ severity: 'error', code, message, ...extra, ...location(propertyPath) });
  if (!document.record || ![2, 3].includes(observed.source.workspace?.version)
    || !sourcePath?.toLowerCase().endsWith('.json') || !observed.projection?.objects?.some(item => item.id === recipeId)) {
    return result(false, null, [diagnostic('composition-document-invalid', 'Preview requires a registered JSON recipe in a v2 or v3 workspace.')]);
  }
  if (sourceRevision !== document.sourceRevision) return result(false, null, [diagnostic('composition-document-invalid', 'The recipe observation does not match its exact source revision.')]);
  if (!checked.ok) return result(false, null, checked.diagnostics.map(value => diagnostic(value.code, value.message, value.propertyPath, value)));
  const composition = { format: 'viento-scene-composition-preview', schemaVersion: 1, recipeObjectId: recipeId,
    sourcePath, sourceRevision, fragmentCount: checked.value.fragments.length, placementCount: checked.value.placements.length };
  const dependencies = validateSceneCompositionDependencies(checked, document.record, observed.source);
  if (dependencies.length) return result(false, null, dependencies.map(value => diagnostic(value.code, value.message, value.propertyPath, value)), composition);
  const expanded = expandSceneComposition(content);
  const generatedContent = JSON.stringify(expanded.scene);
  const generatedSource = structuredClone(observed.source);
  const generated = generatedSource.documents.find(item => item.record?.id === recipeId);
  const derived = sceneCreateRegistration(generated.record, generatedContent);
  generated.record = { ...generated.record,
    relations: combine(generated.record.relations, derived.relations),
    assetBindings: combine(generated.record.assetBindings, derived.assetBindings) };
  generated.descriptor = { ...generated.descriptor, ...generated.record };
  generated.content = generatedContent;
  generated.sourceRevision = `sha256:${await digest(generatedContent)}`;
  const projection = await createWorldProjection(generatedSource, { digest });
  const resolved = resolveScene2DModel({ source: generatedSource, projection }, recipeId);

  function role(path, entry) {
    if (path === entry.templatePath || path.startsWith(`${entry.templatePath}/`)) return 'template';
    if (path === `${entry.placementPath}/offset` || path.startsWith(`${entry.placementPath}/offset/`)) return 'offset';
    if (path.startsWith(`${entry.placementPath}/overrides/`)) return 'override';
    return 'identity';
  }
  function contributions(paths, entry) {
    const unique = [...new Set(paths)];
    const primary = location(unique[0] || entry.templatePath, { exact: unique.length === 1 });
    if (unique.length > 1) primary.contributors = unique.map(path => ({ ...location(path), role: role(path, entry) }));
    return primary;
  }
  function declaration(entry) {
    const paths = [entry.templatePath, entry.identityPath];
    for (const contributors of Object.values(entry.fields)) {
      for (const path of contributors) if (!path.startsWith(`${entry.templatePath}/`)) paths.push(path);
    }
    return contributions(paths, entry);
  }
  function mappedPath(propertyPath = '') {
    const actor = /^\/actors\/(0|[1-9][0-9]*)(?:\/(.*))?$/.exec(propertyPath);
    const group = /^\/groups\/(0|[1-9][0-9]*)(?:\/(.*))?$/.exec(propertyPath);
    if (actor || group) {
      const match = actor || group, entry = expanded.sourceMap[actor ? 'actors' : 'groups'][Number(match[1])];
      if (!entry) return location('', { exact: false });
      if (!match[2]) return declaration(entry);
      const [field, ...tail] = match[2].split('/');
      if (field === (actor ? 'instanceId' : 'groupId')) return location(entry.identityPath);
      const paths = entry.fields[field];
      if (paths) return contributions(paths.map(path => path + (tail.length ? `/${tail.join('/')}` : '')), entry);
      // Optional fields may not be declared. Point to their true template
      // neighborhood, never an invented /actors/N location in generated JSON.
      const originalField = !actor && field === 'parentGroupId' ? 'parentKey' : field;
      return location(`${entry.templatePath}/${originalField}${tail.length ? `/${tail.join('/')}` : ''}`, { exact: false });
    }
    if (/^\/(title|viewport|background)(?:\/|$)/.test(propertyPath)) return location(`/scene${propertyPath}`);
    if (propertyPath === '/actors' || propertyPath === '/groups') return location('/fragments', { exact: false });
    return location(propertyPath);
  }
  const remap = value => {
    if (value?.objectId !== recipeId) return structuredClone(value);
    const { sourceRange, contributors, ...details } = value;
    return { ...details, ...mappedPath(value.propertyPath || '') };
  };
  const diagnostics = resolved.diagnostics.map(remap);
  if (!resolved.ok || !resolved.model) return result(false, null, diagnostics, composition);
  const model = structuredClone(resolved.model);
  model.worldRevision = observed.projection.world.revision;
  model.scene.sourceRevision = sourceRevision;
  model.sourceLocations.scene = location('');
  model.sourceLocations.sceneFields = Object.fromEntries(['title', 'viewport', 'background'].map(field => [field, location(`/scene/${field}`)]));
  model.sourceLocations.actors = model.sourceLocations.actors.map((value, index) => {
    const entry = expanded.sourceMap.actors[index];
    return { ...value, definition: remap(value.definition), declaration: declaration(entry),
      fields: Object.fromEntries(Object.entries(value.fields).map(([field, value]) => [field, remap(value)])),
      composition: { fragmentId: entry.fragmentId, placementId: entry.placementId, localKey: entry.localKey } };
  });
  model.sourceLocations.groups = model.sourceLocations.groups.map((value, index) => {
    const entry = expanded.sourceMap.groups[index];
    return { ...value, declaration: declaration(entry),
      fields: Object.fromEntries(Object.entries(value.fields).map(([field, value]) => [field, remap(value)])),
      composition: { fragmentId: entry.fragmentId, placementId: entry.placementId, localKey: entry.localKey } };
  });
  model.actors = model.actors.map(actor => ({ ...actor, declaration: remap(actor.declaration),
    ...(actor.fieldSources ? { fieldSources: Object.fromEntries(Object.entries(actor.fieldSources).map(([field, value]) => [field, remap(value)])) } : {}) }));
  return result(true, model, diagnostics, composition);
}

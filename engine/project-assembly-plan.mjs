// Assemble complete existing scene plans without flattening scene-local state.
import { inspectProjectAssembly, validateProjectAssemblyDependencies } from './project-assembly.mjs';
import { createScene2DPlan } from './build-plan.mjs';
import { parseJsonSource, locateJsonSource } from './json-source.mjs';
import { canonicalJson } from './canonical-json.mjs';

export function createProjectAssemblyPlan(observed, targetRef) {
  const { source, projection } = observed;
  const document = source.documents.find(item => item.record?.id === targetRef || item.sourcePath === targetRef);
  const parsed = document && parseJsonSource(document.content);
  const location = propertyPath => {
    const range = parsed?.ok && locateJsonSource(parsed, propertyPath, { nearest: true });
    return { objectId: document?.record?.id || null, sourcePath: document?.sourcePath || '',
      sourceRevision: document?.sourceRevision ?? null, propertyPath, ...(range ? { sourceRange: range } : {}) };
  };
  const fail = diagnostics => ({ ok: false, plan: null, diagnostics: diagnostics.map(item => ({ ...location(item.propertyPath || ''), ...item })) });
  if (!document?.record?.id || !document.sourcePath?.toLowerCase().endsWith('.json')) return fail([{
    severity: 'error', code: 'build_assembly_required', message: 'Select a registered JSON project assembly.', propertyPath: '',
  }]);
  const checked = inspectProjectAssembly(document.content);
  if (!checked.recognized || !checked.ok) return fail(checked.recognized ? checked.diagnostics : [{
    severity: 'error', code: 'build_assembly_invalid', message: 'Expected a project assembly declaration.', propertyPath: '',
  }]);
  const dependencies = validateProjectAssemblyDependencies(checked.value, document.record, source);
  if (dependencies.length) return fail(dependencies);
  const scenes = [], diagnostics = [], resources = new Map(), capabilities = new Set(['project.scenes']);
  for (const id of checked.value.sceneIds) {
    const result = createScene2DPlan(observed, id);
    if (!result.ok) { diagnostics.push(...result.diagnostics); continue; }
    scenes.push(result.plan);
    for (const capability of result.plan.requiredCapabilities) capabilities.add(capability);
    for (const resource of result.plan.resources) {
      const previous = resources.get(resource.id);
      if (previous && canonicalJson(previous) !== canonicalJson(resource)) diagnostics.push({
        severity: 'error', code: 'build_assembly_resource_conflict', message: 'A shared resource has inconsistent scene descriptors.',
        ...location('/sceneIds'), resourceId: resource.id,
      });
      else resources.set(resource.id, resource);
    }
  }
  if (resources.size > 128) diagnostics.push({ severity: 'error', code: 'build_assembly_limit',
    message: 'A project assembly can include at most 128 distinct resources.', ...location('/sceneIds') });
  if (diagnostics.length) return { ok: false, plan: null, diagnostics };
  return { ok: true, plan: { format: 'viento-build-plan', schemaVersion: 1, kind: 'project',
    projectId: source.workspace.id, worldId: projection.world.id, worldRevision: projection.world.revision,
    assembly: { objectId: document.record.id, sourcePath: document.sourcePath, sourceRevision: document.sourceRevision, title: checked.value.title },
    entrySceneId: checked.value.entrySceneId, scenes,
    resources: [...resources.values()].sort((a, b) => a.id.localeCompare(b.id)),
    requiredCapabilities: [...capabilities].sort(),
  }, diagnostics: [] };
}

export { validateProjectAssemblyPlan } from './project-assembly-plan-contract.mjs';

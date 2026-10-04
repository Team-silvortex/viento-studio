// Build DTO adapter. Source locations are editor metadata kept outside the
// frozen plan. Valid v1 inputs still emit identical legacy snapshots and artifacts.
import { resolveScene2DModel } from './scene-model.mjs';
export const SCENE2D_CAPABILITIES = ['scene2d', 'input.arrows', 'state.movement', 'image'];
export { PROJECT_BUILD_API_PATH } from './project-build-contract.mjs';

export function scene2DModelToPlan(model) {
  if (model?.format !== 'viento-scene-model' || ![1, 2, 3].includes(model.schemaVersion)) throw new TypeError('Expected a resolved Scene2D model.');
  const clone = value => JSON.parse(JSON.stringify(value));
  return { format: 'viento-build-plan', schemaVersion: Math.min(model.schemaVersion, 2), kind: 'scene2d',
    projectId: model.projectId, worldId: model.worldId, worldRevision: model.worldRevision,
    scene: clone(model.scene),
    requiredCapabilities: SCENE2D_CAPABILITIES.filter(capability => capability !== 'image' || model.resources.length),
    actors: clone(model.actors).map(actor => { if (model.schemaVersion === 3) delete actor.groupId; return actor; }), resources: clone(model.resources).sort((a, b) => a.id.localeCompare(b.id)) };
}

export function createScene2DPlan(observed, sceneRef) {
  const resolved = resolveScene2DModel(observed, sceneRef);
  return { ok: resolved.ok, plan: resolved.model ? scene2DModelToPlan(resolved.model) : null, diagnostics: resolved.diagnostics };
}

// Recovery checks frozen declaration and guarded registrations only, retaining
// legacy duplicate-key reading. It never revalidates current projection text.
export function validateScene2DRegistration(observed, sceneRef) {
  const resolved = resolveScene2DModel(observed, sceneRef, { mode: 'registration' });
  return { ok: resolved.ok, plan: resolved.model ? scene2DModelToPlan(resolved.model) : null, diagnostics: resolved.diagnostics };
}

export function buildActorFieldLocation(actor, field) {
  return actor?.fieldSources?.[field] || (actor?.declaration ? {
    ...actor.declaration, propertyPath: `${actor.declaration.propertyPath}/${field}`,
  } : null);
}

export function checkBuildCapabilities(plan, backend) {
  return plan.requiredCapabilities.filter(capability => !backend.capabilities.includes(capability)).map(capability => ({
    severity: 'error', code: 'build_capability_missing', message: `Backend lacks capability: ${capability}`,
    objectId: plan.scene.objectId, sourcePath: plan.scene.sourcePath, propertyPath: '', capability,
  }));
}

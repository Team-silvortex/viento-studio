import { sceneMenuCapabilities } from './scene-menu-capability.mjs';
import { scenePauseCapabilities } from './scene-pause-capability.mjs';
import { sceneRestartCapabilities } from './scene-restart-capability.mjs';
// Build DTO adapter. Source locations are editor metadata kept outside the
// frozen plan. Valid v1 inputs still emit identical legacy snapshots and artifacts.
import { resolveScene2DModel } from './scene-model.mjs';
import { resolveSceneBehaviors } from './scene-behaviors.mjs';
import { resolveSceneAudio, SCENE_AUDIO_CAPABILITIES } from './scene-audio.mjs';
import { resolveSceneAnimation, sceneAnimationCapabilities } from './scene-animation.mjs';
import { resolveScenePhysics2D, scenePhysics2DCapabilities } from './scene-physics2d.mjs';
import { resolveSceneCamera2D, sceneCamera2DCapabilities } from './scene-camera2d.mjs';
import { resolveSceneHUD2D, sceneHUD2DCapabilities } from './scene-hud2d.mjs';
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
  if (!resolved.ok) return { ok: false, plan: null, diagnostics: resolved.diagnostics };
  return attachSceneBehaviorPlan(observed, scene2DModelToPlan(resolved.model));
}

// Only saved executable planning opts into declared behaviors. Static scene
// previews and registration recovery continue to use the original model DTO.
export function attachSceneBehaviorPlan(observed, plan) {
  const resolved = resolveSceneBehaviors(observed, plan);
  if (!resolved.ok) return { ok: false, plan: null, diagnostics: resolved.diagnostics };
  const behavioral = resolved.behaviors ? { ...plan, schemaVersion: 3,
    requiredCapabilities: [...new Set([...plan.requiredCapabilities, 'behavior.bindings', `behavior.${resolved.behaviors.language}`, ...sceneRestartCapabilities(resolved.behaviors), ...scenePauseCapabilities(resolved.behaviors), ...sceneMenuCapabilities(resolved.behaviors)])],
    behaviors: resolved.behaviors } : plan;
  const audio = resolveSceneAudio(observed, behavioral);
  if (!audio.ok) return { ok: false, plan: null, diagnostics: audio.diagnostics };
  const audible = audio.audio ? { ...behavioral, audio: audio.audio,
    requiredCapabilities: [...behavioral.requiredCapabilities, ...SCENE_AUDIO_CAPABILITIES],
    resources: [...behavioral.resources, ...audio.resources].sort((a, b) => a.id.localeCompare(b.id)) } : behavioral;
  const animation = resolveSceneAnimation(observed, audible);
  if (!animation.ok) return { ok: false, plan: null, diagnostics: animation.diagnostics };
  const animated = animation.animation ? { ...audible, animation: animation.animation,
    requiredCapabilities: [...audible.requiredCapabilities, ...sceneAnimationCapabilities(animation.animation.document)] } : audible;
  const physics = resolveScenePhysics2D(observed, animated);
  if (!physics.ok) return { ok: false, plan: null, diagnostics: physics.diagnostics };
  const physical = physics.physics ? { ...animated, physics: physics.physics,
    requiredCapabilities: [...animated.requiredCapabilities, ...scenePhysics2DCapabilities(physics.physics.document)] } : animated;
  const camera = resolveSceneCamera2D(observed, physical);
  if (!camera.ok) return { ok: false, plan: null, diagnostics: camera.diagnostics };
  const framed = camera.camera2d ? { ...physical, camera2d: camera.camera2d,
    requiredCapabilities: [...physical.requiredCapabilities, ...sceneCamera2DCapabilities(camera.camera2d.document)] } : physical;
  const hud = resolveSceneHUD2D(observed, framed);
  if (!hud.ok) return { ok: false, plan: null, diagnostics: hud.diagnostics };
  return { ok: true, plan: hud.hud2d ? { ...framed, hud2d: hud.hud2d,
    requiredCapabilities: [...framed.requiredCapabilities, ...sceneHUD2DCapabilities(hud.hud2d.document)] } : framed, diagnostics: [] };
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

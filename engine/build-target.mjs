// Shared target/entry distinction. Single-scene plans retain their exact DTOs.
import { createScene2DPlan } from './build-plan.mjs';
import { inspectProjectAssembly } from './project-assembly.mjs';
import { createProjectAssemblyPlan } from './project-assembly-plan.mjs';

export function createBuildTargetPlan(observed, targetRef) {
  const document = observed.source.documents.find(item => item.record?.id === targetRef || item.sourcePath === targetRef);
  return inspectProjectAssembly(document?.content).recognized
    ? createProjectAssemblyPlan(observed, targetRef) : createScene2DPlan(observed, targetRef);
}

export const buildTargetIdentity = plan => plan?.kind === 'project' ? plan.assembly : plan?.scene;
export const scenePlans = plan => plan?.kind === 'project' ? plan.scenes : plan ? [plan] : [];
export const entryScenePlan = plan => plan?.kind === 'project' ? plan.scenes.find(scene => scene.scene.objectId === plan.entrySceneId) || null : plan;

// Shared eligibility for finite project-entry control and verification. The
// generated project still runs as a whole; these features admit data-only entry scenes.
export function isProjectControlEntryEligible(plan) {
  if (plan?.kind !== 'project' || plan.schemaVersion !== 1) return false;
  const entry = entryScenePlan(plan);
  return Boolean(entry && [1, 2].includes(entry.schemaVersion) && !entry.behaviors && !entry.animation && !entry.physics && !entry.audio);
}

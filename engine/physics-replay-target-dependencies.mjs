// Author references name Scene2D instances. Physical/input eligibility belongs
// to the frozen runtime plan and is deliberately checked later, before a job.
import { validateProjectPhysics2DInputReplay } from './project-physics2d-input-replay.mjs';

export function physicsReplayTargetDependencyDiagnostics(input, scene, { code, propertyPath }) {
  const program = validateProjectPhysics2DInputReplay(input);
  if (program.schemaVersion === 1) return [];
  const instances = new Set(scene.actors.map(actor => actor.instanceId)), diagnostics = [];
  program.steps.forEach((step, stepIndex) => step.inputs.forEach((row, rowIndex) => {
    if (!instances.has(row.instanceId)) diagnostics.push({ severity: 'error', code,
      message: 'The input instance no longer belongs to this scene.',
      propertyPath: `${propertyPath}/steps/${stepIndex}/inputs/${rowIndex}/instanceId` });
  }));
  return diagnostics;
}

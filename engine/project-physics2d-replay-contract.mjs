// Admission and completion checks for the isolated input replay experiment.
// No native process is started and no movement is predicted here.
import { canonicalJson } from './canonical-json.mjs';
import { validateProjectAssemblyPlan } from './project-assembly-plan-contract.mjs';
import { validateProjectPhysics2DObservation, PROJECT_PHYSICS2D_TRACE_LIMIT } from './project-physics2d-trace.mjs';
import { freezeProjectRuntimeData } from './project-runtime-contracts.mjs';
import { PROJECT_PHYSICS2D_INPUT_REPLAY_DELTA as delta, PROJECT_PHYSICS2D_INPUT_REPLAY_STEPS as steps } from './project-physics2d-input-replay.mjs';

const unsupported = () => Object.assign(new TypeError('Physics input replay requires one isolated observable physics scene.'), {
  errorCode: 'runtime_physics2d_input_unsupported',
});
const incomplete = () => Object.assign(new TypeError('Physics input replay did not produce a complete observation.'), {
  errorCode: 'runtime_physics2d_input_incomplete',
});
const close = (a, b) => Number.isFinite(a) && Math.abs(a - b) <= 1e-6;

function inspectPlan(input) {
  const plan = validateProjectAssemblyPlan(input);
  if (plan.scenes.length !== 1 || plan.scenes[0].scene.objectId !== plan.entrySceneId) throw unsupported();
  const scene = plan.scenes[0];
  if (!scene.physics || ['behaviors', 'animation', 'audio'].some(key => Object.hasOwn(scene, key))) throw unsupported();
  const bodies = scene.physics.document.bodies.filter(body => body.kind === 'character');
  if (!bodies.length || bodies.length * steps > PROJECT_PHYSICS2D_TRACE_LIMIT) throw unsupported();
  const byInstance = new Map(bodies.map(body => [body.instanceId, body]));
  const characters = scene.actors.filter(actor => byInstance.has(actor.instanceId)).map(actor => {
    const body = byInstance.get(actor.instanceId), index = scene.physics.document.bodies.indexOf(body);
    return { body, actor, source: scene.physics.locations.bodies[index].declaration };
  });
  if (characters.length !== bodies.length) throw unsupported();
  const colliders = new Map(scene.physics.document.bodies.filter(body => body.kind !== 'sensor').map(body => {
    const index = scene.physics.document.bodies.indexOf(body), actor = scene.actors.find(item => item.instanceId === body.instanceId);
    return [body.id, { body, actor, source: scene.physics.locations.bodies[index].declaration }];
  }));
  return { plan, scene, characters, colliders };
}

export function validateProjectPhysics2DReplayPlan(input, { backendId, capabilities } = {}) {
  if (backendId !== 'org.viento.godot4' || !Array.isArray(capabilities) || !capabilities.includes('physics.observe2d')) throw unsupported();
  return inspectPlan(input).plan;
}

export function validateProjectPhysics2DReplayObservation(inputPlan, inputObservation) {
  const { plan, scene, characters, colliders } = inspectPlan(inputPlan);
  let view;
  try { view = validateProjectPhysics2DObservation(inputObservation); }
  catch { throw incomplete(); }
  if (view.assemblyId !== plan.assembly.objectId || view.phase !== 'finished' || view.limited
    || view.samples.length !== characters.length * steps) throw incomplete();
  for (let index = 0; index < view.samples.length; index++) {
    const sample = view.samples[index], step = Math.floor(index / characters.length) + 1;
    const { body, actor, source } = characters[index % characters.length];
    if (sample.sequence !== index + 1 || sample.sceneId !== scene.scene.objectId || sample.visitIndex !== 1
      || sample.stepIndex !== step || !close(sample.deltaSeconds, delta) || !close(sample.timeSeconds, step * delta)
      || sample.bodyId !== body.id || sample.instanceId !== actor.instanceId || sample.objectId !== actor.objectId
      || sample.response !== (body.collisionResponse || 'stop') || canonicalJson(sample.source) !== canonicalJson(source)) throw incomplete();
    for (const contact of sample.contacts) {
      if (contact.collider === null) continue;
      const expected = colliders.get(contact.collider.bodyId);
      if (!expected || expected.body.id === body.id || contact.collider.instanceId !== expected.actor.instanceId
        || contact.collider.objectId !== expected.actor.objectId || canonicalJson(contact.collider.source) !== canonicalJson(expected.source)) throw incomplete();
    }
  }
  return freezeProjectRuntimeData(view);
}

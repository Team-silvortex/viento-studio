export const observationId = number => `${String(number).padStart(8, '0')}-1111-4111-8111-111111111111`;
export const observationRevision = 'sha256:' + 'a'.repeat(64);
export const physicsObservationSource = (index = 0) => ({ objectId: observationId(50), sourcePath: 'documents/physics/接触 <img src=x>.json', sourceRevision: observationRevision,
  propertyPath: '/bodies/' + index, sourceRange: { start: 20 + index * 100, end: 100 + index * 100, encoding: 'utf-16', propertyPath: '/bodies/' + index, exact: true } });
export function physicsObservationSample(sequence = 1, { instance = 0, step = 1, visit = 1, contact = true } = {}) {
  return { protocol: 1, event: 'sample', sequence, visitIndex: visit, sceneId: observationId(visit === 1 ? 2 : 3), stepIndex: step,
    timeSeconds: step * .125, deltaSeconds: .125, bodyId: observationId(10 + instance), instanceId: observationId(20 + instance), objectId: observationId(30 + instance),
    response: 'slide', source: physicsObservationSource(instance), positionBefore: [10, 20], positionAfter: [12, 24], requestedMotion: [6, 4], displacement: [2, 4],
    contacts: contact ? [{ collider: { bodyId: observationId(40), instanceId: observationId(41), objectId: observationId(42), source: physicsObservationSource(2) },
      position: [15, 20], normal: [-1, 0], travel: [2, 1], remainder: [4, 3] }] : [] };
}
export function physicsObservationSnapshot(options = {}) {
  return { format: 'viento-physics2d-observation', schemaVersion: 1, assemblyId: observationId(1), phase: 'finished', limit: 256, limited: false,
    samples: [physicsObservationSample()], ...options };
}

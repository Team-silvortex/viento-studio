// A read-only view of one admitted movement sample, never a collision solver or
// an inferred trajectory. The two displacement endpoints share the before
// origin; native contact points remain independent points in the same frame.
import { validateProjectPhysics2DObservation } from './project-physics2d-trace.mjs';
import { freezeProjectRuntimeData } from './project-runtime-contracts.mjs';

// A finite scalar times 2^shift. Halving before an overflowing subtraction
// preserves a contact's relative position without constructing Infinity.
const scalar = value => ({ value, shift: 0 });
function difference(after, before) {
  const value = after - before;
  return Number.isFinite(value) ? scalar(value) : { value: after / 2 - before / 2, shift: 1 };
}

// Applying the power in two finite stages also represents subnormal-only
// motion. The power itself need not exist as a finite nonzero JS number.
function project({ value, shift }, exponent) {
  if (value === 0) return 0;
  const power = exponent - shift;
  return power >= 0
    ? value * 2 ** -Math.min(power, 1023) * 2 ** -Math.max(0, power - 1023)
    : value * 2 ** Math.min(-power, 1023) * 2 ** Math.max(0, -power - 1023);
}

export function createProjectPhysics2DSampleDiagram(observation, sequence) {
  try {
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 256) return null;
    // Admit the complete observation, including every unselected row. This
    // descriptor-safe copy also prevents getter/serializer execution and keeps
    // the returned raw sample independent of later caller mutation.
    const admitted = validateProjectPhysics2DObservation(observation), sample = admitted.samples[sequence - 1];
    if (!sample || sample.sequence !== sequence) return null;
    const requested = sample.requestedMotion.map(scalar), actual = sample.displacement.map(scalar);
    const contacts = sample.contacts.map(contact => contact.position.map((value, axis) => difference(value, sample.positionBefore[axis])));
    const scalars = [...requested, ...actual, ...contacts.flat()];
    let scaleExponent = Math.max(...scalars.filter(row => row.value !== 0).map(row => Math.ceil(Math.log2(Math.abs(row.value))) + row.shift));
    if (!Number.isFinite(scaleExponent)) scaleExponent = 0;
    // log2 may round a value just above a power of two down to that power.
    // Recheck the actual projected values rather than clipping a true endpoint.
    if (scalars.some(row => Math.abs(project(row, scaleExponent)) > 1)) scaleExponent++;
    const point = pair => pair.map(row => project(row, scaleExponent));
    const points = { before: [0, 0], requested: point(requested), actual: point(actual),
      contacts: contacts.map((position, index) => {
        const normal = sample.contacts[index].normal, length = Math.hypot(...normal);
        return { index, position: point(position), normal: normal.map(value => value / length) };
      }) };
    return freezeProjectRuntimeData({ format: 'viento-physics2d-sample-diagram', schemaVersion: 1,
      assemblyId: admitted.assemblyId, sample, points,
      bounds: { minX: -1.25, minY: -1.25, maxX: 1.25, maxY: 1.25 },
      // world-relative scalar / 2^scaleExponent; consumers use points directly.
      // A nonzero value lost to an extreme scale ratio is explicitly reported,
      // while the complete original sample remains available at full precision.
      projection: { kind: 'relative-uniform', scaleExponent,
        degraded: scalars.some(row => row.value !== 0 && project(row, scaleExponent) === 0) } });
  } catch { return null; }
}

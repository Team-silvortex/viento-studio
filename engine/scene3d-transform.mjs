// A source proposal is an in-memory authoring intent, never a save/World or
// backend request. Rust owns scene and transform rules; this layer owns review.
import { parseScene3DSource } from './scene3d.mjs';
import { dispatchStudioCoreScene3DPatch, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
import { assertScene3DAuthoringRecord, captureScene3DAuthoringSource } from './scene3d-authoring.mjs';

const proposals = new WeakSet();
const error = (code = 'scene3d_transform_invalid') => Object.assign(new TypeError('The reviewed 3D transform no longer matches the current source.'), { errorCode: code });
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};
const record = (value, keys) => assertScene3DAuthoringRecord(value, keys, error);
const snapshot = input => captureScene3DAuthoringSource(input, error);

export function createScene3DTransformProposal(source, edit) {
  const captured = snapshot(source); record(edit, ['instanceId', 'values']);
  const patched = dispatchStudioCoreScene3DPatch({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'scene3d.patchObjectTransform', content: captured.content, instanceId: edit.instanceId, values: edit.values });
  if (!patched.changedPaths.length) throw error('scene3d_transform_unchanged');
  const before = parseScene3DSource(captured.content).model, after = parseScene3DSource(patched.afterContent).model;
  const proposal = freeze({ kind: 'scene3d-transform', sourcePath: captured.sourcePath, sourceToken: captured.token,
    baseSourceRevision: captured.baseSourceRevision, sourceRevision: captured.sourceRevision,
    instanceId: patched.instanceId, values: JSON.parse(JSON.stringify(edit.values)),
    beforeContent: patched.beforeContent, afterContent: patched.afterContent, changedPaths: [...patched.changedPaths],
    beforeObject: before.objects.find(object => object.instanceId === patched.instanceId),
    afterObject: after.objects.find(object => object.instanceId === patched.instanceId) });
  proposals.add(proposal); return proposal;
}

export function isScene3DTransformProposal(value) {
  return Boolean(value && typeof value === 'object' && proposals.has(value));
}

/** Recompute the complete candidate and both source SHA guards before the host
 * changes its current draft. A serialized/cloned proposal conveys no authority. */
export async function prepareScene3DTransformApply(source, proposal, { digest } = {}) {
  if (!proposal || !proposals.has(proposal) || typeof digest !== 'function') throw error('scene3d_transform_conflict');
  const captured = snapshot(source);
  if (captured.sourcePath !== proposal.sourcePath || captured.token !== proposal.sourceToken
    || captured.baseSourceRevision !== proposal.baseSourceRevision || captured.sourceRevision !== proposal.sourceRevision
    || captured.content !== proposal.beforeContent) throw error('scene3d_transform_conflict');
  const hash = await digest(captured.content);
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash) || `sha256:${hash}` !== captured.sourceRevision) throw error('scene3d_transform_conflict');
  const repeated = dispatchStudioCoreScene3DPatch({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'scene3d.patchObjectTransform', content: captured.content, instanceId: proposal.instanceId, values: proposal.values });
  if (repeated.beforeContent !== proposal.beforeContent || repeated.afterContent !== proposal.afterContent
    || repeated.instanceId !== proposal.instanceId || !repeated.changedPaths.length
    || JSON.stringify(repeated.changedPaths) !== JSON.stringify(proposal.changedPaths)) throw error('scene3d_transform_conflict');
  parseScene3DSource(repeated.afterContent);
  return freeze({ afterContent: repeated.afterContent, sourcePath: captured.sourcePath, changedPaths: [...repeated.changedPaths] });
}

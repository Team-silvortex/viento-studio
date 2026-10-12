// World-axis position alignment has its own review brand, never selection,
// renderer, single-object transform, source save or backend authority.
import { parseScene3DSource } from './scene3d.mjs';
import { dispatchStudioCoreScene3DAlignmentPatch, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
import { assertScene3DAuthoringRecord, captureScene3DAuthoringSource } from './scene3d-authoring.mjs';

const proposals = new WeakSet();
const error = (code = 'scene3d_alignment_invalid') => Object.assign(new TypeError('The reviewed 3D alignment no longer matches the current source.'), { errorCode: code });
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};
const record = (value, keys) => assertScene3DAuthoringRecord(value, keys, error);
const snapshot = input => captureScene3DAuthoringSource(input, error);

export function createScene3DAlignmentProposal(source, edit) {
  const captured = snapshot(source); record(edit, ['instanceIds', 'anchorInstanceId', 'axis']);
  const patched = dispatchStudioCoreScene3DAlignmentPatch({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'scene3d.alignObjects', content: captured.content, instanceIds: edit.instanceIds, anchorInstanceId: edit.anchorInstanceId, axis: edit.axis });
  if (!patched.changedPaths.length) throw error('scene3d_alignment_unchanged');
  const selected = new Set(patched.instanceIds);
  const before = parseScene3DSource(captured.content).model, after = parseScene3DSource(patched.afterContent).model;
  const proposal = freeze({ kind: 'scene3d-alignment', sourcePath: captured.sourcePath, sourceToken: captured.token,
    baseSourceRevision: captured.baseSourceRevision, sourceRevision: captured.sourceRevision,
    instanceIds: [...patched.instanceIds], anchorInstanceId: patched.anchorInstanceId, axis: patched.axis, beforeContent: patched.beforeContent,
    afterContent: patched.afterContent, changedPaths: [...patched.changedPaths],
    beforeObjects: before.objects.filter(object => selected.has(object.instanceId)),
    afterObjects: after.objects.filter(object => selected.has(object.instanceId)) });
  proposals.add(proposal); return proposal;
}

export function isScene3DAlignmentProposal(value) {
  return Boolean(value && typeof value === 'object' && proposals.has(value));
}

/** The host still rechecks its current session after this asynchronous digest.
 * Caller DTOs are captured beforehand, and serialized copies carry no brand. */
export async function prepareScene3DAlignmentApply(source, proposal, { digest } = {}) {
  if (!proposal || !proposals.has(proposal) || typeof digest !== 'function') throw error('scene3d_alignment_conflict');
  const captured = snapshot(source);
  if (captured.sourcePath !== proposal.sourcePath || captured.token !== proposal.sourceToken
    || captured.baseSourceRevision !== proposal.baseSourceRevision || captured.sourceRevision !== proposal.sourceRevision
    || captured.content !== proposal.beforeContent) throw error('scene3d_alignment_conflict');
  const hash = await digest(captured.content);
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash) || `sha256:${hash}` !== captured.sourceRevision) throw error('scene3d_alignment_conflict');
  const repeated = dispatchStudioCoreScene3DAlignmentPatch({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'scene3d.alignObjects', content: captured.content, instanceIds: proposal.instanceIds, anchorInstanceId: proposal.anchorInstanceId, axis: proposal.axis });
  if (repeated.beforeContent !== proposal.beforeContent || repeated.afterContent !== proposal.afterContent
    || JSON.stringify(repeated.instanceIds) !== JSON.stringify(proposal.instanceIds) || repeated.anchorInstanceId !== proposal.anchorInstanceId || repeated.axis !== proposal.axis
    || !repeated.changedPaths.length || JSON.stringify(repeated.changedPaths) !== JSON.stringify(proposal.changedPaths)) throw error('scene3d_alignment_conflict');
  parseScene3DSource(repeated.afterContent);
  return freeze({ afterContent: repeated.afterContent, sourcePath: captured.sourcePath, changedPaths: [...repeated.changedPaths] });
}

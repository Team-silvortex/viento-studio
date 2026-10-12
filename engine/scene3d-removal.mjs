// Atomic raw declaration removal owns a ninth private review brand.
import { parseScene3DSource } from './scene3d.mjs';
import { dispatchStudioCoreScene3DRemovalPatch, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
import { assertScene3DAuthoringRecord, captureScene3DAuthoringSource } from './scene3d-authoring.mjs';

const proposals = new WeakSet();
const error = (code = 'scene3d_removal_invalid') => Object.assign(new TypeError('The reviewed 3D removal no longer matches the current source.'), { errorCode: code });
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};
const record = (value, keys) => assertScene3DAuthoringRecord(value, keys, error);
const snapshot = input => captureScene3DAuthoringSource(input, error);

export function createScene3DRemovalProposal(source, edit) {
  const captured = snapshot(source); record(edit, ['instanceIds']);
  const patched = dispatchStudioCoreScene3DRemovalPatch({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'scene3d.removeObjects', content: captured.content, instanceIds: edit.instanceIds });
  const selected = new Set(patched.instanceIds), before = parseScene3DSource(captured.content).model;
  const proposal = freeze({ kind: 'scene3d-removal', sourcePath: captured.sourcePath, sourceToken: captured.token,
    baseSourceRevision: captured.baseSourceRevision, sourceRevision: captured.sourceRevision,
    instanceIds: [...patched.instanceIds], beforeContent: patched.beforeContent, afterContent: patched.afterContent,
    changedPaths: [...patched.changedPaths], removedObjects: before.objects.filter(object => selected.has(object.instanceId)),
    remainingObjects: before.objects.filter(object => !selected.has(object.instanceId)) });
  proposals.add(proposal); return proposal;
}
export function isScene3DRemovalProposal(value) {
  return Boolean(value && typeof value === 'object' && proposals.has(value));
}

/** Source identity is captured before awaiting the digest. The source host
 * rechecks the current session independently before applying this candidate. */
export async function prepareScene3DRemovalApply(source, proposal, { digest } = {}) {
  if (!proposal || !proposals.has(proposal) || typeof digest !== 'function') throw error('scene3d_removal_conflict');
  const captured = snapshot(source);
  if (captured.sourcePath !== proposal.sourcePath || captured.token !== proposal.sourceToken
    || captured.baseSourceRevision !== proposal.baseSourceRevision || captured.sourceRevision !== proposal.sourceRevision
    || captured.content !== proposal.beforeContent) throw error('scene3d_removal_conflict');
  const hash = await digest(captured.content);
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash) || `sha256:${hash}` !== captured.sourceRevision) throw error('scene3d_removal_conflict');
  const repeated = dispatchStudioCoreScene3DRemovalPatch({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'scene3d.removeObjects', content: captured.content, instanceIds: proposal.instanceIds });
  if (repeated.beforeContent !== proposal.beforeContent || repeated.afterContent !== proposal.afterContent
    || JSON.stringify(repeated.instanceIds) !== JSON.stringify(proposal.instanceIds) || !repeated.changedPaths.length
    || JSON.stringify(repeated.changedPaths) !== JSON.stringify(proposal.changedPaths)) throw error('scene3d_removal_conflict');
  parseScene3DSource(repeated.afterContent);
  return freeze({ afterContent: repeated.afterContent, sourcePath: captured.sourcePath, changedPaths: [...repeated.changedPaths] });
}

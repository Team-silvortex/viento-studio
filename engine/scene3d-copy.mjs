// Atomic raw primitive copying has its own review brand, never selection,
// renderer, single-object transform, source save or backend authority.
import { parseScene3DSource } from './scene3d.mjs';
import { dispatchStudioCoreScene3DCopyPatch, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
import { assertScene3DAuthoringRecord, captureScene3DAuthoringSource } from './scene3d-authoring.mjs';

const proposals = new WeakSet();
const error = (code = 'scene3d_copy_invalid') => Object.assign(new TypeError('The reviewed 3D copy no longer matches the current source.'), { errorCode: code });
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};
const record = (value, keys) => assertScene3DAuthoringRecord(value, keys, error);
const snapshot = input => captureScene3DAuthoringSource(input, error);

export function createScene3DCopyProposal(source, edit) {
  const captured = snapshot(source); record(edit, ['copies', 'offset']);
  const patched = dispatchStudioCoreScene3DCopyPatch({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'scene3d.copyObjects', content: captured.content, copies: edit.copies, offset: edit.offset });
  const sources = new Set(patched.copies.map(pair => pair.sourceInstanceId)), created = new Set(patched.copies.map(pair => pair.newInstanceId));
  const before = parseScene3DSource(captured.content).model, after = parseScene3DSource(patched.afterContent).model;
  const proposal = freeze({ kind: 'scene3d-copy', sourcePath: captured.sourcePath, sourceToken: captured.token,
    baseSourceRevision: captured.baseSourceRevision, sourceRevision: captured.sourceRevision,
    copies: patched.copies.map(pair => ({ ...pair })), offset: [...patched.offset], beforeContent: patched.beforeContent,
    afterContent: patched.afterContent, changedPaths: [...patched.changedPaths],
    beforeObjects: before.objects.filter(object => sources.has(object.instanceId)),
    afterObjects: after.objects.filter(object => created.has(object.instanceId)) });
  proposals.add(proposal); return proposal;
}

export function isScene3DCopyProposal(value) {
  return Boolean(value && typeof value === 'object' && proposals.has(value));
}

/** The host still rechecks its current session after this asynchronous digest.
 * Caller DTOs are captured beforehand, and serialized copies carry no brand. */
export async function prepareScene3DCopyApply(source, proposal, { digest } = {}) {
  if (!proposal || !proposals.has(proposal) || typeof digest !== 'function') throw error('scene3d_copy_conflict');
  const captured = snapshot(source);
  if (captured.sourcePath !== proposal.sourcePath || captured.token !== proposal.sourceToken
    || captured.baseSourceRevision !== proposal.baseSourceRevision || captured.sourceRevision !== proposal.sourceRevision
    || captured.content !== proposal.beforeContent) throw error('scene3d_copy_conflict');
  const hash = await digest(captured.content);
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash) || `sha256:${hash}` !== captured.sourceRevision) throw error('scene3d_copy_conflict');
  const repeated = dispatchStudioCoreScene3DCopyPatch({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'scene3d.copyObjects', content: captured.content, copies: proposal.copies, offset: proposal.offset });
  if (repeated.beforeContent !== proposal.beforeContent || repeated.afterContent !== proposal.afterContent
    || JSON.stringify(repeated.copies) !== JSON.stringify(proposal.copies) || JSON.stringify(repeated.offset) !== JSON.stringify(proposal.offset)
    || !repeated.changedPaths.length || JSON.stringify(repeated.changedPaths) !== JSON.stringify(proposal.changedPaths)) throw error('scene3d_copy_conflict');
  parseScene3DSource(repeated.afterContent);
  return freeze({ afterContent: repeated.afterContent, sourcePath: captured.sourcePath, changedPaths: [...repeated.changedPaths] });
}

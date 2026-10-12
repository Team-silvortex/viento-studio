// Structural authoring produces an inspectable in-memory candidate. It has no
// renderer, filesystem, World, backend, Save or transform-controller authority.
import { parseScene3DSource } from './scene3d.mjs';
import { dispatchStudioCoreScene3DObjectsPatch, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
import { assertScene3DAuthoringRecord, captureScene3DAuthoringSource } from './scene3d-authoring.mjs';

const proposals = new WeakSet();
const error = (code = 'scene3d_objects_invalid') => Object.assign(new TypeError('The reviewed 3D object operation no longer matches the current source.'), { errorCode: code });
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};
const snapshot = input => captureScene3DAuthoringSource(input, error);
function request(content, edit) {
  assertScene3DAuthoringRecord(edit, Object.keys(edit || {}), error);
  const keys = { add: ['action', 'object'], copy: ['action', 'instanceId', 'newInstanceId', 'name'], remove: ['action', 'instanceId'] };
  if (!Object.hasOwn(keys, edit.action)) throw error();
  assertScene3DAuthoringRecord(edit, keys[edit.action], error);
  return { protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'scene3d.patchObjects', content, ...edit };
}

export function createScene3DObjectsProposal(source, edit) {
  const captured = snapshot(source), patched = dispatchStudioCoreScene3DObjectsPatch(request(captured.content, edit));
  const before = parseScene3DSource(captured.content).model, after = parseScene3DSource(patched.afterContent).model;
  const beforeId = patched.action === 'copy' ? patched.sourceInstanceId : patched.instanceId;
  const proposal = freeze({ kind: 'scene3d-objects', sourcePath: captured.sourcePath, sourceToken: captured.token,
    baseSourceRevision: captured.baseSourceRevision, sourceRevision: captured.sourceRevision,
    action: patched.action, instanceId: patched.instanceId, sourceInstanceId: patched.sourceInstanceId, edit: JSON.parse(JSON.stringify(edit)),
    beforeContent: patched.beforeContent, afterContent: patched.afterContent, changedPaths: [...patched.changedPaths],
    beforeObject: patched.action === 'add' ? null : before.objects.find(object => object.instanceId === beforeId),
    afterObject: patched.action === 'remove' ? null : after.objects.find(object => object.instanceId === patched.instanceId) });
  proposals.add(proposal); return proposal;
}

export function isScene3DObjectsProposal(value) {
  return Boolean(value && typeof value === 'object' && proposals.has(value));
}

export async function prepareScene3DObjectsApply(source, proposal, { digest } = {}) {
  if (!proposal || !proposals.has(proposal) || typeof digest !== 'function') throw error('scene3d_objects_conflict');
  const captured = snapshot(source);
  if (captured.sourcePath !== proposal.sourcePath || captured.token !== proposal.sourceToken
    || captured.baseSourceRevision !== proposal.baseSourceRevision || captured.sourceRevision !== proposal.sourceRevision
    || captured.content !== proposal.beforeContent) throw error('scene3d_objects_conflict');
  const hash = await digest(captured.content);
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash) || `sha256:${hash}` !== captured.sourceRevision) throw error('scene3d_objects_conflict');
  const repeated = dispatchStudioCoreScene3DObjectsPatch(request(captured.content, proposal.edit));
  if (repeated.beforeContent !== proposal.beforeContent || repeated.afterContent !== proposal.afterContent
    || repeated.action !== proposal.action || repeated.instanceId !== proposal.instanceId || repeated.sourceInstanceId !== proposal.sourceInstanceId
    || !repeated.changedPaths.length || JSON.stringify(repeated.changedPaths) !== JSON.stringify(proposal.changedPaths)) throw error('scene3d_objects_conflict');
  parseScene3DSource(repeated.afterContent);
  return freeze({ afterContent: repeated.afterContent, sourcePath: captured.sourcePath, changedPaths: [...repeated.changedPaths] });
}

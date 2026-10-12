// A reviewed name/color edit owns no renderer, backend or Save authority.
import { parseScene3DSource } from './scene3d.mjs';
import { dispatchStudioCoreScene3DPropertiesPatch, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
import { assertScene3DAuthoringRecord, captureScene3DAuthoringSource } from './scene3d-authoring.mjs';

const proposals = new WeakSet();
const error = (code = 'scene3d_properties_invalid') => Object.assign(new TypeError('The reviewed 3D object properties no longer match the current source.'), { errorCode: code });
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};
const snapshot = input => captureScene3DAuthoringSource(input, error);
const request = (content, instanceId, values) => ({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'scene3d.patchProperties', content, instanceId, values });

export function createScene3DPropertiesProposal(source, edit) {
  const captured = snapshot(source);
  assertScene3DAuthoringRecord(edit, ['instanceId', 'values'], error);
  const patched = dispatchStudioCoreScene3DPropertiesPatch(request(captured.content, edit.instanceId, edit.values));
  if (!patched.changedPaths.length) throw error('scene3d_properties_unchanged');
  const before = parseScene3DSource(captured.content).model, after = parseScene3DSource(patched.afterContent).model;
  const proposal = freeze({ kind: 'scene3d-properties', instanceId: edit.instanceId,
    sourcePath: captured.sourcePath, sourceToken: captured.token, baseSourceRevision: captured.baseSourceRevision, sourceRevision: captured.sourceRevision,
    values: JSON.parse(JSON.stringify(edit.values)), beforeContent: patched.beforeContent, afterContent: patched.afterContent,
    changedPaths: [...patched.changedPaths], beforeObject: before.objects.find(object => object.instanceId === edit.instanceId),
    afterObject: after.objects.find(object => object.instanceId === edit.instanceId) });
  proposals.add(proposal); return proposal;
}

export function isScene3DPropertiesProposal(value) {
  return Boolean(value && typeof value === 'object' && proposals.has(value));
}

export async function prepareScene3DPropertiesApply(source, proposal, { digest } = {}) {
  if (!proposal || !proposals.has(proposal) || typeof digest !== 'function') throw error('scene3d_properties_conflict');
  const captured = snapshot(source);
  if (captured.sourcePath !== proposal.sourcePath || captured.token !== proposal.sourceToken
    || captured.baseSourceRevision !== proposal.baseSourceRevision || captured.sourceRevision !== proposal.sourceRevision
    || captured.content !== proposal.beforeContent) throw error('scene3d_properties_conflict');
  const hash = await digest(captured.content);
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash) || `sha256:${hash}` !== captured.sourceRevision) throw error('scene3d_properties_conflict');
  const repeated = dispatchStudioCoreScene3DPropertiesPatch(request(captured.content, proposal.instanceId, proposal.values));
  if (repeated.beforeContent !== proposal.beforeContent || repeated.afterContent !== proposal.afterContent
    || !repeated.changedPaths.length || JSON.stringify(repeated.changedPaths) !== JSON.stringify(proposal.changedPaths)) throw error('scene3d_properties_conflict');
  parseScene3DSource(repeated.afterContent);
  return freeze({ afterContent: repeated.afterContent, sourcePath: captured.sourcePath, changedPaths: [...repeated.changedPaths] });
}

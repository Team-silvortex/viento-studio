import { parseJsonSource } from '../../engine/json-source.mjs';
import { isScenePhysics2DProposal, prepareScenePhysics2DApply } from '../../engine/scene-physics2d-edit.mjs';

// Only the current author buffer is owned here. Format recognition does not
// assert registration, scene membership or a valid physics relation; those
// remain saved-project checks. There is no file, renderer or backend authority.
export function createScenePhysics2DSourceHost({ getState, digest, writeDraft, focus = () => {} }) {
  let previous, generation = 0, recognitionContent, recognitionJSON, recognized = false;
  const conflict = () => { throw Object.assign(new Error('Physics editing no longer owns this source.'), { errorCode: 'scene_physics2d_authoring_conflict' }); };
  function capture() {
    const s = getState(), keys = ['document', 'token', 'sourcePath', 'content', 'baseline', 'version', 'editable', 'creating', 'busy', 'available', 'sourceJSON'];
    if (!previous || keys.some(key => previous[key] !== s[key])) { previous = { ...s }; generation++; }
    if (recognitionContent !== s.content || recognitionJSON !== s.sourceJSON) {
      recognitionContent = s.content; recognitionJSON = s.sourceJSON;
      const checked = s.sourceJSON === true && typeof s.content === 'string' && s.content.length <= 65536
        && new TextEncoder().encode(s.content).length <= 65536 ? parseJsonSource(s.content) : null;
      recognized = checked?.ok === true && checked.value?.format === 'viento-scene-physics2d';
    }
    return { ...s, sourceToken: `${String(s.token)}:${generation}`, physicsSource: recognized };
  }
  const eligible = s => s.editable === true && s.available === true && !s.creating && !s.busy
    && s.sourceJSON === true && s.physicsSource && Boolean(s.document);
  const current = (owner, guard = () => true) => {
    if (guard() !== true) return false;
    const s = capture();
    return eligible(s) && s.document === owner.document && s.sourceToken === owner.sourceToken
      && s.content === owner.content && s.baseline === owner.baseline && s.version === owner.version;
  };
  function getContext() {
    const s = capture();
    return { editable: s.editable, creating: s.creating, busy: s.busy, available: s.available, sourceJSON: s.sourceJSON,
      sourcePath: s.sourcePath, sourceToken: s.sourceToken, physicsSource: s.physicsSource };
  }
  async function snapshot(owner, guard) {
    if (!eligible(owner) || !current(owner, guard)) return null;
    const baseHash = await digest(owner.baseline);
    if (!current(owner, guard) || typeof baseHash !== 'string' || !/^[a-f0-9]{64}$/.test(baseHash)) return null;
    const baseSourceRevision = `sha256:${baseHash}`;
    if (typeof owner.version !== 'string' || owner.version.startsWith('sha256:') && owner.version !== baseSourceRevision) return null;
    const hash = await digest(owner.content);
    if (!current(owner, guard) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) return null;
    return Object.freeze({ sourcePath: owner.sourcePath, token: owner.sourceToken, content: owner.content,
      baseSourceRevision, sourceRevision: `sha256:${hash}` });
  }
  async function getSource() { return snapshot(capture()); }
  async function applyDraft(proposal, { isCurrent = () => true } = {}) {
    if (!isScenePhysics2DProposal(proposal)) conflict();
    const owner = capture(), source = await snapshot(owner, isCurrent);
    if (!source) conflict();
    const prepared = await prepareScenePhysics2DApply(source, proposal, { digest });
    if (!current(owner, isCurrent)) conflict();
    // Nothing asynchronous or caller-controlled separates ownership from write.
    writeDraft(prepared.afterContent);
    const after = capture();
    return { applied: true, sourcePath: after.sourcePath, sourceToken: after.sourceToken, content: prepared.afterContent,
      focus() { if (current(after) && after.content === prepared.afterContent) focus(); } };
  }
  return Object.freeze({ getContext, getSource, applyDraft });
}

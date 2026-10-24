import { captureScenePhysics2DTargetSource, captureScenePhysics2DTargets, scenePhysics2DTargetsMatchSource, scenePhysics2DTargetsEqual, validateScenePhysics2DTargets } from '../../engine/scene-physics2d-targets.mjs';
import { parseJsonSource } from '../../engine/json-source.mjs';
import { isScenePhysics2DProposal, prepareScenePhysics2DApply } from '../../engine/scene-physics2d-edit.mjs';

// This port owns only the current author buffer. An optional saved-scene
// directory reader has a separate capability epoch and is rechecked before
// catalog-backed edits. There is no file, renderer, Save or backend authority.
export function createScenePhysics2DSourceHost({ getState, digest, writeDraft, inspectTargets, focus = () => {} }) {
  let previous, generation = 0, previousTargets, targetsGeneration = 0, recognitionContent, recognitionJSON, recognized = false;
  const issuedTargets = new WeakMap();
  const targetsConflict = () => { throw Object.assign(new Error('Scene physics targets changed; refresh the target list.'), { errorCode: 'scene_physics2d_targets_conflict' }); };
  const conflict = () => { throw Object.assign(new Error('Physics editing no longer owns this source.'), { errorCode: 'scene_physics2d_authoring_conflict' }); };
  function capture() {
    const s = getState(), keys = ['document', 'token', 'sourcePath', 'content', 'baseline', 'version', 'editable', 'creating', 'busy', 'available', 'sourceJSON'];
    if (!previous || keys.some(key => previous[key] !== s[key])) { previous = { ...s }; generation++; }
    const targetsAvailable = s.targetsAvailable === true && typeof inspectTargets === 'function';
    if (previousTargets !== targetsAvailable) { previousTargets = targetsAvailable; targetsGeneration++; }
    if (recognitionContent !== s.content || recognitionJSON !== s.sourceJSON) {
      recognitionContent = s.content; recognitionJSON = s.sourceJSON;
      const checked = s.sourceJSON === true && typeof s.content === 'string' && s.content.length <= 65536
        && new TextEncoder().encode(s.content).length <= 65536 ? parseJsonSource(s.content) : null;
      recognized = checked?.ok === true && checked.value?.format === 'viento-scene-physics2d';
    }
    return { ...s, sourceToken: `${String(s.token)}:${generation}`, physicsSource: recognized, targetsAvailable, targetsToken: String(targetsGeneration) };
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
      sourcePath: s.sourcePath, sourceToken: s.sourceToken, physicsSource: s.physicsSource, targetsAvailable: s.targetsAvailable, targetsToken: s.targetsToken };
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
  async function getTargets(requestedSource) {
    // Capture data-only source identity before awaiting the independent reader.
    const requested = captureScenePhysics2DTargetSource(requestedSource), owner = capture();
    if (!owner.targetsAvailable) throw Object.assign(new Error('Scene physics target selection is unavailable.'), { errorCode: 'scene_physics2d_targets_unavailable' });
    const guard = () => { const now = capture(); return now.targetsAvailable && now.targetsToken === owner.targetsToken; };
    const source = await snapshot(owner, guard);
    if (!source || !Object.keys(source).every(key => source[key] === requested[key])) targetsConflict();
    const raw = await inspectTargets({ sceneObjectId: parseJsonSource(source.content).value.sceneObjectId });
    if (!current(owner, guard)) targetsConflict();
    const catalog = captureScenePhysics2DTargets(source, raw);
    const savedHash = await digest(catalog.savedContent);
    if (!current(owner, guard) || typeof savedHash !== 'string' || savedHash.length !== 64
      || !/^[a-f0-9]{64}$/.test(savedHash) || `sha256:${savedHash}` !== source.baseSourceRevision) targetsConflict();
    issuedTargets.set(catalog, owner.targetsToken); return catalog;
  }
  async function applyDraft(proposal, { isCurrent = () => true, targets } = {}) {
    if (!isScenePhysics2DProposal(proposal)) conflict();
    const owner = capture(), source = await snapshot(owner, isCurrent);
    if (!source) conflict();
    if (targets !== undefined) {
      if (!owner.targetsAvailable || issuedTargets.get(targets) !== owner.targetsToken || !scenePhysics2DTargetsMatchSource(targets, source)) targetsConflict();
      const fresh = await getTargets(source);
      if (!current(owner, isCurrent) || !scenePhysics2DTargetsEqual(targets, fresh)) targetsConflict();
      validateScenePhysics2DTargets(fresh, parseJsonSource(proposal.afterContent).value);
    }
    const prepared = await prepareScenePhysics2DApply(source, proposal, { digest });
    const guard = () => {
      if (isCurrent() !== true) return false;
      if (targets === undefined) return true;
      const now = capture(); return now.targetsAvailable && now.targetsToken === owner.targetsToken;
    };
    if (!current(owner, guard)) conflict();
    // Nothing asynchronous or caller-controlled separates ownership from write.
    writeDraft(prepared.afterContent);
    const after = capture();
    return { applied: true, sourcePath: after.sourcePath, sourceToken: after.sourceToken, content: prepared.afterContent,
      focus() { if (current(after) && after.content === prepared.afterContent) focus(); } };
  }
  return Object.freeze({ getContext, getSource, getTargets, applyDraft });
}

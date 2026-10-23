import { hasAnimationStateScriptMarker } from '../../engine/animation-state-script-source.mjs';
import { isAnimationStateScriptProposal, prepareAnimationStateScriptApply } from '../../engine/animation-state-script-edit.mjs';

// Source ownership only. Strict declaration/body inspection belongs to the
// source adapter, and ordinary Save remains with the shared document editor.
export function createAnimationStateScriptSourceHost({ getState, digest, writeDraft, focus = () => {} }) {
  let previous, generation = 0, recognitionContent, recognitionTXT, recognized = false;
  const conflict = () => { throw Object.assign(new Error('Animation state script editing no longer owns this source.'), { errorCode: 'animation_state_script_authoring_conflict' }); };
  const digestHex = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
  function capture() {
    const s = getState(), keys = ['document', 'token', 'sourcePath', 'content', 'baseline', 'version', 'editable', 'creating', 'busy', 'available', 'sourceTXT'];
    if (!previous || keys.some(key => previous[key] !== s[key])) { previous = { ...s }; generation++; }
    if (recognitionContent !== s.content || recognitionTXT !== s.sourceTXT) {
      recognitionContent = s.content; recognitionTXT = s.sourceTXT;
      // This is deliberately a candidate check: hand-edited marked source can
      // still open and report why strict table editing refuses to replace it.
      recognized = s.sourceTXT === true && hasAnimationStateScriptMarker(s.content);
    }
    return { ...s, sourceToken: `${String(s.token)}:${generation}`, stateTableSource: recognized };
  }
  const eligible = s => s.editable === true && s.available === true && !s.creating && !s.busy && s.sourceTXT === true
    && s.stateTableSource && Boolean(s.document) && typeof s.content === 'string' && typeof s.baseline === 'string';
  const current = (owner, guard = () => true) => {
    // The caller's guard may synchronously change the active editor. Capture
    // ownership only after it returns, including immediately before writing.
    if (guard() !== true) return false;
    const s = capture();
    return eligible(s) && s.document === owner.document && s.sourceToken === owner.sourceToken
      && s.content === owner.content && s.baseline === owner.baseline && s.version === owner.version;
  };
  function getContext() {
    const s = capture();
    return { editable: s.editable, creating: s.creating, busy: s.busy, available: s.available, sourceTXT: s.sourceTXT,
      sourcePath: s.sourcePath, sourceToken: s.sourceToken, stateTableSource: s.stateTableSource };
  }
  async function snapshot(owner, guard) {
    if (!eligible(owner) || !current(owner, guard)) return null;
    const base = await digest(owner.baseline);
    if (!current(owner, guard) || !digestHex(base) || typeof owner.version !== 'string') return null;
    const baseSourceRevision = `sha256:${base}`;
    if (owner.version.startsWith('sha256:') && owner.version !== baseSourceRevision) return null;
    const hash = await digest(owner.content);
    if (!current(owner, guard) || !digestHex(hash)) return null;
    return Object.freeze({ sourcePath: owner.sourcePath, token: owner.sourceToken, content: owner.content,
      baseSourceRevision, sourceRevision: `sha256:${hash}` });
  }
  async function getSource() { return snapshot(capture()); }
  async function applyDraft(proposal, { isCurrent = () => true } = {}) {
    if (!isAnimationStateScriptProposal(proposal) || typeof isCurrent !== 'function') conflict();
    const owner = capture(), source = await snapshot(owner, isCurrent);
    if (!source) conflict();
    const prepared = await prepareAnimationStateScriptApply(source, proposal, { digest });
    if (!current(owner, isCurrent)) conflict();
    writeDraft(prepared.afterContent);
    const after = capture();
    return { applied: true, sourcePath: after.sourcePath, sourceToken: after.sourceToken, content: prepared.afterContent,
      focus() { if (current(after) && after.content === prepared.afterContent) focus(); } };
  }
  return Object.freeze({ getContext, getSource, applyDraft });
}

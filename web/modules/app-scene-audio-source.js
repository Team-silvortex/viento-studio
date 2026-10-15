import { parseJsonSource } from '../../engine/json-source.mjs';
import { isSceneAudioProposal, prepareSceneAudioApply } from '../../engine/scene-audio-edit.mjs';

// The editor host owns source versions, Rust validation and a synchronous
// in-memory write. No UI controller, renderer, ordinary Save or tool is shared.
export function createSceneAudioSourceHost({ getState, digest, writeDraft, focus = () => {} }) {
  let previous, generation = 0, recognitionContent, recognitionPath, recognitionJSON, recognized = false;
  const conflict = () => { throw Object.assign(new Error('Audio editing no longer owns this source.'), { errorCode: 'scene_audio_authoring_conflict' }); };
  function capture() {
    const s = getState(), keys = ['document','token','sourcePath','content','baseline','version','editable','creating','busy','available','sourceJSON'];
    if (!previous || keys.some(key => previous[key] !== s[key])) { previous = { ...s }; generation++; }
    if (recognitionContent !== s.content || recognitionPath !== s.sourcePath || recognitionJSON !== s.sourceJSON) {
      recognitionContent = s.content; recognitionPath = s.sourcePath; recognitionJSON = s.sourceJSON;
      const checked = s.sourceJSON && typeof s.content === 'string' && s.content.length <= 65536 ? parseJsonSource(s.content) : null;
      recognized = checked?.ok === true && checked.value?.format === 'viento-scene-audio';
    }
    return { ...s, sourceToken: `${String(s.token)}:${generation}`, audioSource: recognized };
  }
  const eligible = s => s.editable === true && s.available === true && !s.creating && !s.busy && s.sourceJSON === true && s.audioSource && Boolean(s.document);
  const current = (owner, guard = () => true) => {
    const s = capture();
    return eligible(s) && s.document === owner.document && s.sourceToken === owner.sourceToken
      && s.content === owner.content && s.baseline === owner.baseline && s.version === owner.version && guard() === true;
  };
  function getContext() {
    const s = capture();
    return { editable: s.editable, creating: s.creating, busy: s.busy, available: s.available,
      sourceJSON: s.sourceJSON, sourcePath: s.sourcePath, sourceToken: s.sourceToken, audioSource: s.audioSource };
  }
  async function snapshot(owner, guard) {
    if (!eligible(owner) || !current(owner, guard)) return null;
    const baseSourceRevision = `sha256:${await digest(owner.baseline)}`;
    if (!current(owner, guard) || typeof owner.version !== 'string' || owner.version.startsWith('sha256:') && owner.version !== baseSourceRevision) return null;
    const sourceRevision = `sha256:${await digest(owner.content)}`;
    if (!current(owner, guard)) return null;
    return Object.freeze({ sourcePath: owner.sourcePath, token: owner.sourceToken, content: owner.content, baseSourceRevision, sourceRevision });
  }
  async function getSource() { return snapshot(capture()); }
  async function applyDraft(proposal, { isCurrent = () => true } = {}) {
    if (!isSceneAudioProposal(proposal)) conflict();
    const owner = capture(), source = await snapshot(owner, isCurrent);
    if (!source) conflict();
    const prepared = await prepareSceneAudioApply(source, proposal, { digest });
    if (!current(owner, isCurrent)) conflict();
    // No await may separate this final ownership check from the draft write.
    writeDraft(prepared.afterContent);
    const after = capture();
    return { applied: true, sourcePath: after.sourcePath, sourceToken: after.sourceToken, content: prepared.afterContent,
      focus() { if (current(after) && after.content === prepared.afterContent) focus(); } };
  }
  return Object.freeze({ getContext, getSource, applyDraft });
}

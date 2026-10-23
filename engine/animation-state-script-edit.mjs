// Review a complete, self-described generated TXT source before changing the
// ordinary editor draft. No registry, relationship, playback or Save authority.
import { inspectAnimationStateDeclarationWithCombinations } from './animation-state-conditions-core.mjs';
import { readAnimationStateScriptSource, generateEditableGodotAnimationStateScript } from './animation-state-script-source.mjs';
import { canonicalJson } from './canonical-json.mjs';

const MAX_SOURCE_BYTES = 131072;
const sourceKeys = ['sourcePath', 'token', 'content', 'baseSourceRevision', 'sourceRevision'];
const proposals = new WeakSet();
const error = (kind = 'invalid') => Object.assign(new TypeError('The animation state script edit does not match the reviewed source.'), {
  errorCode: `animation_state_script_authoring_${kind}`,
});
const fail = () => { throw error(); };
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const validUnicode = value => {
  for (const character of value) { const code = character.codePointAt(0); if (code >= 0xd800 && code <= 0xdfff) return false; }
  return true;
};
const digestHex = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
const revision = value => typeof value === 'string' && value.length === 71 && value.startsWith('sha256:') && digestHex(value.slice(7));
function captureSource(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(input), names = Reflect.ownKeys(descriptors);
  if (names.length !== sourceKeys.length || names.some(key => typeof key !== 'string' || !sourceKeys.includes(key))
    || sourceKeys.some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail();
  const source = Object.fromEntries(sourceKeys.map(key => [key, descriptors[key].value]));
  if (typeof source.sourcePath !== 'string' || !source.sourcePath || source.sourcePath.length > 4096
    || !validUnicode(source.sourcePath) || source.sourcePath.startsWith('/') || /^[A-Za-z]:/.test(source.sourcePath)
    || /[\\\0]/.test(source.sourcePath) || source.sourcePath.split('/').some(part => !part || part === '.' || part === '..')
    || source.sourcePath.slice(-4).toLowerCase() !== '.txt'
    || typeof source.token !== 'string' || !source.token || source.token.length > 256 || !validUnicode(source.token)
    || !revision(source.baseSourceRevision) || !revision(source.sourceRevision)
    || typeof source.content !== 'string' || source.content.length > MAX_SOURCE_BYTES || !validUnicode(source.content)
    || new TextEncoder().encode(source.content).length > MAX_SOURCE_BYTES) fail();
  return Object.freeze(source);
}
function replacement(content, table) {
  const before = readAnimationStateScriptSource(content);
  // The native result detaches all caller data synchronously, before any await.
  const checked = inspectAnimationStateDeclarationWithCombinations(table).table;
  const generated = generateEditableGodotAnimationStateScript(checked);
  const afterContent = before.bom + generated.content.replaceAll('\n', before.newline);
  if (afterContent.length > MAX_SOURCE_BYTES || new TextEncoder().encode(afterContent).length > MAX_SOURCE_BYTES) fail();
  const after = readAnimationStateScriptSource(afterContent);
  if (canonicalJson(after.table) !== canonicalJson(checked) || canonicalJson(after.parameters) !== canonicalJson(generated.parameters)) fail();
  if (afterContent === content) throw error('unchanged');
  return { beforeContent: content, afterContent, table: after.table, beforeParameters: before.parameters, afterParameters: after.parameters };
}

export async function createAnimationStateScriptProposal(source, table) {
  const captured = captureSource(source), changed = replacement(captured.content, table);
  const proposal = freeze({ kind: 'animation-state-script', sourcePath: captured.sourcePath, sourceToken: captured.token,
    baseSourceRevision: captured.baseSourceRevision, sourceRevision: captured.sourceRevision, ...changed });
  proposals.add(proposal); return proposal;
}
export const isAnimationStateScriptProposal = value => Boolean(value && typeof value === 'object' && proposals.has(value));
export async function prepareAnimationStateScriptApply(source, proposal, { digest } = {}) {
  if (!isAnimationStateScriptProposal(proposal) || typeof digest !== 'function') throw error('conflict');
  let captured;
  try { captured = captureSource(source); } catch { throw error('conflict'); }
  if (captured.sourcePath !== proposal.sourcePath || captured.token !== proposal.sourceToken
    || captured.baseSourceRevision !== proposal.baseSourceRevision || captured.sourceRevision !== proposal.sourceRevision
    || captured.content !== proposal.beforeContent) throw error('conflict');
  const hash = await digest(captured.content);
  if (!digestHex(hash) || `sha256:${hash}` !== captured.sourceRevision) throw error('conflict');
  const changed = replacement(captured.content, proposal.table);
  if (changed.afterContent !== proposal.afterContent || canonicalJson(changed.table) !== canonicalJson(proposal.table)
    || canonicalJson(changed.beforeParameters) !== canonicalJson(proposal.beforeParameters)
    || canonicalJson(changed.afterParameters) !== canonicalJson(proposal.afterParameters)) throw error('conflict');
  return freeze({ sourcePath: captured.sourcePath, afterContent: changed.afterContent,
    beforeParameters: changed.beforeParameters, afterParameters: changed.afterParameters });
}

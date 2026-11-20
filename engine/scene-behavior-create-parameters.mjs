// First-creation parameter text stays an author draft. This portable boundary
// only reviews scalar JSON and proposes source-range insertions; it owns no I/O.
import { parseJsonSource, locateJsonSource } from './json-source.mjs';
import { inspectSceneBehaviors, SCENE_BEHAVIOR_LIMITS } from './scene-behaviors.mjs';
import { captureScriptParameterContract, reviewScriptParameterRows } from './script-parameter-interface.mjs';

const invalid = () => { throw Object.assign(new TypeError('Expected bounded behavior creation parameter JSON and a compatible script interface.'), { errorCode: 'scene_behavior_create_parameters_invalid' }); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))
    || keys.some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) invalid();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const skeleton = parameters => `{"format":"viento-scene-behaviors","schemaVersion":1,"sceneObjectId":"${id}","bindings":[{"bindingId":"${id}","instanceId":"${id}","implementation":{"backendId":"org.viento.godot4","language":"gdscript","sourceObjectId":"${id}"},"parameters":${parameters},"events":[]}]}`;
function parameters(content) {
  if (typeof content !== 'string' || content.length > SCENE_BEHAVIOR_LIMITS.manifestBytes) invalid();
  const parsed = parseJsonSource(content);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) invalid();
  // Use the existing author-format validator for reserved names, scalar types,
  // UTF-8, number precision and limits rather than making a second authority.
  const text = content.startsWith('\uFEFF') ? content.slice(1) : content;
  const checked = inspectSceneBehaviors(skeleton(text));
  if (!checked.recognized || !checked.ok) invalid();
  return { parsed, text, value: parsed.value };
}
function capture(input) {
  const value = record(input, ['content', 'contract', 'backendId', 'language']);
  const source = parameters(value.content), contract = captureScriptParameterContract(value.contract);
  const review = reviewScriptParameterRows(contract, { backendId: value.backendId, language: value.language,
    parameters: Object.entries(source.value).map(([name, value]) => ({ name, type: typeof value, value: Object.is(value, -0) ? '-0' : String(value) })) });
  return { input: value, source, contract, review };
}
export function reviewSceneBehaviorCreateParameters(input) { return capture(input).review; }
const encode = value => Object.is(value, -0) ? '-0' : JSON.stringify(value);
export function proposeSceneBehaviorCreateParameters(input) {
  const { source, input: { content }, review } = capture(input);
  if (review.status !== 'ready') invalid();
  if (!review.missing.length) return freeze({ content, added: [] });
  if (!review.canAddMissing) invalid();
  const root = locateJsonSource(source.parsed, ''), names = Object.keys(source.value);
  const last = names.length ? locateJsonSource(source.parsed, '/' + names.at(-1).replaceAll('~', '~0').replaceAll('/', '~1')) : null;
  // Object.keys orders integer-like names differently; author parameter names
  // exclude those keys, but keep the insertion tied to actual source positions.
  const locations = names.map(name => locateJsonSource(source.parsed, '/' + name.replaceAll('~', '~0').replaceAll('/', '~1')));
  const at = last ? Math.max(...locations.map(location => location.end)) : root.start + 1;
  const body = content.slice(root.start, root.end), multiline = /[\r\n]/.test(body);
  const eol = body.includes('\r\n') ? '\r\n' : body.includes('\n') ? '\n' : '\r';
  const indent = body.match(/(?:\r\n|\n|\r)([\t ]*)"/)?.[1] ?? '  ';
  const separator = multiline ? eol + indent : ' ';
  const additions = review.missing.map(row => JSON.stringify(row.name) + ': ' + encode(row.defaultValue));
  const insertion = (names.length ? ',' : '') + separator + additions.join(',' + separator);
  const result = content.slice(0, at) + insertion + content.slice(at);
  parameters(result);
  return freeze({ content: result, added: review.missing.map(row => row.name) });
}

// The legacy identity-only planner remains strict. This separate optional step
// embeds each explicitly edited parameter fragment in a newly planned source.
export function applySceneBehaviorCreateParameterSources(input) {
  const { content, parameters: fragments } = record(input, ['content', 'parameters']);
  if (typeof content !== 'string' || content.length > SCENE_BEHAVIOR_LIMITS.manifestBytes) invalid();
  const checked = inspectSceneBehaviors(content);
  if (!checked.recognized || !checked.ok) invalid();
  const parsed = parseJsonSource(content);
  if (!parsed.ok || !Array.isArray(fragments) || Object.getPrototypeOf(fragments) !== Array.prototype
    || fragments.length !== checked.value.bindings.length || Reflect.ownKeys(fragments).length !== fragments.length + 1) invalid();
  const patches = [];
  for (let index = 0; index < fragments.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(fragments, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    const fragment = parameters(descriptor.value).text;
    if (Object.keys(checked.value.bindings[index].parameters).length) invalid();
    const location = locateJsonSource(parsed, `/bindings/${index}/parameters`);
    if (!location?.exact) invalid();
    patches.push({ ...location, content: fragment });
  }
  let next = content;
  for (const patch of patches.reverse()) next = next.slice(0, patch.start) + patch.content + next.slice(patch.end);
  const verified = inspectSceneBehaviors(next);
  if (!verified.recognized || !verified.ok) invalid();
  return freeze({ content: next });
}

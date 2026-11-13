// Pure screen geometry and presentation. It grants no state mutation or input authority.
import { validateSceneHUD2DDocument, SCENE_HUD2D_ANCHORS } from './scene-hud2d.mjs';
import { projectSharedStateKey, projectSharedStateScalar } from './project-shared-state.mjs';
const fail = () => { throw Object.assign(new TypeError('Invalid bounded HUD view data.'), { errorCode: 'scene_hud2d_view_invalid' }); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function fields(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(input), names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))
    || keys.some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
function array(input, maximum, minimum = 0) {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) fail();
  const descriptors = Object.getOwnPropertyDescriptors(input), length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < minimum || length > maximum || Reflect.ownKeys(descriptors).length !== length + 1) fail();
  return Array.from({ length }, (_, index) => {
    const entry = descriptors[index]; if (!entry?.enumerable || !Object.hasOwn(entry, 'value')) fail(); return entry.value;
  });
}
const digits = integer => { let result = ''; do { const digit = integer % 10; result = '0123456789'[digit] + result; integer = Math.floor(integer / 10); } while (integer); return result; };
export function formatSceneHUD2DNumber(number) {
  if (typeof number !== 'number' || !Number.isFinite(number) || Math.abs(number) > 1e9) fail();
  const rounded = Math.floor(Math.abs(number) * 1000 + 0.5), whole = Math.floor(rounded / 1000), fraction = rounded % 1000;
  return (number < 0 && rounded ? '-' : '') + digits(whole) + (fraction ? '.' + digits(fraction).padStart(3, '0').replace(/0+$/, '') : '');
}
const visible = value => value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '\ufffd');
const clip = text => { const points = [...text]; return points.length > 256 ? points.slice(0, 256).join('') + '\u2026' : text; };
export function resolveSceneHUD2DView(input) {
  const raw = fields(input, ['document', 'viewport', 'state']); let document;
  try { document = validateSceneHUD2DDocument(raw.document); } catch { fail(); }
  const viewport = array(raw.viewport, 2, 2);
  if (!viewport.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 65536)) fail();
  const state = new Map();
  for (const row of array(raw.state, 64)) {
    const item = fields(row, ['key', 'value']);
    if (!projectSharedStateKey(item.key) || state.has(item.key) || typeof item.value === 'string' && item.value.length > 4096) fail();
    try { state.set(item.key, projectSharedStateScalar(item.value).value); } catch { fail(); }
  }
  const elements = document.elements.map(element => {
    const index = SCENE_HUD2D_ANCHORS.indexOf(element.anchor), anchor = [(index % 3) / 2, Math.floor(index / 3) / 2];
    const position = anchor.map((fraction, axis) => fraction * viewport[axis] + element.offset[axis] - fraction * element.size[axis]);
    const rect = { x: position[0], y: position[1], width: element.size[0], height: element.size[1] }, base = { id: element.id, kind: element.kind, rect };
    if (element.kind === 'bar') {
      const candidate = state.get(element.key), value = typeof candidate === 'number' ? candidate : element.fallback;
      return { ...base, value, ratio: Math.max(0, Math.min(1, (value - element.min) / (element.max - element.min))), fillColor: element.fillColor, backgroundColor: element.backgroundColor };
    }
    const content = element.content; let text;
    if (content.kind === 'literal') text = content.text;
    else {
      const value = state.get(content.key), scalar = !state.has(content.key) ? content.missing
        : typeof value === 'number' ? formatSceneHUD2DNumber(value) : typeof value === 'boolean' ? value ? 'true' : 'false' : visible(value);
      text = content.prefix + scalar + content.suffix;
    }
    return { ...base, text: clip(text), fontSize: element.fontSize, color: element.color };
  });
  return freeze({ viewport, elements });
}

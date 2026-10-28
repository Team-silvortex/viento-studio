// Translate the neutral, validated keyboard declaration only at the Godot
// boundary. Projects without a declaration never pass through this wrapper.
import fs from 'node:fs/promises';
import { buildError, buildHash } from '../adapters/node-build-snapshot.mjs';

const keycodes = Object.freeze({ ArrowLeft: 4194319, ArrowUp: 4194320, ArrowRight: 4194321,
  ArrowDown: 4194322, Space: 32, Enter: 4194309, Tab: 4194306 });
const physicalKey = name => {
  if (/^Key[A-Z]$/.test(name)) return name.charCodeAt(3);
  if (/^Digit[0-9]$/.test(name)) return name.charCodeAt(5);
  return keycodes[name];
};
const invalid = () => { throw buildError('build_input_map_invalid', 'Invalid keyboard input mapping for Godot.'); };

export async function applyGodotInputMap(generated, inputMap) {
  const document = inputMap?.document;
  if (document?.format !== 'viento-input-map' || document.schemaVersion !== 1 || !Array.isArray(document.actions)) invalid();
  const names = new Set(), rows = [];
  for (const action of document.actions) {
    if (typeof action.name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(action.name) || action.name.startsWith('ui_')
      || names.has(action.name) || !Array.isArray(action.keys) || !action.keys.length || new Set(action.keys).size !== action.keys.length) invalid();
    names.add(action.name);
    const events = action.keys.map(key => {
      const code = physicalKey(key);
      if (!Number.isSafeInteger(code)) invalid();
      return `Object(InputEventKey,"device":-1,"physical_keycode":${code})`;
    });
    rows.push(`${action.name}={\n"deadzone": 0.5,\n"events": [${events.join(', ')}]\n}`);
  }
  const entry = generated.files.get('project.godot');
  const clockOriginal = generated.files.get('execution-clock-original.godot');
  const original = clockOriginal || entry;
  if (!Buffer.isBuffer(entry) || !Buffer.isBuffer(original) || /^\[input\]\s*$/m.test(original.toString('utf8'))) invalid();
  const clockSuffix = '\n[autoload]\n\nVientoExecutionClock="*res://execution-clock-host.gd"\n';
  if (clockOriginal && !entry.equals(Buffer.concat([original, Buffer.from(clockSuffix)]))) invalid();
  const mapped = Buffer.from(`${original.toString('utf8')}\n[input]\n\n${rows.join('\n\n')}\n`);
  // The established clock layer authenticates project.godot against its
  // saved unclocked bytes. Keep that invariant after layering the input map.
  const project = clockOriginal ? Buffer.concat([mapped, Buffer.from(clockSuffix)]) : mapped;
  if (clockOriginal) generated.files.set('execution-clock-original.godot', mapped);
  generated.files.set('project.godot', project);
  generated.backend = { ...generated.backend, version: '0.38.0', capabilities: [...new Set([...generated.backend.capabilities, 'project.input-map'])],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), await fs.readFile(new URL('./godot4-input-map.mjs', import.meta.url)), project])) };
  return generated;
}

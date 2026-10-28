// Fresh author-plan suggestions only. User scripts remain arbitrary executable
// source: never infer their behavior from parameter names or rewrite them.
import { GODOT_CHARACTER_INTENT_SCRIPT } from './godot-character-intent-script.mjs';
import { GODOT_CHARACTER_DROP_THROUGH_SCRIPT } from './godot-character-drop-through-script.mjs';
import { parseJsonSource, locateJsonSource } from './json-source.mjs';

const starterActions = new Map([
  [GODOT_CHARACTER_INTENT_SCRIPT, Object.freeze({ left_action: 'ui_left', right_action: 'ui_right', jump_action: 'ui_accept' })],
  [GODOT_CHARACTER_DROP_THROUGH_SCRIPT, Object.freeze({ drop_action: 'ui_down' })],
]);
const LIMIT = 256;
export function inspectProjectInputActionReferences(scenes, inputMap, documents) {
  const actions = new Set((inputMap?.actions || []).map(action => action.name)), diagnostics = [];
  const byId = new Map(documents.map(document => [document.record?.id, document]));
  const parsed = new Map(); let count = 0;
  for (const scene of scenes) {
    const behaviors = scene.behaviors;
    if (!behaviors || behaviors.backendId !== 'org.viento.godot4' || behaviors.language !== 'gdscript') continue;
    const sources = new Map(behaviors.sources.map(source => [source.objectId, source.content]));
    for (const [index, binding] of behaviors.bindings.entries()) {
      const defaults = starterActions.get(sources.get(binding.implementation.sourceObjectId));
      if (!defaults) continue;
      for (const [name, fallback] of Object.entries(defaults)) {
        const value = Object.hasOwn(binding.parameters, name) ? binding.parameters[name] : fallback;
        // Godot provides many ui_* actions and scripts may register more at
        // runtime. Be conservative across Godot versions and app configurations.
        if (typeof value === 'string' && (value.startsWith('ui_') || actions.has(value))) continue;
        count++;
        if (diagnostics.length >= LIMIT) continue;
        const propertyPath = `/bindings/${index}/parameters/${name}`;
        const row = { severity: 'warning', code: inputMap ? 'build_input_action_unmapped' : 'build_input_action_unconfigured',
          message: inputMap ? 'This template action is not in the project input map. Add it to the map or check whether a script registers it at runtime.'
            : 'This project has no input map for the template action. Add a project input map or check whether a script registers it at runtime.',
          ...behaviors.manifest, propertyPath, sceneId: scene.scene.objectId, bindingId: binding.bindingId,
          instanceId: binding.instanceId, parameter: name };
        const doc = byId.get(behaviors.manifest.objectId);
        if (doc && doc.sourcePath === behaviors.manifest.sourcePath && doc.sourceRevision === behaviors.manifest.sourceRevision) {
          if (!parsed.has(doc)) parsed.set(doc, parseJsonSource(doc.content));
          const range = locateJsonSource(parsed.get(doc), propertyPath, { nearest: true });
          if (range) row.sourceRange = range;
        }
        diagnostics.push(row);
      }
    }
  }
  if (count > LIMIT) diagnostics[LIMIT - 1] = { severity: 'warning', code: 'build_input_action_unmapped_limit',
    ...diagnostics[LIMIT - 1], message: 'Further input action suggestions were omitted. Check the reported behavior bindings.',
    code: 'build_input_action_unmapped_limit', omittedCount: count - (LIMIT - 1) };
  return diagnostics;
}

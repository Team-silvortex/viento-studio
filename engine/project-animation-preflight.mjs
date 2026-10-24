// Fresh author-build checks only. Frozen project restoration and runtime readers
// retain their original contracts; this module never executes or rewrites source.
import { validateProjectAssemblyPlan } from './project-assembly-plan-contract.mjs';
import { hasAnimationStateScriptMarker, readAnimationStateScriptSource } from './animation-state-script-source.mjs';
import { inspectSceneBehaviors, SCENE_BEHAVIOR_LIMITS } from './scene-behaviors.mjs';
import { projectAnimationTargetForBinding } from './project-animation-targets.mjs';

export const PROJECT_ANIMATION_PREFLIGHT_LIMIT = 256;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.exec(value)?.[0] === value;
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.exec(value)?.[0] === value;
const path = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\\:\x00-\x1f\x7f]/.test(value)
  && value.split('/').every(part => part && part !== '.' && part !== '..');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const invalid = () => { throw Object.assign(new TypeError('Expected a bounded frozen project animation preflight plan.'), { errorCode: 'build_animation_state_preflight_invalid' }); };
const rejectedSource = error => /^animation_state_script_source_(?:invalid|modified|unsupported|limit)$/.test(error?.errorCode || '');
const location = value => uuid(value?.objectId) && path(value.sourcePath) && revision(value.sourceRevision);
const origin = value => ({ objectId: value.objectId, sourcePath: value.sourcePath, sourceRevision: value.sourceRevision });

// The project envelope safely detaches data before these fields are read. Check
// behavior provenance separately: the envelope intentionally delegates it.
function admitBehaviors(scene) {
  const value = scene.behaviors;
  if (scene.schemaVersion !== 3 || !exact(value, ['format', 'schemaVersion', 'backendId', 'language', 'manifest', 'sources', 'bindings'])
    || value.format !== 'viento-behavior-plan' || value.schemaVersion !== 1
    || !exact(value.manifest, ['objectId', 'sourcePath', 'sourceRevision']) || !location(value.manifest)
    || !value.manifest.sourcePath.toLowerCase().endsWith('.json') || value.manifest.objectId === scene.scene.objectId
    || !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > SCENE_BEHAVIOR_LIMITS.sources
    || !Array.isArray(value.bindings) || value.bindings.length < 1 || value.bindings.length > SCENE_BEHAVIOR_LIMITS.bindings) invalid();
  const sources = new Map(), actors = new Map(); let bytes = 0;
  for (const actor of scene.actors) {
    if (!uuid(actor.instanceId) || !uuid(actor.objectId) || actors.has(actor.instanceId)) invalid();
    actors.set(actor.instanceId, actor.objectId);
  }
  for (const source of value.sources) {
    if (!exact(source, ['objectId', 'sourcePath', 'sourceRevision', 'language', 'content']) || !location(source)
      || !source.sourcePath.toLowerCase().endsWith('.txt') || source.objectId === value.manifest.objectId || source.objectId === scene.scene.objectId
      || sources.has(source.objectId) || source.language !== value.language || typeof source.content !== 'string'
      || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(source.content)) invalid();
    const length = new TextEncoder().encode(source.content).length;
    if (length > SCENE_BEHAVIOR_LIMITS.sourceBytes || (bytes += length) > SCENE_BEHAVIOR_LIMITS.totalSourceBytes) invalid();
    sources.set(source.objectId, source);
  }
  const used = new Set(), bindings = value.bindings.map((binding, index) => {
    if (!exact(binding, ['bindingId', 'instanceId', 'objectId', 'implementation', 'parameters', 'events', 'declaration'])
      || binding.implementation?.backendId !== value.backendId || binding.implementation?.language !== value.language
      || !sources.has(binding.implementation.sourceObjectId) || !actors.has(binding.instanceId) || actors.get(binding.instanceId) !== binding.objectId
      || !exact(binding.declaration, ['objectId', 'sourcePath', 'sourceRevision', 'propertyPath'])
      || !['objectId', 'sourcePath', 'sourceRevision'].every(key => binding.declaration[key] === value.manifest[key])
      || binding.declaration.propertyPath !== `/bindings/${index}`) invalid();
    used.add(binding.implementation.sourceObjectId);
    const { objectId, declaration, ...author } = binding; return author;
  });
  if (used.size !== sources.size || !inspectSceneBehaviors(JSON.stringify({ format: 'viento-scene-behaviors', schemaVersion: 1,
    sceneObjectId: scene.scene.objectId, bindings })).ok) invalid();
  return value;
}

export function preflightProjectAnimationStates(input) {
  const plan = validateProjectAssemblyPlan(input), diagnostics = []; let count = 0;
  const emit = row => { count++; if (diagnostics.length < PROJECT_ANIMATION_PREFLIGHT_LIMIT) diagnostics.push({ severity: 'error', ...row }); };
  for (const scene of plan.scenes) {
    if (!scene.behaviors || scene.behaviors.backendId !== 'org.viento.godot4' || scene.behaviors.language !== 'gdscript') continue;
    const behaviors = admitBehaviors(scene), recognized = new Map();
    for (const source of behaviors.sources) {
      if (!hasAnimationStateScriptMarker(source.content)) continue;
      try { recognized.set(source.objectId, readAnimationStateScriptSource(source.content)); }
      catch (error) { if (!rejectedSource(error)) throw error; }
    }
    for (const [index, binding] of behaviors.bindings.entries()) {
      const declaration = recognized.get(binding.implementation.sourceObjectId);
      if (!declaration) continue;
      const at = { ...origin(behaviors.manifest), propertyPath: `/bindings/${index}`, sceneId: scene.scene.objectId,
        bindingId: binding.bindingId, instanceId: binding.instanceId, scriptObjectId: binding.implementation.sourceObjectId };
      if (!scene.animation) emit({ code: 'build_animation_state_animation_missing',
        message: 'The generated animation state controller requires an animation declaration on its scene.', ...at });
      else {
        try { projectAnimationTargetForBinding(scene.animation, binding); }
        catch { emit({ code: 'build_animation_state_target_missing',
          message: 'An instance animation controller requires at least one animation track for its bound instance.', ...at,
          propertyPath: `${at.propertyPath}/instanceId` }); }
      }
      const clips = new Set((scene.animation?.document.clips || []).map(clip => clip.id));
      for (const parameter of declaration.parameters) {
        const value = Object.hasOwn(binding.parameters, parameter.name) ? binding.parameters[parameter.name] : parameter.defaultValue;
        const field = { ...at, propertyPath: `${at.propertyPath}/parameters/${parameter.name}`, parameter: parameter.name, stateKey: parameter.stateKey };
        if (typeof value !== 'string' || value !== '' && !uuid(value)) emit({ code: 'build_animation_state_parameters_invalid',
          message: 'Animation state clip parameters require a lowercase UUID or empty text.', ...field });
        else if (scene.animation && value !== '' && !clips.has(value)) emit({ code: 'build_animation_state_clip_missing',
          message: 'The selected animation state clip does not exist in this scene animation.', ...field, clipId: value });
      }
    }
  }
  if (count > PROJECT_ANIMATION_PREFLIGHT_LIMIT) diagnostics[PROJECT_ANIMATION_PREFLIGHT_LIMIT - 1] = {
    severity: 'error', code: 'build_animation_state_preflight_limit', message: 'Further animation state binding errors were omitted. Correct the reported fields and check the project again.',
    ...origin(plan.assembly), propertyPath: '/sceneIds', omittedCount: count - (PROJECT_ANIMATION_PREFLIGHT_LIMIT - 1),
  };
  return freeze(diagnostics);
}

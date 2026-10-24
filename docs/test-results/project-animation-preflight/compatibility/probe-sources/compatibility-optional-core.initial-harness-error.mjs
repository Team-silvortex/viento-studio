import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { repo, moduleAt, hash, startReport, pass, finishReport, updateCapabilities, updateScriptRevisions, removeAnimations } from './compatibility-common.mjs';

const report = await startReport('compatibility-optional-core', 'Fresh isolated process retains actual base Rust core but removes all five optional animation-state feature exports. Ordinary and unmarked legacy scripts must not require those features.');
const core = await moduleAt('engine/studio-core.mjs');
const { completionProject } = await moduleAt('scripts/tests/helpers/project-animation-completion-fixture.mjs');
const { DEFAULT_GODOT_ANIMATION_STATE_SCRIPT } = await moduleAt('engine/godot-animation-state-script.mjs');
const { hasAnimationStateScriptMarker, DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT } = await moduleAt('engine/animation-state-script-source.mjs');
const { preflightProjectAnimationStates } = await moduleAt('engine/project-animation-preflight.mjs');
const wasm = await WebAssembly.instantiate(await fs.readFile(path.join(repo, 'engine/studio-core.wasm')), {});
const filtered = { ...wasm.instance.exports }, removedExports = [];
for (const key of Object.keys(filtered)) if (/^viento_core_animation_state_(?:table|conditions|branches|selectors|combinations)_version$/.test(key)) {
  removedExports.push(key); delete filtered[key];
}
assert.equal(removedExports.length, 5);
const instantiate = WebAssembly.instantiate;
try {
  WebAssembly.instantiate = async () => ({ instance: { exports: filtered } });
  const metadata = await core.initializeStudioCore(() => new Uint8Array([1]));
  assert.equal(metadata.ready, true);
} finally { WebAssembly.instantiate = instantiate; }
const support = Object.fromEntries(['Table', 'Conditions', 'Branches', 'Selectors', 'Combinations']
  .map(feature => [feature, core[`supportsStudioCoreAnimationState${feature}`]() ]));
assert.deepEqual(Object.values(support), [false, false, false, false, false]);
report.removedExports = removedExports.sort(); report.optionalFeatureSupport = support;
for (const [name, content] of [['ordinary', 'extends Node\n'], ['unmarked-legacy', DEFAULT_GODOT_ANIMATION_STATE_SCRIPT]]) {
  assert.equal(hasAnimationStateScriptMarker(content), false);
  for (const animation of [false, true]) {
    const plan = completionProject();
    for (const scene of plan.scenes) for (const source of scene.behaviors?.sources || []) source.content = content;
    if (!animation) removeAnimations(plan);
    updateScriptRevisions(plan); updateCapabilities(plan);
    const original = structuredClone(plan), diagnostics = preflightProjectAnimationStates(plan);
    assert.deepEqual(diagnostics, []); assert.ok(Object.isFrozen(diagnostics)); assert.deepEqual(plan, original);
    pass(report, { name: `${name}-${animation ? 'animated' : 'no-animation'}`, marker: false, animation,
      sourceSha256: hash(content), diagnostics: diagnostics.length, planUnchanged: true, optionalStateFeaturesAvailable: false });
  }
}
// Control: prove this process is actually missing the strict generated-script feature.
const strict = completionProject(); strict.scenes[0].behaviors.sources[0].content = DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT;
strict.scenes[0].behaviors.bindings[0].parameters = {}; updateScriptRevisions(strict);
let strictError;
try { preflightProjectAnimationStates(strict); } catch (error) { strictError = error; }
assert.ok(strictError, 'Strict generated source must not silently bypass the missing optional feature.');
assert.equal(strictError.errorCode, 'studio_core_animation_state_table_unavailable');
report.strictGeneratedControl = { status: 'passed', expectedErrorCode: strictError.errorCode };
console.log(JSON.stringify({ event: 'control', ...report.strictGeneratedControl }));
await finishReport(report);

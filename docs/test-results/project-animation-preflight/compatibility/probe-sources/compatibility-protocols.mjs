import assert from 'node:assert/strict';
import { moduleAt, hash, startReport, pass, finishReport, updateCapabilities, updateScriptRevisions, removeAnimations } from './compatibility-common.mjs';

const report = await startReport('compatibility-protocols', 'Pure project generation before and after fresh preflight; no Godot import, compilation, or runtime execution.');
await moduleAt('scripts/adapters/node-studio-core.mjs');
const { completionProject } = await moduleAt('scripts/tests/helpers/project-animation-completion-fixture.mjs');
const { DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT } = await moduleAt('engine/animation-state-script-source.mjs');
const { preflightProjectAnimationStates } = await moduleAt('engine/project-animation-preflight.mjs');
const { generateGodotAssemblyProject } = await moduleAt('scripts/backends/godot4-project.mjs');
const { canonicalJson } = await moduleAt('engine/world-projection.mjs');
const outputReceipt = generated => ({ backend: generated.backend, sourceMap: generated.sourceMap,
  resourceFiles: [...generated.resourceFiles].sort(([a], [b]) => a.localeCompare(b)),
  files: [...generated.files].map(([name, bytes]) => ({ name, size: bytes.byteLength, sha256: hash(bytes) })).sort((a, b) => a.name.localeCompare(b.name)) });

for (const expectedProtocol of [4, 7, 10, 11]) {
  const plan = completionProject();
  if (expectedProtocol === 4) removeAnimations(plan);
  if (expectedProtocol >= 10) {
    plan.scenes[0].behaviors.sources[0].content = DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT;
    plan.scenes[0].behaviors.bindings[0].parameters = {};
  }
  if (expectedProtocol === 11) {
    const scene = plan.scenes[0];
    scene.animation.schemaVersion = 3; scene.animation.document.schemaVersion = 4;
    scene.animation.document.playbackScope = 'instance'; scene.requiredCapabilities.push('animation.instances2d');
  }
  updateScriptRevisions(plan); updateCapabilities(plan);
  const original = structuredClone(plan), inputSha256 = hash(canonicalJson(plan));
  const before = await generateGodotAssemblyProject(plan);
  assert.deepEqual(plan, original, 'Generation must leave the caller plan unchanged.');
  const diagnostics = preflightProjectAnimationStates(plan);
  assert.deepEqual(diagnostics, []); assert.ok(Object.isFrozen(diagnostics));
  assert.deepEqual(plan, original, 'Preflight must leave the caller plan unchanged.');
  const after = await generateGodotAssemblyProject(plan);
  assert.equal(before.backend.protocolVersion, expectedProtocol);
  assert.equal(after.backend.protocolVersion, expectedProtocol);
  const beforeReceipt = outputReceipt(before), afterReceipt = outputReceipt(after);
  assert.deepEqual(afterReceipt, beforeReceipt, 'Generated file bytes, source map, resources, and backend metadata must be identical.');
  assert.deepEqual(plan, original);
  const inventory = JSON.parse(after.files.get('assembly.json'));
  pass(report, { name: `effective-p${expectedProtocol}`, expectedProtocol, actualProtocol: after.backend.protocolVersion,
    backendVersion: after.backend.version, inventorySchemaVersion: inventory.schemaVersion, diagnostics: diagnostics.length,
    planUnchanged: true, generatedOutputUnchanged: true, generatedFileCount: after.files.size,
    inputSha256, generatedReceiptSha256: hash(canonicalJson(afterReceipt)), generatedFiles: afterReceipt.files });
}
await finishReport(report);

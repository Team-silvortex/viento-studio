import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { validateProjectAssemblyPlan as validateFrozenProject } from '../../engine/project-assembly-plan-contract.mjs';
import { runtimeProject, returnTrip } from './helpers/project-runtime-fixture.mjs';
import { sharedStateProject, stateReturnTrip } from './helpers/project-shared-state-fixture.mjs';
import { eventProject, eventReturnTrip } from './helpers/project-event-bus-fixture.mjs';
import { audioProject, audioReturnTrip } from './helpers/project-audio-command-fixture.mjs';

import { clipProject, clipReturnTrip } from './helpers/project-animation-clip-command-fixture.mjs';
import { animationProject, animationReturnTrip } from './helpers/project-animation-command-fixture.mjs';

for (const protocolVersion of [1, 2, 3, 4, 5, 6]) test(`browser project protocol ${protocolVersion} recursively links real ES modules without bare packages, Node APIs or author build parsing`, () => {
  const plan = protocolVersion === 1 ? runtimeProject({ behavior: true }) : protocolVersion === 2 ? sharedStateProject() : protocolVersion === 3 ? eventProject() : protocolVersion === 4 ? audioProject({ empty: true }) : protocolVersion === 5 ? animationProject() : clipProject(), frames = protocolVersion === 1 ? returnTrip(plan) : protocolVersion === 2 ? stateReturnTrip(plan) : protocolVersion === 3 ? eventReturnTrip(plan) : protocolVersion === 4 ? audioReturnTrip(plan) : protocolVersion === 5 ? animationReturnTrip(plan) : clipReturnTrip(plan);
  const runner = `
    import fs from 'node:fs/promises';
    import vm from 'node:vm';
    import assert from 'node:assert/strict';
    const root = ${JSON.stringify(new URL('../../engine/', import.meta.url).href)};
    const modules = new Map(), context = vm.createContext({ TextEncoder, TextDecoder, nativeStructuredClone: structuredClone });
    // The native browser clone returns values in the calling realm. Node's
    // injected clone instead returns host objects: re-enter these JSON-only
    // frozen plans into the VM realm before strict prototype admission.
    vm.runInContext('globalThis.structuredClone = value => JSON.parse(JSON.stringify(nativeStructuredClone(value)))', context);
    function load(url) {
      if (!url.startsWith(root) || !url.endsWith('.mjs')) throw new Error('Non-portable module URL: ' + url);
      // Cache before async file IO: parallel imports must share one module and
      // one Rust runtime singleton, exactly as native browser ES imports do.
      if (!modules.has(url)) modules.set(url, fs.readFile(new URL(url), 'utf8')
        .then(source => new vm.SourceTextModule(source, { context, identifier: url })));
      return modules.get(url);
    }
    const entry = await load(root + 'project-runtime-query.mjs');
    await entry.link(async (specifier, parent) => {
      assert.ok(specifier.startsWith('./'), 'Browser cannot resolve dependency: ' + specifier);
      assert.ok(!/^(?:project-assembly-plan|build-plan|world-projection|document-parser)\\.mjs$/.test(specifier.slice(2)), 'Runtime imported author parsing: ' + specifier);
      return load(new URL(specifier, parent.identifier).href);
    });
    await entry.evaluate(); context.api = entry.namespace;
    if (${protocolVersion} >= 4) {
      const core = (await modules.get(root + 'studio-core.mjs')).namespace;
      await core.initializeStudioCore(() => fs.readFile(new URL(root + 'studio-core.wasm')));
      assert.equal(core.getStudioCoreMetadata().ready, true);
    }
    assert.equal(vm.runInContext('typeof process+":"+typeof Buffer+":"+typeof require+":"+typeof document', context), 'undefined:undefined:undefined:undefined');
    const output = vm.runInContext(${JSON.stringify(`(() => {
      const observer = api.createProjectRuntimeObservation(${JSON.stringify(plan)}, { protocolVersion: ${protocolVersion} });
      for (const frame of ${JSON.stringify(frames)}) if (!observer.push(frame)) throw new Error('Rejected browser event');
      return JSON.stringify(api.queryProjectRuntimeObservation(observer.snapshot()));
    })()`)}, context);
    process.stdout.write(JSON.stringify({ view: JSON.parse(output), modules: [...modules.keys()].map(url => url.slice(root.length)) }));
  `;
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', runner], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout); assert.equal(output.view.project.visits.length, 3); assert.equal(output.view.phase, 'finished');
  assert.equal(output.view.project.activeSceneId, plan.entrySceneId);
  if (protocolVersion === 2) {
    assert.equal(output.view.project.sharedState.revision, 4); assert.equal(output.view.project.sharedState.entries[1].value, '风と風 🌬️');
    assert.ok(output.modules.includes('project-shared-state.mjs'));
  }
  if (protocolVersion === 3) {
    assert.equal(output.view.project.events.sequence, 4); assert.equal(output.view.project.events.entries[0].value, '钥匙 / 鍵 🔑');
    assert.equal(output.view.project.events.entries[1].deliveries[0].status, 'skipped'); assert.ok(output.modules.includes('project-event-bus.mjs'));
  }
  if (protocolVersion === 4) {
    assert.equal(output.view.project.audioCommands.sequence, 6);
    assert.equal(output.view.project.audioCommands.entries[0].track.source.sourceRange.exact, true);
    assert.equal(output.view.project.audioCommands.entries[2].origin.visitIndex, 2);
    assert.ok(output.modules.includes('project-audio-commands.mjs'));
  }
  if (protocolVersion === 5) {
    assert.equal(output.view.project.animationCommands.sequence, 8);
    assert.equal(output.view.project.animationCommands.entries[5].origin.visitIndex, 2);
    assert.ok(output.modules.includes('project-animation-commands.mjs'));
  }
  if (protocolVersion === 6) {
    assert.equal(output.view.project.animationCommands.sequence, 14);
    assert.equal(output.view.project.animationCommands.entries[0].clip.source.propertyPath, '/clips/0');
    assert.equal(output.view.project.animationCommands.entries[13].state.clipId, null);
    assert.ok(output.modules.includes('project-animation-transport.mjs'));
  }
  assert.ok(output.modules.includes('project-assembly-plan-contract.mjs')); assert.ok(output.modules.includes('scene-audio-events.mjs'));
  assert.equal(output.modules.some(path => ['project-assembly-plan.mjs', 'build-plan.mjs'].includes(path)), false);
  assert.ok(output.modules.length > 10, 'The regression must traverse the complete transitive engine graph.');
});

test('author plan module preserves the exact frozen envelope validation export after browser-safe separation', () => {
  assert.equal(validateProjectAssemblyPlan, validateFrozenProject);
  const plan = runtimeProject(); assert.deepEqual(validateFrozenProject(plan), plan);
  assert.throws(() => validateFrozenProject({ ...plan, entrySceneId: plan.assembly.objectId }), { errorCode: 'build_assembly_invalid' });
});

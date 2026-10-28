import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { BEVY_EXECUTION_ADAPTER } from '../backends/bevy-adapter.mjs';
import { BEVY_RUST_EXECUTION_ADAPTER } from '../backends/bevy-rust-adapter.mjs';

const inputMap = { format: 'viento-input-map', schemaVersion: 1, actions: [
  { name: 'player_left', keys: ['KeyA', 'ArrowLeft'] },
  { name: 'player_jump', keys: ['Space'] },
] };

for (const adapter of [BEVY_EXECUTION_ADAPTER, BEVY_RUST_EXECUTION_ADAPTER]) {
  test(`${adapter.descriptor.id} rejects project keyboard mappings before using tools or creating output`, async t => {
    const f = await projectAssemblyAuthor(t, { inputMap });
    const files = ['documents/projects/demo.json', 'documents/projects/controls.json', `metadata/documents/${f.inputMapId}.json`];
    const before = await Promise.all(files.map(file => fs.readFile(path.join(f.author, file))));
    const captured = await captureBuildSnapshot(f.author, f.assemblyId);
    assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
    assert.equal(captured.plan.schemaVersion, 2);
    assert.deepEqual(captured.plan.inputMap.document, inputMap);
    const diagnostics = checkExecutionBackendSupport(adapter.descriptor, { operation: 'build', plan: captured.plan });
    assert.ok(diagnostics.some(row => row.code === 'build_backend_plan_unsupported' && row.kind === 'project' && row.schemaVersion === 2));
    assert.ok(diagnostics.some(row => row.code === 'build_capability_missing' && row.capability === 'project.input-map'));
    await assert.rejects(adapter.generate(captured.plan), { errorCode: 'build_backend_plan_unsupported' });
    const output = path.join(f.temporary, 'output');
    const result = await buildProject({ root: f.author, scene: f.assemblyId, backendId: adapter.descriptor.id, tool: '/nonexistent/viento-tool', output });
    assert.equal(result.status, 'rejected');
    assert.ok(result.diagnostics.some(row => row.code === 'build_backend_plan_unsupported' && row.kind === 'project'));
    assert.ok(result.diagnostics.some(row => row.code === 'build_capability_missing' && row.capability === 'project.input-map'));
    await assert.rejects(fs.lstat(output), { code: 'ENOENT' });
    assert.deepEqual(await Promise.all(files.map(file => fs.readFile(path.join(f.author, file)))), before);
  });
}

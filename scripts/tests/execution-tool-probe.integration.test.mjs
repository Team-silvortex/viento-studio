import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { probeExecutionTool, readExecutionToolCandidate } from '../adapters/node-execution-tool-probe.mjs';
import { BEVY_RUNTIME_IDENTITY } from '../backends/bevy-project.mjs';
import { validateExecutionToolStatus } from '../../engine/execution-tool-status.mjs';

// Opt-in identity probes only: these tests never generate or execute a scene,
// write an author project, or change a configured tool.
const registry = createExecutionBackendRegistry();
const godot = registry.resolve('org.viento.godot4');
const bevy = registry.resolve('org.viento.bevy');
const godotPath = process.env.VIENTO_GODOT_BIN;
const bevyPath = process.env.VIENTO_BEVY_BIN;
const oldBevyPath = process.env.VIENTO_BEVY_OLD_BIN;
const real = (...paths) => ({
  skip: process.platform !== 'linux' ? 'Real engine probes are enabled only on Linux'
    : paths.some(value => !value) ? 'Set the corresponding VIENTO_GODOT_BIN / VIENTO_BEVY_BIN / VIENTO_BEVY_OLD_BIN paths' : false,
  timeout: 20000,
});

async function sha256(file) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
}

async function observeTool(t, toolPath) {
  const resolved = await fs.realpath(toolPath);
  const metadata = async () => {
    const stat = await fs.stat(resolved, { bigint: true });
    assert.ok(stat.isFile());
    return ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs'].map(key => stat[key]);
  };
  const before = await metadata();
  t.after(async () => {
    assert.equal(await fs.realpath(toolPath), resolved, 'The configured tool must keep the same resolved identity');
    assert.deepEqual(await metadata(), before, 'Identity probing must not modify the configured tool');
  });
  return resolved;
}

function assertPublicStatus(status, backendId) {
  assert.deepEqual(validateExecutionToolStatus(status), status);
  assert.deepEqual(Object.keys(status).sort(), ['backendId', 'format', 'identity', 'reason', 'schemaVersion', 'status']);
  assert.equal(status.backendId, backendId);
  assert.ok(Object.isFrozen(status));
  if (status.identity) {
    assert.deepEqual(Object.keys(status.identity).sort(), ['arch', 'platform', 'sha256', 'version']);
    assert.ok(Object.isFrozen(status.identity));
  }
  assert.doesNotMatch(JSON.stringify(status), /"(?:executable|toolPath|candidateKey|stdout|stderr)"/);
}

async function checkReady(t, adapter, toolPath, expectedVersion) {
  const resolved = await observeTool(t, toolPath);
  const candidate = await readExecutionToolCandidate(adapter, { toolPath });
  assert.equal(candidate.supported, true);
  assert.equal(candidate.available, true);
  assert.equal(candidate.reason, null);
  assert.match(candidate.candidateKey, /^sha256:[a-f0-9]{64}$/);
  const result = await probeExecutionTool(adapter, { toolPath });
  assert.deepEqual(Object.keys(result).sort(), ['candidateKey', 'toolStatus']);
  assertPublicStatus(result.toolStatus, adapter.descriptor.id);
  assert.equal(result.toolStatus.status, 'ready');
  assert.equal(result.toolStatus.reason, null);
  assert.equal(result.candidateKey, candidate.candidateKey);
  const identity = result.toolStatus.identity;
  if (typeof expectedVersion === 'string') assert.equal(identity.version, expectedVersion);
  else assert.match(identity.version, expectedVersion);
  assert.equal(identity.sha256, await sha256(resolved), 'Public identity must contain the full executable SHA-256');
  assert.equal(identity.platform, process.platform);
  assert.equal(identity.arch, process.arch);
  assert.ok(!JSON.stringify(result.toolStatus).includes(resolved));
  assert.equal((await readExecutionToolCandidate(adapter, { toolPath })).candidateKey, candidate.candidateKey);
  t.diagnostic(`${adapter.descriptor.id}: ${identity.version}; sha256=${identity.sha256}`);
}

async function checkVersionRejected(t, adapter, toolPath) {
  const resolved = await observeTool(t, toolPath);
  const candidate = await readExecutionToolCandidate(adapter, { toolPath });
  assert.equal(candidate.supported, true);
  assert.equal(candidate.available, true, 'Executable availability alone must not imply compatible identity');
  const result = await probeExecutionTool(adapter, { toolPath });
  assertPublicStatus(result.toolStatus, adapter.descriptor.id);
  assert.equal(result.toolStatus.status, 'unavailable');
  assert.equal(result.toolStatus.reason, 'tool_version');
  assert.equal(result.toolStatus.identity, null);
  assert.equal(result.candidateKey, candidate.candidateKey);
  assert.ok(!JSON.stringify(result.toolStatus).includes(resolved));
}

test('real Godot tool probe admits a compatible identity and the full executable hash', real(godotPath), async t => {
  await checkReady(t, godot, godotPath, /^4\.\d+(?:\.\d+)?\.[\w.-]+$/);
});

test('real pinned Bevy tool probe admits the exact runtime identity and executable hash', real(bevyPath), async t => {
  await checkReady(t, bevy, bevyPath, BEVY_RUNTIME_IDENTITY);
});

test('real old Bevy 0.2.0 tool is executable but rejected by the current identity probe', real(oldBevyPath), async t => {
  await checkVersionRejected(t, bevy, oldBevyPath);
});

test('a real Bevy executable cannot satisfy the Godot tool probe', real(bevyPath), async t => {
  await checkVersionRejected(t, godot, bevyPath);
});

test('a real Godot executable cannot satisfy the Bevy tool probe', real(godotPath), async t => {
  await checkVersionRejected(t, bevy, godotPath);
});

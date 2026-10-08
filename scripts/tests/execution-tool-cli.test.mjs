import test from 'node:test';
import assert from 'node:assert/strict';
import { runProjectBuildCommand } from '../project-build.mjs';

const command = ['--command', 'tool-check', '--backend', 'org.viento.godot4'];
const linux = { skip: process.platform !== 'linux' };

test('tool check CLI reports an absent host tool without requiring an author workspace', linux, async () => {
  const result = await runProjectBuildCommand([...command, '--tool', '']);
  assert.equal(result.ok, false);
  assert.deepEqual(result.toolStatus, {
    format: 'viento-execution-tool-status', schemaVersion: 1,
    backendId: 'org.viento.godot4', status: 'unavailable', reason: 'tool_missing', identity: null,
  });
  assert.deepEqual(Object.keys(result), ['ok', 'toolStatus']);
});

test('tool check CLI rejects workspace, output and runtime inputs before checking a tool', async () => {
  for (const input of [
    ['--root', '/does-not-exist'], ['--scene', 'unread'], ['--build', '/not-a-build'],
    ['--output', '/unwritten'], ['--control-program', '/unread.json'],
    ['--window'], ['--no-window'], ['--interactive'], ['--capture'],
  ]) {
    // The parser also rejects unsupported negative boolean spellings.
    await assert.rejects(runProjectBuildCommand([...command, '--tool', process.execPath, ...input]));
  }
});

test('tool check CLI has its own total deadline and preserves the Godot-only alias', async () => {
  for (const value of ['0', '-1', '12001', 'Infinity', '1.5']) {
    await assert.rejects(runProjectBuildCommand([...command, '--tool', '', '--timeout-ms', value]));
  }
  await assert.rejects(runProjectBuildCommand([...command, '--godot', process.execPath, '--tool', process.execPath]));
  await assert.rejects(runProjectBuildCommand(['--command', 'tool-check', '--backend', 'org.viento.bevy', '--godot', process.execPath]));
  await assert.rejects(runProjectBuildCommand(['--command', 'tool-check', '--backend', 'unregistered', '--tool', process.execPath]), { errorCode: 'build_backend_missing' });
});

test('tool check CLI rejects an executable from a different toolchain without exposing its path', linux, async () => {
  const result = await runProjectBuildCommand([...command, '--tool', process.execPath]);
  assert.equal(result.ok, false); assert.equal(result.toolStatus.reason, 'tool_version');
  assert.equal(result.toolStatus.identity, null);
  const encoded = JSON.stringify(result);
  assert.ok(!encoded.includes(process.execPath));
  assert.ok(!encoded.includes('stdout')); assert.ok(!encoded.includes('stderr'));
});

test('tool check CLI cancellation never reports a cached ready identity', linux, async () => {
  const controller = new AbortController(); controller.abort();
  const result = await runProjectBuildCommand([...command, '--tool', process.execPath], { signal: controller.signal });
  assert.equal(result.ok, false); assert.equal(result.toolStatus.reason, 'tool_cancelled');
  assert.equal(result.toolStatus.identity, null);
});

test('tool check CLI uses the configured real backend identity without project output', { skip: !process.env.VIENTO_BEVY_BIN || process.platform !== 'linux' }, async () => {
  const result = await runProjectBuildCommand(['--command', 'tool-check', '--backend', 'org.viento.bevy']);
  assert.equal(result.ok, true);
  assert.equal(result.toolStatus.identity.version, 'viento-bevy-runtime 0.3.0 bevy 0.19.1');
  assert.match(result.toolStatus.identity.sha256, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result).includes(process.env.VIENTO_BEVY_BIN));
});

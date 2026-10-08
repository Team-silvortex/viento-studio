import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { readExecutionToolCandidate, probeExecutionTool, EXECUTION_TOOL_PROBE_TIMEOUT_MS } from '../adapters/node-execution-tool-probe.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const error = code => Object.assign(new Error('Private process diagnostics: /private/tool'), { errorCode: code,
  processResult: { stdout: '/private/tool', stderr: 'private diagnostics' } });
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-tool-probe-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'tool');
  await fs.writeFile(file, 'trusted tool bytes', { mode: 0o700 });
  let identifications = 0;
  const adapter = {
    descriptor: { id: 'org.viento.test' },
    async availability({ toolPath, enabled = true, platform = process.platform }) {
      if (!enabled || platform !== process.platform) return { supported: false, available: false, reason: 'platform_unsupported' };
      try {
        const stat = await fs.stat(toolPath); await fs.access(toolPath, constants.X_OK);
        return { supported: true, available: stat.isFile(), reason: stat.isFile() ? null : 'tool_missing' };
      } catch { return { supported: true, available: false, reason: 'tool_missing' }; }
    },
    async identify(executable) {
      identifications++;
      return { executable, version: 'trusted-runtime 1.0.0', sha256: hash(await fs.readFile(executable)),
        platform: process.platform, arch: process.arch, stdout: '/private/tool', stderr: 'private diagnostics' };
    },
  };
  return { root, file, adapter, count: () => identifications };
}

test('candidate polling never identifies a tool and publishes only an opaque private signature', async t => {
  const { file, adapter, count } = await fixture(t);
  const before = await fs.readFile(file);
  const first = await readExecutionToolCandidate(adapter, { toolPath: file });
  const second = await readExecutionToolCandidate(adapter, { toolPath: file });
  assert.deepEqual(second, first); assert.equal(first.available, true);
  assert.match(first.candidateKey, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(first).includes(file), false);
  assert.equal(count(), 0); assert.deepEqual(await fs.readFile(file), before);
  await fs.chmod(file, 0o600);
  assert.deepEqual(await readExecutionToolCandidate(adapter, { toolPath: file }),
    { supported: true, available: false, reason: 'tool_missing', candidateKey: null });
});

test('absent, disabled and unsupported candidates do not start identity processes', async t => {
  const { file, root, adapter, count } = await fixture(t);
  for (const [options, reason] of [
    [{ toolPath: path.join(root, 'missing') }, 'tool_missing'], [{ toolPath: root }, 'tool_missing'],
    [{ toolPath: file, enabled: false }, 'platform_unsupported'], [{ toolPath: file, platform: 'unsupported' }, 'platform_unsupported'],
  ]) {
    const result = await probeExecutionTool(adapter, options);
    assert.equal(result.toolStatus.status, 'unavailable'); assert.equal(result.toolStatus.reason, reason);
    assert.equal(result.candidateKey, null); assert.equal(result.toolStatus.identity, null);
  }
  assert.equal(count(), 0);
});

test('successful identity strips private host fields and leaves the configured file unchanged', async t => {
  const { file, adapter, count } = await fixture(t);
  const before = await fs.readFile(file);
  const candidate = await readExecutionToolCandidate(adapter, { toolPath: file });
  const result = await probeExecutionTool(adapter, { toolPath: file });
  assert.equal(result.candidateKey, candidate.candidateKey);
  assert.equal(result.toolStatus.status, 'ready'); assert.equal(result.toolStatus.reason, null);
  assert.deepEqual(result.toolStatus.identity, { version: 'trusted-runtime 1.0.0', sha256: hash(before), platform: process.platform, arch: process.arch });
  assert.equal(JSON.stringify(result).includes(file), false);
  assert.equal(JSON.stringify(result).includes('private diagnostics'), false);
  assert.equal(Object.isFrozen(result.toolStatus.identity), true);
  assert.equal(count(), 1); assert.deepEqual(await fs.readFile(file), before);
});

test('incompatible versions and bounded process failures become controlled public reasons', async t => {
  const { file, adapter } = await fixture(t);
  for (const [code, reason] of [['build_tool_version', 'tool_version'], ['build_tool_timeout', 'tool_timeout'],
    ['build_tool_output-limit', 'tool_output_limit'], ['build_tool_failed', 'tool_failed'], ['unexpected_error', 'tool_failed']]) {
    adapter.identify = async () => { throw error(code); };
    const result = await probeExecutionTool(adapter, { toolPath: file });
    assert.equal(result.toolStatus.status, 'unavailable'); assert.equal(result.toolStatus.reason, reason);
    assert.equal(result.toolStatus.identity, null);
    assert.equal(JSON.stringify(result).includes('Private process'), false);
  }
  adapter.identify = async () => ({ version: '4.7.2', sha256: 'wrong', platform: process.platform, arch: process.arch });
  assert.equal((await probeExecutionTool(adapter, { toolPath: file })).toolStatus.reason, 'tool_failed');
});

test('same-path replacement and link retargeting during identify invalidate its successful result', async t => {
  const { file, root, adapter } = await fixture(t);
  const originalIdentify = adapter.identify;
  adapter.identify = async executable => {
    const identity = await originalIdentify(executable);
    const replacement = path.join(root, 'replacement');
    await fs.writeFile(replacement, 'new trusted bytes', { mode: 0o700 }); await fs.rename(replacement, file);
    return identity;
  };
  const changed = await probeExecutionTool(adapter, { toolPath: file });
  assert.equal(changed.toolStatus.reason, 'tool_changed'); assert.equal(changed.toolStatus.identity, null);
  assert.equal(changed.candidateKey, (await readExecutionToolCandidate(adapter, { toolPath: file })).candidateKey);
  const alternate = path.join(root, 'alternate'); const link = path.join(root, 'configured-link');
  await fs.writeFile(alternate, 'alternate bytes', { mode: 0o700 }); await fs.symlink(file, link);
  adapter.identify = async executable => {
    const identity = await originalIdentify(executable);
    await fs.unlink(link); await fs.symlink(alternate, link);
    return identity;
  };
  assert.equal((await probeExecutionTool(adapter, { toolPath: link })).toolStatus.reason, 'tool_changed');
});

test('total deadline aborts and awaits the real process before returning timeout', async t => {
  const { file, adapter } = await fixture(t);
  await fs.writeFile(file, `#!${process.execPath}\nsetInterval(()=>{},1000);\n`, { mode: 0o700 });
  let pid, finished = false;
  adapter.identify = async (executable, { signal }) => {
    const result = await runBuildProcess(executable, ['--version'], { cwd: path.dirname(executable), signal, timeoutMs: 10000, onStart: info => { pid = info.pid; } });
    finished = true;
    if (result.status !== 'succeeded') throw error('build_tool_' + result.status);
    return {};
  };
  const result = await probeExecutionTool(adapter, { toolPath: file, timeoutMs: 150 });
  assert.equal(result.toolStatus.reason, 'tool_timeout'); assert.equal(result.toolStatus.identity, null);
  assert.equal(finished, true); assert.ok(pid);
  assert.throws(() => process.kill(pid, 0), value => value.code === 'ESRCH');
});

test('external cancellation remains cancellation even after the deadline and after a late successful identify', async t => {
  const { file, adapter } = await fixture(t);
  const controller = new AbortController();
  let cleaned = false;
  const originalIdentify = adapter.identify;
  adapter.identify = async (executable, { signal }) => {
    signal.addEventListener('abort', () => {}, { once: true });
    controller.abort();
    await new Promise(resolve => setTimeout(resolve, 60));
    cleaned = true;
    return originalIdentify(executable);
  };
  const result = await probeExecutionTool(adapter, { toolPath: file, signal: controller.signal, timeoutMs: 40 });
  assert.equal(result.toolStatus.reason, 'tool_cancelled'); assert.equal(result.toolStatus.identity, null);
  assert.equal(cleaned, true);
  adapter.identify = async () => { throw new Error('Must not identify an already cancelled request'); };
  assert.equal((await probeExecutionTool(adapter, { toolPath: file, signal: controller.signal })).toolStatus.reason, 'tool_cancelled');
});

test('deadline includes candidate discovery and timeout options cannot silently remove the bound', async t => {
  const { file, adapter, count } = await fixture(t);
  const originalAvailability = adapter.availability;
  adapter.availability = async options => {
    await new Promise(resolve => setTimeout(resolve, 30));
    return originalAvailability(options);
  };
  const result = await probeExecutionTool(adapter, { toolPath: file, timeoutMs: 10 });
  assert.equal(result.toolStatus.reason, 'tool_timeout'); assert.equal(count(), 0);
  assert.equal(EXECUTION_TOOL_PROBE_TIMEOUT_MS, 12000);
  for (const timeoutMs of [0, -1, Infinity, NaN, 0.5, '100', 12001]) {
    await assert.rejects(probeExecutionTool(adapter, { toolPath: file, timeoutMs }), value => value.errorCode === 'build_tool_status_invalid');
  }
});

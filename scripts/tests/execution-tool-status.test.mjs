import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createExecutionToolStatus, validateExecutionToolStatus,
  EXECUTION_TOOL_STATUS_SCHEMA_VERSION, EXECUTION_TOOL_STATUSES, EXECUTION_TOOL_REASONS } from '../../engine/execution-tool-status.mjs';

const identity = () => ({ version: 'viento-bevy-runtime 0.3.0 bevy 0.19.1', sha256: 'a'.repeat(64), platform: 'linux', arch: 'x64' });
const ready = () => ({ backendId: 'org.viento.bevy', status: 'ready', identity: identity() });
const invalid = error => error instanceof TypeError && error.errorCode === 'build_tool_status_invalid';

test('tool status detaches and freezes the transport identity without executable authority', () => {
  const original = ready();
  const result = createExecutionToolStatus(original);
  assert.equal(result.format, 'viento-execution-tool-status');
  assert.equal(result.schemaVersion, EXECUTION_TOOL_STATUS_SCHEMA_VERSION);
  assert.equal(result.reason, null);
  assert.notEqual(result.identity, original.identity);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.identity), true);
  original.identity.version = 'modified';
  assert.equal(result.identity.version, 'viento-bevy-runtime 0.3.0 bevy 0.19.1');
  assert.deepEqual(validateExecutionToolStatus(JSON.parse(JSON.stringify(result))), result);
  assert.throws(() => { result.identity.sha256 = 'b'.repeat(64); }, TypeError);
});

test('pending statuses never claim an identity and failure states use controlled reasons', () => {
  for (const status of ['unchecked', 'checking']) {
    assert.equal(createExecutionToolStatus({ backendId: 'org.viento.godot4', status }).identity, null);
    for (const extra of [{ identity: identity() }, { reason: 'tool_missing' }]) {
      assert.throws(() => createExecutionToolStatus({ backendId: 'org.viento.godot4', status, ...extra }), invalid);
    }
  }
  for (const reason of EXECUTION_TOOL_REASONS) {
    const result = createExecutionToolStatus({ backendId: 'org.viento.godot4', status: 'unavailable', reason });
    assert.equal(result.reason, reason); assert.equal(result.identity, null);
  }
  assert.deepEqual(EXECUTION_TOOL_STATUSES, ['unchecked', 'checking', 'ready', 'unavailable']);
  for (const value of [
    { ...ready(), reason: 'tool_version' }, { backendId: 'org.viento.bevy', status: 'ready' },
    { backendId: 'org.viento.bevy', status: 'unavailable' },
    { backendId: 'org.viento.bevy', status: 'unavailable', reason: 'unexpected' },
    { ...ready(), status: 'available' },
  ]) assert.throws(() => createExecutionToolStatus(value), invalid);
});

test('unknown transport and identity fields reject paths, logs and executable callbacks', () => {
  const dto = createExecutionToolStatus(ready());
  for (const key of ['toolPath', 'executable', 'stdout', 'stderr', 'probe', 'supported', 'available']) {
    assert.throws(() => validateExecutionToolStatus({ ...dto, [key]: '/private/tool' }), invalid);
    assert.throws(() => createExecutionToolStatus({ ...ready(), [key]: () => {} }), invalid);
    assert.throws(() => createExecutionToolStatus({ ...ready(), identity: { ...identity(), [key]: '/private/tool' } }), invalid);
  }
  for (const key of Object.keys(dto)) {
    const missing = { ...dto }; delete missing[key];
    assert.throws(() => validateExecutionToolStatus(missing), invalid);
  }
  assert.throws(() => validateExecutionToolStatus({ ...dto, schemaVersion: 2 }), invalid);
});

test('status identity strings and hashes are bounded and contain no paths or control characters', () => {
  for (const backendId of ['bevy', '../org.viento.bevy', 'org..bevy', 'org.viento.Bevy', 'a'.repeat(129)]) {
    assert.throws(() => createExecutionToolStatus({ ...ready(), backendId }), invalid);
  }
  for (const [key, values] of Object.entries({
    version: ['', ' ', '4.7.2\nprivate', '/home/private/tool', 'C:\\private\\tool', 'v'.repeat(257)],
    sha256: ['sha256:' + 'a'.repeat(64), 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)],
    platform: ['Linux', '../linux', 'x'.repeat(33)], arch: ['x64\0', 'ARM', '/arm64'],
  })) for (const value of values) {
    assert.throws(() => createExecutionToolStatus({ ...ready(), identity: { ...identity(), [key]: value } }), invalid);
  }
  assert.equal(createExecutionToolStatus({ ...ready(), identity: { ...identity(), version: '4.7.2.stable.official' } }).status, 'ready');
});

test('getter, hidden, symbolic and polluted fields are rejected before getters execute', () => {
  let calls = 0;
  const getter = ready(); Object.defineProperty(getter, 'identity', { enumerable: true, get() { calls++; return identity(); } });
  const nested = identity(); Object.defineProperty(nested, 'version', { enumerable: true, get() { calls++; return '4.7.2'; } });
  for (const value of [getter, { ...ready(), identity: nested }, Object.assign(Object.create({ path: '/private' }), ready()),
    { ...ready(), [Symbol('hidden')]: true }, JSON.parse('{"backendId":"org.viento.bevy","status":"unchecked","__proto__":{}}')]) {
    assert.throws(() => createExecutionToolStatus(value), invalid);
  }
  const hidden = ready(); Object.defineProperty(hidden, 'path', { value: '/private' });
  assert.throws(() => createExecutionToolStatus(hidden), invalid);
  assert.equal(calls, 0);
  assert.equal({}.path, undefined);
});

test('cycles, arrays and wide metadata cannot expand the small tool status DTO', () => {
  const cycle = ready(); cycle.identity = cycle;
  for (const value of [null, [], 'ready', cycle, { ...ready(), identity: [] },
    { ...ready(), identity: Object.fromEntries(Array.from({ length: 40 }, (_, index) => ['key' + index, 'value'])) }]) {
    assert.throws(() => createExecutionToolStatus(value), invalid);
  }
  const nullPrototype = Object.assign(Object.create(null), ready());
  assert.equal(createExecutionToolStatus(nullPrototype).status, 'ready');
});

test('portable status validation executes without Node, DOM or host process globals', async () => {
  const source = await fs.readFile(new URL('../../engine/execution-tool-status.mjs', import.meta.url), 'utf8');
  const context = vm.createContext({});
  const result = new vm.Script(source.replaceAll('export ', '') + `
    JSON.stringify(createExecutionToolStatus({backendId:'org.viento.godot4',status:'unchecked'}));`).runInContext(context);
  assert.deepEqual(JSON.parse(result), { format: 'viento-execution-tool-status', schemaVersion: 1,
    backendId: 'org.viento.godot4', status: 'unchecked', reason: null, identity: null });
});

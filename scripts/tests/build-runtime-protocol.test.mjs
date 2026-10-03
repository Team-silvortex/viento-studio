import test from 'node:test';
import assert from 'node:assert/strict';
import { runBuildProcess } from '../lib/build-process.mjs';
import { createRuntimeEventReader, readRuntimeEvents } from '../backends/godot4.mjs';

const plan = {
  scene: { objectId: 'scene', sourcePath: 'documents/scene.json' },
  actors: [{ objectId: 'actor', sourcePath: 'documents/actor.md' }],
  resources: [{ id: 'image' }],
};
const actor = { objectId: 'actor', position: [20, 30], state: 'idle' };
const ready = { protocol: 1, event: 'ready', sceneObjectId: 'scene', actors: [actor] };
const finished = { protocol: 1, event: 'finished', actors: [actor], fixedDelta: 0.25 };
const frame = value => `VIENTO_RUNTIME:${JSON.stringify(value)}\n`;
const invalid = frames => {
  const result = readRuntimeEvents({ stdout: frames.map(frame).join('') }, plan);
  assert.ok(result.diagnostics.some(item => item.code === 'runtime_protocol_invalid'), JSON.stringify(frames));
  return result;
};

test('runtime protocol streams frames across chunks and reports ready before process exit', () => {
  const observed = [];
  const reader = createRuntimeEventReader(plan, { onEvent: event => observed.push(event) });
  const text = frame(ready);
  assert.deepEqual(reader.push(`engine log\n${text.slice(0, 12)}`), []);
  assert.deepEqual(reader.push(text.slice(12)), [ready]);
  assert.deepEqual(observed, [ready]);
  assert.deepEqual(reader.push(frame({ protocol: 1, event: 'state', objectId: 'actor', state: 'moving' })),
    [{ protocol: 1, event: 'state', objectId: 'actor', state: 'moving' }]);
  reader.push(frame(finished).trimEnd());
  const result = reader.finish();
  assert.equal(result.events.length, 3); assert.deepEqual(result.diagnostics, []);
  reader.finish(); assert.equal(observed.length, 3, 'finish is idempotent');
});

test('runtime protocol rejects malformed payloads, unknown identities and lifecycle order', () => {
  for (const frames of [
    [{ protocol: 1, event: 'ready' }, finished],
    [finished, ready], [ready, ready], [ready, finished, finished],
    [ready, finished, { protocol: 1, event: 'state', objectId: 'actor', state: 'idle' }],
    [{ ...ready, sceneObjectId: 'other' }], [{ ...ready, actors: [] }],
    [{ ...ready, actors: [{ ...actor, objectId: 'other' }] }],
    [{ ...ready, actors: [{ ...actor, position: ['20', 30] }] }],
    [{ ...ready, actors: [{ ...actor, state: 'other' }] }],
    [{ ...ready, sourcePath: '../../outside' }],
    [ready, { protocol: 1, event: 'state', objectId: 'other', state: 'moving' }],
    [ready, { protocol: 1, event: 'state', objectId: 'actor', state: 'other' }],
    [ready, { ...finished, fixedDelta: 0 }],
    [{ protocol: 2, event: 'ready' }],
    [{ protocol: 1, event: 'diagnostic', severity: 'error', code: 'oops', message: {}, objectId: 'actor' }],
    [{ protocol: 1, event: 'diagnostic', severity: 'error', code: 'oops', message: 'failure', objectId: 'other' }],
  ]) invalid(frames);
  assert.equal(invalid([{ ...ready, actors: [{ ...actor, position: [Infinity, 0] }] }]).events.length, 0);
  const malformed = readRuntimeEvents({ stdout: 'VIENTO_RUNTIME:{bad}\n' }, plan);
  assert.equal(malformed.diagnostics[0].code, 'runtime_protocol_invalid');
});

test('runtime diagnostics use plan locations and bound unfinished frames and event history', () => {
  const result = readRuntimeEvents({ stdout: frame({ protocol: 1, event: 'diagnostic', severity: 'error',
    code: 'runtime_image_failed', message: '无法读取画像', objectId: 'actor', resourceId: 'image' }) }, plan);
  assert.equal(result.diagnostics[0].sourcePath, 'documents/actor.md');
  assert.equal(result.diagnostics[0].message, '无法读取画像');
  invalid([{ protocol: 1, event: 'diagnostic', severity: 'error', code: 'oops', message: 'failure', objectId: 'actor', sourcePath: '/outside' }]);
  const reader = createRuntimeEventReader(plan);
  reader.push('VIENTO_RUNTIME:' + 'x'.repeat(64 * 1024));
  reader.push('x'.repeat(64 * 1024));
  reader.push('\n' + frame(ready));
  assert.equal(reader.events.length, 1); assert.equal(reader.diagnostics.length, 1);
  for (let i = 0; i < 5000; i++) reader.push(frame({ protocol: 1, event: 'state', objectId: 'actor', state: 'moving' }));
  assert.equal(reader.events.length, 4096); assert.equal(reader.diagnostics.length, 2);
});

test('process observer preserves split UTF-8 on both streams and receives start once', async () => {
  const events = [], starts = [];
  const script = `const a=Buffer.from('角色'),b=Buffer.from('画像');process.stdout.write(a.subarray(0,1));process.stderr.write(b.subarray(0,2));setTimeout(()=>{process.stdout.write(a.subarray(1));process.stderr.write(b.subarray(2));},100);`;
  const result = await runBuildProcess(process.execPath, ['-e', script], { cwd: process.cwd(),
    onStart: event => starts.push(event), onOutput: event => events.push(event) });
  assert.equal(result.status, 'succeeded'); assert.equal(result.stdout, '角色'); assert.equal(result.stderr, '画像');
  assert.equal(events.filter(event => event.stream === 'stdout').map(event => event.text).join(''), '角色');
  assert.equal(events.filter(event => event.stream === 'stderr').map(event => event.text).join(''), '画像');
  assert.equal(starts.length, 1); assert.ok(starts[0].pid > 0);
});

test('process observer failure and cancellation terminate the owned process', async () => {
  let outputCalls = 0;
  const result = await runBuildProcess(process.execPath, ['-e', 'console.log("ready");setInterval(()=>{},1000)'], {
    cwd: process.cwd(), timeoutMs: 3000, onOutput() { outputCalls++; throw new Error('observer failed'); },
  });
  assert.equal(result.status, 'observer-failed'); assert.equal(outputCalls, 1); assert.ok(result.durationMs < 2000);
  const startFailure = await runBuildProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    cwd: process.cwd(), timeoutMs: 3000, onStart() { throw new Error('start observer failed'); },
  });
  assert.equal(startFailure.status, 'observer-failed');
  const controller = new AbortController();
  const cancelled = await runBuildProcess(process.execPath, ['-e', 'console.log("ready");setInterval(()=>{},1000)'], {
    cwd: process.cwd(), signal: controller.signal, onOutput: () => controller.abort(),
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.throws(() => runBuildProcess(process.execPath, [], { maxOutputBytes: Infinity }), /output limit/);
});

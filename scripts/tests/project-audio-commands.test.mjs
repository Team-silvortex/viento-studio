import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectAudioCommands, validateProjectAudioCommandsSnapshot } from '../../engine/project-audio-commands.mjs';
import { audioProject, audioReceipt } from './helpers/project-audio-command-fixture.mjs';
import { runtimeId } from './helpers/project-runtime-fixture.mjs';
const scene = audioProject().scenes[0];
const refuse = (ledger, entry) => { const before = ledger.snapshot(); assert.throws(() => ledger.append(entry), { errorCode: 'runtime_project_invalid' }); assert.deepEqual(ledger.snapshot(), before); };
test('audio receipts preserve each repeated play/stop with independent frozen behavior and track sources', () => {
  const ledger = createProjectAudioCommands(); assert.deepEqual(ledger.snapshot(), { sequence: 0, entries: [] });
  for (const [index, action] of ['play', 'play', 'stop', 'stop'].entries()) ledger.append(audioReceipt(scene, 1, index + 1, action));
  const view = ledger.snapshot(); assert.equal(view.sequence, 4); assert.notEqual(view.entries[0].origin.source.objectId, view.entries[0].track.source.objectId);
  assert.equal(view.entries[0].track.source.sourceRange.exact, true); assert.equal(view.entries[0].origin.source.sourceRange, undefined);
  assert.deepEqual(validateProjectAudioCommandsSnapshot(view), view);
});
test('command sequence, action, timestamp and track identities reject atomically', () => {
  const ledger = createProjectAudioCommands();
  for (const mutate of [v => v.sequence = 0, v => v.sequence = 2, v => v.action = 'pause', v => v.timeSeconds = -1,
    v => v.timeSeconds = Infinity, v => v.timeSeconds = '0', v => v.track.trackId = 'unknown', v => v.track.resourceId = null,
    v => v.track.source.sourcePath = '../outside.json', v => v.sourcePath = 'injected.json', v => v.origin.bindingId = 'bad']) {
    const value = audioReceipt(scene); mutate(value); refuse(ledger, value);
  }
  ledger.append(audioReceipt(scene)); assert.equal(ledger.sequence, 1);
});
test('local clocks never retreat within a visit and reset only when a later visit begins', () => {
  const ledger = createProjectAudioCommands(), second = audioProject().scenes[1];
  ledger.append(audioReceipt(scene, 1, 1, 'play', 2)); refuse(ledger, audioReceipt(scene, 1, 2, 'stop', 1));
  ledger.append(audioReceipt(second, 2, 2, 'play', 0)); refuse(ledger, audioReceipt(scene, 1, 3));
  const sameVisitOtherScene = audioReceipt(scene, 2, 3); refuse(ledger, sameVisitOtherScene);
  ledger.append(audioReceipt(scene, 3, 3, 'stop', 0)); assert.deepEqual(validateProjectAudioCommandsSnapshot(ledger.snapshot()), ledger.snapshot());
});
test('the same scene and track retain resource and source ownership across visits', () => {
  const ledger = createProjectAudioCommands(); ledger.append(audioReceipt(scene));
  for (const mutate of [v => v.track.resourceId = runtimeId(99), v => v.track.source.propertyPath = '/tracks/1', v => v.track.source.sourceRevision = 'sha256:' + 'b'.repeat(64)]) {
    const entry = audioReceipt(scene, 3, 2); mutate(entry); refuse(ledger, entry);
  }
  ledger.append(audioReceipt(scene, 3, 2));
});
test('the complete 256-command history is bounded and detached', () => {
  const ledger = createProjectAudioCommands(); for (let index = 1; index <= 256; index++) ledger.append(audioReceipt(scene, 1, index));
  refuse(ledger, audioReceipt(scene, 1, 257)); const view = ledger.snapshot(); assert.equal(view.sequence, 256);
  view.entries[0].track.source.sourcePath = 'changed.json'; assert.notEqual(ledger.snapshot().entries[0].track.source.sourcePath, 'changed.json');
});
test('malformed snapshots and accessors cannot forge receipts or execute code', () => {
  const ledger = createProjectAudioCommands(); ledger.append(audioReceipt(scene));
  for (const mutate of [v => v.sequence = 2, v => v.entries[0].sequence = 2, v => v.entries.push(v.entries[0]), v => v.entries[0].track.extra = true]) {
    const view = ledger.snapshot(); mutate(view); assert.throws(() => validateProjectAudioCommandsSnapshot(view), { errorCode: 'runtime_project_invalid' });
  }
  let calls = 0; const input = audioReceipt(scene, 1, 2); Object.defineProperty(input.track, 'source', { enumerable: true, get() { calls++; return {}; } }); refuse(ledger, input);
  const view = ledger.snapshot(); Object.defineProperty(view.entries[0], 'origin', { enumerable: true, get() { calls++; return {}; } });
  assert.throws(() => validateProjectAudioCommandsSnapshot(view)); assert.equal(calls, 0);
});
test('all legal long source fields fit a complete audio history without increasing the old eight-MiB copy limit', () => {
  const ledger = createProjectAudioCommands(), input = audioReceipt(scene);
  for (const source of [input.origin.source, input.track.source]) {
    source.sourcePath = 'd/' + 'x'.repeat(4094); source.propertyPath = '/' + 'p'.repeat(4095);
    source.sourceRange = { start: 0, end: 1, encoding: 'utf-16', propertyPath: '/' + 'r'.repeat(4095), exact: true };
  }
  for (let sequence = 1; sequence <= 256; sequence++) ledger.append({ ...input, sequence });
  assert.deepEqual(validateProjectAudioCommandsSnapshot(ledger.snapshot()), ledger.snapshot());
});

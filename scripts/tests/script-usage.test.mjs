import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sourceLocationSelection } from '../../web/modules/app-source-location.js';
import { SCRIPT_USAGE_API_PATH, SCRIPT_USAGE_LIMITS, captureScriptUsageDirectory, captureScriptUsage, isScriptUsage, scriptUsageMatchSource,
  scriptUsageSource, isScriptUsageSource, createScriptUsageOpenSourceRequest, isScriptUsageOpenSourceRequest, scriptUsageOpenSourceMatchSource } from '../../engine/script-usage.mjs';
const id = value => `aaaaaaaa-0000-4000-8000-${String(value).padStart(12, '0')}`;
const revision = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const scriptPath = 'documents/scripts/state.txt';
const binding = (n = 1, script = id(9)) => ({ bindingId: id(100 + n), instanceId: id(200 + n), implementation: { backendId: 'org.example.custom', language: 'native.experimental', sourceObjectId: script },
  parameters: { clip: id(8), enabled: false, amount: 0, empty: '' }, events: [] });
const behavior = (bindings = [binding()]) => ({ format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(1), bindings });
const reference = (n, content, sourcePath = `documents/behaviors/${n}.json`) => ({ objectId: id(n), sourcePath, sourceRevision: content === null ? null : revision(content), relationKinds: ['reference'], content });
function raw(references = [reference(3, JSON.stringify(behavior()))]) {
  return { format: 'viento-script-usage', schemaVersion: 1, worldId: 'world:' + 'f'.repeat(64), revision: revision('world'),
    script: { objectId: id(9), sourcePath: scriptPath, sourceRevision: revision('script') }, references };
}
const source = (input = raw()) => ({ sourcePath: input.script.sourcePath, token: 'source:1', baseSourceRevision: input.script.sourceRevision, sourceRevision: input.script.sourceRevision, content: 'script' });
const invalid = { errorCode: 'script_usage_invalid' }, limit = { errorCode: 'script_usage_limit' };

test('script usage captures detached exact directory data without interpreting script bytes', () => {
  assert.equal(SCRIPT_USAGE_API_PATH, '/api/script-usage'); const input = raw(), output = captureScriptUsageDirectory(input, scriptPath);
  assert.deepEqual(output, input); input.references[0].content = 'changed'; assert.notEqual(output.references[0].content, 'changed');
  assert.ok(Object.isFrozen(output.references[0]) && Object.isFrozen(output.references[0].relationKinds));
  const catalog = captureScriptUsage(source(output), output);
  assert.ok(isScriptUsage(catalog)); assert.equal(catalog.scope, 'saved-registered-references'); assert.equal(catalog.references[0].status, 'bound');
  assert.equal(catalog.matches[0], catalog.references[0].bindings[0]); assert.deepEqual(catalog.matches[0].parameters, binding().parameters);
  assert.ok(Object.isFrozen(catalog.matches[0].parameters)); assert.equal(catalog.matches[0].backendId, 'org.example.custom');
  assert.equal(Object.hasOwn(catalog.references[0], 'content'), false);
});
test('every reference outcome is explicit and a missing binding never hides a registered reference', () => {
  const input = raw([reference(3, JSON.stringify(behavior([binding(1), binding(2)]))), reference(4, JSON.stringify(behavior([binding(3, id(50))]))),
    reference(5, '# notes contain a script name', 'documents/notes/readme.md'), reference(6, '{"format":"viento-scene-behaviors","schemaVersion":99}'),
    reference(7, '{broken json'), reference(8, null)]);
  const catalog = captureScriptUsage(source(input), input);
  assert.deepEqual(catalog.references.map(row => row.status), ['bound', 'unbound', 'non-behavior', 'invalid-behavior', 'invalid-json', 'unavailable']);
  assert.deepEqual(catalog.matches.map(row => [row.bindingId, row.propertyPath]), [[id(101), '/bindings/0'], [id(102), '/bindings/1']]);
  for (const row of catalog.references.slice(1)) assert.deepEqual(row.bindings, []);
  assert.equal(captureScriptUsage(source(raw([])), raw([])).references.length, 0);
});
test('dirty source is pinned to its saved script baseline and all five source fields retain ownership', () => {
  const input = raw(), original = source(input), draft = { ...original, content: 'unsaved script\n', sourceRevision: revision('unsaved script\n') }, catalog = captureScriptUsage(draft, input);
  assert.ok(scriptUsageMatchSource(catalog, { ...draft })); assert.equal(scriptUsageMatchSource(catalog, original), false);
  for (const key of ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision', 'content']) assert.equal(scriptUsageMatchSource(catalog, { ...draft, [key]: draft[key] + 'x' }), false);
  assert.throws(() => captureScriptUsage({ ...draft, baseSourceRevision: revision('different saved source') }, input), invalid);
  draft.token = 'mutated'; assert.equal(scriptUsageMatchSource(catalog, draft), false);
  const empty = { ...original, content: '', sourceRevision: revision('') }; assert.ok(scriptUsageMatchSource(captureScriptUsage(empty, input), empty));
});
test('saved binding snapshots retain BOM CRLF Unicode typed parameters and exact original indexes', () => {
  const model = behavior([binding(1, id(50)), binding(2)]); model.bindings[1].parameters.title = '場面 🎬';
  const content = '\ufeff' + JSON.stringify(model, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
  const input = raw([reference(3, content)]), catalog = captureScriptUsage(source(input), input), row = catalog.references[0], match = catalog.matches[0];
  const snapshot = scriptUsageSource(catalog, row, match); assert.ok(isScriptUsageSource(snapshot)); assert.equal(snapshot.content, content); assert.equal(snapshot.propertyPath, '/bindings/1');
  assert.deepEqual(JSON.parse(content.slice(snapshot.sourceRange.start, snapshot.sourceRange.end)), model.bindings[1]);
  const selection = sourceLocationSelection(content, snapshot, snapshot.sourceRevision); assert.equal(selection.status, 'exact');
  assert.deepEqual(JSON.parse(content.replaceAll('\r\n', '\n').slice(selection.start, selection.end)), model.bindings[1]);
  const whole = scriptUsageSource(catalog, row); assert.equal(whole.sourceRange.start, 0); assert.equal(whole.sourceRange.end, content.length); assert.equal(whole.propertyPath, '');
});
test('ordinary and broken documents expose only their own complete snapshot while unavailable references refuse', () => {
  const input = raw([reference(3, '# note\n', 'documents/note.md'), reference(4, '{broken'), reference(5, null)]), catalog = captureScriptUsage(source(input), input);
  for (const row of catalog.references.slice(0, 2)) { const snapshot = scriptUsageSource(catalog, row); assert.equal(snapshot.propertyPath, ''); assert.equal(snapshot.sourceRange.end, snapshot.content.length); }
  assert.throws(() => scriptUsageSource(catalog, catalog.references[2]), invalid);
});
test('private catalogs snapshots and intents reject cloned forged cross-catalog rows and source owners', () => {
  const input = raw(), owner = source(input), catalog = captureScriptUsage(owner, input), other = captureScriptUsage(owner, input), row = catalog.references[0], match = row.bindings[0];
  assert.equal(isScriptUsage({ ...catalog }), false); assert.equal(scriptUsageMatchSource({ ...catalog }, owner), false);
  for (const [c, r, m] of [[{ ...catalog }, row, match], [catalog, { ...row }, match], [catalog, row, { ...match }], [other, row, match]]) assert.throws(() => scriptUsageSource(c, r, m), invalid);
  const snapshot = scriptUsageSource(catalog, row, match), request = createScriptUsageOpenSourceRequest(catalog, snapshot);
  assert.ok(isScriptUsageOpenSourceRequest(request)); assert.ok(scriptUsageOpenSourceMatchSource(request, owner)); assert.equal(request.catalog, catalog); assert.equal(request.source, snapshot);
  assert.equal(isScriptUsageSource({ ...snapshot }), false); assert.equal(isScriptUsageOpenSourceRequest({ ...request }), false);
  assert.equal(scriptUsageOpenSourceMatchSource({ ...request }, owner), false); assert.equal(scriptUsageOpenSourceMatchSource(request, { ...owner, token: 'later' }), false);
  assert.throws(() => createScriptUsageOpenSourceRequest(other, snapshot), invalid); assert.throws(() => createScriptUsageOpenSourceRequest(catalog, { ...snapshot }), invalid);
});
test('strict DTOs reject getters sparse arrays aliases duplicates trailing hashes ownership links and mismatched missing content', () => {
  let calls = 0; const getter = raw(); Object.defineProperty(getter.references[0], 'content', { enumerable: true, get() { calls++; return ''; } });
  const cases = [getter, { ...raw(), unknown: true }, { ...raw(), references: [, reference(3, '')] }, { ...raw(), references: [reference(3, ''), reference(3, '')] }];
  for (const mutate of [v => v.script.sourcePath = '../escape.txt', v => v.script.sourcePath += '\n', v => v.script.objectId += '\n', v => v.worldId += '\n', v => v.revision += '\n',
    v => v.references[0].sourceRevision += '\n', v => v.references[0].relationKinds = ['part-of'], v => v.references[0].relationKinds = ['z','a'],
    v => v.references[0].relationKinds = ['a','a'], v => v.references[0].sourceRevision = null, v => v.references[0].content = null,
    v => v.references[0].content = '\ud800', v => v.references[0].sourcePath = 'C:evil.json']) { const value = raw(); mutate(value); cases.push(value); }
  for (const value of cases) assert.throws(() => captureScriptUsageDirectory(value, scriptPath), invalid);
  const ownGetter = source(); Object.defineProperty(ownGetter, 'token', { enumerable: true, get() { calls++; return 'source'; } });
  assert.throws(() => captureScriptUsage(ownGetter, raw()), invalid); assert.equal(calls, 0);
});
test('complete collection per-file UTF8 and encoded response budgets refuse rather than truncate', () => {
  assert.throws(() => captureScriptUsageDirectory(raw(Array.from({ length: 129 }, (_, n) => reference(1000 + n, ''))), scriptPath), limit);
  assert.throws(() => captureScriptUsageDirectory(raw([reference(3, 'x'.repeat(SCRIPT_USAGE_LIMITS.documentBytes + 1))]), scriptPath), limit);
  assert.throws(() => captureScriptUsageDirectory(raw([reference(3, '中'.repeat(50000))]), scriptPath), limit);
  const kinds = raw(); kinds.references[0].relationKinds = Array.from({ length: 33 }, (_, n) => String(n).padStart(2, '0')); assert.throws(() => captureScriptUsageDirectory(kinds, scriptPath), limit);
  assert.throws(() => captureScriptUsageDirectory(raw(Array.from({ length: 17 }, (_, n) => reference(1000 + n, 'x'.repeat(131072)))), scriptPath), limit);
  assert.throws(() => captureScriptUsageDirectory(raw(Array.from({ length: 16 }, (_, n) => reference(1000 + n, '\n'.repeat(70000)))), scriptPath), limit);
  assert.throws(() => captureScriptUsage({ ...source(), content: '中'.repeat(50000) }, raw()), limit);
});
test('self references retain their registered identity and malformed declarations cannot produce guessed matches', () => {
  const input = raw([reference(9, 'script', scriptPath)]), catalog = captureScriptUsage(source(input), input); assert.equal(catalog.references[0].status, 'non-behavior');
  const bad = raw([reference(9, 'different', scriptPath)]); assert.throws(() => captureScriptUsageDirectory(bad, scriptPath), invalid);
  const duplicate = JSON.stringify(behavior()).replace('"bindings":', '"bindings":[],"bindings":');
  const ambiguous = raw([reference(3, duplicate)]), checked = captureScriptUsage(source(ambiguous), ambiguous);
  assert.equal(checked.references[0].status, 'invalid-behavior'); assert.deepEqual(checked.matches, []);
});

test('behavior identifiers with final line breaks never become trusted match identities', () => {
  for (const update of [v => v.sceneObjectId += '\n', v => v.bindings[0].bindingId += '\n', v => v.bindings[0].instanceId += '\n',
    v => v.bindings[0].implementation.sourceObjectId += '\n', v => v.bindings[0].implementation.backendId += '\n',
    v => v.bindings[0].implementation.language += '\n', v => { v.bindings[0].parameters = { ['clip\n']: 'value' }; },
    v => { v.bindings[0].events = [{ signal: 'finished\n', event: 'go' }]; }]) {
    const model = behavior(); update(model); const input = raw([reference(3, JSON.stringify(model))]), catalog = captureScriptUsage(source(input), input);
    assert.equal(catalog.references[0].status, 'invalid-behavior'); assert.deepEqual(catalog.matches, []);
  }
});

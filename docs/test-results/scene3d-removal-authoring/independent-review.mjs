// Independent review of the isolated stage. No build, HTTP, Save or product writes.
// Source cuts are predicted from explicitly constructed raw spans, independently
// of native CST outputs; those outputs are an additional survivor witness only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as core from '../../../engine/studio-core.mjs';
import * as removal from '../../../engine/scene3d-removal.mjs';
import * as transform from '../../../engine/scene3d-transform.mjs';
import * as objects from '../../../engine/scene3d-objects.mjs';
import * as environment from '../../../engine/scene3d-environment.mjs';
import * as properties from '../../../engine/scene3d-properties.mjs';
import * as translation from '../../../engine/scene3d-translation.mjs';
import * as alignment from '../../../engine/scene3d-alignment.mjs';
import * as distribution from '../../../engine/scene3d-distribution.mjs';
import * as copy from '../../../engine/scene3d-copy.mjs';
import { parseScene3DSource } from '../../../engine/scene3d.mjs';

const root = new URL('../../../', import.meta.url), out = new URL('./', import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const paths = ['crates/viento-studio-core/src/scene3d_removal_patch.rs', 'engine/studio-core.mjs',
  'engine/scene3d-removal.mjs', 'web/modules/app-scene3d-removal.js', 'web/modules/app-runtime.js',
  'web/modules/app-studio-system.js', 'engine/studio-modules.mjs'];
const hashes = async () => Object.fromEntries(await Promise.all(paths.map(async path => [path, sha(await fs.readFile(new URL(path, root)))])));
const beforeSources = await hashes(), wasmBytes = await fs.readFile(new URL('engine/studio-core.wasm', root));
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN;
assert.ok(nativePath, 'The root supplies a frozen native CLI; this reviewer never builds.');
const nativeBeforeSha256 = sha(await fs.readFile(nativePath));
await core.initializeStudioCore(() => wasmBytes);
const { instance } = await WebAssembly.instantiate(wasmBytes, {}), raw = instance.exports;
const cases = [], parityInputs = [];
const counts = { validCutCases: 0, nativeParityRequests: 0, forgedReceipts: 0,
  priorAuthorOperations: 0, crossBrandDirections: 0, controllerCases: 0 };
async function run(name, fn, scope = 'native-and-pure') {
  try { await fn(); cases.push({ name, ok: true, scope }); }
  catch (error) { cases.push({ name, ok: false, scope, error: error.stack || String(error) }); }
}
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const parsed = text => JSON.parse(text.replace(/^\uFEFF/, ''));
const sourceSnapshot = content => ({ sourcePath: 'documents/scene.json', token: 'independent-removal:1', content,
  baseSourceRevision: `sha256:${sha(content)}`, sourceRevision: `sha256:${sha(content)}` });
const request = (fixture, selected) => ({ protocolVersion: 1, operation: 'scene3d.removeObjects',
  content: typeof fixture === 'string' ? fixture : fixture.content, instanceIds: selected.map(value => typeof value === 'number' ? id(value + 1) : value) });
const patch = input => core.dispatchStudioCoreScene3DRemovalPatch(input);
function fixture(count = 6, style = 0) {
  const layouts = [['[', ',', ']'], ['[\r\n\t', ' \r\n,\t\r\n ', '\r\n ]'], ['[  ', '\t, \n', '\t ]']];
  const [opening, gap, closing] = layouts[style], spans = [], raws = [];
  let content = '\uFEFF{"format":"viento-scene3d","schemaVersion":1,"name":"保留🦊",' +
    '"viewport":[800,600],"background":"#142538","camera":{"position":[8,6,8],"target":[0,0,0],"fovDegrees":60,"near":0.05,"far":1.000e3},' +
    '"light":{"direction":[-1,-2,-1],"color":"#FFFFFF","energy":1},"objec\\u0074s":' + opening;
  for (let index = 0; index < count; index++) {
    const name = index === 0 ? id(1) : `Box \\u0031 箱🦊 ${index}`;
    const rawObject = index % 2 === 0
      ? `{"instance\\u0049d":"${id(index + 1)}","name":"${name}","primitive":"box","posi\\u0074ion":[${index},-0e0,1.000e1],"rotationDegrees":[1,2,3],"size":[1.500,2,3],"color":"#aB89CD"}`
      : `{"size":[1.500,2,3],"name":"${name}","position":[${index},-0e0,1.000e1],"color":"#aB89CD","primitive":"box","rotationDegrees":[1,2,3],"instanceId":"${id(index + 1)}"}`;
    if (index) content += gap;
    const start = content.length; content += rawObject;
    spans.push({ start, end: content.length }); raws.push(rawObject);
  }
  content += closing + '}\r\n \t';
  return { content, spans, raws, model: parsed(content) };
}
function expected(f, selected) {
  const mask = new Set(selected), cuts = []; let cursor = 0;
  while (cursor < f.spans.length) {
    if (!mask.has(cursor)) { cursor++; continue; }
    const first = cursor; while (cursor < f.spans.length && mask.has(cursor)) cursor++;
    cuts.push({ start: cursor < f.spans.length ? f.spans[first].start : f.spans[first - 1].end,
      end: cursor < f.spans.length ? f.spans[cursor].start : f.spans[cursor - 1].end });
  }
  let afterContent = '', start = 0;
  for (const cut of cuts) { assert.ok(cut.start >= start); afterContent += f.content.slice(start, cut.start); start = cut.end; }
  afterContent += f.content.slice(start);
  const canonical = [...mask].sort((a, b) => a - b);
  return { instanceIds: canonical.map(index => id(index + 1)), beforeContent: f.content, afterContent,
    changedPaths: canonical.map(index => `/objects/${index}`) };
}
function wasm(input) {
  const encoded = new TextEncoder().encode(typeof input === 'string' ? input : JSON.stringify(input));
  const pointer = raw.viento_core_input(encoded.length) >>> 0; new Uint8Array(raw.memory.buffer, pointer, encoded.length).set(encoded);
  const output = raw.viento_core_run() >>> 0, length = raw.viento_core_output_len();
  return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(new Uint8Array(raw.memory.buffer, output, length)));
}
await run('native candidates equal independently predicted cuts for contiguous, disjoint and single-survivor selections in three raw layouts', () => {
  const selections = [[0, 1], [2, 3], [4, 5], [0, 2, 5], [0, 1, 3, 4, 5], [1, 2, 4, 5], [1], [0, 5]];
  for (let style = 0; style < 3; style++) {
    const f = fixture(6, style);
    for (const selected of selections) {
      const input = request(f, [...selected].reverse()), result = patch(input), want = expected(f, selected);
      assert.deepEqual(result, want); assert.deepEqual(patch(request(f, selected)), result);
      const after = core.dispatchStudioCoreScene3D({ protocolVersion: 1, operation: 'scene3d.parse', content: result.afterContent });
      const survivors = f.model.objects.filter((_, index) => !selected.includes(index));
      assert.deepEqual(after.model, { ...f.model, format: 'viento-scene3d-model', objects: survivors });
      const survivorRaws = f.raws.filter((_, index) => !selected.includes(index));
      after.sourceLocations.objects.forEach((object, index) => {
        assert.equal(result.afterContent.slice(object.sourceRange.start, object.sourceRange.end), survivorRaws[index]);
        assert.equal(object.instanceId, survivors[index].instanceId);
      });
      parityInputs.push(input); counts.validCutCases++;
    }
  }
});
await run('128 selection admission rejects all removal atomically while 127 targets can leave exactly one original declaration', () => {
  const f = fixture(128, 1), selected = Array.from({ length: 128 }, (_, i) => i), valid = request(f, selected.filter(i => i !== 64).reverse());
  assert.deepEqual(patch(valid), expected(f, selected.filter(i => i !== 64)));
  assert.equal(parsed(patch(valid).afterContent).objects[0].instanceId, id(65));
  for (const input of [request(f, selected), request(fixture(1), [0]), request(f, [...selected, id(999)])]) {
    assert.throws(() => patch(input), { errorCode: 'scene3d_removal_invalid' });
    const receipt = wasm(input); assert.equal(receipt.ok, false); assert.equal(Object.hasOwn(receipt, 'scene3dRemovalPatch'), false);
    parityInputs.push(input);
  }
  parityInputs.push(valid);
});
await run('original full validation and UTF8 budget cannot be bypassed by deleting the invalid or oversized declaration', () => {
  const f = fixture(), malformed = f.content.replace('"size":[1.500,2,3]', '"size":[0,2,3]');
  const padded = f.content + ' '.repeat(131072 - Buffer.byteLength(f.content));
  assert.equal(Buffer.byteLength(padded), 131072);
  assert.equal(parsed(patch(request(padded, [0])).afterContent).objects.length, 5);
  assert.throws(() => patch(request(malformed, [0])), { errorCode: 'scene3d_invalid' });
  assert.throws(() => patch(request(padded + ' ', [0])), { errorCode: 'scene3d_limit' });
  parityInputs.push(request(padded, [0]), request(padded + ' ', [0]), request(malformed, [0]));
});
await run('strict wire duplicates decoded keys and dense ordinary host request admission never authorize partial removal', () => {
  const f = fixture(), input = request(f, [0, 5]);
  const invalid = [request(f, []), request(f, [0, 0]), request(f, [0, id(999)]),
    { ...input, operation: 'scene3d.patchObjects' }, { ...input, extra: true }, { ...input, instanceIds: null },
    request(fixture(16), [id(10).toUpperCase()])];
  for (const bad of invalid) { assert.throws(() => patch(bad)); assert.equal(wasm(bad).ok, false); parityInputs.push(bad); }
  const serialized = JSON.stringify(input), wires = [serialized.replace('"protocolVersion":1', '"protocolVersion":1,"protocolVersion":1'),
    serialized.replace('"instanceIds":', '"instanceIds":[],"instance\\u0049ds":'),
    serialized.replace('"content":', '"content":"bad","content":')];
  for (const wire of wires) { assert.equal(wasm(wire).ok, false); parityInputs.push(wire); }
  let reads = 0;
  const accessor = request(f, [0]); Object.defineProperty(accessor.instanceIds, 0, { enumerable: true, get() { reads++; throw Error('getter'); } });
  const serializer = request(f, [0]); serializer.instanceIds.toJSON = () => { reads++; return []; };
  const sparse = request(f, [0]); delete sparse.instanceIds[0];
  const hidden = request(f, [0]); Object.defineProperty(hidden.instanceIds, 'hidden', { value: true });
  for (const bad of [accessor, serializer, sparse, hidden]) assert.throws(() => patch(bad), { errorCode: 'studio_core_request_invalid' });
  assert.equal(reads, 0); assert.equal(core.getStudioCoreMetadata().ready, true);
});
let bridgeId = 0;
async function responseBridge(response, version = 1, onRun) {
  const module = await import(new URL(`../../../engine/studio-core.mjs?independent-removal-response=${++bridgeId}`, import.meta.url));
  const memory = new WebAssembly.Memory({ initial: 40 }), instantiate = WebAssembly.instantiate; let inputLength = 0, outputLength = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      viento_core_scene3d_version: () => 1, ...(version === null ? {} : { viento_core_scene3d_removal_version: () => version }),
      viento_core_input: length => { inputLength = length; return 16; }, viento_core_run: () => {
        const input = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, 16, inputLength)));
        const value = input.operation === 'scene3d.removeObjects' ? structuredClone(response) : wasm(input);
        if (input.operation === 'scene3d.removeObjects') onRun?.(input);
        const bytes = new TextEncoder().encode(JSON.stringify(value)); outputLength = bytes.length;
        new Uint8Array(memory.buffer, 1048576, bytes.length).set(bytes); return 1048576;
      }, viento_core_output_len: () => outputLength,
    } } });
    await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = instantiate; }
  return module;
}
await run('complete forged receipts cannot change survivor bytes ordering identity counts source cuts or canonical diagnostics', async () => {
  const f = fixture(), input = request(f, [4, 1]), response = wasm(input); assert.equal(response.ok, true);
  const base = response.scene3dRemovalPatch, mutateAfter = fn => result => { result.scene3dRemovalPatch.afterContent = fn(base.afterContent); };
  const normalizeRaw = (content, old, replacement) => { assert.ok(content.includes(old)); return content.replace(old, replacement); };
  const mutations = [result => result.instanceIds = [], result => result.extra = true, result => result.protocolVersion = 2,
    result => result.scene3dRemovalPatch.extra = true, result => result.scene3dRemovalPatch.instanceIds.reverse(),
    result => result.scene3dRemovalPatch.instanceIds.pop(), result => result.scene3dRemovalPatch.instanceIds[0] = id(1),
    result => result.scene3dRemovalPatch.changedPaths.reverse(), result => result.scene3dRemovalPatch.changedPaths[0] = '/objects/0',
    result => result.scene3dRemovalPatch.beforeContent += ' ', mutateAfter(content => content + ' '),
    mutateAfter(content => normalizeRaw(content, '1.000e3', '1000')),
    mutateAfter(content => normalizeRaw(content, '1.500', '1.5')),
    mutateAfter(content => normalizeRaw(content, '-0e0', '0')),
    mutateAfter(content => normalizeRaw(content, '"posi\\u0074ion"', '"position"')),
    mutateAfter(content => normalizeRaw(content, '"name":"', '"name" : "')),
    mutateAfter(() => expected(f, [1, 4, 5]).afterContent),
    mutateAfter(() => expected(f, [0, 4]).afterContent),
    mutateAfter(content => content.replace(f.raws[0], 'TEMP_RAW_OBJECT').replace(f.raws[2], f.raws[0]).replace('TEMP_RAW_OBJECT', f.raws[2])),
    mutateAfter(content => normalizeRaw(content, f.raws[0], f.raws[0].replace(id(1), id(999))))];
  for (const mutate of mutations) {
    const bad = structuredClone(response); mutate(bad); assert.notDeepEqual(bad, response);
    const bridge = await responseBridge(bad);
    assert.throws(() => bridge.dispatchStudioCoreScene3DRemovalPatch(input), { errorCode: 'studio_core_unavailable' });
    assert.equal(bridge.getStudioCoreMetadata().ready, false); counts.forgedReceipts++;
  }
  assert.equal(core.getStudioCoreMetadata().ready, true);
});
await run('optional removal is separate from old objects ABI and caller selection is captured before native invocation', async () => {
  const f = fixture(), input = request(f, [5, 0]), original = structuredClone(input), response = wasm(input);
  for (const version of [null, 0, 2]) {
    const bridge = await responseBridge(response, version); assert.equal(bridge.supportsStudioCoreScene3DRemovalPatch(), false);
    assert.throws(() => bridge.dispatchStudioCoreScene3DRemovalPatch(input), { errorCode: 'studio_core_unavailable' });
    assert.equal(bridge.dispatchStudioCoreScene3D({ protocolVersion: 1, operation: 'scene3d.parse', content: f.content }).model.objects.length, 6);
  }
  const bridge = await responseBridge(response, 1, nativeInput => { assert.deepEqual(nativeInput, original); input.instanceIds.reverse(); input.instanceIds[0] = id(999); input.content = 'late mutation'; });
  assert.equal(bridge.supportsStudioCoreScene3DObjectsPatch(), false); assert.equal(bridge.supportsStudioCoreScene3DRemovalPatch(), true);
  assert.deepEqual(bridge.dispatchStudioCoreScene3DRemovalPatch(input), response.scene3dRemovalPatch); assert.notDeepEqual(input, original);
});
await run('the actual predecessor WASM grants eight previous author operations and no independent removal approval', async () => {
  const old = await import(new URL('../../../engine/studio-core.mjs?independent-removal-predecessor=1', import.meta.url));
  await old.initializeStudioCore(() => fs.readFile(new URL('previous-studio-core.wasm', out)));
  const content = fixture().content;
  assert.equal(old.supportsStudioCoreScene3D(), true); assert.equal(old.supportsStudioCoreScene3DRemovalPatch(), false);
  assert.throws(() => old.dispatchStudioCoreScene3DRemovalPatch(request(content, [0])), { errorCode: 'studio_core_unavailable' });
  const prior = [
    ['dispatchStudioCoreScene3DPatch', { instanceId: id(1), values: { position: [1, 2, 3] } }, 'scene3d.patchObjectTransform'],
    ['dispatchStudioCoreScene3DObjectsPatch', { action: 'remove', instanceId: id(1) }, 'scene3d.patchObjects'],
    ['dispatchStudioCoreScene3DEnvironmentPatch', { values: { background: '#123456' } }, 'scene3d.patchEnvironment'],
    ['dispatchStudioCoreScene3DPropertiesPatch', { instanceId: id(1), values: { name: 'Old author' } }, 'scene3d.patchProperties'],
    ['dispatchStudioCoreScene3DTranslationPatch', { instanceIds: [id(1)], offset: [1, 0, 0] }, 'scene3d.translateObjects'],
    ['dispatchStudioCoreScene3DAlignmentPatch', { instanceIds: [id(1), id(2)], anchorInstanceId: id(2), axis: 'x' }, 'scene3d.alignObjects'],
    ['dispatchStudioCoreScene3DDistributionPatch', { instanceIds: [id(1), id(2), id(4)], axis: 'x' }, 'scene3d.distributeObjects'],
    ['dispatchStudioCoreScene3DCopyPatch', { copies: [{ sourceInstanceId: id(1), newInstanceId: id(999) }], offset: [0, 0, 0] }, 'scene3d.copyObjects'],
  ];
  for (const [name, fields, operation] of prior) { assert.notEqual(old[name]({ protocolVersion: 1, operation, content, ...fields }).afterContent, content); counts.priorAuthorOperations++; }
});
await run('removed and remaining diagnostics are canonical deeply frozen and the ninth private brand rejects all eight siblings in both directions', async () => {
  const f = fixture(), source = sourceSnapshot(f.content), proposal = removal.createScene3DRemovalProposal(source, { instanceIds: [id(6), id(1)] });
  assert.equal(proposal.kind, 'scene3d-removal'); assert.deepEqual(proposal.removedObjects, [f.model.objects[0], f.model.objects[5]]);
  assert.deepEqual(proposal.remainingObjects, f.model.objects.slice(1, 5));
  for (const value of [proposal, proposal.instanceIds, proposal.changedPaths, proposal.removedObjects, proposal.remainingObjects,
    proposal.removedObjects[0], proposal.remainingObjects[0], proposal.remainingObjects[0].position]) assert.ok(Object.isFrozen(value));
  const ready = await removal.prepareScene3DRemovalApply(source, proposal, { digest: sha }); assert.equal(ready.afterContent, expected(f, [0, 5]).afterContent);
  assert.equal(removal.isScene3DRemovalProposal(structuredClone(proposal)), false);
  await assert.rejects(removal.prepareScene3DRemovalApply(source, structuredClone(proposal), { digest: sha }));
  const siblings = [
    [transform, 'Transform', { instanceId: id(1), values: { position: [1, 2, 3] } }],
    [objects, 'Objects', { action: 'remove', instanceId: id(2) }],
    [environment, 'Environment', { values: { background: '#123456' } }],
    [properties, 'Properties', { instanceId: id(1), values: { name: 'Independent old' } }],
    [translation, 'Translation', { instanceIds: [id(1)], offset: [1, 0, 0] }],
    [alignment, 'Alignment', { instanceIds: [id(1), id(2)], anchorInstanceId: id(2), axis: 'x' }],
    [distribution, 'Distribution', { instanceIds: [id(1), id(2), id(4)], axis: 'x' }],
    [copy, 'Copy', { copies: [{ sourceInstanceId: id(1), newInstanceId: id(999) }], offset: [0, 0, 0] }],
  ];
  for (const [module, name, edit] of siblings) {
    const sibling = module[`createScene3D${name}Proposal`](source, edit);
    assert.equal(module[`isScene3D${name}Proposal`](proposal), false); assert.equal(removal.isScene3DRemovalProposal(sibling), false);
    await assert.rejects(module[`prepareScene3D${name}Apply`](source, proposal, { digest: sha }));
    await assert.rejects(removal.prepareScene3DRemovalApply(source, sibling, { digest: sha })); counts.crossBrandDirections += 2;
  }
});
async function nativeSequence(inputs) {
  return new Promise((resolve, reject) => {
    const child = spawn(nativePath, [], { stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = '', stderr = '', failure;
    const timer = setTimeout(() => { failure = Error('Native parity timeout'); child.kill('SIGKILL'); }, 30000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => { stdout += data; if (Buffer.byteLength(stdout) > 32 * 1024 * 1024) { failure = Error('Native output budget'); child.kill('SIGKILL'); } });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-4096); }); child.stdin.on('error', error => { failure ||= error; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timer); if (failure) return reject(failure);
      try { assert.equal(code, 0, stderr); assert.equal(signal, null); resolve(stdout.trim().split('\n').map(JSON.parse)); } catch (error) { reject(error); } });
    child.stdin.end(inputs.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n') + '\n');
  });
}
await run('fresh native CLI and WASM agree on every complete success and rejection wire response', async () => {
  const receipts = await nativeSequence(parityInputs); assert.equal(receipts.length, parityInputs.length);
  for (let index = 0; index < receipts.length; index++) assert.deepEqual(receipts[index], wasm(parityInputs[index]));
  counts.nativeParityRequests = parityInputs.length;
});

// The actual controller consumes genuine native-backed proposals in an event
// fixture. It grants no writer and deliberately exercises rejected Apply only.
const { dialogHarness, flushDialogs } = await import('../../../scripts/tests/dialog-harness.mjs');
let prohibitedApplyRequests = 0;
async function controllerFixture(sourceProvider, f = fixture(6, 1)) {
  const context = { editable: true, creating: false, busy: false, sourceJSON: true,
    sourcePath: 'documents/scene.json', sourceToken: 'independent-removal-ui:1' };
  let languageChanged;
  const h = await dialogHarness('app-scene3d-removal', { queueMicrotask, parseScene3DSource,
    createScene3DRemovalProposal: removal.createScene3DRemovalProposal,
    isScene3DRemovalProposal: removal.isScene3DRemovalProposal,
    supportsStudioCoreScene3DRemovalPatch: core.supportsStudioCoreScene3DRemovalPatch,
    t: value => value, translatePage() {}, onLanguageChange(listener) { languageChanged = listener; return () => {}; } });
  h.runtime.window.confirm = () => true;
  for (const sibling of ['Transforms', 'Objects', 'Environment', 'Properties', 'Translation', 'Alignment', 'Distribution', 'Copy'])
    assert.equal(h.runtime['setupScene3D' + sibling], undefined, 'The fixture does not inject a sibling controller.');
  const snapshot = () => ({ ...sourceSnapshot(f.content), token: context.sourceToken });
  const controller = h.runtime.setupScene3DRemoval({ getContext: () => context,
    getSource: async () => sourceProvider ? sourceProvider(snapshot()) : snapshot(),
    applyDraft: async () => { prohibitedApplyRequests++; throw Error('Independent controller review grants no writer'); } });
  const el = suffix => h.element('scene3dRemoval' + suffix), rows = () => el('Objects').querySelectorAll('input[type=checkbox]');
  const select = (identity, checked = true) => { const row = rows().find(item => item.dataset.instanceId === identity);
    assert.ok(row); row.checked = checked; row.dispatch('change'); };
  const change = (suffix, value) => { el(suffix).value = value; el(suffix).dispatch('input'); };
  return { context, controller, el, rows, select, change, snapshot, language: () => languageChanged?.(), f };
}
async function controllerRun(name, fn, sourceProvider, f) {
  let h;
  await run(name, async () => { try { h = await controllerFixture(sourceProvider, f); await fn(h); }
    finally { h?.controller.dispose(); await flushDialogs(); } }, 'actual-controller-event-fixture-native-proposals-no-writer');
  counts.controllerCases++;
}
await controllerRun('explicit source selection and hidden matching rows retain the full global removal intent and canonical remaining declarations', async h => {
  assert.equal(await h.controller.open(), true); assert.ok(h.rows().every(row => !row.checked)); assert.equal(h.el('Check').disabled, true);
  h.select(id(6)); h.select(id(1)); h.change('Search', id(6)); assert.equal(h.rows().length, 1);
  h.el('Check').click(); assert.equal(h.el('Apply').disabled, false);
  assert.equal(h.el('Source').textContent, expected(h.f, [0, 5]).afterContent);
  assert.deepEqual(parsed(h.el('Source').textContent).objects, h.f.model.objects.slice(1, 5));
  assert.ok(h.el('Selection').textContent.includes('1'));
});
await controllerRun('select all refuses to empty a six-object or singleton source without truncating the explicit selection', async h => {
  await h.controller.open(); h.el('SelectResults').click(); assert.equal(h.rows().filter(row => row.checked).length, 6);
  assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true); assert.ok(h.el('Blocked').textContent);
  h.select(id(3), false); h.el('Check').click(); assert.equal(h.el('Apply').disabled, false);
  assert.equal(parsed(h.el('Source').textContent).objects[0].instanceId, id(3));
  const singleton = await controllerFixture(undefined, fixture(1));
  try { await singleton.controller.open(); singleton.el('SelectResults').click(); assert.equal(singleton.rows()[0].checked, true);
    assert.equal(singleton.el('Check').disabled, true); assert.equal(singleton.el('Apply').disabled, true); assert.ok(singleton.el('Blocked').textContent); }
  finally { singleton.controller.dispose(); await flushDialogs(); }
});
await controllerRun('silent checkbox UUID and search changes after review cannot invoke an author writer', async h => {
  await h.controller.open(); h.select(id(1)); h.el('Check').click(); assert.equal(h.el('Apply').disabled, false);
  h.rows()[0].checked = false; h.el('Apply').click(); await flushDialogs(); assert.equal(h.el('Apply').disabled, true); assert.equal(prohibitedApplyRequests, 0);
  h.el('Check').click(); assert.equal(h.el('Apply').disabled, false); h.rows()[0].dataset.instanceId = id(6);
  h.el('Apply').click(); await flushDialogs(); assert.equal(h.el('Apply').disabled, true); assert.equal(prohibitedApplyRequests, 0);
  h.el('Check').click(); assert.equal(h.el('Apply').disabled, false); h.el('Search').value = id(1);
  h.el('Apply').click(); await flushDialogs(); assert.equal(h.el('Apply').disabled, true); assert.equal(prohibitedApplyRequests, 0);
});
await controllerRun('old session query generation and reattached foreign rows cannot change the new selection', async h => {
  await h.controller.open(); const old = h.rows()[0]; h.controller.close(true); h.context.sourceToken = 'independent-removal-ui:2'; await h.controller.open();
  old.checked = true; old.dispatch('change'); assert.ok(h.rows().every(row => !row.checked));
  const foreign = h.rows()[0]; foreign.dataset.instanceId = id(6); foreign.checked = true; foreign.dispatch('change');
  h.controller.refresh(); assert.ok(h.rows().every(row => !row.checked));
  h.select(id(2)); const stale = h.rows()[1]; h.change('Search', id(1)); stale.checked = false; stale.dispatch('change');
  h.el('Objects').append(stale); stale.dispatch('change'); h.change('Search', ''); assert.equal(h.rows()[1].checked, true);
  h.el('Check').click(); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Source').textContent, expected(h.f, [1]).afterContent);
});
await controllerRun('language and query repaint retain identity intent while source-owner replacement revokes approval and preserves raw selection', async h => {
  await h.controller.open(); h.select(id(6)); h.select(id(1)); const before = h.rows().filter(row => row.checked).map(row => row.dataset.instanceId);
  h.el('Check').click(); assert.equal(h.el('Apply').disabled, false); h.language(); h.controller.refresh();
  assert.deepEqual(h.rows().filter(row => row.checked).map(row => row.dataset.instanceId), before); assert.equal(h.el('Apply').disabled, false);
  h.context.sourceToken = 'independent-removal-ui:reloaded'; h.controller.refresh();
  assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true);
  assert.deepEqual(h.rows().filter(row => row.checked).map(row => row.dataset.instanceId), before);
});
let releaseSource, lateSnapshot;
const lateSource = new Promise(resolve => { releaseSource = resolve; });
await controllerRun('a late source completion after cancellation cannot reopen or approve the released owner', async h => {
  const opened = h.controller.open(); h.controller.close(true); releaseSource(lateSnapshot); assert.equal(await opened, false);
  assert.equal(h.el('Dialog').open, false); assert.equal(h.el('Fields').hidden, true); assert.equal(h.el('Apply').disabled, true);
}, source => { lateSnapshot = source; return lateSource; });
await controllerRun('128 object full selection remains explicit and unapproved while a single survivor admits one complete 127-object removal', async h => {
  await h.controller.open(); h.el('SelectResults').click(); assert.equal(h.rows().filter(row => row.checked).length, 128);
  assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true); assert.ok(h.el('Blocked').textContent);
  h.select(id(65), false); assert.equal(h.rows().filter(row => row.checked).length, 127); h.el('Check').click();
  assert.equal(h.el('Apply').disabled, false); assert.equal(parsed(h.el('Source').textContent).objects.length, 1);
  assert.equal(parsed(h.el('Source').textContent).objects[0].instanceId, id(65));
}, undefined, fixture(128, 1));

const afterSources = await hashes(), nativeAfterSha256 = sha(await fs.readFile(nativePath));
const outputName = process.argv[2]; assert.ok(outputName && /^[a-z0-9-]+\.json$/.test(outputName));
const report = { format: 'viento-scene3d-removal-independent-review', schemaVersion: 1, observedAt: new Date().toISOString(), node: process.version,
  ok: cases.every(item => item.ok) && prohibitedApplyRequests === 0 && JSON.stringify(beforeSources) === JSON.stringify(afterSources) && nativeBeforeSha256 === nativeAfterSha256,
  passed: cases.filter(item => item.ok).length, failed: cases.filter(item => !item.ok).length, cases, counts,
  sources: beforeSources, afterSources, sourceStable: JSON.stringify(beforeSources) === JSON.stringify(afterSources),
  staticReview: { blockingFindings: [], reviewed: ['new native operation and raw request validation',
    'existing contiguous-run CST helper reuse', 'new bridge exact receipt and complete source cut',
    'pure ninth-brand proposal and digest preparation', 'independent controller event ownership'],
    contract: { requestKeys: ['protocolVersion', 'operation', 'content', 'instanceIds'],
      receiptKeys: ['instanceIds', 'beforeContent', 'afterContent', 'changedPaths'],
      selectionAdmission: [1, 128], successfulRemovalMaximum: 127, minimumSurvivors: 1,
      canonicalOrder: 'original declarations', changedPaths: 'ascending original array indices',
      survivorGuarantee: 'original object spans and all bytes outside necessary contiguous deletion ranges remain exact' } },
  wasm: { bytes: wasmBytes.length, sha256: sha(wasmBytes) }, native: { path: nativePath, beforeSha256: nativeBeforeSha256, afterSha256: nativeAfterSha256 },
  prohibitedApplyRequests, siblingControllersAbsent: 8,
  scope: 'Independent isolated-stage source cuts, genuine native CLI/WASM receipts, fail-closed mocked forged transport, old actual WASM and private brands. Controller fixture scope is stated per case. No build, HTTP/browser/GPU/device/install, disk Save or actual checkout mutation.' };
await fs.writeFile(new URL(outputName, out), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ ok: report.ok, passed: report.passed, failed: report.failed, counts, sourceStable: report.sourceStable }) + '\n');
if (!report.ok) process.exitCode = 1;

import '../../../scripts/adapters/node-studio-core.mjs';
import { createScene3DObjectIndex, queryScene3DObjects, createScene3DSourceLocation,
  scene3DSourceDisplaySelection, isScene3DSourceLocation } from '../../../engine/scene3d-navigation.mjs';
import { parseScene3DSource } from '../../../engine/scene3d.mjs';
import { frameCamera, lookAt4, perspective4, multiply4, objectMatrix4 } from '../../../web/modules/scene3d-math.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const root = new URL('../../../', import.meta.url), out = new URL('./', import.meta.url);
const runtime = await fs.readFile(new URL('web/modules/app-runtime.js', root), 'utf8');
const sample = await fs.readFile(new URL('examples/scene3d/scene.json', root), 'utf8');
const native = JSON.parse(sample), ids = native.objects.map(item => item.instanceId);
const sha = value => createHash('sha256').update(value).digest('hex');
const normalize = value => value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
const host = runtime.slice(runtime.indexOf('let scene3DSourceReadEpoch'), runtime.indexOf('\nasync function applySceneCompositionOverrideDraft'));
assert.ok(host.includes('async function locateScene3DSource'));
function fixture(raw) {
  let content = raw, doc = { path: 'scene', _sourceCachedText: raw }, busy = false;
  const editor = { value: normalize(raw), selectionStart: 3, selectionEnd: 5, scrollTop: 17, clientHeight: 320,
    focuses: 0, setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    focus() { this.focuses++; }, scrollIntoView() {} };
  const state = { isEditing: true, isCreating: false, editInputMode: 'source', activeEditPath: 'scene',
    activeEditSource: 'documents/scene.json', editHasUnsavedChanges: false };
  const statuses = [], context = vm.createContext({ state, editorLoadToken: 3, scenePreviewDraftEpoch: 7,
    sourceNavigationToken: 0, editSessionBaselineContent: raw, editSessionVersion: 'saved-version', editEditorEl: editor,
    createScene3DSourceLocation, scene3DSourceDisplaySelection, getActiveDoc: () => doc,
    isEditModeActive: () => true, isEditorBusy: () => busy, canonicalizeSourcePath: value => value,
    getCurrentEditContent: () => content, setEditorStatus: value => statuses.push(value), t: value => value,
    getComputedStyle: () => ({ lineHeight: '20px' }) });
  vm.runInContext(host, context);
  const originalReader = context.getScene3DSourceSnapshot;
  let release;
  return { context, state, editor, statuses, content: () => content, doc: () => doc,
    setContent(value) { content = value; editor.value = normalize(value); }, setDoc(value) { doc = value; },
    setBusy(value) { busy = value; }, read: () => originalReader(),
    locate: (snapshot, instanceId, isCurrent = () => true) => context.locateScene3DSource(snapshot, { instanceId, isCurrent }),
    block() { context.getScene3DSourceSnapshot = async () => { const captured = await originalReader();
      await new Promise(resolve => { release = resolve; }); return captured; }; },
    unblock() { context.getScene3DSourceSnapshot = originalReader; release(); },
    async blocked() { for (let n = 0; n < 30 && !release; n++) await new Promise(resolve => setTimeout(resolve, 1)); assert.equal(typeof release, 'function'); } };
}
const cases = [], counts = { newlineVariants: 0, awaitOwnerVariants: 0, completionOwnerVariants: 0, framedCameras: 0, cornerProjections: 0 };
async function run(name, callback) { await callback(); cases.push({ name, ok: true }); }
const rawVariants = [sample, '\ufeff' + sample.replaceAll('\n', '\r\n'), sample.replaceAll('\n', '\r'),
  '\ufeff' + sample.split('\n').map((line, i) => line + ['\r\n', '\r', '\n'][i % 3]).join('')];

await run('native raw UTF16 ranges map to actual LF-normalized textarea for four newline forms', async () => {
  for (const raw of rawVariants) {
    const h = fixture(raw), snapshot = await h.read(), location = createScene3DSourceLocation(snapshot, ids[1]);
    const sourcePart = raw.slice(location.sourceRange.start, location.sourceRange.end);
    assert.equal(JSON.parse(sourcePart).instanceId, ids[1]); assert.ok(isScene3DSourceLocation(location));
    const expected = scene3DSourceDisplaySelection(location, h.editor.value), result = await h.locate(snapshot, ids[1]);
    assert.equal(result.located, true); assert.ok(Object.isFrozen(result));
    assert.deepEqual([h.editor.selectionStart, h.editor.selectionEnd], [expected.start, expected.end]);
    assert.equal(JSON.parse(h.editor.value.slice(expected.start, expected.end)).instanceId, ids[1]);
    assert.equal(h.content(), raw); assert.equal(h.doc()._sourceCachedText, raw);
    assert.equal(h.context.editSessionBaselineContent, raw); assert.equal(h.context.editSessionVersion, 'saved-version');
    assert.equal(h.state.editHasUnsavedChanges, false); assert.equal(h.editor.focuses, 0);
    assert.equal(result.focus(), true); assert.equal(result.focus(), false); assert.equal(h.editor.focuses, 1); counts.newlineVariants++;
  }
});
await run('literal Unicode and HTML-like name query preserves native order and original source', () => {
  const data = structuredClone(native); data.objects[0].name = '🦊 <img src=x>\r\nBox'; data.objects[1].name = '🦊 <img src=x>\r\nbox';
  const raw = '\ufeff' + JSON.stringify(data, null, 2).replaceAll('\n', '\r\n'), parsed = parseScene3DSource(raw);
  const index = createScene3DObjectIndex(parsed); assert.ok(Object.isFrozen(index)); assert.ok(Object.isFrozen(index.objects[0]));
  assert.deepEqual(queryScene3DObjects(index, '  BOX  ').map(item => item.instanceId), ids.slice(0, 2));
  assert.deepEqual(queryScene3DObjects(index, ids[1].toUpperCase()).map(item => item.instanceId), [ids[1]]);
  assert.equal(queryScene3DObjects(index, 'no results').length, 0);
  const location = createScene3DSourceLocation({ content: raw, sourcePath: 'documents/scene.json', token: 'live' }, ids[1]);
  const displayed = normalize(raw), selection = scene3DSourceDisplaySelection(location, displayed);
  assert.equal(JSON.parse(displayed.slice(selection.start, selection.end)).name, data.objects[1].name);
  assert.throws(() => scene3DSourceDisplaySelection({ ...location }, displayed));
  assert.throws(() => scene3DSourceDisplaySelection(location, displayed + ' '));
  assert.throws(() => queryScene3DObjects({ ...index }, 'Box'));
});
await run('stale source and every owner replacement at the actual host await do not move selection', async () => {
  for (const change of ['bytes', 'display', 'doc', 'load', 'epoch', 'baseline', 'version', 'path', 'activePath', 'busy', 'creating', 'mode', 'cancel']) {
    const h = fixture(rawVariants[1]), snapshot = await h.read(); let current = true;
    h.block(); const pending = h.locate(snapshot, ids[0], () => current); await h.blocked();
    if (change === 'bytes') h.setContent(rawVariants[1] + ' ');
    if (change === 'display') h.editor.value += ' ';
    if (change === 'doc') h.setDoc({ ...h.doc() });
    if (change === 'load') h.context.editorLoadToken++;
    if (change === 'epoch') h.context.scenePreviewDraftEpoch++;
    if (change === 'baseline') h.context.editSessionBaselineContent += ' ';
    if (change === 'version') h.context.editSessionVersion = 'other-version';
    if (change === 'path') h.state.activeEditSource = 'documents/other.json';
    if (change === 'activePath') h.state.activeEditPath = 'other';
    if (change === 'busy') h.setBusy(true);
    if (change === 'creating') h.state.isCreating = true;
    if (change === 'mode') h.state.editInputMode = 'fields';
    if (change === 'cancel') current = false;
    const before = h.content(); h.unblock(); assert.equal(await pending, false, change);
    assert.deepEqual([h.editor.selectionStart, h.editor.selectionEnd, h.editor.scrollTop, h.editor.focuses], [3, 5, 17, 0]);
    assert.equal(h.content(), before); assert.equal(h.statuses.length, 0); counts.awaitOwnerVariants++;
  }
});
await run('modal close may release UI approval while guarded completion rejects newer editor owners', async () => {
  const h = fixture(rawVariants[1]); let current = true; const receipt = await h.locate(await h.read(), ids[0], () => current);
  current = false; assert.equal(receipt.focus(), true, 'completed host owner survives intended modal close');
  for (const change of ['doc', 'load', 'epoch', 'bytes', 'baseline', 'version', 'navigation']) {
    const f = fixture(rawVariants[1]), result = await f.locate(await f.read(), ids[0]);
    if (change === 'doc') f.setDoc({ ...f.doc() });
    if (change === 'load') f.context.editorLoadToken++;
    if (change === 'epoch') f.context.scenePreviewDraftEpoch++;
    if (change === 'bytes') f.setContent(rawVariants[1] + ' ');
    if (change === 'baseline') f.context.editSessionBaselineContent += ' ';
    if (change === 'version') f.context.editSessionVersion = 'changed';
    if (change === 'navigation') f.context.sourceNavigationToken++;
    assert.equal(result.focus(), false, change); assert.equal(f.editor.focuses, 0); counts.completionOwnerVariants++;
  }
});
await run('newer navigation wins without old async selection or focus hijack', async () => {
  const h = fixture(sample), snapshot = await h.read(); h.block(); const first = h.locate(snapshot, ids[0]); await h.blocked();
  const pendingReader = h.context.getScene3DSourceSnapshot; h.context.getScene3DSourceSnapshot = h.read;
  const second = await h.locate(snapshot, ids[1]); assert.equal(second.located, true);
  h.context.getScene3DSourceSnapshot = pendingReader; h.unblock(); assert.equal(await first, false);
  const selected = h.editor.value.slice(h.editor.selectionStart, h.editor.selectionEnd);
  assert.equal(JSON.parse(selected).instanceId, ids[1]); assert.equal(second.focus(), true); assert.equal(h.content(), sample);
});
await run('stale snapshots, unknown objects and caller ranges cannot locate arbitrary editor text', async () => {
  const h = fixture(sample), snapshot = await h.read();
  for (const bad of [{ ...snapshot, token: 'old' }, { ...snapshot, sourcePath: 'documents/other.json' },
    { ...snapshot, content: sample + ' ' }, { ...snapshot, sourceRange: { start: 0, end: 5 } }]) assert.equal(await h.locate(bad, ids[0]), false);
  assert.equal(await h.locate(snapshot, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), false);
  assert.equal(h.content(), sample); assert.deepEqual([h.editor.selectionStart, h.editor.selectionEnd], [3, 5]);
});

const apply4 = (matrix, vector) => Array.from({ length: 4 }, (_, row) => vector.reduce((sum, value, col) => sum + value * matrix[col * 4 + row], 0));
function independentCorner(object, unit) {
  let [x, y, z] = unit.map((v, i) => v * object.size[i]);
  const [rx, ry, rz] = object.rotationDegrees.map(value => value * Math.PI / 180);
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  return [x, y, z];
}
await run('eight rotated box corners fit temporary clipping at normal and extreme actual aspects', () => {
  const configurations = [
    { size: [4, 2, 3], position: [2, -3, 7], aspect: 16 / 9, fov: 50 },
    { size: [1000, .001, 999], position: [100000, -100000, 100000], aspect: 1 / 8192, fov: 1 },
    { size: [.001, .001, .001], position: [100000, -100000, 100000], aspect: 8192, fov: 179 },
    { size: [.001, 1000, .002], position: [-100000, 100000, -100000], aspect: 1 / 2048, fov: 179 },
    { size: [1000, 1000, 1000], position: [-100000, 0, 100000], aspect: 2048, fov: 1 },
    { size: [.001, .002, .003], position: [0, 0, 0], aspect: 1, fov: 179 },
  ];
  for (const c of configurations) for (const heading of [[9, 8, 12], [10, 100000, 0]]) {
    const camera = { position: heading, target: [0, 0, 0], fovDegrees: c.fov, near: 10000, far: 10100 };
    const object = { position: c.position, size: c.size, rotationDegrees: [31, -47, 63] };
    const before = JSON.stringify({ camera, object }), framed = frameCamera(camera, object, c.aspect);
    assert.ok(framed); assert.ok(Object.isFrozen(framed.position)); assert.ok(framed.near > 0 && framed.far > framed.near);
    assert.equal(JSON.stringify({ camera, object }), before); assert.deepEqual(framed.target, object.position);
    const eye = framed.position.map((v, i) => v - framed.target[i]);
    const vp = multiply4(perspective4(framed.fovDegrees, c.aspect, framed.near, framed.far), lookAt4(eye, [0, 0, 0]));
    const gpuVp = Array.from(new Float32Array(vp));
    const model = Array.from(new Float32Array(objectMatrix4({ ...object, position: [0, 0, 0] })));
    for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) {
      const unit = [x, y, z], corner = independentCorner(object, unit);
      for (const clip of [apply4(vp, [...corner, 1]), apply4(gpuVp, apply4(model, [...unit, 1]))]) {
        assert.ok(clip.every(Number.isFinite)); assert.ok(clip[3] > 0);
        for (const n of clip.slice(0, 3)) assert.ok(Math.abs(n / clip[3]) <= 1.00001, `corner outside clip at aspect ${c.aspect}`);
        counts.cornerProjections++;
      }
    }
    counts.framedCameras++;
  }
  assert.equal(frameCamera(native.camera, native.objects[0], 0), null);
  assert.equal(frameCamera({ ...native.camera, position: [0, 0, 0], target: [0, 0, 0] }, native.objects[0], 1), null);
});
const sources = ['engine/scene3d-navigation.mjs', 'engine/scene3d.mjs', 'engine/studio-core.mjs',
  'web/modules/app-runtime.js', 'web/modules/scene3d-math.js', 'web/modules/scene3d-renderer.js'];
const report = { format: 'viento-scene3d-navigation-independent-quality', schemaVersion: 1, observedAt: new Date().toISOString(),
  ok: true, node: process.version, passed: cases.length, failed: 0, cases, counts,
  reviewedSources: Object.fromEntries(await Promise.all(sources.map(async name => [name, sha(await fs.readFile(new URL(name, root)))]))),
  scope: 'Actual native WASM source parsing and actual runtime selection host; simulated LF-normalizing editor storage and await scheduler. Independent eight-corner XYZ projection and Float32 payload check, not real GPU execution, native CLI, browser, Save, build or device validation.',
  resolvedFinding: 'The original CRLF raw-versus-textarea equality rejection is fixed using private-branded raw UTF16 to displayed LF selection mapping, without changing source bytes or original native range.' };
const output = process.argv[2]; assert.ok(output && /^[a-z0-9-]+\.json$/.test(output));
await fs.writeFile(new URL(output, out), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ok: true, report: output, sha256: sha(JSON.stringify(report, null, 2) + '\n'), passed: cases.length, counts, node: process.version }));

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createScriptUsageSourceHost } from '../../web/modules/app-script-usage-source.js';
import { captureScriptUsage, scriptUsageSource, createScriptUsageOpenSourceRequest, isScriptUsage, scriptUsageMatchSource } from '../../engine/script-usage.mjs';
const id = n => `34343434-3434-4434-8434-${String(n).padStart(12, '0')}`;
const hash = value => createHash('sha256').update(value).digest('hex'), revision = value => 'sha256:' + hash(value);
const conflict = { errorCode: 'script_usage_conflict' }, original = 'extends Node\n# plain handwritten script\n';
const json = value => '\ufeff' + JSON.stringify(value, null, 2).replaceAll('\n', '\r\n') + '\r\n';
function gate() { let entered, release; const ready = new Promise(resolve => { entered = resolve; }); const wait = new Promise(resolve => { release = resolve; }); return { ready, release, hold: async () => { entered(); await wait; } }; }
function fixture() {
  const state = { document: {}, token: 'one', sourcePath: 'documents/scripts/plain.txt', content: original, baseline: original, version: revision(original),
    editable: true, creating: false, busy: false, available: true, sourceTXT: true };
  const content = json({ format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(3), bindings: [{ bindingId: id(4), instanceId: id(5),
    implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: id(1) }, parameters: { message: '旅人😀\r\n', enabled: false }, events: [] }] });
  const raw = { format: 'viento-script-usage', schemaVersion: 1, worldId: 'world:' + 'a'.repeat(64), revision: revision('world'),
    script: { objectId: id(1), sourcePath: state.sourcePath, sourceRevision: revision(original) },
    references: [{ objectId: id(2), sourcePath: 'documents/behaviors/demo.json', sourceRevision: revision(content), relationKinds: ['reference'], content }] };
  const calls = [], navigations = []; let beforeDigest = async () => {}, beforeRead = async () => {}, navigation = () => ({ focus() {} }), count = 0;
  const host = createScriptUsageSourceHost({ getState: () => ({ ...state }), digest: async value => { await beforeDigest(++count, value); return hash(value); },
    inspectUsage: async payload => { calls.push(payload); await beforeRead(); return raw; },
    navigateSource: async (...args) => { navigations.push(args); return navigation(...args); } });
  return { state, raw, host, calls, navigations, setRead: hook => { beforeRead = hook; }, setNavigate: hook => { navigation = hook; },
    blockDigest(offset) { const at = count + offset, g = gate(); beforeDigest = async n => { if (n === at) await g.hold(); }; return g; } };
}
async function loaded(h) { const source = await h.host.getSource(), catalog = await h.host.getUsage(source); const ref = catalog.references[0];
  return { source, catalog, request: createScriptUsageOpenSourceRequest(catalog, scriptUsageSource(catalog, ref, ref.bindings[0])) }; }
const mutate = (h, key) => { if (key === 'document') h.state.document = {}; else if (typeof h.state[key] === 'boolean') h.state[key] = !h.state[key]; else h.state[key] += ' '; };

test('plain and dirty TXT sources read saved registered usage without any draft or save authority', async () => {
  const h = fixture(); h.state.content += '# unsaved changes\n';
  const { source, catalog, request } = await loaded(h);
  assert.deepEqual(Object.keys(h.host).sort(), ['getContext', 'getSource', 'getUsage', 'openSource']);
  assert.equal(h.host.getContext().dirty, true); assert.equal(isScriptUsage(catalog), true); assert.equal(scriptUsageMatchSource(catalog, source), true);
  assert.deepEqual(h.calls, [{ sourcePath: h.state.sourcePath }]); assert.equal(catalog.matches.length, 1);
  assert.equal(request.source.propertyPath, '/bindings/0'); assert.equal(JSON.parse(request.source.content.slice(request.source.sourceRange.start, request.source.sourceRange.end)).bindingId, id(4));
  const result = await h.host.openSource(request); assert.equal(typeof result.focus, 'function'); assert.equal(h.calls.length, 2); assert.equal(h.navigations.length, 1);
  assert.equal(h.state.content, original + '# unsaved changes\n'); assert.equal(h.state.baseline, original); assert.equal(h.state.version, revision(original));
});

test('every read boundary revokes a changed editor and capability withdrawal', async () => {
  for (const boundary of [1, 2, 'read']) for (const key of ['document', 'token', 'sourcePath', 'content', 'baseline', 'version', 'editable', 'creating', 'busy', 'available', 'sourceTXT']) {
    const h = fixture(), source = await h.host.getSource(), g = boundary === 'read' ? gate() : h.blockDigest(boundary);
    if (boundary === 'read') h.setRead(g.hold);
    const pending = h.host.getUsage(source); await g.ready; mutate(h, key); g.release();
    await assert.rejects(pending, conflict); assert.equal(h.navigations.length, 0);
  }
});

test('request descriptors detach before awaits and foreign catalogs or copied navigation intents cannot open documents', async () => {
  const h = fixture(), source = await h.host.getSource(); let invoked = 0;
  const bad = { ...source }; Object.defineProperty(bad, 'content', { enumerable: true, get() { invoked++; return source.content; } });
  for (const input of [bad, Object.create(source), { ...source, extra: true }, { ...source, token: 'other' }, [], null]) await assert.rejects(h.host.getUsage(input), conflict);
  assert.equal(invoked, 0); assert.equal(h.calls.length, 0);
  const mutable = { ...source }, g = h.blockDigest(1), pending = h.host.getUsage(mutable); await g.ready; mutable.token = 'different'; mutable.content = 'changed'; g.release();
  assert.equal(scriptUsageMatchSource(await pending, source), true);
  const { request } = await loaded(h), other = captureScriptUsage(source, h.raw);
  const foreign = createScriptUsageOpenSourceRequest(other, scriptUsageSource(other, other.references[0], other.references[0].bindings[0]));
  for (const input of [null, {}, { ...request }, structuredClone(request), foreign]) await assert.rejects(h.host.openSource(input), conflict);
  assert.deepEqual(h.navigations, []);
});

test('navigation rereads saved references and refuses changed scripts targets content and missing registration before handoff', async () => {
  for (const change of [h => { h.raw.script.sourceRevision = revision('changed'); }, h => { h.raw.references = []; },
    h => { h.raw.references[0].sourceRevision = revision('changed'); }, h => { h.raw.references[0].content += '\r\n'; },
    h => { h.raw.references[0].sourcePath = 'documents/behaviors/elsewhere.json'; }]) {
    const h = fixture(), { request } = await loaded(h); change(h);
    await assert.rejects(h.host.openSource(request)); assert.deepEqual(h.navigations, []); assert.equal(h.state.content, original);
  }
});

test('every asynchronous navigation boundary checks the original source before handing off', async () => {
  for (const boundary of [1, 2, 'read', 3]) for (const key of ['document', 'token', 'sourcePath', 'content', 'baseline', 'version', 'editable', 'creating', 'busy', 'available', 'sourceTXT']) {
    const h = fixture(), { request } = await loaded(h), g = boundary === 'read' ? gate() : h.blockDigest(boundary);
    if (boundary === 'read') h.setRead(g.hold);
    const pending = h.host.openSource(request); await g.ready; mutate(h, key); g.release();
    await assert.rejects(pending, conflict); assert.deepEqual(h.navigations, [], `${boundary}:${key}`);
  }
});

test('synchronous mutating dialog guards cannot authorize navigation and observed capability loss revokes catalogs', async () => {
  for (const checkpoint of [1, 2, 3, 4, 5, 6]) {
    const h = fixture(), { request } = await loaded(h); let calls = 0;
    await assert.rejects(h.host.openSource(request, { isCurrent: () => { if (++calls === checkpoint) h.state.content += 'changed'; return true; } }), conflict);
    assert.deepEqual(h.navigations, []); assert.equal(calls, checkpoint);
  }
  const h = fixture(), { request } = await loaded(h); h.state.available = false; h.host.getContext(); h.state.available = true; h.host.getContext();
  await assert.rejects(h.host.openSource(request), conflict); assert.deepEqual(h.navigations, []);
});

test('runtime owns a successful document transition while dialog cancellation and capability loss still revoke it', async () => {
  const h = fixture(), { request } = await loaded(h); let active = true;
  h.setNavigate((_source, context) => {
    h.state.document = {}; h.state.token = 'target'; h.state.sourcePath = 'documents/behaviors/demo.json'; h.state.busy = true;
    assert.equal(context.isCurrent(), true, 'ordinary own navigation must not cancel itself');
    active = false; assert.equal(context.isCurrent(), false); active = true;
    h.state.available = false; assert.equal(context.isCurrent(), false);
    return false;
  });
  assert.equal(await h.host.openSource(request, { isCurrent: () => active }), false); assert.equal(h.navigations.length, 1);
});

test('legacy unavailable hosts do not read usage or claim a source session', async () => {
  for (const unavailable of [false, undefined, 'true', 1]) { const h = fixture(); h.state.available = unavailable;
    assert.equal(h.host.getContext().available, false); assert.equal(await h.host.getSource(), null); assert.deepEqual(h.calls, []); }
  const h = fixture(); h.state.version = revision('wrong baseline'); assert.equal(await h.host.getSource(), null);
});


test('same-path same-byte script re-registration or another World cannot inherit a prior whole-document navigation intent', async () => {
  for (const change of [h => { h.raw.script.objectId = id(99); }, h => { h.raw.worldId = 'world:' + 'b'.repeat(64); }]) {
    const h = fixture(), { catalog } = await loaded(h);
    const request = createScriptUsageOpenSourceRequest(catalog, scriptUsageSource(catalog, catalog.references[0]));
    change(h); await assert.rejects(h.host.openSource(request), conflict);
    assert.deepEqual(h.navigations, []); assert.equal(h.state.content, original);
  }
});

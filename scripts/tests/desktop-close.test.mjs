import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { dialogHarness } from './dialog-harness.mjs';
import { createDesktopSession } from '../lib/desktop-session.mjs';

const nativeSource = await fs.readFile(new URL('../../src-tauri/src/desktop_host.rs', import.meta.url), 'utf8');
const closeScript = nativeSource.match(/const CLOSE_SCRIPT: &str = r#"([\s\S]*?)"#;/)[1];
const browserSource = await fs.readFile(new URL('../../web/modules/app-runtime.js', import.meta.url), 'utf8');
const beforeUnload = browserSource.match(/window\.addEventListener\('beforeunload', (\(event\) => \{[\s\S]*?\n    \})\);/)[1];

async function closeHarness() {
  const harness = await dialogHarness('app-project-settings');
  harness.runtime.setupProjectSettings({ getContext: () => ({}), applied: async () => {}, setBusy() {} });
  return harness;
}

test('desktop close reports document and template drafts and busy operations without discarding input', async () => {
  for (const scenario of ['clean', 'source', 'template', 'property', 'scene', 'saving', 'applying', 'command', 'scene-saving', 'projection', 'projection-saving', 'layout', 'layout-saving', 'composition-create', 'composition-create-reading', 'materialize', 'materialize-saving']) {
    const { runtime, document, element } = await closeHarness();
    document.body.inert = false;
    element('docSourceEditor').value = '尚未保存的正文';
    if (scenario === 'source') element('docEditDirtyIndicator').classList.add('is-unsaved');
    if (scenario === 'template') element('projectSettingsDialog').dataset.dirty = 'true';
    if (scenario === 'saving') element('docEditPanel').setAttribute('aria-busy', 'true');
    if (scenario === 'applying') element('projectSettingsDialog').setAttribute('aria-busy', 'true');
    const world = document.createElement('dialog'); world.id = 'worldBrowserDialog'; document.body.appendChild(world);
    if (scenario === 'property') world.dataset.dirty = 'true';
    if (scenario === 'command') world.setAttribute('aria-busy', 'true');
    const scene = document.createElement('dialog'); scene.id = 'sceneCreateDialog'; document.body.appendChild(scene);
    if (scenario === 'scene') scene.dataset.dirty = 'true';
    if (scenario === 'scene-saving') scene.setAttribute('aria-busy', 'true');
    const layout = document.createElement('dialog'); layout.id = 'sceneLayoutDialog'; document.body.appendChild(layout);
    if (scenario === 'layout') layout.dataset.dirty = 'true';
    if (scenario === 'layout-saving') layout.setAttribute('aria-busy', 'true');
    const projection = document.createElement('dialog'); projection.id = 'objectProjectionDialog'; document.body.appendChild(projection);
    if (scenario === 'projection') projection.dataset.dirty = 'true';
    if (scenario === 'projection-saving') projection.setAttribute('aria-busy', 'true');
    const composition = document.createElement('dialog'); composition.id = 'sceneCompositionCreateDialog'; document.body.appendChild(composition);
    if (scenario === 'composition-create') composition.dataset.dirty = 'true';
    if (scenario === 'composition-create-reading') composition.setAttribute('aria-busy', 'true');
    const materialize = document.createElement('dialog'); materialize.id = 'sceneMaterializeDialog'; document.body.appendChild(materialize);
    if (scenario === 'materialize') materialize.dataset.dirty = 'true';
    if (scenario === 'materialize-saving') materialize.setAttribute('aria-busy', 'true');
    const id = randomUUID(), sent = [];
    runtime.fetch = async (url, options) => { sent.push({ url, ...JSON.parse(options.body) }); return { ok: true }; };
    await vm.runInContext(closeScript.replace('__VIENTO_CLOSE_ID__', JSON.stringify(id)), runtime);
    assert.deepEqual(sent, [{ url: '/__desktop/close-response', id, busy: ['saving', 'applying', 'command', 'scene-saving', 'projection-saving', 'layout-saving', 'composition-create-reading', 'materialize-saving'].includes(scenario), dirty: ['source', 'template', 'property', 'scene', 'projection', 'layout', 'composition-create', 'materialize'].includes(scenario) }], scenario);
    assert.equal(document.body.inert, true, 'input is frozen while the host checks this snapshot');
    assert.equal(runtime.window.__vientoCloseGuard.inert, false);
    assert.equal(element('docSourceEditor').value, '尚未保存的正文');
  }
});

test('browser unload protects materialization settings and pending creation while clean dialogs may close', async () => {
  for (const scenario of ['clean', 'materialize', 'materialize-saving', 'materialize-saved']) {
    const { runtime, document } = await closeHarness();
    runtime.state = { editHasUnsavedChanges: false };
    const dialog = document.createElement('dialog'); dialog.id = 'sceneMaterializeDialog'; dialog.open = true;
    dialog.dataset.dirty = String(scenario === 'materialize');
    dialog.setAttribute('aria-busy', String(scenario === 'materialize-saving'));
    document.body.appendChild(dialog);
    const input = document.createElement('input'); input.value = '尚未保存的独立场景名称'; dialog.appendChild(input);
    let prevented = false;
    const event = { preventDefault() { prevented = true; } };
    vm.runInContext(`(${beforeUnload})`, runtime)(event);
    const guarded = ['materialize', 'materialize-saving'].includes(scenario);
    assert.equal(prevented, guarded, scenario);
    assert.equal(event.returnValue, guarded ? '' : undefined, scenario);
    assert.equal(input.value, '尚未保存的独立场景名称');
  }
});

test('an incomplete editor or an unavailable bridge cannot report that it is safe to close', async () => {
  for (const failed of ['missing-panel', 'missing-indicator', 'offline', 'unauthorized']) {
    const { runtime, document, element } = await closeHarness();
    document.body.inert = false;
    const source = element('docSourceEditor');
    source.value = '必须保留的草稿';
    element('docEditDirtyIndicator').classList.add('is-unsaved');
    if (failed === 'missing-panel') element('docEditPanel').remove();
    if (failed === 'missing-indicator') element('docEditDirtyIndicator').remove();
    const sent = [];
    runtime.fetch = async (_url, options) => {
      sent.push(JSON.parse(options.body));
      if (failed === 'offline') throw new Error('service unavailable');
      return { ok: false, status: 401 };
    };
    await vm.runInContext(closeScript.replace('__VIENTO_CLOSE_ID__', JSON.stringify(randomUUID())), runtime);
    if (failed.startsWith('missing')) assert.equal(sent.length, 0);
    else assert.equal(sent[0].dirty, true);
    assert.ok(sent.every(body => body.allow === undefined));
    assert.equal(source.value, '必须保留的草稿');
  }
});

test('desktop close bridge requires a request identity and strictly typed editor state', async (t) => {
  const events = [];
  t.mock.method(console, 'log', line => events.push(JSON.parse(line.slice('VIENTO_EVENT '.length))));
  const token = 'e'.repeat(32);
  const session = createDesktopSession(token);
  const server = createServer((req, res) => { void session(req, res, new URL(req.url, 'http://localhost').pathname); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const handshake = await fetch(`${base}/__desktop/session/${token}`, { redirect: 'manual' });
  const cookie = handshake.headers.get('set-cookie').split(';')[0];
  const id = randomUUID();
  for (const body of [null, {}, { allow: true }, { id, busy: 'false', dirty: false }, { id: '../request', busy: false, dirty: false }]) {
    const response = await fetch(`${base}/__desktop/close-response`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 400);
  }
  assert.deepEqual(events, []);
  const response = await fetch(`${base}/__desktop/close-response`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, busy: false, dirty: true }) });
  assert.equal(response.status, 204);
  assert.deepEqual(events, [{ type: 'close-response', id, busy: false, dirty: true }]);
});

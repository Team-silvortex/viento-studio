// Independent post-repair quality check. Does not Check, Apply or Save.
// Keep the prior ui-late-checkbox-confirmed false receipt immutable.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from '../../../scripts/tests/dialog-harness.mjs';
import { initializeStudioCore, supportsStudioCoreScene3DTranslationPatch } from '../../../engine/studio-core.mjs';
import { parseScene3DSource } from '../../../engine/scene3d.mjs';
import { createScene3DTranslationProposal, isScene3DTranslationProposal } from '../../../engine/scene3d-translation.mjs';
const root = new URL('../../../', import.meta.url), out = new URL('./', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceURL = new URL('web/modules/app-scene3d-translation.js', root);
const sourceSha256 = hash(await fs.readFile(sourceURL));
await initializeStudioCore(() => fs.readFile(new URL('engine/studio-core.wasm', root)));
const content = await fs.readFile(new URL('examples/scene3d/scene.json', root), 'utf8');
const context = { editable: true, creating: false, busy: false, sourceJSON: true,
  sourcePath: 'documents/scene.json', sourceToken: 'session:1' };
const h = await dialogHarness('app-scene3d-translation', {
  queueMicrotask, parseScene3DSource, createScene3DTranslationProposal,
  isScene3DTranslationProposal, supportsStudioCoreScene3DTranslationPatch,
  t: value => value, translatePage() {}, onLanguageChange() { return () => {}; },
});
h.runtime.window.confirm = () => true;
let forbiddenApplyRequests = 0;
const controller = h.runtime.setupScene3DTranslation({ getContext: () => context,
  getSource: async () => ({ content, sourcePath: context.sourcePath, token: context.sourceToken,
    baseSourceRevision: 'sha256:' + hash(content), sourceRevision: 'sha256:' + hash(content) }),
  applyDraft: async () => { forbiddenApplyRequests++; throw Error('This read-only probe does not authorize draft application'); },
});
const element = suffix => h.element('scene3dTranslation' + suffix);
const choices = () => element('Objects').querySelectorAll('input[type=checkbox]');
const selected = () => Array.from(choices(), row => ({ id: row.dataset.instanceId, checked: row.checked }));
const cases = [];
async function check(name, fn) {
  try { await fn(); cases.push({ name, ok: true }); }
  catch (error) { cases.push({ name, ok: false, message: error.message }); }
}
function equal(a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(JSON.stringify({ expected: b, actual: a })); }
await check('detached checkbox from closed previous owner cannot change reopened selection', async () => {
  equal(await controller.open(), true); await flushDialogs();
  const old = choices()[0]; controller.close(true); context.sourceToken = 'session:2';
  equal(await controller.open(), true); await flushDialogs();
  equal(element('Objects').contains(old), false);
  const before = { text: element('Selection').textContent, rows: selected() };
  old.checked = true; old.dispatch('change');
  equal({ text: element('Selection').textContent, rows: selected() }, before);
});
await check('detached checkbox from same-session search redraw cannot change the global selection', async () => {
  const old = choices()[0]; element('Search').value = 'no-such-box-314159'; element('Search').dispatch('input');
  equal(element('Objects').contains(old), false); equal(choices().length, 0);
  const before = element('Selection').textContent; old.checked = true; old.dispatch('change');
  equal(element('Selection').textContent, before);
  element('Search').value = ''; element('Search').dispatch('input');
  if (choices().some(row => row.checked)) throw Error('A stale hidden row leaked into the global selection');
});
await check('current bound checkbox still selects and keyboard focus follows its regenerated stable identity', async () => {
  const current = choices()[0], id = current.dataset.instanceId;
  current.focus(); current.checked = true; current.dispatch('change');
  equal(selected().filter(row => row.checked).map(row => row.id), [id]);
  equal(h.runtime.document.activeElement.dataset.instanceId, id);
  current.checked = false; current.dispatch('change');
  equal(selected().filter(row => row.checked).map(row => row.id), [id]);
});
controller.dispose(); await flushDialogs();
const endSha256 = hash(await fs.readFile(sourceURL));
const report = { format: 'viento-scene3d-translation-checkbox-ownership-quality', schemaVersion: 1,
  observedAt: new Date().toISOString(), node: process.version, ok: cases.every(item => item.ok) && sourceSha256 === endSha256 && forbiddenApplyRequests === 0,
  passed: cases.filter(item => item.ok).length, failed: cases.filter(item => !item.ok).length, cases,
  sourceSha256, endSha256, sourceStable: sourceSha256 === endSha256, forbiddenApplyRequests,
  priorFailure: 'ui-late-checkbox-confirmed.json',
  scope: 'Actual controller in event-capable DOM fixture with current native parse/proposal dependencies. Closed/reopened owner and same-session rebuilt rows are explicitly detached by current container membership. No Check/Apply/Save, source mutation or actual browser/device acceptance.' };
await fs.writeFile(new URL('ui-late-checkbox-after-fix.json', out), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify(report) + '\n');
if (!report.ok) process.exitCode = 1;

import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { PROJECT_BUILD_API_PATH } from '../../engine/project-build-contract.mjs';

async function harness({ supported = true, job = null } = {}) {
  const calls = [], preview = { visible: false, scene: '', supported: false }, context = { editable: true };
  let callbacks;
  const h = await dialogHarness('app-project-build', {
    PROJECT_BUILD_API_PATH,
    setupScenePreview: options => { callbacks = options; return {
      setAvailable(value) { preview.supported = value; }, setScene(value) { preview.scene = value; },
      setVisible(value) { preview.visible = value; }, invalidate() {}, destroy() {},
    }; },
    fetchJsonApiRequest: async (url, options) => {
      calls.push({ url, options });
      return { payload: { supported: true, available: false, reason: 'tool_missing', job,
        scenes: [{ id: 'first', title: 'First', sourcePath: 'first.json' }, { id: 'second', title: 'Second', sourcePath: 'second.json' }] } };
    },
  });
  const controller = h.runtime.setupProjectBuild({ getContext: () => context, openSource: () => context.acceptSource });
  controller.setAvailable(true, ['scene.update'], { scenePreview: supported });
  h.element('projectBuildBtn').click(); await flushDialogs();
  return { ...h, controller, preview, calls, context, callbacks };
}

test('preview capability exposes independent tabs without requiring Godot', async () => {
  const h = await harness();
  assert.equal(h.element('projectBuildTabs').hidden, false);
  assert.equal(h.element('projectBuildTaskPanel').hidden, false);
  assert.equal(h.preview.visible, false);
  h.element('projectBuildTabPreview').click();
  assert.equal(h.preview.visible, true); assert.equal(h.preview.scene, 'first');
  assert.equal(h.element('projectBuildTaskPanel').hidden, true);
  assert.equal(h.element('projectBuildTabPreview').getAttribute('aria-selected'), 'true');
  assert.equal(h.element('projectBuildTabBuild').tabIndex, -1);
  h.element('projectBuildScene').value = 'second'; h.element('projectBuildScene').dispatch('change');
  assert.equal(h.preview.scene, 'second');
  h.context.dirty = true;
  assert.equal(h.callbacks.getContext().canEditScene, false);
  assert.equal(h.preview.visible, true, 'saved scene remains viewable with a draft');
  assert.equal(h.calls.every(call => !call.options.method), true, 'tabs never submit build jobs');
  h.controller.setAvailable(true, [], { scenePreview: false });
  assert.equal(h.preview.supported, false); assert.equal(h.preview.visible, false);
  assert.equal(h.element('projectBuildTabs').hidden, true);
  assert.equal(h.element('projectBuildTaskPanel').hidden, false);
});

test('tab keyboard navigation moves focus and uses roving tabindex', async () => {
  const h = await harness();
  h.element('projectBuildTabBuild').dispatch('keydown', { key: 'ArrowLeft' });
  assert.equal(h.document.activeElement.id, 'projectBuildTabPreview'); assert.equal(h.preview.visible, true);
  h.element('projectBuildTabPreview').dispatch('keydown', { key: 'End' });
  assert.equal(h.document.activeElement.id, 'projectBuildTabBuild'); assert.equal(h.preview.visible, false);
  h.element('projectBuildTabBuild').dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(h.document.activeElement.id, 'projectBuildTabPreview');
});

test('preview close and quick reopen preserve running build polling and source navigation choice', async () => {
  const h = await harness({ job: { id: 'job-1', status: 'running', kind: 'run', phase: 'running' } });
  h.element('projectBuildTabPreview').click(); assert.equal(h.preview.visible, true);
  assert.equal(h.callbacks.getContext().canEditScene, false);
  h.context.acceptSource = false;
  await h.callbacks.openSource('first.json'); assert.equal(h.element('projectBuildDialog').open, true);
  h.element('projectBuildClose').click(); h.element('projectBuildBtn').click(); await flushDialogs();
  assert.equal(h.preview.visible, true, 'late close event does not tear down reopened preview');
  h.element('projectBuildClose').click(); await flushDialogs(); assert.equal(h.preview.visible, false);
  assert.equal(h.timers.size, 1, 'background build still polls');
  const [id, tick] = [...h.timers][0]; h.timers.delete(id); tick(); await flushDialogs();
  assert.equal(h.timers.size, 1); assert.equal(h.preview.visible, false);
  assert.equal(h.calls.every(call => !call.options.method), true, 'close never cancels running job');
});

test('older capabilities retain the existing build workflow', async () => {
  const h = await harness({ supported: false });
  assert.equal(h.element('projectBuildTabs').hidden, true);
  h.element('projectBuildTabPreview').click(); assert.equal(h.preview.visible, false);
  assert.equal(h.element('projectBuildTaskPanel').hidden, false);
});

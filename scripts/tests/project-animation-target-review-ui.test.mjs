import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { createProjectAnimationTargetReview, queryProjectAnimationTargetReview, findProjectAnimationTargetReview } from '../../engine/project-animation-target-review.mjs';
import { createProjectRuntimeObservation } from '../../engine/project-runtime-query.mjs';
import { completionProject, completionStart, completionCommand, animationCompleted, completionDelivery } from './helpers/project-animation-completion-fixture.mjs';
import { runtimeId, enterScene, readyScene, exitScene } from './helpers/project-runtime-fixture.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const clone = value => structuredClone(value);
const p11 = frame => ({ ...frame, protocol: 11, ...(['ready', 'finished'].includes(frame.event) ? { animationStateSequence: 0, animationStateEntrySequence: 0 } : {}) });
function observation() {
  const plan = completionProject(), scene = plan.scenes[0], animation = scene.animation;
  animation.schemaVersion = 3; animation.document.schemaVersion = 4; animation.document.playbackScope = 'instance';
  const track = { ...clone(animation.document.tracks[0]), id: runtimeId(901), instanceId: scene.actors[1].instanceId };
  animation.document.tracks.push(track); animation.locations.tracks.push({ id: track.id, declaration: { ...animation.manifest, propertyPath: '/tracks/1' } });
  for (const [index, actor] of [[1, scene.actors[1]], [2, scene.actors[0]]]) {
    const binding = clone(scene.behaviors.bindings[0]); binding.bindingId = runtimeId(910 + index); binding.instanceId = actor.instanceId; binding.objectId = actor.objectId;
    binding.declaration.propertyPath = `/bindings/${index}`; scene.behaviors.bindings.push(binding);
  }
  scene.requiredCapabilities.push('animation.instances2d');
  plan.requiredCapabilities = [...new Set(['project.scenes', ...plan.scenes.flatMap(item => item.requiredCapabilities)])].sort();
  const observer = createProjectRuntimeObservation(plan, { protocolVersion: 11 });
  const push = (...frames) => { for (const frame of frames) assert.equal(observer.push(frame), true, JSON.stringify(frame)); };
  push(...completionStart(plan).map(p11));
  return { plan, scene, push, view: () => observer.snapshot() };
}
const targetFor = (scene, binding) => scene.animation.document.playbackScope === 'instance' ? { kind: 'instance', instanceId: scene.behaviors.bindings[binding].instanceId } : { kind: 'scene' };
function command(scene, sequence, binding, action, { time = 0, phase = 'paused', clipId = null, visit = 1 } = {}) {
  const frame = p11(completionCommand(scene, visit, sequence, action, time, 0, phase, clipId));
  const { bindingId, instanceId, objectId } = scene.behaviors.bindings[binding];
  return { ...frame, bindingId, instanceId, objectId, target: targetFor(scene, binding) };
}
function completed(scene, sequence, cutoff, anchor, { binding = 0, time = 1, clipId = null, tokens = [], visit = 1 } = {}) {
  const frame = p11(animationCompleted(scene, visit, sequence, cutoff, time, clipId, []));
  const { bindingId, instanceId, objectId } = scene.behaviors.bindings[binding];
  return { ...frame, target: targetFor(scene, binding), targetCommandSequence: anchor, recipients: tokens.map(subscriptionId => ({ subscriptionId, bindingId, instanceId, objectId })) };
}
function populated({ deliveries = false } = {}) {
  const f = observation(), clipId = f.scene.animation.document.clips[0].id;
  f.push(command(f.scene, 1, 1, { action: 'select', clipId }, { clipId }), command(f.scene, 2, 1, { action: 'play' }, { clipId, phase: 'playing' }),
    command(f.scene, 3, 0, { action: 'select', clipId }, { clipId }), command(f.scene, 4, 2, { action: 'play' }, { clipId, phase: 'playing' }),
    completed(f.scene, 1, 4, 4, { clipId, time: .4, tokens: deliveries ? [1] : [] }),
    completed(f.scene, 2, 4, 2, { binding: 1, clipId, time: .4, tokens: deliveries ? [2] : [] }));
  return f;
}
async function fixture(t, overrides = {}) {
  let dictionary = {}, languageChanged = () => {}, subscriptions = 0;
  const calls = [], closed = [], context = { available: true, visible: true, sessionOwner: 'run-1', navigationOwner: 'visit-1', canOpenSource: true, canContinueSource: true };
  const h = await dialogHarness('app-project-animation-target-review', { createProjectAnimationTargetReview, queryProjectAnimationTargetReview, findProjectAnimationTargetReview,
    t: (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? ''),
    onLanguageChange(callback) { languageChanged = callback; subscriptions++; return () => { languageChanged = () => {}; subscriptions--; }; },
  });
  const container = h.document.createElement('div'); container.id = 'projectAnimationTargetReviewFixture'; container.isConnected = true; h.document.body.append(container);
  const review = h.runtime.setupProjectAnimationTargetReview({ container, getContext: () => context,
    onOpen: async (source, opts) => { calls.push({ source, ...opts }); return overrides.onOpen ? overrides.onOpen(source, opts) : true; },
    onClose: selection => closed.push(selection) });
  t.after(() => review.dispose());
  return { ...h, container, review, context, calls, closed, el: suffix => container.querySelector('#projectAnimationTargetReview' + suffix),
    rows: kind => container.querySelectorAll('.project-animation-target-review-' + kind), set: value => review.setObservation(value), select: (kind, sequence) => review.selectRecord(kind, sequence),
    language(value) { dictionary = value; languageChanged(); }, subscriptions: () => subscriptions };
}
const sourceButton = (row, role) => row.querySelector('.project-animation-target-review-' + role + '-source');
const jumpButton = row => row.querySelector('.project-animation-target-review-anchor-jump');
const selectGroup = (h, instanceId) => { h.el('Selection').value = h.el('Selection').children.find(option => option.value.includes(instanceId)).value; h.el('Selection').dispatch('change'); };

test('target review remains hidden until explicit selection and only admits full protocol11 observations', async t => {
  const h = await fixture(t), input = populated().view(); assert.equal(h.el('Panel').hidden, true); assert.equal(h.set(input), true); assert.equal(h.el('Panel').hidden, true);
  assert.equal(h.select('command', 3), true); assert.equal(h.el('Panel').hidden, false);
  for (const [kind, sequence] of [['commands', 1], ['command', '1'], ['completion', 999], ['command', 0]]) assert.equal(h.select(kind, sequence), false);
  assert.equal(h.el('Panel').dataset.selectedSequence, '3');
  for (const bad of [{ project: input.project }, { ...input, project: { ...input.project, protocolVersion: 12 } }, null]) {
    assert.equal(h.set(bad), false); assert.equal(h.el('Panel').hidden, true); assert.equal(h.select('command', 3), false);
  }
  for (const protocolVersion of [9, 10]) { const legacy = observation().view(); legacy.project.protocolVersion = protocolVersion; assert.equal(h.set(legacy), false); }
  assert.equal(h.set(observation().view()), true); assert.equal(h.select('command', 1), false);
});

test('explicit targets join bindings on one instance while preserving separate command and completion sequence domains', async t => {
  const h = await fixture(t), f = populated(); h.set(f.view()); h.select('command', 1);
  assert.deepEqual(h.rows('command').map(row => row.dataset.sequence), ['1', '2']); assert.deepEqual(h.rows('completion').map(row => row.dataset.sequence), ['2']);
  assert.equal(h.el('Panel').dataset.targetInstanceId, f.scene.behaviors.bindings[1].instanceId);
  h.select('completion', 1); assert.deepEqual(h.rows('command').map(row => row.dataset.sequence), ['3', '4']); assert.deepEqual(h.rows('completion').map(row => row.dataset.sequence), ['1']);
  assert.equal(h.el('Panel').dataset.targetInstanceId, f.scene.behaviors.bindings[0].instanceId); assert.equal(h.el('Commands').dataset.count, '2');
  assert.equal(h.rows('completion')[0].dataset.selected, 'true'); assert.equal(h.rows('command')[0].dataset.selected, 'false');
  assert.match(h.el('SequenceNote').textContent, /分别使用各自的全局序号/); assert.equal(h.el('Selection').children.length, 2);
  assert.match(h.rows('command')[0].textContent, /选择片段/); assert.match(h.rows('command')[1].textContent, /播放/);
});

test('completion anchor differs from global cutoff and jumps to its own command with keyboard focus', async t => {
  const h = await fixture(t); h.set(populated().view()); h.select('completion', 2); const completion = h.rows('completion')[0];
  assert.equal(completion.dataset.targetCommandSequence, '2'); assert.equal(completion.dataset.commandSequence, '4');
  assert.match(completion.textContent, /目标最后命令序号 2 · 全部命令截止 4/); assert.match(completion.textContent, /目标锚点：已执行命令 2 · 播放/);
  jumpButton(completion).click(); assert.equal(h.el('Panel').dataset.selectedKind, 'command'); assert.equal(h.el('Panel').dataset.selectedSequence, '2');
  const target = h.rows('command')[1]; assert.equal(target.dataset.selected, 'true'); assert.equal(target.getAttribute('aria-current'), 'true'); assert.equal(h.document.activeElement, target);
  h.el('Close').click(); assert.deepEqual(JSON.parse(JSON.stringify(h.closed)), [{ kind: 'completion', sequence: 2 }]);
});

test('target picker clears highlight and stale source and anchor controls cannot act after changing groups', async t => {
  const h = await fixture(t), f = populated(); h.set(f.view()); h.select('completion', 1);
  const oldSource = sourceButton(h.rows('command')[0], 'command'), oldJump = jumpButton(h.rows('completion')[0]);
  selectGroup(h, f.scene.behaviors.bindings[1].instanceId); assert.equal(h.el('Panel').dataset.selectedKind, ''); assert.equal(h.el('Selected').hidden, true);
  assert.equal(h.rows('command').some(row => row.dataset.selected === 'true'), false); oldSource.click(); oldJump.click();
  assert.equal(h.calls.length, 0); assert.equal(h.el('Panel').dataset.targetInstanceId, f.scene.behaviors.bindings[1].instanceId);
  h.el('Close').click(); assert.deepEqual(JSON.parse(JSON.stringify(h.closed)), [{ kind: 'completion', sequence: 1 }]);
});

test('scene autoplay has no synthetic command and hides its zero-anchor jump', async t => {
  const h = await fixture(t), f = observation(), second = f.plan.scenes[1];
  f.push(p11(exitScene(f.scene, 1, 0, second)), p11(enterScene(second, 2)), p11(readyScene(second, 2)), completed(second, 1, 0, 0, { visit: 2 }));
  h.set(f.view()); h.select('completion', 1); assert.equal(h.el('Panel').dataset.targetKind, 'scene'); assert.equal(h.el('Panel').dataset.visitIndex, '2');
  assert.equal(h.rows('command').length, 0); assert.equal(h.el('CommandsEmpty').hidden, false); const completion = h.rows('completion')[0];
  assert.match(completion.textContent, /整场景自动播放完成，没有目标锚点命令/); assert.equal(jumpButton(completion).hidden, true); assert.equal(jumpButton(completion).disabled, true);
  assert.equal(h.calls.length, 0);
});

test('same scene reentry exposes a distinct visit group and retains earlier visit evidence', async t => {
  const h = await fixture(t), f = populated(), second = f.plan.scenes[1];
  f.push(p11(exitScene(f.scene, 1, .4, second)), p11(enterScene(second, 2)), p11(readyScene(second, 2)), p11(exitScene(second, 2, 0, f.scene)),
    p11(enterScene(f.scene, 3)), p11(readyScene(f.scene, 3)), command(f.scene, 5, 0, { action: 'play' }, { visit: 3, phase: 'playing' }));
  h.set(f.view()); h.select('command', 5); assert.equal(h.el('Panel').dataset.visitIndex, '3'); assert.deepEqual(h.rows('command').map(row => row.dataset.sequence), ['5']);
  assert.equal(h.el('CompletionsEmpty').hidden, false); assert.equal(h.el('Selection').children.length, 3);
  h.select('completion', 1); assert.equal(h.el('Panel').dataset.visitIndex, '1'); assert.deepEqual(h.rows('command').map(row => row.dataset.sequence), ['3', '4']);
});

function withSourceRanges(input) {
  const range = source => ({ start: 7, end: 60, encoding: 'utf-16', propertyPath: source.propertyPath, exact: true });
  for (const entry of [...input.project.animationCommands.entries, ...input.project.animationCompletions.entries]) {
    entry.animation.source.sourceRange = range(entry.animation.source); if (entry.clip) entry.clip.source.sourceRange = range(entry.clip.source);
    if (entry.origin) entry.origin.source.sourceRange = range(entry.origin.source);
    for (const delivery of entry.deliveries || []) delivery.origin.source.sourceRange = range(delivery.origin.source);
  }
  return input;
}

test('command declaration clip completion and subscriber buttons preserve exact detached frozen source metadata', async t => {
  const h = await fixture(t), input = withSourceRanges(populated({ deliveries: true }).view()), expected = clone(input);
  assert.equal(h.set(input), true); h.select('command', 3); input.project.animationCommands.entries[2].origin.source.sourcePath = 'changed.json';
  const row = h.rows('command')[0]; for (const role of ['command', 'animation', 'clip']) { sourceButton(row, role).click(); await flushDialogs(); }
  h.select('completion', 1); const completion = h.rows('completion')[0];
  for (const role of ['animation', 'clip', 'subscriber']) { sourceButton(completion, role).click(); await flushDialogs(); }
  const command = expected.project.animationCommands.entries[2], entry = expected.project.animationCompletions.entries[0];
  assert.deepEqual(h.calls.map(call => call.source), [command.origin.source, command.animation.source, command.clip.source, entry.animation.source, entry.clip.source, entry.deliveries[0].origin.source]);
  for (const { source } of h.calls) { assert.equal(Object.isFrozen(source), true); assert.equal(Object.isFrozen(source.sourceRange), true); }
});

test('appended commands completions and unrelated deliveries preserve pending command navigation and DOM focus', async t => {
  const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }), f = populated({ deliveries: true }); h.set(f.view()); h.select('command', 3);
  const row = h.rows('command')[0], button = sourceButton(row, 'command'), option = h.el('Selection').children[0]; button.focus(); button.click();
  sourceButton(h.rows('command')[1], 'command').dispatch('click'); assert.equal(h.calls.length, 1, 'only one source read may be active');
  h.context.canOpenSource = false; h.review.refresh(); assert.equal(h.calls[0].isCurrent(), true);
  f.push(p11(completionDelivery(f.scene, 1, 1)), p11(completionDelivery(f.scene, 1, 2, 2)));
  assert.equal(h.set(f.view()), true); assert.equal(h.calls[0].isCurrent(), true);
  const clipId = f.scene.animation.document.clips[0].id;
  f.push(command(f.scene, 5, 2, { action: 'play' }, { clipId, phase: 'playing', time: .4 }), completed(f.scene, 3, 5, 5, { clipId, time: .8 }));
  assert.equal(h.set(f.view()), true); assert.equal(h.calls[0].isCurrent(), true); assert.equal(h.rows('command')[0], row); assert.equal(sourceButton(row, 'command'), button);
  assert.equal(h.document.activeElement, button); assert.equal(h.el('Selection').children[0], option); assert.equal(h.rows('command').length, 3); assert.equal(h.rows('completion').length, 2);
  gate.resolve(true); await flushDialogs();
});

test('delivery status updates preserve completion and subscriber source tickets and selected completion', async t => {
  for (const role of ['animation', 'subscriber']) {
    const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }), f = populated({ deliveries: true }); h.set(f.view()); h.select('completion', 1);
    const completion = h.rows('completion')[0], button = sourceButton(completion, role); button.focus(); button.click();
    f.push(p11(completionDelivery(f.scene, 1, 1))); assert.equal(h.set(f.view()), true);
    assert.equal(h.el('Panel').dataset.selectedKind, 'completion'); assert.equal(h.calls[0].isCurrent(), true); assert.equal(h.rows('completion')[0], completion); assert.equal(h.document.activeElement, button);
    assert.match(completion.textContent, /已处理（同步回调成功）/); gate.resolve(true); await flushDialogs();
  }
});

test('session visit draft visibility availability continuation detachment closing and group changes revoke pending reads', async t => {
  for (const change of ['session', 'visit', 'draft', 'visible', 'available', 'continue', 'detached', 'close', 'group', 'selection', 'dispose']) {
    const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }), f = populated(); h.set(f.view()); h.select('command', 3); sourceButton(h.rows('command')[0], 'command').click();
    if (change === 'session') h.context.sessionOwner = 'run-2';
    else if (change === 'visit') h.context.navigationOwner = 'visit-2';
    else if (change === 'draft') { h.context.canOpenSource = false; h.context.canContinueSource = false; }
    else if (change === 'visible') h.context.visible = false;
    else if (change === 'available') h.context.available = false;
    else if (change === 'continue') h.context.canContinueSource = false;
    else if (change === 'detached') h.container.isConnected = false;
    else if (change === 'close') h.el('Close').click();
    else if (change === 'group') selectGroup(h, f.scene.behaviors.bindings[1].instanceId);
    else if (change === 'selection') h.select('command', 4);
    else h.review.dispose();
    h.review.refresh(); assert.equal(h.calls[0].isCurrent(), false, change); gate.reject(Error('late')); await flushDialogs();
    if (change !== 'dispose') assert.equal(h.el('Navigation').hidden, true, change);
  }
});

test('selected record removal or replacement and invalid observations close the review and revoke navigation', async t => {
  for (const change of ['remove', 'replace', 'invalid', 'null']) {
    const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }), f = populated(); h.set(f.view()); h.select('command', 4); sourceButton(h.rows('command')[1], 'command').click();
    const input = f.view();
    if (change === 'remove') { input.project.animationCommands.entries.pop(); input.project.animationCommands.sequence--; input.project.animationCompletions = { sequence: 0, entries: [] }; }
    else if (change === 'replace') input.project.animationCommands.entries[3].origin.source.sourcePath = 'documents/replaced.json';
    else if (change === 'invalid') input.project.animationCommands.sequence++;
    h.set(change === 'null' ? null : input); assert.equal(h.el('Panel').hidden, true, change); assert.equal(h.calls[0].isCurrent(), false, change);
    gate.resolve(true); await flushDialogs();
  }
});

test('replacement of an unselected source revokes its ticket without hiding the selected target', async t => {
  const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }), f = populated(); h.set(f.view()); h.select('command', 3);
  const stale = sourceButton(h.rows('command')[1], 'command'); stale.click(); const input = f.view(); input.project.animationCommands.entries[3].origin.source.sourcePath = 'documents/replaced.json';
  assert.equal(h.set(input), true); assert.equal(h.el('Panel').hidden, false); assert.equal(h.calls[0].isCurrent(), false); stale.dispatch('click'); assert.equal(h.calls.length, 1);
  gate.resolve(true); await flushDialogs();
});

test('subscriber source replacement revokes only its pending read while preserving selected completion evidence', async t => {
  const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }), f = populated({ deliveries: true }); h.set(f.view()); h.select('completion', 1);
  const completion = h.rows('completion')[0], oldButton = sourceButton(completion, 'subscriber'); oldButton.click(); const input = f.view();
  input.project.animationCommands.entries[2].origin.source.sourcePath = 'documents/replaced.json';
  input.project.animationCompletions.entries[0].deliveries[0].origin.source.sourcePath = 'documents/replaced.json';
  assert.equal(h.set(input), true); assert.equal(h.el('Panel').hidden, false); assert.equal(h.rows('completion')[0], completion);
  assert.equal(h.el('Panel').dataset.selectedKind, 'completion'); assert.equal(h.calls[0].isCurrent(), false); oldButton.dispatch('click'); assert.equal(h.calls.length, 1);
  assert.notEqual(sourceButton(completion, 'subscriber'), oldButton); gate.resolve(true); await flushDialogs();
});

test('busy guards prevent new source reads and failures retain the selected target with a translated status', async t => {
  const h = await fixture(t, { onOpen: () => false }); h.set(populated().view()); h.select('command', 3);
  h.context.canOpenSource = false; sourceButton(h.rows('command')[0], 'command').dispatch('click'); assert.equal(h.calls.length, 0);
  h.context.canOpenSource = true; sourceButton(h.rows('command')[0], 'command').click(); await flushDialogs();
  assert.match(h.el('Navigation').textContent, /无法打开动画目标回看来源/); assert.equal(h.el('Panel').hidden, false);
  h.language(en); assert.equal(h.el('Navigation').textContent, en['无法打开动画目标回看来源，请返回编辑器查找该文档。']);
});

test('three-language changes preserve literal authored data selection source controls and focus', async t => {
  const h = await fixture(t), input = populated().view();
  for (const entry of [...input.project.animationCommands.entries, ...input.project.animationCompletions.entries]) { entry.clip.name = '<img src=x> 待機'; entry.animation.source.sourcePath = 'documents/待機 <img src=x>.json'; entry.clip.source.sourcePath = entry.animation.source.sourcePath; }
  h.set(input); h.select('completion', 1); const picker = h.el('Selection'), option = picker.children[0], row = h.rows('command')[0], button = sourceButton(row, 'clip'); picker.focus();
  for (const dictionary of [en, ja, {}]) {
    h.language(dictionary); assert.equal(h.el('Title').textContent, dictionary['动画目标回看'] || '动画目标回看'); assert.equal(h.el('Panel').dataset.selectedKind, 'completion');
    assert.equal(h.el('Selection'), picker); assert.equal(picker.children[0], option); assert.equal(h.rows('command')[0], row); assert.equal(sourceButton(row, 'clip'), button); assert.equal(h.document.activeElement, picker);
    assert.match(row.textContent, /<img src=x> 待機/); assert.equal(h.container.querySelector('img'), null);
  }
});

test('accessor admission has no side effects and presentation owns no runtime editing or foreign DOM access', async t => {
  const h = await fixture(t), input = populated().view(); let calls = 0; Object.defineProperty(input, 'project', { enumerable: true, get() { calls++; return {}; } });
  assert.equal(h.set(input), false); assert.equal(calls, 0);
  const source = await fs.readFile(new URL('../../web/modules/app-project-animation-target-review.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(|requestWorldCommand|app-state|requestAnimationFrame|setInterval|setTimeout|\.play_animation\(|\.seek_animation\(|document\.(?:querySelector|getElementById)/);
  const keys = new Set([...source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)].map(match => match[1]));
  for (const key of keys) { assert.ok(en[key], 'English: ' + key); assert.ok(ja[key], 'Japanese: ' + key); }
  const css = await fs.readFile(new URL('../../web/project-animation-target-review.css', import.meta.url), 'utf8'); assert.match(css, /@media \(max-width: 600px\)/); assert.match(css, /overflow-wrap: anywhere/); assert.match(css, /flex-direction: column/);
  h.review.dispose(); h.review.dispose(); assert.equal(h.subscriptions(), 0); assert.equal(h.container.children.length, 0); assert.equal(h.select('command', 1), false); assert.equal(h.set(populated().view()), false);
});

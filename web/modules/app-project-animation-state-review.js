import { describeProjectAnimationStateEntryTrigger } from './app-project-animation-state-trigger.js';
import { createProjectAnimationStateReview, queryProjectAnimationStateReview } from '../../engine/project-animation-state-review.mjs';
import { t, onLanguageChange } from '../i18n/index.js';

// Browsing captured evidence never controls the runtime or edits author files.
export function setupProjectAnimationStateReview({ container, getContext = () => ({}), onOpen = async () => false, onClose = () => {} } = {}) {
  if (!container) return Object.freeze({ setSnapshot() {}, selectEntry() { return false; }, refresh() {}, dispose() {} });
  const document = container.ownerDocument;
  container.innerHTML = `<section id="projectAnimationStateReviewPanel" class="project-animation-state-review" hidden aria-labelledby="projectAnimationStateReviewTitle">
    <div class="project-animation-state-review-heading"><h3 id="projectAnimationStateReviewTitle"></h3><button id="projectAnimationStateReviewClose" type="button" class="doc-btn doc-btn-ghost"></button></div>
    <p id="projectAnimationStateReviewNote" class="build-hint"></p><p id="projectAnimationStateReviewScope"></p>
    <label id="projectAnimationStateReviewSelectionLabel" for="projectAnimationStateReviewSelection"></label>
    <div class="project-animation-state-review-controls"><button id="projectAnimationStateReviewPrevious" type="button" class="doc-btn"></button><select id="projectAnimationStateReviewSelection"></select><button id="projectAnimationStateReviewNext" type="button" class="doc-btn"></button></div>
    <p id="projectAnimationStateReviewPosition" role="status" aria-live="polite"></p>
    <div id="projectAnimationStateReviewEntry"><h4 id="projectAnimationStateReviewState"></h4><p id="projectAnimationStateReviewTrigger"></p><p id="projectAnimationStateReviewTriggerDetail"></p><p id="projectAnimationStateReviewTriggerPayload"></p><p id="projectAnimationStateReviewTriggerDelivery"></p><p id="projectAnimationStateReviewTriggerNote" class="build-hint"></p><p id="projectAnimationStateReviewTime"></p><p id="projectAnimationStateReviewCutoff"></p><p id="projectAnimationStateReviewClip"></p><p id="projectAnimationStateReviewBinding"></p><p id="projectAnimationStateReviewScript"></p></div>
    <div class="project-animation-state-review-sources"><button id="projectAnimationStateReviewBindingSource" type="button" class="doc-btn doc-btn-ghost project-animation-state-review-binding-source"></button><button id="projectAnimationStateReviewScriptSource" type="button" class="doc-btn doc-btn-ghost project-animation-state-review-script-source"></button></div>
    <h4 id="projectAnimationStateReviewCommandsTitle"></h4><p id="projectAnimationStateReviewCommandsNote" class="build-hint"></p><p id="projectAnimationStateReviewCommandsEmpty" class="build-hint"></p><ol id="projectAnimationStateReviewCommands"></ol>
    <h4 id="projectAnimationStateReviewTerminalTitle"></h4><p id="projectAnimationStateReviewTerminalEmpty" class="build-hint"></p><div id="projectAnimationStateReviewTerminal" class="project-animation-state-review-terminal"><p id="projectAnimationStateReviewTerminalBoundary"></p><p id="projectAnimationStateReviewTerminalState"></p><p id="projectAnimationStateReviewTerminalClip"></p></div>
    <p id="projectAnimationStateReviewNavigation" role="status" aria-live="polite" hidden></p></section>`;
  const el = suffix => container.querySelector('#projectAnimationStateReview' + suffix), selection = el('Selection');
  const commandRows = new Map(), options = new Map();
  let disposed = false, model = null, selectedSequence = null, selectedSignature = '', view = null;
  let sessionOwner = '', navigationOwner = '', wasVisible = false, generation = 0, opening = null, navigationMessage = '';
  const context = () => { try { return getContext() || {}; } catch { return {}; } };
  const canUse = current => !disposed && current.available === true && current.visible === true
    && typeof current.sessionOwner === 'string' && Boolean(current.sessionOwner)
    && typeof current.navigationOwner === 'string' && Boolean(current.navigationOwner) && container.isConnected !== false;
  const invalidate = () => { generation++; opening = null; navigationMessage = ''; };
  const clearSelection = () => { invalidate(); selectedSequence = null; selectedSignature = ''; view = null; options.clear(); commandRows.clear(); selection.replaceChildren(); el('Commands').replaceChildren(); };
  const clear = () => { clearSelection(); model = null; };
  function updateContext() {
    const current = context();
    if (current.sessionOwner !== sessionOwner) { clear(); sessionOwner = current.sessionOwner || ''; }
    if (current.navigationOwner !== navigationOwner) { invalidate(); navigationOwner = current.navigationOwner || ''; }
    if (wasVisible && !canUse(current)) invalidate();
    wasVisible = canUse(current); return current;
  }
  const text = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  const node = (tag, className = '') => { const result = document.createElement(tag); result.className = className; return result; };
  const appendStable = (parent, next) => {
    const previous = [...parent.children];
    if (previous.length <= next.length && previous.every((item, index) => item === next[index])) parent.append(...next.slice(previous.length));
    else parent.replaceChildren(...next);
  };
  function render() {
    if (disposed) return;
    const current = updateContext();
    el('Panel').hidden = !canUse(current) || !view;
    text(el('Title'), t('控制器状态回看')); text(el('Close'), t('关闭回看'));
    text(el('Note'), t('仅回看此控制器本次场景访问的完整进入顺序，不受记录列表筛选影响；这里不会跳转运行时间或改变播放。'));
    text(el('SelectionLabel'), t('选择进入记录')); text(el('Previous'), t('上一条进入记录')); text(el('Next'), t('下一条进入记录'));
    text(el('CommandsTitle'), t('该记录之后的同绑定已执行命令'));
    text(el('CommandsNote'), t('按进入时的已执行命令序号截取同一次访问、同一绑定的后续记录。多次进入可以共享这些结果；它们不一定由所选进入触发。'));
    text(el('TerminalTitle'), t('此控制器本次访问的终止快照'));
    text(el('BindingSource'), t('打开行为绑定')); text(el('ScriptSource'), t('打开状态脚本'));
    text(el('Navigation'), opening ? t('正在打开控制器回看来源…') : navigationMessage ? t(navigationMessage) : '');
    el('Navigation').hidden = !opening && !navigationMessage;
    if (!view) { delete el('Panel').dataset.sequence; delete el('Panel').dataset.visitIndex; delete el('Panel').dataset.bindingId; delete el('Entry').dataset.sequence; el('Commands').dataset.count = '0'; return; }
    const entry = view.entry;
    el('Panel').dataset.sequence = String(entry.sequence); el('Panel').dataset.visitIndex = String(entry.origin.visitIndex); el('Panel').dataset.bindingId = entry.origin.bindingId;
    el('Entry').dataset.sequence = String(entry.sequence);
    text(el('Scope'), t('第 {0} 次访问 · 场景 {1} · 行为绑定 {2}', entry.origin.visitIndex, entry.origin.sceneId, entry.origin.bindingId));
    const nextOptions = [];
    for (const item of view.entries) {
      let option = options.get(item.sequence);
      if (!option) { option = node('option'); option.value = String(item.sequence); options.set(item.sequence, option); }
      text(option, t('记录 {0} · {1} · {2} 秒', item.sequence, item.stateKey, item.timeSeconds)); nextOptions.push(option);
    }
    for (const sequence of options.keys()) if (!view.entries.some(item => item.sequence === sequence)) options.delete(sequence);
    appendStable(selection, nextOptions); selection.value = String(entry.sequence);
    selection.disabled = !canUse(current); el('Previous').disabled = !canUse(current) || view.previousSequence === null; el('Next').disabled = !canUse(current) || view.nextSequence === null;
    text(el('Position'), t('本次访问的第 {0} / {1} 条进入记录 · 全局序号 {2}', view.position, view.entries.length, entry.sequence));
    text(el('State'), t('脚本接受进入状态：{0}', entry.stateKey));
    text(el('Trigger'), describeProjectAnimationStateEntryTrigger(entry, t));
    el('Trigger').dataset.kind = entry.trigger?.kind || 'unrecorded';
    const evidence = view.triggerEvidence;
    text(el('TriggerDetail'), evidence?.kind === 'event' ? t('关联事件：{0}', evidence.event.name)
      : evidence?.kind === 'completed' ? evidence.completion.clip
        ? t('完成片段：{0} · {1}', evidence.completion.clip.name, evidence.completion.clip.id) : t('完成对象：完整动画') : '');
    text(el('TriggerPayload'), evidence?.kind === 'event' ? t('事件值：{0}', JSON.stringify(evidence.event.value)) : '');
    text(el('TriggerDelivery'), evidence ? t(evidence.delivery.status === 'pending'
      ? '进入已记录；此订阅的回调结果尚未确认。' : '此订阅的同步回调已成功返回；后续动画命令仍需查看执行记录。') : '');
    text(el('TriggerNote'), entry.trigger ? t('来源记录说明进入发生在哪个回调中；不包含分支命中或条件求值过程。') : '');
    for (const suffix of ['TriggerDetail', 'TriggerPayload', 'TriggerDelivery', 'TriggerNote']) el(suffix).hidden = !el(suffix).textContent;
    if (evidence) el('TriggerDelivery').dataset.status = evidence.delivery.status; else delete el('TriggerDelivery').dataset.status;
    text(el('Time'), t('场景时间：{0} 秒', entry.timeSeconds)); text(el('Cutoff'), t('进入时已执行动画命令序号：{0}', entry.commandSequence));
    text(el('Clip'), entry.clipId ? t('状态选择的片段：{0}', entry.clipId) : t('状态选择：完整动画'));
    text(el('Binding'), t('绑定来源：{0} · {1}', entry.origin.source.sourcePath, entry.origin.source.propertyPath));
    text(el('Script'), t('脚本来源：{0}', entry.scriptSource.sourcePath));
    for (const suffix of ['BindingSource', 'ScriptSource']) el(suffix).disabled = !canUse(current) || current.canOpenSource !== true || Boolean(opening);
    const commands = [];
    for (const command of view.followingCommands) {
      const signature = JSON.stringify(command); let row = commandRows.get(command.sequence);
      if (!row || row.signature !== signature) {
        const item = node('li', 'project-animation-state-review-command'); item.dataset.sequence = String(command.sequence);
        row = { signature, item, summary: node('p'), clip: node('p'), state: node('p') }; item.append(row.summary, row.clip, row.state); commandRows.set(command.sequence, row);
      }
      const action = t({ select: '选择片段', play: '播放', pause: '暂停', stop: '停止', seek: '跳转' }[command.command.action]);
      text(row.summary, t('已执行命令 {0} · {1} · 场景时间 {2} 秒', command.sequence, action, command.state.timeSeconds));
      text(row.clip, command.clip ? t('命令片段：{0} · {1}', command.clip.name, command.clip.id) : t('命令选择：完整动画'));
      text(row.state, t('执行后状态：{0} · 播放位置 {1} 秒', t({ playing: '播放', paused: '暂停', stopped: '停止', finished: '结束' }[command.state.phase]), command.state.positionSeconds));
      commands.push(row.item);
    }
    for (const sequence of commandRows.keys()) if (!view.followingCommands.some(command => command.sequence === sequence)) commandRows.delete(sequence);
    appendStable(el('Commands'), commands); el('Commands').dataset.count = String(commands.length);
    el('CommandsEmpty').hidden = commands.length > 0; text(el('CommandsEmpty'), t('尚未采集该记录之后的同绑定已执行命令。'));
    const terminal = view.terminal; el('Terminal').hidden = !terminal; el('TerminalEmpty').hidden = Boolean(terminal);
    text(el('TerminalEmpty'), t('尚未采集此控制器本次访问的终止快照。'));
    if (terminal) {
      el('Terminal').dataset.status = terminal.controller.status;
      text(el('TerminalBoundary'), t('终止快照：{0} · 场景时间 {1} 秒 · 已执行动画命令序号 {2}',
        t({ switch: '场景切换前快照', finished: '运行结束前快照', aborted: '运行中止前快照' }[terminal.reason]), terminal.timeSeconds, terminal.commandSequence));
      text(el('TerminalState'), terminal.controller.status === 'active' ? t('脚本已接受状态：{0}', terminal.controller.stateKey)
        : t(terminal.controller.status === 'inactive' ? '当前没有已接受状态' : '未采集已接受状态'));
      el('TerminalClip').hidden = terminal.controller.status !== 'active';
      text(el('TerminalClip'), terminal.controller.status === 'active' ? terminal.controller.clipId ? t('状态选择的片段：{0}', terminal.controller.clipId) : t('状态选择：完整动画') : '');
    } else { delete el('Terminal').dataset.status; text(el('TerminalBoundary'), ''); text(el('TerminalState'), ''); text(el('TerminalClip'), ''); }
    if (opening && !opening.isCurrent()) { invalidate(); render(); }
  }
  function selectEntry(sequence, focus = true) {
    const current = updateContext();
    if (!canUse(current) || !model) return false;
    let next; try { next = queryProjectAnimationStateReview(model, sequence); } catch { return false; }
    if (!next) return false;
    if (selectedSequence !== sequence || selectedSignature !== JSON.stringify(next.entry)) invalidate();
    selectedSequence = sequence; selectedSignature = JSON.stringify(next.entry); view = next; render();
    if (focus) selection.focus(); return true;
  }
  const selectChanged = () => {
    if (!selectEntry(Number(selection.value), false)) { clearSelection(); render(); }
  };
  const step = direction => {
    const current = updateContext();
    if (!canUse(current) || !view) return;
    const target = direction === 'Previous' ? view.previousSequence : view.nextSequence;
    if (target === null) return;
    const focused = document.activeElement === el(direction);
    if (selectEntry(target, false) && el(direction).disabled && focused) selection.focus();
  };
  const previous = () => step('Previous'), next = () => step('Next');
  const close = () => { if (!canUse(updateContext()) || !view) return; const sequence = selectedSequence; clearSelection(); render(); onClose(sequence); };
  async function openSource(role) {
    const current = updateContext();
    if (!canUse(current) || current.canOpenSource !== true || opening || !view) return;
    const ticket = { generation, sessionOwner, navigationOwner, sequence: selectedSequence, signature: selectedSignature };
    const isCurrent = () => {
      const latest = context();
      return canUse(latest) && latest.canContinueSource === true && latest.sessionOwner === ticket.sessionOwner && latest.navigationOwner === ticket.navigationOwner
        && generation === ticket.generation && opening === ticket && selectedSequence === ticket.sequence && selectedSignature === ticket.signature && Boolean(view);
    };
    const source = role === 'binding' ? view.entry.origin.source : view.entry.scriptSource;
    ticket.isCurrent = isCurrent; opening = ticket; navigationMessage = ''; render();
    try { if (await onOpen(source, { isCurrent }) === false && isCurrent()) navigationMessage = '无法打开控制器回看来源，请返回编辑器查找该文档。'; }
    catch { if (isCurrent()) navigationMessage = '无法打开控制器回看来源，请返回编辑器查找该文档。'; }
    finally { if (opening === ticket) { opening = null; render(); } }
  }
  const bindingSource = () => void openSource('binding'), scriptSource = () => void openSource('script');
  selection.addEventListener('change', selectChanged); el('Previous').addEventListener('click', previous); el('Next').addEventListener('click', next); el('Close').addEventListener('click', close);
  el('BindingSource').addEventListener('click', bindingSource); el('ScriptSource').addEventListener('click', scriptSource);
  const unsubscribe = onLanguageChange(render); render();
  return Object.freeze({
    setSnapshot(value) {
      if (disposed) return false;
      updateContext();
      try { model = value == null ? null : createProjectAnimationStateReview(value); }
      catch { clear(); render(); return false; }
      if (!model) clearSelection();
      else if (selectedSequence !== null) {
        const next = queryProjectAnimationStateReview(model, selectedSequence);
        if (!next || JSON.stringify(next.entry) !== selectedSignature) clearSelection(); else view = next;
      }
      render(); return Boolean(model);
    },
    selectEntry,
    refresh: render,
    dispose() {
      if (disposed) return;
      clear(); disposed = true; selection.removeEventListener('change', selectChanged); el('Previous').removeEventListener('click', previous); el('Next').removeEventListener('click', next); el('Close').removeEventListener('click', close);
      el('BindingSource').removeEventListener('click', bindingSource); el('ScriptSource').removeEventListener('click', scriptSource);
      if (typeof unsubscribe === 'function') unsubscribe(); container.replaceChildren();
    },
  });
}

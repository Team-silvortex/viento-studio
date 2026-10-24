import { validateProjectAnimationStatesSnapshot } from '../../engine/project-animation-states.mjs';
import { t, onLanguageChange } from '../i18n/index.js';

// A snapshot describes the accepted state in a generated script at a visit
// boundary. This view owns neither execution nor authoring authority.
export function setupProjectAnimationStateObservation({ container, getContext = () => ({}), onOpen = async () => false } = {}) {
  if (!container) return Object.freeze({ setSnapshot() {}, refresh() {}, dispose() {} });
  const document = container.ownerDocument;
  container.innerHTML = `<section id="projectAnimationStatesPanel" class="project-animation-state-observation" hidden aria-labelledby="projectAnimationStatesTitle">
    <h3 id="projectAnimationStatesTitle"></h3><p id="projectAnimationStatesNote" class="build-hint"></p>
    <p id="projectAnimationStatesSequence" role="status" aria-live="polite"></p>
    <label for="projectAnimationStatesSearch" id="projectAnimationStatesSearchLabel"></label>
    <input id="projectAnimationStatesSearch" type="search" maxlength="256" autocomplete="off" spellcheck="false">
    <p id="projectAnimationStatesEmpty" class="build-hint"></p><ol id="projectAnimationStatesEntries"></ol>
    <p id="projectAnimationStatesNavigation" role="status" aria-live="polite" hidden></p></section>`;
  const el = suffix => container.querySelector('#projectAnimationStates' + suffix);
  const search = el('Search'), list = el('Entries'), records = new Map();
  let disposed = false, snapshot = null, signature = '', sessionOwner = '', navigationOwner = '', wasVisible = false;
  let opening = null, generation = 0, navigationMessage = '';
  const context = () => { try { return getContext() || {}; } catch { return {}; } };
  const canUse = current => !disposed && current.available === true && current.visible === true
    && typeof current.sessionOwner === 'string' && Boolean(current.sessionOwner)
    && typeof current.navigationOwner === 'string' && Boolean(current.navigationOwner) && container.isConnected !== false;
  const invalidate = () => { generation++; opening = null; navigationMessage = ''; };
  const clear = () => { invalidate(); snapshot = null; signature = ''; search.value = ''; records.clear(); list.replaceChildren(); };
  function updateContext() {
    const current = context();
    if (current.sessionOwner !== sessionOwner) { clear(); sessionOwner = current.sessionOwner || ''; }
    if (current.navigationOwner !== navigationOwner) { invalidate(); navigationOwner = current.navigationOwner || ''; }
    if (wasVisible && !canUse(current)) invalidate();
    wasVisible = canUse(current);
    return current;
  }
  const node = (tag, text = '', className = '') => { const result = document.createElement(tag); result.textContent = text; result.className = className; return result; };
  const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };
  function children(parent, next) {
    const previous = [...parent.children];
    if (previous.length <= next.length && previous.every((item, index) => item === next[index])) parent.append(...next.slice(previous.length));
    else parent.replaceChildren(...next);
  }
  function sourceButton(source, role, owns) {
    const button = node('button', '', 'doc-btn doc-btn-ghost project-animation-state-' + role + '-source'); button.type = 'button';
    button.addEventListener('click', async () => {
      const current = updateContext();
      if (!canUse(current) || current.canOpenSource !== true || opening || !snapshot || !owns()) return;
      const ticket = { generation, sessionOwner, navigationOwner };
      const isCurrent = () => {
        const latest = context();
        return canUse(latest) && latest.sessionOwner === ticket.sessionOwner && latest.navigationOwner === ticket.navigationOwner
          && generation === ticket.generation && opening === ticket && Boolean(snapshot) && owns();
      };
      ticket.isCurrent = isCurrent; opening = ticket; navigationMessage = ''; render();
      try {
        const result = await onOpen(source, { isCurrent });
        if (isCurrent() && result === false) navigationMessage = '无法打开动画状态来源，请返回编辑器查找该文档。';
      } catch { if (isCurrent()) navigationMessage = '无法打开动画状态来源，请返回编辑器查找该文档。'; }
      finally { if (opening === ticket) { opening = null; render(); } }
    });
    return button;
  }
  const entrySignature = entry => JSON.stringify([entry.sequence, entry.visitIndex, entry.sceneId, entry.timeSeconds, entry.commandSequence, entry.reason]);
  function createRecord(entry) {
    const item = node('li', '', 'project-animation-state-snapshot');
    item.dataset.sequence = String(entry.sequence); item.dataset.visitIndex = String(entry.visitIndex);
    const heading = node('h4'), sequence = node('p', '', 'project-animation-state-sequence');
    const command = node('p', '', 'project-animation-state-command');
    const controllers = node('ul', '', 'project-animation-state-controllers');
    const record = { signature: entrySignature(entry), item, heading, sequence, command, controllers, members: new Map() };
    item.append(heading, sequence, command, controllers); return record;
  }
  function createController(record, entry, controller) {
    const item = node('li', '', 'project-animation-state-controller');
    item.dataset.bindingId = controller.origin.bindingId; item.dataset.status = controller.status;
    const state = node('p', '', 'project-animation-state-accepted'), clip = node('p', '', 'project-animation-state-clip');
    const status = node('p', '', 'project-animation-state-status'), identity = node('p', '', 'project-animation-state-identity');
    const binding = node('p', '', 'project-animation-state-origin'), script = node('p', '', 'project-animation-state-origin');
    const member = { signature: JSON.stringify(controller), item, state, clip, status, identity, binding, script };
    const owns = () => records.get(entry.sequence) === record && record.members.get(controller.origin.bindingId) === member
      && !record.item.hidden && !item.hidden;
    member.bindingSource = sourceButton(controller.origin.source, 'binding', owns);
    member.scriptSource = sourceButton(controller.scriptSource, 'script', owns);
    const actions = node('div', '', 'project-animation-state-sources'); actions.append(member.bindingSource, member.scriptSource);
    item.append(state, clip, status, identity, binding, script, actions); return member;
  }
  function render() {
    if (disposed) return;
    const current = updateContext();
    el('Panel').hidden = !canUse(current) || !snapshot;
    setText(el('Title'), t('动画状态快照'));
    setText(el('Note'), t('在切换场景或运行结束前采集脚本状态；强制取消可能没有记录。这里只显示脚本已接受状态，不表示动画命令已经执行，也不重建中间转换。'));
    setText(el('SearchLabel'), t('按场景、行为绑定、脚本或状态筛选'));
    setText(el('Navigation'), opening ? t('正在打开动画状态来源…') : navigationMessage ? t(navigationMessage) : '');
    el('Navigation').hidden = !opening && !navigationMessage;
    search.disabled = !canUse(current) || !snapshot;
    if (!snapshot) { setText(el('Sequence'), ''); delete el('Sequence').dataset.sequence; setText(el('Empty'), ''); return; }
    const query = search.value.trim().toLowerCase(), next = [];
    let total = 0, shown = 0, shownEntries = 0;
    for (const entry of snapshot.entries) {
      let record = records.get(entry.sequence);
      if (!record || record.signature !== entrySignature(entry)) { record = createRecord(entry); records.set(entry.sequence, record); }
      const sceneMatches = entry.sceneId.toLowerCase().includes(query);
      const visible = new Set(entry.controllers.filter(controller => sceneMatches || [controller.origin.bindingId,
        controller.scriptSource.objectId, controller.scriptSource.sourcePath, controller.stateKey || ''].some(value => value.toLowerCase().includes(query)))
        .map(controller => controller.origin.bindingId));
      record.item.hidden = !sceneMatches && visible.size === 0;
      if (!record.item.hidden) shownEntries++;
      shown += visible.size; total += entry.controllers.length;
      setText(record.heading, t({ switch: '场景切换前快照', finished: '运行结束前快照', aborted: '运行中止前快照' }[entry.reason]));
      setText(record.sequence, t('快照 {0} · 第 {1} 次访问 · 场景 {2} · 场景时间 {3} 秒', entry.sequence, entry.visitIndex, entry.sceneId, entry.timeSeconds));
      setText(record.command, t('截至已执行动画命令序号：{0}', entry.commandSequence));
      const members = [];
      for (const controller of entry.controllers) {
        const key = controller.origin.bindingId;
        let member = record.members.get(key);
        if (!member || member.signature !== JSON.stringify(controller)) { member = createController(record, entry, controller); record.members.set(key, member); }
        member.item.hidden = !visible.has(key);
        setText(member.state, controller.status === 'active' ? t('脚本已接受状态：{0}', controller.stateKey) : t(controller.status === 'unavailable' ? '未采集已接受状态' : '当前没有已接受状态'));
        setText(member.clip, controller.status === 'active' ? controller.clipId ? t('状态选择的片段：{0}', controller.clipId) : t('状态选择：完整动画') : '');
        member.clip.hidden = controller.status !== 'active';
        setText(member.status, t({ active: '控制器已激活', inactive: '控制器未激活', unavailable: '未读取到脚本状态' }[controller.status]));
        setText(member.identity, t('行为绑定 {0} · 实例 {1} · 对象 {2}', key, controller.origin.instanceId, controller.origin.objectId));
        setText(member.binding, t('绑定来源：{0} · {1}', controller.origin.source.sourcePath, controller.origin.source.propertyPath));
        setText(member.script, t('脚本来源：{0}', controller.scriptSource.sourcePath));
        setText(member.bindingSource, t('打开行为绑定')); setText(member.scriptSource, t('打开状态脚本'));
        for (const button of [member.bindingSource, member.scriptSource]) button.disabled = !canUse(current) || current.canOpenSource !== true || Boolean(opening);
        members.push(member.item);
      }
      for (const key of record.members.keys()) if (!entry.controllers.some(controller => controller.origin.bindingId === key)) record.members.delete(key);
      children(record.controllers, members); next.push(record.item);
    }
    for (const sequence of records.keys()) if (!snapshot.entries.some(entry => entry.sequence === sequence)) records.delete(sequence);
    children(list, next);
    setText(el('Sequence'), t('快照序号 {0} · 显示 {1} / {2} 个控制器', snapshot.sequence, shown, total));
    el('Sequence').dataset.sequence = String(snapshot.sequence);
    el('Empty').hidden = shownEntries > 0;
    setText(el('Empty'), t(snapshot.entries.length ? '没有匹配的动画状态快照。' : '尚未采集动画状态快照。'));
    if (opening && !opening.isCurrent()) { invalidate(); render(); }
  }
  const changed = () => { invalidate(); render(); };
  search.addEventListener('input', changed);
  const unsubscribe = onLanguageChange(render);
  render();
  return Object.freeze({
    setSnapshot(value, { protocolVersion = 8 } = {}) {
      if (disposed) return;
      updateContext();
      let admitted;
      try {
        if (![8, 9, 10].includes(protocolVersion)) throw new TypeError('Unsupported animation state observation.');
        admitted = value == null ? null : validateProjectAnimationStatesSnapshot(value);
      } catch { clear(); render(); return; }
      const next = admitted == null ? '' : JSON.stringify(admitted);
      if (next !== signature) {
        signature = next; snapshot = next ? JSON.parse(next) : null;
        if (!snapshot) { invalidate(); records.clear(); list.replaceChildren(); }
      }
      render();
    },
    refresh: render,
    dispose() {
      if (disposed) return;
      disposed = true; clear(); search.removeEventListener('input', changed);
      if (typeof unsubscribe === 'function') unsubscribe();
      container.replaceChildren();
    },
  });
}

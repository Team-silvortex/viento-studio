import { validateProjectPhysics2DObservation } from '../../engine/project-physics2d-trace.mjs';
import { t, onLanguageChange } from '../i18n/index.js';

// A read-only view of admitted native sweeps. It never updates runtime actors,
// evaluates geometry, or turns a missing sample into a contact-state claim.
export function setupProjectPhysicsObservation({ container, getContext = () => ({}), onOpen = async () => false } = {}) {
  if (!container) return Object.freeze({ setSnapshot() {}, refresh() {}, dispose() {} });
  const document = container.ownerDocument;
  container.innerHTML = `<section id="projectPhysicsObservationPanel" class="project-physics-observation" hidden aria-labelledby="projectPhysicsObservationTitle">
    <h3 id="projectPhysicsObservationTitle"></h3><p id="projectPhysicsObservationNote" class="build-hint"></p>
    <p id="projectPhysicsObservationStatus" role="status" aria-live="polite"></p>
    <div class="project-physics-filters">
      <label><span id="projectPhysicsObservationInstanceLabel"></span><select id="projectPhysicsObservationInstance"></select></label>
      <label><span id="projectPhysicsObservationStepLabel"></span><select id="projectPhysicsObservationStep"></select></label>
      <label><span id="projectPhysicsObservationSampleLabel"></span><select id="projectPhysicsObservationSample"></select></label>
    </div><div class="project-physics-actions"><button id="projectPhysicsObservationPrevious" type="button" class="doc-btn doc-btn-ghost"></button><button id="projectPhysicsObservationNext" type="button" class="doc-btn doc-btn-ghost"></button></div>
    <p id="projectPhysicsObservationEmpty" class="build-hint"></p>
    <article id="projectPhysicsObservationDetail" hidden>
      <h4 id="projectPhysicsObservationHeading"></h4><p id="projectPhysicsObservationIdentity" class="build-hint"></p>
      <dl id="projectPhysicsObservationMotion" class="project-physics-values"></dl>
      <p id="projectPhysicsObservationSource" class="build-hint"></p><button id="projectPhysicsObservationOpen" type="button" class="doc-btn doc-btn-ghost"></button>
      <h4 id="projectPhysicsObservationContactsTitle"></h4><p id="projectPhysicsObservationNoContacts" class="build-hint"></p><ol id="projectPhysicsObservationContacts"></ol>
    </article><p id="projectPhysicsObservationNavigation" role="status" aria-live="polite" hidden></p>
  </section>`;
  const el = suffix => container.querySelector('#projectPhysicsObservation' + suffix);
  let disposed = false, snapshot = null, signature = '', sessionOwner = '', navigationOwner = '', wasVisible = false;
  let instance = '', step = '', sequence = '', selectedSignature = '', current = null, generation = 0, opening = null, navigationMessage = '';
  const options = new Map(), contacts = [];
  const context = () => { try { return getContext() || {}; } catch { return {}; } };
  const canUse = state => !disposed && state.available === true && state.visible === true && container.isConnected !== false
    && typeof state.sessionOwner === 'string' && Boolean(state.sessionOwner) && typeof state.navigationOwner === 'string' && Boolean(state.navigationOwner);
  const invalidate = () => { generation++; opening = null; navigationMessage = ''; };
  const node = (tag, text = '', className = '') => { const item = document.createElement(tag); item.textContent = text; item.className = className; return item; };
  const text = (suffix, value) => { const item = el(suffix); if (item.textContent !== value) item.textContent = value; };
  const stepKey = sample => `${sample.visitIndex}:${sample.sceneId}:${sample.stepIndex}`;
  const numberText = value => String(Number(value.toPrecision(8)));
  const vector = value => `[${value.map(numberText).join(', ')}]`;
  function clear() {
    invalidate(); snapshot = null; signature = ''; instance = ''; step = ''; sequence = ''; selectedSignature = ''; current = null;
    options.clear(); contacts.length = 0; el('Contacts').replaceChildren(); el('Motion').replaceChildren();
  }
  function updateContext() {
    const state = context();
    if (state.sessionOwner !== sessionOwner) { clear(); sessionOwner = state.sessionOwner || ''; }
    if (state.navigationOwner !== navigationOwner) { invalidate(); navigationOwner = state.navigationOwner || ''; }
    if (wasVisible && !canUse(state)) invalidate();
    wasVisible = canUse(state); return state;
  }
  function picker(suffix, entries, value) {
    const control = el(suffix), next = JSON.stringify(entries);
    if (options.get(suffix) !== next) {
      const children = entries.map(([id, label]) => { const item = node('option', label); item.value = id; return item; });
      control.replaceChildren(...children); options.set(suffix, next);
    }
    if (control.value !== value) control.value = value;
  }
  async function openSource(source, owns) {
    const state = updateContext();
    if (!canUse(state) || state.canOpenSource !== true || opening || !snapshot || !owns()) return;
    const ticket = { generation, sessionOwner, navigationOwner };
    const isCurrent = () => {
      const latest = context();
      return canUse(latest) && latest.canContinueSource !== false && latest.sessionOwner === ticket.sessionOwner && latest.navigationOwner === ticket.navigationOwner
        && generation === ticket.generation && opening === ticket && Boolean(snapshot) && owns();
    };
    ticket.isCurrent = isCurrent; opening = ticket; navigationMessage = ''; render();
    try { if (await onOpen(source, { isCurrent }) === false && isCurrent()) navigationMessage = '无法打开物理来源，请返回编辑器查找该文档。'; }
    catch { if (isCurrent()) navigationMessage = '无法打开物理来源，请返回编辑器查找该文档。'; }
    finally { if (opening === ticket) { opening = null; render(); } }
  }
  function contactRecord(index) {
    const item = node('li', '', 'project-physics-contact'), heading = node('h5'), identity = node('p', '', 'build-hint');
    const values = node('dl', '', 'project-physics-values'), source = node('p', '', 'build-hint'), button = node('button', '', 'doc-btn doc-btn-ghost project-physics-collider-source'); button.type = 'button';
    const record = { item, heading, identity, values, source, button, contact: null, owner: '' };
    button.addEventListener('click', () => { const value = record.contact?.collider; if (value) void openSource(value.source, () => contacts[index] === record && current && selectedSignature === record.owner && current.contacts[index] === record.contact); });
    item.append(heading, identity, values, source, button); return record;
  }
  function values(list, entries) {
    if (list.children.length !== entries.length * 2) list.replaceChildren(...entries.flatMap(() => [node('dt'), node('dd')]));
    entries.forEach(([label, value], index) => {
      list.children[index * 2].textContent = t(label);
      const output = list.children[index * 2 + 1];
      output.textContent = Array.isArray(value) ? vector(value) : typeof value === 'number' ? numberText(value) : value;
      output.title = Array.isArray(value) ? `[${value.join(', ')}]` : String(value);
    });
  }
  function render() {
    if (disposed) return;
    const state = updateContext(), usable = canUse(state);
    el('Panel').hidden = !usable || !snapshot;
    text('Title', t('二维物理运行观察'));
    text('Note', t('仅记录本次有限测试中角色内置移动的碰撞扫描，最多 256 个样本。不是持续接触、传感器或着地状态；不会修改场景或运行对象位置。'));
    text('InstanceLabel', t('按实例筛选')); text('StepLabel', t('按访问与步筛选')); text('SampleLabel', t('选择物理样本'));
    text('Previous', t('上一个样本')); text('Next', t('下一个样本')); text('Open', t('打开角色物理原文')); text('ContactsTitle', t('本次移动的碰撞扫描'));
    text('Navigation', opening ? t('正在打开物理来源…') : navigationMessage ? t(navigationMessage) : ''); el('Navigation').hidden = !opening && !navigationMessage;
    const samples = snapshot?.samples || [];
    if (instance && !samples.some(sample => sample.instanceId === instance)) instance = '';
    const byInstance = samples.filter(sample => !instance || sample.instanceId === instance);
    if (step && !byInstance.some(sample => stepKey(sample) === step)) step = '';
    const filtered = byInstance.filter(sample => !step || stepKey(sample) === step);
    if (!filtered.some(sample => String(sample.sequence) === sequence)) sequence = filtered.length ? String(filtered[0].sequence) : '';
    const selected = filtered.find(sample => String(sample.sequence) === sequence) || null, nextSelected = selected ? JSON.stringify(selected) : '';
    if (nextSelected !== selectedSignature) { invalidate(); current = selected; selectedSignature = nextSelected; }
    else if (selected) current = selected;
    const instances = [...new Set(samples.map(sample => sample.instanceId))];
    const steps = [...new Map(byInstance.map(sample => [stepKey(sample), sample])).values()];
    picker('Instance', [['', t('全部实例')], ...instances.map(id => [id, id])], instance);
    picker('Step', [['', t('全部访问与步')], ...steps.map(sample => [stepKey(sample), t('访问 {0} · 第 {1} 步 · {2} 秒', sample.visitIndex, sample.stepIndex, numberText(sample.timeSeconds))])], step);
    picker('Sample', filtered.map(sample => [String(sample.sequence), t('样本 {0} · 访问 {1} · 第 {2} 步', sample.sequence, sample.visitIndex, sample.stepIndex)]), sequence);
    for (const suffix of ['Instance', 'Step', 'Sample']) el(suffix).disabled = !usable || !samples.length;
    const index = filtered.indexOf(selected); el('Previous').disabled = !usable || index <= 0; el('Next').disabled = !usable || index < 0 || index >= filtered.length - 1;
    el('Detail').hidden = !selected; el('Empty').hidden = Boolean(selected);
    text('Empty', t(samples.length ? '没有匹配的物理样本。' : '尚未观察到角色移动样本；这不表示场景没有碰撞。'));
    const status = !snapshot ? '' : snapshot.limited ? t('部分记录：已达到 {0} 个样本上限，后续移动未记录。', snapshot.limit)
      : snapshot.phase === 'incomplete' ? t('记录未完成：任务中断或观察数据未通过验证。')
      : snapshot.phase === 'finished' ? t('有限观察已结束，共 {0} 个样本。', samples.length)
      : snapshot.phase === 'recording' ? t('正在记录物理移动：{0} 个样本。', samples.length) : t('等待本次任务的物理观察记录。');
    text('Status', snapshot?.limited && snapshot.phase === 'incomplete' ? status + ' ' + t('记录未完成：任务中断或观察数据未通过验证。') : status); el('Status').dataset.phase = snapshot?.phase || ''; el('Status').dataset.limited = String(snapshot?.limited === true);
    if (selected) {
      el('Detail').dataset.sequence = String(selected.sequence);
      text('Heading', t('样本 {0} · 访问 {1} · 第 {2} 步', selected.sequence, selected.visitIndex, selected.stepIndex));
      text('Identity', t('场景 {0} · 实例 {1} · 对象 {2} · 物理体 {3}', selected.sceneId, selected.instanceId, selected.objectId, selected.bodyId));
      values(el('Motion'), [['响应方式', t(selected.response === 'slide' ? '沿碰撞面滑动' : '碰撞后停止')], ['场景时间（秒）', selected.timeSeconds], ['步长（秒）', selected.deltaSeconds],
        ['请求位移', selected.requestedMotion], ['实际位移', selected.displacement], ['移动前位置', selected.positionBefore], ['移动后位置', selected.positionAfter]]);
      text('Source', t('物理来源：{0} · {1}', selected.source.sourcePath, selected.source.propertyPath)); el('Open').disabled = !usable || state.canOpenSource !== true || Boolean(opening);
      text('NoContacts', t('此样本没有记录碰撞扫描结果；不表示持续无接触。')); el('NoContacts').hidden = Boolean(selected.contacts.length);
      selected.contacts.forEach((contact, contactIndex) => {
        const record = contacts[contactIndex] || (contacts[contactIndex] = contactRecord(contactIndex)); record.contact = contact; record.owner = selectedSignature;
        record.heading.textContent = t('碰撞扫描 {0}', contactIndex + 1);
        record.identity.textContent = contact.collider ? t('碰撞体 {0} · 实例 {1} · 对象 {2}', contact.collider.bodyId, contact.collider.instanceId, contact.collider.objectId) : t('未映射碰撞体：本次扫描未关联到冻结的物理声明。');
        values(record.values, [['接触位置（场景坐标）', contact.position], ['法线', contact.normal], ['扫描已走位移', contact.travel], ['扫描剩余位移', contact.remainder]]);
        record.source.textContent = contact.collider ? t('物理来源：{0} · {1}', contact.collider.source.sourcePath, contact.collider.source.propertyPath) : '';
        record.button.hidden = !contact.collider; record.button.disabled = !usable || state.canOpenSource !== true || Boolean(opening);
        record.button.textContent = t('打开碰撞体物理原文');
      });
      while (contacts.length > selected.contacts.length) contacts.pop().item.remove();
      const list = el('Contacts');
      for (const record of contacts) if (!list.contains(record.item)) list.append(record.item);
    } else { delete el('Detail').dataset.sequence; contacts.length = 0; el('Contacts').replaceChildren(); }
    if (opening && !opening.isCurrent()) { invalidate(); render(); }
  }
  const changed = suffix => () => {
    if (!canUse(updateContext())) return;
    if (suffix === 'Instance') { instance = el(suffix).value; step = ''; }
    else if (suffix === 'Step') step = el(suffix).value;
    else sequence = el(suffix).value;
    invalidate(); render();
  };
  const handlers = ['Instance', 'Step', 'Sample'].map(suffix => { const fn = changed(suffix); el(suffix).addEventListener('change', fn); return [suffix, fn]; });
  const move = delta => {
    if (!canUse(updateContext())) return;
    const filtered = (snapshot?.samples || []).filter(sample => (!instance || sample.instanceId === instance) && (!step || stepKey(sample) === step));
    const next = filtered[filtered.findIndex(sample => String(sample.sequence) === sequence) + delta];
    if (next) { sequence = String(next.sequence); invalidate(); render(); }
  };
  el('Previous').addEventListener('click', () => move(-1)); el('Next').addEventListener('click', () => move(1));
  el('Open').addEventListener('click', () => { if (current) { const sample = current, owner = selectedSignature; void openSource(sample.source, () => Boolean(current) && selectedSignature === owner && current.sequence === sample.sequence); } });
  const unsubscribe = onLanguageChange(render); render();
  return Object.freeze({
    setSnapshot(value) {
      if (disposed) return;
      updateContext(); let admitted;
      try { admitted = value == null ? null : validateProjectPhysics2DObservation(value); }
      catch { clear(); render(); return; }
      const next = admitted ? JSON.stringify(admitted) : '';
      if (next !== signature) { signature = next; snapshot = admitted; if (!snapshot) clear(); }
      render();
    },
    refresh: render,
    dispose() { if (disposed) return; disposed = true; clear(); for (const [suffix, fn] of handlers) el(suffix).removeEventListener('change', fn); if (typeof unsubscribe === 'function') unsubscribe(); container.replaceChildren(); },
  });
}

import { captureSceneBehaviorDirectory, createBehaviorScriptLinkRequest, validateBehaviorScriptLinkResult } from '../../engine/scene-behavior-directory.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// This window owns a reviewed metadata reference, never behavior source edits.
// Reads, commands, host refresh and navigation remain independent injected ports.
export function setupSceneBehaviorLinks({ getContext = () => ({}), setBusy = () => {}, inspect = async () => null,
  command = async () => null, applied = async () => {}, openSource = async () => false } = {}) {
  if (!document.getElementById('sceneBehaviorLinksStyle')) {
    const link = document.createElement('link'); link.id = 'sceneBehaviorLinksStyle'; link.rel = 'stylesheet'; link.href = '/web/scene-behavior-links.css';
    (document.head || document.body).append(link);
  }
  const dialog = document.createElement('dialog'); dialog.id = 'sceneBehaviorLinksDialog'; dialog.className = 'scene-behavior-links-dialog';
  dialog.setAttribute('aria-labelledby', 'sceneBehaviorLinksTitle');
  dialog.innerHTML = `<header class="scene-behavior-links-header"><h2 id="sceneBehaviorLinksTitle" data-i18n="管理已有行为"></h2><button id="sceneBehaviorLinksClose" class="doc-btn doc-btn-ghost" type="button" data-i18n="返回构建"></button></header>
    <div class="scene-behavior-links-body"><p data-i18n="查看场景的行为文档与脚本引用。新增引用仅更新登记信息；绑定、参数与信号请在行为原文中编辑。"></p>
      <button id="sceneBehaviorLinksRefresh" class="doc-btn doc-btn-ghost" type="button" data-i18n="重新读取工程"></button>
      <p id="sceneBehaviorLinksEmpty" data-i18n="此场景尚未关联行为文档。请返回构建，使用添加行为创建首份行为文档。" hidden></p>
      <section id="sceneBehaviorLinksReady" hidden><h3 data-i18n="当前行为文档"></h3><p id="sceneBehaviorLinksManifest" class="scene-behavior-links-path"></p>
        <h3 data-i18n="已关联脚本"></h3><ul id="sceneBehaviorLinksScripts"></ul>
        <fieldset id="sceneBehaviorLinksFields"><legend data-i18n="新增脚本引用"></legend><label><span data-i18n="选择尚未关联的已登记 TXT 脚本"></span><select id="sceneBehaviorLinksSource"></select></label>
          <p id="sceneBehaviorLinksNoSources" data-i18n="没有尚未关联的脚本。请在主编辑器保存新的 TXT 文档，再重新读取工程。" hidden></p>
          <p data-i18n="关联后脚本可供行为绑定选用；不会自动新增绑定、修改脚本或运行代码。"></p></fieldset>
      </section><section id="sceneBehaviorLinksReview" hidden><h3 data-i18n="新增引用审阅"></h3><p data-i18n="保存只增加下列 references 引用，行为原文与脚本原文不会改变。"></p><ul id="sceneBehaviorLinksRelations"></ul></section>
    </div><div class="scene-behavior-links-feedback"><p id="sceneBehaviorLinksStatus" role="status" aria-live="polite"></p><p id="sceneBehaviorLinksDetails" class="scene-behavior-links-note"></p></div>
    <footer class="scene-behavior-links-footer"><button id="sceneBehaviorLinksCheck" class="doc-btn doc-btn-ghost" type="button" data-i18n="审阅新增引用"></button><button id="sceneBehaviorLinksSave" class="doc-btn" type="button" data-i18n="保存引用"></button><button id="sceneBehaviorLinksOpen" class="doc-btn" type="button" data-i18n="打开行为原文"></button><button id="sceneBehaviorLinksCancel" class="doc-btn doc-btn-ghost" type="button" data-i18n="取消"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector('#sceneBehaviorLinks' + suffix);
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
  let enabled = false, supported = false, disposed = false, epoch = 0, owner = null, opener = null, pendingFocus = null;
  let catalog = null, preview = null, pendingWrite = null, phase = '', busyOwned = false, needsRefresh = false, message = '', details = '';
  const selected = () => el('Source').value;
  const eligible = () => { const c = getContext(); return Boolean(!disposed && enabled && c.editable && !c.dirty && !c.creating && !c.busy && c.visible === true && uuid(c.sceneId) && typeof c.session === 'string'); };
  const owns = (generation = epoch, acceptToken = false) => {
    const c = getContext(); return Boolean(generation === epoch && dialog.open && owner && !owner.invalidated && eligible()
      && c.session === owner.session && c.sceneId === owner.sceneId && (acceptToken || c.sourceToken === owner.sourceToken));
  };
  const ready = () => catalog?.status === 'ready';
  const candidate = () => ready() && catalog.sources.find(source => source.objectId === selected() && !source.linked);
  const canEdit = () => Boolean(!phase && !pendingWrite && !needsRefresh && supported && ready() && owns());
  const approval = () => preview && preview.catalog === catalog && preview.sourceId === selected();
  const isDirty = () => Boolean(selected() || preview || pendingWrite);
  function hostBusy(value) { if (busyOwned !== value) { busyOwned = value; setBusy(value); } }
  function options() {
    const value = selected(); el('Source').replaceChildren();
    const values = ready() ? catalog.sources.filter(source => !source.linked) : [];
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = t('请选择'); el('Source').append(placeholder);
    if (value && !values.some(source => source.objectId === value)) {
      const missing = document.createElement('option'); missing.value = value; missing.textContent = t('已不可用：{0}', value); el('Source').append(missing);
    }
    for (const source of values) { const option = document.createElement('option'); option.value = source.objectId; option.textContent = `${source.name} · ${source.sourcePath}`; el('Source').append(option); }
    el('Source').value = value;
  }
  function update() {
    if (disposed) return;
    translatePage(dialog); dialog.dataset.dirty = String(isDirty()); dialog.setAttribute('aria-busy', String(Boolean(phase)));
    el('Empty').hidden = catalog?.status !== 'empty'; el('Ready').hidden = !ready();
    el('Manifest').textContent = ready() ? t('{0} · {1} 条行为绑定', catalog.manifest.sourcePath, catalog.manifest.bindingCount) : '';
    el('Scripts').replaceChildren();
    if (ready()) for (const source of catalog.sources.filter(item => item.linked)) {
      const item = document.createElement('li'); item.dataset.objectId = source.objectId; item.dataset.usage = source.usedByBindingIds.length ? 'used' : 'available';
      item.textContent = `${source.name} · ${source.sourcePath} · ${source.usedByBindingIds.length ? t('用于 {0} 条绑定', source.usedByBindingIds.length) : t('仅可选用，尚无绑定')}`; el('Scripts').append(item);
    }
    options(); el('NoSources').hidden = !ready() || catalog.sources.some(source => !source.linked);
    el('Fields').disabled = !canEdit(); el('Source').disabled = !canEdit();
    el('Check').disabled = !canEdit() || !candidate(); el('Save').disabled = !canEdit() || !approval();
    el('Refresh').disabled = Boolean(phase) || !owns();
    el('Open').disabled = Boolean(phase || pendingWrite || needsRefresh) || !ready() || !owns();
    el('Close').disabled = Boolean(phase); el('Cancel').disabled = Boolean(phase);
    el('Review').hidden = !approval(); el('Relations').replaceChildren();
    if (approval()) {
      const source = catalog.sources.find(item => item.objectId === preview.sourceId), item = document.createElement('li');
      item.textContent = `${catalog.manifest.sourcePath} (${catalog.manifest.objectId}) → references → ${source.sourcePath} (${source.objectId})`;
      el('Relations').append(item);
    }
    el('Status').textContent = t(message); el('Details').textContent = details;
  }
  function stale() { preview = null; needsRefresh = true; message = '来源或会话已变化，请返回构建后重新打开行为管理。'; }
  async function inspectCurrent(generation) {
    const value = await inspect({ sceneObjectId: owner.sceneId });
    if (!owns(generation)) return null;
    return captureSceneBehaviorDirectory(value, owner.sceneId);
  }
  const observed = next => pendingWrite && next?.status === 'ready' && next.worldId === pendingWrite.catalog.worldId
    && next.scene.objectId === pendingWrite.catalog.scene.objectId && next.manifest.objectId === pendingWrite.catalog.manifest.objectId
    && next.sources.some(source => source.objectId === pendingWrite.sourceId && source.linked);
  async function notifySaved(generation, next) {
    // Only our own host refresh may replace the owner token. A dirty editor or
    // changed scene/session is never adopted, including on a failed refresh.
    try { await applied(pendingWrite.result, pendingWrite.result ? undefined : { reconciled: true, catalog: next }); }
    finally { if (owns(generation, true)) owner.sourceToken = getContext().sourceToken; }
    if (!owns(generation)) return false;
    pendingWrite.notified = true; return true;
  }
  async function reload(generation) {
    if (pendingWrite?.result && !pendingWrite.notified && !await notifySaved(generation)) return;
    let next = await inspectCurrent(generation); if (!next) return;
    if (pendingWrite && observed(next) && !pendingWrite.notified) {
      if (!await notifySaved(generation, next)) return;
      next = await inspectCurrent(generation); if (!next) return;
    }
    catalog = next; preview = null; needsRefresh = false;
    if (pendingWrite && observed(next) && pendingWrite.notified) {
      pendingWrite = null; el('Source').value = ''; message = '脚本引用已确认。可打开行为原文，在绑定中选用此脚本。';
    } else if (pendingWrite) message = pendingWrite.result ? '引用已保存，但目录尚未同步。请重新读取工程，勿重复提交。' : '保存结果尚未确认。请重新读取工程核对引用，勿重复提交。';
    else message = !supported ? '当前宿主仅支持查看行为目录。' : next.status === 'empty' ? '此场景尚无行为文档。' : '选择尚未关联的脚本，先审阅引用再保存。';
  }
  async function read() {
    if (phase || !owns()) return false;
    const generation = epoch; preview = null; phase = 'read'; hostBusy(true); message = '正在读取行为目录…'; details = ''; update();
    try { await reload(generation); }
    catch (error) { if (owns(generation)) { needsRefresh = true; message = pendingWrite?.result ? '引用已保存，但目录尚未同步。请重新读取工程，勿重复提交。' : '无法读取行为目录。选择已保留，请重试。'; details = error.message || ''; } }
    finally { if (generation === epoch && !disposed) { phase = ''; hostBusy(false); if (!owns()) stale(); update(); } }
    return true;
  }
  async function run(mode) {
    if (!canEdit() || !candidate() || mode === 'apply' && !approval()) { if (!phase && preview && !approval()) { preview = null; message = '脚本选择已变化，请重新审阅引用。'; update(); } return; }
    const generation = epoch, sourceId = selected(), snapshot = catalog;
    let request; try { request = createBehaviorScriptLinkRequest(snapshot, sourceId, mode); }
    catch (error) { preview = null; message = '脚本引用无效，请重新读取工程并选择。'; details = error.message || ''; update(); return; }
    phase = mode; hostBusy(true); message = mode === 'apply' ? '正在保存脚本引用…' : '正在审阅脚本引用…'; details = ''; update();
    try {
      if (mode === 'apply') pendingWrite = { sourceId, catalog: snapshot, result: null, notified: false };
      const result = await command(request);
      if (!owns(generation) || selected() !== sourceId || catalog !== snapshot) return;
      const valid = validateBehaviorScriptLinkResult(result, request, snapshot);
      if (mode === 'preview') { preview = { request, catalog: snapshot, sourceId }; message = '请确认新增引用。保存后在行为原文中设置绑定。'; }
      else { pendingWrite.result = valid; preview = null; await reload(generation); }
    } catch (error) {
      if (generation !== epoch || disposed) return;
      preview = null;
      const code = error.errorCode || error.payload?.errorCode || error.payload?.data?.errorCode;
      // These errors are returned before a transaction can commit. Everything
      // else, including a malformed success receipt, requires read convergence.
      const known = ['world_revision_conflict', 'world_read_conflict', 'world_object_revision_conflict', 'world_relation_object_missing', 'world_relation_read_only', 'world_relation_self', 'world_relation_exists', 'world_relation_cycle', 'world_command_invalid'];
      if (mode === 'apply' && !pendingWrite?.result && known.includes(code)) pendingWrite = null;
      needsRefresh = true;
      message = pendingWrite?.result ? '引用已保存，但目录尚未同步。请重新读取工程，勿重复提交。'
        : pendingWrite ? '保存结果尚未确认。请重新读取工程核对引用，勿重复提交。'
          : '引用请求未完成。请重新读取工程并审阅。'; details = error.message || '';
    } finally {
      if (generation === epoch && !disposed) {
        phase = ''; hostBusy(false);
        if (!owns()) stale();
        else if (mode === 'preview' && selected() !== sourceId) { preview = null; message = '脚本选择已变化，请重新审阅引用。'; }
        update();
      }
    }
  }
  function resetClosed(restoreFocus) {
    epoch++; owner = null; catalog = null; preview = null; pendingWrite = null; phase = ''; needsRefresh = false; el('Source').value = ''; hostBusy(false);
    dialog.dataset.dirty = 'false'; dialog.setAttribute('aria-busy', 'false'); pendingFocus = restoreFocus ? { element: opener, generation: epoch } : null;
  }
  function close(restoreFocus = true) {
    if (phase) return false;
    if (isDirty() && !window.confirm(t('丢弃本次脚本选择与审阅？已保存的引用会保留。'))) return false;
    resetClosed(restoreFocus); dialog.close(); return true;
  }
  async function navigate() {
    if (phase || pendingWrite || needsRefresh || !ready() || !owns()) return;
    if (isDirty() && !window.confirm(t('丢弃本次脚本选择与审阅并打开原文？已保存的引用会保留。'))) return;
    const generation = epoch, previous = catalog; phase = 'open'; hostBusy(true); message = '正在核对行为原文…'; details = ''; update();
    try {
      const next = await inspectCurrent(generation); if (!next) return;
      catalog = next; preview = null;
      if (next.status !== 'ready' || next.worldId !== previous.worldId || next.manifest.objectId !== previous.manifest.objectId) {
        message = '行为文档关系已变化。请确认当前目录后重新打开原文。'; return;
      }
      // Navigation owns source loading from this point. The source token and
      // parent busy/visible flags naturally change during its guarded handoff.
      hostBusy(false);
      const isCurrent = () => {
        const c = getContext(); return Boolean(generation === epoch && dialog.open && !disposed && enabled && owner && !owner.invalidated
          && c.sceneId === owner.sceneId && c.session === owner.session && c.editable && !c.dirty && !c.creating);
      };
      if (!owns(generation)) return;
      const result = await openSource(next.manifest.sourcePath, { sourceRevision: next.manifest.sourceRevision, isCurrent });
      if (generation !== epoch || disposed) return;
      if (result !== false && isCurrent()) { resetClosed(false); dialog.close(); result?.focus?.(); }
      else message = '行为原文未打开。请重新读取工程后重试。';
    } catch (error) { if (generation === epoch && !disposed) { message = '行为原文未打开。请重新读取工程后重试。'; details = error.message || ''; } }
    finally { if (generation === epoch && !disposed) { phase = ''; hostBusy(false); if (!owns()) stale(); update(); } }
  }
  for (const event of ['input', 'change']) el('Source').addEventListener(event, () => {
    if (!canEdit()) return; preview = null; message = '脚本选择已变化，请重新审阅引用。'; details = ''; update();
  });
  el('Refresh').addEventListener('click', () => void read()); el('Check').addEventListener('click', () => void run('preview')); el('Save').addEventListener('click', () => void run('apply'));
  el('Open').addEventListener('click', () => void navigate()); el('Close').addEventListener('click', () => close()); el('Cancel').addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!event.isComposing && !event.repeat) close(); });
  dialog.addEventListener('keydown', event => { event.stopPropagation(); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault(); });
  dialog.addEventListener('close', () => {
    if (dialog.open || disposed) return;
    if (owner) resetClosed(true);
    const focus = pendingFocus; pendingFocus = null; if (focus?.generation === epoch) focus.element?.focus();
  });
  const unsubscribe = onLanguageChange(() => { if (dialog.open && !disposed) update(); });
  return Object.freeze({
    open(sceneId) {
      if (dialog.open || !eligible() || getContext().sceneId !== sceneId) return false;
      epoch++; const c = getContext(); owner = { sceneId, session: c.session, sourceToken: c.sourceToken }; opener = document.activeElement; pendingFocus = null;
      catalog = null; preview = null; pendingWrite = null; needsRefresh = false; phase = ''; message = ''; details = ''; el('Source').value = '';
      dialog.showModal(); update(); void read(); return true;
    },
    setAvailable(value, commands = []) {
      const previous = supported; enabled = value === true; supported = Array.isArray(commands) && commands.includes('relation.add');
      if (dialog.open) { if (!enabled || previous && !supported) { preview = null; if (owner) owner.invalidated = true; } update(); }
    },
    refresh: read,
    dispose() { if (disposed) return; disposed = true; epoch++; owner = null; pendingFocus = null; hostBusy(false); if (typeof unsubscribe === 'function') unsubscribe(); dialog.close(); dialog.remove(); },
  });
}

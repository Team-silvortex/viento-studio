import { t, translatePage, onLanguageChange } from '../i18n/index.js';
import { PROJECT_INPUT_MAP_KEYS, inspectProjectInputMap, validateProjectInputMap } from '../../engine/project-input-map.mjs';
import { getCreatePathError } from '../../engine/document-contract.mjs';

// The host owns the editor buffer. This view can only request an explicitly
// reviewed in-memory draft; it has no document save or build authority.
export function setupInputMap({ getContext, applyDraft }) {
  const button = document.createElement('button'); button.type = 'button'; button.id = 'inputMapBtn'; button.className = 'doc-btn doc-btn-ghost';
  (document.getElementById('modeSwitch') || document.body).append(button);
  const dialog = document.createElement('dialog'); dialog.id = 'inputMapDialog'; dialog.className = 'project-assembly'; dialog.dataset.vientoCloseGuard = 'true'; dialog.setAttribute('aria-labelledby', 'inputMapTitle');
  dialog.innerHTML = `<header><h2 id="inputMapTitle" data-i18n="输入映射编辑"></h2><button id="inputMapClose" type="button" class="doc-btn" data-i18n="返回编辑器"></button></header>
  <div class="project-assembly-body"><p data-i18n="动作使用物理键位置；不同动作可以共享按键。动作名称供脚本引用，不会自动修改已有脚本。"></p>
  <p data-i18n="同一按键可绑定多个动作，并会同时触发。方向键、空格、Enter 和 Tab 可能同时触发 Godot 默认 ui_* 动作；自定义动作不会替换这些默认键。"></p>
  <div id="inputMapCreateFields" class="project-assembly-grid"><label for="inputMapPath" data-i18n="映射保存位置"></label><input id="inputMapPath" maxlength="1024" spellcheck="false"><label for="inputMapType" data-i18n="文档类型"></label><select id="inputMapType"></select></div>
  <div class="project-assembly-members"><section><label for="inputMapActions" data-i18n="输入动作"></label><select id="inputMapActions" size="8"></select><div class="project-assembly-actions"><button id="inputMapAddAction" type="button" class="doc-btn" data-i18n="添加动作"></button><button id="inputMapRemoveAction" type="button" class="doc-btn" data-i18n="移除动作"></button></div></section>
  <section><label for="inputMapName" data-i18n="动作名称"></label><input id="inputMapName" maxlength="64" autocomplete="off" spellcheck="false" aria-describedby="inputMapNameHint"><p id="inputMapNameHint" data-i18n="小写字母开头，可使用小写字母、数字和下划线；ui_ 前缀保留。"></p>
  <label for="inputMapKeys" data-i18n="已绑定物理键"></label><select id="inputMapKeys" size="6"></select><button id="inputMapRemoveKey" type="button" class="doc-btn" data-i18n="移除按键"></button>
  <label for="inputMapKeyChoice" data-i18n="添加物理键"></label><select id="inputMapKeyChoice"></select><button id="inputMapAddKey" type="button" class="doc-btn" data-i18n="添加按键"></button></section></div>
  <details id="inputMapReview" hidden open><summary data-i18n="输入映射原文审阅"></summary><h3 data-i18n="修改前的完整原文"></h3><pre id="inputMapBefore" tabindex="0"></pre><h3 data-i18n="应用后的完整原文"></h3><pre id="inputMapAfter" tabindex="0"></pre></details></div>
  <p id="inputMapStatus" role="status" aria-live="polite"></p><p id="inputMapError" role="alert" hidden></p>
  <footer><span data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></span><button id="inputMapCheck" type="button" class="doc-btn" data-i18n="检查输入映射"></button><button id="inputMapApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button><button id="inputMapCancel" type="button" class="doc-btn" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  if (!document.querySelector('link[data-project-assembly]')) { const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/web/project-assembly.css'; style.dataset.projectAssembly = 'true'; (document.head || document.body).append(style); }
  const el = id => dialog.querySelector('#inputMap' + id), copy = value => JSON.parse(JSON.stringify(value));
  let session = null, actions = [], selected = 0, baseline = '', review = null, error = '', message = '', opener = null, disposed = false, composing = false;
  const current = () => { const now = getContext(); return Boolean(session && dialog.open && !disposed && now.mode === session.mode && now.token === session.token); };
  const rawActions = () => actions.map((action, index) => index === selected ? { ...action, name: el('Name').value } : action);
  const sig = () => JSON.stringify({ actions: rawActions(), path: el('Path').value, type: el('Type').value });
  const dirty = () => session && sig() !== baseline;
  function options(select, rows, chosen) { select.replaceChildren(...rows.map(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; return option; })); select.value = chosen; }
  function render() {
    translatePage(dialog); button.textContent = t('输入映射'); button.hidden = !getContext().mode; button.disabled = !getContext().mode;
    if (!dialog.open || !session) return;
    const valid = current(), row = actions[selected];
    options(el('Actions'), actions.map((action, index) => [String(index), action.name || t('未命名动作')]), String(selected));
    options(el('Keys'), (row?.keys || []).map(key => [key, key]), row?.keys.includes(el('Keys').value) ? el('Keys').value : row?.keys[0] || '');
    options(el('KeyChoice'), PROJECT_INPUT_MAP_KEYS.map(key => [key, key]), el('KeyChoice').value || PROJECT_INPUT_MAP_KEYS[0]);
    options(el('Type'), session.documentTypes.map(type => [type.id, t(type.label)]), el('Type').value || session.type || '');
    el('Name').value = row?.name || ''; el('CreateFields').hidden = session.mode !== 'create';
    for (const name of ['Name', 'Path', 'Type', 'Actions', 'Keys', 'KeyChoice']) el(name).disabled = !valid;
    el('AddAction').disabled = !valid || actions.length >= 64; el('RemoveAction').disabled = !valid || actions.length <= 1;
    el('AddKey').disabled = !valid || !row || row.keys.length >= 16 || row.keys.includes(el('KeyChoice').value);
    el('RemoveKey').disabled = !valid || !row || row.keys.length <= 1 || !el('Keys').value;
    el('Check').disabled = !valid; el('Apply').disabled = !valid || !review || review.signature !== sig();
    el('Review').hidden = !review; el('Before').textContent = review?.before || ''; el('After').textContent = review?.after || '';
    el('Status').textContent = t(valid ? message : '当前作者会话已变化，请返回后重新打开输入映射。'); el('Error').hidden = !error; el('Error').textContent = error ? t(error) : '';
    dialog.dataset.dirty = String(Boolean(dirty()));
  }
  function changed() { review = null; error = ''; message = '检查后审阅原文，再应用到草稿。'; render(); }
  function open() {
    const context = getContext(); if (disposed || dialog.open || !context.mode) return false;
    try {
      const model = context.mode === 'edit' ? inspectProjectInputMap(context.content) : validateProjectInputMap({ format: 'viento-input-map', schemaVersion: 1, actions: [{ name: 'move_left', keys: ['KeyA'] }] });
      session = { ...context, documentTypes: copy(context.documentTypes || []) }; actions = copy(model.actions); selected = 0; opener = document.activeElement;
      el('Path').value = context.mode === 'create' ? `${context.documentRoot}/input/input-map.json` : context.path;
      session.type = context.documentTypes?.find(type => type.id === 'document')?.id || context.documentTypes?.[0]?.id || ''; el('Type').value = session.type;
      el('Name').value = actions[selected].name; review = null; error = ''; message = '检查后审阅原文，再应用到草稿。'; dialog.showModal(); render(); baseline = sig(); render(); return true;
    } catch { return false; }
  }
  function close(force = false) {
    if (!force && dirty() && !window.confirm(t('丢弃未应用的输入映射修改？'))) return false;
    session = null; actions = []; review = null; composing = false; dialog.dataset.dirty = 'false'; if (dialog.open) dialog.close(); render(); opener?.focus?.(); return true;
  }
  function check() {
    if (!current()) return false; review = null; error = '';
    try {
      const model = validateProjectInputMap({ format: 'viento-input-map', schemaVersion: 1, actions: copy(rawActions()) });
      if (session.mode === 'create' && (!el('Path').value.startsWith(session.documentRoot + '/') || getCreatePathError(el('Path').value) || !/\.json$/i.test(el('Path').value) || !session.documentTypes.some(item => item.id === el('Type').value))) throw Error('invalid path');
      const before = session.mode === 'edit' ? session.content : '';
      const after = session.mode === 'edit' && JSON.stringify(model) === JSON.stringify(inspectProjectInputMap(before)) ? before : JSON.stringify(model, null, 2) + '\n';
      review = { signature: sig(), before, after }; message = '请审阅完整原文；应用后仍需普通保存。'; render(); return true;
    } catch { error = '输入映射无效：检查动作名称、重复按键和保存位置。'; render(); return false; }
  }
  function apply() {
    if (!current() || !review || review.signature !== sig()) return false;
    try { const result = applyDraft({ mode: session.mode, token: session.token, before: review.before, content: review.after,
      sourcePath: session.mode === 'create' ? el('Path').value : session.path, documentType: session.mode === 'create' ? el('Type').value : '' }, { isCurrent: () => current() && review?.signature === sig() });
      if (!result?.applied || result.content !== review.after) throw Error('unconfirmed');
      close(true); result.focus?.(); return true;
    } catch { error = '未能应用输入映射，当前修改已保留。'; review = null; render(); return false; }
  }
  el('Actions').addEventListener('change', () => { if (!current()) return; const index = Number(el('Actions').value); if (Number.isInteger(index) && actions[index]) { selected = index; render(); } });
  el('Name').addEventListener('input', () => { if (current()) { actions[selected].name = el('Name').value; changed(); } });
  for (const name of ['Path', 'Type']) el(name).addEventListener(name === 'Path' ? 'input' : 'change', changed);
  el('KeyChoice').addEventListener('change', render); el('Keys').addEventListener('change', render);
  el('AddAction').addEventListener('click', () => { if (!current() || actions.length >= 64) return; actions.push({ name: '', keys: ['KeyA'] }); selected = actions.length - 1; changed(); el('Name').focus(); });
  el('RemoveAction').addEventListener('click', () => { if (!current() || actions.length <= 1) return; actions.splice(selected, 1); selected = Math.min(selected, actions.length - 1); changed(); });
  el('AddKey').addEventListener('click', () => { const key = el('KeyChoice').value, row = actions[selected]; if (!current() || !PROJECT_INPUT_MAP_KEYS.includes(key) || row.keys.includes(key) || row.keys.length >= 16) return; row.keys.push(key); changed(); });
  el('RemoveKey').addEventListener('click', () => { const row = actions[selected], index = row.keys.indexOf(el('Keys').value); if (!current() || row.keys.length <= 1 || index < 0) return; row.keys.splice(index, 1); changed(); });
  button.addEventListener('click', open); el('Check').addEventListener('click', check); el('Apply').addEventListener('click', apply);
  for (const name of ['Close', 'Cancel']) el(name).addEventListener('click', () => close());
  // Keep modal shortcuts inside this draft. In WebKit an IME Escape can also
  // cause a dialog cancel with no composition flag, so track composition here.
  dialog.addEventListener('compositionstart', () => { composing = true; });
  dialog.addEventListener('compositionend', () => { composing = false; });
  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!composing && !event.isComposing && event.keyCode !== 229 && !event.repeat) close();
    } else if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 's') event.preventDefault();
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!composing && !event.isComposing && !event.repeat) close(); });
  const unsubscribe = onLanguageChange(() => { if (!disposed) render(); });
  function dispose() { if (disposed) return; close(true); disposed = true; unsubscribe?.(); button.remove(); dialog.remove(); }
  render(); return Object.freeze({ open, refresh: render, dispose });
}

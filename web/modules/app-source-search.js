import { findSourceMatches, planSourceReplacement } from '../../engine/source-search.mjs';
import { revealSourceOffset } from './app-source-reveal.js';
import { t, onLanguageChange } from '../i18n/index.js';

// The ordinary editor owns drafts, input and undo. Search can move a selection;
// replacement requests one native edit and never falls back to rewriting text.
export function setupSourceSearch({ textarea, container, getContext = () => ({}) } = {}) {
  if (!textarea || !container) return Object.freeze({ refresh() {}, dispose() {} });
  const document = textarea.ownerDocument;
  if (!document.getElementById('sourceSearchStyle')) {
    const style = document.createElement('link');
    style.id = 'sourceSearchStyle'; style.rel = 'stylesheet'; style.href = '/web/source-search.css';
    (document.head || document.body).append(style);
  }
  const tools = document.createElement('div');
  tools.className = 'source-search-tools'; tools.id = 'sourceSearchTools';
  tools.innerHTML = '<button id="sourceSearchOpen" type="button" class="doc-btn doc-btn-ghost" aria-controls="sourceSearchPanel" aria-expanded="false"></button><section id="sourceSearchPanel" class="source-search-panel"><div class="source-search-row"><label for="sourceSearchQuery" id="sourceSearchQueryLabel"></label><textarea id="sourceSearchQuery" rows="1" maxlength="4096" spellcheck="false"></textarea></div><div class="source-search-row"><label for="sourceSearchReplacement" id="sourceSearchReplacementLabel"></label><textarea id="sourceSearchReplacement" rows="1" maxlength="65536" spellcheck="false"></textarea></div><div class="source-search-actions"><label class="source-search-case"><input id="sourceSearchMatchCase" type="checkbox"><span id="sourceSearchMatchCaseLabel"></span></label><button id="sourceSearchPrevious" type="button" class="doc-btn doc-btn-ghost"></button><button id="sourceSearchNext" type="button" class="doc-btn doc-btn-ghost"></button><button id="sourceSearchReplace" type="button" class="doc-btn doc-btn-ghost"></button><button id="sourceSearchReplaceAll" type="button" class="doc-btn doc-btn-ghost"></button><button id="sourceSearchClose" type="button" class="doc-btn doc-btn-ghost"></button></div><p id="sourceSearchStatus" role="status" aria-live="polite"></p></section>';
  container.prepend(tools); container.classList.add('source-search-container');
  const el = suffix => tools.querySelector('#sourceSearch' + suffix);
  const openButton = el('Open'), panel = el('Panel'), query = el('Query'), replacement = el('Replacement');
  const matchCase = el('MatchCase'), previous = el('Previous'), next = el('Next');
  const replace = el('Replace'), replaceAll = el('ReplaceAll'), closeButton = el('Close'), status = el('Status');
  let disposed = false, opened = false, executing = false, token, message = '', messageCount = 0, cache = null;
  const compositions = new Set();
  matchCase.checked = true;
  const context = () => { try { return getContext() || {}; } catch { return {}; } };
  const writable = current => !disposed && current.editable === true
    && typeof current.sourceToken === 'string' && current.sourceToken.length > 0
    && textarea.isConnected && container.isConnected && !textarea.readOnly && !textarea.disabled
    && !document.querySelector('dialog[open]');
  const available = current => !compositions.size && writable(current);
  const snapshot = () => ({ token: context().sourceToken, text: textarea.value, query: query.value,
    matchCase: matchCase.checked, replacement: replacement.value, start: textarea.selectionStart,
    end: textarea.selectionEnd, direction: textarea.selectionDirection, top: textarea.scrollTop, left: textarea.scrollLeft });
  const sameOwner = saved => { const current = context(); return available(current) && current.sourceToken === saved.token; };
  const owns = saved => sameOwner(saved) && textarea.value === saved.text && query.value === saved.query
    && matchCase.checked === saved.matchCase && replacement.value === saved.replacement && opened;
  function matches() {
    const text = textarea.value, needle = query.value, sensitive = matchCase.checked;
    if (cache?.text !== text || cache.query !== needle || cache.matchCase !== sensitive) {
      cache = { text, query: needle, matchCase: sensitive, matches: [], error: '' };
      try { cache.matches = findSourceMatches({ text, query: needle, matchCase: sensitive }); }
      catch (error) { cache.error = error?.errorCode === 'source_search_limit'
        ? '匹配数量或替换结果超出限制，请缩小查找范围。' : '当前文本或查找内容超出支持范围。'; }
    }
    return cache;
  }
  function refresh() {
    if (disposed) return;
    const current = context();
    if (token !== current.sourceToken) {
      token = current.sourceToken; opened = false; query.value = ''; replacement.value = '';
      matchCase.checked = true; message = ''; cache = null; compositions.clear();
    }
    tools.hidden = current.editable !== true;
    panel.hidden = !opened || current.editable !== true;
    openButton.hidden = opened; openButton.setAttribute('aria-expanded', String(opened));
    openButton.textContent = t('查找与替换'); openButton.title = t('查找与替换（Ctrl / ⌘ + F）');
    panel.setAttribute('aria-label', t('当前原文查找与替换'));
    el('QueryLabel').textContent = t('查找文本'); el('ReplacementLabel').textContent = t('替换为');
    el('MatchCaseLabel').textContent = t('区分大小写');
    previous.textContent = t('上一个'); next.textContent = t('下一个');
    replace.textContent = t('替换当前'); replaceAll.textContent = t('全部替换'); closeButton.textContent = t('关闭查找');
    const enabled = available(current) && !executing;
    for (const control of [openButton, matchCase]) control.disabled = !enabled;
    // Disabling an active composing textarea cancels its native IME session.
    for (const control of [query, replacement]) control.disabled = !writable(current) || executing;
    const found = opened ? matches() : { matches: [], error: '' };
    const selected = found.matches.findIndex(match => match.start === textarea.selectionStart && match.end === textarea.selectionEnd);
    status.dataset.count = String(found.matches.length); status.dataset.current = String(selected + 1);
    for (const control of [previous, next, replaceAll]) control.disabled = !enabled || !found.matches.length || Boolean(found.error);
    replace.disabled = !enabled || selected < 0 || Boolean(found.error);
    closeButton.disabled = executing || Boolean(compositions.size);
    status.textContent = t(message || found.error || (!query.value ? '输入要查找的文本。'
      : !found.matches.length ? '未找到匹配文本。' : selected < 0 ? '找到 {0} 处匹配。' : '第 {0} / {1} 处匹配'),
    message ? messageCount : selected < 0 ? found.matches.length : selected + 1, found.matches.length);
  }
  function restore(saved) {
    if (!owns(saved)) return;
    textarea.setSelectionRange(saved.start, saved.end, saved.direction);
    if (owns(saved)) { textarea.scrollTop = saved.top; textarea.scrollLeft = saved.left; }
  }
  function open(event) {
    if (executing || event?.isComposing || event?.keyCode === 229 || !available(context())) return false;
    refresh();
    const saved = snapshot();
    opened = true; message = '';
    if (!query.value && saved.start !== saved.end && saved.end - saved.start <= 4096) query.value = saved.text.slice(saved.start, saved.end);
    refresh(); executing = true;
    try {
      query.focus();
      if (!sameOwner(saved) || textarea.value !== saved.text) return false;
      query.select();
      return sameOwner(saved) && textarea.value === saved.text;
    } finally { executing = false; refresh(); }
  }
  function close() {
    if (executing || disposed || !opened || compositions.size) return;
    const saved = snapshot(), returnFocus = panel.contains(document.activeElement);
    if (returnFocus && owns(saved)) {
      textarea.focus({ preventScroll: true }); restore(saved);
      if (!owns(saved)) { refresh(); return; }
    }
    opened = false; message = ''; refresh();
  }
  function navigate(backward = false, event) {
    if (executing || event?.isComposing || event?.keyCode === 229 || !available(context())) return false;
    refresh(); if (!opened || !query.value) return open(event);
    const saved = snapshot(), found = matches();
    if (found.error || !found.matches.length) { refresh(); return false; }
    const exact = found.matches.findIndex(match => match.start === saved.start && match.end === saved.end);
    let index = exact >= 0 ? exact + (backward ? -1 : 1)
      : backward ? found.matches.findLastIndex(match => match.end <= saved.start)
        : found.matches.findIndex(match => match.start >= saved.end);
    if (index < 0) index = backward ? found.matches.length - 1 : 0;
    if (index >= found.matches.length) index = 0;
    const match = found.matches[index];
    if (!owns(saved)) return false;
    executing = true;
    try {
      textarea.focus({ preventScroll: true }); if (!owns(saved) || document.activeElement !== textarea) return false;
      textarea.setSelectionRange(match.start, match.end, 'forward');
      if (!owns(saved) || textarea.selectionStart !== match.start || textarea.selectionEnd !== match.end) return false;
      revealSourceOffset(textarea, saved.text, match.start); message = ''; return true;
    } finally { executing = false; refresh(); }
  }
  function perform(all, event) {
    if (executing || event?.isComposing || event?.keyCode === 229 || !available(context())) return false;
    refresh(); if (!opened) return false;
    const saved = snapshot(); let plan;
    try { plan = planSourceReplacement({ text: saved.text, query: saved.query, replacement: saved.replacement,
      matchCase: saved.matchCase, selectionStart: saved.start, selectionEnd: saved.end, all }); }
    catch (error) { message = error?.errorCode === 'source_search_limit' ? '匹配数量或替换结果超出限制，请缩小查找范围。' : '当前文本或查找内容超出支持范围。'; refresh(); return false; }
    if (!plan.changed) { message = plan.count ? '替换内容与原文相同，未修改。' : '请先选中一处匹配文本。'; refresh(); return false; }
    if (!owns(saved)) return false;
    let sawInput = false;
    const observeInput = () => { sawInput = true; };
    executing = true;
    try {
      textarea.focus({ preventScroll: true });
      if (!owns(saved) || document.activeElement !== textarea) return false;
      textarea.setSelectionRange(plan.start, plan.end, 'forward');
      if (!owns(saved) || document.activeElement !== textarea || textarea.selectionStart !== plan.start || textarea.selectionEnd !== plan.end) return false;
      const expected = saved.text.slice(0, plan.start) + plan.replacement + saved.text.slice(plan.end);
      textarea.addEventListener('input', observeInput);
      try { document.execCommand('insertText', false, plan.replacement); } catch { /* Never retry with a history-destroying fallback. */ }
      if (!sameOwner(saved)) return false;
      const actual = textarea.value;
      if (actual === saved.text) {
        restore(saved); message = '当前浏览器无法保留撤销记录，未执行替换。'; return false;
      }
      const exact = actual === expected;
      // A native input listener can change the active source synchronously.
      // Only the same owner receives fallback input, and never a second input.
      if (!sawInput && sameOwner(saved) && textarea.value === actual) textarea.dispatchEvent(new Event('input', { bubbles: true }));
      if (!sameOwner(saved) || textarea.value !== actual) return false;
      if (exact && query.value === saved.query && matchCase.checked === saved.matchCase && replacement.value === saved.replacement) {
        textarea.setSelectionRange(plan.selectionStart, plan.selectionEnd, 'none');
        if (!sameOwner(saved) || textarea.value !== actual || query.value !== saved.query
          || matchCase.checked !== saved.matchCase || replacement.value !== saved.replacement) return false;
        revealSourceOffset(textarea, actual, plan.selectionStart);
      }
      message = exact ? '已替换 {0} 处；请按普通流程保存。' : '替换未能完整应用，请检查原文或撤销后重试。';
      messageCount = plan.count;
      return exact;
    } finally {
      textarea.removeEventListener('input', observeInput); executing = false; refresh();
    }
  }
  const keepSelection = event => { if (!compositions.size && event.button === 0) event.preventDefault(); };
  const nextMatch = event => navigate(false, event), previousMatch = event => navigate(true, event);
  const replaceCurrent = event => perform(false, event), replaceEvery = event => perform(true, event);
  const changed = () => { if (!executing) message = ''; refresh(); };
  const sourceInput = () => { if (!executing) message = ''; refresh(); };
  const keydown = event => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || compositions.size || executing || event.repeat || event.altKey) return;
    const source = event.target === textarea, inPanel = panel.contains(event.target);
    if (!source && !inPanel) return;
    const find = source && !event.shiftKey && (event.ctrlKey || event.metaKey) && event.key?.toLowerCase() === 'f';
    const step = !event.ctrlKey && !event.metaKey && (event.key === 'F3' || (event.target === query && event.key === 'Enter'));
    const escape = inPanel && event.key === 'Escape' && !event.ctrlKey && !event.metaKey;
    if (!(find || step || escape) || !available(context())) return;
    event.preventDefault(); event.stopPropagation();
    if (find) open(event); else if (escape) close(); else navigate(event.shiftKey, event);
  };
  const compositionStart = event => { compositions.add(event.target); refresh(); };
  const compositionEnd = event => { compositions.delete(event.target); refresh(); };
  openButton.addEventListener('click', open); closeButton.addEventListener('click', close);
  previous.addEventListener('click', previousMatch); next.addEventListener('click', nextMatch);
  replace.addEventListener('click', replaceCurrent); replaceAll.addEventListener('click', replaceEvery);
  for (const button of [openButton, previous, next, replace, replaceAll, closeButton]) button.addEventListener('pointerdown', keepSelection);
  query.addEventListener('input', changed); replacement.addEventListener('input', changed); matchCase.addEventListener('change', changed);
  for (const field of [textarea, query, replacement]) {
    field.addEventListener('compositionstart', compositionStart); field.addEventListener('compositionend', compositionEnd);
  }
  textarea.addEventListener('input', sourceInput); textarea.addEventListener('keydown', keydown); panel.addEventListener('keydown', keydown);
  for (const type of ['select', 'keyup', 'click', 'focus']) textarea.addEventListener(type, refresh);
  document.addEventListener?.('close', refresh, true);
  const unsubscribe = onLanguageChange(refresh);
  refresh();
  return Object.freeze({ refresh, dispose() {
    if (disposed) return; disposed = true; compositions.clear();
    if (typeof unsubscribe === 'function') unsubscribe();
    openButton.removeEventListener('click', open); closeButton.removeEventListener('click', close);
    previous.removeEventListener('click', previousMatch); next.removeEventListener('click', nextMatch);
    replace.removeEventListener('click', replaceCurrent); replaceAll.removeEventListener('click', replaceEvery);
    for (const button of [openButton, previous, next, replace, replaceAll, closeButton]) button.removeEventListener('pointerdown', keepSelection);
    query.removeEventListener('input', changed); replacement.removeEventListener('input', changed); matchCase.removeEventListener('change', changed);
    for (const field of [textarea, query, replacement]) {
      field.removeEventListener('compositionstart', compositionStart); field.removeEventListener('compositionend', compositionEnd);
    }
    textarea.removeEventListener('input', sourceInput); textarea.removeEventListener('keydown', keydown); panel.removeEventListener('keydown', keydown);
    for (const type of ['select', 'keyup', 'click', 'focus']) textarea.removeEventListener(type, refresh);
    document.removeEventListener?.('close', refresh, true);
    tools.remove(); container.classList.remove('source-search-container');
  } });
}

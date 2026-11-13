import { inspectSceneHUD2DDocument } from '../../engine/scene-hud2d.mjs';
import { resolveSceneHUD2DView } from '../../engine/scene-hud2d-view.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

const anchors = ['top-left','top-center','top-right','center-left','center','center-right','bottom-left','bottom-center','bottom-right'];
const anchorLabels = ['左上','上中','右上','左中','居中','右中','左下','下中','右下'];
const copy = value => JSON.parse(JSON.stringify(value));
const number = value => value.trim() === '' || !Number.isFinite(Number(value)) ? value : Number(value);

// Only the elements token is replaced for an existing source. Ordinary editor
// bytes outside it (including BOM, whitespace and line endings) are preserved.
function editHUDSource(content, sceneId, elements) {
  const before = inspectSceneHUD2DDocument(content);
  if (!before.ok || before.value?.sceneObjectId !== sceneId) throw Error('Invalid HUD source.');
  const proposed = { format: 'viento-scene-hud2d', schemaVersion: 1, sceneObjectId: sceneId, elements };
  if (!inspectSceneHUD2DDocument(JSON.stringify(proposed)).ok) throw Error('Invalid HUD fields.');
  if (JSON.stringify(before.value.elements) === JSON.stringify(elements)) return content;
  const token = locateJsonSource(parseJsonSource(content), '/elements');
  if (!token?.exact) throw Error('HUD elements source unavailable.');
  const after = content.slice(0, token.start) + JSON.stringify(elements) + content.slice(token.end);
  if (!inspectSceneHUD2DDocument(after).ok) throw Error('Invalid HUD source.');
  return after;
}

export function setupSceneHUD2D({ getContext = () => ({}), inspect = async () => null,
  request = async () => null, command = async () => null, applied = async () => {}, setBusy = () => {} } = {}) {
  if (!document.getElementById('sceneHUD2DStyle')) {
    const style = document.createElement('link'); style.id = 'sceneHUD2DStyle'; style.rel = 'stylesheet'; style.href = '/web/scene-hud2d.css';
    (document.head || document.body).append(style);
  }
  const dialog = document.createElement('dialog'); dialog.id = 'sceneHUD2DDialog'; dialog.className = 'scene-hud2d';
  dialog.setAttribute('aria-labelledby', 'sceneHUD2DTitle'); dialog.setAttribute('data-viento-close-guard', 'true');
  dialog.innerHTML = `<header><h2 id="sceneHUD2DTitle" data-i18n="场景 HUD"></h2><button id="sceneHUD2DClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回构建"></button></header>
    <main><p id="sceneHUD2DSource"></p><button id="sceneHUD2DRefresh" type="button" class="doc-btn doc-btn-ghost" data-i18n="重新读取工程"></button>
    <fieldset id="sceneHUD2DFields" disabled><legend data-i18n="场景 HUD"></legend>
      <section id="sceneHUD2DLocation"><label><span data-i18n="文档类型"></span><select id="sceneHUD2DType"></select></label><label><span data-i18n="原文路径"></span><input id="sceneHUD2DPath" spellcheck="false" maxlength="1024"></label></section>
      <section class="hud-elements"><h3 data-i18n="HUD 元素"></h3><ol id="sceneHUD2DList"></ol>
      <div class="hud-actions"><button id="sceneHUD2DAddLabel" type="button" class="doc-btn" data-i18n="添加文本"></button><button id="sceneHUD2DAddBar" type="button" class="doc-btn" data-i18n="添加状态条"></button>
      <button id="sceneHUD2DUp" type="button" class="doc-btn doc-btn-ghost" data-i18n="上移"></button><button id="sceneHUD2DDown" type="button" class="doc-btn doc-btn-ghost" data-i18n="下移"></button><button id="sceneHUD2DRemove" type="button" class="doc-btn doc-btn-ghost" data-i18n="删除元素"></button></div></section>
      <section id="sceneHUD2DItem" hidden><label><span data-i18n="屏幕锚点"></span><select id="sceneHUD2DAnchor"></select></label>
      <div class="hud-grid"><label><span data-i18n="偏移 X"></span><input id="sceneHUD2DX" inputmode="numeric"></label><label><span data-i18n="偏移 Y"></span><input id="sceneHUD2DY" inputmode="numeric"></label>
      <label><span data-i18n="宽度"></span><input id="sceneHUD2DWidth" inputmode="numeric"></label><label><span data-i18n="高度"></span><input id="sceneHUD2DHeight" inputmode="numeric"></label></div>
      <section id="sceneHUD2DLabelFields"><div class="hud-grid"><label><span data-i18n="字号"></span><input id="sceneHUD2DFontSize" inputmode="numeric"></label><label><span data-i18n="文字颜色"></span><input id="sceneHUD2DColor" spellcheck="false"></label></div>
      <label><span data-i18n="内容来源"></span><select id="sceneHUD2DContentKind"><option value="literal" data-i18n="固定文本"></option><option value="state" data-i18n="项目状态"></option></select></label>
      <label id="sceneHUD2DTextField"><span data-i18n="文本内容"></span><textarea id="sceneHUD2DText" rows="2"></textarea></label>
      <section id="sceneHUD2DStateLabel"><label><span data-i18n="前缀"></span><textarea id="sceneHUD2DPrefix" rows="1"></textarea></label><label><span data-i18n="后缀"></span><textarea id="sceneHUD2DSuffix" rows="1"></textarea></label><label><span data-i18n="缺失时显示"></span><textarea id="sceneHUD2DMissing" rows="2"></textarea></label></section></section>
      <label id="sceneHUD2DKeyField"><span data-i18n="状态键"></span><input id="sceneHUD2DKey" spellcheck="false"></label>
      <section id="sceneHUD2DBarFields"><div class="hud-grid"><label><span data-i18n="最小值"></span><input id="sceneHUD2DMin" inputmode="decimal"></label><label><span data-i18n="最大值"></span><input id="sceneHUD2DMax" inputmode="decimal"></label>
      <label><span data-i18n="缺失或非数字时的值"></span><input id="sceneHUD2DFallback" inputmode="decimal"></label><label><span data-i18n="填充颜色"></span><input id="sceneHUD2DFillColor" spellcheck="false"></label><label><span data-i18n="背景颜色"></span><input id="sceneHUD2DBackgroundColor" spellcheck="false"></label></div></section></section>
    </fieldset>
    <section class="hud-preview"><h3 data-i18n="HUD 预览"></h3><p data-i18n="示例只用于预览，不保存也不读取运行状态。"></p><p data-i18n="HUD 预览仅为位置和状态示意，实际字体与行距以运行引擎为准。"></p><label><span data-i18n="预览示例状态"></span><select id="sceneHUD2DSample"><option value="missing" data-i18n="缺失"></option><option value="zero">0</option><option value="false">false</option><option value="empty" data-i18n="空字符串"></option><option value="number" data-i18n="数值示例"></option></select></label>
      <label id="sceneHUD2DSampleNumberField" hidden><span data-i18n="数值示例"></span><input id="sceneHUD2DSampleNumber" inputmode="decimal" value="50"></label>
      <canvas id="sceneHUD2DCanvas" data-i18n-aria-label="HUD 预览"></canvas><p id="sceneHUD2DPreviewStatus" role="status"></p></section>
    <section id="sceneHUD2DReview" hidden><h3 data-i18n="HUD 修改审阅"></h3><p id="sceneHUD2DRelation"></p><pre id="sceneHUD2DReviewText" tabindex="0"></pre></section></main>
    <p id="sceneHUD2DStatus" role="status" aria-live="polite"></p><footer><button id="sceneHUD2DCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="审阅 HUD 设置"></button><button id="sceneHUD2DSave" type="button" class="doc-btn" data-i18n="保存 HUD 设置"></button><button id="sceneHUD2DCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector('#sceneHUD2D' + suffix);
  const names = ['Anchor','X','Y','Width','Height','FontSize','Color','ContentKind','Text','Key','Prefix','Suffix','Missing','Min','Max','Fallback','FillColor','BackgroundColor'];
  let enabled = false, disposed = false, owner = null, epoch = 0, catalog = null, elements = [], selected = '', objectId = '';
  let baseline = '', ticket = null, pending = null, blocked = false, phase = '', message = '', recoverDraft = false, hostBusy = false;
  const eligible = () => { const c = getContext(); return enabled && !disposed && c.visible && c.editable && !c.busy && !c.dirty && !c.creating && typeof c.session === 'string' && c.sceneId; };
  const owns = () => { const c = getContext(); return dialog.open && eligible() && owner && owner.sceneId === c.sceneId && owner.session === c.session && owner.token === c.sourceToken; };
  const signature = () => JSON.stringify([el('Type').value, el('Path').value, elements]);
  const dirty = () => Boolean(pending || catalog && signature() !== baseline);
  const approved = () => ticket && ticket.catalog === catalog && ticket.signature === signature();
  const busy = value => { if (hostBusy !== value) { hostBusy = value; setBusy(value); } };
  const selectedItem = () => elements.find(item => item.id === selected);
  function seed(kind) {
    const common = { id: crypto.randomUUID(), kind, anchor: 'top-left', offset: [16,16], size: kind === 'label' ? [200,32] : [200,20] };
    return kind === 'label' ? { ...common, fontSize: 20, color: '#ffffff', content: { kind: 'literal', text: '' } }
      : { ...common, key: 'health', min: 0, max: 100, fallback: 0, fillColor: '#37c98c', backgroundColor: '#334455' };
  }
  function showItem() {
    const item = selectedItem(); el('Item').hidden = !item;
    if (!item) return;
    el('Anchor').value = item.anchor;
    for (const [name, value] of [['X',item.offset[0]],['Y',item.offset[1]],['Width',item.size[0]],['Height',item.size[1]],
      ['FontSize',item.fontSize ?? ''],['Color',item.color ?? ''],['ContentKind',item.content?.kind ?? 'literal'],['Text',item.content?.text ?? ''],
      ['Key',item.kind === 'bar' ? item.key : item.content?.key ?? ''],['Prefix',item.content?.prefix ?? ''],['Suffix',item.content?.suffix ?? ''],['Missing',item.content?.missing ?? ''],
      ['Min',item.min ?? ''],['Max',item.max ?? ''],['Fallback',item.fallback ?? ''],['FillColor',item.fillColor ?? ''],['BackgroundColor',item.backgroundColor ?? '']]) el(name).value = String(value);
    el('LabelFields').hidden = item.kind !== 'label'; el('BarFields').hidden = item.kind !== 'bar';
    el('TextField').hidden = item.kind !== 'label' || item.content.kind !== 'literal';
    el('StateLabel').hidden = item.kind !== 'label' || item.content.kind !== 'state';
    el('KeyField').hidden = item.kind !== 'bar' && item.content.kind !== 'state';
  }
  function draw() {
    const canvas = el('Canvas'), context = canvas.getContext?.('2d'); if (!context) return;
    const viewport = catalog?.scene?.viewport, rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.min(4096, Math.round(rect.width || 500))), height = Math.max(1, Math.min(4096, Math.round(rect.height || 300)));
    canvas.width = width; canvas.height = height; context.clearRect(0,0,width,height); context.fillStyle = '#0b1523'; context.fillRect(0,0,width,height);
    canvas.dataset.view = ''; if (!viewport || !owner) return;
    try {
      const choice = el('Sample').value, raw = el('SampleNumber').value;
      const value = choice === 'zero' ? 0 : choice === 'false' ? false : choice === 'empty' ? '' : choice === 'number' ? number(raw) : undefined;
      if (choice === 'number' && (typeof value !== 'number' || Math.abs(value) > 1e9)) throw Error('Invalid sample');
      const keys = [...new Set(elements.map(item => item.kind === 'bar' ? item.key : item.content?.kind === 'state' ? item.content.key : '').filter(Boolean))];
      const state = value === undefined ? [] : keys.map(key => ({ key, value }));
      const document = { format: 'viento-scene-hud2d', schemaVersion: 1, sceneObjectId: owner.sceneId, elements };
      const view = resolveSceneHUD2DView({ document, viewport: [...viewport], state });
      const scale = Math.min((width - 16) / viewport[0], (height - 16) / viewport[1]);
      if (!(scale > 0)) throw Error('Invalid preview size');
      const ox = (width - viewport[0] * scale) / 2, oy = (height - viewport[1] * scale) / 2;
      context.save(); context.translate(ox,oy); context.scale(scale,scale); context.beginPath(); context.rect(0,0,...viewport); context.clip();
      context.fillStyle = '#142536'; context.fillRect(0,0,...viewport);
      for (const item of view.elements) {
        const r = item.rect;
        if (item.kind === 'label') {
          context.save(); context.beginPath(); context.rect(r.x,r.y,r.width,r.height); context.clip(); context.fillStyle = item.color;
          context.font = `${item.fontSize}px sans-serif`; context.textBaseline = 'top';
          // Godot's non-wrapping Label treats CR and LF as independent line
          // breaks (including CRLF). Preview metrics are illustrative only.
          const tab = Math.max(1, context.measureText(' ').width * 4), lineHeight = item.fontSize * 1.55;
          item.text.split(/[\r\n]/).forEach((line,index) => {
            let x = r.x;
            for (const [partIndex, part] of line.split('\t').entries()) {
              if (partIndex) x = r.x + (Math.floor((x - r.x) / tab) + 1) * tab;
              if (part) { context.fillText(part,x,r.y + index * lineHeight); x += context.measureText(part).width; }
            }
          });
          context.restore();
        }
        else { context.fillStyle = item.backgroundColor; context.fillRect(r.x,r.y,r.width,r.height); context.fillStyle = item.fillColor; context.fillRect(r.x,r.y,r.width * item.ratio,r.height); }
      }
      context.restore(); canvas.dataset.view = JSON.stringify(view); el('PreviewStatus').textContent = '';
    } catch { el('PreviewStatus').textContent = t('HUD 字段或示例无效，预览已隐藏。'); }
  }
  function renderList() {
    const list = el('List'), focused = document.activeElement?.dataset?.id; list.replaceChildren(); let restore = null;
    for (const item of elements) {
      const row = document.createElement('li'), button = document.createElement('button'); button.type = 'button';
      button.dataset.id = item.id; button.setAttribute('aria-pressed', String(item.id === selected)); button.disabled = !owns() || Boolean(phase) || blocked; if (item.id === focused) restore = button;
      const summary = item.kind === 'bar' ? item.key : item.content?.kind === 'state' ? item.content.key : item.content?.text || '';
      button.textContent = `${t(item.kind === 'label' ? '文本' : '状态条')}${summary ? ` · ${[...summary].slice(0, 40).join('')}` : ''} · ${item.id}`;
      button.addEventListener('click', () => { if (!owns() || phase || blocked) return; selected = item.id; showItem(); render(); }); row.append(button); list.append(row);
    }
    restore?.focus({ preventScroll: true });
  }
  function render() {
    translatePage(dialog); dialog.dataset.dirty = String(dirty()); dialog.setAttribute('aria-busy', String(Boolean(phase)));
    const locked = !owns() || !catalog || Boolean(phase) || blocked, index = elements.findIndex(item => item.id === selected);
    el('Fields').disabled = locked; for (const name of ['Type','Path',...names]) el(name).disabled = locked;
    el('Location').hidden = Boolean(catalog?.manifest); el('AddLabel').disabled = locked || elements.length >= 32; el('AddBar').disabled = locked || elements.length >= 32;
    el('Up').disabled = locked || index <= 0; el('Down').disabled = locked || index < 0 || index >= elements.length - 1; el('Remove').disabled = locked || index < 0;
    el('Check').disabled = locked; el('Save').disabled = locked || !approved(); el('Refresh').disabled = !owns() || Boolean(phase);
    el('Close').disabled = phase === 'save' || Boolean(pending); el('Cancel').disabled = phase === 'save' || Boolean(pending);
    el('Review').hidden = !approved(); el('ReviewText').textContent = approved() ? ticket.content : '';
    el('Relation').textContent = approved() && !catalog.manifest ? t('保存会新建 HUD 正文和登记，并建立与场景的双向引用。场景正文保持原样。') : '';
    el('Source').textContent = catalog ? `${catalog.scene.sourcePath} · ${catalog.manifest?.sourcePath || objectId}` : '';
    el('Status').textContent = t(message); el('SampleNumberField').hidden = el('Sample').value !== 'number'; renderList(); draw();
  }
  function options(select, rows) { select.replaceChildren(); for (const [value,label] of rows) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); } }
  function populate(next) {
    if (next?.format !== 'viento-hud2d-author-context' || next.schemaVersion !== 1 || next.scene?.objectId !== owner.sceneId || !Array.isArray(next.documentTypes) || !next.documentTypes.length) throw Error('Invalid HUD context.');
    catalog = next; objectId = next.manifest?.objectId || objectId || crypto.randomUUID();
    options(el('Type'), next.documentTypes.map(row => [row.id,row.label])); el('Type').value = (next.documentTypes.find(row => row.id === 'hud2d') || next.documentTypes.find(row => row.id === 'document') || next.documentTypes[0]).id;
    el('Path').value = `${next.documentRoot}/hud/${objectId}.json`;
    const parsed = next.manifest ? inspectSceneHUD2DDocument(next.manifest.content) : null;
    if (next.manifest && (!parsed.ok || parsed.value.sceneObjectId !== owner.sceneId)) throw Error('Invalid selected HUD.');
    elements = copy(parsed?.value.elements || []); selected = elements[0]?.id || ''; showItem(); baseline = signature(); ticket = null;
  }
  async function reload() {
    if (!owns() || phase) return false;
    const generation = epoch, retained = recoverDraft ? { type: el('Type').value, path: el('Path').value, elements: copy(elements), selected } : null, selectedId = catalog?.manifest?.objectId || null;
    phase = 'read'; ticket = null; render();
    try {
      const next = await inspect(owner.sceneId); if (generation !== epoch || !owns()) return false;
      if (pending) {
        const found = next.manifest;
        if (!found || found.objectId !== pending.id || found.content !== pending.content) { blocked = true; message = '保存结果尚未确认。请重新读取工程核对，勿重复提交。'; return false; }
        await applied(pending.result || { status: 'observed', changes: [] }); owner.token = getContext().sourceToken;
        if (generation !== epoch || !owns()) return false; pending = null;
      }
      if (retained && selectedId !== (next.manifest?.objectId || null)) throw Error('HUD selection changed.');
      populate(next);
      if (retained) { el('Type').value = retained.type; el('Path').value = retained.path; elements = retained.elements; selected = retained.selected; showItem(); }
      recoverDraft = false; blocked = false; message = 'HUD 设置已读取。修改后请审阅并显式保存。'; return true;
    } catch { if (generation === epoch) { blocked = true; message = 'HUD 设置读取失败。原表单保留，请重新读取工程。'; } return false; }
    finally { if (generation === epoch) { phase = ''; render(); } }
  }
  function content() {
    const value = { format: 'viento-scene-hud2d', schemaVersion: 1, sceneObjectId: owner.sceneId, elements };
    const text = catalog.manifest ? editHUDSource(catalog.manifest.content, owner.sceneId, elements) : JSON.stringify(value, null, 2) + '\n';
    if (!inspectSceneHUD2DDocument(text).ok) throw Error('Invalid HUD settings.'); return text;
  }
  async function check() {
    if (!owns() || !catalog || phase || blocked) return;
    const generation = epoch, form = signature(); ticket = null; phase = 'check'; render();
    try {
      const text = content(); if (catalog.manifest && text === catalog.manifest.content) { message = 'HUD 设置没有变化。'; return; }
      const payload = catalog.manifest ? { action: 'hud2d-save', sceneId: owner.sceneId, sceneVersion: catalog.scene.sourceRevision, documentId: catalog.manifest.objectId, expectedVersion: catalog.manifest.sourceRevision, content: text }
        : { command: 'hud2d.create', mode: 'preview', worldId: catalog.worldId, baseRevision: catalog.baseRevision, actorRef: { kind: 'user', id: 'studio-hud2d' }, objectId, documentType: el('Type').value, sourcePath: el('Path').value, content: text, sceneObjectId: owner.sceneId, sceneObjectRevision: catalog.scene.objectRevision, sceneSourceRevision: catalog.scene.sourceRevision };
      if (!catalog.manifest) { const preview = await command(payload); if (preview?.status !== 'preview' || preview.worldId !== catalog.worldId || preview.baseRevision !== catalog.baseRevision) throw Error('Invalid preview.'); }
      if (generation === epoch && owns() && form === signature()) { ticket = { signature: form, content: text, payload, catalog }; message = '请核对完整 HUD 原文；保存后用于下一次构建。'; }
    } catch { if (generation === epoch) message = 'HUD 设置无效或来源已变化，请检查字段后重新读取。'; }
    finally { if (generation === epoch) { phase = ''; render(); } }
  }
  async function save() {
    if (!owns() || phase || blocked || !approved()) { render(); return; }
    const generation = epoch, selectedTicket = ticket; phase = 'save'; blocked = true;
    pending = { id: catalog.manifest?.objectId || objectId, content: selectedTicket.content, result: null }; busy(true); render();
    try { pending.result = catalog.manifest ? await request(selectedTicket.payload) : await command({ ...selectedTicket.payload, mode: 'apply' }); message = '保存响应已收到，正在重新读取工程核对。'; }
    catch (error) {
      const rejected = ['world_revision_conflict','world_create_path_conflict','world_write_busy','world_command_invalid','world_hud2d_invalid','build_hud2d_invalid','build_hud2d_dependency_unavailable','scene_hud2d_document_conflict','scene_hud2d_scene_conflict','scene_hud2d_selection_conflict'].includes(error?.code || error?.errorCode);
      if (rejected) { pending = null; recoverDraft = true; message = '保存因冲突或无效配置被拒绝。重新读取后保留表单，需重新审阅。'; }
      else message = '保存结果尚未确认。请重新读取工程核对，勿重复提交。';
    } finally { if (generation === epoch) { phase = ''; busy(false); ticket = null; render(); if (owns()) await reload(); } }
  }
  function close(event) {
    event?.preventDefault(); if (phase === 'save' || pending) return;
    if (dirty() && !window.confirm(t('放弃未保存的 HUD 修改？'))) return;
    epoch++; catalog = null; ticket = null; owner = null; dialog.close();
  }
  function updateField(name) {
    const item = selectedItem(); if (!item || !owns() || phase || blocked) return;
    const v = el(name).value;
    if (name === 'Anchor') item.anchor = v;
    else if (['X','Y'].includes(name)) item.offset[name === 'X' ? 0 : 1] = number(v);
    else if (['Width','Height'].includes(name)) item.size[name === 'Width' ? 0 : 1] = number(v);
    else if (name === 'ContentKind' && item.kind === 'label') item.content = v === 'state' ? { kind: 'state', key: 'score', prefix: '', suffix: '', missing: '—' } : { kind: 'literal', text: '' };
    else if (name === 'Key') { if (item.kind === 'bar') item.key = v; else if (item.content.kind === 'state') item.content.key = v; }
    else if (['Text','Prefix','Suffix','Missing'].includes(name) && item.content) item.content[name.toLowerCase()] = v;
    else if (['FontSize','Min','Max','Fallback'].includes(name)) item[name[0].toLowerCase()+name.slice(1)] = number(v);
    else if (['Color','FillColor','BackgroundColor'].includes(name)) item[name[0].toLowerCase()+name.slice(1)] = v;
    ticket = null; if (name === 'ContentKind') showItem(); render();
  }
  for (const name of names) for (const event of ['input','change']) el(name).addEventListener(event, () => updateField(name));
  for (const name of ['Type','Path']) for (const event of ['input','change']) el(name).addEventListener(event, () => { ticket = null; render(); });
  for (const name of ['Sample','SampleNumber']) for (const event of ['input','change']) el(name).addEventListener(event, render);
  for (const kind of ['label','bar']) el(kind === 'label' ? 'AddLabel' : 'AddBar').addEventListener('click', () => { if (!owns() || phase || blocked || elements.length >= 32) return; const item = seed(kind); elements.push(item); selected = item.id; ticket = null; showItem(); render(); });
  for (const [name,delta] of [['Up',-1],['Down',1]]) el(name).addEventListener('click', () => { if (!owns() || phase || blocked) return; const i = elements.findIndex(item => item.id === selected), j = i + delta; if (i < 0 || j < 0 || j >= elements.length) return; [elements[i],elements[j]] = [elements[j],elements[i]]; ticket = null; render(); });
  el('Remove').addEventListener('click', () => { if (!owns() || phase || blocked) return; const i = elements.findIndex(item => item.id === selected); if (i < 0) return; elements.splice(i,1); selected = elements[Math.min(i,elements.length-1)]?.id || ''; ticket = null; showItem(); render(); });
  el('Check').addEventListener('click', () => void check()); el('Save').addEventListener('click', () => void save());
  el('Refresh').addEventListener('click', () => { if (!dirty() || pending || window.confirm(t('放弃未保存的 HUD 修改？'))) void reload(); });
  el('Close').addEventListener('click', close); el('Cancel').addEventListener('click', close); dialog.addEventListener('cancel', close);
  const unsubscribe = onLanguageChange(() => { const current = el('Anchor').value; options(el('Anchor'), anchors.map((value,index) => [value,t(anchorLabels[index])])); el('Anchor').value = current; render(); });
  options(el('Anchor'), anchors.map((value,index) => [value,t(anchorLabels[index])]));
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (!disposed && dialog.open) draw(); }) : null; observer?.observe(el('Canvas'));
  return { async open(sceneId) {
    if (!eligible() || getContext().sceneId !== sceneId || dialog.open) return false;
    const context = getContext(); epoch++; owner = { sceneId, session: context.session, token: context.sourceToken };
    catalog = null; elements = []; selected = ''; pending = null; recoverDraft = false; objectId = ''; baseline = ''; blocked = false; phase = ''; message = '';
    dialog.showModal(); render(); return reload();
  }, setAvailable(value, commands = []) { enabled = value === true && commands.includes('hud2d.create'); if (dialog.open) render(); },
  dispose() { disposed = true; epoch++; busy(false); observer?.disconnect(); unsubscribe?.(); dialog.close(); dialog.remove(); } };
}

import { t, translatePage, onLanguageChange } from '../i18n/index.js';
import { fetchJsonApiRequest, fetchWithTimeout } from './app-services.js';
import { createScenePreviewCanvas } from './app-scene-preview-canvas.js';
import { SCENE_PREVIEW_API_PATH } from '../../engine/scene-preview-contract.mjs';

const PREVIEW_API = SCENE_PREVIEW_API_PATH;
const previewUUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const diagnosticLabels = {
  build_scene_required: '请选择已登记且可读取的场景文档。',
  build_scene_format: '场景必须使用 viento-scene2d 第 1 版 JSON 格式。',
  build_scene_json: '场景 JSON 格式有误，请打开原文检查。',
  build_scene_value: '场景字段的值不符合要求，请检查标出的位置。',
  build_actor_value: '角色字段的值不符合要求，请检查标出的位置。',
  build_actor_missing: '场景引用的角色不存在或原文不可用。',
  build_actor_duplicate: '同一个角色不能在场景中重复声明。',
  build_actor_unlinked: '请先在世界与对象中登记场景到角色的关系。',
  build_projection_invalid: '场景引用的投影无效，请检查投影原文。',
  build_projection_source: '投影的来源对象不可读取或不是普通对象，请检查来源。',
  build_projection_unlinked: '投影缺少来源关系，请检查对象登记。',
  build_projection_runtime: '此投影不支持当前二维场景，请选择兼容的游戏投影。',
  build_image_unsupported: '请选择已登记的 PNG、JPEG、WebP 或 SVG 图片。',
  build_image_unbound: '请先在世界与对象中将图片绑定到角色或场景。',
  build_image_unverified: '图片缺少有效的内容校验信息，请重新导入。',
  build_resource_changed: '图片内容与登记信息不符，请重新导入后检查计划。',
  build_resource_unavailable: '构建所需素材不可读取，请检查素材位置。',
  build_feature_unsupported: '场景使用了当前后端尚未支持的功能。',
  world_recovery_required: '工程存在未完成的提交，请先在世界与对象中恢复。',
};

export function setupScenePreview({ container, getContext = () => ({}), openSource = () => false, editScene = () => {} }) {
  container.classList.add('scene-preview');
  container.innerHTML = `<p class="build-note" data-i18n="查看已保存场景的静态布局，无需构建或安装运行引擎。移动、输入和状态变化请使用运行测试。"></p>
    <p id="scenePreviewDraft" class="build-hint" hidden data-i18n="存在未保存草稿；预览仍使用上次保存的场景和投影。"></p>
    <div class="scene-preview-toolbar"><button id="scenePreviewRefresh" type="button" class="doc-btn" data-i18n="刷新场景预览"></button>
    <button id="scenePreviewFit" type="button" class="doc-btn doc-btn-ghost" data-i18n="适应画布"></button>
    <button id="scenePreviewZoomOut" type="button" class="doc-btn doc-btn-ghost" data-i18n="缩小"></button>
    <output id="scenePreviewZoom" aria-live="off"></output>
    <button id="scenePreviewZoomIn" type="button" class="doc-btn doc-btn-ghost" data-i18n="放大"></button>
    <label class="scene-preview-grid"><input id="scenePreviewGrid" type="checkbox"><span data-i18n="显示网格"></span></label></div>
    <p id="scenePreviewMessage" role="status" aria-live="polite"></p>
    <p id="scenePreviewSummary" class="build-hint"></p>
    <p class="build-hint" id="scenePreviewHelp" data-i18n="点击角色查看属性；拖动画布平移，滚轮缩放。画布聚焦后可用方向键平移、加减键缩放、0 适应画布。"></p>
    <div class="scene-preview-layout"><canvas id="scenePreviewCanvas" tabindex="0" aria-describedby="scenePreviewHelp" data-i18n-aria-label="已保存的二维场景预览"></canvas>
    <aside><h3 data-i18n="场景对象"></h3><ol id="scenePreviewObjects"></ol><p id="scenePreviewSelection" role="status" aria-live="polite"></p>
    <section id="scenePreviewInspector" aria-labelledby="scenePreviewInspectorTitle"><h3 id="scenePreviewInspectorTitle" data-i18n="对象属性"></h3><div id="scenePreviewProperties"></div></section></aside></div>
    <div class="scene-preview-toolbar"><button id="scenePreviewEdit" type="button" class="doc-btn" data-i18n="编辑场景"></button>
    <button id="scenePreviewSource" type="button" class="doc-btn doc-btn-ghost" data-i18n="打开场景原文"></button></div>
    <ul id="scenePreviewDiagnostics" class="scene-diagnostics"></ul>`;
  const el = id => container.querySelector(`#${id}`);
  const node = (tag, text, className = '') => { const value = document.createElement(tag); value.textContent = text; value.className = className; return value; };
  let available = false, visible = false, sceneId = '', requestEpoch = 0, controller = null, model = null, selected = null, disposed = false;
  let state = 'empty', errorKey = '', diagnostics = [], imageErrors = [], images = new Map();
  let objectsSignature = '', inspectorSignature = '';
  const canvas = createScenePreviewCanvas({ canvas: el('scenePreviewCanvas'), onSelect(id) { selected = id; renderSelection(); },
    onViewChange(view) { el('scenePreviewZoom').textContent = `${Math.round(view.scale * 100)}%`; } });
  const release = id => {
    if (!previewUUID.test(id || '')) return;
    void fetchJsonApiRequest(`${PREVIEW_API}?previewId=${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }, 5000, t('释放场景预览')).catch(() => {});
  };
  function reset() {
    requestEpoch++; controller?.abort(); controller = null;
    release(model?.previewId); model = null; selected = null; diagnostics = []; imageErrors = [];
    canvas.setScene(null); canvas.setImages(new Map());
    for (const image of images.values()) { image.width = 0; image.height = 0; }
    images = new Map(); state = 'empty'; errorKey = '';
  }
  async function navigate(location) {
    try { await openSource(location.sourcePath, location); }
    catch { errorKey = '无法打开原文，请返回编辑器查找该文档。'; render(); }
  }
  function sourceButton(label, location, id) {
    const button = node('button', t(label), 'doc-btn doc-btn-ghost'); button.type = 'button'; if (id) button.id = id;
    button.addEventListener('click', () => void navigate(location)); return button;
  }
  function renderSelection() {
    const actors = model?.actors || [], actor = actors.find(item => item.objectId === selected);
    for (const button of el('scenePreviewObjects').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.objectId === selected));
    const properties = el('scenePreviewProperties');
    el('scenePreviewInspector').hidden = !actor;
    el('scenePreviewSelection').textContent = actor ? t('已选择：{0}', actor.name) : t('从画布或对象列表选择角色。');
    el('scenePreviewInspectorTitle').textContent = actor ? `${t('对象属性')} · ${actor.name}` : t('对象属性');
    const signature = JSON.stringify([actor || null, t('查看字段来源'), t('位置（中心）')]);
    if (signature === inspectorSignature) return;
    inspectorSignature = signature; properties.replaceChildren();
    if (!actor) return;
    const list = node('dl', '', 'scene-preview-properties');
    const rows = [['位置（中心）', 'position', actor.position.join(', ')], ['尺寸', 'size', actor.size.join(' × ')], ['颜色', 'color', actor.color],
      ['速度', 'speed', String(actor.speed)], ['控制', 'controls', t(actor.controls === 'arrows' ? '方向键' : '不接受输入')], ['场景图片', 'imageResourceId', actor.imageResourceId || t('不使用图片')]];
    for (const [label, field, value] of rows) {
      list.append(node('dt', t(label))); const cell = node('dd', value);
      const location = actor.fieldSources?.[field] || { ...actor.declaration, propertyPath: `${actor.declaration.propertyPath}/${field}` };
      const inherited = location.sourcePath === actor.sourcePath && location.sourcePath !== model.scene.sourcePath;
      cell.append(node('small', t(inherited ? '继承自投影' : '场景中的值')));
      const source = sourceButton('查看字段来源', location); source.setAttribute('aria-label', t('查看 {0} 的来源', t(label))); cell.append(source); list.append(cell);
    }
    properties.append(list, node('p', actor.objectId, 'build-monospace'), sourceButton('打开对象原文', { objectId: actor.objectId, sourcePath: actor.sourcePath }, 'scenePreviewActorSource'));
    if (actor.origin) properties.append(sourceButton('打开原 OC', actor.origin, 'scenePreviewOriginSource'));
  }
  function render() {
    translatePage(container); const context = getContext(), busy = state === 'loading';
    container.dataset.scenePreviewState = state; container.setAttribute('aria-busy', String(busy));
    el('scenePreviewDraft').hidden = !context.dirty && !context.creating;
    el('scenePreviewRefresh').disabled = !available || !sceneId || busy;
    for (const id of ['scenePreviewFit', 'scenePreviewZoomIn', 'scenePreviewZoomOut', 'scenePreviewGrid']) el(id).disabled = !model;
    el('scenePreviewEdit').disabled = !model || busy || !context.editable || context.dirty || context.creating || context.busy || context.canEditScene === false;
    el('scenePreviewSource').disabled = !model;
    el('scenePreviewMessage').textContent = errorKey ? t(errorKey) : t(busy ? '正在读取已保存场景与图片…' : state === 'ready'
      ? imageErrors.length ? '场景已载入，部分图片无法显示；占位图不会修改原始素材。' : '已载入保存时的布局。修改场景或投影后，刷新预览查看变化。'
      : state === 'invalid' ? '场景无法预览，请检查下方诊断。' : '请选择场景以查看预览。');
    el('scenePreviewSummary').textContent = model ? `${t('{0} × {1} · {2} 个角色', ...model.scene.viewport, model.actors.length)} · ${t('快照：{0}', model.snapshotId)}` : '';
    el('scenePreviewCanvas').hidden = !model; el('scenePreviewHelp').hidden = !model;
    const objects = el('scenePreviewObjects');
    const signature = JSON.stringify((model?.actors || []).map(actor => [actor.objectId, actor.name]));
    if (signature !== objectsSignature) {
      objectsSignature = signature; objects.replaceChildren();
      for (const actor of model?.actors || []) {
      const item = node('li', ''); const button = node('button', actor.name, 'doc-btn doc-btn-ghost'); button.type = 'button';
      button.dataset.objectId = actor.objectId; button.addEventListener('click', () => { selected = actor.objectId; canvas.select(selected); renderSelection(); });
        item.append(button); objects.append(item);
      }
    }
    renderSelection();
    const issues = el('scenePreviewDiagnostics'); issues.replaceChildren();
    for (const diagnostic of diagnostics) {
      const item = node('li', ''); item.append(node('p', `${t(diagnosticLabels[diagnostic.code] || '场景无法预览，请打开标出位置检查。')} (${diagnostic.code || 'scene_preview_failed'})`));
      if (diagnostic.sourcePath) { const link = sourceButton('打开原文', diagnostic); link.textContent += ` · ${diagnostic.sourcePath}${diagnostic.propertyPath || ''}`; item.append(link); } issues.append(item);
    }
    for (const id of imageErrors) issues.append(node('li', t('图片无法解码或超过预览内存限制：{0}', id)));
  }
  async function decode(resource, signal, epoch) {
    const url = new URL(resource.url, globalThis.location.href);
    if (url.origin !== globalThis.location.origin || url.pathname !== PREVIEW_API || url.searchParams.get('previewId') !== model.previewId || url.searchParams.get('resourceId') !== resource.id) throw new Error('Invalid preview resource URL');
    const blob = await fetchWithTimeout(url.href, { cache: 'no-store', signal }, 15000, t('读取预览图片'), async response => {
      if (!response.ok) throw new Error(`Image HTTP ${response.status}`);
      const value = await response.blob(); if (value.size !== resource.size) throw new Error('Image size changed'); return value;
    });
    if (signal.aborted || epoch !== requestEpoch) throw new DOMException('Aborted', 'AbortError');
    const users = model.actors.filter(actor => actor.imageResourceId === resource.id);
    const width = Math.max(1, ...users.map(actor => Math.ceil(actor.size[0]))), height = Math.max(1, ...users.map(actor => Math.ceil(actor.size[1])));
    const urlObject = URL.createObjectURL(blob), image = new Image();
    try {
      await new Promise((resolve, reject) => {
        const abort = () => { cleanup(); image.src = ''; reject(new DOMException('Aborted', 'AbortError')); };
        const timer = setTimeout(() => { cleanup(); image.src = ''; reject(new Error('Image decode timeout')); }, 15000);
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
        image.onload = () => { cleanup(); resolve(); }; image.onerror = () => { cleanup(); reject(new Error('Image decode failed')); };
        signal.addEventListener('abort', abort, { once: true }); image.src = urlObject;
      });
      if (signal.aborted || epoch !== requestEpoch) throw new DOMException('Aborted', 'AbortError');
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 64 * 1024 * 1024) throw new Error('Image dimensions exceed preview limit');
      const decoded = document.createElement('canvas'); decoded.width = width; decoded.height = height;
      decoded.getContext('2d').drawImage(image, 0, 0, width, height); return decoded;
    } finally { URL.revokeObjectURL(urlObject); image.onload = null; image.onerror = null; image.src = ''; }
  }
  async function refresh() {
    if (!available || !visible || !sceneId || disposed) return;
    reset(); const epoch = requestEpoch; controller = new AbortController(); const signal = controller.signal;
    state = 'loading'; render();
    try {
      const { payload } = await fetchJsonApiRequest(PREVIEW_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sceneId }), signal }, 30000, t('读取场景预览'));
      if (epoch !== requestEpoch || signal.aborted) { release(payload?.previewId); return; }
      if (!payload?.ok || payload.format !== 'viento-scene-preview' || !previewUUID.test(payload.previewId || '') || payload.scene?.objectId !== sceneId || !Array.isArray(payload.actors) || !Array.isArray(payload.resources)) {
        release(payload?.previewId); throw Object.assign(new Error('Invalid preview response'), { payload });
      }
      model = payload; canvas.setScene(model); render(); canvas.setVisible(true);
      let cursor = 0, pixelCount = 0;
      const worker = async () => {
        while (epoch === requestEpoch && !signal.aborted && cursor < payload.resources.length) {
          const resource = payload.resources[cursor++];
          try {
            const actors = payload.actors.filter(actor => actor.imageResourceId === resource.id);
            pixelCount += Math.max(1, ...actors.map(actor => Math.ceil(actor.size[0]))) * Math.max(1, ...actors.map(actor => Math.ceil(actor.size[1])));
            if (pixelCount > 16 * 1024 * 1024) throw new Error('Preview image memory limit');
            const image = await decode(resource, signal, epoch);
            if (epoch !== requestEpoch || signal.aborted) { image.width = 0; image.height = 0; return; }
            images.set(resource.id, image);
          } catch { if (epoch === requestEpoch && !signal.aborted) imageErrors.push(resource.id); }
        }
      };
      await Promise.all([worker(), worker()]);
      if (epoch !== requestEpoch || signal.aborted) return;
      canvas.setImages(images); state = 'ready'; render();
    } catch (error) {
      if (epoch !== requestEpoch || signal.aborted) return;
      diagnostics = error.payload?.diagnostics || error.payload?.data?.diagnostics || [];
      if (diagnostics.length) state = 'invalid';
      else { state = 'error'; errorKey = ['build_input_changed', 'world_read_conflict', 'scene_preview_superseded'].includes(error.payload?.errorCode)
        ? '工程内容正在变化，请刷新场景预览重试。' : '场景预览读取失败，请刷新重试。'; }
      render();
    } finally { if (epoch === requestEpoch) controller = null; }
  }
  el('scenePreviewRefresh').addEventListener('click', () => { if (state !== 'loading') void refresh(); });
  el('scenePreviewFit').addEventListener('click', () => canvas.fit());
  el('scenePreviewZoomIn').addEventListener('click', () => canvas.zoom(1.25));
  el('scenePreviewZoomOut').addEventListener('click', () => canvas.zoom(0.8));
  el('scenePreviewGrid').addEventListener('change', () => canvas.setGrid(el('scenePreviewGrid').checked));
  el('scenePreviewSource').addEventListener('click', () => { if (model) void navigate({ objectId: model.scene.objectId, sourcePath: model.scene.sourcePath }); });
  el('scenePreviewEdit').addEventListener('click', () => {
    const context = getContext(); if (model && state !== 'loading' && context.editable && !context.dirty && !context.creating && !context.busy && context.canEditScene !== false) editScene(sceneId);
  });
  const unsubscribe = onLanguageChange(() => { if (!disposed) render(); }); render();
  return {
    setAvailable(value) { if (available === value) { render(); return; } available = value; if (!value) reset(); render(); if (value && visible) void refresh(); },
    setScene(value) { if (sceneId === value) { render(); return; } sceneId = value || ''; reset(); render(); if (visible) void refresh(); },
    setVisible(value) { if (visible === value) { render(); return; } visible = value; canvas.setVisible(value); if (!value) { reset(); render(); } else void refresh(); },
    invalidate() { reset(); render(); if (visible) void refresh(); },
    destroy() { disposed = true; visible = false; reset(); unsubscribe?.(); canvas.destroy(); },
  };
}

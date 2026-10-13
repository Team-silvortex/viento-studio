import { createSceneCompositionMaterialization, buildSceneCompositionMaterializationCommand } from '../../engine/scene-composition-materialize.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';
import { WORLD_API_PATH } from '../../engine/world-query.mjs';
import { SCENE_PREVIEW_API_PATH } from '../../engine/scene-preview-contract.mjs';
import { API_PATHS } from '../../scripts/lib/doc-api-contract.mjs';
import { fetchJsonApiRequest } from './app-services.js';
import { readDocSource, requestWorldCommand } from './app-doc-service.js';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

const materializeErrors = {
  scene_composition_materialize_invalid: '配方或展开结果不可安全转换，请检查原文与预览。',
  scene_composition_materialize_conflict: '配方或工程已变化，请重新读取并审阅。',
  scene_composition_materialize_destination: '请选择当前文档类型，并填写新的场景名称和可用 JSON 路径。',
  world_revision_conflict: '配方或工程已变化，请重新读取并审阅。',
  world_read_conflict: '配方或工程已变化，请重新读取并审阅。',
  world_type_unknown: '文档类型已变化，请重新读取并审阅。',
  world_create_path_invalid: '请使用正文目录内可迁移的 JSON 文件路径。',
  world_create_path_conflict: '保存位置已被使用，请修改路径后重新审阅。',
  world_identity_conflict: '场景身份已被登记，请重新读取核对保存结果。',
  world_scene_invalid: '展开场景未通过创建检查，请查看详情。',
  world_recovery_required: '工程存在未完成的提交，请先在世界与对象中恢复。',
};
const materializeUuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const materializeRevision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const materializeDigest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');

// Saved recipe expansion is a read-only input. This dialog submits the existing
// scene.create transaction only after the exact independent copy was reviewed.
export function setupSceneMaterialize({ getContext = () => ({}), setBusy = () => {}, applied = async () => {} } = {}) {
  if (!document.getElementById('sceneMaterializeStyle')) {
    const style = document.createElement('link'); style.id = 'sceneMaterializeStyle'; style.rel = 'stylesheet'; style.href = '/web/scene-materialize.css';
    (document.head || document.body).append(style);
  }
  const dialog = document.createElement('dialog'); dialog.id = 'sceneMaterializeDialog'; dialog.className = 'project-build scene-materialize';
  dialog.setAttribute('aria-labelledby', 'sceneMaterializeTitle');
  dialog.innerHTML = `<header class="build-heading"><div><h2 id="sceneMaterializeTitle" data-i18n="从配方创建二维场景"></h2><p data-i18n="将当前已保存配方展开为独立场景，再沿用构建、行为与工程交付流程。"></p></div><button id="sceneMaterializeClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回预览"></button></header>
    <div class="scene-materialize-body"><p class="build-note" data-i18n="新场景是独立副本，不会与配方自动同步。配方、对象定义和素材保持原样；场景行为需另行添加。"></p>
    <p id="sceneMaterializeRecipe" class="build-monospace"></p><button id="sceneMaterializeRefresh" type="button" class="doc-btn doc-btn-ghost" data-i18n="重新读取工程"></button>
    <fieldset id="sceneMaterializeFields"><legend data-i18n="新场景设置"></legend><div class="scene-materialize-fields"><label><span data-i18n="场景名称"></span><input id="sceneMaterializeName" type="text" maxlength="160"></label><label><span data-i18n="文档类型"></span><select id="sceneMaterializeType"></select></label><label class="scene-materialize-path"><span data-i18n="原文路径"></span><input id="sceneMaterializePath" type="text" maxlength="1024" spellcheck="false"></label></div></fieldset>
    <section id="sceneMaterializeReview" hidden aria-labelledby="sceneMaterializeReviewTitle"><h3 id="sceneMaterializeReviewTitle" data-i18n="审阅独立场景"></h3><p id="sceneMaterializeSummary"></p><pre id="sceneMaterializeSource" tabindex="0"></pre></section>
    <details class="build-raw"><summary data-i18n="原始细节与日志"></summary><pre id="sceneMaterializeDetails" tabindex="0"></pre></details></div>
    <p id="sceneMaterializeStatus" role="status" aria-live="polite"></p><footer class="build-actions scene-materialize-footer"><button id="sceneMaterializeCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="审阅新场景"></button><button id="sceneMaterializeSave" type="button" class="doc-btn" data-i18n="保存独立场景"></button><button id="sceneMaterializeCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消创建"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector('#sceneMaterialize' + suffix);
  const fields = ['Name', 'Type', 'Path'], copy = value => JSON.parse(JSON.stringify(value));
  let enabled = false, disposed = false, epoch = 0, owner = null, operation = null, seed = null, draft = null, baseline = '';
  let review = null, saved = null, pendingApply = null, uncertain = false, needsRead = true, message = '', details = '', opener = null;
  const context = () => { try { return getContext() || {}; } catch { return {}; } };
  const eligible = value => enabled && !disposed && value.editable === true && !value.dirty && !value.creating && !value.busy && value.visible !== false;
  const owns = generation => {
    const current = context();
    return !disposed && dialog.open && owner && epoch === generation && eligible(current)
      && current.session === owner.session && current.sourceToken === owner.sourceToken
      && (current.recipeId === undefined || current.recipeId === owner.recipeId);
  };
  const signature = () => JSON.stringify(fields.map(key => el(key).value));
  const capture = () => { if (draft) Object.assign(draft, { title: el('Name').value, documentType: el('Type').value, sourcePath: el('Path').value }); };
  const canChange = () => !operation && !saved && !uncertain && !needsRead && seed && draft && owns(epoch);
  const approved = () => review && signature() === review.signature;
  const fail = key => { throw Object.assign(new Error(key), { uiKey: key }); };
  const readWorld = async () => (await fetchJsonApiRequest(WORLD_API_PATH, { cache: 'no-store' }, 45000, t('读取世界'))).payload;
  const readSource = async sourcePath => (await readDocSource({ docApiUrl: API_PATHS.DOC, pathValue: sourcePath,
    requestTimeoutMs: 45000, requestLabel: t('读取场景原文') }))?.content;
  const release = preview => {
    if (materializeUuid(preview?.previewId)) void fetchJsonApiRequest(`${SCENE_PREVIEW_API_PATH}?previewId=${encodeURIComponent(preview.previewId)}`,
      { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }, 5000, t('释放场景预览')).catch(() => {});
  };
  const requestFor = mode => buildSceneCompositionMaterializationCommand(seed, { ...draft, mode });
  function renderFields() {
    const select = el('Type'), signature = JSON.stringify(seed?.documentTypes || []);
    if (select.dataset.types !== signature) {
      select.replaceChildren();
      for (const type of seed?.documentTypes || []) { const item = document.createElement('option'); item.value = type.id; item.textContent = type.label; select.append(item); }
      select.dataset.types = signature;
    }
    if (draft) { el('Name').value = draft.title; select.value = draft.documentType; el('Path').value = draft.sourcePath; }
  }
  function render() {
    if (disposed) return;
    el('Close').dataset.i18n = saved ? '返回构建' : '返回预览'; el('Cancel').hidden = Boolean(saved);
    translatePage(dialog); dialog.dataset.dirty = String(dialog.open && !saved && Boolean(draft) && signature() !== baseline);
    dialog.setAttribute('aria-busy', String(Boolean(operation)));
    const writable = Boolean(canChange()); el('Fields').disabled = !writable;
    for (const key of fields) el(key).disabled = !writable;
    el('Check').disabled = !writable; el('Save').disabled = !writable || !approved();
    el('Close').disabled = el('Cancel').disabled = Boolean(operation);
    el('Refresh').disabled = Boolean(operation) || Boolean(saved) || !owns(epoch);
    el('Review').hidden = !review && !saved;
    el('Source').textContent = review?.request.content || saved?.request.content || '';
    el('Recipe').textContent = seed ? t('来源配方：{0}\n原文版本：{1}', seed.recipe.sourcePath, seed.recipe.sourceRevision) : '';
    const declaration = review?.request.content || saved?.request.content;
    const scene = declaration ? JSON.parse(declaration) : null;
    el('Summary').textContent = scene ? t('{0} · {1} 个实例 · {2} 个分组', review?.request.sourcePath || saved.request.sourcePath, scene.actors.length, scene.groups?.length || 0) : '';
    el('Status').textContent = t(message); el('Details').textContent = details;
  }
  const dependencies = request => {
    const actors = JSON.parse(request.content).actors;
    return { relations: [...new Set(actors.map(actor => actor.objectId))].map(targetId => ({ kind: 'references', targetId, slot: '' })),
      assetBindings: [...new Set(actors.map(actor => actor.imageResourceId).filter(Boolean))].map(assetId => ({ assetId, role: 'image' })) };
  };
  function matchesRecord(record, request) {
    const expected = dependencies(request);
    return record?.id === request.objectId && record.sourcePath === request.sourcePath && record.documentType === request.documentType
      && canonicalJson(record.relations) === canonicalJson(expected.relations) && canonicalJson(record.assetBindings) === canonicalJson(expected.assetBindings);
  }
  function validateResult(result, request, sourceRevision) {
    const change = result?.changes?.[0], ref = result?.object?.documentRefs?.[0];
    const input = { ...request }; delete input.mode;
    if (result?.status !== (request.mode === 'apply' ? 'applied' : 'preview') || result.worldId !== request.worldId
      || result.baseRevision !== request.baseRevision || !materializeRevision(result.revision)
      || !Array.isArray(result.changes) || result.changes.length !== 1 || change.kind !== 'scene.create'
      || change.objectId !== request.objectId || change.sourcePath !== request.sourcePath || change.beforeText !== null || change.beforeSourceRevision !== null
      || change.afterText !== request.content || change.afterSourceRevision !== sourceRevision || change.recordPath !== `metadata/documents/${request.objectId}.json`
      || !matchesRecord(change.record, request) || result.object?.id !== request.objectId || ref?.sourcePath !== request.sourcePath || ref.sourceRevision !== sourceRevision
      || result.proposal?.commands?.[0]?.id !== 'scene.create' || canonicalJson(result.proposal.commands[0].input) !== canonicalJson(input)) {
      fail('场景创建回执与审阅内容不一致，请重新读取核对，勿重复保存。');
    }
    return copy(result);
  }
  async function complete(result, request, generation, reconciled = false) {
    saved = { result, request: copy(request) }; uncertain = false; pendingApply = null; review = null;
    message = reconciled ? '已核对，独立场景已保存。返回构建面板继续。' : '独立场景已保存。返回构建面板检查计划并构建。'; render();
    try { await applied(result); }
    catch (error) { if (epoch === generation && !disposed) { message = '独立场景已保存，但构建目录刷新失败。请返回构建面板刷新，勿重复创建。'; details = error.message || ''; } }
  }
  async function reconcile(projection, generation) {
    const request = pendingApply;
    if (!request || projection?.world?.id !== request.worldId || !Array.isArray(projection.objects) || !Array.isArray(projection.resources)) {
      fail('无法核对上次保存结果。请保持当前设置，重新读取工程。');
    }
    const object = projection.objects.find(item => item.id === request.objectId);
    if (!object) {
      if (projection.resources.some(item => item.id === request.objectId)
        || projection.objects.some(item => item.documentRefs?.some(ref => ref.sourcePath.toLowerCase() === request.sourcePath.toLowerCase()))) {
        fail('上次保存的身份或路径已被占用，请核对工程，勿重复创建。');
      }
      uncertain = false; pendingApply = null; return false;
    }
    if (object.documentRefs?.length !== 1 || object.documentRefs[0].sourcePath !== request.sourcePath || !matchesRecord(object.provenance?.descriptor, request)) {
      fail('上次保存的身份或路径已被占用，请核对工程，勿重复创建。');
    }
    const content = await readSource(request.sourcePath); if (!owns(generation)) return false;
    const confirmed = await readWorld(); if (!owns(generation)) return false;
    if (confirmed.world?.id !== projection.world.id || confirmed.world?.revision !== projection.world.revision
      || content !== request.content || object.documentRefs[0].sourceRevision !== `sha256:${await materializeDigest(content)}`) {
      fail('上次保存内容与审阅结果不同，请核对工程，勿重复创建。');
    }
    const result = { status: 'applied', worldId: request.worldId, baseRevision: request.baseRevision, revision: projection.world.revision,
      object, changes: [{ kind: 'scene.create', objectId: object.id, sourcePath: request.sourcePath }] };
    if (!owns(generation)) return false;
    await complete(result, request, generation, true); return true;
  }
  async function read() {
    if (operation || saved || !owns(epoch)) return;
    capture(); review = null; needsRead = true; const generation = epoch, active = { kind: 'read', generation }; operation = active;
    message = uncertain ? '正在核对上次场景保存结果…' : '正在读取已保存配方与展开场景…'; details = ''; setBusy(true); render();
    let preview;
    try {
      const projection = await readWorld(); if (!owns(generation)) return;
      if (uncertain && await reconcile(projection, generation)) return;
      if (!owns(generation)) return;
      const recipe = projection.objects?.find(item => item.id === owner.recipeId), sourcePath = recipe?.documentRefs?.[0]?.sourcePath;
      if (!sourcePath) fail('找不到已保存的配方，请返回预览重新选择。');
      const content = await readSource(sourcePath); if (!owns(generation)) return;
      preview = (await fetchJsonApiRequest(SCENE_PREVIEW_API_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId: owner.recipeId }) }, 45000, t('读取场景预览'))).payload;
      if (!owns(generation)) return;
      const confirmed = await readWorld(); if (!owns(generation)) return;
      const next = await createSceneCompositionMaterialization({ projection, confirmedWorld: { id: confirmed.world?.id, revision: confirmed.world?.revision },
        preview, recipeId: owner.recipeId, content }, { digest: materializeDigest });
      if (!owns(generation)) return;
      if (seed && (seed.worldId !== next.worldId || seed.recipe.sourcePath !== next.recipe.sourcePath)) fail('配方位置或工程已变化，请返回预览后重新打开。');
      seed = next;
      if (!draft) {
        const type = seed.documentTypes.find(item => item.id === 'level') || seed.documentTypes.find(item => item.id === 'document') || seed.documentTypes[0];
        draft = { objectId: crypto.randomUUID(), documentType: type?.id || '', sourcePath: `${seed.documentRoot}/scenes/materialized-scene.json`, title: seed.recipe.title };
        renderFields(); baseline = signature();
      } else renderFields();
      needsRead = false; message = '设置新场景名称与保存位置，再审阅完整展开内容。';
    } catch (error) {
      if (epoch === generation && !disposed) {
        needsRead = true; const code = error.errorCode || error.payload?.errorCode || error.payload?.data?.errorCode;
        message = error.uiKey || materializeErrors[code] || '无法读取配方，设置已保留，请重试。'; details = error.message || '';
      }
    } finally {
      release(preview);
      if (operation === active) { operation = null; setBusy(false); render(); }
    }
  }
  async function run(mode) {
    if (!canChange() || mode === 'apply' && !approved()) { render(); return; }
    capture(); let request;
    try { request = mode === 'apply' ? { ...copy(review.request), mode } : requestFor(mode); }
    catch (error) { review = null; message = materializeErrors[error.errorCode] || materializeErrors.scene_composition_materialize_destination; details = error.message || ''; render(); return; }
    const generation = epoch, inputSignature = signature(), active = { kind: mode, generation }; operation = active;
    message = mode === 'apply' ? '正在保存独立场景与依赖登记…' : '正在审阅独立场景与依赖…'; details = ''; setBusy(true); render();
    let submitted = false;
    try {
      const sourceRevision = `sha256:${await materializeDigest(request.content)}`;
      if (!owns(generation) || signature() !== inputSignature) return;
      if (mode === 'apply') pendingApply = copy(request);
      submitted = true;
      const result = await requestWorldCommand(request);
      if (!owns(generation) || signature() !== inputSignature) { if (mode === 'apply') uncertain = true; return; }
      const valid = validateResult(result, request, sourceRevision);
      if (mode === 'preview') { review = { request: copy(request), signature: inputSignature }; message = '请审阅完整场景。保存后可为新场景添加行为、构建与交付。'; }
      else await complete(valid, request, generation);
    } catch (error) {
      if (mode === 'apply' && submitted) uncertain = true;
      if (epoch !== generation || disposed) return;
      review = null; const code = error.errorCode || error.payload?.errorCode || error.payload?.data?.errorCode;
      const refused = ['world_revision_conflict', 'world_read_conflict', 'world_type_unknown', 'world_scene_invalid', 'world_create_path_invalid', 'world_create_path_conflict'];
      if (mode === 'apply' && refused.includes(code)) { uncertain = false; pendingApply = null; }
      needsRead = ['world_revision_conflict', 'world_read_conflict', 'world_type_unknown'].includes(code);
      message = error.uiKey || materializeErrors[code] || (uncertain ? '保存结果尚未确认。请重新读取核对，勿重复创建。' : '场景审阅未完成，设置已保留，请重试。');
      const diagnostics = error.payload?.diagnostics || error.payload?.data?.diagnostics;
      details = [error.message || '', ...(Array.isArray(diagnostics) ? diagnostics.map(item => JSON.stringify(item)) : [])].filter(Boolean).join('\n');
    } finally { if (operation === active) { operation = null; setBusy(false); render(); } }
  }
  function close() {
    if (operation) return false;
    if (!saved && draft && signature() !== baseline && !window.confirm(t('丢弃本次场景转换设置？尚未保存的内容不会写入工程。'))) return false;
    epoch++; owner = null; review = null; dialog.dataset.dirty = 'false'; dialog.close(); return true;
  }
  for (const key of fields) for (const event of ['input', 'change']) el(key).addEventListener(event, () => {
    if (!canChange()) return; capture(); review = null; message = ''; details = ''; render();
  });
  el('Check').addEventListener('click', () => void run('preview')); el('Save').addEventListener('click', () => void run('apply'));
  el('Refresh').addEventListener('click', () => void read()); el('Close').addEventListener('click', close); el('Cancel').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!event.isComposing && !event.repeat) close(); });
  dialog.addEventListener('close', () => {
    if (dialog.open || disposed) return;
    if (owner) { epoch++; owner = null; review = null; if (operation?.kind === 'apply' && pendingApply) uncertain = true; }
    dialog.dataset.dirty = 'false'; opener?.focus();
  });
  dialog.addEventListener('keydown', event => { event.stopPropagation(); if ((event.ctrlKey || event.metaKey) && event.key?.toLowerCase() === 's') event.preventDefault(); });
  const unsubscribe = onLanguageChange(render);
  return Object.freeze({
    setAvailable(value) { enabled = value === true; if (!enabled) { review = null; needsRead = true; } render(); },
    open(recipeId) {
      const current = context();
      if (operation || dialog.open || !eligible(current) || !materializeUuid(recipeId) || current.recipeId !== undefined && current.recipeId !== recipeId
        || uncertain && seed?.recipe.objectId !== recipeId) return false;
      epoch++; owner = { session: current.session, sourceToken: current.sourceToken, recipeId }; opener = document.activeElement;
      if (!uncertain) { seed = null; draft = null; saved = null; pendingApply = null; baseline = ''; }
      review = null; needsRead = true; message = ''; details = ''; renderFields(); dialog.showModal(); render(); void read(); return true;
    },
    refresh() {
      if (dialog.open && !saved && !owns(epoch)) { review = null; needsRead = true; message = '工程或编辑器已变化，请返回预览后重新打开。'; }
      render();
    },
    dispose() { if (disposed) return; disposed = true; epoch++; owner = null; if (operation) setBusy(false); operation = null;
      if (typeof unsubscribe === 'function') unsubscribe(); dialog.close(); dialog.remove(); },
  });
}

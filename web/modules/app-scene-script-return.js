import { t, onLanguageChange } from '../i18n/index.js';

// A composition-root service. Only the origin intent crosses areas; each form
// retains its own draft and the document host retains all source-write authority.
export function setupSceneScriptReturn({ host, openScript, suspendBehavior, resumeBehavior, discardBehavior,
  inspect, translate = t } = {}) {
  const actions = document.getElementById('docEditActions');
  if (!actions) return Object.freeze({ request: () => false, refresh() {}, dispose() {} });
  const panel = document.createElement('section'); panel.id = 'sceneBehaviorScriptTools'; panel.hidden = true;
  const status = document.createElement('p'); status.id = 'sceneBehaviorScriptStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const back = document.createElement('button'); back.id = 'sceneBehaviorScriptReturn'; back.type = 'button'; back.className = 'doc-btn doc-btn-ghost';
  const discard = document.createElement('button'); discard.id = 'sceneBehaviorScriptDiscard'; discard.type = 'button'; discard.className = 'doc-btn doc-btn-ghost';
  const controls = document.createElement('div'); controls.style.display = 'flex'; controls.style.flexWrap = 'wrap'; controls.style.gap = '8px';
  controls.append(back, discard); panel.style.flexBasis = '100%'; status.style.whiteSpace = 'normal'; panel.append(status, controls); actions.append(panel);
  let pending = null, sequence = 0, disposed = false, message = '';
  const modal = () => Boolean(document.querySelector('dialog[open]'));
  function matches(catalog, snapshot) {
    const origin = snapshot.origin;
    return catalog?.format === 'viento-behavior-creation-context' && catalog.schemaVersion === 1
      && catalog.worldId === origin.worldId && catalog.documentRoot === origin.documentRoot
      && ['objectId', 'objectRevision', 'sourcePath', 'sourceRevision'].every(key => catalog.scene?.[key] === origin.scene[key])
      && Array.isArray(catalog.sources) && (!snapshot.savedScript || catalog.sources.filter(row => row.sourcePath === snapshot.savedScript.sourcePath
        && row.sourceRevision === snapshot.savedScript.sourceRevision).length === 1);
  }
  function refresh() {
    if (disposed) return;
    panel.hidden = !pending;
    back.textContent = translate('返回场景行为设置'); discard.textContent = translate('放弃暂存设置');
    if (!pending) return;
    const snapshot = host.get(pending.token), locked = pending.returning || modal();
    back.disabled = locked || snapshot?.canReturn !== true; discard.disabled = locked;
    status.textContent = translate(message || (snapshot?.stage === 'saved'
      ? '脚本已写入；返回时将重新核对保存目录，仍需明确选择脚本并审阅行为。'
      : snapshot?.stage === 'draft' ? '行为设置已暂存；请先保存脚本，或取消脚本草稿后再返回。'
        : '行为设置已暂存；可创建普通脚本，也可取消后明确返回。'));
  }
  function request(origin) {
    if (disposed || pending || typeof openScript !== 'function') return false;
    let token; try { token = host.begin(origin); } catch { return false; }
    if (!token) return false;
    let ticket; try { ticket = suspendBehavior(origin); } catch { host.clear(token); return false; }
    if (!ticket) { host.clear(token); return false; }
    const owner = { token, ticket, generation: ++sequence, returning: false }; pending = owner; message = '';
    let opened = false;
    try { opened = openScript({ backendId: origin.backendId, language: origin.language,
      onCancel() { if (!disposed && pending === owner) refresh(); },
      onCreated(receipt) { if (!disposed && pending === owner) { host.draftCreated(token, receipt); refresh(); } },
    }) === true; } catch {}
    refresh();
    if (!opened) { message = '未打开脚本创建；暂存设置仍可明确返回。'; refresh(); }
    return true;
  }
  async function returnToScene() {
    const owner = pending, snapshot = owner && host.get(owner.token);
    if (disposed || !owner || owner.returning || modal() || !snapshot?.canReturn) return false;
    const generation = ++sequence; owner.generation = generation; owner.returning = true;
    const owns = () => !disposed && pending === owner && owner.generation === generation;
    message = '正在核对原场景与已保存脚本…'; refresh();
    try {
      const catalog = await inspect({ sceneObjectId: snapshot.origin.scene.objectId });
      const current = host.get(owner.token);
      if (!owns()) return false;
      if (!current?.canReturn || current.editorSession !== snapshot.editorSession || current.sourcePath !== snapshot.sourcePath
        || JSON.stringify(current.savedScript) !== JSON.stringify(snapshot.savedScript) || !matches(catalog, snapshot)) {
        message = '原场景或脚本保存版本已变化；暂存设置仍保留，可核对后重试或明确放弃。'; return false;
      }
      const opened = await host.returnSource(owner.token, { isCurrent: owns });
      if (!owns()) return false;
      if (opened === false) { message = '未能返回原场景；暂存设置仍保留，请检查来源后重试。'; return false; }
      const restored = await resumeBehavior(owner.ticket, { savedScript: snapshot.savedScript, isCurrent: owns });
      if (!owns()) return false;
      if (restored !== true) { message = '尚未恢复场景行为设置；暂存内容仍保留，可以重试。'; return false; }
      host.clear(owner.token); pending = null; message = ''; return true;
    } catch {
      if (owns()) message = '未能返回原场景；暂存设置仍保留，请检查来源后重试。'; return false;
    } finally { if (owns()) owner.returning = false; refresh(); }
  }
  function discardPending() {
    if (disposed || !pending || pending.returning || modal()) return false;
    if (!window.confirm(translate('放弃暂存的行为设置？脚本正文仍由编辑器保存或取消。'))) return false;
    const owner = pending;
    if (discardBehavior(owner.ticket) !== true) return false;
    host.clear(owner.token); pending = null; sequence++; message = ''; refresh(); return true;
  }
  back.addEventListener('click', () => void returnToScene()); discard.addEventListener('click', discardPending);
  const unsubscribe = onLanguageChange(refresh); refresh();
  return Object.freeze({ request, refresh, dispose() { if (disposed) return; disposed = true; sequence++; unsubscribe?.(); panel.remove(); } });
}

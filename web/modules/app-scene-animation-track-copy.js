import { t } from '../i18n/index.js';

// Explicit local choices and request ownership only. The parent supplies a
// saved target directory and a guarded form commit; this control never saves.
export function setupSceneAnimationTrackCopy({ container, getContext = () => ({}), prepare = async () => null, translate = t } = {}) {
  const document = container.ownerDocument, node = (tag, text = '') => { const element = document.createElement(tag); element.textContent = text; return element; };
  const title = node('h4'), controls = node('div'), source = node('select'), target = node('select'), button = node('button'), hint = node('p'), status = node('p'), sourceDetail = node('p'), targetDetail = node('p');
  const sourceCaption = node('span'), targetCaption = node('span'), sourceLabel = node('label'), targetLabel = node('label');
  container.className = 'scene-animation-track-copy'; controls.className = 'scene-animation-track-copy-controls';
  source.id = 'sceneAnimationTrackCopySource'; target.id = 'sceneAnimationTrackCopyTarget'; button.id = 'sceneAnimationTrackCopyApply';
  sourceDetail.id = 'sceneAnimationTrackCopySourceDetail'; targetDetail.id = 'sceneAnimationTrackCopyTargetDetail';
  source.setAttribute('aria-describedby', sourceDetail.id); target.setAttribute('aria-describedby', targetDetail.id);
  button.type = 'button'; button.className = 'doc-btn doc-btn-ghost'; status.id = 'sceneAnimationTrackCopyStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  for (const element of [hint, status, sourceDetail, targetDetail]) element.className = 'muted';
  sourceLabel.append(sourceCaption, source); targetLabel.append(targetCaption, target); controls.append(sourceLabel, targetLabel, button); container.append(title, controls, sourceDetail, targetDetail, hint, status);
  let disposed = false, generation = 0, loading = false, message = '', observed = null;
  const contextKeys = ['session', 'sourcePath', 'sourceToken', 'current', 'available', 'locked', 'form', 'catalog', 'catalogGeneration', 'catalogToken', 'targetsAvailable'];
  const same = (a, b) => a && b && contextKeys.every(key => a[key] === b[key]);
  const usable = context => context.current === true && context.available === true && context.targetsAvailable === true && !context.locked;
  const choices = context => (context.tracks || []).some(track => track.id === source.value) && (context.targets || []).some(item => item.instanceId === target.value);
  function revoke() { generation++; loading = false; message = ''; }
  function options(select, entries, placeholder) {
    const items = [['', placeholder], ...entries], key = JSON.stringify(items), selected = select.value;
    if (select.dataset.choices !== key) {
      select.dataset.choices = key; select.replaceChildren();
      for (const [id, text] of items) { const option = node('option', text); option.value = id; select.append(option); }
      select.value = items.some(([id]) => id === selected) ? selected : '';
    }
  }
  function refresh() {
    if (disposed) return;
    const context = getContext(); if (observed && !same(observed, context)) revoke(); observed = { ...context };
    title.textContent = translate('复制动画轨道'); button.textContent = translate('复制动画轨道');
    sourceCaption.textContent = translate('源动画轨道'); targetCaption.textContent = translate('目标场景实例');
    options(source, (context.tracks || []).map(track => [track.id, track.label]), translate('请选择源动画轨道'));
    options(target, (context.targets || []).map(item => [item.instanceId, item.label]), translate('请选择目标场景实例'));
    sourceDetail.textContent = (context.tracks || []).find(track => track.id === source.value)?.label || '';
    targetDetail.textContent = (context.targets || []).find(item => item.instanceId === target.value)?.label || '';
    hint.textContent = translate('复制当前表单中的关键帧与数值，生成新轨道编号。序列帧只复制网格与帧号，目标仍使用自己的图片。结果需检查、审阅并保存。');
    source.disabled = !usable(context); target.disabled = !usable(context); button.disabled = !usable(context) || !choices(context) || loading;
    container.setAttribute('aria-busy', String(loading));
    status.textContent = context.available !== true ? translate('当前核心不支持复制动画轨道；仍可使用原有字段编辑。')
      : context.targetsAvailable !== true ? translate('复制轨道需要有效的已保存场景实例目录，请先刷新场景实例。原有字段编辑仍可使用。')
      : loading ? translate('正在复制动画轨道…') : message ? translate(message) : '';
  }
  async function run() {
    refresh(); const context = { ...getContext() }; if (disposed || loading || !usable(context) || !choices(context)) return false;
    const sourceId = source.value, targetId = target.value, request = ++generation;
    const owns = () => !disposed && request === generation && same(context, getContext()) && usable(getContext()) && choices(getContext()) && source.value === sourceId && target.value === targetId;
    loading = true; message = ''; refresh();
    try {
      const commit = await prepare(sourceId, targetId); if (!owns()) return false;
      if (typeof commit !== 'function') throw Error('copy');
      if (commit() !== true) return false;
      message = '已复制轨道到本地表单；请检查并审阅后应用。'; return true;
    } catch {
      if (owns()) message = '无法复制轨道。请检查当前表单、目标属性冲突及数量限制；表单、审阅和预览已保留。';
      return false;
    } finally { if (!disposed) { if (request === generation) loading = false; refresh(); } }
  }
  for (const select of [source, target]) select.addEventListener('change', () => { if (!disposed) { revoke(); refresh(); } });
  button.addEventListener('click', () => void run()); refresh();
  return Object.freeze({ refresh, reset() { if (disposed) return; revoke(); observed = null; source.value = ''; target.value = ''; refresh(); },
    dispose() { if (disposed) return; disposed = true; revoke(); container.replaceChildren(); } });
}

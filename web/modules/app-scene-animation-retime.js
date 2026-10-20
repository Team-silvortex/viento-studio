import { t } from '../i18n/index.js';

// This control prepares a local form transformation. The parent retains the
// animation form, source review, preview and ordinary draft/Save boundaries.
export function setupSceneAnimationRetime({ container, getContext = () => ({}), prepare = async () => null, translate = t } = {}) {
  const document = container.ownerDocument, node = tag => document.createElement(tag);
  const label = node('label'), caption = node('span'), target = node('input'), button = node('button'), controls = node('div'), hint = node('p'), status = node('p');
  container.className = 'scene-animation-retime'; controls.className = 'scene-animation-retime-controls';
  target.id = 'sceneAnimationRetimeDuration'; target.type = 'text'; target.inputMode = 'decimal'; target.spellcheck = false;
  button.id = 'sceneAnimationRetimeApply'; button.type = 'button'; button.className = 'doc-btn doc-btn-ghost';
  hint.id = 'sceneAnimationRetimeHint'; hint.className = 'muted'; target.setAttribute('aria-describedby', hint.id);
  status.id = 'sceneAnimationRetimeStatus'; status.className = 'muted'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  label.append(caption, target); controls.append(label, button); container.append(controls, hint, status);
  let disposed = false, generation = 0, loading = false, message = '', observed = null;
  const contextKeys = ['session', 'sourcePath', 'sourceToken', 'current', 'available', 'locked', 'form'];
  const same = (a, b) => a && b && contextKeys.every(key => a[key] === b[key]);
  const usable = value => value.current === true && value.available === true && !value.locked;
  function revoke() { generation++; loading = false; message = ''; }
  function refresh() {
    if (disposed) return;
    const context = getContext();
    if (observed && !same(observed, context)) revoke();
    observed = { ...context };
    caption.textContent = translate('目标时长（秒）'); button.textContent = translate('按比例调整时长');
    hint.textContent = translate('按当前总时长同比缩放所有关键帧和片段的时间，保留数值、编号与循环设置。只更新表单，仍需检查、审阅并保存。');
    target.disabled = !usable(context); button.disabled = !usable(context) || loading;
    container.setAttribute('aria-busy', String(loading));
    status.textContent = context.available !== true ? translate('当前核心不支持按比例调整时长；仍可使用原有字段编辑。')
      : loading ? translate('正在按比例调整动画时长…') : message ? translate(message) : '';
  }
  async function run() {
    refresh(); const context = { ...getContext() };
    if (disposed || loading || !usable(context)) return false;
    const input = target.value, request = ++generation;
    const owns = () => !disposed && request === generation && same(context, getContext()) && usable(getContext()) && target.value === input;
    loading = true; message = ''; refresh();
    try {
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(input) || !Number.isFinite(Number(input))) throw Error('duration');
      const commit = await prepare(Number(input));
      if (!owns()) return false;
      if (typeof commit !== 'function') throw Error('retime');
      const changed = commit();
      if (changed !== true && changed !== false) return false;
      // The successful commit may refresh the parent and revoke the old form
      // identity. Its result belongs to the new form created synchronously here.
      message = changed ? '已按比例调整表单时间；请检查并审阅后应用。' : '目标时长与当前时长相同，表单、审阅和预览保持。';
      return changed;
    } catch {
      if (owns()) message = '无法按比例调整时长。请检查当前动画与目标时长；表单、审阅和预览已保留。';
      return false;
    } finally {
      if (!disposed) { if (request === generation) loading = false; refresh(); }
    }
  }
  target.addEventListener('input', () => { if (!disposed) { revoke(); refresh(); } });
  button.addEventListener('click', () => void run());
  refresh();
  return Object.freeze({ refresh, reset(value = '') { if (disposed) return; revoke(); observed = null; target.value = String(value); refresh(); },
    dispose() { if (disposed) return; disposed = true; revoke(); container.replaceChildren(); } });
}

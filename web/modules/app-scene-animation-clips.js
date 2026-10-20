import { t } from '../i18n/index.js';

// Local form rows only. The parent owns review, source identity and Save;
// Rust validates intervals and names together with the complete animation.
export function setupSceneAnimationClips({ container, onChange = () => {}, onUsage = () => {}, getContext = () => ({}), translate = t } = {}) {
  const document = container.ownerDocument, node = (tag, text = '') => { const element = document.createElement(tag); element.textContent = text; return element; };
  let rows = [], disposed = false, disabled = true, epoch = 0, message = '';
  const title = node('h3'), add = node('button'), toolbar = node('div'), hint = node('p'), list = node('div'), status = node('p');
  toolbar.className = 'scene-animation-toolbar'; add.id = 'sceneAnimationAddClip'; add.type = 'button'; add.className = 'doc-btn doc-btn-ghost';
  status.id = 'sceneAnimationClipsStatus'; status.setAttribute('role', 'status'); hint.className = 'muted'; status.className = 'muted';
  toolbar.append(title, add); container.append(toolbar, hint, list, status);
  const value = () => rows.map(row => ({ id: row.id, name: row.name.value, startSeconds: row.startSeconds.value, endSeconds: row.endSeconds.value, loop: row.loop.value }));
  const normalize = input => input.map(clip => ({ id: clip.id, name: clip.name, startSeconds: String(clip.startSeconds), endSeconds: String(clip.endSeconds), loop: String(clip.loop) }));
  const owns = (row, generation) => !disposed && !disabled && getContext().available === true && generation === epoch && rows.includes(row) && list.contains(row.box);
  function changed() { if (!disposed && !disabled) { message = ''; onChange(); refresh(); } }
  function render(input) {
    epoch++; rows = []; list.replaceChildren(); const generation = epoch;
    for (const [index, clip] of input.entries()) {
      const box = node('section'); box.className = 'scene-animation-clip'; box.dataset.clipId = clip.id;
      const heading = node('div'), nameTitle = node('h4'), remove = node('button'), usage = node('button'), actions = node('div'), identity = node('code', clip.id), fields = node('div');
      heading.className = 'scene-animation-toolbar'; fields.className = 'scene-animation-clip-fields';
      remove.type = 'button'; remove.id = `sceneAnimationClip${index}Remove`; remove.className = 'doc-btn doc-btn-ghost';
      usage.type = 'button'; usage.id = `sceneAnimationClip${index}Usage`; usage.className = 'doc-btn doc-btn-ghost'; usage.setAttribute('aria-controls', 'sceneAnimationUsage'); actions.className = 'scene-animation-usage-actions';
      const row = { id: clip.id, box, remove, usage, title: nameTitle, labels: [] };
      for (const [key, label] of [['name', '片段名称'], ['startSeconds', '片段开始（秒）'], ['endSeconds', '片段结束（秒）'], ['loop', '片段循环']]) {
        const control = node(key === 'loop' ? 'select' : 'input'), field = node('label'), caption = node('span');
        control.id = `sceneAnimationClip${index}${{ name: 'Name', startSeconds: 'Start', endSeconds: 'End', loop: 'Loop' }[key]}`;
        if (key === 'loop') for (const choice of ['true', 'false']) { const option = node('option'); option.value = choice; control.append(option); }
        else { control.type = 'text'; control.spellcheck = false; if (key !== 'name') control.inputMode = 'decimal'; }
        control.value = clip[key]; row[key] = control; row.labels.push([caption, label]); field.append(caption, control); fields.append(field);
        control.addEventListener(key === 'loop' ? 'change' : 'input', () => { if (owns(row, generation)) changed(); });
      }
      remove.addEventListener('click', () => { if (!owns(row, generation)) return; const next = value(); next.splice(rows.indexOf(row), 1); render(next); changed(); add.focus(); });
      usage.addEventListener('click', () => { if (owns(row, generation) && getContext().usageAvailable === true) onUsage(row.id); });
      actions.append(usage, remove); heading.append(nameTitle, actions); box.append(heading, identity, fields); list.append(box); rows.push(row);
    }
    refresh();
  }
  function refresh() {
    if (disposed) return;
    const context = getContext(); container.hidden = context.available !== true && !rows.length;
    title.textContent = translate('命名动画片段'); add.textContent = translate('添加动画片段');
    hint.textContent = translate('片段复用现有轨道，只指定原时间轴的区间。行为按稳定编号选择；更名不会改变编号，删除后原引用将失效。');
    status.textContent = message ? translate(message) : translate('片段 {0} / 32', rows.length);
    add.disabled = disabled || context.available !== true || rows.length >= 32;
    for (const [index, row] of rows.entries()) {
      row.title.textContent = translate('动画片段 {0}', index + 1); row.remove.textContent = translate('移除动画片段');
      row.usage.textContent = translate('查看使用位置'); row.usage.hidden = context.usageAvailable !== true; row.usage.disabled = disabled || context.usageAvailable !== true; row.usage.setAttribute('aria-expanded', String(context.usageSelected === row.id));
      for (const [caption, key] of row.labels) caption.textContent = translate(key);
      for (const choice of row.loop.children) choice.textContent = translate(choice.value === 'true' ? '是' : '否');
      for (const control of [row.name, row.startSeconds, row.endSeconds, row.loop, row.remove]) control.disabled = disabled || context.available !== true;
    }
  }
  add.addEventListener('click', () => {
    if (disposed || disabled || getContext().available !== true || rows.length >= 32) return;
    const ids = new Set(rows.map(row => row.id)); let id;
    for (let attempt = 0; attempt < 8; attempt++) { const candidate = globalThis.crypto?.randomUUID?.(); if (typeof candidate === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(candidate) && !ids.has(candidate)) { id = candidate; break; } }
    if (!id) { message = '无法生成动画片段编号，请重试。'; refresh(); return; }
    render([...value(), { id, name: translate('动画片段 {0}', rows.length + 1), startSeconds: '0', endSeconds: String(getContext().durationSeconds ?? ''), loop: String(getContext().loop ?? false) }]);
    changed(); rows.at(-1).name.focus();
  });
  refresh();
  return Object.freeze({ getValue: value, setValue(input) { if (disposed) return; const next = normalize(input); if (JSON.stringify(value()) !== JSON.stringify(next)) render(next); },
    focusUsage(id) { const row = rows.find(row => row.id === id); if (!disposed && row && !row.usage.hidden && !row.usage.disabled) row.usage.focus(); },
    setDisabled(value) { disabled = value === true; refresh(); }, refresh,
    dispose() { disposed = true; epoch++; rows = []; container.replaceChildren(); } });
}

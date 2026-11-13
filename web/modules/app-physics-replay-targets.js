import { t } from '../i18n/index.js';

// Temporary view selection only. Program conversion, author saves, requests and
// frozen-build admission remain with their existing owners.
export function setupPhysicsReplayTargets({ container, getProgram, onConvert, onSelect } = {}) {
  const document = container.ownerDocument, uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
  const label = document.createElement('label'), picker = document.createElement('select');
  picker.id = 'projectBuildPhysicsReplayTarget'; label.htmlFor = picker.id;
  const convert = document.createElement('button'); convert.id = 'projectBuildPhysicsReplayInstances'; convert.type = 'button'; convert.className = 'doc-btn doc-btn-ghost';
  const note = document.createElement('p'); note.className = 'build-hint'; note.setAttribute('role', 'status');
  container.classList.add('build-physics-targets'); container.append(label, picker, convert, note);
  let owner = '', selected = '', signature = '', targets = [], supported = false, editable = false;
  const input = () => { try { return getProgram(); } catch { return null; } };
  const validSelection = () => targets.some(target => target.instanceId === selected);
  const accepts = program => Boolean(program) && (program.schemaVersion === 1 || supported && program.steps.every(step => step.inputs.every(row => targets.some(target => target.instanceId === row.instanceId))));
  picker.addEventListener('change', () => {
    if (!editable || !supported || !targets.some(target => target.instanceId === picker.value)) return;
    selected = picker.value; onSelect?.();
  });
  convert.addEventListener('click', () => { if (editable && supported && targets.length && input()?.schemaVersion === 1) onConvert?.(targets.map(target => target.instanceId)); });
  return Object.freeze({
    setState(state) {
      supported = state.supported === true; editable = state.editable === true;
      targets = Array.isArray(state.targets) && state.targets.length <= 8 ? [...state.targets].filter(target => uuid(target.instanceId) && uuid(target.objectId) && uuid(target.bodyId)) : [];
      if (new Set(targets.map(target => target.instanceId)).size !== targets.length) targets = [];
      if (owner !== state.owner) { owner = state.owner; selected = ''; }
      if (!validSelection()) selected = targets[0]?.instanceId || '';
      const program = input(), perInstance = program?.schemaVersion === 2;
      label.textContent = t('物理输入目标'); convert.textContent = t('转为逐角色输入');
      label.hidden = picker.hidden = !perInstance;
      convert.hidden = perInstance || !supported; convert.disabled = !editable || !program || !targets.length;
      picker.disabled = !editable || !supported || !targets.length;
      const next = JSON.stringify(targets.map(target => target.instanceId));
      if (next !== signature) {
        picker.replaceChildren(...targets.map(target => { const option = document.createElement('option'); option.value = target.instanceId; return option; })); signature = next;
      }
      [...picker.children].forEach((option, index) => { const target = targets[index]; option.textContent = `${index + 1}. ${target.name || target.objectId} · ${target.instanceId}`; option.title = option.textContent; });
      if (picker.value !== selected) picker.value = selected;
      note.textContent = perInstance ? t(accepts(program)
        ? '逐角色输入：切换目标只改变时间轴视图，未列出的角色在该步释放全部动作。'
        : '逐角色输入含当前冻结工程不可用的目标，请修正 JSON 后再运行。')
        : t('全局输入作用于所有方向键角色；转换会将当前输入完整复制给目录中的每个角色。');
      container.hidden = !state.visible;
    },
    selectedInstance(program) { return program?.schemaVersion === 2 && supported && validSelection() ? selected : undefined; },
    stepInput(program, step) { return program?.schemaVersion === 2 ? program.steps[step]?.inputs.find(row => row.instanceId === selected) || {} : program?.steps[step] || {}; },
    canEdit(program) { return Boolean(program) && editable && (program.schemaVersion === 1 || supported && validSelection()); },
    accepts,
  });
}

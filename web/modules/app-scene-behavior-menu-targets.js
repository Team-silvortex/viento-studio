import { inspectProjectMenuTargets, editProjectMenuItemTarget, appendProjectMenuNavigationItem } from '../../engine/project-menu-item-edit.mjs';
import { isSceneBehaviorReferences, sceneBehaviorReferencesMatchSource } from '../../engine/scene-behavior-reference-directory.mjs';
import { captureScriptParameterContract } from '../../engine/script-parameter-interface.mjs';
import { discoverGodotProjectMenuParameterContract } from '../../engine/godot-project-menu-parameters.mjs';
import { GODOT_PROJECT_MENU_SCRIPT } from '../../engine/godot-project-menu-script.mjs';
import { t } from '../i18n/index.js';

const official = JSON.stringify(discoverGodotProjectMenuParameterContract(GODOT_PROJECT_MENU_SCRIPT));
// A local contribution to one existing String row. The ordinary editor retains
// dependency review, draft application and durable Save authority.
export function setupSceneBehaviorMenuTargets({ container, getContext = () => ({}), getReferences, onUse = () => {}, translate = t } = {}) {
  const document = container.ownerDocument;
  const node = (tag, text = '') => { const element = document.createElement(tag); element.textContent = text; return element; };
  const sourceKeys = ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision', 'content'];
  const sceneKeys = ['objectId', 'sourcePath', 'sourceRevision'];
  const scalar = row => row.value.value === row.displayValue && typeof row.rawValue === 'string' ? row.rawValue : row.value.value;
  const contract = value => { try { return JSON.stringify(captureScriptParameterContract(value)); } catch { return ''; } };
  let disposed = false, epoch = 0, owner = null, loading = false, catalog = null, assembly = '', item = '', target = '', message = '', view = null;
  const rows = context => (context.rows || []).filter(row => row.bindingId === context.bindingId && row.wrapper?.contains(row.key)
    && row.wrapper.contains(row.type) && row.wrapper.contains(row.value) && document.body.contains(row.wrapper));
  const gate = context => {
    const current = rows(context), items = current.filter(row => row.key.value === 'items_json'), modes = current.filter(row => row.key.value === 'display_mode');
    if (items.length !== 1 || modes.length !== 1 || items[0].type.value !== 'string' || modes[0].type.value !== 'string') return null;
    return scalar(modes[0]) === 'scene' ? items[0] : null;
  };
  const eligible = context => !disposed && context.available === true && context.current === true && typeof getReferences === 'function'
    && context.backendId === 'org.viento.godot4' && context.language === 'gdscript' && context.script?.objectId === context.sourceObjectId
    && contract(context.script?.parameterContract) === official && context.source && sourceKeys.every(key => typeof context.source[key] === 'string')
    && context.scene && sceneKeys.every(key => typeof context.scene[key] === 'string');
  const signature = context => JSON.stringify([context.bindingId, context.sourceObjectId, context.instanceId, context.epoch, context.editSignature,
    ...sourceKeys.map(key => context.source[key]), ...sceneKeys.map(key => context.scene[key]), context.script.sourceRevision, contract(context.script.parameterContract),
    rows(context).map(row => [row.identity, row.bindingId, row.key.value, row.type.value, row.value.value, row.rawValue, row.displayValue])]);
  const capture = context => ({ source: context.source, script: context.script, rows: context.rows, fields: signature(context),
    nodes: rows(context).map(row => [row, row.key, row.type, row.value, row.wrapper]), revoked: false });
  function owns(token, context = getContext()) {
    if (!token || token !== owner || token.revoked || !eligible(context)) return false;
    const current = rows(context);
    const valid = token.source === context.source && token.script === context.script && token.rows === context.rows && token.fields === signature(context)
      && current.length === token.nodes.length && current.every((row, index) => [row, row.key, row.type, row.value, row.wrapper].every((value, at) => value === token.nodes[index][at]));
    if (!valid) token.revoked = true;
    return valid;
  }
  const mutable = token => owns(token) && !getContext().pending && !loading && Boolean(gate(getContext()));
  const branded = (value, context, selected) => Boolean(isSceneBehaviorReferences(value) && sceneBehaviorReferencesMatchSource(value, context.source)
    && sceneKeys.every(key => value.scene[key] === context.scene[key]) && (value.selectedAssembly?.objectId || '') === selected);
  const ready = () => owns(owner) && branded(catalog, getContext(), assembly);
  const selections = () => JSON.stringify([view?.assembly.input.value, view?.item.input.value, view?.target.input.value, view?.newId.input.value, view?.newLabel.input.value, view?.command.input.value]);
  function options(select, entries, selected) {
    const key = JSON.stringify(entries);
    if (select.__menuOptions !== key) { select.replaceChildren(); for (const [value, text] of entries) { const option = node('option', text); option.value = value; select.append(option); } select.__menuOptions = key; }
    select.value = entries.some(([value]) => value === selected) ? selected : '';
  }
  function reset() { epoch++; owner = null; loading = false; catalog = null; assembly = ''; item = ''; target = ''; message = ''; view = null; container.replaceChildren(); container.setAttribute('aria-busy', 'false'); }
  function create(token) {
    const title = node('h4'), note = node('p'), load = node('button'), status = node('p'), fields = node('div'), use = node('button'), append = node('button');
    const field = (suffix, tag = 'select') => { const label = node('label'), caption = node('span'), input = node(tag); input.id = 'sceneBehaviorsMenuTargets' + suffix; label.append(caption, input); fields.append(label); return { label, caption, input }; };
    for (const [suffix, element] of [['Title', title], ['Note', note], ['Load', load], ['Status', status], ['Use', use], ['Append', append]]) element.id = 'sceneBehaviorsMenuTargets' + suffix;
    note.className = status.className = 'scene-behaviors-note'; fields.className = 'scene-behaviors-menu-fields';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    for (const button of [load, use, append]) { button.type = 'button'; button.className = 'doc-btn doc-btn-ghost'; }
    const result = { title, note, load, status, fields, use, append, assembly: field('Assembly'), item: field('Item'), target: field('Target'), newId: field('NewId', 'input'), newLabel: field('NewLabel', 'input'), command: field('Command') };
    for (const input of [result.newId.input, result.newLabel.input]) { input.type = 'text'; input.spellcheck = false; input.addEventListener('input', () => { if (mutable(token)) refresh(); }); }
    result.newId.input.maxLength = 48; result.newLabel.input.maxLength = 320;
    container.append(title, note, load, fields, use, append, status);
    load.addEventListener('click', () => { if (mutable(token)) void read(token, ''); });
    result.assembly.input.addEventListener('change', () => { if (!mutable(token) || !ready()) return; const value = result.assembly.input.value; if (value && !catalog.assemblies.some(row => row.objectId === value)) return; if (value !== assembly) void read(token, value); });
    for (const [name, set] of [['item', value => { item = value; }], ['target', value => { target = value; }]]) result[name].input.addEventListener('change', () => { if (!mutable(token) || !ready()) return; set(result[name].input.value); refresh(); });
    result.command.input.addEventListener('change', () => { if (mutable(token)) refresh(); });
    use.addEventListener('click', () => { if (mutable(token)) void insert(token, false); });
    append.addEventListener('click', () => { if (mutable(token)) void insert(token, true); });
    return result;
  }
  function shape() {
    if (!ready() || !catalog.selectedAssembly || !gate(getContext())) return null;
    try { return inspectProjectMenuTargets(scalar(gate(getContext())), { sceneIds: Array.from(catalog.selectedAssembly.members, row => row.objectId), currentSceneId: getContext().scene.objectId }); }
    catch { return null; }
  }
  function refresh() {
    if (disposed) return;
    const context = getContext();
    if (!eligible(context)) { reset(); container.hidden = true; return; }
    if (!owns(owner, context)) { reset(); owner = capture(context); view = create(owner); }
    if (context.pending && loading) { epoch++; loading = false; message = '菜单连接已失效；输入与审阅保持不变，请重试。'; }
    container.hidden = false; container.classList.add('scene-behaviors-menu-tools'); container.setAttribute('aria-busy', String(loading));
    const usable = ready(), checked = shape(), form = gate(context), locked = loading || Boolean(context.pending) || !form;
    const members = usable && catalog.selectedAssembly ? catalog.selectedAssembly.members.filter(row => row.objectId !== context.scene.objectId) : [];
    if (!checked?.targets.some(row => row.id === item)) item = '';
    if (!members.some(row => row.objectId === target)) target = '';
    view.title.textContent = translate('按场景名称连接菜单按钮');
    view.note.textContent = translate('仅更新当前菜单的 items_json 文本；标题和模式保持原样。初始化值仍需在原JSON中明确填写。');
    view.load.textContent = translate('读取菜单目标目录'); view.load.disabled = locked;
    view.assembly.caption.textContent = translate('用于菜单的项目组装');
    options(view.assembly.input, [['', translate('请选择组装（不自动选择）')], ...(catalog?.assemblies || []).map(row => [row.objectId, `${row.name} · ${row.sourcePath} · ${row.objectId}`])], assembly);
    view.item.caption.textContent = translate('修改哪个现有跳转按钮');
    options(view.item.input, [['', translate('请选择现有按钮')], ...(checked?.targets || []).map(row => [row.id, `${row.label} · ${row.id} · ${row.command}`])], item);
    view.target.caption.textContent = translate('目标成员场景');
    options(view.target.input, [['', translate('请选择目标场景')], ...members.map(row => [row.objectId, `${row.name} · ${row.sourcePath} · ${row.objectId}`])], target);
    view.newId.caption.textContent = translate('新按钮标识'); view.newLabel.caption.textContent = translate('新按钮文字'); view.command.caption.textContent = translate('新按钮操作');
    const command = view.command.input.value;
    options(view.command.input, [['', translate('请选择跳转操作')], ['scene', translate('切换场景（保留状态）')], ['retry', translate('重新尝试（默认空覆盖）')]], command);
    for (const control of [view.assembly.input, view.item.input, view.target.input, view.newId.input, view.newLabel.input, view.command.input]) control.disabled = locked || !usable;
    view.use.textContent = translate('填入所选按钮目标'); view.append.textContent = translate('追加跳转按钮');
    view.use.disabled = locked || !checked || !item || !target || view.item.input.value !== item || view.target.input.value !== target;
    view.append.disabled = locked || !checked?.canAppend || !target || !view.newId.input.value || !view.newLabel.input.value || !['scene', 'retry'].includes(view.command.input.value);
    const hint = !form ? '请明确保留唯一的 items_json 和 display_mode 文本参数，并将模式设为 scene；其他情况请手动编辑。'
      : !usable ? '读取目录并明确选择项目组装；选择不会修改参数。' : !catalog.selectedAssembly ? '请明确选择菜单所属的项目组装。'
        : !checked ? '当前菜单JSON或成员引用无效，请在原参数中检查；不会自动修复。' : !members.length ? '当前组装没有其他成员场景；文本参数仍可手动编辑。'
          : !checked.canAppend ? '菜单已满8个按钮；仍可修改现有跳转目标。' : '点击填入或追加后，仍需检查、审阅并普通保存。';
    view.status.textContent = translate(message || hint);
  }
  async function read(token, selected) {
    if (!mutable(token)) return false;
    const context = getContext(), request = ++epoch;
    loading = true; message = '正在读取菜单目标目录…'; refresh();
    try {
      const value = await getReferences(context.source, { assemblyObjectId: selected || null });
      if (request !== epoch || !owns(token) || getContext().pending) return false;
      if (!branded(value, getContext(), selected)) throw Error('Invalid menu target directory.');
      catalog = value; assembly = selected; item = ''; target = ''; message = ''; return true;
    } catch { if (request === epoch && owns(token)) { catalog = null; assembly = ''; item = ''; target = ''; message = '无法读取菜单目标；输入与审阅保持不变，可以重试。'; } return false; }
    finally { if (request === epoch && !disposed) { loading = false; refresh(); } }
  }
  async function insert(token, append) {
    if (!mutable(token) || !ready() || !assembly || !shape()) return false;
    const context = getContext(), row = gate(context), original = catalog, originalJson = scalar(row), fingerprint = JSON.stringify(original), selected = { assembly, item, target, id: view.newId.input.value, label: view.newLabel.input.value, command: view.command.input.value }, ui = selections(), request = ++epoch;
    const current = () => request === epoch && owns(token) && !getContext().pending && catalog === original && assembly === selected.assembly && item === selected.item && target === selected.target
      && selections() === ui && gate(getContext()) === row && scalar(row) === originalJson;
    loading = true; message = '正在核对菜单成员来源…'; refresh();
    try {
      const checked = await getReferences(context.source, { assemblyObjectId: selected.assembly });
      if (!current()) return false;
      if (!branded(checked, getContext(), selected.assembly) || checked.revision !== original.revision || JSON.stringify(checked) !== fingerprint) {
        catalog = null; assembly = ''; item = ''; target = ''; message = '菜单目标目录已变化，请重新读取；参数与审阅保持不变。'; return false;
      }
      const options = { targetSceneId: selected.target, sceneIds: Array.from(checked.selectedAssembly.members, row => row.objectId), currentSceneId: getContext().scene.objectId };
      const next = append ? appendProjectMenuNavigationItem(originalJson, { id: selected.id, label: selected.label, command: selected.command, ...options })
        : editProjectMenuItemTarget(originalJson, { itemId: selected.item, ...options });
      if (!current()) return false;
      loading = false;
      if (next === originalJson) { message = '目标未变化；参数与审阅保持不变。'; return true; }
      // No await separates ownership validation and the single-row callback.
      message = '已更新菜单文本；仍需检查、审阅并普通保存。'; onUse(row, next); return true;
    } catch { if (current()) message = '菜单修改未填入；请检查条目、目标和文本长度，原参数与审阅保持不变。'; return false; }
    finally { if (request === epoch && !disposed) { loading = false; refresh(); } }
  }
  refresh(); return Object.freeze({ refresh, reset, dispose() { if (disposed) return; reset(); disposed = true; container.hidden = true; } });
}

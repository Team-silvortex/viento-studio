import { isSceneBehaviorReferences, sceneBehaviorReferencesMatchSource, sceneBehaviorReferenceValue } from '../../engine/scene-behavior-reference-directory.mjs';
import { t } from '../i18n/index.js';

// This panel discovers saved identities and inserts one ordinary String value.
// The surrounding behavior editor retains review, draft and Save authority.
export function setupSceneBehaviorReferences({ container, getContext = () => ({}), getReferences, onUse = () => {}, translate = t } = {}) {
  const document = container.ownerDocument;
  const node = (tag, text = '') => { const element = document.createElement(tag); element.textContent = text; return element; };
  const sourceKeys = ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision', 'content'];
  const sceneKeys = ['objectId', 'sourcePath', 'sourceRevision'];
  const bindingKeys = ['bindingId', 'sourceObjectId', 'instanceId'];
  let disposed = false, generation = 0, loading = false, owner = null, bindingOwner = null, view = null;
  let catalog = null, assembly = '', kind = 'instance', choice = '', parameter = '', message = '';
  let rowSequence = 0;
  const rowIds = new WeakMap();
  const eligible = context => !disposed && context.available === true && context.current === true && typeof getReferences === 'function'
    && context.source && sourceKeys.every(key => typeof context.source[key] === 'string') && context.scene
    && sceneKeys.every(key => typeof context.scene[key] === 'string');
  const sourceOwner = context => ({ source: context.source, fields: sourceKeys.map(key => context.source[key]), scene: sceneKeys.map(key => context.scene[key]) });
  const sameOwner = (token, context = getContext()) => Boolean(token && owner === token && eligible(context) && token.source === context.source
    && sourceKeys.every((key, index) => context.source[key] === token.fields[index]) && sceneKeys.every((key, index) => context.scene[key] === token.scene[index]));
  const mutable = token => sameOwner(token) && !getContext().pending && !loading;
  const binding = context => ({ rows: context.rows, fields: bindingKeys.map(key => context[key]) });
  const sameBinding = (token, context = getContext()) => Boolean(token && token.rows === context.rows && bindingKeys.every((key, index) => context[key] === token.fields[index]));
  const branded = (value, context, assemblyId) => Boolean(isSceneBehaviorReferences(value) && sceneBehaviorReferencesMatchSource(value, context.source)
    && sceneKeys.every(key => value.scene[key] === context.scene[key]) && (value.selectedAssembly?.objectId || '') === assemblyId);
  const usable = context => sameOwner(owner, context) && branded(catalog, context, assembly);
  const identity = row => { if (!rowIds.has(row)) rowIds.set(row, 'row-' + ++rowSequence); return rowIds.get(row); };
  const stringRows = context => (context.rows || []).filter(row => row.type?.value === 'string' && row.bindingId === context.bindingId
    && row.wrapper?.contains(row.key) && row.wrapper.contains(row.type) && row.wrapper.contains(row.value) && document.body.contains(row.wrapper));
  const rowsById = context => new Map(stringRows(context).map(row => [identity(row), row]));
  const entries = () => !catalog ? [] : kind === 'instance' ? catalog.instances.map((item, index) => ({ value: item.instanceId,
    label: translate('实例 {0} · {1} · {2}', index + 1, item.name, item.instanceId), detail: item.name + '\n' + translate('实例编号：{0}；定义编号：{1}；来源：{2}', item.instanceId, item.objectId, item.sourcePath) }))
    : kind === 'scene' ? (catalog.selectedAssembly?.members || []).map(item => ({ value: item.objectId,
      label: `${item.name} · ${item.objectId}`, detail: `${item.name} · ${item.objectId} · ${item.sourcePath}` }))
      : (catalog.selectedAssembly?.actions || []).map(item => ({ value: item.name,
        label: translate('动作 {0} · {1}', item.name, item.keys.join(' / ')), detail: translate('输入映射来源：{0}', catalog.selectedAssembly.inputMap?.sourcePath || '') }));
  const selectionCurrent = () => Boolean(view && view.assembly.select.value === assembly && view.kind.select.value === kind
    && view.choice.select.value === choice && view.parameter.select.value === parameter);
  function options(select, values, selected) {
    const signature = JSON.stringify(values);
    if (select.__referencesOptions !== signature) {
      select.replaceChildren();
      for (const [value, label] of values) { const option = node('option', label); option.value = value; select.append(option); }
      select.__referencesOptions = signature;
    }
    select.value = values.some(([value]) => value === selected) ? selected : '';
  }
  function reset() {
    generation++; loading = false; owner = null; bindingOwner = null; catalog = null;
    assembly = ''; kind = 'instance'; choice = ''; parameter = ''; message = ''; view = null;
    container.replaceChildren();
  }
  function createView(token) {
    const title = node('h4'), note = node('p'), load = node('button'), status = node('p'), source = node('p'), fields = node('div'), detail = node('p'), use = node('button');
    const makeField = (suffix, css) => {
      const label = node('label'), caption = node('span'), select = node('select');
      label.className = 'scene-behaviors-reference-' + css; select.id = 'sceneBehaviorsReferences' + suffix;
      label.append(caption, select); fields.append(label); return { label, caption, select };
    };
    for (const [suffix, element] of [['Title', title], ['Note', note], ['Load', load], ['Status', status], ['Source', source], ['Detail', detail], ['Use', use]]) element.id = 'sceneBehaviorsReferences' + suffix;
    note.className = status.className = source.className = detail.className = 'scene-behaviors-note';
    fields.className = 'scene-behaviors-reference-fields';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    load.type = use.type = 'button'; load.className = use.className = 'doc-btn doc-btn-ghost';
    const result = { title, note, load, status, source, fields, detail, use,
      assembly: makeField('Assembly', 'assembly'), kind: makeField('Kind', 'kind'), choice: makeField('Choice', 'choice'), parameter: makeField('Parameter', 'parameter') };
    result.choice.select.setAttribute('aria-describedby', detail.id);
    container.append(title, note, load, status, source, fields, detail, use);
    load.addEventListener('click', () => { if (mutable(token)) void read(token, ''); });
    result.assembly.select.addEventListener('change', () => {
      if (!mutable(token) || !usable(getContext())) return;
      const selected = result.assembly.select.value;
      if (selected && !catalog.assemblies.some(item => item.objectId === selected)) { refresh(); return; }
      if (selected !== assembly) void read(token, selected);
    });
    result.kind.select.addEventListener('change', () => {
      if (!mutable(token) || !['instance', 'scene', 'action'].includes(result.kind.select.value)) return;
      kind = result.kind.select.value; choice = ''; refresh();
    });
    result.choice.select.addEventListener('change', () => {
      if (!mutable(token) || !usable(getContext())) return;
      const value = result.choice.select.value;
      if (value && !entries().some(item => item.value === value)) { refresh(); return; }
      choice = value; refresh();
    });
    result.parameter.select.addEventListener('change', () => {
      if (!mutable(token)) return;
      const value = result.parameter.select.value;
      if (value && !rowsById(getContext()).has(value)) { refresh(); return; }
      parameter = value; refresh();
    });
    use.addEventListener('click', () => { if (mutable(token)) void insert(token); });
    return result;
  }
  function refresh() {
    if (disposed) return;
    const context = getContext();
    if (!eligible(context)) { reset(); container.hidden = true; return; }
    if (!sameOwner(owner, context)) { reset(); owner = sourceOwner(context); view = createView(owner); }
    if (!sameBinding(bindingOwner, context)) {
      generation++; loading = false; parameter = ''; bindingOwner = binding(context);
      if (message === '正在读取已保存的连接目录…' || message === '正在重新核对参数来源…') message = '';
    }
    if (context.pending && loading) { generation++; loading = false; message = '连接操作已失效；参数与审阅保持不变，请重试。'; }
    container.hidden = false; container.classList.add('scene-behaviors-reference-tools'); container.setAttribute('aria-busy', String(loading));
    const ready = usable(context), locked = loading || Boolean(context.pending), rows = rowsById(context);
    if (!rows.has(parameter)) parameter = '';
    const values = ready ? entries() : [];
    if (!values.some(item => item.value === choice)) choice = '';
    view.title.textContent = translate('按名称连接行为参数');
    view.note.textContent = translate('先选择参考项和文本参数，点击填入后仍需检查、审阅并普通保存。');
    view.load.textContent = translate('读取连接目录'); view.load.disabled = locked;
    view.assembly.caption.textContent = translate('用于参考的项目组装');
    options(view.assembly.select, [['', translate('请选择组装（不自动选择）')], ...(catalog?.assemblies || []).map(item => [item.objectId, `${item.name} · ${item.sourcePath} · ${item.objectId}`])], assembly);
    view.assembly.select.disabled = locked || !ready || !catalog.assemblies.length;
    view.kind.caption.textContent = translate('参考类型');
    options(view.kind.select, [['instance', translate('本场景实例')], ['scene', translate('组装成员场景')], ['action', translate('组装输入动作')]], kind); view.kind.select.disabled = locked || !ready;
    view.choice.caption.textContent = translate('参考项');
    options(view.choice.select, [['', translate('请选择参考项')], ...values.map(item => [item.value, item.label])], choice); view.choice.select.disabled = locked || !ready || !values.length;
    view.parameter.caption.textContent = translate('写入哪个文本参数');
    options(view.parameter.select, [['', translate('请选择文本参数')], ...[...rows].map(([key, row]) => [key, translate('参数 {0} · {1}', row.index + 1, row.key.value)])], parameter);
    view.parameter.select.disabled = locked || !ready || !rows.size;
    view.source.textContent = ready ? translate('场景来源：{0}', catalog.scene.sourcePath) + (catalog.selectedAssembly ? '\n' + translate('组装来源：{0}', catalog.selectedAssembly.sourcePath) : '') : '';
    view.detail.textContent = values.find(item => item.value === choice)?.detail || '';
    let hint = '读取来源后再选择。';
    if (ready) {
      if (!rows.size) hint = '当前没有可选文本参数；数字和布尔值保持原样。';
      else if (kind !== 'instance' && !catalog.selectedAssembly) hint = '请选择项目组装后读取成员场景和输入动作。';
      else if (kind === 'action' && !catalog.selectedAssembly.inputMap) hint = '当前组装未声明输入映射；文本参数仍可直接编辑。';
      else if (!values.length) hint = '所选参考类型没有可用条目；文本参数仍可直接编辑。';
      else if (!catalog.assemblies.length) hint = '当前场景不属于任何已保存组装；仍可选择本场景实例。';
      else hint = '选择不会修改参数；点击填入才会更改文本值。';
    }
    view.status.textContent = translate(message || hint); view.status.dataset.status = loading ? 'loading' : ready ? 'ready' : message ? 'error' : 'idle';
    view.use.textContent = translate('填入参数值'); view.use.disabled = locked || !ready || !choice || !parameter || !selectionCurrent();
  }
  async function read(token, assemblyId) {
    if (!mutable(token)) return false;
    const context = getContext(), selectedBinding = binding(context), request = ++generation;
    const owns = () => request === generation && sameOwner(token) && sameBinding(selectedBinding);
    loading = true; message = '正在读取已保存的连接目录…'; refresh();
    try {
      const value = await getReferences(context.source, { assemblyObjectId: assemblyId || null });
      if (!owns()) {
        if (request === generation && sameOwner(token)) message = '连接操作已失效；参数与审阅保持不变，请重试。';
        return false;
      }
      if (!branded(value, getContext(), assemblyId)) throw Error('Invalid reference directory.');
      catalog = value; assembly = assemblyId; choice = ''; message = ''; return true;
    } catch {
      if (owns()) { catalog = null; assembly = ''; choice = ''; message = '无法读取连接目录；参数与审阅保持不变，可以重试。'; }
      return false;
    } finally { if (request === generation && sameOwner(token)) { loading = false; refresh(); } }
  }
  async function insert(token) {
    const context = getContext();
    if (!mutable(token) || !usable(context) || !selectionCurrent()) return false;
    const row = rowsById(context).get(parameter), selected = { assembly, kind, choice, parameter }, original = catalog;
    if (!row || !choice) return false;
    const rowState = { identity: row.identity, key: row.key, type: row.type, value: row.value,
      name: row.key.value, scalar: row.value.value, bindingId: row.bindingId };
    const selectedBinding = binding(context), fingerprint = JSON.stringify(original), request = ++generation;
    const owns = () => request === generation && sameOwner(token) && sameBinding(selectedBinding) && !getContext().pending
      && catalog === original && assembly === selected.assembly && kind === selected.kind && choice === selected.choice && parameter === selected.parameter
      && selectionCurrent() && rowsById(getContext()).get(parameter) === row && row.identity === rowState.identity
      && row.key === rowState.key && row.type === rowState.type && row.value === rowState.value && row.bindingId === rowState.bindingId
      && row.key.value === rowState.name && row.type.value === 'string' && row.value.value === rowState.scalar;
    loading = true; message = '正在重新核对参数来源…'; refresh();
    try {
      const current = await getReferences(context.source, { assemblyObjectId: selected.assembly || null });
      if (!owns()) {
        if (request === generation && sameOwner(token)) message = '连接操作已失效；参数与审阅保持不变，请重试。';
        return false;
      }
      if (!branded(current, getContext(), selected.assembly) || current.revision !== original.revision || JSON.stringify(current) !== fingerprint) {
        catalog = null; assembly = ''; choice = ''; message = '连接目录已变化，请重新读取；参数与审阅保持不变。'; return false;
      }
      const value = sceneBehaviorReferenceValue(current, { kind: selected.kind, value: selected.choice });
      if (typeof value !== 'string' || !owns()) return false;
      // No await separates the final ownership/row check and scalar insertion.
      loading = false; message = '已填入文本参数；仍需检查、审阅并普通保存。'; onUse(row, value); return true;
    } catch {
      if (owns()) { catalog = null; assembly = ''; choice = ''; message = '无法读取连接目录；参数与审阅保持不变，可以重试。'; }
      return false;
    } finally { if (request === generation && sameOwner(token)) { loading = false; refresh(); } }
  }
  refresh();
  return Object.freeze({ refresh, reset, dispose() { if (disposed) return; reset(); disposed = true; container.hidden = true; } });
}

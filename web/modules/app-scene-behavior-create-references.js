import { captureSceneBehaviorCreateReferences, isSceneBehaviorCreateReferences, sceneBehaviorCreateReferencesMatchOrigin,
  listSceneBehaviorCreateStringParameters, proposeSceneBehaviorCreateReference } from '../../engine/scene-behavior-create-references.mjs';
import { t } from '../i18n/index.js';

// First creation has no registered behavior source. The parent owns its local
// JSON, identities and review; this helper only reads saved reference names.
export function setupSceneBehaviorCreateReferences({ container, getContext = () => ({}), getReferences, onUse = () => {}, translate = t } = {}) {
  const document = container.ownerDocument;
  const node = (tag, value = '') => { const element = document.createElement(tag); element.textContent = value; return element; };
  const ownerKeys = ['session', 'catalog', 'source', 'bindingId', 'instanceId', 'backendId', 'language', 'epoch', 'readEpoch'];
  const sceneKeys = ['objectId', 'objectRevision', 'sourcePath', 'sourceRevision'];
  let disposed = false, owner = null, view = null, catalog = null, generation = 0, loading = false, inflightContent = '';
  let assembly = '', kind = '', choice = '', parameter = '', message = '';
  const eligible = context => !disposed && context.available === true && context.current === true && typeof getReferences === 'function'
    && context.session && context.catalog && context.source && context.bindingId && context.instanceId && context.origin && typeof context.content === 'string';
  const originSnapshot = origin => ({ worldId: origin.worldId, baseRevision: origin.baseRevision,
    scene: Object.fromEntries(sceneKeys.map(key => [key, origin.scene[key]])) });
  const sameOrigin = (left, right) => Boolean(left && right && left.worldId === right.worldId && left.baseRevision === right.baseRevision
    && left.scene && right.scene && sceneKeys.every(key => left.scene[key] === right.scene[key]));
  const sameOwner = (token, context = getContext()) => Boolean(token && token === owner && eligible(context)
    && ownerKeys.every(key => token[key] === context[key]) && sameOrigin(token.origin, context.origin));
  const mutable = token => sameOwner(token) && !getContext().pending && !loading;
  const selectionCurrent = () => Boolean(view && view.assembly.select.value === assembly && view.kind.select.value === kind
    && view.choice.select.value === choice && view.parameter.select.value === parameter);
  const usable = context => sameOwner(owner, context) && isSceneBehaviorCreateReferences(catalog) && sceneBehaviorCreateReferencesMatchOrigin(catalog, context.origin)
    && (catalog.selectedAssembly?.objectId || '') === assembly;
  const stringParameters = context => { try { return listSceneBehaviorCreateStringParameters(context.content); } catch { return null; } };
  function entries() {
    if (!catalog) return [];
    if (kind === 'instance') return catalog.instances.map((row, index) => ({ value: row.instanceId,
      label: translate('实例 {0} · {1} · {2}', index + 1, row.name, row.instanceId), detail: row.name + '\n'
        + translate('实例编号：{0}；定义编号：{1}；来源：{2}', row.instanceId, row.objectId, row.sourcePath) }));
    if (kind === 'scene') return (catalog.selectedAssembly?.members || []).map(row => ({ value: row.objectId,
      label: `${row.name} · ${row.objectId}`, detail: `${row.name} · ${row.objectId} · ${row.sourcePath}` }));
    if (kind === 'action') return (catalog.selectedAssembly?.actions || []).map(row => ({ value: row.name,
      label: translate('动作 {0} · {1}', row.name, row.keys.join(' / ')), detail: translate('输入映射来源：{0}', catalog.selectedAssembly.inputMap?.sourcePath || '') }));
    return [];
  }
  function options(select, values, selected) {
    const signature = JSON.stringify(values);
    if (select.__creationReferenceOptions !== signature) {
      select.replaceChildren(); for (const [value, label] of values) { const option = node('option', label); option.value = value; select.append(option); }
      select.__creationReferenceOptions = signature;
    }
    select.value = values.some(([value]) => value === selected) ? selected : '';
  }
  function reset() {
    generation++; loading = false; inflightContent = ''; owner = null; view = null; catalog = null;
    assembly = ''; kind = ''; choice = ''; parameter = ''; message = ''; container.replaceChildren();
  }
  function createView(token) {
    const title = node('h4'), note = node('p'), load = node('button'), status = node('p'), source = node('p'), fields = node('div'), detail = node('p'), use = node('button');
    const field = suffix => {
      const label = node('label'), caption = node('span'), select = node('select'); select.id = 'sceneBehaviorCreateReferences' + suffix;
      label.append(caption, select); fields.append(label); return { label, caption, select };
    };
    for (const [suffix, element] of [['Title', title], ['Note', note], ['Load', load], ['Status', status], ['Source', source], ['Detail', detail], ['Use', use]]) element.id = 'sceneBehaviorCreateReferences' + suffix;
    note.className = status.className = source.className = detail.className = 'scene-behavior-create-note';
    fields.className = 'scene-behavior-create-reference-fields'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    load.type = use.type = 'button'; load.className = use.className = 'doc-btn doc-btn-ghost';
    const value = { title, note, load, status, source, fields, detail, use, assembly: field('Assembly'), kind: field('Kind'), choice: field('Choice'), parameter: field('Parameter') };
    value.choice.select.setAttribute('aria-describedby', detail.id); container.append(title, note, load, status, source, fields, detail, use);
    load.addEventListener('click', () => { if (mutable(token)) void read(token, ''); });
    value.assembly.select.addEventListener('change', () => {
      if (!mutable(token) || !usable(getContext())) return;
      const selected = value.assembly.select.value;
      if (selected && !catalog.assemblies.some(row => row.objectId === selected)) { refresh(); return; }
      if (selected !== assembly) void read(token, selected);
    });
    value.kind.select.addEventListener('change', () => {
      if (!mutable(token) || !['', 'instance', 'scene', 'action'].includes(value.kind.select.value)) return;
      kind = value.kind.select.value; choice = ''; refresh();
    });
    value.choice.select.addEventListener('change', () => {
      if (!mutable(token) || !usable(getContext())) return;
      const selected = value.choice.select.value;
      if (selected && !entries().some(row => row.value === selected)) { refresh(); return; }
      choice = selected; refresh();
    });
    value.parameter.select.addEventListener('change', () => {
      if (!mutable(token)) return;
      const selected = value.parameter.select.value;
      if (selected && !stringParameters(getContext())?.some(row => row.name === selected)) { refresh(); return; }
      parameter = selected; refresh();
    });
    use.addEventListener('click', () => { if (mutable(token)) void insert(token); });
    return value;
  }
  function clearDirectory() { catalog = null; assembly = ''; choice = ''; }
  function refresh() {
    if (disposed) return;
    const context = getContext();
    if (!eligible(context)) { reset(); container.hidden = true; return; }
    if (!sameOwner(owner, context)) { reset(); owner = { ...Object.fromEntries(ownerKeys.map(key => [key, context[key]])), origin: originSnapshot(context.origin) }; view = createView(owner); }
    if (loading && (context.pending || context.content !== inflightContent)) {
      generation++; loading = false; clearDirectory(); message = '连接操作已失效；参数与审阅保持不变，请重试。';
    }
    container.hidden = false; container.className = 'scene-behavior-create-references'; container.setAttribute('aria-busy', String(loading));
    const ready = usable(context), locked = loading || Boolean(context.pending), parameters = stringParameters(context), values = ready ? entries() : [];
    if (!parameters?.some(row => row.name === parameter)) parameter = '';
    if (!values.some(row => row.value === choice)) choice = '';
    view.title.textContent = translate('按名称连接行为参数');
    view.note.textContent = translate('从已保存场景、组装和输入映射读取名称；明确填入一个已有文本参数后，仍需审阅新行为并保存。');
    view.load.textContent = translate('读取连接目录'); view.load.disabled = locked;
    view.assembly.caption.textContent = translate('用于参考的项目组装');
    options(view.assembly.select, [['', translate('请选择组装（不自动选择）')], ...(catalog?.assemblies || []).map(row => [row.objectId, `${row.name} · ${row.sourcePath} · ${row.objectId}`])], assembly);
    view.assembly.select.disabled = locked || !ready || !catalog.assemblies.length;
    view.kind.caption.textContent = translate('参考类型'); options(view.kind.select, [['', translate('请选择参考类型')], ['instance', translate('本场景实例')], ['scene', translate('组装成员场景')], ['action', translate('组装输入动作')]], kind);
    view.kind.select.disabled = locked || !ready;
    view.choice.caption.textContent = translate('参考项'); options(view.choice.select, [['', translate('请选择参考项')], ...values.map(row => [row.value, row.label])], choice);
    view.choice.select.disabled = locked || !ready || !values.length;
    view.parameter.caption.textContent = translate('写入哪个文本参数'); options(view.parameter.select, [['', translate('请选择文本参数')], ...(parameters || []).map(row => [row.name, row.name])], parameter);
    view.parameter.select.disabled = locked || !ready || !parameters?.length;
    view.source.textContent = ready ? translate('场景来源：{0}', catalog.scene.sourcePath) + (catalog.selectedAssembly ? '\n' + translate('组装来源：{0}', catalog.selectedAssembly.sourcePath) : '') : '';
    view.detail.textContent = values.find(row => row.value === choice)?.detail || '';
    let hint = '读取来源后再选择。';
    if (parameters === null) hint = '参数 JSON 尚未有效，辅助不会修改原文；请继续手工编辑。';
    else if (ready) {
      if (!parameters.length) hint = '当前没有可选文本参数；数字和布尔值保持原样。';
      else if (kind && kind !== 'instance' && !catalog.selectedAssembly) hint = '请选择项目组装后读取成员场景和输入动作。';
      else if (kind === 'action' && !catalog.selectedAssembly.inputMap) hint = '当前组装未声明输入映射；文本参数仍可直接编辑。';
      else if (kind && !values.length) hint = '所选参考类型没有可用条目；文本参数仍可直接编辑。';
      else if (!catalog.assemblies.length) hint = '当前场景不属于任何已保存组装；仍可选择本场景实例。';
      else hint = '选择不会修改参数；点击填入才会更改文本值。';
    }
    view.status.textContent = translate(message || hint); view.status.dataset.status = loading ? 'loading' : ready ? 'ready' : message ? 'error' : 'idle';
    view.use.textContent = translate('填入参数值'); view.use.disabled = locked || !ready || !kind || !choice || !parameter || !selectionCurrent();
  }
  const changedOriginMessage = '连接目录与创建来源不一致；请在创建窗口重新读取工程，参数与审阅保持不变。';
  const readFailure = error => error && typeof error === 'object' && Object.getOwnPropertyDescriptor(error, 'uiKey')?.value === changedOriginMessage
    ? changedOriginMessage : '无法读取连接目录；参数与审阅保持不变，可以重试。';
  function captureDirectory(raw, context, assemblyId) {
    try {
      const value = captureSceneBehaviorCreateReferences(context.origin, raw);
      if (!isSceneBehaviorCreateReferences(value) || !sceneBehaviorCreateReferencesMatchOrigin(value, context.origin) || (value.selectedAssembly?.objectId || '') !== assemblyId) throw Error('Invalid creation reference directory.');
      return value;
    } catch { throw Object.assign(new Error('Creation reference sources changed or are invalid.'), { uiKey: changedOriginMessage }); }
  }
  async function read(token, assemblyId) {
    if (!mutable(token)) return false;
    const context = getContext(), before = context.content, request = ++generation;
    assembly = assemblyId; choice = ''; loading = true; inflightContent = before; message = '正在读取已保存的连接目录…'; refresh();
    const owns = () => request === generation && sameOwner(token) && !getContext().pending && getContext().content === before && selectionCurrent() && assembly === assemblyId;
    try {
      const raw = await getReferences({ sceneObjectId: token.origin.scene.objectId, assemblyObjectId: assemblyId || null });
      if (!owns()) { if (request === generation && sameOwner(token)) message = '连接操作已失效；参数与审阅保持不变，请重试。'; return false; }
      catalog = captureDirectory(raw, getContext(), assemblyId); choice = ''; message = ''; return true;
    } catch (error) {
      if (owns()) { clearDirectory(); message = readFailure(error); }
      return false;
    } finally { if (request === generation && sameOwner(token)) { loading = false; refresh(); } }
  }
  async function insert(token) {
    const context = getContext();
    if (!mutable(token) || !usable(context) || !selectionCurrent() || !stringParameters(context)?.some(row => row.name === parameter) || !entries().some(row => row.value === choice)) return false;
    const selected = { assembly, kind, choice, parameter }, before = context.content, original = catalog, fingerprint = JSON.stringify(catalog), request = ++generation;
    const owns = () => request === generation && sameOwner(token) && !getContext().pending && getContext().content === before && catalog === original
      && assembly === selected.assembly && kind === selected.kind && choice === selected.choice && parameter === selected.parameter && selectionCurrent();
    loading = true; inflightContent = before; message = '正在重新核对参数来源…'; refresh();
    try {
      const raw = await getReferences({ sceneObjectId: token.origin.scene.objectId, assemblyObjectId: selected.assembly || null });
      if (!owns()) { if (request === generation && sameOwner(token)) message = '连接操作已失效；参数与审阅保持不变，请重试。'; return false; }
      const current = captureDirectory(raw, getContext(), selected.assembly);
      if (current.revision !== original.revision || JSON.stringify(current) !== fingerprint) { clearDirectory(); message = '连接目录已变化，请重新读取；参数与审阅保持不变。'; return false; }
      const proposed = proposeSceneBehaviorCreateReference({ content: before, catalog: current, origin: getContext().origin, parameter: selected.parameter, kind: selected.kind, value: selected.choice });
      if (!owns()) return false;
      loading = false;
      if (proposed.changed) { message = '已填入文本参数；仍需审阅新行为并保存。'; onUse(proposed, { isCurrent: owns }); }
      else message = '所选值与当前参数相同，参数与审阅保持不变。';
      return true;
    } catch (error) {
      if (owns()) {
        if (error && typeof error === 'object' && Object.getOwnPropertyDescriptor(error, 'errorCode')?.value === 'scene_behavior_create_parameters_invalid')
          message = '无法填入参数，原始输入已保留；请检查参数大小和数量。';
        else { clearDirectory(); message = readFailure(error); }
      }
      return false;
    } finally { if (request === generation && sameOwner(token)) { loading = false; refresh(); } }
  }
  refresh();
  return Object.freeze({ refresh, reset, dispose() { if (disposed) return; reset(); disposed = true; container.hidden = true; } });
}

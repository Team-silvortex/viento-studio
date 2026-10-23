import { reviewScriptParameterRows } from '../../engine/script-parameter-interface.mjs';

// Advisory interface review and explicit local row actions only. No discovery,
// source writes, script execution or automatic name migration belongs here.
export function setupSceneBehaviorParameters({ container, getContext = () => ({}), onAddMissing = () => {}, onRename = () => {}, translate = value => value } = {}) {
  const document = container.ownerDocument;
  container.className = 'scene-behaviors-parameter-interface';
  container.innerHTML = `<h4 id="sceneBehaviorsParameterInterfaceTitle"></h4><p id="sceneBehaviorsParameterInterfaceNote" class="scene-behaviors-note"></p>
    <ul id="sceneBehaviorsParameterDeclarations"></ul><p id="sceneBehaviorsParameterInterfaceStatus" class="scene-behaviors-note" role="status" aria-live="polite"></p>
    <ul id="sceneBehaviorsParameterIssues"></ul><div id="sceneBehaviorsParameterAddArea"></div>`;
  const el = suffix => container.querySelector('#sceneBehaviorsParameter' + suffix);
  const node = (tag, text = '') => { const element = document.createElement(tag); element.textContent = text; return element; };
  const typeLabel = type => translate({ string: '文本', number: '数字', boolean: '布尔值' }[type] || type);
  let disposed = false, owner = null, add = null;
  const choices = new Map(), pickers = new Map();
  const attached = context => !disposed && context.current === true && context.session && context.source && context.contract && Array.isArray(context.rows);
  const same = (context, observed = owner) => Boolean(observed && attached(context) && context.session === observed.session && context.source === observed.source
    && context.contract === observed.contract && context.rows === observed.rows && context.bindingId === observed.bindingId
    && context.backendId === observed.backendId && context.language === observed.language);
  function review(context) { return reviewScriptParameterRows(context.contract, { backendId: context.backendId, language: context.language, parameters: context.parameters }); }
  function reset() {
    owner = null; choices.clear(); for (const picker of pickers.values()) picker.wrapper.remove(); pickers.clear();
    el('AddArea').replaceChildren(); add = null; container.hidden = true;
  }
  const canMutate = observed => { const context = getContext(); return same(context, observed) && owner === observed && !context.pending; };
  function pickerState(row, picker) {
    const context = getContext();
    if (!canMutate(picker.owner) || pickers.get(row) !== picker || !context.rows.includes(row) || row.bindingId !== context.bindingId) return null;
    try {
      const value = review(context), index = context.rows.indexOf(row);
      if (value.status !== 'ready' || value.duplicateNames.length || !value.unknown.some(item => item.index === index)) return null;
      const target = value.missing.find(item => item.name === picker.select.value && item.type === row.type.value);
      return target && choices.get(row.identity) === target.name ? target : null;
    } catch { return null; }
  }
  function refresh() {
    if (disposed) return;
    const context = getContext();
    if (!attached(context)) { reset(); return; }
    if (!same(context)) {
      reset(); owner = { session: context.session, source: context.source, contract: context.contract, rows: context.rows,
        bindingId: context.bindingId, backendId: context.backendId, language: context.language };
      const observed = owner;
      add = node('button'); add.id = 'sceneBehaviorsAddMissingParameters'; add.type = 'button'; add.className = 'doc-btn doc-btn-ghost'; el('AddArea').append(add);
      add.addEventListener('click', () => {
        if (!canMutate(observed)) return;
        try {
          const value = review(getContext()); if (value.status !== 'ready' || !value.canAddMissing) return;
          const guard = () => {
            if (!canMutate(observed)) return false;
            try { const current = review(getContext()); return current.canAddMissing && JSON.stringify(current.missing) === JSON.stringify(value.missing); } catch { return false; }
          };
          if (guard()) onAddMissing(value.missing, { isCurrent: guard });
        } catch { refresh(); }
      });
    }
    container.hidden = false;
    el('InterfaceTitle').textContent = translate('脚本参数接口');
    el('InterfaceNote').textContent = translate('接口提示不会自动修改或删除参数。新增参数留空时播放完整动画；可继续用片段选择器填入编号。');
    el('Declarations').replaceChildren(); el('Issues').replaceChildren();
    let value;
    try { value = review(context); } catch { value = { status: 'unavailable', missing: [], unknown: [], typeMismatches: [], invalidValues: [], duplicateNames: [], canAddMissing: false }; }
    container.dataset.status = value.status;
    const statusKey = { modified: '脚本源码已手改，参数辅助已停用；普通参数编辑仍可使用。', unsupported: '此脚本声明版本暂不支持参数辅助；普通参数编辑仍可使用。',
      unavailable: '当前无法读取脚本参数接口；普通参数编辑仍可使用。', incompatible: '脚本参数接口与当前后端或语言不匹配；普通参数编辑仍可使用。' }[value.status];
    if (statusKey) el('InterfaceStatus').textContent = translate(statusKey);
    else {
      for (const declaration of context.contract.parameters) {
        el('Declarations').append(node('li', translate('声明参数：{0} · {1} · {2}', declaration.name, typeLabel(declaration.type),
          declaration.referenceKind === 'animation-clip' ? translate('动画片段编号，留空播放完整动画') : translate('默认值：{0}', String(declaration.defaultValue)))));
      }
      el('InterfaceStatus').textContent = translate('缺失 {0} · 未声明 {1} · 类型不匹配 {2} · 无效编号 {3} · 重复名称 {4}',
        value.missing.length, value.unknown.length, value.typeMismatches.length, value.invalidValues.length, value.duplicateNames.length);
      for (const item of value.missing) el('Issues').append(node('li', translate('缺失参数：{0}', item.name)));
      for (const item of value.unknown) el('Issues').append(node('li', translate('未声明参数（保留原值）：{0}', item.name || translate('未命名参数'))));
      for (const item of value.typeMismatches) el('Issues').append(node('li', translate('参数 {0} 需要 {1}，当前为 {2}。', item.name, typeLabel(item.expectedType), typeLabel(item.actualType))));
      for (const item of value.invalidValues) el('Issues').append(node('li', translate('参数 {0} 需要完整的小写片段 UUID；留空表示完整动画。', item.name)));
      for (const item of value.duplicateNames) el('Issues').append(node('li', translate('参数名重复：{0}；请先手动修正。', item.name || translate('未命名参数'))));
    }
    add.textContent = translate('补齐缺失参数'); add.disabled = !canMutate(owner) || value.status !== 'ready' || !value.canAddMissing;
    const unknown = new Set(value.status === 'ready' ? value.unknown.map(item => item.index) : []);
    for (const [row, picker] of pickers) if (!context.rows.includes(row) || !unknown.has(context.rows.indexOf(row))) {
      picker.wrapper.remove(); pickers.delete(row); choices.delete(row.identity);
    }
    for (const [index, row] of context.rows.entries()) {
      if (!unknown.has(index)) continue;
      let picker = pickers.get(row);
      if (!picker) {
        const wrapper = node('div'); wrapper.className = 'scene-behaviors-parameter-rename';
        const label = node('label'), caption = node('span'), select = node('select'); select.id = `sceneBehaviorsParam${row.index}ContractTarget`; label.append(caption, select);
        const use = node('button'); use.id = `sceneBehaviorsParam${row.index}RenameParameter`; use.type = 'button'; use.className = 'doc-btn doc-btn-ghost';
        wrapper.append(label, use); row.wrapper.append(wrapper); picker = { wrapper, caption, select, use, owner, signature: '' }; pickers.set(row, picker);
        select.addEventListener('change', () => { if (!canMutate(picker.owner) || pickers.get(row) !== picker) return; choices.set(row.identity, select.value); refresh(); });
        use.addEventListener('click', () => {
          const target = pickerState(row, picker); if (!target) return;
          const guard = () => pickerState(row, picker)?.name === target.name;
          if (guard()) onRename(row, target, { isCurrent: guard });
        });
      }
      const missing = value.missing.filter(item => item.type === row.type.value);
      const signature = JSON.stringify([missing.map(item => item.name), translate('请选择缺失参数')]);
      if (picker.signature !== signature) {
        const chosen = choices.get(row.identity) || ''; picker.signature = signature; picker.select.replaceChildren();
        for (const [name, caption] of [['', translate('请选择缺失参数')], ...missing.map(item => [item.name, item.name])]) { const option = node('option', caption); option.value = name; picker.select.append(option); }
        picker.select.value = missing.some(item => item.name === chosen) ? chosen : ''; choices.set(row.identity, picker.select.value);
      }
      picker.caption.textContent = translate('更名为缺失参数（保留值）'); picker.use.textContent = translate('更名并保留值');
      picker.select.disabled = !canMutate(owner) || value.duplicateNames.length > 0 || missing.length === 0;
      picker.use.disabled = !pickerState(row, picker);
    }
  }
  refresh();
  return Object.freeze({ refresh, reset, dispose() { if (disposed) return; reset(); disposed = true; container.replaceChildren(); } });
}

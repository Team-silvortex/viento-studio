import { captureScriptParameterContract } from '../../engine/script-parameter-interface.mjs';
import { reviewSceneBehaviorCreateParameters, proposeSceneBehaviorCreateParameters } from '../../engine/scene-behavior-create-parameters.mjs';

// The declaration is advisory. Only an explicit action proposes a local JSON
// edit; the parent still owns the binding, review and author transaction.
export function setupSceneBehaviorCreateParameters({ container, getContext = () => ({}), onUse = () => {}, translate = value => value } = {}) {
  const document = container.ownerDocument;
  container.className = 'scene-behavior-create-parameters';
  container.innerHTML = `<h4 id="sceneBehaviorCreateParameterTitle"></h4><p id="sceneBehaviorCreateParameterNote" class="scene-behavior-create-note"></p>
    <ul id="sceneBehaviorCreateParameterDeclarations"></ul><p id="sceneBehaviorCreateParameterStatus" class="scene-behavior-create-note" role="status" aria-live="polite"></p>
    <p id="sceneBehaviorCreateParameterError" class="scene-behavior-create-note" role="status" aria-live="polite"></p>
    <ul id="sceneBehaviorCreateParameterIssues"></ul><div id="sceneBehaviorCreateParameterActions"></div>`;
  const el = suffix => container.querySelector('#sceneBehaviorCreateParameter' + suffix);
  const node = (tag, value = '') => { const element = document.createElement(tag); element.textContent = value; return element; };
  const typeLabel = type => translate({ string: '文本', number: '数字', boolean: '布尔值' }[type] || type);
  let owner = null, add = null, disposed = false, failure = null;
  const attached = context => !disposed && context.current === true && context.session && context.catalog && context.source && context.bindingId;
  const same = (context, observed = owner) => Boolean(observed && attached(context) && context.session === observed.session && context.catalog === observed.catalog
    && context.source === observed.source && context.bindingId === observed.bindingId && context.backendId === observed.backendId && context.language === observed.language
    && context.epoch === observed.epoch && context.readEpoch === observed.readEpoch);
  const canUse = observed => { const context = getContext(); return owner === observed && same(context, observed) && !context.pending; };
  const input = context => ({ content: context.content, contract: context.source.parameterContract, backendId: context.backendId, language: context.language });
  function reset() { owner = null; add = null; failure = null; container.hidden = true; el('Actions').replaceChildren(); }
  function refresh() {
    if (disposed) return;
    const context = getContext();
    if (!attached(context)) { reset(); return; }
    if (!same(context)) {
      reset(); owner = { session: context.session, catalog: context.catalog, source: context.source, bindingId: context.bindingId,
        backendId: context.backendId, language: context.language, epoch: context.epoch, readEpoch: context.readEpoch };
      const observed = owner;
      add = node('button'); add.id = 'sceneBehaviorCreateAddMissingParameters'; add.type = 'button'; add.className = 'doc-btn doc-btn-ghost'; el('Actions').append(add);
      add.addEventListener('click', () => {
        if (!canUse(observed)) return;
        const before = getContext();
        try {
          const reviewed = reviewSceneBehaviorCreateParameters(input(before));
          if (reviewed.status !== 'ready' || !reviewed.canAddMissing) return;
          const proposed = proposeSceneBehaviorCreateParameters(input(before));
          const guard = () => canUse(observed) && getContext().content === before.content;
          if (guard() && proposed.content !== before.content && proposed.added.length) { failure = null; onUse(proposed, { isCurrent: guard }); }
        } catch {
          if (canUse(observed) && getContext().content === before.content) failure = { owner: observed, content: before.content };
          refresh();
        }
      });
    }
    container.hidden = false;
    el('Title').textContent = translate('脚本参数接口');
    el('Note').textContent = translate('参数接口仅作提示。补齐只追加缺失默认项，保留已有参数；选择脚本不会自动填入。');
    el('Declarations').replaceChildren(); el('Issues').replaceChildren();
    let contract = null, review = null, status = 'unavailable';
    try { contract = captureScriptParameterContract(context.source.parameterContract); status = contract.status; } catch {}
    if (contract) {
      for (const declaration of contract.parameters) el('Declarations').append(node('li', translate('声明参数：{0} · {1} · {2}', declaration.name, typeLabel(declaration.type),
        declaration.referenceKind === 'animation-clip' ? translate('动画片段编号，留空播放完整动画') : translate('默认值：{0}', String(declaration.defaultValue)))));
      try { review = reviewSceneBehaviorCreateParameters(input(context)); status = review.status; } catch { status = 'invalid'; }
    }
    container.dataset.status = status;
    el('Error').textContent = failure?.owner === owner && failure.content === context.content ? translate('无法补齐参数，原始输入已保留；请检查参数大小和数量。') : '';
    const statusKey = { unavailable: '当前无法读取脚本参数接口；普通参数编辑仍可使用。', modified: '脚本源码已手改，参数辅助已停用；普通参数编辑仍可使用。',
      unsupported: '此脚本声明版本暂不支持参数辅助；普通参数编辑仍可使用。', incompatible: '脚本参数接口与当前后端或语言不匹配；普通参数编辑仍可使用。',
      invalid: '参数 JSON 尚未有效，辅助不会修改原文；请继续手工编辑。' }[status];
    if (statusKey) el('Status').textContent = translate(statusKey);
    else {
      el('Status').textContent = translate('缺失 {0} · 未声明 {1} · 类型不匹配 {2} · 无效编号 {3} · 重复名称 {4}', review.missing.length,
        review.unknown.length, review.typeMismatches.length, review.invalidValues.length, review.duplicateNames.length);
      for (const row of review.missing) el('Issues').append(node('li', translate('缺失参数：{0}', row.name)));
      for (const row of review.unknown) el('Issues').append(node('li', translate('未声明参数（保留原值）：{0}', row.name || translate('未命名参数'))));
      for (const row of review.typeMismatches) el('Issues').append(node('li', translate('参数 {0} 需要 {1}，当前为 {2}。', row.name, typeLabel(row.expectedType), typeLabel(row.actualType))));
      for (const row of review.invalidValues) el('Issues').append(node('li', translate('参数 {0} 需要完整的小写片段 UUID；留空表示完整动画。', row.name)));
      for (const row of review.duplicateNames) el('Issues').append(node('li', translate('参数名重复：{0}；请先手动修正。', row.name || translate('未命名参数'))));
    }
    add.textContent = translate('补齐缺失参数'); add.disabled = !canUse(owner) || status !== 'ready' || !review?.canAddMissing;
  }
  refresh();
  return Object.freeze({ refresh, reset, dispose() { if (disposed) return; reset(); disposed = true; container.replaceChildren(); } });
}

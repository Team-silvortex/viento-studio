import { createAnimationStateGraph, layoutAnimationStateGraph } from '../../engine/animation-state-graph.mjs';

// A view of the current form only. Selection and field location grant no table,
// draft, file or execution writes. The parent owns stable form-row identities.
export function setupAnimationStateGraph({ container, getContext = () => ({}), getTable, onLocate = () => false, translate = value => value, idPrefix = 'animationStateScriptGraph' } = {}) {
  const document = container.ownerDocument, ns = 'http://www.w3.org/2000/svg';
  if (!document.getElementById('animationStateGraphStyle')) {
    const style = document.createElement('link'); style.id = 'animationStateGraphStyle'; style.rel = 'stylesheet'; style.href = '/web/animation-state-graph.css';
    (document.head || document.body).append(style);
  }
  container.innerHTML = `<section class="animation-state-graph" aria-labelledby="${idPrefix}Toggle"><button id="${idPrefix}Toggle" type="button" class="doc-btn doc-btn-ghost" aria-expanded="false" aria-controls="${idPrefix}Body"></button>
    <div id="${idPrefix}Body" hidden><p id="${idPrefix}Note" class="script-create-note"></p><p id="${idPrefix}Status" class="script-create-note" role="status" aria-live="polite"></p>
      <div id="${idPrefix}Canvas" class="animation-state-graph-canvas" tabindex="0"></div>
      <div id="${idPrefix}Lists" class="animation-state-graph-lists"><section><h4 id="${idPrefix}StatesTitle"></h4><ol id="${idPrefix}States"></ol></section><section><h4 id="${idPrefix}TransitionsTitle"></h4><ol id="${idPrefix}Transitions"></ol><p id="${idPrefix}Empty"></p></section></div>
    </div></section>`;
  const el = suffix => container.querySelector('#' + idPrefix + suffix);
  let disposed = false, expanded = false, epoch = 0, owner = null, graph = null, layout = null, error = '', selected = null;
  let nodeViews = [], edgeViews = [], routeViews = [];
  const text = (key, ...args) => translate(key, ...args);
  const context = () => getContext();
  const active = value => value.active === true && value.available !== false && value.disabled !== true;
  const signature = () => JSON.stringify(getTable());
  const current = ticket => !disposed && expanded && ticket === owner && ticket.epoch === epoch && active(context())
    && context().generation === ticket.generation && signature() === ticket.signature;
  function node(tag, suffix, className) {
    const element = document.createElement(tag); if (suffix) element.id = idPrefix + suffix; if (className) element.className = className; return element;
  }
  function svg(tag, attrs = {}) {
    const element = document.createElementNS(ns, tag); for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value)); return element;
  }
  function clear() {
    epoch++; owner = null; graph = null; layout = null; selected = null; error = ''; nodeViews = []; edgeViews = []; routeViews = [];
    el('Canvas').replaceChildren(); el('States').replaceChildren(); el('Transitions').replaceChildren();
  }
  const triggerText = edge => {
    if (edge.trigger.kind !== 'event') return text('动画自然完成');
    const label = text('事件：{0}', edge.trigger.name), condition = edge.trigger.condition;
    if (!condition) return label;
    const type = text(condition.type === 'number' ? '数字（number）' : condition.type === 'boolean' ? '布尔值（boolean）' : '字符串（string）');
    return text('{0} · 条件：{1} {2} {3}', label, type, ({ eq: '==', ne: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=' })[condition.operator], JSON.stringify(condition.value));
  };
  function select(value, ticket) { if (!current(ticket)) return false; selected = value; updateText(); return true; }
  function locate(kind, index, ticket) {
    if (!current(ticket)) return false;
    return onLocate({ kind, index }, { isCurrent: () => current(ticket) }) === true;
  }
  function button(parent, suffix, action) {
    const element = node('button', suffix, 'doc-btn doc-btn-ghost'); element.type = 'button'; element.addEventListener('click', action); parent.append(element); return element;
  }
  function svgAction(element, action) {
    element.setAttribute('role', 'button'); element.setAttribute('tabindex', '0'); element.addEventListener('click', action);
    element.addEventListener('keydown', event => { if (!event.isComposing && !event.repeat && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); action(); } });
  }
  function render() {
    const ticket = owner, image = svg('svg', { viewBox: `0 0 ${layout.width} ${layout.height}`, width: layout.width, height: layout.height });
    const defs = svg('defs'), markerId = idPrefix + 'Arrow' + epoch;
    const marker = svg('marker', { id: markerId, markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto', markerUnits: 'strokeWidth' });
    marker.append(svg('path', { d: 'M 0 0 L 8 4 L 0 8 Z', fill: '#a7c6dd' })); defs.append(marker); image.append(defs);
    for (const [index, route] of layout.routes.entries()) {
      const group = svg('g', { id: idPrefix + 'Route' + (index + 1), class: 'animation-state-graph-route' });
      const completed = route.transitionIndices.every(index => graph.edges[index].trigger.kind === 'completed');
      const path = svg('path', { d: route.path, fill: 'none', 'marker-end': `url(#${markerId})`, ...(completed ? { 'stroke-dasharray': '8 5' } : {}) });
      const hit = svg('path', { d: route.path, fill: 'none', class: 'animation-state-graph-hit' }); const title = svg('title'); group.append(title, path, hit);
      svgAction(group, () => select({ kind: 'route', indexes: route.transitionIndices }, ticket)); image.append(group); routeViews.push({ group, title, route });
    }
    for (const position of layout.nodes) {
      const value = graph.nodes[position.index], group = svg('g', { id: idPrefix + 'Node' + (position.index + 1), class: 'animation-state-graph-node', transform: `translate(${position.x} ${position.y})` });
      group.append(svg('rect', { width: position.width, height: position.height, rx: 10 }));
      if (value.initial) group.append(svg('rect', { x: 5, y: 5, width: position.width - 10, height: position.height - 10, rx: 7, class: 'animation-state-graph-initial' }));
      const key = svg('text', { x: position.width / 2, y: value.key.length > 18 ? 26 : 34, 'text-anchor': 'middle', class: 'animation-state-graph-key' });
      for (const [index, chunk] of (value.key.length > 18 ? [value.key.slice(0, 18), value.key.slice(18)] : [value.key]).entries()) {
        const line = svg('tspan', { x: position.width / 2, dy: index ? 17 : 0 }); line.textContent = chunk; key.append(line);
      }
      const initial = svg('text', { x: position.width / 2, y: 61, 'text-anchor': 'middle', class: 'animation-state-graph-initial-label' }); const title = svg('title');
      group.append(key, initial, title); svgAction(group, () => select({ kind: 'state', index: value.index }, ticket)); image.append(group);
      const item = node('li'), choose = button(item, 'State' + (value.index + 1) + 'Select', () => select({ kind: 'state', index: value.index }, ticket));
      const locateButton = button(item, 'State' + (value.index + 1) + 'Locate', () => locate('state', value.index, ticket)); el('States').append(item);
      nodeViews.push({ value, group, initial, title, item, choose, locateButton });
    }
    for (const edge of graph.edges) {
      const item = node('li'), choose = button(item, 'Transition' + (edge.index + 1) + 'Select', () => select({ kind: 'transition', index: edge.index }, ticket));
      const trigger = node('p'); item.append(trigger); const locateButton = button(item, 'Transition' + (edge.index + 1) + 'Locate', () => locate('transition', edge.index, ticket));
      el('Transitions').append(item); edgeViews.push({ edge, item, choose, trigger, locateButton });
    }
    el('Canvas').append(image);
  }
  function edgeSelected(index) { return selected?.kind === 'transition' ? selected.index === index : selected?.kind === 'route' && selected.indexes.includes(index); }
  function updateText() {
    const value = context(), available = active(value);
    el('Toggle').textContent = text(expanded ? '收起状态图' : '查看状态图'); el('Toggle').disabled = !available;
    el('Toggle').setAttribute('aria-expanded', String(expanded)); el('Body').hidden = !expanded;
    el('Note').textContent = text('当前表单的静态转换图，不表示实际运行或可达性。箭头表示方向，虚线表示完成转换；完整触发条件见列表。');
    el('Canvas').setAttribute('aria-label', text('动画状态转换图；可滚动，或使用下方列表选择与定位字段。'));
    el('StatesTitle').textContent = text('动画状态'); el('TransitionsTitle').textContent = text('动画状态转换');
    el('Status').textContent = text(error); el('Canvas').hidden = !graph; el('Lists').hidden = !graph;
    el('Empty').hidden = Boolean(graph?.edges.length); el('Empty').textContent = text('没有状态转换。');
    for (const view of nodeViews) {
      const label = view.value.initial ? text('初始状态：{0}', view.value.key) : text('状态：{0}', view.value.key), chosen = selected?.kind === 'state' && selected.index === view.value.index;
      view.initial.textContent = view.value.initial ? text('初始状态') : ''; view.title.textContent = label; view.group.setAttribute('aria-label', label);
      view.group.setAttribute('aria-pressed', String(chosen)); view.group.dataset.selected = String(chosen); view.item.dataset.selected = String(chosen);
      view.choose.textContent = label; view.choose.setAttribute('aria-pressed', String(chosen)); view.choose.disabled = !available;
      view.locateButton.textContent = text('定位状态字段'); view.locateButton.disabled = !available;
    }
    for (const view of edgeViews) {
      const chosen = edgeSelected(view.edge.index), from = graph.nodes[view.edge.fromIndex].key, to = graph.nodes[view.edge.toIndex].key;
      view.choose.textContent = text('转换 {0}：{1} → {2}', view.edge.index + 1, from, to); view.choose.setAttribute('aria-pressed', String(Boolean(chosen))); view.choose.disabled = !available;
      view.trigger.textContent = triggerText(view.edge); view.item.dataset.selected = String(Boolean(chosen)); view.locateButton.textContent = text('定位转换字段'); view.locateButton.disabled = !available;
    }
    for (const view of routeViews) {
      const label = text('{0} → {1}：{2}', graph.nodes[view.route.fromIndex].key, graph.nodes[view.route.toIndex].key, view.route.transitionIndices.map(index => triggerText(graph.edges[index])).join(' / '));
      const chosen = view.route.transitionIndices.some(edgeSelected) || selected?.kind === 'state' && [view.route.fromIndex, view.route.toIndex].includes(selected.index);
      view.title.textContent = label; view.group.setAttribute('aria-label', label); view.group.setAttribute('aria-pressed', String(Boolean(chosen))); view.group.dataset.selected = String(Boolean(chosen));
    }
  }
  function refresh() {
    if (disposed) return;
    const value = context();
    if (value.active !== true) { expanded = false; clear(); }
    else if (!expanded || !active(value)) { clear(); if (expanded) error = value.available === false ? '当前核心无法提供状态图预览。' : '表单当前不可操作，状态图已清除。'; }
    else {
      let nextSignature;
      try { nextSignature = signature(); } catch { nextSignature = null; }
      if (!owner || owner.generation !== value.generation || owner.signature !== nextSignature) {
        clear(); owner = { generation: value.generation, signature: nextSignature, epoch };
        try { graph = createAnimationStateGraph(getTable()); layout = layoutAnimationStateGraph(graph); render(); }
        catch (cause) { graph = null; layout = null; error = cause?.errorCode === 'studio_core_unavailable' ? '当前核心无法提供状态图预览。' : '状态表尚未有效，无法绘制状态图。请修正缺失状态、重复转换或未完成字段。'; }
      }
    }
    updateText();
  }
  el('Toggle').addEventListener('click', () => { if (disposed || !active(context())) return; expanded = !expanded; clear(); refresh(); });
  // Parent controllers finish creating their session guards after this local
  // form is mounted. Do not read parent context during construction.
  el('Toggle').textContent = text('查看状态图');
  return Object.freeze({ refresh, dispose() { if (disposed) return; disposed = true; clear(); container.replaceChildren(); } });
}

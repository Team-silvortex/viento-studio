import { t } from '../i18n/index.js';

// A renderer of a frozen sample diagram DTO. It never reads a scene, runs a
// solver, derives a path, follows a source or changes author/runtime state.
export function setupProjectPhysicsDiagram({ container } = {}) {
  if (!container) return Object.freeze({ setModel() {}, clear() {}, dispose() {} });
  const document = container.ownerDocument, namespace = 'http://www.w3.org/2000/svg';
  const point = value => [160 + 112 * value[0], 160 + 112 * value[1]];
  const vector = value => `[${value.join(', ')}]`;
  const zero = value => value.every(number => number === 0);
  let model = null, signature = '', disposed = false, parts = null;
  const html = (tag, className = '') => { const item = document.createElement(tag); item.className = className; return item; };
  function svg(tag, attributes = {}) {
    const item = document.createElementNS(namespace, tag);
    for (const [key, value] of Object.entries(attributes)) item.setAttribute(key, String(value));
    return item;
  }
  function title(item) { const output = svg('title'); item.append(output); return output; }
  function clear() { model = null; signature = ''; parts = null; container.replaceChildren(); container.hidden = true; }
  function build(value) {
    const figure = html('figure', 'project-physics-diagram'), heading = html('figcaption'), note = html('p', 'build-hint');
    const normalNote = html('p', 'build-hint'), zeroNote = html('p', 'build-hint'), degraded = html('p', 'build-hint');
    const legend = html('ul', 'project-physics-diagram-legend');
    const legendItems = ['before', 'requested', 'actual', 'contact', 'normal'].map(role => {
      const item = html('li'); item.dataset.legend = role; legend.append(item); return item;
    });
    const canvas = svg('svg', { class: 'project-physics-diagram-svg', viewBox: '0 0 320 320', preserveAspectRatio: 'xMidYMid meet', role: 'img', focusable: 'false' });
    canvas.dataset.assemblyId = value.assemblyId; canvas.dataset.sequence = String(value.sample.sequence); canvas.dataset.sceneId = value.sample.sceneId;
    canvas.dataset.instanceId = value.sample.instanceId; canvas.dataset.bodyId = value.sample.bodyId;
    const canvasTitle = title(canvas), description = svg('desc'); canvas.append(description);
    const [bx, by] = point(value.points.before), [rx, ry] = point(value.points.requested), [ax, ay] = point(value.points.actual);
    const request = svg('line', { 'data-role': 'requested', x1: bx, y1: by, x2: rx, y2: ry, 'data-zero': zero(value.sample.requestedMotion) });
    const actual = svg('line', { 'data-role': 'actual', x1: bx, y1: by, x2: ax, y2: ay, 'data-zero': zero(value.sample.displacement) });
    const requestTitle = title(request), actualTitle = title(actual);
    const requestEnd = svg('rect', { 'data-role': 'requested-end', x: rx - 6, y: ry - 6, width: 12, height: 12 });
    const actualEnd = svg('circle', { 'data-role': 'actual-end', cx: ax, cy: ay, r: 4 });
    const requestEndTitle = title(requestEnd), actualEndTitle = title(actualEnd);
    canvas.append(request, actual, requestEnd, actualEnd);
    const contactParts = value.points.contacts.map(contact => {
      const [x, y] = point(contact.position), nx = x + 20 * contact.normal[0], ny = y + 20 * contact.normal[1];
      const index = contact.index + 1;
      const line = svg('line', { 'data-role': 'normal', 'data-contact-index': index, x1: x, y1: y, x2: nx, y2: ny });
      // Arrowheads belong only to normals: motion uses measured endpoints and
      // has no fixed arrowhead that could exaggerate a tiny displacement.
      const dx = contact.normal[0], dy = contact.normal[1];
      const head = svg('polyline', { 'data-role': 'normal-head', 'data-contact-index': index,
        points: `${nx - 5 * dx + 3 * dy},${ny - 5 * dy - 3 * dx} ${nx},${ny} ${nx - 5 * dx - 3 * dy},${ny - 5 * dy + 3 * dx}` });
      const marker = svg('circle', { 'data-role': 'contact', 'data-contact-index': index, cx: x, cy: y, r: 4 });
      const label = svg('text', { 'data-role': 'contact-number', 'data-contact-index': index, x: x + 7, y: y - 7 }); label.textContent = String(index);
      const lineTitle = title(line), markerTitle = title(marker); canvas.append(line, head, marker, label);
      return { lineTitle, markerTitle };
    });
    const before = svg('g', { 'data-role': 'before', 'data-x': bx, 'data-y': by });
    before.append(svg('line', { x1: bx - 4, y1: by, x2: bx + 4, y2: by }), svg('line', { x1: bx, y1: by - 4, x2: bx, y2: by + 4 }));
    const beforeTitle = title(before); canvas.append(before);
    figure.append(heading, note, canvas, legend, normalNote, zeroNote, degraded); container.replaceChildren(figure);
    parts = { heading, note, canvas, canvasTitle, description, normalNote, zeroNote, degraded, legendItems,
      requestTitle, actualTitle, requestEndTitle, actualEndTitle, contactParts, beforeTitle };
  }
  function translate() {
    if (!model || !parts) return;
    const value = model.sample, heading = t('位移与碰撞示意');
    parts.heading.textContent = heading;
    parts.note.textContent = t('仅示移动前位置到请求／实际终点的连线，不代表真实路径、墙体或持续接触。X 向右，Y 向下。');
    parts.normalNote.textContent = t('法线箭头仅示方向，长度固定为 20 绘图单位，不表示场景距离。');
    parts.zeroNote.textContent = t('请求与实际位移均为零；重合标记表示本步端点。');
    parts.zeroNote.hidden = !zero(value.requestedMotion) || !zero(value.displacement);
    parts.degraded.textContent = t('极端数值范围使部分图形细节无法显示，请以完整数值为准。'); parts.degraded.hidden = !model.projection.degraded;
    const labels = [t('移动前位置（十字）'), t('请求终点（方框／虚线）'), t('实际终点（圆环／实线）'), t('接触位置（编号）'), t('法线方向（箭头）')];
    parts.legendItems.forEach((item, index) => { item.textContent = labels[index]; });
    const identity = t('样本 {0} · 访问 {1} · 第 {2} 步', value.sequence, value.visitIndex, value.stepIndex);
    parts.canvas.setAttribute('aria-label', `${heading} · ${identity}`); parts.canvasTitle.textContent = `${heading} · ${identity}`;
    parts.description.textContent = `${parts.note.textContent} ${labels.join('；')}。 ${parts.normalNote.textContent}`;
    const before = `${t('移动前位置')} ${vector(value.positionBefore)}`;
    const request = `${before} · ${t('请求位移')} ${vector(value.requestedMotion)}`;
    const actual = `${before} · ${t('移动后位置')} ${vector(value.positionAfter)} · ${t('实际位移')} ${vector(value.displacement)}`;
    parts.beforeTitle.textContent = before; parts.requestTitle.textContent = request; parts.requestEndTitle.textContent = request;
    parts.actualTitle.textContent = actual; parts.actualEndTitle.textContent = actual;
    value.contacts.forEach((contact, index) => {
      const identity = contact.collider ? t('碰撞体 {0} · 实例 {1} · 对象 {2}', contact.collider.bodyId, contact.collider.instanceId, contact.collider.objectId)
        : t('未映射碰撞体：本次扫描未关联到冻结的物理声明。');
      const details = `${t('碰撞扫描 {0}', index + 1)} · ${identity} · ${t('接触位置（场景坐标）')} ${vector(contact.position)} · ${t('法线')} ${vector(contact.normal)} · ${t('扫描已走位移')} ${vector(contact.travel)} · ${t('扫描剩余位移')} ${vector(contact.remainder)}`;
      parts.contactParts[index].lineTitle.textContent = details; parts.contactParts[index].markerTitle.textContent = details;
    });
  }
  return Object.freeze({
    setModel(value) {
      if (disposed) return;
      if (!value) { clear(); return; }
      const next = JSON.stringify(value);
      if (next !== signature) { model = value; signature = next; build(value); }
      translate(); container.hidden = false;
    },
    clear,
    dispose() { if (disposed) return; clear(); disposed = true; },
  });
}

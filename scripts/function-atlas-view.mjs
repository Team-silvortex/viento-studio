/** Render the repository's offline, evidence-led function atlas. No runtime I/O. */
export function renderAtlasHtml(data) {
  const encoded = JSON.stringify(data)
    .replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  return String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Viento 功能图谱 · 架构 × 功能 × 实现 × 成熟度</title>
<style>
:root{color-scheme:light;--bg:#f3f5f8;--surface:#fff;--surface-alt:#edf2f7;--ink:#1c2939;--muted:#536477;--line:#ccd6e1;--accent:#116558;--accent-bg:#e1f4ed;--focus:#215ed1;--warn:#80591c;--shadow:0 8px 28px #17263a08}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){color-scheme:dark;--bg:#0c1320;--surface:#131e2d;--surface-alt:#1b2a3d;--ink:#e5edf6;--muted:#a9b9cd;--line:#34465f;--accent:#82d8bc;--accent-bg:#193d37;--focus:#9ebfff;--warn:#e6bd75;--shadow:none}}
:root[data-theme=dark]{color-scheme:dark;--bg:#0c1320;--surface:#131e2d;--surface-alt:#1b2a3d;--ink:#e5edf6;--muted:#a9b9cd;--line:#34465f;--accent:#82d8bc;--accent-bg:#193d37;--focus:#9ebfff;--warn:#e6bd75;--shadow:none}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Noto Sans CJK SC","Microsoft YaHei",sans-serif}a{color:var(--accent);text-underline-offset:3px;overflow-wrap:anywhere}button,input,select{font:inherit;color:inherit}button,input,select{border:1px solid var(--line);border-radius:7px;background:var(--surface)}button{cursor:pointer}button:hover{border-color:var(--accent)}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid var(--focus);outline-offset:3px}button,input,select{min-height:40px}input,select{width:100%;padding:7px 9px;min-width:0}button{padding:7px 12px}.skip{position:absolute;top:-100px;left:16px;background:var(--surface);padding:12px;z-index:9}.skip:focus{top:8px}.page{max-width:1580px;margin:auto;padding:28px 24px 40px}h1{font-size:clamp(23px,3vw,32px);line-height:1.3;margin:0 0 8px}h2{font-size:19px;margin:0 0 12px}h3{font-size:16px;margin:18px 0 8px}p{margin:7px 0 12px}.muted{color:var(--muted)}.small{font-size:13px}.top{display:flex;justify-content:space-between;gap:22px;align-items:flex-start}.top-main{min-width:0}.theme{flex:0 0 120px}.meta{overflow-wrap:anywhere}.notice{border-left:4px solid var(--accent);padding:10px 14px;margin:18px 0;background:var(--surface)}.notice p:last-child{margin-bottom:0}.filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:16px;background:var(--surface);border:1px solid var(--line);border-radius:12px}.field{display:block;min-width:0}.field>span{display:block;margin-bottom:4px;font-size:13px;color:var(--muted)}.search{grid-column:span 2}.filter-actions{display:flex;align-items:end;gap:8px}.filter-actions button{width:100%}.workflow-note{margin:12px 0 0;padding:12px 15px;border:1px solid var(--line);border-radius:8px;background:var(--surface);overflow-wrap:anywhere}.workflow-note[hidden]{display:none}.toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:16px 0 10px}.toolbar p{margin:0}.workspace{display:grid;grid-template-columns:minmax(0,1fr) 355px;gap:18px;align-items:start}.results{min-width:0}.list-head,.binding-row{display:grid;grid-template-columns:minmax(140px,1.6fr) minmax(85px,.85fr) minmax(95px,1fr) minmax(208px,1.6fr);gap:10px;align-items:start}.list-head{padding:10px 12px;color:var(--muted);font-size:12px}.binding-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}.binding-row{padding:12px;text-align:left;width:100%;height:auto;line-height:1.45;box-shadow:var(--shadow)}.binding-row[aria-pressed=true]{border-color:var(--accent);background:var(--accent-bg);box-shadow:inset 3px 0 0 var(--accent)}.binding-row span{min-width:0;overflow-wrap:anywhere}.feature-name{display:block;font-weight:650}.row-sub{display:block;font-size:12px;color:var(--muted);margin-top:4px}.row-part{font-size:13px}.mobile-label{display:none}.scores{display:grid;grid-template-columns:repeat(var(--score-count,4),minmax(0,1fr));gap:5px}.score{text-align:center;display:block}.score-value{display:block;font-variant-numeric:tabular-nums;font-weight:700;font-size:18px}.score-value.unknown{color:var(--muted);font-weight:400}.score-label{display:none}.score-name{display:block;text-align:center;overflow-wrap:anywhere}.empty{padding:30px 20px;background:var(--surface);border:1px dashed var(--line);border-radius:10px}.detail{position:sticky;top:16px;max-height:calc(100vh - 32px);overflow:auto;border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:18px;scrollbar-gutter:stable}.detail h2{overflow-wrap:anywhere}.detail ul{padding-left:20px;margin:8px 0 12px}.detail li{margin:6px 0;overflow-wrap:anywhere}.detail dl{margin:12px 0}.detail dt{font-size:12px;color:var(--muted);margin-top:10px}.detail dd{margin:2px 0 0;overflow-wrap:anywhere}.tag{display:inline-block;border-radius:4px;padding:2px 7px;font-size:12px;background:var(--surface-alt);color:var(--muted);margin:0 5px 4px 0}.detail-score{border-top:1px solid var(--line);padding:12px 0}.detail-score:first-child{border-top:0}.detail-score p{margin-bottom:0}.detail-score strong{display:block}.file-note{display:block;font-size:12px;color:var(--muted)}.link-button{display:block;padding:4px 0;min-height:32px;border:0;background:none;text-align:left;color:var(--accent);text-decoration:underline;text-underline-offset:3px;font-size:14px}.dependency-kind{font-size:12px;color:var(--muted);display:block}.section{margin-top:20px;padding:16px 18px;background:var(--surface);border:1px solid var(--line);border-radius:10px}summary{cursor:pointer;font-weight:600;min-height:28px}details>div{margin-top:12px}.rubrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.rubric h3{margin-top:0}.rubric ol{padding-left:25px;margin:0}.rubric li{margin:5px 0}.legacy-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.legacy-item{padding:10px;background:var(--surface-alt);border-radius:6px}.legacy-item h3{margin:0}.legacy-item p{font-size:13px;color:var(--muted)}footer{margin-top:24px;color:var(--muted);font-size:12px}.hidden{display:none!important}[hidden]{display:none!important}.no-script{padding:20px;border:2px solid var(--warn)}
@media(max-width:1200px){.workspace{grid-template-columns:1fr}.detail{position:static;max-height:none}.list-head,.binding-row{grid-template-columns:minmax(140px,1.4fr) minmax(90px,1fr) minmax(110px,1fr) minmax(230px,1.6fr)}.detail{scroll-margin-top:16px}.detail:not([data-selected]){display:none}}
@media(max-width:760px){.page{padding:18px 14px 28px}.top{gap:12px}.theme{flex-basis:105px}.filters{grid-template-columns:repeat(2,minmax(0,1fr));padding:12px;gap:10px}.list-head{display:none}.binding-row{grid-template-columns:1fr 1fr;gap:8px 12px}.row-feature{grid-column:1/-1}.binding-row>.scores{grid-column:1/-1;padding-top:8px;border-top:1px solid var(--line)}.mobile-label,.score-label{display:block;font-size:11px;color:var(--muted);font-weight:400;margin-bottom:3px}.score-value{font-size:17px}.row-sub{margin-top:3px}.rubrics,.legacy-grid{grid-template-columns:1fr}.toolbar{align-items:flex-start}.toolbar p{font-size:13px}.detail{padding:14px}}
@media(max-width:380px){.top{display:block}.theme{max-width:150px;margin-top:12px}.filters{grid-template-columns:1fr}.search{grid-column:auto}.scores{gap:2px}.score-label{font-size:10px}.binding-row{padding:10px}.page{padding-left:10px;padding-right:10px}}
.workflow-header{display:flex;gap:12px;align-items:start;justify-content:space-between}.workflow-header h2{margin:0}.workflow-header button{flex:0 0 auto}.workflow-stages,.workflow-gaps{list-style:none;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.workflow-step,.workflow-gap{min-width:0;padding:14px;border:1px solid var(--line);border-radius:8px;background:var(--surface-alt);overflow-wrap:anywhere}.workflow-gap{border-inline-start:4px solid var(--warn)}.workflow-step h3,.workflow-gap h3{margin:0 0 8px;line-height:1.5}.workflow-step details,.workflow-gap details{margin-top:10px}.workflow-step details>ul,.workflow-gap details>ul{margin:8px 0 0;padding:0;list-style:none;display:grid;gap:8px}.workflow-binding{display:block;padding:10px;border:1px solid var(--line);border-radius:7px;background:var(--surface);text-decoration:none;min-width:0}.workflow-binding .scores{margin-top:8px}.workflow-binding .score-label{display:block;font-size:11px;color:var(--muted)}.workflow-binding .score-value{font-size:16px}.workflow-binding[aria-current=true]{border-color:var(--accent);background:var(--accent-bg)}.workflow-next{font-size:13px;color:var(--muted);margin-bottom:0}.workflow-step-number{font-size:12px;color:var(--muted);display:block;margin-bottom:3px}.workflow-gap-status{color:var(--muted);font-size:13px}.priority-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:14px}.priority-card{padding:12px;border:1px solid var(--line);border-radius:8px;min-width:0;overflow-wrap:anywhere}.priority-card h3{margin-top:0}.priority-card p{font-size:13px}.priority-links{display:flex;flex-wrap:wrap;gap:8px 14px}.route-note{border-inline-start:4px solid var(--warn);padding:10px 14px;background:var(--surface);overflow-wrap:anywhere}
@media(max-width:760px){.workflow-stages,.workflow-gaps,.priority-grid{grid-template-columns:minmax(0,1fr)}.workflow-header{flex-wrap:wrap}.workflow-note{padding:12px}.workflow-step,.workflow-gap{padding:12px}.workflow-binding{padding:8px}}
</style>
</head>
<body>
<a class="skip" href="#results">跳到功能绑定</a>
<main class="page">
<header class="top"><div class="top-main"><h1>Viento 功能图谱</h1><p class="muted">架构 × 功能 × 实现 × 成熟度维度 · 稀疏坐标记录</p><p id="meta" class="small muted meta"></p></div><label class="field theme"><span>显示主题</span><select id="theme"><option value="auto">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label></header>
<div class="notice"><p id="scope"></p><p class="small muted">只记录明确关联的坐标，不生成全部笛卡尔积。空白／— 表示未评分，不是 0 分；0 分是明确记录的阶段。各维度独立阅读，不计算平均分或覆盖率。报告链接是保留的历史证据，本页更新不代表本轮重新测试。</p></div>
<noscript><p class="no-script">交互筛选需要 JavaScript。此页面数据已内嵌，不访问网络；也可阅读同目录下的 Markdown 与 JSON 版本。</p></noscript>
<form id="filters" class="filters" role="search" aria-label="筛选功能图谱">
<label class="field search"><span>搜索功能、实现、路径或证据</span><input id="search" type="search" placeholder="例如：场景、Rust、迁移、Godot" autocomplete="off"></label>
<label class="field"><span>架构层</span><select id="architecture"></select></label>
<label class="field"><span>功能分组</span><select id="group"></select></label>
<label class="field"><span>实现语言</span><select id="language"></select></label>
<label class="field"><span>实现单元</span><select id="implementation"></select></label>
<label class="field"><span>交付状态</span><select id="delivery"></select></label>
<label class="field"><span>功能</span><select id="feature"></select></label>
<label class="field search"><span>按工作流查看</span><select id="workflow"></select></label>
<div class="filter-actions"><button id="reset" type="button">清除筛选</button></div>
</form>
<p id="route-note" class="route-note" role="status" hidden></p>
<div id="workflow-note" class="workflow-note" hidden></div>
<details class="section" id="priorities-panel"><summary>当前优先缺口与验收要求</summary><p class="small muted">来自同一份功能目录的人工审查记录；排序不是完成度，也不会替代各功能的评分与证据。</p><div id="priorities" class="priority-grid"></div></details>
<div class="toolbar"><p id="count" role="status" aria-live="polite" aria-atomic="true"></p><p class="small muted">选择一行查看评分理由、证据和依赖</p></div>
<div class="workspace"><section class="results" id="results" aria-label="功能绑定" tabindex="-1"><div id="list-head" class="list-head" aria-hidden="true"></div><ul class="binding-list" id="list"></ul><div id="empty" class="empty" hidden><h2>没有匹配的绑定</h2><p class="muted">可以缩短关键词，或清除架构、交付状态与工作流筛选。没有搜索结果并不代表功能不存在。</p><button id="empty-reset" type="button">清除全部筛选</button></div></section><aside id="detail" class="detail" aria-label="绑定详情"><h2>从左侧选择一个绑定</h2><p class="muted">同一功能可以分别由多个架构层和实现单元承担。这里显示每个绑定的具体成熟度、边界与证据。</p></aside></div>
<details class="section"><summary>评分含义与阅读方法</summary><div><p class="small muted">分数对应当前绑定及其明确范围。某个后端、平台或原型的实测，不能替代其他实现的验证；设计文件也不能当作已实现证据。</p><div id="rubrics" class="rubrics"></div></div></details>
<details class="section"><summary id="legacy-summary">旧功能链条映射</summary><div><p class="small muted">旧链条保留身份与历史上下文，映射到当前功能；映射关系不表示旧报告已验证新增实现。</p><div id="legacy" class="legacy-grid"></div></div></details>
<footer>完全离线查看 · 数据随此 HTML 保存 · 文件链接相对于仓库 docs/ 目录 · 本页不加载外部脚本、字体、统计或网络资源</footer>
</main>
<script id="atlas-data" type="application/json">${encoded}</script>
<script>
'use strict';
(function () {
  const data = JSON.parse(document.getElementById('atlas-data').textContent);
  const byId = items => new Map((items || []).map(item => [item.id, item]));
  const architecture = byId(data.axes.architecture), features = byId(data.axes.function), implementations = byId(data.axes.implementation);
  const maturity = data.axes.maturity || [], evidence = byId(data.evidence), workflows = byId(data.workflows);
  const bindings = data.bindings || [], dependencies = data.dependencies || [];
  const cellKey = parts => JSON.stringify(parts);
  const cells = new Map((data.cells || []).map(cell => [cellKey(cell.coordinates), cell]));
  const deliveryNames = {'source-release':'源码交付','working-tree':'当前工作区','prototype':'独立原型','planned':'规划中','deferred':'暂缓','legacy':'历史能力'};
  const kindNames = {source:'源码',test:'测试入口',report:'验证报告',design:'设计说明'};
  const $ = id => document.getElementById(id);
  const controls = ['search','architecture','group','language','implementation','delivery','feature','workflow'];
  let selected = null;
  let readingRoute = false;
  const bindingById = byId(bindings);
  const featureBindings = new Map([...features.keys()].map(id => [id, bindings.filter(binding => binding.function === id)]));
  const flowMembers = flow => [...(flow?.steps || []), ...(flow?.gaps || [])];
  function node(tag, text, className) { const value = document.createElement(tag); if (text !== undefined && text !== null) value.textContent = String(text); if (className) value.className = className; return value; }
  function option(select, value, label) { const item = node('option', label); item.value = value; select.append(item); }
  function options(id, items, all) { const select = $(id); option(select, '', all); items.forEach(item => option(select, item.id, item.label)); }
  function languages(implementation) { return Array.isArray(implementation.language) ? implementation.language : implementation.language ? [implementation.language] : []; }
  function textArray(value) { return Array.isArray(value) ? value : value ? [String(value)] : []; }
  function fileLink(path, label) { const item = node('a', label || path); const parts = String(path || '').split('/'); const valid = parts.length && !parts.some(part => !part || part === '.' || part === '..' || /[:\\\u0000-\u001f]/.test(part)); if (valid) { item.href = '../' + parts.map(encodeURIComponent).join('/'); item.target = '_blank'; item.rel = 'noopener'; } else { item.removeAttribute('href'); item.title = '此路径不能作为仓库内文件链接'; } return item; }
  function scoreFor(binding, dimension) { return cells.get(cellKey([binding.architecture,binding.function,binding.implementation,dimension.id])); }
  function scoreText(cell) { return cell && Number.isInteger(cell.value) ? String(cell.value) : '—'; }
  function labelOf(map, id) { return map.get(id)?.label || id; }
  function addDefinition(list, term, value) { const values = textArray(value); if (!values.length) return; list.append(node('dt',term),node('dd',values.join(' · '))); }
  function appendList(parent, title, items) { if (!items.length) return; parent.append(node('h3',title)); const list=node('ul'); items.forEach(item=>list.append(node('li',item))); parent.append(list); }
  function routeHash(flow, feature, binding) {
    const params = new URLSearchParams();
    if (flow) params.set('workflow', flow);
    if (feature) params.set('feature', feature);
    if (binding) params.set('binding', binding);
    return params.size ? '#' + params.toString() : '';
  }
  function writeRoute(push = false) {
    if (readingRoute) return;
    const hash = routeHash($('workflow').value, $('feature').value, selected);
    if (location.hash === hash) return;
    try { history[push ? 'pushState' : 'replaceState'](null, '', location.pathname + location.search + hash); }
    catch { /* Embedded or restricted readers can still browse locally. */ }
  }
  function clearControls() { controls.forEach(control => { $(control).value = ''; }); selected = null; }
  function clearRouteNote() { $('route-note').hidden = true; $('route-note').textContent = ''; }
  function jumpToFeature(id, workflowId = $('workflow').value) {
    if (!features.has(id)) return;
    const flow = workflows.get(workflowId);
    clearControls(); clearRouteNote();
    if (flow && flowMembers(flow).includes(id)) $('workflow').value = flow.id;
    $('feature').value = id; render(); writeRoute(true);
    const button = $('list').querySelector('button'); if (button) button.focus(); else $('results').focus();
  }
  function focusDetail() {
    if (window.matchMedia('(max-width:1200px)').matches) $('detail').scrollIntoView({ block: 'start', behavior: 'auto' });
    $('detail').setAttribute('tabindex', '-1'); $('detail').focus({ preventScroll: true });
  }
  function selectBinding(binding, workflowId = $('workflow').value, keepFilters = false) {
    const flow = workflows.get(workflowId);
    if (!keepFilters) clearControls();
    clearRouteNote();
    $('workflow').value = flow && flowMembers(flow).includes(binding.function) ? flow.id : '';
    $('feature').value = binding.function; selected = binding.id; render(); writeRoute(true); focusDetail();
  }
  function followLink(link, action) {
    link.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0 || event.defaultPrevented) return;
      event.preventDefault(); action();
    });
  }
  function featureLink(id, workflowId) {
    const link = node('a', labelOf(features, id)); link.dataset.feature = id;
    link.href = routeHash(workflowId, id); followLink(link, () => jumpToFeature(id, workflowId)); return link;
  }
  function scoresFor(binding) {
    const scores = node('span', undefined, 'scores');
    maturity.forEach(dimension => {
      const cell = scoreFor(binding, dimension), score = node('span', undefined, 'score');
      score.dataset.dimension = dimension.id;
      score.setAttribute('aria-label', dimension.label + '：' + (Number.isInteger(cell?.value) ? cell.value + ' 分' : '未评分'));
      score.append(node('span', dimension.label, 'score-label'), node('span', scoreText(cell), 'score-value' + (Number.isInteger(cell?.value) ? '' : ' unknown'))); scores.append(score);
    });
    return scores;
  }
  function workflowCard(id, flow, index, gap = false) {
    const feature = features.get(id) || {}, item = node('li', undefined, gap ? 'workflow-gap' : 'workflow-step');
    item.dataset.feature = id;
    if (!gap) item.append(node('span', '步骤 ' + (index + 1), 'workflow-step-number'));
    const heading = node('h3'); heading.append(featureLink(id, flow.id)); item.append(heading);
    item.append(node('span', deliveryNames[feature.delivery] || feature.delivery, 'tag'));
    if (feature.entry) item.append(node('p', '入口：' + feature.entry, 'small'));
    if (feature.next) item.append(node('p', '下一步：' + feature.next, 'workflow-next'));
    const related = featureBindings.get(id) || [], disclosure = node('details'), summary = node('summary', related.length + ' 条架构／实现关系与原始评分');
    const list = node('ul');
    related.forEach(binding => {
      const implementation = implementations.get(binding.implementation) || {}, row = node('li');
      const link = node('a', undefined, 'workflow-binding'); link.dataset.binding = binding.id;
      link.href = routeHash(flow.id, id, binding.id); link.setAttribute('aria-current', String(selected === binding.id));
      link.append(node('span', labelOf(architecture, binding.architecture) + ' → ' + (implementation.label || binding.implementation), 'small'), scoresFor(binding));
      followLink(link, () => selectBinding(binding, flow.id)); row.append(link); list.append(row);
    });
    disclosure.append(summary, list); if ($('feature').value === id) disclosure.open = true;
    item.append(disclosure); return item;
  }
  function renderWorkflow(flow) {
    const note = $('workflow-note'); note.replaceChildren(); note.hidden = !flow; if (!flow) return;
    const header = node('div', undefined, 'workflow-header'), overview = node('button', '返回工作流总览');
    overview.id = 'workflow-overview-reset'; overview.type = 'button';
    overview.addEventListener('click', () => { clearControls(); clearRouteNote(); $('workflow').value = flow.id; render(); writeRoute(true); $('workflow').focus(); });
    header.append(node('h2', flow.label), overview); note.append(header, node('p', flow.boundary || '', 'small muted'));
    note.append(node('p', '步骤按目录顺序展示；每条实现保留自己的四项评分。工作流顺序不表示全部步骤都已验收。', 'small muted'));
    const stages = node('ol', undefined, 'workflow-stages'); stages.id = 'workflow-stages';
    (flow.steps || []).forEach((id, index) => stages.append(workflowCard(id, flow, index))); note.append(stages, node('h3', '待补接入与缺口'));
    const status = node('p', undefined, 'workflow-gap-status'); status.id = 'workflow-gap-status';
    status.textContent = !Object.hasOwn(flow, 'gaps') ? '缺口尚未梳理。未登记不代表没有缺口。'
      : !flow.gaps.length ? '本次未登记额外缺口（不表示完成）。'
        : '以下是单独登记的接入缺口，不属于上方已梳理步骤；阶段、边界和验收仍按对应功能阅读。';
    const gaps = node('ul', undefined, 'workflow-gaps'); gaps.id = 'workflow-gaps';
    (flow.gaps || []).forEach((id, index) => gaps.append(workflowCard(id, flow, index, true))); note.append(status, gaps);
  }
  function dependencyList(parent, title, edges, useFrom) { if (!edges.length) return; parent.append(node('h3',title)); const list=node('ul'); edges.forEach(edge=>{ const id=useFrom?edge.from:edge.to; const li=node('li'); const button=node('button',labelOf(features,id),'link-button'); button.type='button'; button.addEventListener('click',()=>jumpToFeature(id)); li.append(button,node('span',(edge.relation==='planned'?'规划依赖':'当前依赖')+(edge.reason?' · '+edge.reason:''),'dependency-kind')); list.append(li); }); parent.append(list); }
  function renderDetail(binding) {
    const panel=$('detail'); panel.replaceChildren(); panel.dataset.selected='true';
    const feature=features.get(binding.function)||{}, implementation=implementations.get(binding.implementation)||{};
    const back=node('button','返回所选行','link-button');back.type='button';back.addEventListener('click',()=>{const row=[...$('list').querySelectorAll('button')].find(item=>item.dataset.binding===binding.id);if(row){row.focus();row.scrollIntoView({block:'center'});}});panel.append(back,node('h2',feature.label||binding.function));
    const tags=node('div'); [feature.group,deliveryNames[feature.delivery]||feature.delivery].filter(Boolean).forEach(text=>tags.append(node('span',text,'tag'))); panel.append(tags);
    const defs=node('dl'); addDefinition(defs,'架构层',labelOf(architecture,binding.architecture)); addDefinition(defs,'实现单元',implementation.label||binding.implementation); addDefinition(defs,'实现类型 / 语言',[implementation.kind,...languages(implementation)].filter(Boolean)); addDefinition(defs,'绑定职责',binding.role); addDefinition(defs,'实际入口',feature.entry); addDefinition(defs,'适用平台',feature.platforms); addDefinition(defs,'稳定标识',[binding.function,binding.id]); panel.append(defs);
    panel.append(node('h3','各维度评分')); const scores=node('div'); maturity.forEach(dimension=>{ const cell=scoreFor(binding,dimension), valid=cell&&Number.isInteger(cell.value), block=node('div',undefined,'detail-score'); block.append(node('strong',dimension.label+' · '+(valid?cell.value+' / 5':'未评分'))); if(valid&&dimension.levels?.[cell.value])block.append(node('span',dimension.levels[cell.value],'small muted')); block.append(node('p',cell?.reason||'此坐标未记录评分；不能按 0 分解释。','small')); scores.append(block); }); panel.append(scores);
    appendList(panel,'当前边界',textArray(feature.boundary)); if(feature.next){panel.append(node('h3','下一步'),node('p',feature.next));}
    const refs=(binding.evidence||[]).map(id=>evidence.get(id)).filter(Boolean);
    const knownPaths=new Set(refs.map(ref=>ref.path)); const extraPaths=(implementation.paths||[]).filter(path=>!knownPaths.has(path));
    panel.append(node('h3','文件与证据')); if(!refs.length&&!extraPaths.length)panel.append(node('p','尚未登记实现或验证文件。','muted small'));
    const files=node('ul'); refs.forEach(ref=>{const li=node('li');li.append(fileLink(ref.path,(kindNames[ref.kind]||ref.kind)+' · '+ref.path));if(ref.note)li.append(node('span',ref.note,'file-note'));if(ref.kind==='report')li.append(node('span','历史验证记录；需按报告日期、版本及范围阅读。','file-note'));files.append(li);});extraPaths.forEach(path=>{const li=node('li');li.append(fileLink(path,'实现 · '+path));files.append(li);});panel.append(files);
    dependencyList(panel,'前置依赖',dependencies.filter(edge=>edge.to===binding.function),true);
    dependencyList(panel,'后续使用者',dependencies.filter(edge=>edge.from===binding.function),false);
    const related=(data.workflows||[]).filter(flow=>flowMembers(flow).includes(binding.function));
    if(related.length){panel.append(node('h3','相关工作流与缺口'));related.forEach(flow=>{const button=node('button',flow.label,'link-button');button.type='button';button.addEventListener('click',()=>{clearControls();clearRouteNote();$('workflow').value=flow.id;render();writeRoute(true);$('results').focus();});panel.append(button);});}
  }
  const searches=new Map(bindings.map(binding=>{ const feature=features.get(binding.function)||{}, implementation=implementations.get(binding.implementation)||{}; const refs=(binding.evidence||[]).map(id=>evidence.get(id)).filter(Boolean); return [binding.id,JSON.stringify([binding.id,feature,architecture.get(binding.architecture),implementation,binding.role,refs]).toLocaleLowerCase()];}));
  function matches(binding) {
    const feature=features.get(binding.function)||{},implementation=implementations.get(binding.implementation)||{};
    if($('architecture').value&&binding.architecture!==$('architecture').value)return false;
    if($('group').value&&feature.group!==$('group').value)return false;
    if($('language').value&&!languages(implementation).includes($('language').value))return false;
    if($('implementation').value&&binding.implementation!==$('implementation').value)return false;
    if($('delivery').value&&feature.delivery!==$('delivery').value)return false;
    if($('feature').value&&binding.function!==$('feature').value)return false;
    const flow=workflows.get($('workflow').value);
    if(flow){const scope=$('feature').value ? flowMembers(flow) : flow.steps||[];if(!scope.includes(binding.function))return false;}
    const words=$('search').value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);return words.every(word=>searches.get(binding.id).includes(word));
  }
  function render() {
    const rows=bindings.filter(matches),flow=workflows.get($('workflow').value);
    if(flow)rows.sort((a,b)=>flow.steps.indexOf(a.function)-flow.steps.indexOf(b.function));
    const visibleFunctions=new Set(rows.map(binding=>binding.function));
    $('count').textContent='显示 '+rows.length+' / '+bindings.length+' 个绑定，涉及 '+visibleFunctions.size+' 个功能';
    $('empty').hidden=rows.length!==0;$('list-head').hidden=rows.length===0;
    if(!rows.some(binding=>binding.id===selected))selected=null;
    renderWorkflow(flow);
    const list=$('list');list.replaceChildren();rows.forEach(binding=>{
      const feature=features.get(binding.function)||{},implementation=implementations.get(binding.implementation)||{},li=node('li'),button=node('button',undefined,'binding-row');button.type='button';button.dataset.binding=binding.id;button.setAttribute('aria-pressed',String(binding.id===selected));button.setAttribute('aria-controls','detail');
      const main=node('span',undefined,'row-feature');main.append(node('span',feature.label||binding.function,'feature-name'),node('span',[feature.group,deliveryNames[feature.delivery]||feature.delivery].filter(Boolean).join(' · '),'row-sub'));
      const arch=node('span',undefined,'row-part');arch.append(node('span','架构层','mobile-label'),node('span',labelOf(architecture,binding.architecture)));
      const impl=node('span',undefined,'row-part');impl.append(node('span','实现','mobile-label'),node('span',implementation.label||binding.implementation),node('span',languages(implementation).join(' / '),'row-sub'));
      const scores=node('span',undefined,'scores');maturity.forEach(dimension=>{const cell=scoreFor(binding,dimension),score=node('span',undefined,'score');score.setAttribute('aria-label',dimension.label+'：'+(Number.isInteger(cell?.value)?cell.value+' 分':'未评分'));score.append(node('span',dimension.label,'score-label'),node('span',scoreText(cell),'score-value'+(Number.isInteger(cell?.value)?'':' unknown')));scores.append(score);});button.append(main,arch,impl,scores);
      button.addEventListener('click',()=>selectBinding(binding,$('workflow').value,true));li.append(button);list.append(li);
    });
    if(selected){renderDetail(rows.find(binding=>binding.id===selected));}else{$('detail').removeAttribute('data-selected');$('detail').replaceChildren(node('h2','选择一个绑定查看详情'),node('p','每条绑定独立记录职责、评分、边界和证据。筛选不会改变评分。','muted'));}
  }
  document.documentElement.style.setProperty('--score-count',String(Math.max(1,maturity.length)));
  $('meta').textContent=[data.meta.date,data.meta.version?'版本 '+data.meta.version:'',data.meta.commit?'基线 '+String(data.meta.commit).slice(0,12):''].filter(Boolean).join(' · ');
  $('scope').textContent=data.meta.scope||'当前源码功能与保留验证证据。';
  options('architecture',data.axes.architecture,'全部架构层');options('group',[...new Set(data.axes.function.map(item=>item.group).filter(Boolean))].map(value=>({id:value,label:value})),'全部分组');
  options('language',[...new Set(data.axes.implementation.flatMap(languages))].map(value=>({id:value,label:value})),'全部语言');options('implementation',data.axes.implementation,'全部实现单元');
  options('delivery',[...new Set(data.axes.function.map(item=>item.delivery).filter(Boolean))].map(value=>({id:value,label:deliveryNames[value]||value})),'全部交付状态');options('feature',data.axes.function,'全部功能');options('workflow',data.workflows||[],'全部工作流');
  const head=$('list-head');head.append(node('span','功能 / 交付'),node('span','架构层'),node('span','实现'));const scoreHead=node('span',undefined,'scores');maturity.forEach(dimension=>scoreHead.append(node('span',dimension.label,'score-name')));head.append(scoreHead);
  maturity.forEach(dimension=>{const block=node('section',undefined,'rubric');block.append(node('h3',dimension.label));const list=node('ol');list.start=0;(dimension.levels||[]).forEach(level=>list.append(node('li',level)));block.append(list);$('rubrics').append(block);});
  $('legacy-summary').textContent='旧功能链条映射（'+(data.legacyCoverage||[]).length+' 条）';
  (data.legacyCoverage||[]).forEach(item=>{const block=node('section',undefined,'legacy-item');block.append(node('h3',item.id+' · '+item.label));if(item.note)block.append(node('p',item.note));(item.functions||[]).forEach(id=>{const button=node('button',labelOf(features,id),'link-button');button.type='button';button.addEventListener('click',()=>{jumpToFeature(id);$('results').scrollIntoView({block:'start'});});block.append(button);});$('legacy').append(block);});
  (data.priorities||[]).forEach((priority,index)=>{
    const card=node('section',undefined,'priority-card');card.dataset.priority=String(index);card.append(node('h3',priority.label));
    if(priority.reason)card.append(node('p',priority.reason));if(priority.acceptance)card.append(node('p','验收：'+priority.acceptance,'muted'));
    const links=node('div',undefined,'priority-links');(priority.functions||[]).filter(id=>features.has(id)).forEach(id=>links.append(featureLink(id,'')));card.append(links);$('priorities').append(card);
  });
  $('priorities-panel').hidden=!(data.priorities||[]).length;
  function readRoute(){
    readingRoute=true;
    try{
      const raw=location.hash.slice(1);if(raw==='results'){render();return;}
      const params=new URLSearchParams(raw),known=['workflow','feature','binding'];
      const entries=[...params],flowId=params.get('workflow')||'',featureId=params.get('feature')||'',bindingId=params.get('binding')||'';
      let valid=raw.length<=8192&&entries.every(([key,value])=>known.includes(key)&&value&&params.getAll(key).length===1);
      const binding=bindingById.get(bindingId),feature=featureId||binding?.function||'',flow=workflows.get(flowId);
      valid=valid&&(!flowId||!!flow)&&(!feature||features.has(feature))&&(!bindingId||!!binding)
        &&(!binding||binding.function===feature)&&(!flow||!feature||flowMembers(flow).includes(feature));
      clearControls();clearRouteNote();
      if(valid){$('workflow').value=flowId;$('feature').value=feature;selected=bindingId||null;}
      else{$('route-note').textContent='定位链接无效或不属于所选工作流，已返回全部功能。请从目录重新选择。';$('route-note').hidden=false;}
      render();
    }finally{readingRoute=false;}
  }
  function reset(){clearControls();clearRouteNote();render();writeRoute(true);$('search').focus();}
  function changed(id){
    clearRouteNote();
    if(id==='workflow'){const flow=$('workflow').value;clearControls();$('workflow').value=flow;}
    if(id==='feature'){selected=null;const flow=workflows.get($('workflow').value);if(flow&&$('feature').value&&!flowMembers(flow).includes($('feature').value))$('workflow').value='';}
    render();writeRoute(id==='workflow'||id==='feature');
  }
  $('filters').addEventListener('submit',event=>event.preventDefault());controls.forEach(id=>$(id).addEventListener(id==='search'?'input':'change',()=>changed(id)));$('reset').addEventListener('click',reset);$('empty-reset').addEventListener('click',reset);
  window.addEventListener('hashchange',readRoute);window.addEventListener('popstate',readRoute);
  function setTheme(value){if(value==='auto')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=value;}
  try{const saved=localStorage.getItem('viento-atlas-theme');if(['auto','light','dark'].includes(saved))$('theme').value=saved;}catch{}
  setTheme($('theme').value);$('theme').addEventListener('change',()=>{setTheme($('theme').value);try{localStorage.setItem('viento-atlas-theme',$('theme').value);}catch{}});
  readRoute();
})();
</script>
</body>
</html>`;
}

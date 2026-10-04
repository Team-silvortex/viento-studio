import { sceneActorIdentity } from '../../engine/scene-identity.mjs';
import { buildSceneOutline } from '../../engine/scene-groups.mjs';
import { t } from '../i18n/index.js';

// Native nested lists keep keyboard navigation familiar. Collapsing and filtering
// are view state only; neither operation changes the scene's paint order.
export function createSceneOutline({ root, search, multi = false, onActorSelect = () => {}, onGroupSelect = () => {}, onGroupSource } = {}) {
  let groups = [], actors = [], selected = [], disabled = false, signature = '';
  const collapsed = new Set();
  const node = (tag, text = '', className = '') => { const value = document.createElement(tag); value.textContent = text; value.className = className; return value; };
  const button = (text, callback) => { const value = node('button', text, 'doc-btn doc-btn-ghost'); value.type = 'button'; value.addEventListener('click', callback); return value; };
  const groupMembers = new Map();
  function sync() {
    for (const value of root.querySelectorAll('[data-actor-id]')) {
      const active = selected.includes(value.dataset.actorId); value.disabled = disabled;
      if (value.tagName === 'INPUT') value.checked = active;
      else value.setAttribute('aria-pressed', String(active));
    }
    for (const value of root.querySelectorAll('[data-group-id]')) {
      const ids = groupMembers.get(value.dataset.groupId) || [], count = ids.filter(id => selected.includes(id)).length;
      value.disabled = disabled || !ids.length;
      if (value.tagName === 'INPUT') { value.checked = ids.length > 0 && count === ids.length; value.indeterminate = count > 0 && count < ids.length; }
      else value.setAttribute('aria-pressed', String(ids.length > 0 && count === ids.length));
    }
  }
  function render() {
    root.replaceChildren(); groupMembers.clear();
    const byId = new Map(actors.map(actor => [sceneActorIdentity(actor), actor]));
    const query = search.value.trim(), outline = buildSceneOutline({ groups, actors }, query);
    function append(nodes, parent) {
      for (const item of nodes) {
        const li = node('li'), row = node('div', '', 'scene-layout-object-row');
        if (item.kind === 'actor') {
          const actor = byId.get(item.instanceId); if (!actor) continue;
          const id = sceneActorIdentity(actor), label = actor.instanceId ? `${actor.name} · ${actor.instanceId.slice(0, 8)}` : actor.name;
          const choose = button(label, event => onActorSelect(id, event)); choose.dataset.objectId = actor.objectId; choose.dataset.actorId = id;
          if (actor.instanceId) { choose.dataset.instanceId = actor.instanceId; choose.title = actor.instanceId; }
          if (multi) {
            const check = node('input'); check.type = 'checkbox'; check.dataset.actorId = id; check.dataset.objectId = actor.objectId;
            if (actor.instanceId) check.dataset.instanceId = actor.instanceId;
            check.setAttribute('aria-label', t('选择对象：{0}', label));
            check.addEventListener('change', () => onActorSelect(id, { toggle: true })); row.append(check);
          }
          row.append(choose); li.append(row);
        } else {
          const ids = item.instanceIds; groupMembers.set(item.groupId, ids);
          const expanded = Boolean(query) || !collapsed.has(item.groupId);
          const toggle = button(`${expanded ? '▾' : '▸'} ${item.name} (${ids.length})`, () => {
            if (collapsed.has(item.groupId)) collapsed.delete(item.groupId); else collapsed.add(item.groupId);
            render(); root.querySelector(`[data-group-toggle="${item.groupId}"]`)?.focus();
          });
          toggle.dataset.groupToggle = item.groupId; toggle.setAttribute('aria-expanded', String(expanded));
          toggle.setAttribute('aria-label', t('{0}分组：{1}', t(expanded ? '折叠' : '展开'), item.name)); row.append(toggle);
          li.append(row);
          if (multi || onGroupSource) {
            const actions = node('div', '', 'scene-outline-group-actions');
            if (multi) {
              const check = node('input'); check.type = 'checkbox'; check.dataset.groupId = item.groupId;
              check.setAttribute('aria-label', t('选择分组及子组：{0}', item.name));
              check.addEventListener('change', () => onGroupSelect(ids, { toggle: true }));
              const choose = button(t('选择分组及子组'), event => onGroupSelect(ids, event)); choose.dataset.groupId = item.groupId;
              actions.append(check, choose);
            }
            if (onGroupSource) { const source = button(t('查看分组来源'), () => onGroupSource(item.groupId)); source.dataset.groupSource = item.groupId; actions.append(source); }
            li.append(actions);
          }
          const children = node('ol'); children.hidden = !expanded; append(item.children, children); li.append(children);
        }
        parent.append(li);
      }
    }
    append(outline, root);
    if (!outline.length) root.append(node('li', t('没有匹配的场景对象或分组。'), 'build-hint'));
    sync();
  }
  search.addEventListener('input', render);
  return {
    setModel(value = {}) {
      groups = value.groups || []; actors = value.actors || [];
      const next = JSON.stringify([groups, actors.map(actor => [sceneActorIdentity(actor), actor.objectId, actor.name, actor.groupId])]);
      if (signature !== next) { signature = next; render(); }
    },
    setSelection(ids, options = {}) { selected = ids || []; disabled = Boolean(options.disabled); sync(); },
    refresh: render,
    reset() { groups = []; actors = []; selected = []; signature = ''; collapsed.clear(); search.value = ''; render(); },
  };
}

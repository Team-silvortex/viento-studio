import { userError } from './user-message.mjs';

export const RESOURCE_PACKAGE_FORMAT = 'viento-resource-package';
export const RESOURCE_PACKAGE_VERSION = 1;
export const RESOURCE_PACKAGE_API = '/api/resource-packages';
export const PACKAGE_LIMITS = Object.freeze({ files: 200000, fileBytes: 8 * 1024 ** 3, totalBytes: 64 * 1024 ** 3,
  jsonBytes: 16 * 1024 ** 2, sourceBytes: 64 * 1024 ** 2 });
export const packageError = (message, statusCode = 400) => userError(message, statusCode, 'resource_package_failed');

// Stable identities form the graph. Paths and display names never join objects.
// The queue also handles cyclic reference graphs without recursion or duplicates.
export function selectPackageEntries(entries, ids, { includeDependencies = true, includeChildren = true } = {}) {
  if (!Array.isArray(ids) || !ids.length || ids.length > PACKAGE_LIMITS.files
    || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
    throw packageError('请至少选择一项资源，且不要重复选择');
  }
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  if (ids.some(id => !byId.has(id))) throw packageError('资源清单已变化，请刷新后重新选择', 409);
  const manual = new Set(ids), selected = new Set(ids), queue = [...ids], requirements = new Set();
  for (let i = 0; i < queue.length; i += 1) {
    const item = byId.get(queue[i]);
    if (!item) throw packageError('资源依赖未登记，请修复引用后重试');
    const links = [...(includeChildren ? item.children || [] : []), ...(includeDependencies ? item.dependencies || [] : [])];
    for (const id of links) if (!selected.has(id)) { selected.add(id); queue.push(id); }
  }
  for (const id of selected) {
    for (const target of byId.get(id).dependencies || []) if (!selected.has(target)) {
      if (!byId.has(target)) throw packageError('资源依赖未登记，请修复引用后重试');
      requirements.add(target);
    }
  }
  return { selected: entries.filter(entry => selected.has(entry.id)),
    requirements: entries.filter(entry => requirements.has(entry.id)),
    automaticIds: [...selected].filter(id => !manual.has(id)) };
}

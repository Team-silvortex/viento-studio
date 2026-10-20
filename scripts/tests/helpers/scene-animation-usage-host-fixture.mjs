import { createHash } from 'node:crypto';
import '../../adapters/node-studio-core.mjs';
import { createSceneAnimationSourceHost } from '../../../web/modules/app-scene-animation-source.js';
export const hash = value => createHash('sha256').update(value).digest('hex'), revision = value => 'sha256:' + hash(value);
export const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const animation = () => ({ format: 'viento-scene-animation', schemaVersion: 3, sceneObjectId: id(1), durationSeconds: 2, loop: false,
  tracks: [{ id: id(2), instanceId: id(3), property: 'opacity', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: 0 }, { atSeconds: 2, value: 1 }] }],
  clips: [{ id: id(10), name: '歩く / Walk', startSeconds: 0, endSeconds: 1, loop: true }, { id: id(11), name: '跳跃 / Jump', startSeconds: 1, endSeconds: 2, loop: false }] });
export const original = '\ufeff' + JSON.stringify(animation(), null, 2).replaceAll('\n', '\r\n') + '\r\n';
export const edit = model => ({ durationSeconds: model.durationSeconds, loop: model.loop, tracks: model.tracks, ...(model.clips ? { clips: model.clips } : {}) });
export const parse = content => JSON.parse(content.replace(/^\ufeff/, ''));
export const conflict = { errorCode: 'scene_animation_authoring_conflict' };
export const rejected = error => /^(scene_animation_)/.test(error.errorCode || '');
export function gate() { let enter, release; const entered = new Promise(r => { enter = r; }), waiting = new Promise(r => { release = r; }); return { entered, release, wait: async () => { enter(); await waiting; } }; }
export function fixture({ usageAvailable = true, targetsAvailable = true, noPort = false, noTargets = false } = {}) {
  const state = { document: {}, token: 'usage-test', sourcePath: 'documents/animations/demo.json', content: original, baseline: original,
    version: revision(original), editable: true, creating: false, busy: false, available: true, sourceJSON: true, targetsAvailable, usageAvailable };
  const raw = { format: 'viento-scene-animation-usage', schemaVersion: 1, worldId: 'world:' + hash('world'), revision: revision('world'),
    scene: { objectId: id(1), sourcePath: 'documents/scenes/demo.json', sourceRevision: revision('scene') },
    animation: { objectId: id(4), sourcePath: state.sourcePath, sourceRevision: revision(original), content: original }, behavior: null };
  const targets = { format: 'viento-scene-animation-targets', schemaVersion: 1, worldId: raw.worldId, revision: raw.revision,
    scene: raw.scene, manifest: raw.animation, targets: [{ instanceId: id(3), objectId: id(5), name: 'Traveler', sourcePath: 'documents/characters/traveler.md' }] };
  const h = { state, raw, targets, writes: [], digests: 0, requests: [], targetRequests: [] };
  h.host = createSceneAnimationSourceHost({ getState: () => ({ ...state }),
    digest: async value => { await h.beforeDigest?.(++h.digests); return hash(value); },
    ...(noPort ? {} : { inspectUsage: async input => { h.requests.push(input); await h.beforeUsage?.(); return structuredClone(h.raw); } }),
    ...(noTargets ? {} : { inspectTargets: async input => { h.targetRequests.push(input); await h.beforeTargets?.(); return structuredClone(h.targets); } }),
    writeDraft: content => { h.writes.push(content); state.content = content; } });
  h.blockDigest = offset => { const g = gate(), target = h.digests + offset; h.beforeDigest = count => count === target ? g.wait() : undefined; return g; };
  return h;
}
export function mutate(h, key) {
  const old = h.state[key];
  h.state[key] = typeof old === 'boolean' ? !old : key === 'document' ? {} : String(old) + 'changed';
}

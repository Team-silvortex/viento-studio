import fs from 'node:fs/promises';
import path from 'node:path';
import { projectAnimationClipsAuthor } from './project-animation-clips-author-fixture.mjs';
import { generateEditableGodotAnimationStateScript } from '../../../engine/animation-state-script-source.mjs';

export const preflightBehaviorId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const preflightTable = { initialState: 'idle', states: [{ key: 'idle' }, { key: 'attack' }], transitions: [
  { from: 'idle', to: 'attack', trigger: { kind: 'event', name: 'attack' } },
  { from: 'attack', to: 'idle', trigger: { kind: 'completed' } },
] };
// These files belong only to a disposable fixture, never to installed or author data.
export async function projectAnimationPreflightFixture(t, { documents = 'documents', valid = false } = {}) {
  const f = await projectAnimationClipsAuthor(t, { sprites: false });
  const controller = generateEditableGodotAnimationStateScript(preflightTable).content;
  await f.script('checkpoint', controller);
  const model = await f.read('documents/behaviors/demo.json');
  model.bindings[0].parameters = { clip_idle: f.clipIds[0][0], clip_attack: valid ? f.clipIds[0][1] : f.clipIds[1][1] };
  // An ordinary exported text parameter precedes the strict controller so source
  // navigation must account for an actual surrogate pair, not just ASCII offsets.
  const noteId = '68686868-6868-4686-8686-000000000001', noteBinding = '68686868-6868-4686-8686-000000000002';
  await f.script('preflight-note', 'extends Node\n@export var note: String = ""\n');
  const record = await f.read(`metadata/documents/${f.scriptId}.json`);
  await f.write(`metadata/documents/${noteId}.json`, { ...record, id: noteId, sourcePath: 'documents/scripts/preflight-note.txt' });
  await f.edit(`metadata/documents/${preflightBehaviorId}.json`, record => { record.relations.push({ kind: 'reference', targetId: noteId, slot: 'implementation' }); });
  model.bindings.unshift({ ...structuredClone(model.bindings[0]), bindingId: noteBinding,
    implementation: { ...model.bindings[0].implementation, sourceObjectId: noteId }, parameters: { note: '🌧 雨 / Rain / 雨' } });
  const behaviorText = '\ufeff' + (JSON.stringify(model, null, 2) + '\n').replaceAll('\n', '\r\n');
  await f.write('documents/behaviors/demo.json', behaviorText);
  if (documents !== 'documents') {
    await f.edit('workspace.json', value => { value.version = 2; value.paths.documents = documents; value.paths.templates = 'data-template'; });
    await fs.rename(path.join(f.author, 'templates'), path.join(f.author, 'data-template'));
    await fs.rename(path.join(f.author, 'documents'), path.join(f.author, documents));
    for (const name of await fs.readdir(path.join(f.author, 'metadata/documents'))) await f.edit(`metadata/documents/${name}`, value => { value.sourcePath = value.sourcePath.replace(/^documents\//, documents + '/'); });
  }
  return { ...f, documents, controller, behaviorText, behaviorPath: `${documents}/behaviors/demo.json`, animationPath: `${documents}/animations/scene-0.json`,
    scriptPath: `${documents}/scripts/checkpoint.txt`, goodClip: f.clipIds[0][1], missingClip: f.clipIds[1][1] };
}

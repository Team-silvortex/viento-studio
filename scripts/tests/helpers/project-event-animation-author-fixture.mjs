import { listScriptStarters } from '../../../engine/script-authoring.mjs';
import { projectAnimationClipsAuthor } from './project-animation-clips-author-fixture.mjs';

// The receiver is the unmodified built-in starter. The publisher is a separate
// registered behavior, so receipts must retain their respective author sources.
export async function projectEventAnimationAuthor(t, options) {
  const f = await projectAnimationClipsAuthor(t, options);
  const starter = listScriptStarters().find(item => item.id === 'godot-project-animation-event');
  if (!starter) throw new Error('Missing project animation event starter.');
  const publisherId = '60606060-6060-4060-8060-000000000001';
  const publisherBindingId = '60606060-6060-4060-8060-000000000002';
  await f.edit('documents/behaviors/demo.json', manifest => {
    manifest.bindings[0].parameters = { clip_id: f.clipIds[0][1] };
    manifest.bindings.push({ ...structuredClone(manifest.bindings[0]), bindingId: publisherBindingId,
      implementation: { ...manifest.bindings[0].implementation, sourceObjectId: publisherId }, parameters: {} });
  });
  const record = await f.read(`metadata/documents/${f.scriptId}.json`);
  await f.write(`metadata/documents/${publisherId}.json`, { ...record, id: publisherId, sourcePath: 'documents/scripts/publisher.txt' });
  await f.edit('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json', metadata => {
    metadata.relations.push({ kind: 'reference', targetId: publisherId, slot: 'implementation' });
  });
  await f.script('checkpoint', starter.content);
  await f.script('publisher', 'extends Node\n');
  const configure = parameters => f.edit('documents/behaviors/demo.json', manifest => { manifest.bindings[0].parameters = parameters; });
  return { ...f, starter, configure, receiverBindingId: f.bindingId, publisherBindingId, publisherId };
}

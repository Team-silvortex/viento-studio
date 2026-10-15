import fs from 'node:fs/promises';
import path from 'node:path';
import { projectSceneSwitchingAuthor } from './project-scene-switching-fixture.mjs';
const json = value => JSON.stringify(value, null, 2) + '\n';

// Two independently registered scripts communicate through the project port.
// State, not static script variables, drives the A→B→A sequence.
export async function projectEventsAuthor(t) {
  const f = await projectSceneSwitchingAuthor(t, { mode: 'no-switch' });
  const read = async file => JSON.parse(await fs.readFile(path.join(f.author, file)));
  const write = async (file, value) => fs.writeFile(path.join(f.author, file), json(value));
  const publisherId = '12345678-1234-4234-8234-123456789ad1';
  const manifest = await read('documents/behaviors/demo.json');
  manifest.bindings[1].implementation.sourceObjectId = publisherId;
  await write('documents/behaviors/demo.json', manifest);
  const record = await read(`metadata/documents/${f.scriptId}.json`);
  await write(`metadata/documents/${publisherId}.json`, { ...record, id: publisherId, sourcePath: 'documents/scripts/publisher.txt' });
  const metadata = await read('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json');
  metadata.relations.push({ kind: 'reference', targetId: publisherId, slot: 'implementation' });
  await write('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json', metadata);
  const first = `extends Node
var project
var extra := 0
func _ready() -> void:
	project = get_meta("viento_project")
	project.subscribe_event("checkpoint", _on_checkpoint)
	extra = project.subscribe_event("checkpoint", _unexpected)
	project.subscribe_event("receipt", _on_receipt)
func _on_checkpoint(value) -> bool:
	var previous = project.read_state("handled")
	var count := 0 if previous == null else int(previous)
	project.write_state("handled", count + 1)
	project.write_state("last_event", value)
	if not project.unsubscribe_event(extra):
		return false
	project.publish_event("receipt", true)
	if count == 0:
		project.request_scene("${f.sceneIds[1]}")
	return count == 0 or count == 2
func _unexpected(_value) -> bool:
	push_error("UNSUBSCRIBED_CALLBACK_RAN")
	return false
func _on_receipt(_value) -> bool:
	var previous = project.read_state("receipts")
	var count := 0 if previous == null else int(previous)
	return project.write_state("receipts", count + 1)
`;
  const publisher = `extends Node
func _ready() -> void:
	_publish()
func _publish() -> void:
	get_meta("viento_project").publish_event("checkpoint", "雨の鍵 / 风之钥匙 🔑")
`;
  const second = `extends Node
var project
func _ready() -> void:
	project = get_meta("viento_project")
	project.subscribe_event("checkpoint", _on_checkpoint)
	_publish()
func _publish() -> void:
	project.publish_event("checkpoint", "second")
func _on_checkpoint(value) -> bool:
	if project.read_state("handled") != 1 or project.read_state("receipts") != 1:
		return false
	project.write_state("handled", 2)
	project.write_state("last_event", value)
	project.publish_event("nobody", false)
	return project.request_scene("${f.sceneIds[0]}")
`;
  for (const [file, text] of [['checkpoint', first], ['publisher', publisher], ['second', second]])
    await fs.writeFile(path.join(f.author, `documents/scripts/${file}.txt`), text);
  return { ...f, publisherId, publisherBindingId: manifest.bindings[1].bindingId, receiverBindingId: manifest.bindings[0].bindingId,
    expectedSequence: 6, expectedRevision: 8,
    expectedNames: ['checkpoint', 'receipt', 'checkpoint', 'nobody', 'checkpoint', 'receipt'],
    expectedDeliveries: [['handled', 'skipped'], ['handled'], ['handled'], [], ['handled', 'skipped'], ['handled']],
    expectedEntries: [{ key: 'handled', value: 3 }, { key: 'last_event', value: '雨の鍵 / 风之钥匙 🔑' }, { key: 'receipts', value: 2 }] };
}

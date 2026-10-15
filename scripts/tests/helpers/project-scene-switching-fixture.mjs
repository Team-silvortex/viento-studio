import fs from 'node:fs/promises';
import path from 'node:path';
import { projectAssemblyAuthor } from './project-assembly-backend-fixture.mjs';
const json = value => JSON.stringify(value, null, 2) + '\n';

export async function projectSceneSwitchingAuthor(t, { mode = 'roundtrip' } = {}) {
  const f = await projectAssemblyAuthor(t), [first, second] = f.sceneIds;
  const secondManifestId = '12345678-1234-4234-8234-123456789ac1', secondScriptId = '12345678-1234-4234-8234-123456789ac2';
  const secondBindingId = '12345678-1234-4234-8234-123456789ac3';
  const read = async file => JSON.parse(await fs.readFile(path.join(f.author, file)));
  const write = async (file, value) => fs.writeFile(path.join(f.author, file), json(value));
  const firstManifest = await read('documents/behaviors/demo.json');
  firstManifest.bindings.forEach(binding => { binding.parameters = {}; binding.events = []; });
  await write('documents/behaviors/demo.json', firstManifest);
  const prefix = 'extends Node\n';
  const request = id => `\tif has_meta("viento_project"):\n\t\tget_meta("viento_project").request_scene("${id}")\n`;
  let firstSource = prefix + 'static var first_visit := true\nfunc _ready() -> void:\n\tif not first_visit:\n\t\treturn\n\tfirst_visit = false\n' + request(second);
  let secondSource = prefix + 'func _ready() -> void:\n' + request(first);
  if (mode === 'no-switch') { firstSource = prefix; secondSource = prefix; }
  else if (mode === 'invalid-target') firstSource = prefix + 'func _ready() -> void:\n' + request('12345678-1234-4234-8234-123456789fff');
  else if (mode === 'loop') firstSource = prefix + 'func _ready() -> void:\n' + request(second);
  else if (mode === 'audio-entry') {
    const assembly = await read('documents/projects/demo.json'); assembly.entrySceneId = second; await write('documents/projects/demo.json', assembly);
    f.entrySceneId = second; firstSource = prefix;
  } else if (mode !== 'roundtrip') throw new Error('Unknown scene switching fixture mode.');
  await fs.writeFile(path.join(f.author, 'documents/scripts/checkpoint.txt'), firstSource);
  await fs.writeFile(path.join(f.author, 'documents/scripts/second.txt'), secondSource);
  const scriptRecord = await read(`metadata/documents/${f.scriptId}.json`);
  await write(`metadata/documents/${secondScriptId}.json`, { ...scriptRecord, id: secondScriptId, sourcePath: 'documents/scripts/second.txt' });
  const manifest = { ...firstManifest, sceneObjectId: second, bindings: [{ ...firstManifest.bindings[0], bindingId: secondBindingId,
    implementation: { ...firstManifest.bindings[0].implementation, sourceObjectId: secondScriptId } }] };
  await write('documents/behaviors/second.json', manifest);
  const manifestRecord = await read('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json');
  await write(`metadata/documents/${secondManifestId}.json`, { ...manifestRecord, id: secondManifestId, sourcePath: 'documents/behaviors/second.json',
    relations: [{ kind: 'reference', targetId: second, slot: 'scene' }, { kind: 'reference', targetId: secondScriptId, slot: 'implementation' }] });
  const sceneRecord = await read(`metadata/documents/${second}.json`);
  sceneRecord.relations.push({ kind: 'behavior', targetId: secondManifestId, slot: 'instance behaviors' });
  await write(`metadata/documents/${second}.json`, sceneRecord);
  return { ...f, secondScriptId, secondBindingId, secondManifestId };
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { projectSceneSwitchingAuthor } from './project-scene-switching-fixture.mjs';
import { listScriptStarters } from '../../../engine/script-authoring.mjs';

// Only public state drives the return trip; no static variables hide runtime
// state outside the protocol. Author files live in a disposable fixture.
export async function projectSharedStateAuthor(t) {
  const f = await projectSceneSwitchingAuthor(t, { mode: 'no-switch' });
  const starter = listScriptStarters().find(item => item.id === 'godot-project-state').content;
  const manifestPath = path.join(f.author, 'documents/behaviors/demo.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath)); manifest.bindings = manifest.bindings.slice(0, 1);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const first = starter + `\tif count == 0:\n\t\tproject.write_state("key_found", true)\n\t\tproject.write_state("note", "雨の鍵 / 风之钥匙 🔑")\n\t\tproject.request_scene("${f.sceneIds[1]}")\n\telif count == 2:\n\t\tif project.read_state("key_found") != true or project.read_state("note") != "雨の鍵 / 风之钥匙 🔑":\n\t\t\tpush_error("SHARED_STATE_RETURN_MISMATCH")\n\t\t\tget_tree().quit(1)\n\t\tproject.erase_state("key_found")\n\telse:\n\t\tpush_error("SHARED_STATE_FIRST_VISIT_MISMATCH")\n\t\tget_tree().quit(1)\n`;
  const second = starter + `\tif count != 1 or project.read_state("key_found") != true:\n\t\tpush_error("SHARED_STATE_SECOND_VISIT_MISMATCH")\n\t\tget_tree().quit(1)\n\t\treturn\n\tproject.request_scene("${f.sceneIds[0]}")\n`;
  await fs.writeFile(path.join(f.author, 'documents/scripts/checkpoint.txt'), first);
  await fs.writeFile(path.join(f.author, 'documents/scripts/second.txt'), second);
  return { ...f, firstBindingId: manifest.bindings[0].bindingId, expectedRevision: 6,
    expectedEntries: [{ key: 'note', value: '雨の鍵 / 风之钥匙 🔑' }, { key: 'visit_count', value: 3 }] };
}

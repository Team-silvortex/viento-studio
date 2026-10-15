import fs from 'node:fs/promises';
import path from 'node:path';
import { projectEventsAuthor } from './project-events-author-fixture.mjs';
const json = value => JSON.stringify(value, null, 2) + '\n';

// Disposable A→B→A project: both visits own a distinct audio declaration,
// even though the track UUID and WAV are reused. No scheduled cue simulates
// behavior playback; requests made during ready and event callbacks are real.
export async function projectAudioControlAuthor(t) {
  const f = await projectEventsAuthor(t);
  const read = async file => JSON.parse(await fs.readFile(path.join(f.author, file)));
  const write = async (file, value) => fs.writeFile(path.join(f.author, file), json(value));
  const firstAudioId = '12345678-1234-4234-8234-123456789ae1';
  const secondAudioId = '88888888-8888-4888-8888-888888888888';
  const audio = await read('documents/audio/demo.json'); audio.cues = [];
  await write('documents/audio/demo.json', audio);
  await write('documents/audio/first.json', { ...audio, sceneObjectId: f.sceneIds[0] });
  const audioRecord = await read(`metadata/documents/${secondAudioId}.json`);
  await write(`metadata/documents/${firstAudioId}.json`, { ...audioRecord, id: firstAudioId, sourcePath: 'documents/audio/first.json',
    relations: audioRecord.relations.map(row => row.targetId === f.sceneIds[1] ? { ...row, targetId: f.sceneIds[0] } : row) });
  const sceneRecord = await read(`metadata/documents/${f.sceneIds[0]}.json`);
  sceneRecord.relations.push({ kind: 'audio', targetId: firstAudioId, slot: 'scene audio' });
  await write(`metadata/documents/${f.sceneIds[0]}.json`, sceneRecord);
  const trackId = audio.tracks[0].id;
  const changeScript = async (name, replacements) => {
    const file = path.join(f.author, `documents/scripts/${name}.txt`); let source = await fs.readFile(file, 'utf8');
    for (const [before, after] of replacements) { if (!source.includes(before)) throw Error('Audio fixture lost source anchor: '+name); source = source.replace(before, after); }
    await fs.writeFile(file, source);
  };
  await changeScript('checkpoint', [
    ['project = get_meta("viento_project")', `project = get_meta("viento_project")\n\tproject.play_audio("${trackId}")`],
    ['func _on_checkpoint(value) -> bool:', `func _on_checkpoint(value) -> bool:\n\tif not project.stop_audio("${trackId}"):\n\t\treturn false`],
    ['func _on_receipt(_value) -> bool:', `func _on_receipt(_value) -> bool:\n\tif not project.play_audio("${trackId}"):\n\t\treturn false`],
  ]);
  await changeScript('second', [
    ['project = get_meta("viento_project")', `project = get_meta("viento_project")\n\tproject.play_audio("${trackId}")`],
    ['func _on_checkpoint(value) -> bool:', `func _on_checkpoint(value) -> bool:\n\tif not project.stop_audio("${trackId}"):\n\t\treturn false`],
  ]);
  return { ...f, trackId, firstAudioId, secondAudioId,
    expectedAudioSequence: 8, expectedAudioActions: ['play','stop','play','play','stop','play','stop','play'],
    expectedAudioVisits: [1,1,1,2,2,3,3,3] };
}

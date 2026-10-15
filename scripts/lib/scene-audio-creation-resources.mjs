import path from 'node:path';
import { createHash } from 'node:crypto';
import { createError } from '../../engine/service-error.mjs';
import { readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { validatePcmWave } from './audio-wav.mjs';
import { resolveAssetRoot } from './workspace.mjs';
import { resolveContainedPath } from './contained-path.mjs';

// Assets remain external author data. This check freezes identity for the
// transaction decision; no audio bytes enter the three-file write set/journal.
export async function verifyAudioCreationResources(root, plan, expectedAssetRoot) {
  const assetRoot = resolveAssetRoot(root);
  if (expectedAssetRoot && assetRoot !== expectedAssetRoot) throw createError(409, 'The resource store changed; preview again.', {}, 'world_audio_resource_changed');
  const boundary = assetRoot === path.join(root, 'assets') ? root : assetRoot;
  let total = 0;
  for (const { record } of plan.audioRecovery.resources) {
    const details = { resourceId: record.id };
    if ((total += record.content.size) > 128 * 1024 * 1024) throw createError(413, 'Selected audio exceeds 128 MiB.', details, 'world_audio_resource_limit');
    let bytes;
    try {
      const file = await resolveContainedPath(boundary, path.join(assetRoot, record.location.path));
      bytes = await readBuildFile(file, 32 * 1024 * 1024);
    } catch { throw createError(422, 'Cannot read the selected bounded WAV resource.', details, 'world_audio_resource_unavailable'); }
    if (bytes.length !== record.content.size || createHash('sha256').update(bytes).digest('hex') !== record.content.sha256) {
      throw createError(409, 'Audio bytes changed since registration; import the current file before creating sound.', details, 'world_audio_resource_changed');
    }
    try { validatePcmWave(bytes); }
    catch { throw createError(422, 'Select a PCM16 mono/stereo WAV between 8 and 96 kHz.', details, 'world_audio_resource_format'); }
  }
  if (resolveAssetRoot(root) !== assetRoot) throw createError(409, 'The resource store changed; preview again.', {}, 'world_audio_resource_changed');
  return assetRoot;
}

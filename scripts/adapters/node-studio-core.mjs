import { readFile, stat } from 'node:fs/promises';
import { initializeStudioCore, getStudioCoreMetadata } from '../../engine/studio-core.mjs';

const MAX_MODULE_BYTES = 4 * 1024 * 1024;

async function loadNodeCore() {
  const url = new URL('../../engine/studio-core.wasm', import.meta.url);
  if ((await stat(url)).size > MAX_MODULE_BYTES) throw new Error('Rust core module exceeds its size limit.');
  const bytes = await readFile(url);
  if (!bytes.byteLength || bytes.byteLength > MAX_MODULE_BYTES) throw new Error('Rust core module size is invalid.');
  return bytes;
}

if (!getStudioCoreMetadata().ready) await initializeStudioCore(loadNodeCore);

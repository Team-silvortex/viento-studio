import { initializeStudioCore, getStudioCoreMetadata } from '../../engine/studio-core.mjs';

const MAX_MODULE_BYTES = 4 * 1024 * 1024, LOAD_TIMEOUT_MS = 8000;

async function loadBrowserCore() {
  const url = new URL('../../engine/studio-core.wasm', import.meta.url), controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Rust core loading timed out.')); }, LOAD_TIMEOUT_MS); });
  const read = async () => {
    const response = await fetch(url, { cache: 'no-cache', signal: controller.signal });
    if (!response.ok) throw new Error(`Rust core request failed with HTTP ${response.status}.`);
    const size = Number(response.headers.get('content-length'));
    if (Number.isFinite(size) && size > MAX_MODULE_BYTES) throw new Error('Rust core module exceeds its size limit.');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Rust core module requires a readable response body.');
    const chunks = []; let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > MAX_MODULE_BYTES) throw new Error('Rust core module exceeds its size limit.');
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  };
  try { return await Promise.race([read(), timeout]); }
  finally { clearTimeout(timer); controller.abort(); }
}

if (!getStudioCoreMetadata().ready) await initializeStudioCore(loadBrowserCore);

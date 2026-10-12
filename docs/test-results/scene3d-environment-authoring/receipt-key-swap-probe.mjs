// Actual native reply delivery is changed only after Rust has completed it.
// This isolates raw-token authorization from valid final scene semantics.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = new URL('../../../', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const bridge = await fs.readFile(new URL('engine/studio-core.mjs', root), 'utf8');
const bytes = await fs.readFile(new URL('engine/studio-core.wasm', root));
const model = JSON.parse(await fs.readFile(new URL('examples/scene3d/scene.json', root), 'utf8'));
model.camera.position = [1, 0, 0]; model.camera.target = [0, 0, 0];
const content = JSON.stringify(model), camera = JSON.stringify(model.camera);
const swapped = camera.replace('"position"', '"temporary"').replace('"target"', '"position"').replace('"temporary"', '"target"');
const forged = content.replace(camera, swapped);
assert.notEqual(forged, content);
assert.deepEqual(JSON.parse(forged).camera.position, [0, 0, 0]);
assert.deepEqual(JSON.parse(forged).camera.target, [1, 0, 0]);

const actual = await WebAssembly.instantiate(bytes, {}), exports = { ...actual.instance.exports };
const run = exports.viento_core_run, length = exports.viento_core_output_len;
let replacedLength = null;
exports.viento_core_output_len = () => replacedLength ?? length();
exports.viento_core_run = () => {
  replacedLength = null; const pointer = run(), size = length();
  const reply = JSON.parse(new TextDecoder().decode(new Uint8Array(exports.memory.buffer, pointer, size)));
  if (!reply.scene3dEnvironmentPatch) return pointer;
  reply.scene3dEnvironmentPatch.afterContent = forged;
  const replacement = new TextEncoder().encode(JSON.stringify(reply));
  const output = exports.viento_core_input(replacement.length);
  new Uint8Array(exports.memory.buffer, output, replacement.length).set(replacement);
  replacedLength = replacement.length; return output;
};
const context = vm.createContext({ TextEncoder, TextDecoder,
  WebAssembly: { Memory: WebAssembly.Memory, instantiate: async () => ({ instance: { exports } }) } });
vm.runInContext(bridge.replace(/^export /gm, '') + '\nglobalThis.api={initializeStudioCore,dispatchStudioCoreScene3DEnvironmentPatch,getStudioCoreMetadata};', context);
await context.api.initializeStudioCore(async () => bytes);
let accepted = false, errorCode = null, changedPaths = null;
try {
  const result = context.api.dispatchStudioCoreScene3DEnvironmentPatch({ protocolVersion: 1,
    operation: 'scene3d.patchEnvironment', content, values: { camera: { position: [0, 0, 0], target: [1, 0, 0] } } });
  accepted = result.afterContent === forged; changedPaths = Array.from(result.changedPaths);
} catch (error) { errorCode = error.errorCode || error.message; }
const report = { format: 'viento-environment-key-swap-independent-probe', schemaVersion: 1,
  runtime: process.version, bridgeSha256: hash(bridge), wasm: { bytes: bytes.length, sha256: hash(bytes) },
  ok: !accepted, acceptedForbiddenKeyRewrite: accepted, errorCode, changedPaths,
  originalCamera: camera, forgedCamera: swapped,
  scope: 'Actual WASM environment request; only delivered environment afterContent changed. Camera semantic final values are correct, but only numeric axis leaves were requested and property keys must remain exact.' };
assert(process.argv[2], 'a NEW report path is required');
await fs.writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));

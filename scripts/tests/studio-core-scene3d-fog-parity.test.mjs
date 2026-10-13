import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';

const bytes = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(bytes, {}), core = instance.exports;
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN;
let nativeAvailable = false;
if (nativePath) try { await fs.access(nativePath, constants.X_OK); nativeAvailable = true; } catch { /* Native parity is opt-in outside a prepared core build. */ }
const scene = JSON.parse(await fs.readFile(new URL('../../examples/scene3d/scene.json', import.meta.url), 'utf8'));
const content = '\ufeff' + JSON.stringify({ ...scene, name: 'Fog / 霧 / 雾 🦊 } "fog"' }, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const withFog = fog => { const at = content.lastIndexOf('}'); return content.slice(0, at) + ',"fog":' + JSON.stringify(fog) + content.slice(at); };
const parse = content => ({ protocolVersion: 1, operation: 'scene3d.parse', content });
const patch = (values, source = content) => ({ protocolVersion: 1, operation: 'scene3d.patchEnvironment', content: source, values });
function wasm(value) {
  const input = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  const at = core.viento_core_input(input.length) >>> 0;
  new Uint8Array(core.memory.buffer, at, input.length).set(input);
  const output = core.viento_core_run() >>> 0, length = core.viento_core_output_len();
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(core.memory.buffer, output, length)));
}
function native(values) {
  return new Promise((resolve, reject) => {
    const process = spawn(nativePath, [], { stdio: ['pipe', 'pipe', 'pipe'] }); let output = '', errors = '';
    process.on('error', reject); process.stdin.on('error', reject);
    process.stdout.on('data', value => { output += value; }); process.stderr.on('data', value => { errors += value; });
    process.on('close', code => {
      try { assert.equal(code, 0, errors); resolve(output.trim().split('\n').map(line => JSON.parse(line))); } catch (error) { reject(error); }
    });
    process.stdin.end(values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n') + '\n');
  });
}

test('fresh native CLI and actual WASM agree on 28 optional fog parse patch lexical budget and compatibility requests', { skip: !nativeAvailable }, async () => {
  const fog = { color: '#AbCdEF', density: .125 }, present = withFog(fog);
  const lexical = present.replace('"fog":', '"fo\\u0067":').replace('"color":"#AbCdEF"', '"co\\u006cor":"#AbCd\\u0045F"').replace('"density":0.125', '"den\\u0073ity":1.250e-1');
  const wire = JSON.stringify(patch({ fog }));
  const exact = content + ' '.repeat(128 * 1024 - Buffer.byteLength(content));
  const inputs = [
    parse(content), parse(present), parse(withFog({ ...fog, density: 0 })), parse(withFog({ ...fog, density: 1 })),
    parse(withFog({ ...fog, density: 5e-324 })), parse(lexical),
    parse(withFog({ ...fog, density: -0.01 })), parse(withFog({ ...fog, density: 1.01 })),
    parse(withFog({ ...fog, enabled: true })), parse(withFog(null)),
    parse(present.replace('"density":0.125', '"density":0,"den\\u0073ity":0.125')),
    patch({ fog }), patch({ fog: { ...fog, density: 0 } }), patch({ fog: { ...fog, density: 5e-324 } }),
    patch({ fog: { ...fog, density: .000001 } }), patch({ fog: { ...fog, density: .0000001 } }),
    patch({ fog, background: '#102030', camera: { fovDegrees: 70 }, light: { energy: 2 } }),
    patch({ fog }, lexical), patch({ fog: { ...fog, color: '#abcdef', density: 0 } }, lexical),
    patch({ background: '#102030' }, lexical), patch({ fog: { color: '#ffffff' } }),
    patch({ fog: { ...fog, density: 2 }, background: '#102030' }),
    wire.replace('"fog":', '"fog":null,"fo\\u0067":'),
    wire.replace('"density":', '"density":null,"den\\u0073ity":'),
    patch({ fog }, exact),
    { protocolVersion: 1, operation: 'scene3d.patchObjectTransform', content: lexical, instanceId: scene.objects[0].instanceId, values: { position: [2, 3, 4] } },
    { protocolVersion: 1, operation: 'scene3d.patchObjects', content: lexical, action: 'copy', instanceId: scene.objects[0].instanceId, newInstanceId: '60000000-1111-4111-8111-111111111111', name: 'Copied through fog' },
    patch({ background: '#112233' }),
  ];
  assert.equal(inputs.length, 28);
  const wasmResults = inputs.map(wasm), nativeResults = await native(inputs);
  assert.deepEqual(nativeResults, wasmResults);
  assert.ok(wasmResults.some(result => result.ok)); assert.ok(wasmResults.some(result => !result.ok));
  assert.equal(wasmResults[22].errorCode, 'studio_core_request_invalid'); assert.equal(wasmResults[23].errorCode, 'studio_core_request_invalid');
  assert.equal(wasmResults[24].errorCode, 'scene3d_limit');
});

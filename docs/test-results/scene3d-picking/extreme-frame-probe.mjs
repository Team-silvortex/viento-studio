import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pickScene3DObject } from '../../../web/modules/scene3d-picking.js';
import { frameCamera, multiply4, perspective4, lookAt4, objectMatrix4 } from '../../../web/modules/scene3d-math.js';

const root = new URL('../../../', import.meta.url), out = new URL('./', import.meta.url);
const paths = ['web/modules/scene3d-picking.js', 'web/modules/scene3d-math.js'];
const hashes = async () => Object.fromEntries(await Promise.all(paths.map(async path => [path,
  createHash('sha256').update(await fs.readFile(new URL(path, root))).digest('hex')])));
const before = await hashes(), cases = [];
for (const size of [[.001, .001, .001], [1000, 1000, 1000], [.001, 1000, .001]])
  for (const fovDegrees of [1, 179]) for (const [width, height] of [[1, 2048], [2048, 1], [900, 400]]) {
    const object = { instanceId: '00000000-0000-4000-8000-000000000001', position: [100000, -100000, 100000],
      size, rotationDegrees: [173, -35999, 67] };
    const camera = frameCamera({ position: [4, 3, 6], target: [0, 0, 0], fovDegrees, near: 10000, far: 100000 }, object, width / height);
    assert.ok(camera && [...camera.position, ...camera.target, camera.near, camera.far].every(Number.isFinite));
    const eye = camera.position.map((value, index) => value - camera.target[index]);
    const current = { rect: { left: 17, top: 23, width, height }, width, height,
      viewProjection: new Float32Array(multiply4(perspective4(camera.fovDegrees, width / height, camera.near, camera.far), lookAt4(eye, [0, 0, 0]))),
      objects: [{ instanceId: object.instanceId, model: new Float32Array(objectMatrix4({ ...object, position: [0, 0, 0] })) }] };
    assert.ok([...current.viewProjection, ...current.objects[0].model].every(Number.isFinite));
    assert.equal(pickScene3DObject(current, 17 + width / 2, 23 + height / 2), object.instanceId);
    cases.push({ size, fovDegrees, width, height, centerHit: object.instanceId, ok: true });
  }
const after = await hashes(); assert.deepEqual(after, before);
const output = process.argv[2]; assert.ok(output && /^[a-z0-9-]+\.json$/.test(output));
const report = { format: 'viento-scene3d-picking-extreme-framing-quality', schemaVersion: 1,
  observedAt: new Date().toISOString(), node: process.version, ok: true, passed: cases.length, failed: 0,
  sourceStable: true, sources: before, endSources: after, cases,
  scope: 'Actual pure framing and picking with Float32 matrix payloads derived in the renderer coordinate convention. Eighteen combinations of distant coordinates, minimum/maximum/anisotropic size, FOV and canvas aspect; guaranteed center hit and finite temporary camera. No actual GPU, browser/device pixels or source mutation.' };
await fs.writeFile(new URL(output, out), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ok: true, passed: cases.length, failed: 0, sourceStable: true, node: process.version, output }));

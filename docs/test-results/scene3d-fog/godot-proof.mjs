import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { exportScene3DProject, executeScene3DProject } from '../../../scripts/adapters/node-scene3d-export.mjs';

const base = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(base, '../../..');
const godot = '/home/chiharukiryu/.cache/io.viento.studio/toolchains/godot/4.7.2-stable/linux-x86_64/Godot_v4.7.2-stable_linux.x86_64';
const hash = value => createHash('sha256').update(value).digest('hex');
const owned = ['scripts/backends/godot4-scene3d.mjs', 'scripts/backends/godot3d/runtime.gd', 'scripts/adapters/node-scene3d-export.mjs',
  'scripts/tests/scene3d-fog-backend.test.mjs', 'engine/scene3d.mjs', 'engine/studio-core.mjs', 'engine/studio-core.wasm'];
async function hashes() { return Object.fromEntries(await Promise.all(owned.map(async file => { const bytes = await fs.readFile(path.join(root, file)); return [file, { bytes: bytes.length, sha256: hash(bytes) }]; }))); }
async function toolIdentity() {
  const stat = await fs.lstat(godot); assert.ok(stat.isFile() && !stat.isSymbolicLink());
  return { dev: stat.dev, ino: stat.ino, bytes: stat.size, sha256: hash(await fs.readFile(godot)) };
}
const report = { format: 'viento-scene3d-fog-godot-evidence', schemaVersion: 1, ok: false,
  scope: 'Actual pinned Linux Godot identify/import/script-check/headless environment-property and static-scene probes. Fog values are read from the instantiated Environment and checked against original authored data. No GPU pixels, WebGL/Godot pixel equivalence, Android device, installation, gameplay or temporal weather claim.',
  formulaReference: { formula: '1 - exp(-density * radial camera distance)', source: 'https://raw.githubusercontent.com/godotengine/godot/4.5-stable/drivers/gles3/shaders/scene.glsl', lines: [1479, 1484] },
  node: { executable: process.execPath, version: process.version, sha256: hash(await fs.readFile(process.execPath)) },
  tool: { path: godot, ...await toolIdentity() }, sourcesBefore: await hashes(), cases: [] };
const cases = [['absent', undefined], ['disabled', 0], ['exponential', .075], ['maximum', 1], ['float32-small', 1e-40], ['float32-underflow', 5e-324]];
try {
  for (const [name, density] of cases) {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-fog-godot-')), pin = await fs.lstat(temporary);
    const record = { name, ok: false, fixture: { path: temporary, dev: pin.dev, ino: pin.ino, removed: false } };
    try {
      const value = JSON.parse(await fs.readFile(path.join(root, 'examples/scene3d/scene.json'), 'utf8'));
      if (density !== undefined) value.fog = { color: '#7aA0cf', density };
      const content = '\ufeff' + JSON.stringify(value, null, 2).replaceAll('\n', '\r\n') + '\r\n', input = path.join(temporary, 'source.json'), output = path.join(temporary, 'project');
      await fs.writeFile(input, content); const receipt = await exportScene3DProject({ input, output });
      const execution = await executeScene3DProject(receipt, { godotBin: godot, run: true });
      record.execution = execution; record.manifest = receipt.manifest; record.sourceSha256 = hash(Buffer.from(content));
      assert.equal(execution.ok, true, JSON.stringify(execution)); assert.equal(execution.phases.length, 4);
      assert.ok(execution.phases.every(phase => phase.status === 'succeeded' && phase.exitCode === 0));
      assert.equal(await fs.readFile(input, 'utf8'), content); assert.equal(await fs.readFile(path.join(output, 'source.json'), 'utf8'), content);
      if (density === undefined) assert.equal(Object.hasOwn(execution.probe, 'fog'), false);
      else {
        assert.equal(execution.probe.fog.enabled, density > 0); assert.equal(execution.probe.fog.mode, 0);
        const expected = Math.fround(density); assert.ok(Math.abs(execution.probe.fog.density - expected) <= 3e-7 * Math.max(Math.abs(expected), 1e-45));
        assert.equal(execution.probe.fog.skyAffect, 0); assert.equal(execution.probe.fog.heightDensity, 0);
      }
      const destination = path.join(base, 'godot-projects', name); await fs.mkdir(destination, { recursive: true }); record.generatedFiles = [];
      for (const file of [...receipt.manifest.files.map(entry => entry.path), 'scene3d-project.json']) {
        const bytes = await fs.readFile(path.join(output, file)); await fs.writeFile(path.join(destination, file), bytes);
        record.generatedFiles.push({ path: path.relative(base, path.join(destination, file)), bytes: bytes.length, sha256: hash(bytes) });
      }
      record.ok = true;
    } catch (error) { record.error = { name: error.name, message: error.message, code: error.errorCode || error.code }; throw error; }
    finally {
      const current = await fs.lstat(temporary); assert.ok(current.isDirectory() && !current.isSymbolicLink() && current.dev === pin.dev && current.ino === pin.ino);
      await fs.rm(temporary, { recursive: true }); record.fixture.removed = true; report.cases.push(record);
      await fs.writeFile(path.join(base, `godot-${name}.json`), JSON.stringify(record, null, 2) + '\n');
    }
  }
  report.sourcesAfter = await hashes(); assert.deepEqual(report.sourcesAfter, report.sourcesBefore);
  report.toolAfter = await toolIdentity(); assert.deepEqual(report.toolAfter, Object.fromEntries(Object.entries(report.tool).filter(([key]) => key !== 'path')));
  report.ok = true;
} catch (error) { report.error = { name: error.name, message: error.message, code: error.errorCode || error.code }; process.exitCode = 1; }
finally { await fs.writeFile(path.join(base, 'godot.json'), JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ ok: report.ok, cases: report.cases.map(item => ({ name: item.name, ok: item.ok, fog: item.execution?.probe?.fog })), error: report.error }));

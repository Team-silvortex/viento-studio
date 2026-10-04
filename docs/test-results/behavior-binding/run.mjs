// Standalone feasibility probe; not part of Viento's runtime adapter.
// VIENTO_GODOT_BIN=/absolute/path/to/Godot node run.mjs > /tmp/binding-results.json
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const executable = process.env.VIENTO_GODOT_BIN;
if (!executable || !isAbsolute(executable)) throw new Error('VIENTO_GODOT_BIN must be an absolute Godot executable path');
const source = dirname(fileURLToPath(import.meta.url));
const files = ['project.godot', 'guard.gd', 'bindings.json', 'probe.gd'];
const scratch = mkdtempSync(join(tmpdir(), 'viento-binding-probe-'));
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const toolSha256 = sha256(executable);
const sources = Object.fromEntries([...files, 'run.mjs'].map(file => [file, sha256(join(source, file))]));
try {
  const project = join(scratch, 'project');
  mkdirSync(project);
  for (const file of files) copyFileSync(join(source, file), join(project, file));
  const run = negative => {
    const args = ['--headless', '--path', project, '--script', 'res://probe.gd'];
    if (negative) args.push('--', '--self-test-failure');
    const result = spawnSync(executable, args, {
      encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
      env: { ...process.env, XDG_DATA_HOME: join(scratch, 'data'), XDG_CONFIG_HOME: join(scratch, 'config'), XDG_CACHE_HOME: join(scratch, 'cache') },
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    if (result.error || result.signal || /SCRIPT ERROR:|Parse Error:|ERROR:/.test(output)) throw new Error(`Probe did not complete cleanly: ${result.error || result.signal || output}`);
    const lines = output.split(/\r?\n/).filter(line => line.startsWith('VIENTO_BINDING_PROBE:'));
    if (lines.length !== 1) throw new Error(`Expected exactly one result: ${output}`);
    const data = JSON.parse(lines[0].slice('VIENTO_BINDING_PROBE:'.length));
    const expectedFailures = negative ? ['deliberate failure to verify nonzero exit'] : [];
    if (result.status !== (negative ? 1 : 0) || data.ok !== !negative || JSON.stringify(data.failures) !== JSON.stringify(expectedFailures)) throw new Error(`Unexpected probe outcome: ${output}`);
    if (data.checks.length !== 8 || data.features.headless !== true) throw new Error(`Incomplete probe: ${output}`);
    return { exitCode: result.status, data, output };
  };
  const positive = run(false);
  const failureControl = run(true);
  if (sha256(executable) !== toolSha256) throw new Error('Godot executable changed during probe');
  console.log(JSON.stringify({
    recordedAt: new Date().toISOString(), scope: 'Isolated GDScript binding feasibility; not an implemented Viento feature',
    platform: process.platform, arch: process.arch, node: process.version, toolSha256, sources,
    positive, failureControl,
    notTested: ['C# runtime or cross-language calls', 'Bevy compilation or BRP integration', 'script hot reload or state restoration', 'large-scene performance', 'Viento UI/build integration', 'author source writeback or migration'],
    cleanup: 'Temporary project and redirected XDG state removed by runner',
  }, null, 2));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

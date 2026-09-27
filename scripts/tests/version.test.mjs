import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { APP_ROOT, installerVersions, nextReleaseVersion, parseReleaseVersion, verifyReleaseVersions } from '../../desktop/version.mjs';

test('beta release digits map below the first stable installer version', () => {
  for (const [version, buildVersion] of [
    ['b.0.0', '0.0.0'],
    ['b.2.8', '0.2.8'],
    ['b.2.9', '0.2.9'],
    ['b.9.9', '0.9.9'],
    ['1.0.0', '1.0.0'],
    ['2.4.9', '2.4.9'],
    ['10.0.0', '10.0.0'],
    ['0.0.1', '0.0.1'],
    ['0.10.12', '0.10.12'],
    ['12.34.56', '12.34.56'],
  ]) {
    assert.deepEqual(parseReleaseVersion(version), { version, buildVersion });
  }
});

test('release numbers reject extra patches, non-digit beta parts and invalid stable numbers', () => {
  for (const version of ['', 'B.2.8', 'beta.2.8', 'a.2.8', 'c.3.0', 'b.2', 'b.2.8.',
    'b.02.8', 'b.2.08', 'b.10.0', 'b.2.10', 'b.2.-1', 'b.2.8.1', 'b.2.8.9', 'b.2.8-beta',
    '01.0.0', '1.00.0', '1.0.00', '1.0.0-beta', '1.0.0.0', '0.01.0', '0.0.01', '-1.0.0']) {
    assert.throws(() => parseReleaseVersion(version), /VERSION must use/);
    assert.throws(() => nextReleaseVersion(version), /VERSION must use/);
  }
});

test('all beta versions advance one digit and b.9.9 becomes 1.0.0', () => {
  for (let ordinal = 0; ordinal < 100; ordinal += 1) {
    const current = `b.${Math.floor(ordinal / 10)}.${ordinal % 10}`;
    const next = ordinal === 99 ? '1.0.0' : `b.${Math.floor((ordinal + 1) / 10)}.${(ordinal + 1) % 10}`;
    assert.equal(nextReleaseVersion(current), next);
    const before = parseReleaseVersion(current).buildVersion.split('.').map(Number);
    const after = parseReleaseVersion(next).buildVersion.split('.').map(Number);
    const changed = before.findIndex((part, index) => part !== after[index]);
    assert.ok(after[changed] > before[changed], `${current} → ${next} must increase the installer version`);
  }
});

test('numeric releases advance the patch without imposing the historical beta digit rollover', () => {
  for (const [version, next] of [['0.0.1', '0.0.2'], ['1.0.9', '1.0.10'], ['1.9.9', '1.9.10'],
    ['0.0.99', '0.0.100'], ['1.0.9007199254740992', '1.0.9007199254740993']]) {
    assert.equal(nextReleaseVersion(version), next);
  }
});

test('new installer counters advance beyond the predecessor without changing the product version', () => {
  assert.deepEqual(installerVersions('b.4.6'), { androidVersionCode: 4006, macOSBundleVersion: '0.4.6' });
  assert.deepEqual(installerVersions('0.0.1'), { androidVersionCode: 1000001, macOSBundleVersion: '1.0.1' });
  const releases = ['b.4.6', 'b.9.9', '0.0.1', '0.0.2', '0.0.999', '0.1.0', '0.999.999', '1.0.0'];
  for (let i = 1; i < releases.length; i++) {
    assert.ok(installerVersions(releases[i]).androidVersionCode > installerVersions(releases[i - 1]).androidVersionCode);
  }
  for (const version of ['0.1000.0', '0.0.1000', '2100.0.0']) {
    assert.throws(() => installerVersions(version), /installer version range/);
  }
});

test('source packaging accepts the same numeric and historical version grammar', async (t) => {
  const versions = ['b.4.6', '0.0.1', '0.10.12', '1.0.10', '01.0.0', '0.00.1', '0.0.1-beta', 'b.10.0'];
  const result = await promisify(execFile)(process.platform === 'win32' ? 'python' : 'python3', ['-c', `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('package_source', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
results = []
for version in json.loads(sys.argv[2]):
    try: results.append(module.parse_release_version(version))
    except ValueError: results.append(None)
print(json.dumps(results))
`, path.join(APP_ROOT, 'desktop/package-source.py'), JSON.stringify(versions)], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!result) { t.skip('Python is required only for source archive verification'); return; }
  assert.deepEqual(JSON.parse(result.stdout), versions.map(version => {
    try { return parseReleaseVersion(version).buildVersion; } catch { return null; }
  }));
});

test('release preflight rejects stale names, install counters and a changed data identity', async (t) => {
  await verifyReleaseVersions();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-version-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const names = ['VERSION', 'package.json', 'package-lock.json', 'src-tauri/tauri.conf.json',
    'src-tauri/tauri.android.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'web/index.html', 'desktop/ui/index.html'];
  for (const name of names) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.copyFile(path.join(APP_ROOT, name), path.join(root, name));
  }
  for (const [name, change, error] of [
    ['package.json', value => { value.name = 'epic-of-viento-line'; }, /name must be viento-studio/],
    ['src-tauri/tauri.android.conf.json', value => { value.bundle.android.versionCode = 1; }, /Android versionCode/],
    ['src-tauri/tauri.android.conf.json', value => { value.bundle.android.autoIncrementVersionCode = true; }, /Android versionCode/],
    ['src-tauri/tauri.conf.json', value => { value.identifier = 'io.viento.new'; }, /identifier must remain/],
    ['src-tauri/tauri.conf.json', value => { value.bundle.macOS.bundleVersion = '0.0.1'; }, /macOS bundleVersion/],
    ['src-tauri/tauri.conf.json', value => { value.bundle.windows.allowDowngrades = false; }, /Windows must allow/],
  ]) {
    const file = path.join(root, name), original = await fs.readFile(file, 'utf8');
    const value = JSON.parse(original); change(value);
    await fs.writeFile(file, JSON.stringify(value));
    await assert.rejects(verifyReleaseVersions(root), error);
    await fs.writeFile(file, original);
  }
});

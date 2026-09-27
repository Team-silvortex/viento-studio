import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));

export function parseReleaseVersion(version) {
  const beta = /^b\.([0-9])\.([0-9])$/.exec(version);
  if (beta) return { version, buildVersion: `0.${beta[1]}.${beta[2]}` };
  if (/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) return { version, buildVersion: version };
  throw new Error('VERSION must use a numeric release such as 0.0.1 (no leading zeros), or a historical b.X.Y version');
}

export function nextReleaseVersion(version) {
  parseReleaseVersion(version);
  if (!version.startsWith('b.')) {
    const [major, minor, patch] = version.split('.');
    return `${major}.${minor}.${BigInt(patch) + 1n}`;
  }
  const [stage, major, minor] = version.split('.');
  if (minor !== '9') return `${stage}.${major}.${Number(minor) + 1}`;
  if (major !== '9') return `${stage}.${Number(major) + 1}.0`;
  return stage === 'b' ? '1.0.0' : `${BigInt(stage) + 1n}.0.0`;
}

// The product version restarts at 0.0.1; installation counters must still
// advance past the predecessor's 0.4.6 / Android 4006. Reserve one major epoch.
export function installerVersions(version) {
  const { buildVersion } = parseReleaseVersion(version);
  const [major, minor, patch] = buildVersion.split('.').map(BigInt);
  const epochMajor = major + (version.startsWith('b.') ? 0n : 1n);
  const androidVersionCode = epochMajor * 1000000n + minor * 1000n + patch;
  if (minor > 999n || patch > 999n || androidVersionCode < 1n || androidVersionCode > 2100000000n) {
    throw new Error('Release exceeds the supported Android installer version range');
  }
  return { androidVersionCode: Number(androidVersionCode), macOSBundleVersion: `${epochMajor}.${minor}.${patch}` };
}

export async function readReleaseVersion(root = APP_ROOT) {
  return parseReleaseVersion((await fs.readFile(path.join(root, 'VERSION'), 'utf8')).trim());
}

export async function verifyReleaseVersions(root = APP_ROOT) {
  const release = await readReleaseVersion(root);
  const names = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json',
    'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'web/index.html', 'desktop/ui/index.html', 'src-tauri/tauri.android.conf.json'];
  const [pkg, lock, tauri, cargo, cargoLock, web, library, android] = await Promise.all(
    names.map((name) => fs.readFile(path.join(root, name), 'utf8')),
  );
  const versions = {
    'package.json': JSON.parse(pkg).version,
    'package-lock.json': JSON.parse(lock).version,
    'package-lock.json root package': JSON.parse(lock).packages?.['']?.version,
    'src-tauri/tauri.conf.json': JSON.parse(tauri).version,
    'src-tauri/Cargo.toml': cargo.match(/^version = "([^"]+)"/m)?.[1],
    'src-tauri/Cargo.lock': cargoLock.match(/\[\[package\]\]\s+name = "viento-studio"\s+version = "([^"]+)"/)?.[1],
  };
  for (const [name, version] of Object.entries(versions)) {
    if (version !== release.buildVersion) throw new Error(`${name}: expected ${release.buildVersion} for ${release.version}, got ${version}`);
  }
  for (const [name, value] of [['package.json', JSON.parse(pkg).name], ['package-lock.json', JSON.parse(lock).name],
    ['package-lock.json root package', JSON.parse(lock).packages?.['']?.name]]) {
    if (value !== 'viento-studio') throw new Error(`${name}: application name must be viento-studio`);
  }
  const config = JSON.parse(tauri);
  const mobile = JSON.parse(android);
  const installer = installerVersions(release.version);
  if (config.identifier !== 'io.viento.studio' || (mobile.identifier && mobile.identifier !== config.identifier)) {
    throw new Error('Application identifier must remain io.viento.studio to preserve existing data');
  }
  if (mobile.bundle?.android?.versionCode !== installer.androidVersionCode || mobile.bundle?.android?.autoIncrementVersionCode) {
    throw new Error(`Android versionCode must be ${installer.androidVersionCode} with automatic increments disabled`);
  }
  if (config.bundle?.macOS?.bundleVersion !== installer.macOSBundleVersion) {
    throw new Error(`macOS bundleVersion must be ${installer.macOSBundleVersion}`);
  }
  if (config.bundle?.windows?.allowDowngrades !== true) {
    throw new Error('Windows must allow the explicit transition from 0.4.6 to the new 0.0.1 version line');
  }
  for (const [name, html] of [['web/index.html', web], ['desktop/ui/index.html', library]]) {
    if (html.match(/id="appVersion"[^>]*>([^<]+)</)?.[1] !== release.version) {
      throw new Error(`${name}: displayed version must match VERSION (${release.version})`);
    }
  }
  return release;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--next') {
      throw new Error('Usage: node desktop/version.mjs --next');
    }
    console.log(nextReleaseVersion((await readReleaseVersion()).version));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

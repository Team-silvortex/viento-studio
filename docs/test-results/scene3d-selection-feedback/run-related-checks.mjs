import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { verifyReleaseVersions } from '../../../desktop/version.mjs';
import { runDocApiContractPreflight } from '../../../scripts/lib/verify-doc-api-contract.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const out = path.dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const baseline = JSON.parse(await fs.readFile(path.join(out, 'source-baseline.json')));
const frozen = JSON.parse(await fs.readFile(path.join(out, 'source-hashes-final.json')));
assert.equal(process.version, 'v24.20.0');
assert.equal(sha(await fs.readFile(process.execPath)), '89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7');
for (const [file, digest] of Object.entries(frozen)) assert.equal(sha(await fs.readFile(path.join(root, file))), digest, file);
const changed = Object.keys(frozen).filter(file => frozen[file] !== baseline[file]);
const syntax = changed.filter(file => /\.(?:mjs|js)$/.test(file));
for (const file of syntax) await run(process.execPath, ['--check', path.join(root, file)], { cwd: root });
const version = await verifyReleaseVersions();
assert.equal(version.version, '0.0.10');
await runDocApiContractPreflight();
const names = await fs.readdir(path.join(root, 'scripts/tests'));
const tests = names.filter(name => name.endsWith('.test.mjs') && (
  /^scene3d(?:-|\.)/.test(name) && name !== 'scene3d-export.test.mjs'
  || ['browser-module-graph.test.mjs', 'i18n-coverage.test.mjs', 'studio-modules.test.mjs', 'studio-system-ui.test.mjs'].includes(name)
)).sort().map(name => `scripts/tests/${name}`);
const start = { createdAt: new Date().toISOString(), node: process.version,
  sourceManifestSha256: sha(await fs.readFile(path.join(out, 'source-hashes-final.json'))),
  tests, syntaxFiles: syntax, version: version.version,
  scope: 'Current renderer/picking/navigation/preview and independent four-author/source/system-port tests, fixed module/UI assembly, actual browser import graph and translation catalogue. No new full-application, Rust/native CLI or backend execution claim.' };
await fs.writeFile(path.join(out, 'related-check-start.json'), JSON.stringify(start, null, 2) + '\n', { flag: 'wx' });
console.log(`Changed JavaScript syntax passed: ${syntax.length}; version/API preflight passed; related test files: ${tests.length}`);
const result = await run(process.execPath, ['--test', '--test-concurrency=2', ...tests], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
console.log(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
for (const [file, digest] of Object.entries(frozen)) assert.equal(sha(await fs.readFile(path.join(root, file))), digest, file);

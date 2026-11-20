import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

async function checkFixture(t, fixtureSource) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-check-output-'));
  const releasePath = path.join(root, 'release-test');
  let child;
  let closed = false;
  let completed;
  t.after(async () => {
    // Release a waiting real test worker even when the streaming assertion fails.
    await fs.writeFile(releasePath, '').catch(() => {});
    if (child && !closed) {
      await Promise.race([completed.catch(() => {}), delay(3000)]);
      if (!closed) {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
        }
        await completed.catch(() => {});
      }
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  const files = {
    'scripts/check-project.mjs': await fs.readFile(new URL('../check-project.mjs', import.meta.url), 'utf8'),
    'scripts/lib/process.mjs': await fs.readFile(new URL('../lib/process.mjs', import.meta.url), 'utf8'),
    'scripts/build-studio-core.mjs': 'export async function prepareStudioCore() {}\n',
    'scripts/lib/paths.mjs': 'export const INDEX_OUTPUT = "unused-index.json";\n',
    'scripts/lib/scan-files.mjs': 'export async function collectFiles() { return []; }\n',
    'scripts/lib/verify-doc-api-contract.mjs': 'export async function runDocApiContractPreflight() {}\n',
    'desktop/version.mjs': 'export async function verifyReleaseVersions() { return { version: "fixture", buildVersion: "1" }; }\n',
    'scripts/tests/fixture.test.mjs': fixtureSource.replaceAll('RELEASE_PATH', JSON.stringify(releasePath)),
  };
  await Promise.all(Object.entries(files).map(async ([name, content]) => {
    const destination = path.join(root, name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content);
  }));
  const env = { ...process.env };
  // The nested CLI must start its own runner instead of inheriting worker mode.
  delete env.NODE_TEST_CONTEXT;
  child = spawn(process.execPath, [path.join(root, 'scripts/check-project.mjs'), '--app-only'], {
    cwd: root,
    env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { output.stdout += chunk; });
  child.stderr.on('data', chunk => { output.stderr += chunk; });
  completed = new Promise((resolve, reject) => {
    child.once('error', error => { closed = true; reject(error); });
    child.once('close', (code, signal) => { closed = true; resolve({ code, signal, ...output }); });
  });
  return {
    output,
    completed,
    isClosed: () => closed,
    release: () => fs.writeFile(releasePath, ''),
    waitForOutput(predicate) {
      return new Promise((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          child.stdout.off('data', changed);
          child.stderr.off('data', changed);
          child.off('close', stopped);
          child.off('error', failed);
        };
        const changed = () => { if (predicate(output)) { cleanup(); resolve(); } };
        const stopped = () => { cleanup(); reject(new Error(`Check CLI exited before streaming test output: ${JSON.stringify(output)}`)); };
        const failed = error => { cleanup(); reject(error); };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`Check CLI did not stream test output while its test was still running: ${JSON.stringify(output)}`));
        }, 5000);
        child.stdout.on('data', changed);
        child.stderr.on('data', changed);
        child.once('close', stopped);
        child.once('error', failed);
        changed();
      });
    },
  };
}

test('check CLI streams test stdout and stderr before the test finishes', { timeout: 20000 }, async t => {
  const cli = await checkFixture(t, `
import fs from 'node:fs/promises';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
test('fixture waits for release', { timeout: 12000 }, async () => {
  process.stdout.write('CHECK_FIXTURE_STDOUT\\n');
  process.stderr.write('CHECK_FIXTURE_STDERR\\n');
  const deadline = Date.now() + 10000;
  while (true) {
    try { await fs.access(RELEASE_PATH); break; } catch {}
    if (Date.now() >= deadline) throw new Error('fixture release timed out');
    await delay(20);
  }
});
`);
  try {
    await cli.waitForOutput(output => {
      const text = output.stdout + output.stderr;
      return text.includes('CHECK_FIXTURE_STDOUT') && text.includes('CHECK_FIXTURE_STDERR');
    });
    assert.equal(cli.isClosed(), false, 'test output must be visible before the CLI exits');
  } finally {
    await cli.release();
  }
  const result = await cli.completed;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.signal, null);
});

test('check CLI preserves failed test TAP diagnostics and a nonzero exit status', { timeout: 20000 }, async t => {
  const cli = await checkFixture(t, `
import assert from 'node:assert/strict';
import test from 'node:test';
test('fixture fails with diagnostic', () => {
  assert.equal('actual fixture value', 'expected fixture value', 'CHECK_FIXTURE_FAILURE');
});
`);
  const result = await cli.completed;
  assert.notEqual(result.code, 0);
  assert.equal(result.signal, null);
  assert.match(result.stdout, /^TAP version 13$/m);
  assert.match(result.stdout, /^not ok 1 - fixture fails with diagnostic$/m);
  assert.match(result.stdout, /CHECK_FIXTURE_FAILURE/);
  assert.match(result.stdout, /actual fixture value/);
  assert.match(result.stdout, /expected fixture value/);
});

test('check CLI reports successful TAP tests and exits successfully', { timeout: 20000 }, async t => {
  const cli = await checkFixture(t, `
import test from 'node:test';
test('fixture succeeds', () => {});
`);
  const result = await cli.completed;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.signal, null);
  assert.match(result.stdout, /^TAP version 13$/m);
  assert.match(result.stdout, /^ok 1 - fixture succeeds$/m);
});

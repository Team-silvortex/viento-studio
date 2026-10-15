import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { BEVY_RUST_EXECUTION_ADAPTER as adapter } from '../backends/bevy-rust-adapter.mjs';
import { executionPhaseDiagnostics } from '../adapters/node-execution-backends.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const linux = { skip: process.platform !== 'linux' ? 'The Bevy Rust route is currently Linux only.' : false };
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-bevy-rust-adapter-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'project ; literal $(never-execute)'), tools = path.join(root, 'tools ; literal $(never-execute)'), calls = path.join(root, 'calls.jsonl');
  await fs.mkdir(directory); await fs.mkdir(tools); await fs.writeFile(path.join(directory, 'Cargo.toml'), '[package]\nname="fixture"\n');
  const configuration = path.join(root, 'configuration.json'); await fs.writeFile(configuration, JSON.stringify(options));
  const body = `const fs=require('node:fs'),path=require('node:path');
const name=path.basename(process.argv[1]),config=JSON.parse(fs.readFileSync(${JSON.stringify(configuration)},'utf8'));
const log=value=>fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(value)+'\\n');
if(process.argv[2]==='--version'){
 log({kind:'version',name});
 console.log(config[name+'Version']||name+' 1.95.0 (fixture 2026-01-01)');
 if(config[name+'Stderr'])console.error(config[name+'Stderr']);
 if(config[name+'VersionExit'])process.exitCode=config[name+'VersionExit'];
}else{
 const mode=config.compileMode||'success';
 log({kind:'compile',cwd:process.cwd(),args:process.argv.slice(2),env:process.env});
 if(mode==='mutate-rustc')fs.appendFileSync(process.env.RUSTC,'\\n// changed during compilation');
 console.log(config.compilerOutput||'compile-started');
 if(mode==='hang'){setInterval(()=>{},1000);}
 else if(mode==='failed'){process.exitCode=17;}
 else if(process.argv[2]==='build'&&mode!=='missing'){
  const binary=path.join(process.env.CARGO_TARGET_DIR,'debug','viento-bevy-behaviors');
  fs.mkdirSync(path.dirname(binary),{recursive:true});
  if(mode==='symlink')fs.symlinkSync(process.argv[1],binary);
  else fs.writeFileSync(binary,${JSON.stringify(`#!${process.execPath}\nconst fs=require('node:fs');const config=JSON.parse(fs.readFileSync(${JSON.stringify(configuration)},'utf8'));fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({kind:'runtime',cwd:process.cwd(),args:process.argv.slice(2),env:process.env})+'\\n');console.log('runtime-started');if(config.runtimeMode==='hang')setInterval(()=>{},1000);else if(config.runtimeMode==='failed')process.exitCode=23;\n`)},{mode:0o700});
 }
}`;
  for (const name of ['cargo', 'rustc']) await fs.writeFile(path.join(tools, name), `#!${process.execPath}\n${body}\n`, { mode: 0o700 });
  return { root, directory, tools, cargo: path.join(tools, 'cargo'), rustc: path.join(tools, 'rustc'), calls, configuration,
    async entries() { try { return (await fs.readFile(calls, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } },
    async configure(next) { await fs.writeFile(configuration, JSON.stringify(next)); } };
}
async function noCompilationRemains(f) {
  const entries = await f.entries(), compiles = entries.filter(item => item.kind === 'compile');
  for (const { cwd, env } of compiles) {
    await assert.rejects(fs.lstat(cwd), { code: 'ENOENT' });
    await assert.rejects(fs.lstat(env.CARGO_TARGET_DIR), { code: 'ENOENT' });
    await assert.rejects(fs.lstat(env.CARGO_HOME), { code: 'ENOENT' });
  }
  assert.deepEqual(await fs.readdir(f.directory), ['Cargo.toml']);
  return entries;
}
const sourceId = '99999999-9999-4999-8999-999999999999';
function diagnosticPlan() {
  return { scene: { objectId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', sourcePath: 'documents/scene.json' },
    behaviors: { manifest: { objectId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', sourcePath: 'documents/behavior.json' },
      sources: [{ objectId: sourceId, sourcePath: 'documents/scripts/行为.txt', sourceRevision: `sha256:${'a'.repeat(64)}`, content: 'pub fn ready() {\r\n    let 🦊 = ();\r\n}\n' }] } };
}
const compileMessage = (file, overrides = {}) => JSON.stringify({ reason: 'compiler-message', message: { level: 'error', message: 'Cannot compile this expression.',
  spans: [{ is_primary: true, file_name: file, line_start: 2 }], ...overrides } });
const generatedPath = `src/behaviors/b_${sourceId.replaceAll('-', '_')}.rs`;

test('Rust descriptor remains an explicit source-project route with no graphics or replay claims', () => {
  assert.equal(adapter.descriptor.id, 'org.viento.bevy-rust');
  assert.deepEqual(adapter.descriptor.plans, [{ kind: 'scene2d', schemaVersion: 3, runtimeProtocolVersion: 3 }]);
  assert.deepEqual(adapter.descriptor.capabilities, ['scene2d', 'input.arrows', 'state.movement', 'behavior.bindings', 'behavior.rust']);
  assert.deepEqual(adapter.descriptor.execution, { build: true, headlessLogic: true, windowPreview: false, windowCapture: false,
    offscreenRender: false, embeddedViewport: false, gpuCompute: false });
  assert.equal(adapter.acceptsLegacyBuildRecords, false); assert.deepEqual(adapter.buildPhases, ['cargo-check']); assert.deepEqual(adapter.runtimePhases, []);
  for (const value of [adapter, adapter.descriptor, adapter.buildPhases, adapter.runtimePhases]) assert.ok(Object.isFrozen(value));
});

test('availability only observes concrete adjacent Cargo/rustc files; identify pins both executable identities', linux, async t => {
  const f = await fixture(t);
  assert.deepEqual(await adapter.availability({ toolPath: f.cargo }), { supported: true, available: true, reason: null }); assert.deepEqual(await f.entries(), []);
  for (const toolPath of [undefined, 'relative', f.directory, path.join(f.root, 'missing')]) assert.equal((await adapter.availability({ toolPath })).available, false);
  assert.equal((await adapter.availability({ toolPath: f.cargo, platform: 'android' })).supported, false);
  const tool = await adapter.identify(f.cargo);
  assert.equal(tool.executable, await fs.realpath(f.cargo)); assert.equal(tool.sha256, hash(await fs.readFile(f.cargo)));
  assert.equal(tool.version, `cargo 1.95.0; rustc 1.95.0; rustc-sha256:${hash(await fs.readFile(f.rustc))}`);
  assert.ok(tool.version.length <= 256); assert.doesNotMatch(tool.version, /[/\\]/);
});

test('wrong compiler version, noisy probes, rustup-like executables and foreign rustc paths are rejected', linux, async t => {
  const f = await fixture(t);
  for (const config of [{ cargoVersion: 'cargo 1.94.0 (fixture)' }, { rustcVersion: 'rustc 1.94.0 (fixture)' }, { cargoStderr: 'unexpected' }, { rustcVersionExit: 3 }]) {
    await f.configure(config); await assert.rejects(adapter.identify(f.cargo), { errorCode: 'build_tool_version' });
  }
  await f.configure({}); const proxy = path.join(f.tools, 'rustup'); await fs.copyFile(f.cargo, proxy); await fs.chmod(proxy, 0o700);
  const cargoLink = path.join(f.root, 'cargo'); await fs.symlink(proxy, cargoLink);
  await assert.rejects(adapter.identify(cargoLink), { errorCode: 'build_tool_version' });
  const foreign = path.join(f.root, 'foreign'); await fs.mkdir(foreign); await fs.rename(f.rustc, path.join(foreign, 'rustc')); await fs.symlink(path.join(foreign, 'rustc'), f.rustc);
  await assert.rejects(adapter.identify(f.cargo), { errorCode: 'build_tool_version' });
});

test('offline check isolates Cargo configuration and target output while preserving literal project arguments', linux, async t => {
  const f = await fixture(t), tool = await adapter.identify(f.cargo), cache = path.join(f.root, 'cargo-cache'), previous = process.env.CARGO_HOME;
  await fs.mkdir(path.join(cache, 'registry'), { recursive: true }); await fs.writeFile(path.join(cache, 'config.toml'), '[build]\nrustc-wrapper="forbidden"\n');
  process.env.CARGO_HOME = cache; const observed = [];
  try {
    const result = await adapter.executePhase({ phase: 'cargo-check', directory: f.directory, tool, onOutput: output => observed.push(output) });
    assert.equal(result.status, 'succeeded'); assert.equal(result.phase, 'cargo-check');
    const entries = await noCompilationRemains(f), compiled = entries.find(item => item.kind === 'compile');
    assert.deepEqual(compiled.args, ['check', '--manifest-path', path.join(f.directory, 'Cargo.toml'), '--locked', '--offline', '--message-format=json']);
    assert.notEqual(compiled.cwd, f.directory); assert.equal(compiled.env.RUSTC, f.rustc); assert.equal(compiled.env.CARGO_NET_OFFLINE, 'true');
    assert.equal(compiled.env.RUSTC_WRAPPER, ''); assert.equal(compiled.env.RUSTC_WORKSPACE_WRAPPER, ''); assert.equal(compiled.env.RUSTFLAGS, '');
    assert.equal(compiled.env.CARGO_BUILD_JOBS, '2'); assert.equal(compiled.env.CARGO_INCREMENTAL, '0');
    assert.notEqual(compiled.env.CARGO_HOME, cache); assert.ok(observed.length); assert.ok(observed.every(item => item.stream === 'stderr'));
    assert.equal(await fs.readFile(path.join(cache, 'config.toml'), 'utf8'), '[build]\nrustc-wrapper="forbidden"\n');
  } finally { if (previous === undefined) delete process.env.CARGO_HOME; else process.env.CARGO_HOME = previous; }
});

test('run compiles the frozen source first and starts only the exact generated executable, with separate output streams', linux, async t => {
  const f = await fixture(t), tool = await adapter.identify(f.cargo), observed = [];
  const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool, onOutput: output => observed.push(output) });
  assert.equal(result.status, 'succeeded', result.stderr); assert.equal(result.phase, 'run'); assert.equal(result.stdout.trim(), 'runtime-started');
  assert.match(result.compilation.executableSha256, /^[a-f0-9]{64}$/);
  const entries = await noCompilationRemains(f), compile = entries.find(item => item.kind === 'compile'), runtime = entries.find(item => item.kind === 'runtime');
  assert.equal(compile.args[0], 'build'); assert.deepEqual(runtime.args, ['--scene', path.join(f.directory, 'scene-data.json'), '--smoke']);
  assert.equal(runtime.cwd, compile.cwd); assert.equal(runtime.env.CARGO_TARGET_DIR, compile.env.CARGO_TARGET_DIR);
  assert.ok(observed.some(item => item.stream === 'stderr' && item.text.includes('compile-started')));
  assert.ok(observed.some(item => item.stream === 'stdout' && item.text.includes('runtime-started')));
});

test('compile failure, timeout and cancellation preserve phase outcomes and remove disposable directories', linux, async t => {
  for (const scenario of ['failed', 'timeout', 'cancelled', 'observer-failed']) {
    await t.test(scenario, async t => {
      const f = await fixture(t, { compileMode: scenario === 'failed' ? 'failed' : 'hang' }), tool = await adapter.identify(f.cargo), controller = new AbortController();
      const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool, timeoutMs: scenario === 'timeout' ? 500 : 5000,
        signal: controller.signal, onOutput: output => { if (output.text.includes('compile-started')) { if (scenario === 'cancelled') controller.abort(); if (scenario === 'observer-failed') throw new Error('fixture compile observer stopped'); } } });
      assert.equal(result.status, scenario); assert.equal(result.phase, 'run'); assert.equal(result.stdout, ''); assert.match(result.compilerOutput, /compile-started/);
      const entries = await noCompilationRemains(f); assert.equal(entries.some(item => item.kind === 'runtime'), false);
    });
  }
});

test('runtime failure, timeout, cancellation and observer errors clean the same compiler workspace', linux, async t => {
  for (const scenario of ['failed', 'timeout', 'cancelled', 'observer-failed']) {
    await t.test(scenario, async t => {
      const f = await fixture(t, { runtimeMode: scenario === 'failed' ? 'failed' : 'hang' }), tool = await adapter.identify(f.cargo), controller = new AbortController();
      const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool, timeoutMs: scenario === 'timeout' ? 500 : 5000,
        signal: controller.signal, onOutput: output => { if (output.text.includes('runtime-started')) { if (scenario === 'cancelled') controller.abort();
          if (scenario === 'observer-failed') throw new Error('fixture observer stopped'); } } });
      assert.equal(result.status, scenario); assert.equal(result.phase, 'run');
      const entries = await noCompilationRemains(f); assert.equal(entries.filter(item => item.kind === 'runtime').length, 1);
    });
  }
});

test('changed tool bytes are refused both before compilation and after a compiler replaced its companion', linux, async t => {
  const f = await fixture(t), tool = await adapter.identify(f.cargo);
  await fs.appendFile(f.rustc, '\n// external replacement');
  await assert.rejects(adapter.executePhase({ phase: 'cargo-check', directory: f.directory, tool }), { errorCode: 'runtime_tool_changed' });
  assert.equal((await f.entries()).some(item => item.kind === 'compile'), false);
  const current = await adapter.identify(f.cargo); await f.configure({ compileMode: 'mutate-rustc' });
  await assert.rejects(adapter.executePhase({ phase: 'cargo-check', directory: f.directory, tool: current }), { errorCode: 'runtime_tool_changed' });
  await noCompilationRemains(f);
});

test('unsupported phases, windows, captures, replay and directory symlinks cannot invoke a tool', linux, async t => {
  const f = await fixture(t), base = { phase: 'run', directory: f.directory, tool: { executable: f.cargo } };
  for (const override of [{ phase: 'arbitrary' }, { mode: 'windowPreview' }, { capturePath: '/tmp/forged' }, { smoke: false }, { controlProgram: {} }]) {
    await assert.rejects(adapter.executePhase({ ...base, ...override }), { errorCode: 'build_execution_unsupported' });
  }
  await assert.rejects(adapter.executePhase({ ...base, directory: 'relative' }), { errorCode: 'build_output_invalid' });
  const link = path.join(f.root, 'project-link'); await fs.symlink(f.directory, link, 'dir');
  await assert.rejects(adapter.executePhase({ ...base, directory: link }), { errorCode: 'build_output_invalid' });
  assert.deepEqual(await f.entries(), []);
});

test('symlinked compiler output is rejected and never executed', linux, async t => {
  const f = await fixture(t, { compileMode: 'symlink' }), tool = await adapter.identify(f.cargo);
  await assert.rejects(adapter.executePhase({ phase: 'run', directory: f.directory, tool }), { errorCode: 'build_output_invalid' });
  const entries = await noCompilationRemains(f); assert.equal(entries.some(item => item.kind === 'runtime'), false);
});

test('compiler diagnostics map only approved UUID paths to frozen author UTF-16 positions', () => {
  const value = diagnosticPlan(), diagnostics = adapter.diagnostics({ phase: 'cargo-check', status: 'failed', stdout: compileMessage(generatedPath), stderr: '' }, value);
  assert.equal(diagnostics.length, 1); const error = diagnostics[0], source = value.behaviors.sources[0];
  assert.equal(error.objectId, source.objectId); assert.equal(error.sourcePath, source.sourcePath); assert.equal(error.sourceRevision, source.sourceRevision);
  assert.deepEqual(error.sourceRange, { start: 18, end: 34, encoding: 'utf-16', propertyPath: '', exact: true });
  assert.equal(source.content.slice(error.sourceRange.start, error.sourceRange.end), '    let 🦊 = ();');
});

test('untrusted compiler paths and malformed spans never become author navigation', () => {
  const value = diagnosticPlan();
  for (const file of ['/etc/passwd', '/tmp/project/' + generatedPath, '../' + generatedPath, 'src/behaviors/unknown.rs', generatedPath + ':2']) {
    const [diagnostic] = adapter.diagnostics({ phase: 'run', status: 'failed', compilerOutput: compileMessage(file), stdout: '', stderr: '' }, value);
    assert.equal(diagnostic.sourcePath, value.behaviors.manifest.sourcePath); assert.equal(diagnostic.sourceRange, undefined);
  }
  for (const stdout of ['null', '[]', '"text"', '42', 'not-json']) {
    assert.deepEqual(adapter.diagnostics({ phase: 'cargo-check', status: 'failed', stdout, stderr: '' }, value), []);
  }
  for (const message of [null, [], {}, { toString: 'untrusted' }]) {
    const errors = adapter.diagnostics({ phase: 'cargo-check', status: 'failed', stdout: compileMessage(generatedPath, { message }), stderr: '' }, value);
    assert.equal(errors.length, 1); assert.equal(typeof errors[0].message, 'string'); assert.ok(errors[0].message.length > 0);
  }
  for (const spans of [null, {}, 'untrusted', [null], [{ is_primary: true, file_name: generatedPath, line_start: 999 }]]) {
    const result = adapter.diagnostics({ phase: 'cargo-check', status: 'failed', stdout: compileMessage(generatedPath, { spans }), stderr: '' }, value);
    assert.equal(result.length, 1); assert.equal(result[0].sourceRange, undefined);
  }
});

test('compiler diagnostics stay bounded and shared phase handling preserves failures without compiler messages', () => {
  const value = diagnosticPlan(), line = compileMessage(generatedPath, { message: 'x'.repeat(6000) });
  const errors = adapter.diagnostics({ phase: 'cargo-check', status: 'failed', stdout: (line + '\n').repeat(300), stderr: '' }, value);
  assert.equal(errors.length, 256); assert.equal(errors[0].message.length, 4096);
  for (const status of ['failed', 'timeout', 'cancelled', 'observer-failed', 'output-limit']) {
    const errors = executionPhaseDiagnostics(adapter, { phase: 'run', status, stdout: '', stderr: '' }, value);
    assert.equal(errors.length, 1); assert.equal(errors[0].severity, 'error'); assert.equal(errors[0].sourcePath, value.scene.sourcePath);
  }
});

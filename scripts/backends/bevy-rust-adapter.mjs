// The Rust route delivers a frozen Cargo source project. Compilation is an
// adapter-owned, disposable derivation; no target directory becomes inventory.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateExecutionBackendDescriptor, checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { createSceneBehaviorEventReader } from '../../engine/scene-behavior-events.mjs';
import { buildError, buildHash, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { generateBevyRustProject, validateBevyRustPlan } from './bevy-rust-project.mjs';

const descriptor = validateExecutionBackendDescriptor({
  format: 'viento-execution-backend', schemaVersion: 1, id: 'org.viento.bevy-rust', label: 'Bevy / Rust', version: '0.2.0', platforms: ['linux'],
  plans: [{ kind: 'scene2d', schemaVersion: 3, runtimeProtocolVersion: 3 }],
  capabilities: ['scene2d', 'input.arrows', 'state.movement', 'behavior.bindings', 'behavior.rust'],
  execution: { build: true, headlessLogic: true, windowPreview: false, windowCapture: false, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [],
});
const absolute = value => typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0');
const support = request => { const diagnostics = checkExecutionBackendSupport(descriptor, request); if (diagnostics.length) throw buildError(diagnostics[0].code, diagnostics[0].message, { diagnostics }); };
async function compilerPaths(executable) {
  if (!absolute(executable)) throw buildError('build_tool_required', 'Select the absolute Cargo binary from a Rust toolchain, not a rustup proxy.');
  const cargo = await fs.realpath(executable);
  if (path.basename(cargo) !== 'cargo') throw buildError('build_tool_version', 'Select a concrete Cargo binary; rustup proxies are not pinned tools.');
  const rustc = await fs.realpath(path.join(path.dirname(cargo), 'rustc'));
  if (path.basename(rustc) !== 'rustc' || path.dirname(rustc) !== path.dirname(cargo)) throw buildError('build_tool_version', 'Cargo and rustc must belong to the same concrete toolchain directory.');
  for (const file of [cargo, rustc]) { if (!(await fs.stat(file)).isFile()) throw buildError('build_tool_unavailable', 'The Rust toolchain is unavailable.'); await fs.access(file, constants.X_OK); }
  return { cargo, rustc };
}
async function availability({ toolPath, enabled = true, platform = process.platform } = {}) {
  if (!enabled || !descriptor.platforms.includes(platform)) return { supported: false, available: false, reason: 'platform_unsupported' };
  try { await compilerPaths(toolPath); return { supported: true, available: true, reason: null }; }
  catch { return { supported: true, available: false, reason: 'tool_missing' }; }
}
const cleanEnv = paths => ({ PATH: `${path.dirname(paths.cargo)}:/usr/bin:/bin`, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
  RUSTC: paths.rustc, RUSTC_WRAPPER: '', RUSTC_WORKSPACE_WRAPPER: '', RUSTFLAGS: '', CARGO_ENCODED_RUSTFLAGS: '',
  CARGO_BUILD_JOBS: '2', CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0', CARGO_PROFILE_DEV_INCREMENTAL: 'false', CARGO_TERM_COLOR: 'never' });
async function identify(executable, { signal } = {}) {
  support({ operation: 'build', platform: process.platform });
  let paths; try { paths = await compilerPaths(executable); } catch (error) { if (error.errorCode) throw error; throw buildError('build_tool_unavailable', 'The concrete Rust toolchain is unavailable.'); }
  const [cargoBytes, rustcBytes] = await Promise.all([paths.cargo, paths.rustc].map(file => readBuildFile(file, 512 * 1024 * 1024, signal)));
  const env = cleanEnv(paths);
  const [cargo, rustc] = await Promise.all([paths.cargo, paths.rustc].map(file => runBuildProcess(file, ['--version'], { cwd: path.dirname(paths.cargo), env, signal, timeoutMs: 10000 })));
  if ([cargo, rustc].some(result => result.status === 'cancelled')) throw buildError('build_cancelled', 'Rust toolchain identification was cancelled.');
  if ([cargo, rustc].some(result => result.status === 'timeout')) throw buildError('build_tool_timeout', 'Rust toolchain identification timed out.');
  const cargoVersion = /^cargo (1\.95\.0) \([^\r\n]+\)$/.exec(cargo.stdout.trim())?.[1], rustVersion = /^rustc (1\.95\.0) \([^\r\n]+\)$/.exec(rustc.stdout.trim())?.[1];
  if ([cargo, rustc].some(result => result.status !== 'succeeded' || result.stderr.trim()) || !cargoVersion || !rustVersion) throw buildError('build_tool_version', 'This Bevy Rust route requires the pinned Cargo and rustc 1.95.0 toolchain.');
  // Rustc identity participates in the already persisted version field. The
  // executable SHA remains the actual Cargo bytes, preserving the host contract.
  const version = `cargo ${cargoVersion}; rustc ${rustVersion}; rustc-sha256:${buildHash(rustcBytes)}`;
  if (buildHash(await readBuildFile(paths.cargo, 512 * 1024 * 1024, signal)) !== buildHash(cargoBytes)
    || buildHash(await readBuildFile(paths.rustc, 512 * 1024 * 1024, signal)) !== buildHash(rustcBytes)) throw buildError('build_input_changed', 'Rust toolchain changed while being identified.');
  return { executable: paths.cargo, version, sha256: buildHash(cargoBytes), platform: process.platform, arch: process.arch };
}
async function fingerprint() {
  const files = ['scripts/backends/bevy-rust-adapter.mjs', 'scripts/backends/bevy-rust-project.mjs', 'engine/scene-behavior-events.mjs',
    'engine/scene-runtime-events.mjs', 'engine/scene-behaviors.mjs', 'engine/build-plan.mjs', 'engine/scene-model.mjs', 'engine/backend-capabilities.mjs', 'scripts/adapters/node-execution-backends.mjs'];
  const template = new URL('./bevy-rust/', import.meta.url);
  for (const name of (await fs.readdir(template, { recursive: true })).sort()) {
    const url = new URL(name, template); if ((await fs.lstat(url)).isFile()) files.push(`scripts/backends/bevy-rust/${name}`);
  }
  const identities = await Promise.all(files.map(async name => ({ path: name, sha256: buildHash(await fs.readFile(new URL(`../../${name}`, import.meta.url))) })));
  return { id: descriptor.id, contractVersion: 1, sha256: buildHash(JSON.stringify(identities)) };
}
async function executePhase({ phase, tool, directory, signal, timeoutMs = 30000, onOutput, mode = 'headlessLogic', smoke = true, capturePath, controlProgram } = {}) {
  if (!['cargo-check', 'run'].includes(phase)) throw buildError('build_execution_unsupported', 'Unsupported Bevy Rust phase.');
  if (controlProgram !== undefined || capturePath !== undefined || phase === 'run' && (mode !== 'headlessLogic' || smoke !== true)) throw buildError('build_execution_unsupported', 'Bevy Rust currently supports bounded headless behavior runs only.');
  if (!absolute(directory) || !(await fs.lstat(directory)).isDirectory() || (await fs.lstat(directory)).isSymbolicLink()) throw buildError('build_output_invalid', 'Use an owned generated Cargo project directory.');
  const current = await identify(tool?.executable, { signal });
  if (current.sha256 !== tool.sha256 || current.version !== tool.version) throw buildError('runtime_tool_changed', 'The identified Rust toolchain changed before execution.');
  const paths = await compilerPaths(current.executable), temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-bevy-rust-compile-'));
  try {
    // Cargo discovers config from its working directory. Keep it outside both
    // the author workspace and generated project, and reject ancestor config.
    for (let parent = temporary; ; parent = path.dirname(parent)) {
      for (const name of ['config', 'config.toml']) try { await fs.lstat(path.join(parent, '.cargo', name)); throw buildError('build_tool_version', 'External Cargo configuration is not allowed for this build.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (parent === path.dirname(parent)) break;
    }
    const cargoHome = path.join(temporary, 'cargo-home'), target = path.join(temporary, 'target');
    await fs.mkdir(cargoHome);
    const hostHome = process.env.CARGO_HOME && absolute(process.env.CARGO_HOME) ? process.env.CARGO_HOME : path.join(os.homedir(), '.cargo');
    try { const registry = await fs.realpath(path.join(hostHome, 'registry')); await fs.symlink(registry, path.join(cargoHome, 'registry'), 'dir'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const env = { ...cleanEnv(paths), CARGO_HOME: cargoHome, CARGO_TARGET_DIR: target, CARGO_NET_OFFLINE: 'true' };
    const args = [phase === 'cargo-check' ? 'check' : 'build', '--manifest-path', path.join(directory, 'Cargo.toml'), '--locked', '--offline', '--message-format=json'];
    const compiled = await runBuildProcess(current.executable, args, { cwd: temporary, env, signal, timeoutMs,
      onOutput: output => onOutput?.({ ...output, stream: 'stderr' }) });
    if (compiled.status !== 'succeeded') return { ...compiled, phase, compilerOutput: compiled.stdout, ...(phase === 'run' ? { stdout: '' } : {}) };
    const verified = await identify(current.executable, { signal });
    if (verified.sha256 !== current.sha256 || verified.version !== current.version) throw buildError('runtime_tool_changed', 'Rust toolchain changed during compilation.');
    if (phase === 'cargo-check') return { ...compiled, phase, compilerOutput: compiled.stdout, ...(phase === 'run' ? { stdout: '' } : {}) };
    const executable = path.join(target, 'debug/viento-bevy-behaviors');
    const stat = await fs.lstat(executable); if (!stat.isFile() || stat.isSymbolicLink()) throw buildError('build_output_invalid', 'Cargo did not produce the expected behavior executable.');
    const result = await runBuildProcess(executable, ['--scene', path.join(directory, 'scene-data.json'), '--smoke'], { cwd: temporary,
      env, signal, timeoutMs, onOutput });
    return { ...result, phase, compilation: { durationMs: compiled.durationMs, executableSha256: buildHash(await fs.readFile(executable)) } };
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
function diagnostics(result, plan) {
  const diagnostics = [];
  for (const line of (result.compilerOutput || (result.phase === 'cargo-check' ? result.stdout : '') || '').split('\n')) {
    let item; try { item = JSON.parse(line); } catch { continue; }
    const message = item?.reason === 'compiler-message' ? item.message : null;
    if (message?.level !== 'error' || diagnostics.length >= 256) continue;
    const span = (Array.isArray(message.spans) ? message.spans : []).find(span => span?.is_primary === true && plan.behaviors.sources.some(source => span.file_name === `src/behaviors/b_${source.objectId.replaceAll('-', '_')}.rs`));
    const source = span && plan.behaviors.sources.find(source => span.file_name === `src/behaviors/b_${source.objectId.replaceAll('-', '_')}.rs`);
    const entry = { severity: 'error', code: 'build_behavior_compile', message: (typeof message.message === 'string' && message.message ? message.message : 'Rust compilation failed.').slice(0, 4096),
      objectId: source?.objectId || plan.behaviors.manifest.objectId, sourcePath: source?.sourcePath || plan.behaviors.manifest.sourcePath, propertyPath: '' };
    if (source) {
      entry.sourceRevision = source.sourceRevision;
      const lines = source.content.split('\n'), line = span.line_start;
      if (Number.isInteger(line) && line >= 1 && line <= lines.length) {
        const start = lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0), end = start + lines[line - 1].replace(/\r$/, '').length;
        entry.sourceLine = line;
        if (end > start) entry.sourceRange = { start, end, encoding: 'utf-16', propertyPath: '', exact: true };
      }
    }
    diagnostics.push(entry);
  }
  return diagnostics;
}
export const BEVY_RUST_EXECUTION_ADAPTER = Object.freeze({ descriptor, contractVersion: 1, acceptsLegacyBuildRecords: false,
  buildPhases: Object.freeze(['cargo-check']), runtimePhases: Object.freeze([]), availability, identify, fingerprint, executePhase, diagnostics,
  generate: async plan => { support({ operation: 'build', plan }); return generateBevyRustProject(structuredClone(plan)); },
  createEventReader: (plan, options) => { validateBevyRustPlan(plan); return createSceneBehaviorEventReader(plan, options); },
  cleanupProject: async () => {},
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generateBevyRustProject, BEVY_RUST_BACKEND_ID } from '../backends/bevy-rust-project.mjs';
import { createSceneBehaviorEventReader } from '../../engine/scene-behavior-events.mjs';

const exec = promisify(execFile), hash = value => createHash('sha256').update(value).digest('hex');
const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v2.json', import.meta.url)));
const manifestId = '88888888-8888-4888-8888-888888888888';
const sourceId = '99999999-9999-4999-8999-999999999999';
const legacyId = '55555555-5555-4555-8555-555555555555';
const bindingId = index => `77777777-7777-4777-8777-${String(index + 1).padStart(12, '0')}`;
// Both modules are compiled once. Only validated scene parameters and binding
// order differ between cases, so failures do not require repeated Cargo builds.
const source = `use crate::runtime::{BehaviorContext, FixedStep};
fn mark(ctx: &mut BehaviorContext, tick: u64) -> Result<(), String> {
    let label = ctx.string("label")?;
    let position = ctx.position();
    ctx.emit("checkpoint", vec![label.into(), (tick as f64).into(), position[0].into(), position[1].into()])
}
pub fn ready(ctx: &mut BehaviorContext) -> Result<(), String> {
    let mode = ctx.string("mode")?;
    if mode == "none" { return Ok(()); }
    if mode == "initialize" { ctx.set_position([10.0, 20.0])?; }
    if mode == "budget" || mode == "budget_over" {
        for _ in 0..62 { ctx.emit("checkpoint", vec!["ready".into()])?; }
    }
    ctx.on_fixed_update(update)?;
    if mode == "duplicate" { let _ = ctx.on_fixed_update(update); }
    Ok(())
}
fn update(ctx: &mut BehaviorContext, step: FixedStep) -> Result<(), String> {
    let mode = ctx.string("mode")?;
    if mode == "budget" || mode == "budget_over" {
        ctx.emit("checkpoint", vec![(step.tick as f64).into()])?;
        if mode == "budget_over" && step.tick == 1 {
            let _ = ctx.emit("checkpoint", vec!["over".into()]);
        }
        return Ok(());
    }
    if mode == "late" { let _ = ctx.on_fixed_update(update); return Ok(()); }
    if mode == "set" {
        let x = ctx.number("x")?;
        let y = ctx.number("y")?;
        ctx.set_position([x, y])?;
    } else if mode == "first" && step.tick == 1 {
        return mark(ctx, step.tick);
    } else {
        let speed = ctx.number("speed")?;
        ctx.translate([speed * step.delta_seconds, 0.0])?;
    }
    mark(ctx, step.tick)?;
    if step.tick == 1 {
        match mode.as_str() {
            "error" => return Err("second fixed callback failed".into()),
            "panic" => panic!("second fixed callback panicked"),
            "nan" => { let _ = ctx.set_position([f64::NAN, 0.0]); },
            "infinity" => { let _ = ctx.translate([f64::INFINITY, 0.0]); },
            "bounds" => { let _ = ctx.set_position([100001.0, 0.0]); },
            _ => {},
        }
    }
    Ok(())
}
`;
// This deliberately uses only the API that existed before fixed callbacks.
const legacySource = `use crate::runtime::BehaviorContext;
pub fn ready(ctx: &mut BehaviorContext) -> Result<(), String> {
    if ctx.boolean("enabled")? {
        let label = ctx.string("label")?;
        ctx.emit("checkpoint", vec![label.into()])?;
    }
    Ok(())
}
`;
function plan(specs = [{ mode: 'move', speed: 8 }], { arrows = false, legacy = false } = {}) {
  const value = structuredClone(golden.plan);
  value.schemaVersion = 3; value.resources = [];
  value.requiredCapabilities = ['scene2d', 'input.arrows', 'state.movement', 'behavior.bindings', 'behavior.rust'];
  value.actors.forEach((actor, index) => {
    delete actor.imageResourceId;
    actor.position = index ? [300, 200] : [100, 50];
    actor.controls = arrows ? 'arrows' : 'none'; actor.speed = index ? 20 : 40;
  });
  const sources = [{ objectId: sourceId, sourcePath: 'documents/fixed.txt', content: source },
    { objectId: legacyId, sourcePath: 'documents/old-ready.txt', content: legacySource }]
    .map(item => ({ ...item, sourceRevision: `sha256:${hash(item.content)}`, language: 'rust' }));
  const bindings = [...specs.map((spec, index) => {
    const actor = value.actors[spec.actor || 0];
    const { actor: actorIndex, ...parameters } = spec;
    return { bindingId: bindingId(index), instanceId: actor.instanceId, objectId: actor.objectId,
      implementation: { backendId: BEVY_RUST_BACKEND_ID, language: 'rust', sourceObjectId: sourceId },
      parameters: { label: `fixed-${index}`, ...parameters }, events: [{ signal: 'checkpoint', event: 'arrived' }] };
  }), { bindingId: bindingId(specs.length), instanceId: value.actors[1].instanceId, objectId: value.actors[1].objectId,
    implementation: { backendId: BEVY_RUST_BACKEND_ID, language: 'rust', sourceObjectId: legacyId },
    parameters: { enabled: legacy, label: 'legacy' }, events: [{ signal: 'checkpoint', event: 'arrived' }] }];
  const manifest = { objectId: manifestId, sourcePath: 'documents/behaviors.json',
    sourceRevision: `sha256:${hash(JSON.stringify({ bindings: bindings.map(({ objectId, ...binding }) => binding) }))}` };
  value.behaviors = { format: 'viento-behavior-plan', schemaVersion: 1, backendId: BEVY_RUST_BACKEND_ID, language: 'rust', manifest, sources,
    bindings: bindings.map((binding, index) => ({ ...binding, declaration: { ...manifest, propertyPath: `/bindings/${index}` } })) };
  return value;
}
async function materialize(root, name, value) {
  const directory = path.join(root, name), generated = await generateBevyRustProject(value);
  for (const [file, bytes] of generated.files) {
    const destination = path.join(directory, file);
    await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, bytes);
  }
  return { directory, generated };
}
function received(value, stdout) {
  const reader = createSceneBehaviorEventReader(value);
  // Exercise actual stdout as fragmented transport, including split prefixes.
  for (let index = 0; index < stdout.length; index += 137) reader.push(stdout.slice(index, index + 137));
  return reader.finish();
}
const behaviorFrames = result => result.events.filter(event => event.event === 'behavior');
const stateFrames = result => result.events.filter(event => event.event === 'state');
const finalActors = result => result.events.at(-1).actors;
const cargo = process.env.VIENTO_BEVY_RUST_TEST_CARGO;
test('real Bevy fixed callbacks preserve ready scripts and drive bounded independent instance state', {
  skip: !cargo ? 'Set VIENTO_BEVY_RUST_TEST_CARGO for native fixed-step execution' : false,
  timeout: 300000,
}, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-bevy-fixed-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { directory } = await materialize(root, 'compiled', plan());
  const target = process.env.VIENTO_BEVY_RUST_TEST_TARGET || path.join(root, 'target');
  const compilerDirectory = path.dirname(cargo);
  const env = { ...process.env, PATH: `${compilerDirectory}:/usr/bin:/bin`, RUSTC: path.join(compilerDirectory, 'rustc'),
    RUSTC_WRAPPER: '', RUSTC_WORKSPACE_WRAPPER: '', RUSTFLAGS: '', CARGO_ENCODED_RUSTFLAGS: '', CARGO_BUILD_JOBS: '2', CARGO_INCREMENTAL: '0',
    CARGO_PROFILE_DEV_DEBUG: '0', CARGO_PROFILE_DEV_INCREMENTAL: 'false' };
  const compiled = await exec(cargo, ['build', '--locked', '--offline', '--manifest-path', path.join(directory, 'Cargo.toml'), '--target-dir', target],
    { cwd: directory, env, timeout: 240000, maxBuffer: 4 * 1024 * 1024 });
  assert.match(compiled.stderr, /Finished/);
  // Isolate the executable from another explicitly requested test sharing the
  // Cargo target. No later scenario recompiles or rewrites its source modules.
  const binary = path.join(root, 'fixed-runtime');
  await fs.copyFile(path.join(target, 'debug/viento-bevy-behaviors'), binary); await fs.chmod(binary, 0o700);
  let ordinal = 0;
  async function run(value, fail = false) {
    const { directory: relocated, generated } = await materialize(root, `case-${++ordinal}`, value);
    const args = ['--scene', path.join(relocated, 'scene-data.json'), '--smoke'];
    let processResult;
    try { processResult = { ...await exec(binary, args, { cwd: relocated, timeout: 10000, maxBuffer: 4 * 1024 * 1024 }), exitCode: 0 }; }
    catch (error) { if (!fail) throw error; processResult = { stdout: error.stdout, stderr: error.stderr, exitCode: error.code }; }
    assert.equal(processResult.exitCode === 0, !fail);
    const result = received(value, processResult.stdout);
    assert.equal(result.events[0]?.event, 'ready');
    assert.ok(!result.diagnostics.some(item => item.code === 'runtime_protocol_invalid'), JSON.stringify(result.diagnostics));
    if (!fail) { assert.deepEqual(result.diagnostics, []); assert.equal(result.events.at(-1)?.event, 'finished'); }
    else assert.ok(!result.events.some(event => event.event === 'finished'));
    for (const [file, bytes] of generated.files) assert.deepEqual(await fs.readFile(path.join(relocated, file)), bytes);
    return result;
  }
  function diagnostic(result, value, code, parameter) {
    assert.equal(result.diagnostics.length, 1);
    const actual = result.diagnostics[0], binding = value.behaviors.bindings[0];
    assert.equal(actual.code, code); assert.equal(actual.bindingId, binding.bindingId);
    assert.equal(actual.instanceId, binding.instanceId); assert.equal(actual.relatedObjectId, binding.objectId);
    assert.equal(actual.objectId, manifestId); assert.equal(actual.sourcePath, value.behaviors.manifest.sourcePath);
    assert.equal(actual.sourceRevision, value.behaviors.manifest.sourceRevision);
    assert.equal(actual.propertyPath, `/bindings/0${parameter ? `/parameters/${parameter}` : ''}`);
  }
  await t.test('ready-only sources retain legacy arrows movement and event order', async () => {
    const value = plan([{ mode: 'none' }], { arrows: true, legacy: true }), result = await run(value);
    assert.deepEqual(behaviorFrames(result).map(frame => frame.arguments), [['legacy']]);
    assert.deepEqual(finalActors(result).map(actor => actor.position), [[110, 50], [305, 200]]);
    assert.deepEqual(stateFrames(result).map(frame => [frame.instanceId, frame.state]),
      [[value.actors[0].instanceId, 'moving'], [value.actors[1].instanceId, 'moving'],
        [value.actors[0].instanceId, 'idle'], [value.actors[1].instanceId, 'idle']]);
    assert.equal(result.events.at(-1).fixedDelta, 0.25);
  });
  await t.test('fixed behavior drives its own instance without controls; same source bindings stay independent', async () => {
    const result = await run(plan([{ mode: 'move', speed: 8 }, { mode: 'move', speed: -12, actor: 1 }]));
    assert.deepEqual(finalActors(result).map(actor => actor.position), [[104, 50], [294, 200]]);
    assert.deepEqual(behaviorFrames(result).map(frame => [frame.bindingId, frame.arguments]), [
      [bindingId(0), ['fixed-0', 0, 102, 50]], [bindingId(1), ['fixed-1', 0, 297, 200]],
      [bindingId(0), ['fixed-0', 1, 104, 50]], [bindingId(1), ['fixed-1', 1, 294, 200]],
    ]);
  });
  await t.test('ready writes establish per-instance initial state before fixed callbacks', async () => {
    const result = await run(plan([{ mode: 'initialize', speed: 8 }]));
    assert.deepEqual(result.events[0].actors[0].position, [100, 50]);
    assert.deepEqual(behaviorFrames(result).map(frame => frame.arguments), [['fixed-0', 0, 12, 20], ['fixed-0', 1, 14, 20]]);
    assert.deepEqual(finalActors(result).map(actor => actor.position), [[14, 20], [300, 200]]);
  });
  await t.test('same-instance bindings observe declaration order, including absolute writes', async () => {
    const setThenMove = await run(plan([{ mode: 'set', x: 20, y: 30 }, { mode: 'move', speed: 8 }]));
    assert.deepEqual(behaviorFrames(setThenMove).map(frame => frame.arguments), [
      ['fixed-0', 0, 20, 30], ['fixed-1', 0, 22, 30], ['fixed-0', 1, 20, 30], ['fixed-1', 1, 22, 30],
    ]);
    assert.deepEqual(finalActors(setThenMove)[0].position, [22, 30]);
    const moveThenSet = await run(plan([{ mode: 'move', speed: 8 }, { mode: 'set', x: 20, y: 30 }]));
    assert.deepEqual(finalActors(moveThenSet)[0].position, [20, 30]);
  });
  await t.test('fixed movement composes with arrows and movement state follows actual displacement', async () => {
    const combined = await run(plan([{ mode: 'move', speed: 8 }], { arrows: true }));
    assert.deepEqual(finalActors(combined).map(actor => actor.position), [[114, 50], [305, 200]]);
    const stopped = await run(plan([{ mode: 'first', speed: 8 }]));
    assert.deepEqual(finalActors(stopped)[0].position, [102, 50]);
    assert.deepEqual(stateFrames(stopped).map(frame => frame.state), ['moving', 'idle']);
    const cancelled = await run(plan([{ mode: 'set', x: 100, y: 50 }], { arrows: true }));
    assert.deepEqual(finalActors(cancelled)[0].position, [100, 50]);
    assert.ok(!stateFrames(cancelled).some(frame => frame.instanceId === cancelled.events[0].actors[0].instanceId));
  });
  for (const [mode, code] of [['error', 'runtime_behavior_script'], ['panic', 'runtime_behavior_panic'],
    ['nan', 'runtime_behavior_position'], ['infinity', 'runtime_behavior_position'], ['bounds', 'runtime_behavior_position']]) {
    await t.test(`${mode} failure discards the current callback events and resolves trusted binding provenance`, async () => {
      const value = plan([{ mode, speed: 8 }]), result = await run(value, true);
      assert.deepEqual(behaviorFrames(result).map(frame => frame.arguments), [['fixed-0', 0, 102, 50]]);
      diagnostic(result, value, code);
    });
  }
  await t.test('typed parameter failure in fixed update resolves the exact parameter declaration', async () => {
    const value = plan([{ mode: 'move', speed: 'wrong-type' }]), result = await run(value, true);
    assert.deepEqual(behaviorFrames(result), []); diagnostic(result, value, 'runtime_behavior_parameter', 'speed');
  });
  for (const mode of ['duplicate', 'late']) {
    await t.test(`${mode} registration remains an error even when author code ignores the Result`, async () => {
      const value = plan([{ mode }]), result = await run(value, true);
      assert.deepEqual(behaviorFrames(result), []); diagnostic(result, value, 'runtime_behavior_lifecycle');
    });
  }
  await t.test('64-event budget spans ready and both fixed callbacks; the failing callback is atomic', async () => {
    const accepted = await run(plan([{ mode: 'budget' }]));
    assert.equal(behaviorFrames(accepted).length, 64);
    assert.deepEqual(behaviorFrames(accepted).slice(-2).map(frame => frame.arguments), [[0], [1]]);
    const value = plan([{ mode: 'budget_over' }]), failed = await run(value, true);
    assert.equal(behaviorFrames(failed).length, 63);
    assert.deepEqual(behaviorFrames(failed).at(-1).arguments, [0]);
    diagnostic(failed, value, 'runtime_behavior_signal');
  });
  await t.test('maximum binding count stays within neutral runtime frame and source budgets', async () => {
    const result = await run(plan(Array.from({ length: 31 }, (_, index) => ({ mode: 'budget', actor: index % 2 }))));
    assert.equal(behaviorFrames(result).length, 31 * 64);
    assert.equal(result.events.length, 31 * 64 + 2);
    assert.deepEqual(result.diagnostics, []);
  });
  t.diagnostic(`One offline Cargo build; ${ordinal} relocated native scenarios; source modules retained byte-for-byte.`);
});

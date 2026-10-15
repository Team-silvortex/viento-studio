import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generateBevyRustProject, validateBevyRustPlan, bevyRustSourcePath, BEVY_RUST_BACKEND_ID,
  BEVY_RUST_RUNTIME_IDENTITY, BEVY_RUST_TEMPLATE_FILES } from '../backends/bevy-rust-project.mjs';

const exec = promisify(execFile), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v2.json', import.meta.url)));
const ids = { manifest: '88888888-8888-4888-8888-888888888888', source: '99999999-9999-4999-8999-999999999999',
  second: '55555555-5555-4555-8555-555555555555', bindings: ['77777777-7777-4777-8777-777777777777', '66666666-6666-4666-8666-666666666666', '44444444-4444-4444-8444-444444444444'] };
const script = `use crate::runtime::BehaviorContext;\npub fn ready(ctx: &mut BehaviorContext) -> Result<(), String> {\n    let checkpoint = ctx.string("checkpoint")?;\n    let amount = ctx.number("amount")?;\n    if ctx.boolean("enabled")? { ctx.emit("checkpoint", vec![checkpoint.into(), amount.into()])?; }\n    Ok(())\n}\n`;
function plan(content = script) {
  const value = structuredClone(golden.plan);
  value.schemaVersion = 3; value.resources = [];
  value.actors.forEach(actor => { delete actor.imageResourceId; });
  value.requiredCapabilities = ['scene2d', 'input.arrows', 'state.movement', 'behavior.bindings', 'behavior.rust'];
  const manifest = { objectId: ids.manifest, sourcePath: 'documents/behaviors.json', sourceRevision: `sha256:${hash('{}')}` };
  value.behaviors = { format: 'viento-behavior-plan', schemaVersion: 1, backendId: BEVY_RUST_BACKEND_ID, language: 'rust', manifest,
    sources: [{ objectId: ids.source, sourcePath: 'documents/guard.txt', sourceRevision: `sha256:${hash(content)}`, language: 'rust', content }],
    bindings: value.actors.map((actor, index) => ({ bindingId: ids.bindings[index], instanceId: actor.instanceId, objectId: actor.objectId,
      implementation: { backendId: BEVY_RUST_BACKEND_ID, language: 'rust', sourceObjectId: ids.source },
      parameters: { checkpoint: index ? 'west' : 'east', amount: index ? 20 : 40, enabled: true },
      events: [{ signal: 'checkpoint', event: 'arrived' }], declaration: { ...manifest, propertyPath: `/bindings/${index}` } })) };
  return value;
}
function multiple() {
  const value = plan(), content = script.replace('amount.into()', '(amount * 2.0).into()');
  value.behaviors.sources.push({ objectId: ids.second, sourcePath: 'documents/second.txt', sourceRevision: `sha256:${hash(content)}`, language: 'rust', content });
  value.behaviors.bindings.push({ ...structuredClone(value.behaviors.bindings[0]), bindingId: ids.bindings[2],
    implementation: { backendId: BEVY_RUST_BACKEND_ID, language: 'rust', sourceObjectId: ids.second },
    parameters: { checkpoint: 'shared-instance', amount: 5, enabled: true },
    declaration: { ...value.behaviors.manifest, propertyPath: '/bindings/2' } });
  return value;
}
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-bevy-rust-project-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory;
}
async function materialize(t, value) {
  const directory = await temporary(t), generated = await generateBevyRustProject(value);
  for (const [file, bytes] of generated.files) { await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true }); await fs.writeFile(path.join(directory, file), bytes); }
  return { directory, generated };
}
const invalid = error => error.errorCode === 'build_behavior_invalid';

test('new backend delivers locked Cargo source, exact author bytes, and complete behavior provenance', async () => {
  const value = multiple(), before = structuredClone(value), generated = await generateBevyRustProject(value);
  assert.deepEqual(value, before);
  assert.equal(generated.backend.id, BEVY_RUST_BACKEND_ID); assert.equal(generated.backend.protocolVersion, 3);
  assert.deepEqual(generated.artifact, { kind: 'bevy-rust-project', entry: 'Cargo.toml', requiresTool: true });
  assert.equal(generated.resourceFiles.size, 0);
  for (const file of BEVY_RUST_TEMPLATE_FILES) assert.ok(generated.files.has(file));
  assert.match(generated.files.get('Cargo.toml').toString(), /bevy = \{ version = "=0\.19\.1", default-features = false/);
  assert.match(generated.files.get('Cargo.lock').toString(), /name = "viento-bevy-behaviors"\nversion = "0\.2\.0"/);
  assert.doesNotMatch(generated.files.get('Cargo.lock').toString(), /name = "viento-bevy-runtime"/);
  assert.match(generated.files.get('src/runtime.rs').toString(), /App::new\(\)/);
  for (const source of value.behaviors.sources) {
    assert.deepEqual(generated.files.get(bevyRustSourcePath(source.objectId)), Buffer.from(source.content));
    assert.match(generated.files.get('src/behavior_sources.rs').toString(), new RegExp(source.sourceRevision.slice(7)));
  }
  assert.equal(generated.sourceMap.behaviors.length, 3);
  assert.deepEqual(generated.sourceMap.behaviors[2].declaration, value.behaviors.bindings[2].declaration);
  const dto = JSON.parse(generated.files.get('scene-data.json'));
  assert.equal(dto.sources.length, 2); assert.equal(dto.bindings.length, 3);
  assert.equal(dto.bindings[2].instanceId, dto.bindings[0].instanceId);
  assert.ok(!JSON.stringify(dto).includes('documents/'));
  assert.ok([...generated.files.keys()].every(file => !file.includes('target') && !path.isAbsolute(file)));
});

test('generated source copies preserve CRLF and Unicode without injecting author names into Rust dispatch', async () => {
  const content = script.replaceAll('\n', '\r\n') + '// 日本語 🌬️\r\n', value = plan(content);
  value.behaviors.sources[0].sourcePath = 'documents/script "quoted" $name.txt';
  const generated = await generateBevyRustProject(value);
  assert.deepEqual(generated.files.get(bevyRustSourcePath(ids.source)), Buffer.from(content));
  assert.ok(!generated.files.get('src/behavior_sources.rs').toString().includes(value.behaviors.sources[0].sourcePath));
});

test('Rust generator strictly refuses unsupported plans, media, languages, and backends', async () => {
  for (const mutate of [v => v.schemaVersion = 2, v => v.kind = 'scene3d', v => v.behaviors.backendId = 'org.viento.bevy',
    v => v.behaviors.language = 'gdscript', v => v.behaviors.bindings[0].implementation.language = 'gdscript',
    v => v.behaviors.bindings[0].implementation.backendId = 'org.viento.godot4']) {
    const value = plan(); mutate(value); await assert.rejects(generateBevyRustProject(value), invalid);
  }
  for (const mutate of [v => v.resources.push({}), v => v.actors[0].imageResourceId = ids.source]) {
    const value = plan(); mutate(value); value.requiredCapabilities = [];
    await assert.rejects(generateBevyRustProject(value), { errorCode: 'build_capability_missing' });
  }
});

test('source bytes, paths, identities, used-source inventory and declaration revisions are checked before generation', async () => {
  for (const mutate of [v => v.behaviors.sources[0].sourceRevision = `sha256:${'0'.repeat(64)}`,
    v => v.behaviors.sources[0].sourcePath = '../../outside.txt', v => v.behaviors.sources[0].sourcePath = '/etc/passwd.txt',
    v => v.behaviors.sources[0].sourcePath = 'documents/source.rs', v => v.behaviors.sources[0].language = 'gdscript',
    v => v.behaviors.sources.push({ ...v.behaviors.sources[0] }), v => v.behaviors.bindings[0].instanceId = ids.source,
    v => v.behaviors.bindings[0].objectId = ids.source, v => v.behaviors.bindings[0].declaration.sourcePath = 'other.json',
    v => v.behaviors.bindings[0].declaration.propertyPath = '/bindings/1', v => v.behaviors.bindings[1].bindingId = ids.bindings[0],
    v => v.actors[1].instanceId = v.actors[0].instanceId,
    v => v.behaviors.sources.push({ ...v.behaviors.sources[0], objectId: ids.second })]) {
    const value = plan(); mutate(value); await assert.rejects(generateBevyRustProject(value), invalid);
  }
  for (const content of ['', 'x'.repeat(65537), '\ud800']) await assert.rejects(generateBevyRustProject(plan(content)), invalid);
  assert.throws(() => bevyRustSourcePath('../escape'), invalid);
});

test('parameters, signal budgets and scene geometry retain existing neutral limits', async () => {
  for (const mutate of [v => v.behaviors.bindings[0].parameters.amount = null, v => v.behaviors.bindings[0].parameters.amount = 9007199254740992,
    v => v.behaviors.bindings[0].parameters.checkpoint = 'x'.repeat(4097), v => v.behaviors.bindings[0].events.push({ signal: 'checkpoint', event: 'twice' }),
    v => v.behaviors.bindings[0].events[0].signal = '1bad', v => v.scene.viewport = [63, 480],
    v => v.actors[0].position = [Infinity, 0], v => v.actors[0].speed = -1, v => v.actors[0].controls = 'keyboard']) {
    const value = plan(); mutate(value); assert.throws(() => validateBevyRustPlan(value), invalid);
  }
});

test('generation detaches inputs before asynchronous template reads', async () => {
  const value = plan(), task = generateBevyRustProject(value);
  value.behaviors.sources[0].content = 'mutated'; value.behaviors.bindings[0].parameters.amount = 200;
  const generated = await task;
  assert.deepEqual(generated.files.get(bevyRustSourcePath(ids.source)), Buffer.from(script));
  assert.equal(JSON.parse(generated.files.get('scene-data.json')).bindings[0].parameters.amount, 40);
});

test('two generations are byte-stable and source edits change copies while preserving fixed backend identity', async () => {
  const first = await generateBevyRustProject(plan()), same = await generateBevyRustProject(plan()), changed = await generateBevyRustProject(plan(script + '// changed\n'));
  assert.deepEqual(first, same); assert.equal(first.backend.sha256, changed.backend.sha256);
  assert.notDeepEqual(first.files.get(bevyRustSourcePath(ids.source)), changed.files.get(bevyRustSourcePath(ids.source)));
  assert.notDeepEqual(first.files.get('src/behavior_sources.rs'), changed.files.get('src/behavior_sources.rs'));
});

const cargo = process.env.VIENTO_BEVY_RUST_TEST_CARGO;
test('real offline Cargo build runs independent ECS bindings and exact author Rust after relocation', {
  skip: !cargo ? 'Set VIENTO_BEVY_RUST_TEST_CARGO for native Rust behavior execution' : false, timeout: 300000,
}, async t => {
  const value = multiple(), { directory, generated } = await materialize(t, value);
  const target = process.env.VIENTO_BEVY_RUST_TEST_TARGET || path.join(directory, 'target');
  const result = await exec(cargo, ['build', '--locked', '--offline', '--manifest-path', path.join(directory, 'Cargo.toml'), '--target-dir', target], { cwd: directory, timeout: 240000, maxBuffer: 4 * 1024 * 1024 });
  assert.ok(result.stderr.includes('Finished'));
  const binary = path.join(target, 'debug/viento-bevy-behaviors');
  assert.equal((await exec(binary, ['--version'])).stdout.trim(), BEVY_RUST_RUNTIME_IDENTITY);
  const relocation = await temporary(t);
  for (const [file, bytes] of generated.files) { await fs.mkdir(path.dirname(path.join(relocation, file)), { recursive: true }); await fs.writeFile(path.join(relocation, file), bytes); }
  await exec(binary, ['--scene', path.join(relocation, 'scene-data.json'), '--check']);
  const { stdout } = await exec(binary, ['--scene', path.join(relocation, 'scene-data.json'), '--smoke']);
  const frames = stdout.trim().split('\n').map(line => JSON.parse(line.slice('VIENTO_RUNTIME:'.length)));
  assert.ok(frames.every(frame => frame.protocol === 3)); assert.equal(frames[0].event, 'ready'); assert.equal(frames.at(-1).event, 'finished');
  assert.deepEqual(frames.filter(frame => frame.event === 'behavior').map(frame => [frame.bindingId, frame.arguments]),
    [[ids.bindings[0], ['east', 40]], [ids.bindings[1], ['west', 20]], [ids.bindings[2], ['shared-instance', 10]]]);
  assert.equal(frames.at(-1).actors[0].position[0], value.actors[0].position[0] + value.actors[0].speed * 0.25);
  for (const [file, bytes] of generated.files) assert.deepEqual(await fs.readFile(path.join(relocation, file)), bytes);
  const dto = JSON.parse(generated.files.get('scene-data.json'));
  dto.bindings[0].parameters.amount = 'invalid'; await fs.writeFile(path.join(relocation, 'scene-data.json'), JSON.stringify(dto));
  await assert.rejects(exec(binary, ['--scene', path.join(relocation, 'scene-data.json'), '--smoke']), error => {
    const diagnostic = error.stdout.split('\n').filter(line => line.startsWith('VIENTO_RUNTIME:')).map(line => JSON.parse(line.slice(15))).find(frame => frame.event === 'diagnostic');
    return diagnostic?.code === 'runtime_behavior_parameter' && diagnostic.parameter === 'amount' && diagnostic.bindingId === ids.bindings[0];
  });
  await fs.writeFile(path.join(relocation, 'scene-data.json'), generated.files.get('scene-data.json'));
  await fs.appendFile(path.join(relocation, bevyRustSourcePath(ids.source)), '// drift\n');
  await assert.rejects(exec(binary, ['--scene', path.join(relocation, 'scene-data.json'), '--smoke']), error => error.stderr.includes('integrity mismatch'));
});

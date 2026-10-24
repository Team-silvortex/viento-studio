import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { captureSceneAnimationPreview } from '../../engine/scene-animation-preview.mjs';
import { createSceneAnimationInstancePlayback, SCENE_ANIMATION_INSTANCE_PLAYBACK_LIMITS } from '../../engine/scene-animation-instance-playback.mjs';
import { sampleSceneAnimationClip } from '../../engine/scene-animation-core.mjs';

const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const rev = char => `sha256:${char.repeat(64)}`;
const A = id(3), B = id(4), short = id(50), loop = id(51), final = id(52);
const invalid = { errorCode: 'scene_animation_instance_playback_invalid' };
function fixture({ version = 3, looping = false, count = 2, sprite = false } = {}) {
  const ids = Array.from({ length: count }, (_, index) => id(index + 3));
  const scene = { objectId: id(1), sourcePath: 'documents/scenes/shared.json', sourceRevision: rev('a') };
  const manifest = { objectId: id(2), sourcePath: 'documents/animations/shared.json', sourceRevision: rev('b') };
  const document = { format: 'viento-scene-animation', schemaVersion: version, sceneObjectId: id(1), durationSeconds: 4, loop: looping,
    tracks: ids.map((instanceId, index) => ({ id: id(100 + index), instanceId, property: 'offset2d', interpolation: 'linear',
      keyframes: [{ atSeconds: 0, value: [0, 0] }, { atSeconds: 4, value: [40 * (index + 1), 20] }] })),
    ...(version === 3 ? { clips: [{ id: short, name: 'Short', startSeconds: 0, endSeconds: 1, loop: false },
      { id: loop, name: 'Loop', startSeconds: 1, endSeconds: 3, loop: true },
      { id: final, name: 'Final', startSeconds: 2, endSeconds: 4, loop: false }] } : {}) };
  if (sprite) document.tracks.push(...ids.map((instanceId, index) => ({ id: id(200 + index), instanceId, property: 'spriteFrame2d', interpolation: 'step',
    grid: { columns: 2, rows: 2 }, keyframes: [{ atSeconds: 0, value: 0 }, { atSeconds: 1, value: 1 }, { atSeconds: 2, value: 2 }, { atSeconds: 4, value: 3 }] })));
  const preview = { ok: true, format: 'viento-scene-preview', schemaVersion: 2, snapshotId: rev('c'), scene,
    actors: ids.map(instanceId => ({ instanceId, objectId: id(90), ...(sprite ? { imageResourceId: id(91) } : {}) })),
    resources: sprite ? [{ id: id(91) }] : [],
    animationPreview: { format: 'viento-scene-animation-preview', schemaVersion: 1, status: 'ready', snapshotId: rev('c'), scene, manifest, document, diagnostics: [] } };
  return { document, preview, catalog: captureSceneAnimationPreview(preview) };
}
const row = (session, instanceId = A) => session.snapshot().instances.find(value => value.instanceId === instanceId);
const select = (session, instanceId, clipId, time = session.snapshot().timeSeconds) => session.command(instanceId, { action: 'select', clipId }, time);
const play = (session, instanceId, time = session.snapshot().timeSeconds) => session.command(instanceId, { action: 'play' }, time);

 test('saved catalog produces independent stopped targets with complete source identity and frozen samples', () => {
  const f = fixture(), before = structuredClone(f.preview), session = createSceneAnimationInstancePlayback(f.catalog), snapshot = session.snapshot();
  assert.deepEqual(SCENE_ANIMATION_INSTANCE_PLAYBACK_LIMITS, { instances: 32, timeSeconds: 86400 });
  assert.ok(Object.isFrozen(session)); assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot.instances));
  assert.deepEqual(snapshot.scene, f.catalog.scene); assert.deepEqual(snapshot.manifest, f.catalog.manifest); assert.equal(snapshot.snapshotId, f.catalog.snapshotId);
  assert.equal(snapshot.timeSeconds, 0); assert.deepEqual(snapshot.instances, [A, B].map(instanceId => ({ instanceId, clipId: null, phase: 'stopped', positionSeconds: 0, active: false, sample: null })));
  session.advance(30); assert.equal(row(session).phase, 'stopped'); assert.equal(row(session).sample, null);
  play(session, A); assert.equal(row(session).positionSeconds, 0); assert.equal(row(session, B).active, false);
  assert.ok(Object.isFrozen(row(session).sample.values[0].value)); assert.deepEqual(f.preview, before);
});

test('same definition instances choose different clips and advance pause finish independently', () => {
  const session = createSceneAnimationInstancePlayback(fixture().catalog);
  select(session, A, loop); play(session, A); session.advance(.5);
  select(session, B, short); play(session, B); session.advance(1);
  assert.equal(row(session).positionSeconds, 1); assert.equal(row(session, B).positionSeconds, .5);
  assert.deepEqual(row(session).sample.values[0].value, [20, 10]);
  assert.deepEqual(row(session, B).sample.values[0].value, [10, 2.5]);
  session.command(A, { action: 'pause' }, 1); session.advance(1.5);
  assert.equal(row(session).phase, 'paused'); assert.equal(row(session).positionSeconds, 1);
  assert.equal(row(session, B).phase, 'finished'); assert.equal(row(session, B).positionSeconds, 1);
  assert.equal(row(session).sample.finished, false); assert.equal(row(session, B).sample.finished, true);
  session.command(A, { action: 'stop' }, 1.5);
  assert.equal(row(session).active, false); assert.equal(row(session).sample, null); assert.equal(row(session).clipId, loop);
  assert.equal(row(session, B).active, true); assert.equal(row(session, B).phase, 'finished');
});

test('whole-animation playback starts at the explicit command time rather than auto-playing siblings', () => {
  const session = createSceneAnimationInstancePlayback(fixture().catalog);
  play(session, A, 10); session.advance(11); play(session, B, 11); session.advance(12);
  assert.equal(row(session).positionSeconds, 2); assert.equal(row(session, B).positionSeconds, 1);
  assert.equal(row(session).sample.localTimeSeconds, 2); assert.equal(row(session, B).sample.localTimeSeconds, 1);
  assert.equal(row(session).clipId, null); assert.equal(row(session, B).clipId, null);
});

test('natural finish retains final frame and replay starts only the chosen instance again', () => {
  const session = createSceneAnimationInstancePlayback(fixture({ looping: true }).catalog);
  select(session, A, final); play(session, A); select(session, B, short); play(session, B);
  session.advance(2); assert.equal(row(session).phase, 'finished'); assert.deepEqual(row(session).sample.values[0].value, [40, 20]);
  const completedB = row(session, B); play(session, A, 2);
  assert.equal(row(session).phase, 'playing'); assert.equal(row(session).positionSeconds, 0);
  assert.deepEqual(row(session).sample.values[0].value, [20, 10]); assert.deepEqual(row(session, B), completedB);
  session.advance(3); assert.equal(row(session).positionSeconds, 1); assert.equal(row(session, B).positionSeconds, 1);
});

test('looping is per selected range and same-clip reselect resets only its own head', () => {
  const session = createSceneAnimationInstancePlayback(fixture().catalog);
  select(session, A, loop); play(session, A); select(session, B, final); play(session, B); session.advance(2.5);
  assert.equal(row(session).phase, 'playing'); assert.equal(row(session).positionSeconds, .5); assert.equal(row(session).sample.finished, false);
  assert.equal(row(session, B).phase, 'finished'); const other = row(session, B);
  select(session, A, loop); assert.equal(row(session).phase, 'paused'); assert.equal(row(session).positionSeconds, 0); assert.deepEqual(row(session, B), other);
  session.command(A, { action: 'seek', positionSeconds: 2 }, 2.5); assert.equal(row(session).positionSeconds, 0);
  session.command(B, { action: 'seek', positionSeconds: 2 }, 2.5); assert.equal(row(session, B).phase, 'paused'); assert.equal(row(session, B).sample.finished, true);
});

test('pauseAll preserves active frames and stopAll restores static targets without losing clip choices', () => {
  const session = createSceneAnimationInstancePlayback(fixture().catalog);
  select(session, A, loop); play(session, A); session.commandAll({ action: 'pause' }, .75);
  assert.equal(row(session).positionSeconds, .75); assert.equal(row(session).phase, 'paused'); assert.equal(row(session, B).active, false);
  const held = row(session).sample; session.advance(100); assert.deepEqual(row(session).sample, held);
  select(session, B, final); play(session, B); session.commandAll({ action: 'stop' }, 100.5);
  assert.deepEqual(session.snapshot().instances.map(value => [value.clipId, value.phase, value.active, value.sample]), [[loop, 'stopped', false, null], [final, 'stopped', false, null]]);
  play(session, A, 101); assert.equal(row(session).clipId, loop); assert.equal(row(session).positionSeconds, 0); assert.equal(row(session, B).active, false);
});

for (const version of [1, 2]) test(`schema ${version} keeps whole-animation null selection and rejects named clips`, () => {
  const session = createSceneAnimationInstancePlayback(fixture({ version, sprite: version === 2 }).catalog);
  play(session, A); session.advance(1.5); select(session, A, null);
  assert.equal(row(session).phase, 'paused'); assert.equal(row(session).positionSeconds, 0); assert.equal(row(session).clipId, null);
  assert.equal(row(session, B).active, false);
  const previous = session.snapshot(); assert.throws(() => select(session, B, short, 2), invalid); assert.equal(session.snapshot(), previous);
  if (version === 2) {
    session.command(A, { action: 'seek', positionSeconds: 2 }, 2);
    assert.deepEqual(row(session).sample.values.find(value => value.property === 'spriteFrame2d'), { trackId: id(200), instanceId: A, property: 'spriteFrame2d', value: 2, grid: { columns: 2, rows: 2 } });
  }
});

test('each output is the unmodified Rust sample of exactly that target including sprite grid and distinct local times', () => {
  const f = fixture({ sprite: true }), session = createSceneAnimationInstancePlayback(f.catalog);
  select(session, A, final); session.command(A, { action: 'seek', positionSeconds: .25 }, 0);
  select(session, B, short); session.command(B, { action: 'seek', positionSeconds: .75 }, 0);
  for (const value of session.snapshot().instances) {
    assert.ok(value.sample.values.every(track => track.instanceId === value.instanceId));
    const scoped = { ...f.catalog.document, tracks: f.catalog.document.tracks.filter(track => track.instanceId === value.instanceId) };
    assert.deepEqual(value.sample, sampleSceneAnimationClip(scoped, value.clipId, value.positionSeconds));
  }
  assert.equal(row(session).sample.localTimeSeconds, .25); assert.equal(row(session, B).sample.localTimeSeconds, .75);
});

test('invalid target command and timeline operations leave all targets and the committed clock untouched', () => {
  const session = createSceneAnimationInstancePlayback(fixture().catalog); select(session, A, loop); play(session, A); select(session, B, short); play(session, B); session.advance(.5);
  for (const attempt of [() => session.command(id(999), { action: 'pause' }, 1), () => select(session, B, id(999), 1),
    () => session.command(B, { action: 'seek', positionSeconds: 1.5 }, 1), () => session.commandAll({ action: 'play' }, 1),
    ...[-1, .49, NaN, Infinity, 86400.01, '1', undefined, null].map(time => () => session.advance(time)),
    () => session.command(A, { action: 'stop', extra: true }, 1)]) {
    const previous = session.snapshot(); assert.throws(attempt, invalid); assert.equal(session.snapshot(), previous);
  }
  session.advance(.75); assert.equal(row(session).positionSeconds, .75); assert.equal(row(session, B).positionSeconds, .75);
});

test('commands reject accessors custom prototypes and nonexact input without executing caller code', () => {
  const session = createSceneAnimationInstancePlayback(fixture().catalog); let calls = 0;
  const get = () => { calls++; return 'play'; };
  const inputs = [null, [], Object.create({ action: 'play' }), { action: 'play', toJSON: get }, { action: 'play', [Symbol('extra')]: true },
    { get action() { return get(); } }, { action: 'select', get clipId() { return get(); } }, { action: 'seek', get positionSeconds() { return get(); } },
    { action: 'select' }, { action: 'select', clipId: undefined }, { action: 'seek', positionSeconds: '1' }, { action: 'seek', positionSeconds: NaN }];
  for (const input of inputs) { const previous = session.snapshot(); assert.throws(() => session.command(A, input, 1), invalid); assert.equal(session.snapshot(), previous); }
  assert.equal(calls, 0); session.command(A, Object.assign(Object.create(null), { action: 'play' }), 0); assert.equal(row(session).phase, 'playing');
});

test('catalog admission uses brand before fields and rejects unavailable saved attachments and cross-source identity', () => {
  const f = fixture(); let calls = 0;
  for (const value of [null, f.preview, structuredClone(f.catalog), { get status() { calls++; return 'ready'; } }])
    assert.throws(() => createSceneAnimationInstancePlayback(value), invalid);
  assert.equal(calls, 0);
  const none = structuredClone(f.preview); Object.assign(none.animationPreview, { status: 'none', manifest: null, document: null });
  assert.throws(() => createSceneAnimationInstancePlayback(captureSceneAnimationPreview(none)), invalid);
  for (const mutate of [value => value.animationPreview.snapshotId = rev('d'), value => value.animationPreview.scene = { ...value.scene, sourceRevision: rev('d') },
    value => value.animationPreview.document.sceneObjectId = id(999), value => value.animationPreview.document.tracks[0].instanceId = id(999)]) {
    const value = structuredClone(f.preview); mutate(value); assert.throws(() => captureSceneAnimationPreview(value), { errorCode: 'scene_animation_preview_invalid' });
  }
});

test('captured source is detached and independent sessions cannot share positions samples or revised identities', () => {
  const f = fixture(), first = createSceneAnimationInstancePlayback(f.catalog), original = JSON.stringify(f.catalog);
  f.preview.animationPreview.document.tracks[0].keyframes[1].value[0] = 80;
  f.preview.animationPreview.manifest.sourceRevision = rev('d'); f.preview.animationPreview.snapshotId = rev('e'); f.preview.snapshotId = rev('e');
  const second = createSceneAnimationInstancePlayback(captureSceneAnimationPreview(f.preview));
  play(first, A); first.advance(1); assert.deepEqual(row(first).sample.values[0].value, [10, 5]); assert.equal(row(second).active, false);
  play(second, A); second.advance(1); assert.deepEqual(row(second).sample.values[0].value, [20, 5]);
  assert.equal(first.snapshot().manifest.sourceRevision, rev('b')); assert.equal(second.snapshot().manifest.sourceRevision, rev('d')); assert.equal(JSON.stringify(f.catalog), original);
  assert.throws(() => { row(first).sample.values[0].value[0] = 200; }, TypeError); assert.throws(() => { first.snapshot().instances.push({}); }, TypeError);
});

test('32 target boundary and 24 hour clock remain bounded with inactive targets and explicit replay', () => {
  const session = createSceneAnimationInstancePlayback(fixture({ count: 32 }).catalog);
  assert.equal(session.snapshot().instances.length, 32); play(session, A); session.advance(86400);
  assert.equal(row(session).phase, 'finished'); assert.equal(session.snapshot().instances.filter(value => value.active).length, 1);
  play(session, A, 86400); assert.equal(row(session).positionSeconds, 0);
  const previous = session.snapshot(); assert.throws(() => session.advance(86400.0001), invalid); assert.equal(session.snapshot(), previous);
  assert.throws(() => fixture({ count: 33 }), { errorCode: 'scene_animation_preview_invalid' });
});

for (const mode of ['second-sample-failure', 'capability-revoked']) test(`${mode} has no partial state commit or JavaScript fallback`, () => {
  const preview = fixture().preview;
  const source = `import assert from 'node:assert/strict'; import fs from 'node:fs/promises';
    import { initializeStudioCore } from ${JSON.stringify(new URL('../../engine/studio-core.mjs', import.meta.url).href)};
    import { captureSceneAnimationPreview } from ${JSON.stringify(new URL('../../engine/scene-animation-preview.mjs', import.meta.url).href)};
    import { createSceneAnimationInstancePlayback } from ${JSON.stringify(new URL('../../engine/scene-animation-instance-playback.mjs', import.meta.url).href)};
    const bytes=await fs.readFile(${JSON.stringify(new URL('../../engine/studio-core.wasm', import.meta.url).pathname)});
    const {instance:{exports:real}}=await WebAssembly.instantiate(bytes,{}); const original=WebAssembly.instantiate;
    let armed=false, pointer=0, length=0; const decode=new TextDecoder();
    WebAssembly.instantiate=async()=>({instance:{exports:{...real,
      viento_core_scene_animation_clips_version:()=>armed&&${JSON.stringify(mode)}==='capability-revoked'?0:1,
      viento_core_input:n=>{length=n;pointer=real.viento_core_input(n);return pointer;},
      viento_core_run:()=>{const request=JSON.parse(decode.decode(new Uint8Array(real.memory.buffer,pointer,length)));
        if(armed&&request.operation==='sceneAnimation.sampleClip'&&request.document.tracks[0].instanceId===${JSON.stringify(B)})throw Error('sample unavailable');
        return real.viento_core_run();}}}});
    try{await initializeStudioCore(()=>bytes);}finally{WebAssembly.instantiate=original;}
    const session=createSceneAnimationInstancePlayback(captureSceneAnimationPreview(${JSON.stringify(preview)}));
    session.command(${JSON.stringify(A)},{action:'play'},0); session.command(${JSON.stringify(B)},{action:'play'},0);
    const before=session.snapshot(); armed=true;
    assert.throws(()=>session.advance(1),{errorCode:'studio_core_unavailable'}); assert.equal(session.snapshot(),before);
    assert.equal(before.instances[0].positionSeconds,0); assert.equal(before.instances[1].positionSeconds,0);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.stdout); assert.equal(result.signal, null);
});

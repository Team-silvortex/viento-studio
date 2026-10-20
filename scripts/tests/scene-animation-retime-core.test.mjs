import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { inspectSceneAnimation, retimeSceneAnimation, sampleSceneAnimation, sampleSceneAnimationClip } from '../../engine/scene-animation-core.mjs';
import { supportsStudioCoreSceneAnimationRetime, dispatchStudioCoreSceneAnimation, getStudioCoreMetadata } from '../../engine/studio-core.mjs';

const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const document = (version = 3) => ({ format: 'viento-scene-animation', schemaVersion: version, sceneObjectId: id(1), durationSeconds: 2, loop: true,
  tracks: [{ id: id(2), instanceId: id(3), property: 'opacity', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: 0 }, { atSeconds: .5, value: .7 }, { atSeconds: 2, value: 1 }] },
    ...(version >= 2 ? [{ id: id(6), instanceId: id(3), property: 'spriteFrame2d', interpolation: 'step', grid: { columns: 4, rows: 2 }, keyframes: [{ atSeconds: 0, value: 0 }, { atSeconds: 1, value: 3 }, { atSeconds: 2, value: 7 }] }] : [])],
  ...(version === 3 ? { clips: [{ id: id(4), name: '攻撃 Attack', startSeconds: 1, endSeconds: 2, loop: false }, { id: id(5), name: '待機 🎬', startSeconds: .25, endSeconds: .5, loop: true }] } : {}) });
const request = (doc = document(), durationSeconds = 4) => ({ protocolVersion: 1, operation: 'sceneAnimation.retime', document: doc, durationSeconds });
const { instance: { exports: core } } = await WebAssembly.instantiate(await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url)), {});
const encode = new TextEncoder(), decode = new TextDecoder('utf-8', { fatal: true });
function wasm(input) {
  const bytes = encode.encode(typeof input === 'string' ? input : JSON.stringify(input)), at = core.viento_core_input(bytes.length) >>> 0;
  new Uint8Array(core.memory.buffer, at, bytes.length).set(bytes); const out = core.viento_core_run() >>> 0;
  return JSON.parse(decode.decode(new Uint8Array(core.memory.buffer, out, core.viento_core_output_len())));
}
let bridgeIndex = 0;
async function bridge(transform, { retime = 1, sprites = 1, clips = 1 } = {}) {
  const module = await import(`../../engine/studio-core.mjs?retime-forgery=${++bridgeIndex}`), memory = new WebAssembly.Memory({ initial: 40 }), original = WebAssembly.instantiate;
  let inputLength = 0, outputLength = 0, calls = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      viento_core_scene_animation_version: () => 1, viento_core_scene_animation_transport_version: () => 1,
      ...(sprites === null ? {} : { viento_core_scene_animation_sprite_version: () => sprites }),
      ...(clips === null ? {} : { viento_core_scene_animation_clips_version: () => clips }),
      ...(retime === null ? {} : { viento_core_scene_animation_retime_version: () => retime }),
      viento_core_input: length => { inputLength = length; return 8; }, viento_core_output_len: () => outputLength,
      viento_core_run: () => { calls++; const incoming = JSON.parse(decode.decode(new Uint8Array(memory.buffer, 8, inputLength))), result = wasm(incoming);
        const output = encode.encode(JSON.stringify(transform ? transform(result, incoming) : result)); outputLength = output.length;
        new Uint8Array(memory.buffer, 1048576, outputLength).set(output); return 1048576; },
    } } });
    await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = original; }
  return { module, calls: () => calls };
}
const times = doc => [...new Set([0, doc.durationSeconds, ...doc.tracks.flatMap(track => track.keyframes.map(key => key.atSeconds)), ...(doc.clips || []).flatMap(clip => [clip.startSeconds,clip.endSeconds])])].sort((a,b) => a-b);
const unchangedParts = doc => { const copy = structuredClone(doc); delete copy.durationSeconds; for (const track of copy.tracks) for (const key of track.keyframes) delete key.atSeconds;
  for (const clip of copy.clips || []) { delete clip.startSeconds; delete clip.endSeconds; } return copy; };


test('optional retime returns detached deeply frozen documents and preserves each author format and list order', () => {
  assert.equal(core.viento_core_protocol_version(), 1); assert.equal(core.viento_core_scene_animation_retime_version(), 1);
  assert.equal(supportsStudioCoreSceneAnimationRetime(), true);
  for (const version of [1,2,3]) for (const duration of [.25,1,4,60]) {
    const source = document(version), before = structuredClone(source), result = retimeSceneAnimation(source, duration);
    assert.deepEqual(Object.keys(result), ['document']); assert.deepEqual(source, before);
    assert.equal(result.document.durationSeconds, duration); assert.equal(result.document.schemaVersion, version);
    assert.deepEqual(unchangedParts(result.document), unchangedParts(source));
    assert.deepEqual(times(result.document), times(source).map(time => time * (duration / source.durationSeconds)));
    assert.equal(Object.hasOwn(result.document, 'clips'), version === 3);
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.document.tracks[0].keyframes[0]));
    if (version === 3) assert.ok(Object.isFrozen(result.document.clips[0]));
    source.tracks[0].keyframes[0].value = .3; assert.equal(result.document.tracks[0].keyframes[0].value, 0);
    assert.deepEqual(inspectSceneAnimation(result.document).document, result.document);
  }
});

test('retimed curves and sprite steps preserve sampling at corresponding whole and named-clip positions', () => {
  const source = document();
  source.tracks.push(...[['offset2d',[0,10],[20,-10]],['rotation2d',-720,720],['scale2d',[.1,1],[2,3]]].map(([property,a,b], index) => ({
    id: id(10 + index), instanceId: id(3), property, interpolation: 'linear', keyframes: [{ atSeconds: 0, value: a }, { atSeconds: 2, value: b }],
  })));
  for (const loop of [true,false]) for (const duration of [1,4]) {
    source.loop = loop; const retimed = retimeSceneAnimation(source, duration).document, factor = duration / 2;
    for (const time of [0,.125,.25,.5,1,1.5,2,4]) {
      const original = sampleSceneAnimation(source, time), scaled = sampleSceneAnimation(retimed, time * factor);
      assert.deepEqual(scaled.values, original.values); assert.equal(scaled.finished, original.finished);
      assert.equal(scaled.localTimeSeconds, original.localTimeSeconds * factor);
    }
    for (const clip of source.clips) for (const time of [0,.125,.25,.5,1,2]) {
      const original = sampleSceneAnimationClip(source, clip.id, time), scaled = sampleSceneAnimationClip(retimed, clip.id, time * factor);
      assert.deepEqual(scaled.values, original.values); assert.equal(scaled.finished, original.finished);
      assert.equal(scaled.localTimeSeconds, original.localTimeSeconds * factor);
    }
  }
});

test('same-duration requests preserve even subnormal times and empty clip catalogs without arithmetic drift', () => {
  const source = document(1); source.durationSeconds = 60; source.tracks[0].keyframes[1].atSeconds = Number.MIN_VALUE;
  const copy = retimeSceneAnimation(source, 60).document;
  assert.deepEqual(copy, source); assert.notEqual(copy, source);
  const empty = document(); empty.clips = [];
  assert.deepEqual(retimeSceneAnimation(empty, 2).document, empty);
  const odd = document(1); odd.durationSeconds = 3; odd.tracks[0].keyframes[1].atSeconds = .1;
  assert.deepEqual(retimeSceneAnimation(odd, 3).document, odd);
});

const extremeDocuments = () => {
  const normal = document(1); normal.durationSeconds = 30; normal.tracks[0].keyframes[1].atSeconds = Number.MIN_VALUE; normal.tracks[0].keyframes[2].atSeconds = 30;
  const overflow = document(1); overflow.durationSeconds = Number.MIN_VALUE * 4; overflow.tracks[0].keyframes[1].atSeconds = Number.MIN_VALUE; overflow.tracks[0].keyframes[2].atSeconds = overflow.durationSeconds;
  const subnormal = document(1); subnormal.tracks[0].keyframes[1].atSeconds = 1;
  const zeroRatio = document(1); zeroRatio.durationSeconds = 60; zeroRatio.tracks[0].keyframes = [{ atSeconds: 0, value: 0 }, { atSeconds: 60, value: 1 }];
  return [[normal,29,Number.MIN_VALUE],[overflow,60,15],[subnormal,Number.MIN_VALUE * 4,Number.MIN_VALUE * 2],[zeroRatio,Number.MIN_VALUE,Number.MIN_VALUE]];
};
test('normal factors avoid premature underflow while normalized fallbacks handle overflowing subnormal and zero ratios', () => {
  for (const [source,duration,interior] of extremeDocuments()) {
    const result = retimeSceneAnimation(source, duration).document;
    assert.equal(result.tracks[0].keyframes[0].atSeconds, 0);
    assert.equal(result.tracks[0].keyframes[1].atSeconds, interior);
    assert.equal(result.tracks[0].keyframes.at(-1).atSeconds, duration);
    assert.deepEqual(unchangedParts(result), unchangedParts(source));
  }
});

const collapsedDocuments = () => {
  const acrossTracks = document(2); acrossTracks.tracks[0].keyframes[1].atSeconds = .1; acrossTracks.tracks[1].keyframes[1].atSeconds = .10000000000000002;
  const acrossClip = document(); acrossClip.tracks[0].keyframes[1].atSeconds = .1; acrossClip.clips[0].startSeconds = .10000000000000002;
  const withinClip = document(); withinClip.clips[0].startSeconds = .1; withinClip.clips[0].endSeconds = .10000000000000002;
  const nearZero = document(1); nearZero.tracks[0].keyframes[1].atSeconds = Number.MIN_VALUE;
  const clipZero = document(); clipZero.clips[0].startSeconds = Number.MIN_VALUE;
  return [acrossTracks,acrossClip,withinClip,nearZero,clipZero];
};
test('global distinct times may never merge across tracks clips or endpoints and rejection leaves authors unchanged', () => {
  for (const source of collapsedDocuments()) {
    assert.deepEqual(inspectSceneAnimation(source).document, source); const before = structuredClone(source);
    assert.throws(() => retimeSceneAnimation(source, .1), { errorCode: 'scene_animation_invalid' });
    assert.deepEqual(source, before); assert.equal(wasm(request(source,.1)).errorCode, 'scene_animation_invalid');
  }
  // Equal declared instants are intentional shared timing, not a collision.
  const shared = document(); shared.clips[0].startSeconds = .5;
  const retimed = retimeSceneAnimation(shared, .1).document;
  assert.equal(retimed.clips[0].startSeconds, retimed.tracks[0].keyframes[1].atSeconds);
});

test('retime enforces target bounds original semantics and strict raw envelopes', () => {
  for (const duration of [0,-0,-1,60.01,'2',null,false]) {
    assert.throws(() => retimeSceneAnimation(document(),duration), { errorCode: 'scene_animation_invalid' });
    assert.equal(wasm(request(document(),duration)).errorCode, 'scene_animation_invalid');
  }
  for (const change of [d => d.schemaVersion = 4, d => d.tracks = [], d => d.loop = 1, d => d.tracks[0].keyframes[0].atSeconds = .1,
    d => d.clips[0].endSeconds = 3, d => d.clips[1].id = d.clips[0].id, d => d.extra = true]) {
    const source = document(); change(source); assert.throws(() => retimeSceneAnimation(source,2), { errorCode: 'scene_animation_invalid' });
  }
  for (const field of ['protocolVersion','operation','document','durationSeconds']) {
    const incoming = request(); delete incoming[field]; assert.equal(wasm(incoming).errorCode, 'studio_core_request_invalid');
    assert.throws(() => dispatchStudioCoreSceneAnimation(incoming), { errorCode: 'studio_core_request_invalid' });
  }
  const wire = JSON.stringify(request(document(),4));
  for (const [from,to] of [
    ['"durationSeconds":4','"durationSeconds":5,"durationSeconds":4'],
    ['"operation":','"operation":"sceneAnimation.inspect","operation":'],
    ['"atSeconds":0','"atSeconds":1,"atSeconds":0'],
    ['"startSeconds":1','"startSeconds":0,"startSeconds":1'],
    ['"durationSeconds":4','"durationSeconds":5,"durationSec\\u006fnds":4'],
  ]) assert.equal(wasm(wire.replace(from,to)).errorCode, 'studio_core_request_invalid');
  assert.equal(wasm('\uFEFF'+wire).errorCode, 'studio_core_request_invalid');
  assert.equal(wasm(wire.replace(id(1),'\\uD800')).errorCode, 'studio_core_request_invalid');
});

test('wrapper and bridge reject getters serializers cycles and nonfinite targets before executing caller code', () => {
  let calls = 0;
  for (const change of [d => Object.defineProperty(d,'durationSeconds',{ enumerable:true,get() { calls++; return 2; } }),
    d => Object.defineProperty(d.clips[0],'startSeconds',{ enumerable:true,get() { calls++; return 1; } }),
    d => d.toJSON = () => { calls++; return {}; }, d => d.tracks[0].self = d,
    d => delete d.tracks[0], d => d.clips[0].startSeconds = Infinity]) {
    const source = document(); change(source); assert.throws(() => retimeSceneAnimation(source,4), { errorCode:'studio_core_request_invalid' });
  }
  for (const duration of [NaN,Infinity,-Infinity,undefined]) assert.throws(() => retimeSceneAnimation(document(),duration), { errorCode:'studio_core_request_invalid' });
  const incoming = request(); Object.defineProperty(incoming,'durationSeconds',{ enumerable:true,get() { calls++; return 4; } });
  assert.throws(() => dispatchStudioCoreSceneAnimation(incoming), { errorCode:'studio_core_request_invalid' });
  assert.equal(calls,0); assert.equal(getStudioCoreMetadata().ready,true);
});

test('missing optional retime marker leaves legacy animation capabilities available without a JS transformation fallback', async () => {
  for (const retime of [null,0,2]) {
    const h = await bridge(null,{retime}); assert.equal(h.module.supportsStudioCoreSceneAnimationRetime(),false);
    for (const version of [1,2,3]) assert.throws(() => h.module.dispatchStudioCoreSceneAnimation(request(document(version))),{errorCode:'studio_core_unavailable'});
    assert.equal(h.calls(),0); assert.equal(h.module.getStudioCoreMetadata().ready,true);
    assert.equal(h.module.supportsStudioCoreSceneAnimationClips(),true);
    const source = document(); assert.deepEqual(h.module.dispatchStudioCoreSceneAnimation({protocolVersion:1,operation:'sceneAnimation.inspect',document:source}),{document:source});
    assert.deepEqual(h.module.dispatchStudioCoreSceneAnimation({protocolVersion:1,operation:'sceneAnimation.sample',document:source,timeSeconds:.5}),sampleSceneAnimation(source,.5));
  }
  for (const capabilities of [{sprites:null},{clips:null}]) {
    const h = await bridge(null,capabilities); assert.equal(h.module.supportsStudioCoreSceneAnimationRetime(),true);
    assert.throws(() => h.module.dispatchStudioCoreSceneAnimation(request(document())),{errorCode:'studio_core_unavailable'});
    assert.equal(h.calls(),0);
    assert.deepEqual(h.module.dispatchStudioCoreSceneAnimation(request(document(1))),retimeSceneAnimation(document(1),4));
  }
});

test('forged native retime receipts cannot change identity values schemas ordering or proportional times', async () => {
  for (const change of [r => r.extra = true, r => r.sceneAnimation.extra = true, r => r.sceneAnimation.document.extra = true,
    r => r.sceneAnimation.document.durationSeconds = 3, r => r.sceneAnimation.document.sceneObjectId = id(9),
    r => r.sceneAnimation.document.loop = false, r => r.sceneAnimation.document.tracks.reverse(),
    r => r.sceneAnimation.document.tracks[0].keyframes[1].atSeconds = .5, r => r.sceneAnimation.document.tracks[0].keyframes[1].value = .6,
    r => r.sceneAnimation.document.tracks[1].grid.columns = 8, r => r.sceneAnimation.document.clips.reverse(),
    r => r.sceneAnimation.document.clips[0].id = id(9), r => r.sceneAnimation.document.clips[0].name = 'renamed',
    r => r.sceneAnimation.document.clips[0].loop = true, r => r.sceneAnimation.document.clips[0].endSeconds = 3.9,
    r => { r.sceneAnimation.document.schemaVersion = 2; delete r.sceneAnimation.document.clips; }]) {
    const h = await bridge(r => { change(r); return r; });
    assert.throws(() => h.module.dispatchStudioCoreSceneAnimation(request()),{errorCode:'studio_core_unavailable'});
    assert.equal(h.module.getStudioCoreMetadata().ready,false);
  }
  const unchanged = await bridge(r => { r.sceneAnimation.document.tracks[0].keyframes[1].atSeconds = .6; return r; });
  assert.throws(() => unchanged.module.dispatchStudioCoreSceneAnimation(request(document(),2)),{errorCode:'studio_core_unavailable'});
  for (const source of collapsedDocuments()) {
    const h = await bridge(() => ({protocolVersion:1,ok:true,sceneAnimation:{document:source}}));
    assert.throws(() => h.module.dispatchStudioCoreSceneAnimation(request(source,.1)),{errorCode:'studio_core_unavailable'});
  }
  for (const duration of [0,null,'4',61]) {
    const h = await bridge(() => ({protocolVersion:1,ok:true,sceneAnimation:{document:document()}}));
    assert.throws(() => h.module.dispatchStudioCoreSceneAnimation(request(document(),duration)),{errorCode:'studio_core_unavailable'});
  }
  const malformed = document(); malformed.clips[0].startSeconds = 2;
  const h = await bridge(() => ({protocolVersion:1,ok:true,sceneAnimation:{document:malformed}}));
  assert.throws(() => h.module.dispatchStudioCoreSceneAnimation(request(malformed)),{errorCode:'studio_core_unavailable'});
  assert.equal(getStudioCoreMetadata().ready,true);
});

const nativePath = process.env.VIENTO_ANIMATION_CORE_NATIVE;
test('native CLI and actual WASM agree across formats numeric extremes global collapse raw errors and proportional samples', {skip:!nativePath}, async () => {
  const inputs = [];
  for (const version of [1,2,3]) for (const duration of [.125,.3,1,2,4,17.5,60]) inputs.push(request(document(version),duration));
  for (const [source,duration] of extremeDocuments()) inputs.push(request(source,duration));
  for (const source of collapsedDocuments()) inputs.push(request(source,.1));
  for (const duration of [0,-1,61,false,null,'2']) inputs.push(request(document(),duration));
  for (const version of [1,2,3]) for (const duration of [.3,4,60]) {
    const retimed = retimeSceneAnimation(document(version),duration).document;
    inputs.push({protocolVersion:1,operation:'sceneAnimation.sample',document:retimed,timeSeconds:duration/3});
  }
  const wires = inputs.map(value=>JSON.stringify(value));
  wires.push(wires[0].replace('"durationSeconds":0.125','"durationSeconds":1,"durationSeconds":0.125'));
  wires.push('\uFEFF'+wires[0]);
  const result = await new Promise((resolve,reject) => {
    const child=spawn(nativePath,[],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
    child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',(status,signal)=>{clearTimeout(timer);resolve({status,signal,stdout,stderr});});child.stdin.end(wires.join('\n')+'\n');
  });
  assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);
  assert.deepEqual(result.stdout.trim().split('\n').map(JSON.parse),wires.map(wasm));
});

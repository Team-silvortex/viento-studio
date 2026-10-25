// Bounded observations of native movement sweeps. This module never solves
// collisions; identities and author locations come only from the frozen plan.
import { validateProjectAssemblyPlan } from './project-assembly-plan-contract.mjs';
import { copyProjectRuntimeData as copy, projectRuntimeExact as exact, projectRuntimeUuid as uuid,
  PROJECT_RUNTIME_MAX_LINE } from './project-runtime-contracts.mjs';
import { normalizeSourcePath } from './source-path.mjs';

export const PROJECT_PHYSICS2D_TRACE_PREFIX = 'VIENTO_PHYSICS2D:';
export const PROJECT_PHYSICS2D_TRACE_LIMIT = 256;
const prefix = PROJECT_PHYSICS2D_TRACE_PREFIX, limit = PROJECT_PHYSICS2D_TRACE_LIMIT, maxLine = 16384;
const invalid = () => Object.assign(new TypeError('Invalid project physics observation.'), { errorCode: 'runtime_physics2d_trace_invalid' });
const pair = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const close = (a, b) => Math.abs(a - b) <= 1e-6;
const sampleKeys = ['protocol', 'event', 'sequence', 'visitIndex', 'sceneId', 'stepIndex', 'timeSeconds', 'deltaSeconds',
  'bodyId', 'instanceId', 'positionBefore', 'positionAfter', 'requestedMotion', 'contacts'];

function source(value) {
  if (!exact(value, ['objectId', 'sourcePath', 'sourceRevision', 'propertyPath', ...(Object.hasOwn(value || {}, 'sourceRange') ? ['sourceRange'] : [])])
    || !uuid(value.objectId) || typeof value.sourcePath !== 'string' || value.sourcePath.length > 4096
    || !value.sourcePath.endsWith('.json') || normalizeSourcePath(value.sourcePath) !== value.sourcePath
    || /[\x00-\x1f\x7f:]/.test(value.sourcePath) || !/^sha256:[a-f0-9]{64}$/.test(value.sourceRevision)
    || !/^\/bodies\/(?:0|[1-9][0-9]*)$/.test(value.propertyPath)) throw invalid();
  if (Object.hasOwn(value, 'sourceRange')) {
    const range = value.sourceRange;
    if (!exact(range, ['start', 'end', 'encoding', 'propertyPath', 'exact']) || !integer(range.start, 0, 65535)
      || !integer(range.end, range.start + 1, 65536) || range.encoding !== 'utf-16'
      || range.propertyPath !== value.propertyPath || range.exact !== true) throw invalid();
  }
}

function sample(value, enriched) {
  if (!exact(value, [...sampleKeys, ...(enriched ? ['objectId', 'response', 'source', 'displacement'] : [])])
    || value.protocol !== 1 || value.event !== 'sample' || !integer(value.sequence, 1, limit)
    || !integer(value.visitIndex, 1, 64) || !uuid(value.sceneId) || !integer(value.stepIndex, 1, 30)
    || !Number.isFinite(value.timeSeconds) || value.timeSeconds <= 0 || value.timeSeconds > 30
    || !Number.isFinite(value.deltaSeconds) || value.deltaSeconds <= 0 || value.deltaSeconds > 1
    || !uuid(value.bodyId) || !uuid(value.instanceId) || !pair(value.positionBefore) || !pair(value.positionAfter)
    || !pair(value.requestedMotion) || !Array.isArray(value.contacts) || value.contacts.length > 4) throw invalid();
  if (enriched) {
    if (!uuid(value.objectId) || !['stop', 'slide'].includes(value.response) || !pair(value.displacement)
      || value.displacement.some((number, index) => number !== value.positionAfter[index] - value.positionBefore[index])
      || value.contacts.length > (value.response === 'stop' ? 1 : 4)) throw invalid();
    source(value.source);
  }
  for (const contact of value.contacts) {
    if (!exact(contact, ['collider', 'position', 'normal', 'travel', 'remainder'])
      || ![contact.position, contact.normal, contact.travel, contact.remainder].every(pair)
      || Math.abs(Math.hypot(...contact.normal) - 1) > 0.001) throw invalid();
    if (contact.collider !== null) {
      if (!exact(contact.collider, ['bodyId', 'instanceId', ...(enriched ? ['objectId', 'source'] : [])])
        || !uuid(contact.collider.bodyId) || !uuid(contact.collider.instanceId)) throw invalid();
      if (enriched) { if (!uuid(contact.collider.objectId)) throw invalid(); source(contact.collider.source); }
    }
  }
}

export function validateProjectPhysics2DObservation(input) {
  const view = copy(input);
  if (!exact(view, ['format', 'schemaVersion', 'assemblyId', 'phase', 'limit', 'limited', 'samples'])
    || view.format !== 'viento-physics2d-observation' || view.schemaVersion !== 1 || !uuid(view.assemblyId)
    || !['waiting', 'recording', 'finished', 'incomplete'].includes(view.phase) || view.limit !== limit
    || typeof view.limited !== 'boolean' || !Array.isArray(view.samples) || view.samples.length > limit
    || view.limited && view.samples.length !== limit || view.phase === 'waiting' && (view.samples.length || view.limited)) throw invalid();
  let previous = null, seen = new Set();
  for (const [index, row] of view.samples.entries()) {
    sample(row, true);
    if (row.sequence !== index + 1 || row.sceneId === view.assemblyId) throw invalid();
    if (!previous || row.visitIndex !== previous.visitIndex) {
      if (previous && row.visitIndex < previous.visitIndex || row.stepIndex !== 1 || !close(row.timeSeconds, row.deltaSeconds)) throw invalid();
      seen = new Set();
    } else if (row.sceneId !== previous.sceneId || row.stepIndex < previous.stepIndex || row.stepIndex > previous.stepIndex + 1) throw invalid();
    else if (row.stepIndex === previous.stepIndex) {
      if (!close(row.timeSeconds, previous.timeSeconds) || row.deltaSeconds !== previous.deltaSeconds) throw invalid();
    } else {
      if (!close(row.timeSeconds, previous.timeSeconds + row.deltaSeconds)) throw invalid();
      seen = new Set();
    }
    if (seen.has(row.instanceId)) throw invalid();
    seen.add(row.instanceId); previous = row;
  }
  return view;
}

export function createProjectPhysics2DTraceReader(input, { runtimeReader, onSnapshot } = {}) {
  const plan = validateProjectAssemblyPlan(input);
  if (!runtimeReader || typeof runtimeReader.push !== 'function' || typeof runtimeReader.finish !== 'function'
    || onSnapshot !== undefined && typeof onSnapshot !== 'function') throw invalid();
  const scenes = new Map(plan.scenes.map(scene => {
    const bodies = new Map((scene.physics?.document.bodies || []).map((body, index) => {
      const actor = scene.actors.find(row => row.instanceId === body.instanceId);
      return [body.id, { ...body, objectId: actor.objectId, source: copy(scene.physics.locations.bodies[index].declaration) }];
    }));
    const characters = scene.actors.map(actor => [...bodies.values()].find(body => body.instanceId === actor.instanceId && body.kind === 'character')).filter(Boolean);
    return [scene.scene.objectId, { bodies, characters }];
  }));
  const view = { format: 'viento-physics2d-observation', schemaVersion: 1, assemblyId: plan.assembly.objectId,
    phase: 'waiting', limit, limited: false, samples: [] };
  const diagnostics = [];
  let started = false, traceReady = false, traceFinished = false, projectFinished = false, finalExit = false;
  let current = null, pending = '', dropping = false, ended = false;
  const snapshot = () => copy(view);
  const publish = () => onSnapshot?.(snapshot());
  const issue = () => {
    if (diagnostics.length < 128) diagnostics.push({ severity: 'error', code: 'runtime_physics2d_trace_invalid',
      message: 'Invalid or incomplete native physics observation.', objectId: plan.assembly.objectId,
      sourcePath: plan.assembly.sourcePath, sourceRevision: plan.assembly.sourceRevision, propertyPath: '' });
  };
  const runtimeEvent = frame => {
    if (frame.event === 'ready') started = true;
    else if (frame.event === 'scene-enter') {
      current = { visitIndex: frame.visitIndex, sceneId: frame.sceneId, ready: false,
        step: 0, count: 0, time: 0, delta: 0, ...scenes.get(frame.sceneId) };
    } else if (frame.event === 'scene-event' && frame.stream === 'runtime' && frame.frame.event === 'ready' && current) current.ready = true;
    else if (frame.event === 'scene-exit') {
      if (current?.characters.length && !view.limited && (current.count !== 0 && current.count !== current.characters.length
        || !close(current.time, frame.elapsedSeconds))) issue();
      current = null; finalExit = frame.reason === 'finished';
    } else if (frame.event === 'finished') {
      projectFinished = true;
      if (!traceReady || !traceFinished) issue();
      view.phase = traceFinished && !diagnostics.length ? 'finished' : 'incomplete'; publish();
    }
  };
  const admit = frame => {
    if (!frame || frame.protocol !== 1 || projectFinished || traceFinished) throw invalid();
    if (frame.event === 'ready') {
      if (!exact(frame, ['protocol', 'event', 'assemblyId', 'limit']) || !started || traceReady
        || frame.assemblyId !== plan.assembly.objectId || frame.limit !== limit) throw invalid();
      traceReady = true; view.phase = 'recording';
    } else if (frame.event === 'sample') {
      sample(frame, false);
      if (!traceReady || view.limited || !current?.ready || frame.visitIndex !== current.visitIndex
        || frame.sceneId !== current.sceneId || frame.sequence !== view.samples.length + 1) throw invalid();
      const nextStep = frame.stepIndex === current.step + 1;
      if (nextStep ? current.step > 0 && current.count !== current.characters.length
        || !close(frame.timeSeconds, current.time + frame.deltaSeconds)
        : frame.stepIndex !== current.step || frame.timeSeconds !== current.time || frame.deltaSeconds !== current.delta) throw invalid();
      const count = nextStep ? 0 : current.count, body = current.characters[count];
      if (!body || frame.bodyId !== body.id || frame.instanceId !== body.instanceId
        || frame.contacts.length > (body.collisionResponse === 'slide' ? 4 : 1)) throw invalid();
      const row = { ...frame, objectId: body.objectId, response: body.collisionResponse || 'stop', source: copy(body.source),
        displacement: frame.positionAfter.map((number, index) => number - frame.positionBefore[index]) };
      row.contacts = frame.contacts.map(contact => {
        if (contact.collider === null) return contact;
        const collider = current.bodies.get(contact.collider.bodyId);
        if (!collider || collider.id === body.id || collider.kind === 'sensor' || collider.instanceId !== contact.collider.instanceId) throw invalid();
        return { ...contact, collider: { ...contact.collider, objectId: collider.objectId, source: copy(collider.source) } };
      });
      sample(row, true);
      current.step = frame.stepIndex; current.time = frame.timeSeconds; current.delta = frame.deltaSeconds; current.count = count + 1;
      view.samples.push(row);
    } else if (frame.event === 'limited') {
      if (!exact(frame, ['protocol', 'event', 'sampleCount']) || !traceReady || view.limited || !current?.ready
        || frame.sampleCount !== limit || view.samples.length !== limit) throw invalid();
      view.limited = true;
    } else if (frame.event === 'finished') {
      if (!exact(frame, ['protocol', 'event', 'sampleCount', 'limited']) || !traceReady || !finalExit || current
        || frame.sampleCount !== view.samples.length || frame.limited !== view.limited) throw invalid();
      traceFinished = true;
    } else throw invalid();
    publish();
  };
  const line = value => {
    if (value.startsWith(prefix)) {
      try {
        if (new TextEncoder().encode(value).length > maxLine) throw invalid();
        admit(copy(JSON.parse(value.slice(prefix.length))));
      } catch { issue(); }
      return [];
    }
    const accepted = runtimeReader.push(value + '\n');
    for (const event of accepted) runtimeEvent(event);
    return accepted;
  };
  const api = {
    get events() { return runtimeReader.events; },
    get diagnostics() { return [...runtimeReader.diagnostics, ...copy(diagnostics)]; },
    snapshot,
    push(text) {
      if (ended || typeof text !== 'string') return [];
      const accepted = [];
      for (const piece of text.split(/(?<=\n)/)) {
        const complete = piece.endsWith('\n');
        if (!dropping) {
          const physical = pending.startsWith(prefix) || (pending + piece.slice(0, prefix.length)).startsWith(prefix);
          const maximum = physical ? maxLine : PROJECT_RUNTIME_MAX_LINE;
          if (pending.length + piece.length > maximum) {
            if (physical) issue(); else accepted.push(...line(pending + piece.slice(0, maximum + 1 - pending.length)));
            pending = ''; dropping = true;
          } else pending += piece;
        }
        if (complete) { if (!dropping) accepted.push(...line(pending.replace(/\r?\n$/, ''))); pending = ''; dropping = false; }
      }
      return accepted;
    },
    finish() {
      if (!ended) {
        if (pending && !dropping) line(pending);
        pending = ''; ended = true;
        runtimeReader.finish();
        if (!projectFinished || diagnostics.length || runtimeReader.diagnostics.length) view.phase = 'incomplete';
        publish();
      }
      return { events: api.events, diagnostics: api.diagnostics };
    },
  };
  // Preserve the existing reader's shared-state/event/animation observation ports.
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(runtimeReader))) {
    if (!Object.hasOwn(api, key) && descriptor.get) Object.defineProperty(api, key, { enumerable: descriptor.enumerable, get: () => runtimeReader[key] });
  }
  publish();
  return Object.freeze(api);
}

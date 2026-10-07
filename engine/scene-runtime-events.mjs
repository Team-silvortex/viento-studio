// Renderer-independent Scene2D event admission. Only the frozen plan supplies
// author navigation; process frames contain runtime identities and values.
const buildActorFieldLocation = (actor, field) => actor?.fieldSources?.[field] || (actor?.declaration ? {
  ...actor.declaration, propertyPath: `${actor.declaration.propertyPath}/${field}`,
} : null);

export function createSceneRuntimeEventReader(plan, { onEvent } = {}) {
  if (plan?.format !== 'viento-build-plan' || ![1, 2].includes(plan.schemaVersion) || !Array.isArray(plan.actors)) {
    throw new TypeError('Expected a Scene2D build plan using runtime protocol 1 or 2.');
  }
  const protocol = plan.schemaVersion, paired = protocol === 2;
  const actors = new Map(plan.actors.map(actor => [paired ? actor.instanceId : actor.objectId, actor]));
  const resources = new Set((plan.resources || []).map(resource => resource.id));
  const events = [], diagnostics = [], prefix = 'VIENTO_RUNTIME:';
  let pending = '', dropping = false, ready = false, finished = false, ended = false, limitReported = false;
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const keys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
  const state = value => value === 'idle' || value === 'moving';
  const position = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
  const sceneLocation = { objectId: plan.scene.objectId, sourcePath: plan.scene.sourcePath, propertyPath: '' };
  const identityKey = frame => paired ? frame.instanceId : frame.objectId;
  const identified = frame => actors.has(identityKey(frame)) && (!paired || actors.get(frame.instanceId).objectId === frame.objectId);
  const actorLocation = (actor, field) => paired ? {
    ...((field ? buildActorFieldLocation(actor, field) : actor.declaration)
      || { objectId: actor.objectId, sourcePath: actor.sourcePath, propertyPath: '' }),
    instanceId: actor.instanceId, relatedObjectId: actor.objectId,
  } : { objectId: actor.objectId, sourcePath: actor.sourcePath, propertyPath: '',
    ...(field ? buildActorFieldLocation(actor, field) : {}) };
  const invalid = () => {
    if (diagnostics.length < 128) diagnostics.push({ severity: 'error', code: 'runtime_protocol_invalid',
      message: 'Invalid runtime protocol frame.', ...sceneLocation });
  };
  const states = value => {
    if (!Array.isArray(value) || value.length !== actors.size) return false;
    const seen = new Set();
    for (const actor of value) {
      if (!plain(actor) || !keys(actor, [...(paired ? ['instanceId'] : []), 'objectId', 'position', 'state'])
        || !identified(actor) || seen.has(identityKey(actor)) || !position(actor.position) || !state(actor.state)) return false;
      seen.add(identityKey(actor));
    }
    return true;
  };
  const line = text => {
    if (!text.startsWith(prefix)) return null;
    if (events.length >= 4096) { if (!limitReported) { invalid(); limitReported = true; } return null; }
    let frame;
    try { frame = JSON.parse(text.slice(prefix.length)); } catch { invalid(); return null; }
    if (!plain(frame) || frame.protocol !== protocol || finished) { invalid(); return null; }
    let valid = false;
    switch (frame.event) {
      case 'ready':
        valid = !ready && keys(frame, ['protocol', 'event', 'sceneObjectId', 'actors'])
          && frame.sceneObjectId === plan.scene.objectId && states(frame.actors);
        if (valid) ready = true;
        break;
      case 'state':
        valid = ready && keys(frame, ['protocol', 'event', ...(paired ? ['instanceId'] : []), 'objectId', 'state'])
          && identified(frame) && state(frame.state);
        break;
      case 'finished':
        valid = ready && keys(frame, ['protocol', 'event', 'actors', 'fixedDelta']) && states(frame.actors)
          && Number.isFinite(frame.fixedDelta) && frame.fixedDelta > 0;
        if (valid) finished = true;
        break;
      case 'diagnostic': {
        const hasInstance = frame.instanceId !== undefined && frame.instanceId !== '';
        const hasObject = frame.objectId !== undefined && frame.objectId !== '';
        const hasResource = frame.resourceId !== undefined && frame.resourceId !== '';
        const actor = actors.get(identityKey(frame));
        valid = keys(frame, ['protocol', 'event', 'severity', 'code', 'message', ...(paired ? ['instanceId'] : []), 'objectId', 'resourceId'])
          && frame.severity === 'error' && typeof frame.code === 'string' && /^[a-z][a-z0-9_]{0,127}$/.test(frame.code)
          && typeof frame.message === 'string' && frame.message.length > 0 && frame.message.length <= 4096
          && (paired ? hasInstance ? identified(frame) : !hasObject || frame.objectId === plan.scene.objectId
            : !hasObject || actors.has(frame.objectId) || frame.objectId === plan.scene.objectId)
          && (!hasResource || (paired ? hasInstance && frame.resourceId === actor?.imageResourceId : resources.has(frame.resourceId)));
        if (valid) diagnostics.push({ severity: 'error', code: frame.code, message: frame.message, ...sceneLocation,
          ...(actor ? actorLocation(actor, hasResource && frame.resourceId === actor.imageResourceId ? 'imageResourceId' : null) : {}),
          ...(hasResource ? { resourceId: frame.resourceId } : {}) });
        break;
      }
    }
    if (!valid) { invalid(); return null; }
    events.push(frame); onEvent?.(frame); return frame;
  };
  return {
    events, diagnostics,
    push(text) {
      if (ended) return [];
      const accepted = [];
      for (const part of text.split(/(?<=\n)/)) {
        const complete = part.endsWith('\n');
        if (!dropping) {
          if (pending.length + part.length > 64 * 1024) {
            if ((pending + part.slice(0, prefix.length)).startsWith(prefix)) invalid();
            pending = ''; dropping = true;
          } else pending += part;
        }
        if (complete) {
          if (!dropping) { const frame = line(pending.replace(/\r?\n$/, '')); if (frame) accepted.push(frame); }
          pending = ''; dropping = false;
        }
      }
      return accepted;
    },
    finish() {
      if (!ended && pending && !dropping) line(pending);
      pending = ''; ended = true; return { events, diagnostics };
    },
  };
}

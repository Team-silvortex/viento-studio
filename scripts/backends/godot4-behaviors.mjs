// Opt-in plan/protocol 3. The frozen v1/v2 generators remain byte-for-byte intact.
import fs from 'node:fs/promises';
import { buildHash, buildError } from '../adapters/node-build-snapshot.mjs';
import * as instances from './godot4-instances.mjs';

const id = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const name = value => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value);
const scalar = value => typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))
  || typeof value === 'string' && value.length <= 4096 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, allowed) => plain(value) && Object.keys(value).every(key => allowed.includes(key));
const invalid = message => { throw buildError('build_behavior_invalid', message); };
const backendId = 'org.viento.godot4';
const scriptPath = objectId => `behaviors/${objectId}.gd`;
const basePlan = plan => { const { behaviors, ...rest } = plan; return { ...rest, schemaVersion: 2 }; };

export function validateGodotBehaviorPlan(plan) {
  const value = plan?.behaviors;
  if (plan?.schemaVersion !== 3 || value?.format !== 'viento-behavior-plan' || value.schemaVersion !== 1
    || value.backendId !== backendId || value.language !== 'gdscript'
    || !id(value.manifest?.objectId) || typeof value.manifest.sourcePath !== 'string'
    || !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 8
    || !Array.isArray(value.bindings) || value.bindings.length < 1 || value.bindings.length > 32) invalid('Invalid Godot behavior plan.');
  const sources = new Map(), bindings = new Set(), actors = new Map(plan.actors.map(actor => [actor.instanceId, actor]));
  for (const source of value.sources) {
    if (!id(source.objectId) || sources.has(source.objectId) || source.language !== 'gdscript'
      || typeof source.content !== 'string' || !source.content.length || Buffer.byteLength(source.content, 'utf8') > 65536
      || Buffer.from(source.content).toString('utf8') !== source.content
      || !source.sourcePath?.toLowerCase().endsWith('.txt')
      || source.sourceRevision !== `sha256:${buildHash(Buffer.from(source.content))}`) invalid('Invalid frozen behavior source.');
    sources.set(source.objectId, source);
  }
  for (const binding of value.bindings) {
    if (!id(binding.bindingId) || bindings.has(binding.bindingId) || !actors.has(binding.instanceId)
      || actors.get(binding.instanceId).objectId !== binding.objectId
      || binding.implementation?.backendId !== backendId || binding.implementation.language !== 'gdscript'
      || !sources.has(binding.implementation.sourceObjectId) || !plain(binding.parameters)
      || Object.keys(binding.parameters).length > 32 || Object.entries(binding.parameters).some(([key, item]) => !name(key) || !scalar(item))
      || !Array.isArray(binding.events) || binding.events.length > 8
      || binding.events.some(item => !exact(item, ['signal', 'event']) || !name(item.signal) || !name(item.event))
      || new Set(binding.events.map(item => item.signal)).size !== binding.events.length
      || binding.declaration?.objectId !== value.manifest.objectId || binding.declaration.sourcePath !== value.manifest.sourcePath
      || binding.declaration.sourceRevision !== value.manifest.sourceRevision || !/^\/bindings\/\d+$/.test(binding.declaration.propertyPath)) invalid('Invalid Godot behavior binding.');
    bindings.add(binding.bindingId);
  }
  return value;
}

export async function generateGodotBehaviorProject(input) {
  const plan = structuredClone(input), value = validateGodotBehaviorPlan(plan);
  const generated = await instances.generateGodotProject(basePlan(plan));
  const runtime = await fs.readFile(new URL('./godot4/behavior-runtime.gd', import.meta.url));
  const generator = await fs.readFile(new URL('./godot4-behaviors.mjs', import.meta.url));
  generated.files.set('main.tscn', Buffer.from(generated.files.get('main.tscn').toString().replace('path="res://runtime.gd"', 'path="res://behavior-runtime.gd"')));
  generated.files.set('behavior-runtime.gd', runtime);
  generated.files.set('behaviors.json', Buffer.from(JSON.stringify({ format: 'viento-godot-behaviors', schemaVersion: 1,
    sources: value.sources.map(source => ({ objectId: source.objectId, path: scriptPath(source.objectId) })),
    bindings: value.bindings.map(({ declaration, ...binding }) => binding) }, null, 2) + '\n'));
  for (const source of value.sources) generated.files.set(scriptPath(source.objectId), Buffer.from(source.content));
  generated.sourceMap = { ...generated.sourceMap, schemaVersion: 3,
    behaviors: value.bindings.map(binding => ({ bindingId: binding.bindingId, instanceId: binding.instanceId, objectId: binding.objectId,
      sourceObjectId: binding.implementation.sourceObjectId, generatedPath: scriptPath(binding.implementation.sourceObjectId),
      declaration: binding.declaration, source: (() => { const { content, language, ...source } = value.sources.find(item => item.objectId === binding.implementation.sourceObjectId); return source; })() })) };
  generated.backend = { ...generated.backend, version: '0.3.0', protocolVersion: 3,
    capabilities: [...generated.backend.capabilities, 'behavior.bindings', 'behavior.gdscript'],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), generator, runtime])) };
  return generated;
}

function bindingLocation(binding, property) {
  return { ...binding.declaration, propertyPath: `${binding.declaration.propertyPath}${property ? `/parameters/${property}` : ''}`,
    bindingId: binding.bindingId, instanceId: binding.instanceId, relatedObjectId: binding.objectId };
}

export function godotBehaviorDiagnostics(result, plan) {
  const diagnostics = instances.godotDiagnostics(result, basePlan(plan));
  const output = `${result.stdout}\n${result.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
  // Godot often prints the exact generated script location on the line after
  // its message. Match only our generated paths, never trust a log author path.
  const lines = output.split('\n');
  for (let index = 0; index < lines.length && diagnostics.length < 256; index++) {
    if (!/^\s*(?:SCRIPT ERROR:|ERROR:)/.test(lines[index])) continue;
    const vicinity = lines.slice(index, index + 3).join('\n');
    const source = plan.behaviors.sources.find(item => vicinity.includes(`res://${scriptPath(item.objectId)}`));
    if (!source) continue;
    const matching = diagnostics.find(item => item.code === 'godot_error' && item.message === lines[index].trim().slice(0, 4096));
    const match = vicinity.match(new RegExp(`res://behaviors/${source.objectId}\\.gd:(\\d+)`));
    const lineNumber = match ? Number(match[1]) : 0;
    const sourceLines = source.content.split('\n');
    const start = lineNumber > 0 && lineNumber <= sourceLines.length ? sourceLines.slice(0, lineNumber - 1).reduce((sum, text) => sum + text.length + 1, 0) : -1;
    const end = start >= 0 ? start + sourceLines[lineNumber - 1].replace(/\r$/, '').length : -1;
    const location = { objectId: source.objectId, sourcePath: source.sourcePath, sourceRevision: source.sourceRevision, propertyPath: '',
      ...(start >= 0 ? { sourceLine: lineNumber, ...(end > start ? { sourceRange: { start, end, encoding: 'utf-16', propertyPath: '', exact: true } } : {}) } : {}) };
    if (matching) Object.assign(matching, location);
  }
  return diagnostics;
}

export function createBehaviorRuntimeEventReader(input, { onEvent } = {}) {
  const plan = structuredClone(input), value = validateGodotBehaviorPlan(plan);
  const events = [], diagnostics = [], bindings = new Map(value.bindings.map(binding => [binding.bindingId, binding]));
  const legacy = instances.createRuntimeEventReader(basePlan(plan));
  const prefix = 'VIENTO_RUNTIME:', maxLineLength = 65536, maxEvents = 4096;
  let pending = '', dropping = false, ended = false, ready = false, finished = false, limitReported = false;
  const invalidFrame = () => { if (diagnostics.length < 128) diagnostics.push({ severity: 'error', code: 'runtime_protocol_invalid',
    message: 'Invalid behavior runtime protocol frame.', objectId: plan.scene.objectId, sourcePath: plan.scene.sourcePath, propertyPath: '' }); };
  const accept = text => {
    if (!text.startsWith(prefix)) return null;
    if (events.length >= maxEvents) { if (!limitReported) { limitReported = true; invalidFrame(); } return null; }
    let frame;
    try { frame = JSON.parse(text.slice(prefix.length)); } catch { invalidFrame(); return null; }
    if (!plain(frame) || frame.protocol !== 3 || finished) { invalidFrame(); return null; }
    const binding = bindings.get(frame.bindingId);
    const identified = binding && binding.instanceId === frame.instanceId && binding.objectId === frame.objectId;
    if (frame.event === 'behavior') {
      if (!ready || !exact(frame, ['protocol', 'event', 'bindingId', 'instanceId', 'objectId', 'name', 'arguments']) || !identified
        || !binding.events.some(event => event.event === frame.name) || !Array.isArray(frame.arguments)
        || frame.arguments.length > 4 || !frame.arguments.every(scalar)) { invalidFrame(); return null; }
    } else if (frame.event === 'diagnostic' && frame.bindingId !== undefined) {
      if (!exact(frame, ['protocol', 'event', 'bindingId', 'instanceId', 'objectId', 'severity', 'code', 'message', 'parameter']) || !identified
        || frame.severity !== 'error' || typeof frame.code !== 'string' || !/^runtime_behavior_[a-z_]{1,80}$/.test(frame.code)
        || typeof frame.message !== 'string' || !frame.message.length || frame.message.length > 4096
        || frame.parameter !== undefined && (typeof frame.parameter !== 'string' || !Object.hasOwn(binding.parameters, frame.parameter))) { invalidFrame(); return null; }
      diagnostics.push({ severity: frame.severity, code: frame.code, message: frame.message, ...bindingLocation(binding, frame.parameter) });
    } else {
      const count = legacy.diagnostics.length;
      const accepted = legacy.push(prefix + JSON.stringify({ ...frame, protocol: 2 }) + '\n');
      diagnostics.push(...legacy.diagnostics.slice(count));
      if (!accepted.length) return null;
      if (frame.event === 'ready') ready = true;
      if (frame.event === 'finished') finished = true;
    }
    events.push(frame); onEvent?.(frame); return frame;
  };
  return { events, diagnostics,
    push(text) {
      if (ended) return [];
      const accepted = [];
      for (const part of text.split(/(?<=\n)/)) {
        const complete = part.endsWith('\n');
        if (!dropping) {
          if (pending.length + part.length > maxLineLength) { if ((pending + part.slice(0, prefix.length)).startsWith(prefix)) invalidFrame(); pending = ''; dropping = true; }
          else pending += part;
        }
        if (complete) {
          if (!dropping) { const frame = accept(pending.replace(/\r?\n$/, '')); if (frame) accepted.push(frame); }
          pending = ''; dropping = false;
        }
      }
      return accepted;
    },
    finish() { if (!ended && pending && !dropping) accept(pending); pending = ''; ended = true; return { events, diagnostics }; },
  };
}

// Sparse evidence retained from an admitted finite observation. These anchors
// neither replace its complete ledgers nor assign receipts to engine windows.
import { queryProjectRuntimeObservation } from './project-runtime-query.mjs';
import { projectAnimationTargetKey } from './project-animation-targets.mjs';
import { copyProjectRuntimeData as copy, projectRuntimeExact as exact, freezeProjectRuntimeData as freeze } from './project-runtime-contracts.mjs';

const kinds = ['events', 'animationCommands', 'animationCompletions', 'animationStateEntries'];
const reasons = ['recent', 'pending-delivery', 'target-baseline', 'latest-controller-entry'];
const relations = ['trigger', 'global-watermark', 'playback-command'];
const invalid = () => Object.assign(new TypeError('Invalid project causal anchors.'), { errorCode: 'project_causal_anchors_invalid' });
const idFor = (kind, sequence) => `${kind}:${sequence}`;
const visitOf = record => record.origin?.visitIndex ?? record.visitIndex;
const sceneOf = record => record.origin?.sceneId ?? record.sceneId;
const laneOf = record => `${visitOf(record)}/${sceneOf(record)}/${record.target ? projectAnimationTargetKey(record.target) : 'scene'}`;

export function createProjectCausalAnchors(input, options = {}) {
  let project, recentPerKind;
  try {
    // Inspect descriptors before reading options, just as the observation query
    // does for caller-owned data. A getter must never run at this boundary.
    const checked = copy(options);
    if (!exact(checked, Object.hasOwn(checked, 'recentPerKind') ? ['recentPerKind'] : [])) throw invalid();
    recentPerKind = Object.hasOwn(checked, 'recentPerKind') ? checked.recentPerKind : 16;
    if (!Number.isInteger(recentPerKind) || recentPerKind < 0 || recentPerKind > 64) throw invalid();
    project = queryProjectRuntimeObservation(input).project;
  } catch { throw invalid(); }

  const records = new Map(), roots = new Map(), retained = new Set(), edges = [], edgeKeys = new Set();
  const ledgers = Object.fromEntries(kinds.map(kind => [kind, project[kind]?.entries ?? []]));
  for (const kind of kinds) for (const record of ledgers[kind]) {
    const id = idFor(kind, record.sequence);
    records.set(id, { id, kind, sequence: record.sequence, record });
  }
  const root = (kind, sequence, reason) => {
    const id = idFor(kind, sequence);
    if (!records.has(id)) throw invalid();
    if (!roots.has(id)) roots.set(id, new Set());
    roots.get(id).add(reason);
  };
  for (const kind of kinds) {
    if (recentPerKind > 0) for (const record of ledgers[kind].slice(-recentPerKind)) root(kind, record.sequence, 'recent');
  }
  for (const kind of ['events', 'animationCompletions']) for (const record of ledgers[kind]) {
    if (record.deliveries.some(delivery => delivery.status === 'pending')) root(kind, record.sequence, 'pending-delivery');
  }

  const current = project.visits.at(-1);
  if (current?.phase === 'ready') {
    const inVisit = record => visitOf(record) === current.index && sceneOf(record) === current.sceneId;
    const lanes = new Map(), controllers = new Map();
    for (const kind of ['animationCommands', 'animationCompletions']) for (const record of ledgers[kind]) {
      if (!inVisit(record)) continue;
      const key = laneOf(record);
      if (!lanes.has(key)) lanes.set(key, {});
      lanes.get(key)[kind] = record;
    }
    for (const lane of lanes.values()) {
      const command = lane.animationCommands, completion = lane.animationCompletions;
      // A completion's global cutoff proves whether a later command on this
      // lane superseded it. It does not make that cutoff its playback cause.
      if (completion && (!command || completion.commandSequence >= command.sequence)) root('animationCompletions', completion.sequence, 'target-baseline');
      else if (command) root('animationCommands', command.sequence, 'target-baseline');
    }
    for (const entry of ledgers.animationStateEntries) if (inVisit(entry)) controllers.set(entry.origin.bindingId, entry);
    for (const entry of controllers.values()) root('animationStateEntries', entry.sequence, 'latest-controller-entry');
  }

  const retain = id => {
    if (retained.has(id)) return;
    const node = records.get(id);
    if (!node) throw invalid();
    retained.add(id);
    const link = (kind, sequence, relation) => {
      if (sequence === 0) return;
      const to = idFor(kind, sequence), key = `${id}/${relation}/${to}`;
      if (!edgeKeys.has(key)) { edges.push({ from: id, to, relation }); edgeKeys.add(key); }
      retain(to);
    };
    const { kind, record } = node;
    if (kind === 'animationStateEntries') {
      if (record.trigger?.kind === 'event') link('events', record.trigger.eventSequence, 'trigger');
      if (record.trigger?.kind === 'completed') link('animationCompletions', record.trigger.completionSequence, 'trigger');
      link('animationCommands', record.commandSequence, 'global-watermark');
    } else if (kind === 'animationCompletions') {
      link('animationCommands', record.commandSequence, 'global-watermark');
      if (record.target) link('animationCommands', record.targetCommandSequence, 'playback-command');
      else {
        const preceding = ledgers.animationCommands[record.commandSequence - 1];
        // Legacy whole-scene autoplay has no command in this visit even when
        // the global cutoff still points at a command from an earlier visit.
        if (preceding && visitOf(preceding) === record.visitIndex && sceneOf(preceding) === record.sceneId) link('animationCommands', preceding.sequence, 'playback-command');
      }
    }
  };
  for (const id of roots.keys()) retain(id);
  const nodes = [...records.values()].filter(node => retained.has(node.id));
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  edges.sort((a, b) => order.get(a.from) - order.get(b.from) || relations.indexOf(a.relation) - relations.indexOf(b.relation) || order.get(a.to) - order.get(b.to));
  const retention = {};
  for (const kind of kinds) {
    const total = ledgers[kind].length, kept = nodes.filter(node => node.kind === kind).length;
    retention[kind] = { total, retained: kept, dropped: total - kept };
  }
  retention.aggregate = { total: records.size, retained: nodes.length, dropped: records.size - nodes.length };
  return freeze({ format: 'viento-project-causal-anchors', schemaVersion: 1, assemblyId: project.assemblyId,
    protocolVersion: project.protocolVersion ?? 1, recentPerKind, nodes, edges,
    roots: nodes.filter(node => roots.has(node.id)).map(node => ({ id: node.id, reasons: reasons.filter(reason => roots.get(node.id).has(reason)) })), retention });
}

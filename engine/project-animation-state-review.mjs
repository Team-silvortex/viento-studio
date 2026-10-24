import { projectAnimationStateEntryTriggerEvidence } from './project-animation-state-entry-triggers.mjs';
// Read-only navigation over validated observations. A following command is
// later evidence from the same binding/visit, never proof of entry causality.
import { queryProjectRuntimeObservation } from './project-runtime-query.mjs';
import { freezeProjectRuntimeData as freeze } from './project-runtime-contracts.mjs';

const models = new WeakSet(), indexes = new WeakMap();
const invalid = () => Object.assign(new TypeError('Invalid project animation state review.'), { errorCode: 'project_animation_state_review_invalid' });
const key = origin => `${origin.visitIndex}/${origin.sceneId}/${origin.bindingId}`;

export function createProjectAnimationStateReview(input) {
  let view;
  try { view = queryProjectRuntimeObservation(input); } catch { throw invalid(); }
  if (![9, 10].includes(view.project.protocolVersion)) throw invalid();
  const project = view.project, entries = freeze(project.animationStateEntries.entries), groups = new Map(), commands = new Map(), terminals = new Map();
  for (const entry of entries) {
    const scope = key(entry.origin);
    if (!groups.has(scope)) groups.set(scope, []);
    groups.get(scope).push(entry);
  }
  for (const command of project.animationCommands.entries) {
    const scope = key(command.origin);
    if (!commands.has(scope)) commands.set(scope, []);
    commands.get(scope).push(freeze(command));
  }
  for (const snapshot of project.animationStates.entries) for (const controller of snapshot.controllers) {
    terminals.set(key(controller.origin), freeze({ reason: snapshot.reason, timeSeconds: snapshot.timeSeconds,
      commandSequence: snapshot.commandSequence, controller }));
  }
  for (const group of groups.values()) freeze(group);
  for (const group of commands.values()) freeze(group);
  const model = Object.freeze({ entries });
  models.add(model); indexes.set(model, { groups, commands, terminals, events: project.events, completions: project.animationCompletions });
  return model;
}

export function queryProjectAnimationStateReview(model, sequence) {
  if (!model || !models.has(model) || !Number.isSafeInteger(sequence) || sequence < 1) throw invalid();
  const entry = model.entries.find(entry => entry.sequence === sequence);
  if (!entry) return null;
  const index = indexes.get(model), scope = key(entry.origin), entries = index.groups.get(scope), position = entries.indexOf(entry);
  return freeze({ entry, entries, ...(entry.trigger ? { triggerEvidence: projectAnimationStateEntryTriggerEvidence(entry, index.events, index.completions) } : {}), position: position + 1,
    previousSequence: entries[position - 1]?.sequence ?? null, nextSequence: entries[position + 1]?.sequence ?? null,
    followingCommands: (index.commands.get(scope) || []).filter(command => command.sequence > entry.commandSequence),
    terminal: index.terminals.get(scope) || null });
}

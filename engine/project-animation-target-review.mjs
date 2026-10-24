// Read-only target groups contain captured evidence, never live playback state.
// Command and completion sequences remain independent receipt domains.
import { queryProjectRuntimeObservation } from './project-runtime-query.mjs';
import { projectAnimationTargetKey } from './project-animation-targets.mjs';
import { freezeProjectRuntimeData as freeze } from './project-runtime-contracts.mjs';

const models = new WeakSet(), indexes = new WeakMap();
const invalid = () => Object.assign(new TypeError('Invalid project animation target review.'), { errorCode: 'project_animation_target_review_invalid' });
const keyFor = (visitIndex, sceneId, target) => `${visitIndex}/${sceneId}/${projectAnimationTargetKey(target)}`;

export function createProjectAnimationTargetReview(input) {
  let view;
  try { view = queryProjectRuntimeObservation(input); } catch { throw invalid(); }
  if (view.project.protocolVersion !== 11) throw invalid();
  const project = view.project, groups = new Map(), commands = new Map(), commandGroups = new Map(), completionGroups = new Map();
  const groupFor = (visitIndex, sceneId, target, animation) => {
    const key = keyFor(visitIndex, sceneId, target);
    if (!groups.has(key)) groups.set(key, { key, visitIndex, sceneId, target, animation, commands: [], completions: [] });
    return groups.get(key);
  };
  for (const command of project.animationCommands.entries) {
    const group = groupFor(command.origin.visitIndex, command.origin.sceneId, command.target, command.animation);
    group.commands.push(command); commands.set(command.sequence, command); commandGroups.set(command.sequence, group.key);
  }
  for (const entry of project.animationCompletions.entries) {
    const group = groupFor(entry.visitIndex, entry.sceneId, entry.target, entry.animation);
    // Complete observation admission has already checked the target, visit,
    // source identities and this exact last-command anchor at the global cutoff.
    group.completions.push({ entry, anchorCommand: entry.targetCommandSequence === 0 ? null : commands.get(entry.targetCommandSequence) });
    completionGroups.set(entry.sequence, group.key);
  }
  const ordered = [...groups.values()].sort((a, b) => a.visitIndex - b.visitIndex || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const reviews = new Map(), descriptors = ordered.map(value => {
    const { key, visitIndex, sceneId, target, animation } = value;
    const group = freeze({ key, visitIndex, sceneId, target, animation, commandCount: value.commands.length, completionCount: value.completions.length });
    reviews.set(key, freeze({ group, commands: value.commands, completions: value.completions }));
    return group;
  });
  const model = freeze({ groups: descriptors });
  models.add(model); indexes.set(model, { reviews, commandGroups, completionGroups });
  return model;
}

export function queryProjectAnimationTargetReview(model, key) {
  if (!model || !models.has(model) || typeof key !== 'string' || !key) throw invalid();
  return indexes.get(model).reviews.get(key) || null;
}

export function findProjectAnimationTargetReview(model, kind, sequence) {
  if (!model || !models.has(model) || !['command', 'completion'].includes(kind)
    || !Number.isSafeInteger(sequence) || sequence < 1) throw invalid();
  const index = indexes.get(model);
  return (kind === 'command' ? index.commandGroups : index.completionGroups).get(sequence) || null;
}

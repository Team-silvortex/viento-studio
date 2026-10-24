// Read-only event review joins only explicit protocol 10 callback evidence.
// Delivery success, nearby commands and matching names never imply an entry.
import { queryProjectRuntimeObservation } from './project-runtime-query.mjs';
import { freezeProjectRuntimeData as freeze } from './project-runtime-contracts.mjs';

const models = new WeakSet(), indexes = new WeakMap();
const invalid = () => Object.assign(new TypeError('Invalid project event review.'), { errorCode: 'project_event_review_invalid' });
const key = (sequence, subscriptionId) => `${sequence}/${subscriptionId}`;

export function createProjectEventReview(input) {
  let view;
  try { view = queryProjectRuntimeObservation(input); } catch { throw invalid(); }
  const project = view.project, protocolVersion = project.protocolVersion;
  if (![3, 4, 5, 6, 7, 8, 9, 10, 11].includes(protocolVersion)) throw invalid();
  const entries = freeze(project.events.entries), associations = new Map();
  if (protocolVersion >= 10) {
    // Full observation admission has already checked callback uniqueness,
    // visit and source identities, pending order and retired subscriptions.
    for (const entry of project.animationStateEntries.entries) {
      if (entry.trigger.kind !== 'event') continue;
      associations.set(key(entry.trigger.eventSequence, entry.trigger.subscriptionId), freeze(entry));
    }
  }
  const model = Object.freeze({ protocolVersion, entries });
  models.add(model); indexes.set(model, associations);
  return model;
}

export function queryProjectEventReview(model, sequence) {
  if (!model || !models.has(model) || !Number.isSafeInteger(sequence) || sequence < 1) throw invalid();
  const event = model.entries.find(entry => entry.sequence === sequence);
  if (!event) return null;
  const associations = indexes.get(model);
  const deliveries = event.deliveries.map(delivery => {
    const entry = associations.get(key(sequence, delivery.subscriptionId));
    const animation = model.protocolVersion < 10 ? { status: 'unavailable-protocol' }
      : entry ? { status: 'recorded', entry } : { status: 'not-recorded' };
    return { delivery, animation };
  });
  return freeze({ event, deliveries });
}

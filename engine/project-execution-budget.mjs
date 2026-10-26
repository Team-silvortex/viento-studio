// Finite project execution admission is independent of protocol identities and
// retained observations. Backends share this policy; queues own live capacity.
export const PROJECT_EXECUTION_BUDGET_POLICY = Object.freeze({
  eventRegistrations: 1024,
  eventPublishes: 128,
  eventDeliveries: 1024,
  eventBytes: 524288,
  stateMutations: 1024,
  audioRequests: 256,
  animationRequests: 256,
});

const dimensions = Object.keys(PROJECT_EXECUTION_BUDGET_POLICY);

export function createProjectExecutionBudget() {
  const used = Object.fromEntries(dimensions.map(key => [key, 0]));
  return Object.freeze({
    reserve(costs) {
      // Read descriptors rather than values: admission must not invoke author
      // accessors or charge an earlier dimension before rejecting a later one.
      let properties, keys;
      try {
        if (costs === null || typeof costs !== 'object' || Array.isArray(costs)) return false;
        const prototype = Object.getPrototypeOf(costs);
        if (prototype !== Object.prototype && prototype !== null) return false;
        properties = Object.getOwnPropertyDescriptors(costs);
        keys = Reflect.ownKeys(properties);
      } catch { return false; }
      if (keys.length > dimensions.length) return false;
      for (const key of keys) {
        const descriptor = properties[key];
        if (typeof key !== 'string' || !Object.hasOwn(PROJECT_EXECUTION_BUDGET_POLICY, key)
          || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
          || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0
          || descriptor.value > PROJECT_EXECUTION_BUDGET_POLICY[key] - used[key]) return false;
      }
      for (const key of keys) used[key] += properties[key].value;
      return true;
    },
    snapshot() { return Object.freeze({ ...used }); },
  });
}

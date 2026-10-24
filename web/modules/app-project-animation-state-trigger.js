// Presentation of an already validated entry; never infer a cause from state,
// command order or an event name. Old observations deliberately have no trigger.
export function describeProjectAnimationStateEntryTrigger(entry, translate) {
  if (!entry.trigger) return translate('进入来源：未记录（协议 9）');
  switch (entry.trigger.kind) {
    case 'initial': return translate('进入来源：初始化回调');
    case 'event': return translate('进入来源：事件 #{0} · 订阅 {1}', entry.trigger.eventSequence, entry.trigger.subscriptionId);
    case 'completed': return translate('进入来源：自然完成 #{0} · 订阅 {1}', entry.trigger.completionSequence, entry.trigger.subscriptionId);
    case 'direct': return translate('进入来源：直接进入（无事件或完成回调上下文）');
  }
  throw new TypeError('Unsupported animation state entry trigger.');
}

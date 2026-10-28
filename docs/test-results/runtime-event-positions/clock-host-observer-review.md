# Clock host observer channel review

The original host assertion counted every progress callback after `phase: starting` and expected two calls. The independent trace records three distinct channels, in this order:

1. `phase: starting` from `runProjectBuild` before the native execution adapter starts.
2. `executionClock` with `phase: incomplete` from the clock reader's final snapshot.
3. `eventPositions` with `phase: incomplete` from the outer event-position reader's independent final snapshot, after the downstream clock observer throws.

There is exactly one final clock notification. The additional notification belongs to event positions; it does not represent a clock sample, a replayed business frame, or an engine run. The trace records `runStarted: false`, an empty zero-window clock, no publication or delivery facts, and a failed session with generic diagnostics.

The accepted correction narrows the legacy test assertions to each channel and retains the new incomplete event-position notification. Production clock, framing, event-position and host finalization code were not changed to satisfy this old combined counter assertion. The separate core regression also checks that final clock observer failure preserves event-position state without duplicating either channel or replaying business frames.

Evidence: [independent call stacks and DTO trace](clock-host-observer-trace.json), [57 passing core regression cases](core-clock-recovery.log), [initial full-check failure](full-check-first.log), and [updated channel-specific integration checks](targeted-final.log). These are mocked host/core observations; actual Godot frame validation remains in the separate native evidence.

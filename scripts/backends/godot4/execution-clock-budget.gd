extends RefCounted

# Observe engine scheduling clocks without changing the finite admission policy.
# A window is an observed idle/physics frame pair, never a causal transaction.
var _budget: RefCounted
var _clock: Dictionary = {}
var _base: Dictionary = {}
var _total: Dictionary = {}
var _index := 0
var _dirty := false
var _closed := false

func _init(budget: RefCounted) -> void:
	_budget = budget
	_total = budget.snapshot().duplicate()
	_base = _total.duplicate()

func _current_clock() -> Dictionary:
	return {"idleFrame": Engine.get_process_frames(), "physicsFrame": Engine.get_physics_frames()}

func _window(before: Dictionary) -> void:
	var next := _current_clock()
	if _index == 0 or next != _clock:
		flush_snapshot()
		_index += 1
		_clock = next
		_base = before.duplicate()

func reserve(costs) -> bool:
	if _closed:
		return false
	var before: Dictionary = _budget.snapshot()
	var accepted: bool = _budget.reserve(costs)
	var after: Dictionary = _budget.snapshot()
	if accepted and before == after:
		return true
	_window(before)
	_total = after.duplicate()
	_dirty = true
	if not accepted:
		flush_snapshot("rejected")
	return accepted

func snapshot() -> Dictionary:
	return _budget.snapshot()

# Coalesce successful admissions within a scheduling window. The monitor also
# flushes at engine callbacks; forced termination keeps the last received sample.
func flush_snapshot(reason: String = "sample") -> void:
	if _closed or (_index == 0 and reason == "sample") or (not _dirty and reason == "sample"):
		return
	if _index == 0:
		_index = 1
		_clock = _current_clock()
	var used: Dictionary = {}
	for key in _total:
		used[key] = _total[key] - _base[key]
	print("VIENTO_EXECUTION_CLOCK:" + JSON.stringify({"protocol": 1, "event": "sample", "index": _index,
		"clock": _clock, "used": used, "total": _total, "reason": reason}))
	_dirty = false

func close(completed: bool) -> void:
	if _closed:
		return
	flush_snapshot("finished" if completed else "aborted")
	_closed = true

extends RefCounted

# The host owns one finite-session admission ledger. Business revisions,
# sequence numbers and queue sizes remain owned by their existing services.
const DIMENSIONS := ["eventRegistrations", "eventPublishes", "eventDeliveries", "eventBytes", "stateMutations", "audioRequests", "animationRequests"]
const MAX_SAFE_INTEGER := 9007199254740991
var _limits: Dictionary = {}
var _used: Dictionary = {}
var _valid := false

func _init() -> void:
	for key in DIMENSIONS:
		_used[key] = 0
	var document = JSON.parse_string(FileAccess.get_file_as_string("res://execution-budget.json"))
	if typeof(document) != TYPE_DICTIONARY or document.get("format") != "viento-godot-execution-budget" or document.get("schemaVersion") != 1 or document.get("policyVersion") != 1 or document.get("scope") != "session":
		return
	var limits = document.get("limits")
	if typeof(limits) != TYPE_DICTIONARY or limits.size() != DIMENSIONS.size():
		return
	for key in DIMENSIONS:
		if not limits.has(key) or not _integer(limits[key]) or limits[key] <= 0:
			return
		_limits[key] = int(limits[key])
	_valid = true

func _integer(value) -> bool:
	if typeof(value) == TYPE_INT:
		return value >= 0 and value <= MAX_SAFE_INTEGER
	return typeof(value) == TYPE_FLOAT and is_finite(value) and value >= 0.0 and value <= float(MAX_SAFE_INTEGER) and floor(value) == value

# Check the complete vector before committing any dimension. Pending capacity
# and input validation are performed by each service before it asks to reserve.
func reserve(costs) -> bool:
	if not _valid or typeof(costs) != TYPE_DICTIONARY:
		return false
	for key in costs:
		if typeof(key) != TYPE_STRING or not _limits.has(key) or not _integer(costs[key]) or costs[key] > _limits[key] - _used[key]:
			return false
	for key in costs:
		_used[key] += int(costs[key])
	return true

func snapshot() -> Dictionary:
	var result := _used.duplicate()
	result.make_read_only()
	return result

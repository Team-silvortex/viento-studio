extends Node

# Autoload connects before the generated coordinator enters the tree, so its
# ordinary _ready, author callbacks and all inherited runtime variants share
# the same observed ledger. No existing runtime source or author port changes.
var _owner: WeakRef
var _budget: RefCounted

func _enter_tree() -> void:
	get_tree().root.child_entered_tree.connect(_attach)

func _attach(node: Node) -> void:
	if node.name != "VientoProject" or _budget != null:
		return
	_owner = weakref(node)
	_budget = preload("res://execution-clock-budget.gd").new(node.execution_budget)
	node.execution_budget = _budget
	node.tree_exiting.connect(_finalize)

func _process(_delta: float) -> void:
	if _budget != null:
		_budget.flush_snapshot()

func _physics_process(_delta: float) -> void:
	if _budget != null:
		_budget.flush_snapshot()

func _finalize() -> void:
	var owner = _owner.get_ref()
	_budget.close(owner != null and owner.finished and not owner.failed)

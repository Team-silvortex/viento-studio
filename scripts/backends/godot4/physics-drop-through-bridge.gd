extends "res://movement-contacts-base-helper.gd"

# Commands and facts share the existing movement hooks. The historical helper
# still owns contact collection, signal order, and the reentry guards.
var drop_through = preload("res://drop-through-helper.gd").new()

func attach(scene: Node, binding: Dictionary, behavior: Node) -> void:
	super.attach(scene, binding, behavior)
	drop_through.attach(scene, binding, behavior)

func begin(scene: Node) -> void:
	super.begin(scene)
	if stepping:
		drop_through.begin(scene)

func sample(scene: Node, character: CharacterBody2D, contacts: Array) -> void:
	drop_through.sample(scene, character, contacts)
	super.sample(scene, character, contacts)

func finish(scene: Node) -> void:
	drop_through.finish(scene)
	super.finish(scene)

func revoke() -> void:
	drop_through.revoke()
	super.revoke()

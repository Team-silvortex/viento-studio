extends "res://character-intent-original-contacts.gd"

var intent = preload("res://character-intent-helper.gd").new()

func attach(scene: Node, binding: Dictionary, behavior: Node) -> void:
	super.attach(scene, binding, behavior)
	intent.attach(scene, binding, behavior)

func begin(scene: Node) -> void:
	super.begin(scene)
	if stepping:
		intent.begin(scene)

func revoke() -> void:
	intent.revoke()
	super.revoke()

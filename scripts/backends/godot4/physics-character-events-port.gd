extends RefCounted

# One behavior owns this scene-visit port. Native facts do not publish project
# events; the author decides which signals to forward through viento_project.
signal jumped
signal landed

func protocol_version() -> int:
	return 1

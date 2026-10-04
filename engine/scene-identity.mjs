// Scene occurrences use stable v2 instance IDs; legacy v1 occurrences retain
// their definition identity. Validation belongs to the scene model.
export const sceneActorIdentity = actor => actor?.instanceId ?? actor?.objectId;

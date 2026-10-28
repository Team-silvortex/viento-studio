import { inspectPhysicsReplayDocument, validatePhysicsReplayDocumentDependencies } from '../../engine/physics-replay-document.mjs';
import { createRuntimeAuthorDocumentService } from './runtime-author-documents.mjs';

export function createPhysicsReplayDocumentService(root, options) {
  return createRuntimeAuthorDocumentService(root, { prefix: 'runtime_physics_replay',
    inspect: inspectPhysicsReplayDocument, dependencies: validatePhysicsReplayDocumentDependencies, definition: value => value.replay }, options);
}

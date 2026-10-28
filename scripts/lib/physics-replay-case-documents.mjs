import { inspectPhysicsReplayCaseDocument, validatePhysicsReplayCaseDocumentDependencies } from '../../engine/physics-replay-case-document.mjs';
import { createRuntimeAuthorDocumentService } from './runtime-author-documents.mjs';

export function createPhysicsReplayCaseDocumentService(root, options) {
  return createRuntimeAuthorDocumentService(root, { prefix: 'runtime_physics_case',
    inspect: inspectPhysicsReplayCaseDocument, dependencies: validatePhysicsReplayCaseDocumentDependencies, definition: value => value.case }, options);
}

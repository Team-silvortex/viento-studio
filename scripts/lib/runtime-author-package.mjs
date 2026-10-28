// Resource package dependency dispatch. Distinct document formats retain their own validators.
import { runtimeCaseDocumentIds, validateRuntimeCaseDocumentDependencies } from '../../engine/runtime-case-document.mjs';
import { PHYSICS_REPLAY_DOCUMENT_FORMAT, physicsReplayDocumentIds, validatePhysicsReplayDocumentDependencies } from '../../engine/physics-replay-document.mjs';
import { PHYSICS_REPLAY_CASE_DOCUMENT_FORMAT, physicsReplayCaseDocumentIds, validatePhysicsReplayCaseDocumentDependencies } from '../../engine/physics-replay-case-document.mjs';
export const runtimeAuthorDocumentIds = value => value.format === PHYSICS_REPLAY_CASE_DOCUMENT_FORMAT
  ? physicsReplayCaseDocumentIds(value) : value.format === PHYSICS_REPLAY_DOCUMENT_FORMAT
  ? physicsReplayDocumentIds(value) : runtimeCaseDocumentIds(value);
export const validateRuntimeAuthorDocumentDependencies = (value, record, source) => value.format === PHYSICS_REPLAY_CASE_DOCUMENT_FORMAT
  ? validatePhysicsReplayCaseDocumentDependencies(value, record, source) : value.format === PHYSICS_REPLAY_DOCUMENT_FORMAT
  ? validatePhysicsReplayDocumentDependencies(value, record, source) : validateRuntimeCaseDocumentDependencies(value, record, source);

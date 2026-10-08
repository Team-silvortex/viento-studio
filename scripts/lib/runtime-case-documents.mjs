import { inspectRuntimeCaseDocument, validateRuntimeCaseDocumentDependencies } from '../../engine/runtime-case-document.mjs';
import { createRuntimeAuthorDocumentService } from './runtime-author-documents.mjs';

// The author writer is shared with suites; execution case DTOs stay separate.
export function createRuntimeCaseDocumentService(root, options) {
  return createRuntimeAuthorDocumentService(root, {
    prefix: 'runtime_case', inspect: inspectRuntimeCaseDocument,
    dependencies: validateRuntimeCaseDocumentDependencies, definition: value => value.case,
  }, options);
}

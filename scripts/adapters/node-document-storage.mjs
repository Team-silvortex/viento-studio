import { createRegisteredDocument } from '../lib/project-documents.mjs';
import { withRegistryLock } from '../lib/workspace.mjs';
import { readWorldFence, assertWorldFence } from '../lib/world-transaction-state.mjs';
import {
  withDocumentTransaction, documentContentVersion, readDocumentSnapshot, writeDocumentAtomically,
} from '../lib/doc-file-store.mjs';

export function createNodeDocumentStorage({ root, resolvePath }) {
  return {
    transaction: withDocumentTransaction,
    // Reads remain side-effect free. Existing source writes share the registry
    // lock with semantic commands; creation already takes it during registration.
    writeTransaction: (filePath, operation, { create }) => withDocumentTransaction(filePath,
      () => create ? operation() : withRegistryLock(root, operation)),
    async resolve(sourcePath, { create }) {
      const resolved = await resolvePath(sourcePath, { allowCreate: create });
      return resolved && { path: resolved.relativePath, exists: resolved.exists, handle: resolved.absolutePath };
    },
    async read(reference) {
      const fence = await readWorldFence(root);
      const { content, stats, version } = await readDocumentSnapshot(reference.handle);
      await assertWorldFence(root, fence);
      return { content, lastModified: stats.mtime.toISOString(), version, writeState: stats };
    },
    async write(reference, content, { create, previous, documentType }) {
      const writeSource = () => writeDocumentAtomically(reference.handle, content, {
        create, previousStats: previous?.writeState || null,
      });
      const stats = create
        ? await createRegisteredDocument(root, reference.path, documentType, writeSource)
        : await writeSource();
      return { lastModified: stats.mtime.toISOString(), version: documentContentVersion(content) };
    },
  };
}

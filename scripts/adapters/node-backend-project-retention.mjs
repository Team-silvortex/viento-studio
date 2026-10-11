import fs from 'node:fs/promises';
import path from 'node:path';
import { buildHash, readBuildFile, buildError } from './node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';

// Kept in memory by the creating host. Stored manifests never grant ownership.
export const PROJECT_RETENTION_PIN = Symbol('viento.backend-project.retention');

export async function createProjectRetentionPin(directory) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory) {
    throw buildError('backend_project_owner_changed', 'The owned project directory changed.');
  }
  return { directory, dev: stat.dev, ino: stat.ino, files: new Map(), directories: new Set(['']) };
}

export function pinProjectFile(pin, relative, bytes) {
  if (!pin) return;
  pin.files.set(relative, { size: Buffer.byteLength(bytes), sha256: buildHash(bytes) });
  for (let parent = path.posix.dirname(relative); parent !== '.'; parent = path.posix.dirname(parent)) pin.directories.add(parent);
}

export async function assertProjectOwnership(pin) {
  if (!pin) throw buildError('backend_project_owner_changed', 'This project has no creating-host ownership receipt.');
  const stat = await fs.lstat(pin.directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== pin.dev || stat.ino !== pin.ino
    || await fs.realpath(pin.directory) !== pin.directory) {
    throw buildError('backend_project_owner_changed', 'The owned project directory changed.');
  }
}

export async function inspectProjectRetention(pin) {
  try {
    await assertProjectOwnership(pin);
    const remaining = new Set(pin.files.keys());
    async function visit(relative) {
      const entries = await fs.readdir(await resolveContainedPath(pin.directory, path.join(pin.directory, relative)), { withFileTypes: true });
      for (const entry of entries) {
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink() || !entry.isFile() && !entry.isDirectory()) return 'backend_project_link';
        if (child === 'sessions' && entry.isDirectory()) return 'backend_project_sessions_retained';
        if (entry.isDirectory()) {
          if (!pin.directories.has(child)) return 'backend_project_extra_paths';
          const reason = await visit(child);
          if (reason) return reason;
        } else {
          const expected = pin.files.get(child);
          if (!expected || !remaining.delete(child)) return 'backend_project_extra_paths';
          const file = await resolveContainedPath(pin.directory, path.join(pin.directory, child));
          if ((await fs.lstat(file)).nlink !== 1) return 'backend_project_link';
          const bytes = await readBuildFile(file, expected.size);
          if (bytes.length !== expected.size || buildHash(bytes) !== expected.sha256) return 'backend_project_changed';
        }
      }
      return null;
    }
    const reason = await visit('');
    await assertProjectOwnership(pin);
    return { complete: !reason && !remaining.size, reason: reason || (remaining.size ? 'backend_project_changed' : null) };
  } catch (error) {
    return { complete: false, reason: error.errorCode === 'backend_project_owner_changed'
      ? 'backend_project_owner_changed' : 'backend_project_changed' };
  }
}

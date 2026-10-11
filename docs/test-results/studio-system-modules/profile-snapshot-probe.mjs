import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { applyProjectDefinition } from '../../../scripts/lib/project-definition.mjs';
import { readWorkspace, registerWorkspace } from '../../../scripts/lib/workspace.mjs';
import { WORKSPACE_LAYOUT } from '../../../scripts/lib/project-layout.mjs';

const destination = process.argv[2];
if (!destination) throw new Error('Supply a new evidence output path.');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-studio-profile-snapshot-'));
const originalStat = fs.stat;
const profile = { format: 'viento-studio-profile', schemaVersion: 1,
  required: [{ capability: 'document.edit', apiVersion: 1 }], optional: [] };
const approved = JSON.parse(JSON.stringify(profile));
let mutationInjected = false;
try {
  const types = [{ id: 'document', label: 'Document', directory: '', parserProfile: 'prose', template: 'document.md' }];
  for (const folder of ['documents', 'templates', 'assets', 'metadata']) await fs.mkdir(path.join(root, folder));
  await fs.writeFile(path.join(root, 'workspace.json'), JSON.stringify({ format: 'viento-workspace', version: 3,
    id: randomUUID(), name: 'Profile snapshot', createdAt: 0, ...WORKSPACE_LAYOUT, documentTypes: types }));
  await fs.writeFile(path.join(root, 'templates/document.md'), '# Document\r\n');
  await registerWorkspace(root);
  const definition = { format: 'viento-project-definition', version: 1, documentTypes: types, studioProfile: profile };
  fs.stat = async function (file, ...options) {
    if (String(file) === path.join(root, 'templates/document.md') && !mutationInjected) {
      mutationInjected = true;
      profile.required[0].apiVersion = 0;
      profile.required[0].capability = '../unvalidated';
    }
    return Reflect.apply(originalStat, this, [file, ...options]);
  };
  const result = await applyProjectDefinition(root, definition, { write: true });
  const saved = readWorkspace(root).studioProfile;
  const journal = JSON.parse(await fs.readFile(path.join(root, result.journal), 'utf8'));
  const evidence = {
    schemaVersion: 1, nodeVersion: process.version,
    sourceSha256: createHash('sha256').update(await fs.readFile(new URL('../../../scripts/lib/project-definition.mjs', import.meta.url))).digest('hex'),
    scope: 'Isolated Node API profile mutation at an awaited template stat; no external host or build tool.',
    mutationInjected, approved, callerAfter: profile, saved, journalProfile: journal.after.studioProfile,
    pass: mutationInjected && JSON.stringify(saved) === JSON.stringify(approved)
      && JSON.stringify(journal.after.studioProfile) === JSON.stringify(approved),
  };
  await fs.writeFile(destination, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ pass: evidence.pass, mutationInjected, destination }) + '\n');
  process.exitCode = evidence.pass ? 0 : 1;
} finally {
  fs.stat = originalStat;
  await fs.rm(root, { recursive: true, force: true });
}

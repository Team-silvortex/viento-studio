import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repo = process.env.VIENTO_COMPAT_REPO || '/home/chiharukiryu/cdev/viento-studio';
export const directory = path.dirname(fileURLToPath(import.meta.url));
export const moduleAt = relative => import(pathToFileURL(path.join(repo, relative)).href);
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const auditedPaths = [
  'engine/project-animation-preflight.mjs', 'engine/project-assembly-plan-contract.mjs',
  'engine/animation-state-script-source.mjs', 'engine/project-animation-states.mjs',
  'engine/build-target.mjs', 'engine/studio-core.mjs', 'engine/studio-core.wasm',
  'scripts/adapters/node-build-snapshot.mjs', 'scripts/adapters/node-project-build.mjs',
  'scripts/backends/godot4-project.mjs',
  'scripts/tests/helpers/project-animation-completion-fixture.mjs',
  'scripts/tests/helpers/project-animation-preflight-fixture.mjs',
];
async function hashes() {
  return Object.fromEntries(await Promise.all(auditedPaths.map(async name => [name, hash(await fs.readFile(path.join(repo, name)))])));
}
export async function startReport(name, scope) {
  const report = { name, scope, startedAt: new Date().toISOString(), repository: repo,
    node: { executable: process.execPath, version: process.version }, sourceSha256: await hashes(), cases: [] };
  console.log(JSON.stringify({ event: 'start', name, startedAt: report.startedAt, scope }));
  return report;
}
export function pass(report, details) {
  const item = { status: 'passed', ...details };
  report.cases.push(item); console.log(JSON.stringify({ event: 'case', ...item }));
}
export async function finishReport(report) {
  assert.deepEqual(await hashes(), report.sourceSha256, 'Audited source files changed while the probe was running.');
  report.completedAt = new Date().toISOString(); report.status = 'passed';
  report.sourceUnchangedDuringProbe = true;
  await fs.writeFile(path.join(directory, `${report.name}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ event: 'complete', name: report.name, status: report.status, cases: report.cases.length,
    sourceUnchangedDuringProbe: true, report: path.join(directory, `${report.name}.json`) }));
}
export function updateCapabilities(plan) {
  plan.requiredCapabilities = [...new Set(['project.scenes', ...plan.scenes.flatMap(scene => scene.requiredCapabilities)])].sort();
}
export function updateScriptRevisions(plan) {
  for (const scene of plan.scenes) for (const source of scene.behaviors?.sources || []) source.sourceRevision = `sha256:${hash(source.content)}`;
}
export function removeAnimations(plan) {
  for (const scene of plan.scenes) { delete scene.animation; scene.requiredCapabilities = scene.requiredCapabilities.filter(value => !value.startsWith('animation.')); }
}

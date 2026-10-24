import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { directory, hash } from './compatibility-common.mjs';

const names = ['compatibility-protocols', 'compatibility-optional-core', 'compatibility-frozen-restore'];
const reports = await Promise.all(names.map(async name => JSON.parse(await fs.readFile(path.join(directory, `${name}.json`), 'utf8'))));
for (let index = 0; index < names.length; index++) {
  assert.equal(reports[index].status, 'passed');
  assert.equal(reports[index].sourceUnchangedDuringProbe, true);
  const log = (await fs.readFile(path.join(directory, `${names[index]}.log`), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const completion = log.at(-1);
  assert.equal(completion.event, 'complete'); assert.equal(completion.status, 'passed');
  assert.equal(completion.cases, reports[index].cases.length);
  assert.deepEqual(reports[index].sourceSha256, reports[0].sourceSha256);
}
const artifactNames = ['compatibility-common.mjs', ...names.flatMap(name => [`${name}.mjs`, `${name}.log`, `${name}.json`]),
  'compatibility-optional-core.initial-harness-error.mjs', 'compatibility-optional-core.initial-harness-error.log'];
const artifactSha256 = Object.fromEntries(await Promise.all(artifactNames.map(async name => [name, hash(await fs.readFile(path.join(directory, name)))])));
const result = { format: 'viento-animation-preflight-compatibility-probes', schemaVersion: 1, status: 'passed',
  reportCreatedAt: new Date().toISOString(), repository: reports[0].repository,
  compatibilityCases: 9, additionalNegativeControls: 1,
  probes: reports.map(report => ({ name: report.name, cases: report.cases.length, scope: report.scope,
    log: path.join(directory, `${report.name}.log`), report: path.join(directory, `${report.name}.json`) })),
  sourceSha256: reports[0].sourceSha256, artifactSha256,
  reproduction: names.map(name => `node ${path.join(directory, `${name}.mjs`)} > ${path.join(directory, `${name}.log`)} 2>&1`),
  reproductionNotes: 'Run each probe in its own Node process. Set VIENTO_COMPAT_REPO to use another checkout. Re-run compatibility-summarize.mjs after rerunning the probes.',
  boundaries: [
    'Protocols 4, 7, 10, and 11 are read from actual generated backend output; preflight neither mutates input nor changes generated file bytes, source maps, resource paths, or backend metadata.',
    'Optional feature absence uses the actual base wasm instance with only the five optional animation-state version exports removed; scene-animation support remains available. Ordinary and unmarked legacy scripts are tested with and without scene animation.',
    'Frozen restore uses the real readFrozenProjectBuild and full author source plus a synthetic succeeded-record header. It proves restore-reader admission with a missing local named UUID, not historical compiled artifact or runtime playback compatibility.',
    'Frozen restore runs after live author deletion and calls no adapter operation. Fresh capture of the same author data rejects the missing local clip, including its exact frozen source identity and source range.',
    'No repository production files were changed and no unit or workflow suite was rerun for these probes.',
    'The earlier no-Godot workflow-test failure belongs to a separate owner correction; these compatibility probe logs are not replacement workflow-suite evidence.',
  ],
  probeHarnessCorrection: { affected: 'compatibility-optional-core negative control only',
    initialExpectedErrorCode: 'studio_core_animation_state_table_unavailable', actualAndCorrectedExpectedErrorCode: 'studio_core_unavailable',
    productFailure: false, note: 'All four ordinary/unmarked acceptance cases passed on both runs. The initial harness asserted a nonexistent error-code spelling; its script and raw failure log are preserved.' },
};
await fs.writeFile(path.join(directory, 'compatibility-report.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: 'passed', compatibilityCases: result.compatibilityCases, additionalNegativeControls: result.additionalNegativeControls,
  report: path.join(directory, 'compatibility-report.json'), artifactCount: Object.keys(artifactSha256).length }));

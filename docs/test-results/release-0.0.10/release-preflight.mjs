import fs from 'node:fs/promises';
import { collectFiles } from '../../../scripts/lib/scan-files.mjs';
import { runCommand } from '../../../scripts/lib/process.mjs';
import { runDocApiContractPreflight } from '../../../scripts/lib/verify-doc-api-contract.mjs';
import { verifyReleaseVersions } from '../../../desktop/version.mjs';

const release = await verifyReleaseVersions();
const files = (await Promise.all(['engine', 'scripts', 'web', 'mobile'].map(root => collectFiles(root, {
  relativeBase: root, excludedRoots: ['mobile/dist'], isAccepted: name => /\.(?:mjs|js)$/.test(name),
})))).flat();
let cursor = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < files.length) await runCommand(process.execPath, ['--check', files[cursor++]]);
}));
await runDocApiContractPreflight();
const result = {
  ok: true, version: release.version, node: process.version, syntaxFiles: files.length,
  versionPreflight: true, apiPreflight: true,
  scope: 'Release-only syntax/version/API checks; no compilation, preparation or full application suite rerun.',
};
await fs.writeFile(new URL('./preflight.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));

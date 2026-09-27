import path from 'node:path';
import fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createWorldQueryService } from './adapters/node-world-projection.mjs';
import { createWorldCommandService } from './adapters/node-world-commands.mjs';
import { recoverWorldTransaction } from './lib/world-transactions.mjs';
import { readTransactionStatus } from './lib/world-transaction-state.mjs';

export async function runWorldQuery(argv) {
  const { values } = parseArgs({ args: argv, strict: true, options: {
    root: { type: 'string' }, command: { type: 'string' }, request: { type: 'string' },
    object: { type: 'string' }, search: { type: 'string' }, type: { type: 'string' }, revision: { type: 'string' },
    recover: { type: 'boolean' }, 'transaction-status': { type: 'boolean' },
  } });
  if (!values.root) throw new Error('Usage: npm run world -- --root <workspace> [--command world.inspect|object.list|object.inspect|world.validate] [--object <id>] [--search <text>] [--type <typeRef>] [--revision <sha256:...>]');
  if (values.recover || values['transaction-status']) {
    const flag = values.recover ? 'recover' : 'transaction-status';
    if (Object.keys(values).some(key => !['root', flag].includes(key))) throw new Error(`--${flag} cannot be combined with other flags`);
    if (values.recover) return recoverWorldTransaction(path.resolve(values.root));
    const { pending, receipt } = await readTransactionStatus(path.resolve(values.root));
    return { pending, receipt };
  }
  if (values.request !== undefined) {
    if (Object.keys(values).some(key => !['root', 'request'].includes(key))) throw new Error('--request cannot be combined with query flags');
    const limit = 1024 * 1024;
    let bytes;
    if (values.request === '-') {
      const chunks = []; let size = 0;
      for await (const chunk of process.stdin) {
        size += chunk.length; if (size > limit) throw new Error('Command request exceeds 1 MiB');
        chunks.push(chunk);
      }
      bytes = Buffer.concat(chunks);
    } else {
      if ((await fs.stat(values.request)).size > limit) throw new Error('Command request exceeds 1 MiB');
      bytes = await fs.readFile(values.request);
    }
    if (bytes.length > limit) throw new Error('Command request exceeds 1 MiB');
    return createWorldCommandService(path.resolve(values.root))(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  }
  const query = { command: values.command || 'world.inspect' };
  for (const [flag, key] of [['object', 'objectId'], ['search', 'search'], ['type', 'typeRef'], ['revision', 'expectedRevision']]) {
    if (values[flag] !== undefined) query[key] = values[flag];
  }
  return createWorldQueryService(path.resolve(values.root))(query);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWorldQuery(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(JSON.stringify({ ok: false, error: error.message, errorCode: error.errorCode || 'world_query_invalid', ...error.payload }));
    process.exitCode = 1;
  });
}

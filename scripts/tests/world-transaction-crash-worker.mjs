import fs from 'node:fs/promises';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { recoverWorldTransaction } from '../lib/world-transactions.mjs';

const [root, input, point, item] = process.argv.slice(2);
const checkpoint = async (stage, detail) => {
  if (stage !== point || item !== '-' && detail.index !== Number(item)) return;
  process.send({ stage, detail });
  await new Promise(() => {}); // Parent SIGKILLs this real process at the boundary.
};
try {
  const result = input === 'recover' ? await recoverWorldTransaction(root, { checkpoint })
    : await createWorldCommandService(root, { checkpoint })(JSON.parse(await fs.readFile(input)));
  process.send({ unexpectedCompletion: result });
  process.disconnect();
} catch (error) { console.error(error); process.exitCode = 1; process.disconnect(); }

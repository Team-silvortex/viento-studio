import fs from 'node:fs/promises';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { recoverWorldTransaction } from '../lib/world-transactions.mjs';

const [root, input, point, item] = process.argv.slice(2);
const checkpoint = async (stage, detail) => {
  if (stage !== point || item !== '-' && detail.index !== Number(item)) return;
  // A pending promise does not keep Node alive: without a referenced handle,
  // the worker can exit before the parent observes its still-held registry lock.
  const keepAlive = setInterval(() => {}, 60000);
  const disconnected = () => { clearInterval(keepAlive); process.exit(0); };
  process.once('disconnect', disconnected);
  try {
    process.send({ stage, detail });
    await new Promise(() => {}); // Parent SIGKILLs this real process at the boundary.
  } finally {
    clearInterval(keepAlive); process.removeListener('disconnect', disconnected);
  }
};
try {
  const result = input === 'recover' ? await recoverWorldTransaction(root, { checkpoint })
    : await createWorldCommandService(root, { checkpoint })(JSON.parse(await fs.readFile(input)));
  process.send({ unexpectedCompletion: result });
  process.disconnect();
} catch (error) { console.error(error); process.exitCode = 1; process.disconnect(); }

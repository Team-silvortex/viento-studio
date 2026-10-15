import fs from 'node:fs/promises';
import { createWorldCommandService } from '../../adapters/node-world-commands.mjs';

const [root, requestFile] = process.argv.slice(2);
const send = message => new Promise(resolve => process.send(message, resolve));
try {
  const result = await createWorldCommandService(root)(JSON.parse(await fs.readFile(requestFile)));
  await send({ result });
} catch (error) {
  process.exitCode = 1;
  await send({ failure: { errorCode: error.errorCode || 'worker_failed', statusCode: error.statusCode || 500 } });
} finally { process.disconnect(); }

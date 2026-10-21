import { verifyCase } from './benchmark/acceptance-worker.mjs';
const result = await verifyCase(process.argv[2], process.argv[3]);
console.log(JSON.stringify(result));
process.exitCode = result.passed ? 0 : 1;

// Short-lived launcher used to prove survival after its parent exits; no inference.
import { launchSupervised } from '../pilot-supervision.mjs';
const result = launchSupervised({
  privateDir: process.argv[2],
  reports: process.argv[3],
  fixture: process.argv[4],
});
process.stdout.write(JSON.stringify(result));

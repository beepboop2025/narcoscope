import { readFileSync } from 'node:fs';

const receipt = JSON.parse(readFileSync('/ci-build-receipt.json', 'utf8'));
if (receipt.status !== 'PASS' || receipt.source !== process.env.RAILWAY_GIT_COMMIT_SHA) {
  throw Error('Runtime source does not match the completed build gate');
}
console.log(JSON.stringify(receipt));
console.log(`RAILWAY_CI_PASS source=${receipt.source} deployment=${process.env.RAILWAY_DEPLOYMENT_ID ?? 'unavailable'}`);

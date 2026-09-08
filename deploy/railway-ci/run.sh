#!/bin/sh
set -eu
cd /app
test -z "${GITHUB_TOKEN:-}${GH_TOKEN:-}${RAILWAY_TOKEN:-}${RAILWAY_API_TOKEN:-}${CLOUDFLARE_API_TOKEN:-}"
node -e 'if(process.versions.node.split(".")[0]!=="20")throw Error("Node20 workflow parity required")'
npm test -- --coverage
npm run build
node --input-type=module - <<'JS'
import { writeFileSync } from 'node:fs';
const source = process.env.RAILWAY_GIT_COMMIT_SHA;
if (!/^[a-f0-9]{40}$/.test(source ?? '')) throw Error('Missing exact source identity');
const receipt = { status: 'PASS', source, node: process.version,
  jobs: ['npm ci', 'npm test -- --coverage', 'npm run build'] };
writeFileSync('/ci-build-receipt.json', JSON.stringify(receipt) + '\n');
console.log(`RAILWAY_CI_BUILD_PASS source=${source}`);
JS

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(process.cwd(), 'test-results', 'generated-codes.json');

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * Records a generated code (e.g. a campaign's viral code) so it can be
 * printed in the console/report and picked up later, e.g. by a Validate test.
 */
function recordCode({ source, programId, campaignId, code }) {
  const store = loadStore();
  store.push({
    source,        // e.g. 'campaign' | 'batch'
    programId,
    campaignId,
    code,
    generatedAt: new Date().toISOString(),
  });
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  console.log(`[generated-code] source=${source} programId=${programId} code=${code}`);
  return code;
}

function getAllCodes() {
  return loadStore();
}

module.exports = { recordCode, getAllCodes, STORE_PATH };

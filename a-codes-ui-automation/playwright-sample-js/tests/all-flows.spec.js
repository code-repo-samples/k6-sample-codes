// all-flows.spec.js
// ---------------------------------------------------------------
// ONE file, every stage as its own tagged test. Run any single stage or
// any combination via Playwright's --grep, and login ALWAYS happens first
// regardless of which tags you pick, because it runs in beforeAll rather
// than as a filterable test itself.
//
// Examples:
//   npx playwright test tests/all-flows.spec.js --grep "@organization"
//   npx playwright test tests/all-flows.spec.js --grep "@realtime"
//   npx playwright test tests/all-flows.spec.js --grep "@program"
//   npx playwright test tests/all-flows.spec.js --grep "@program|@release"
//   npx playwright test tests/all-flows.spec.js --grep "@program|@campaign"
//   npx playwright test tests/all-flows.spec.js            (no grep = everything)
//
// Convenience npm scripts for the common combos are in package.json
// (npm run test:flow:organization, test:flow:realtime, etc.) - or run the
// generic one with your own tag expression:
//   npm run test:flow -- "@program|@campaign"
//
// SELF-HEALING PREREQUISITES: if you ask for just "@batch" without "@lot",
// the batch flow notices there's no lot yet and creates one for you first
// (which in turn creates a release, which creates a program) - see each
// flows/*.js file's ensure___() function. To skip that auto-creation and
// point a stage at real existing data instead, fill in the "existingIds"
// block in test-data/test-config.json.
//
// Each stage still gets its own tiny test.describe() purely so the
// dashboard report (scripts/generate-report.js) keeps per-feature grouping
// even though everything lives in one file and one shared page/session.
// ---------------------------------------------------------------

const { test } = require('@playwright/test');

const { login } = require('../flows/loginFlow');
const { ensureProgram, editProgram } = require('../flows/programFlow');
const { ensurePromotion } = require('../flows/promotionFlow');
const { ensureRelease, editRelease } = require('../flows/releaseFlow');
const { ensureLot, editLot } = require('../flows/lotFlow');
const { ensureBatch } = require('../flows/batchFlow');
const { ensureCampaign, editCampaign } = require('../flows/campaignFlow');
const { createOrganization } = require('../flows/organizationFlow');
const { openRealTimeTest } = require('../flows/realTimeTestFlow');
const { validateLatestCode } = require('../flows/validateFlow');
const { createClosureList } = require('../flows/closureMatrixFlow');
const { downloadCodes } = require('../flows/downloadCodesFlow');
const { uploadPublicKey } = require('../flows/gpgUploadFlow');

test.describe.configure({ mode: 'serial' });

/** @type {import('@playwright/test').Page} */
let page;
const journey = {}; // shared state: programId, releaseId, lotId, batchId, campaignId, viralCode, ...

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await login(page); // ALWAYS runs - not tag-filterable, this is the one mandatory step
});

test.afterAll(async () => {
  await page.close();
});

test.describe('Create Program', () => {
  test('create a new program from parameter file', { tag: '@program' }, async () => {
    await ensureProgram(page, journey);
  });
});

test.describe('Edit Program', () => {
  test('edit the program', { tag: '@editprogram' }, async () => {
    await editProgram(page, journey);
  });
});

test.describe('Create Promotion', () => {
  test('create a promotion mapped to the program', { tag: '@promotion' }, async () => {
    await ensurePromotion(page, journey);
  });
});

test.describe('Create Release', () => {
  test('create a release for the program', { tag: '@release' }, async () => {
    await ensureRelease(page, journey);
  });
});

test.describe('Edit Release', () => {
  test('edit the release', { tag: '@editrelease' }, async () => {
    await editRelease(page, journey);
  });
});

test.describe('Create Lot', () => {
  test('create a lot for the release', { tag: '@lot' }, async () => {
    await ensureLot(page, journey);
  });
});

test.describe('Edit Lot', () => {
  test('edit the lot', { tag: '@editlot' }, async () => {
    await editLot(page, journey);
  });
});

test.describe('Create Batch', () => {
  test('create a batch and trigger code generation', { tag: '@batch' }, async () => {
    await ensureBatch(page, journey);
  });
});

test.describe('Campaigns', () => {
  test('create a campaign and capture the generated code', { tag: '@campaign' }, async () => {
    await ensureCampaign(page, journey);
  });

  test('edit the campaign', { tag: '@editcampaign' }, async () => {
    await editCampaign(page, journey);
  });
});

test.describe('Organizations', () => {
  test('create a new organization', { tag: '@organization' }, async () => {
    await createOrganization(page);
  });
});

test.describe('Real Time Test', () => {
  test('open Real Time Test page', { tag: '@realtime' }, async () => {
    await openRealTimeTest(page);
  });
});

test.describe('Validate', () => {
  test('validate the most recently generated code', { tag: '@validate' }, async () => {
    await validateLatestCode(page);
  });
});

test.describe('Closure Matrix', () => {
  test('create a new closure list', { tag: '@closurematrix' }, async () => {
    await createClosureList(page);
  });
});

test.describe('Download Codes', () => {
  test('download the codes file', { tag: '@download' }, async () => {
    await downloadCodes(page);
  });
});

test.describe('GPG Upload', () => {
  test('upload a public key file', { tag: '@gpg' }, async () => {
    await uploadPublicKey(page);
  });
});

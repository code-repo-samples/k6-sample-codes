// other-pages.spec.js
// ---------------------------------------------------------------
// These stay OUTSIDE e2e-program-journey.spec.js on purpose:
//
//   - Validate needs a code that's actually finished generating. The batch
//     code-gen job in the journey can take 5-10 minutes to complete even
//     after `waitForCodeGenComplete()` returns (that just confirms the batch
//     itself finished - downstream code availability can lag further).
//     Chaining Validate directly after the journey risks a flaky "code not
//     found yet" failure that has nothing to do with a real bug.
//   - Organizations, Closure Matrix, Real Time Test, Queued Requests,
//     Download Codes, and GPG Upload are independent areas of the app that
//     don't depend on (or feed into) the program/release/lot/batch chain.
//
// Run this file on its own, ideally well after the journey has completed:
//   npx playwright test tests/other-pages.spec.js
//
// Validate reads the most recently generated code from
// test-results/generated-codes.json (written by the journey's Campaigns
// stage) if one is available, falling back to TEST_VALID_CODE from .env
// otherwise - see getLatestGeneratedCode() below.
// ---------------------------------------------------------------

const { test, expect } = require('@playwright/test');
const config = require('../test-data/test-config.json');
const { getAllCodes } = require('../utils/generatedCodesStore');
const path = require('path');

const { NavigationBar } = require('../pages/NavigationBar');
const { OrganizationsPage } = require('../pages/OrganizationsPage');
const { ValidatePage } = require('../pages/ValidatePage');
const { ClosureMatrixPage } = require('../pages/ClosureMatrixPage');
const { RealTimeTestPage } = require('../pages/RealTimeTestPage');
const { QueuedRequestsPage } = require('../pages/QueuedRequestsPage');
const { DownloadCodesPage } = require('../pages/DownloadCodesPage');
const { GpgUploadPage } = require('../pages/GpgUploadPage');

function getLatestGeneratedCode() {
  const codes = getAllCodes();
  if (codes.length === 0) return null;
  return codes[codes.length - 1]; // { source, programId, campaignId, code, generatedAt }
}

test.describe('Organizations', () => {
  test('create a new organization', { tag: '@positive' }, async ({ page }) => {
    const nav = new NavigationBar(page);
    const organizationsPage = new OrganizationsPage(page);

    await test.step('Open Organizations page', async () => {
      await nav.goTo('Organisations');
      await organizationsPage.expectOnPage();
    });

    await test.step('Create new organization', async () => {
      await organizationsPage.createOrganization(`TestOrg-${Date.now()}`);
    });
  });
});

test.describe('Validate', () => {
  test('accepts a real generated code (or env fallback)', { tag: '@positive' }, async ({ page }) => {
    const nav = new NavigationBar(page);
    const validatePage = new ValidatePage(page);

    const latest = getLatestGeneratedCode();
    const codeToTest = latest ? latest.code : process.env.TEST_VALID_CODE;

    test.skip(!codeToTest, 'No generated code available yet and TEST_VALID_CODE is not set in .env');

    await test.step('Navigate to Validate page', async () => {
      await nav.goTo('Validate');
      await validatePage.expectOnPage();
    });

    await test.step('Select the program the code belongs to', async () => {
      // VERIFY: if using a generated code, ideally select by latest.programId
      // rather than a hardcoded name once ProgramsPage exposes a name-by-ID lookup.
      await validatePage.selectProgram('Program Test'); // VERIFY: exact program name
    });

    await test.step('Enter code and validate', async () => {
      await validatePage.validateCode(codeToTest);
    });

    await test.step('Confirm success result', async () => {
      await validatePage.expectResultContains('Valid'); // VERIFY: exact success copy
    });
  });

  test('rejects an invalid code with a clear error', { tag: '@negative' }, async ({ page }) => {
    const nav = new NavigationBar(page);
    const validatePage = new ValidatePage(page);

    await test.step('Navigate to Validate page', async () => {
      await nav.goTo('Validate');
      await validatePage.expectOnPage();
    });

    await test.step('Select a program', async () => {
      await validatePage.selectProgram('Program Test'); // VERIFY: exact program name
    });

    await test.step('Enter a garbage code and validate', async () => {
      await validatePage.validateCode('NOTAREALCODE123');
    });

    await test.step('Confirm an "incorrect code" error is shown', async () => {
      await validatePage.expectResultContains('Incorrect code'); // VERIFY: exact result text
    });
  });
});

test.describe('Closure Matrix', () => {
  test('create a new closure list', { tag: '@positive' }, async ({ page }) => {
    const closureMatrixPage = new ClosureMatrixPage(page);

    await test.step('Create closure list with flavors', async () => {
      await closureMatrixPage.createClosureList(`TestList-${Date.now()}`, ['Coke Zero', 'Coke Zero Cherry']); // VERIFY
    });
  });
});

test.describe('Real Time Test', () => {
  test('open Real Time Test page', { tag: '@positive' }, async ({ page }) => {
    const nav = new NavigationBar(page);
    const realTimeTestPage = new RealTimeTestPage(page);

    await test.step('Navigate to Real Time Test', async () => {
      await nav.goTo('Real Time Test');
      await realTimeTestPage.expectOnPage();
    });
  });
});

test.describe('Queued Requests', () => {
  test('view queued requests page', { tag: '@positive' }, async ({ page }) => {
    const nav = new NavigationBar(page);
    const queuedRequestsPage = new QueuedRequestsPage(page);

    await test.step('Navigate to Queued Requests', async () => {
      await nav.goTo('Queued Requests');
      await queuedRequestsPage.expectOnPage();
    });
  });
});

test.describe('Download Codes & Public Key', () => {
  test('download codes file and open public key page', { tag: '@positive' }, async ({ page }) => {
    const downloadCodesPage = new DownloadCodesPage(page);

    await test.step('Download codes file', async () => {
      const download = await downloadCodesPage.downloadCodes();
      await downloadCodesPage.expectFilenameMatches(download, /Part_1/); // VERIFY: filename pattern
    });

    await test.step('Open Public Key page', async () => {
      await downloadCodesPage.openPublicKey();
    });
  });
});

test.describe('GPG Public Key Upload', () => {
  test('upload a public key file with a date range', { tag: '@positive' }, async ({ page }) => {
    const gpgUploadPage = new GpgUploadPage(page);
    const filePath = path.join(process.cwd(), config.gpgUpload.filePath);

    await test.step('Open upload page, upload file, pick dates, submit', async () => {
      await gpgUploadPage.uploadPublicKey({
        filePath,
        fromDate: config.gpgUpload.fromDate,
        toDate: config.gpgUpload.toDate,
      });
    });
  });

  test('rejects submit with no file selected', { tag: '@negative' }, async ({ page }) => {
    const gpgUploadPage = new GpgUploadPage(page);

    await test.step('Open upload page and submit without a file', async () => {
      await gpgUploadPage.goto();
      await gpgUploadPage.selectDateRange(config.gpgUpload.fromDate, config.gpgUpload.toDate);
      await gpgUploadPage.submit();
    });

    await test.step('Confirm a validation error is shown', async () => {
      // VERIFY: exact error copy/selector for "no file selected"
      await expect(page.getByText(/select a file|file is required/i)).toBeVisible();
    });
  });
});

// full-flow.spec.js
// ---------------------------------------------------------------
// Same end-to-end flow as before, but every section now goes through
// its own Page Object (pages/*.js) instead of raw page.getByRole calls
// inline - matching the //Login //Programs //Promotions //Validate etc.
// comment segregation from the original recording.
//
// `// VERIFY:` comments inside the page objects mark spots that were
// unclear in the source photos - confirm against the real app / codegen.
// ---------------------------------------------------------------

const { test, expect } = require('@playwright/test');

const { LoginPage } = require('../pages/LoginPage');
const { NavigationBar } = require('../pages/NavigationBar');
const { ProgramsPage } = require('../pages/ProgramsPage');
const { CreateProgramModal } = require('../pages/CreateProgramModal');
const { ProgramDetailPage } = require('../pages/ProgramDetailPage');
const { PromotionsPage } = require('../pages/PromotionsPage');
const { RealTimeTestPage } = require('../pages/RealTimeTestPage');
const { ValidatePage } = require('../pages/ValidatePage');
const { ClosureMatrixPage } = require('../pages/ClosureMatrixPage');
const { OrganizationsPage } = require('../pages/OrganizationsPage');
const { CampaignsPage } = require('../pages/CampaignsPage');
const { DownloadCodesPage } = require('../pages/DownloadCodesPage');
const { QueuedRequestsPage } = require('../pages/QueuedRequestsPage');

test.describe('Login', () => {
  test('sign in and land on portal home', { tag: '@positive' }, async ({ page }) => {
    const login = new LoginPage(page);

    await test.step('Open login page', async () => {
      await login.goto();
    });

    await test.step('Sign in with Google', async () => {
      await login.loginWithGoogle(
        process.env.TEST_USER_EMAIL || '',
        process.env.TEST_USER_PASSWORD || ''
      );
    });

    await test.step('Confirm portal home loaded', async () => {
      await login.expectLoggedIn();
    });
  });

  test('shows an error for an incorrect password', { tag: '@negative' }, async ({ page }) => {
    const login = new LoginPage(page);

    await test.step('Open login page', async () => {
      await login.goto();
    });

    await test.step('Attempt sign in with a wrong password', async () => {
      await login.signInWithGoogleBtn.click();
      await login.emailInput.fill(process.env.TEST_USER_EMAIL || '');
      await login.nextBtn.click();
      await expect(login.page.getByRole('heading', { name: 'Enter password' })).toBeVisible();
      await login.passwordInput.fill('definitely-the-wrong-password');
      await login.nextBtn.click();
    });

    await test.step('Confirm an inline error is shown and user stays on login', async () => {
      // VERIFY: exact error copy (e.g. "Wrong password. Try again.")
      await expect(page.getByText(/wrong password/i)).toBeVisible();
      await expect(login.signInBtn).toBeHidden();
    });
  });
});

test.describe('Create Program', () => {
  test('create a new program with market, character set, and whitelist', { tag: '@positive' }, async ({ page }) => {
    const nav = new NavigationBar(page);
    const programsPage = new ProgramsPage(page);
    const modal = new CreateProgramModal(page);

    await test.step('Open Programs page', async () => {
      await nav.goTo('Programs');
      await expect(programsPage.createNewBtn).toBeVisible();
    });

    await test.step('Open Create New Program modal', async () => {
      await programsPage.openCreateNewProgram();
      await expect(modal.dialog).toBeVisible();
    });

    await test.step('Fill program details and market', async () => {
      await modal.fillProgramDetails({
        name: 'testprogram',
        description: 'OT', // VERIFY: field/value
        startDate: '2026-09-16T00:00:00',
        endDate: '2026-10-31T00:00:00',
        activeMarket: 'United States',
        ownerGroup: 'QA-Team',
      });
    });

    await test.step('Configure character set and view examples', async () => {
      await modal.selectCharacterSet({ digits: true }); // VERIFY: which columns
      await modal.showExamplesBtn.click();
    });

    await test.step('Save program', async () => {
      await modal.save();
    });
  });

  test('rejects saving with no program name', { tag: '@negative' }, async ({ page }) => {
    const nav = new NavigationBar(page);
    const programsPage = new ProgramsPage(page);
    const modal = new CreateProgramModal(page);

    await test.step('Open Create New Program modal', async () => {
      await nav.goTo('Programs');
      await programsPage.openCreateNewProgram();
      await expect(modal.dialog).toBeVisible();
    });

    await test.step('Leave Program Name blank and try to save', async () => {
      await modal.programDescription.fill('missing name on purpose');
      const error = await modal.saveAndGetValidationError();
      expect(error).toBeTruthy(); // VERIFY: exact required-field error text
      await expect(modal.dialog).toBeVisible(); // modal must not close on invalid save
    });
  });

  test('rejects an end date before the start date', { tag: '@negative' }, async ({ page }) => {
    const nav = new NavigationBar(page);
    const programsPage = new ProgramsPage(page);
    const modal = new CreateProgramModal(page);

    await test.step('Open Create New Program modal', async () => {
      await nav.goTo('Programs');
      await programsPage.openCreateNewProgram();
      await expect(modal.dialog).toBeVisible();
    });

    await test.step('Fill an end date earlier than the start date', async () => {
      await modal.fillProgramDetails({
        name: 'bad-date-range-program',
        startDate: '2026-10-31T00:00:00',
        endDate: '2026-09-16T00:00:00', // before start - invalid
        activeMarket: 'United States',
        ownerGroup: 'QA-Team',
      });
    });

    await test.step('Confirm validation error and no program created', async () => {
      const error = await modal.saveAndGetValidationError();
      expect(error).toMatch(/end date/i); // VERIFY: exact error copy
    });
  });
});

test.describe('Release, Lots & Batches', () => {
  test('edit program, create a release, add a lot and a batch', { tag: '@positive' }, async ({ page }) => {
    const detailPage = new ProgramDetailPage(page);

    await test.step('Open a program for editing', async () => {
      await detailPage.openEdit();
    });

    await test.step('Create a new release', async () => {
      await detailPage.createRelease('Release01', '01', '29'); // VERIFY: exact days
    });

    await test.step('Edit release date', async () => {
      await detailPage.editReleaseDate();
    });

    await test.step('Expand release row and add a lot', async () => {
      await detailPage.expandFirstRow();
      await detailPage.addLot('Lot001');
    });

    await test.step('Expand lot row and add a batch', async () => {
      await detailPage.addBatch(1000);
    });
  });

  test('rejects creating a release with no name', { tag: '@negative' }, async ({ page }) => {
    const detailPage = new ProgramDetailPage(page);

    await test.step('Open a program for editing', async () => {
      await detailPage.openEdit();
    });

    await test.step('Attempt to create a release with a blank name', async () => {
      const error = await detailPage.attemptCreateReleaseWithNoName();
      expect(error).toBeTruthy(); // VERIFY: exact required-field error text
    });
  });
});

test.describe('Promotions', () => {
  test('create a new promotion and open it', { tag: '@positive' }, async ({ page }) => {
    const nav = new NavigationBar(page);
    const promotionsPage = new PromotionsPage(page);

    await test.step('Open Promotions page', async () => {
      await nav.goTo('Promotions');
      await promotionsPage.expectOnPage();
    });

    await test.step('Create a new promotion', async () => {
      await promotionsPage.createPromotion('Promotion01', 28); // VERIFY: exact day
    });

    await test.step('Open the created promotion', async () => {
      await promotionsPage.openPromotionByName('Promotion01');
    });
  });

  test('rejects creating a promotion with no name', { tag: '@negative' }, async ({ page }) => {
    const nav = new NavigationBar(page);
    const promotionsPage = new PromotionsPage(page);

    await test.step('Open Promotions page', async () => {
      await nav.goTo('Promotions');
      await promotionsPage.expectOnPage();
    });

    await test.step('Attempt to save with a blank name', async () => {
      const error = await promotionsPage.attemptCreateWithNoName();
      expect(error).toBeTruthy(); // VERIFY: exact required-field error text
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

test.describe('Validate', () => {
  test('accepts a valid, unused code', { tag: '@positive' }, async ({ page }) => {
    const nav = new NavigationBar(page);
    const validatePage = new ValidatePage(page);

    await test.step('Navigate to Validate page', async () => {
      await nav.goTo('Validate');
      await validatePage.expectOnPage();
    });

    await test.step('Select a program', async () => {
      await validatePage.selectProgram('Program Test'); // VERIFY: exact program name
    });

    await test.step('Enter a real, unused code and validate', async () => {
      await validatePage.validateCode(process.env.TEST_VALID_CODE || 'REPLACE_WITH_REAL_CODE');
    });

    await test.step('Confirm success result', async () => {
      // VERIFY: exact success copy (e.g. "Valid code", "Winner", etc.)
      await validatePage.expectResultContains('Valid');
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

  test('rejects a code with no program selected', { tag: '@negative' }, async ({ page }) => {
    const nav = new NavigationBar(page);
    const validatePage = new ValidatePage(page);

    await test.step('Navigate to Validate page without selecting a program', async () => {
      await nav.goTo('Validate');
      await validatePage.expectOnPage();
    });

    await test.step('Try to validate without picking a program first', async () => {
      await expect(validatePage.validateCodeBtn).toBeDisabled(); // VERIFY: disabled vs. shows its own error
    });
  });
});

test.describe('Closure Matrix', () => {
  test('create a new closure list', { tag: '@positive' }, async ({ page }) => {
    const closureMatrixPage = new ClosureMatrixPage(page);

    await test.step('Create closure list with flavors', async () => {
      await closureMatrixPage.createClosureList('TestList01', ['Coke Zero', 'Coke Zero Cherry']); // VERIFY
    });
  });
});

test.describe('Organizations', () => {
  test('create a new organization', { tag: '@positive' }, async ({ page }) => {
    const nav = new NavigationBar(page);
    const organizationsPage = new OrganizationsPage(page);

    await test.step('Open Organizations page', async () => {
      await nav.goTo('Organisations');
      await organizationsPage.expectOnPage();
    });

    await test.step('Create new organization', async () => {
      await organizationsPage.createOrganization('TestOrg01'); // VERIFY: org name value
    });

    await test.step('Confirm organization appears in grid', async () => {
      await organizationsPage.expectOrgInGrid('TestOrg01');
    });
  });

  test('rejects a duplicate organization name', { tag: '@negative' }, async ({ page }) => {
    const nav = new NavigationBar(page);
    const organizationsPage = new OrganizationsPage(page);

    await test.step('Open Organizations page', async () => {
      await nav.goTo('Organisations');
      await organizationsPage.expectOnPage();
    });

    await test.step('Attempt to create an org with an already-used name', async () => {
      // assumes 'TestOrg01' already exists from the positive test / seed data
      const error = await organizationsPage.attemptCreateDuplicate('TestOrg01');
      expect(error).toMatch(/already exists|duplicate/i); // VERIFY: exact error copy
    });
  });
});

test.describe('Campaigns', () => {
  test('create a new campaign under a program', { tag: '@positive' }, async ({ page }) => {
    const campaignsPage = new CampaignsPage(page);

    await test.step('Open a program and go to Campaigns tab', async () => {
      await page.getByRole('cell', { name: 'Program01' }).click(); // VERIFY: program row name
      await campaignsPage.openTab();
    });

    await test.step('Create new campaign', async () => {
      await campaignsPage.createCampaign('TTT1', 28); // VERIFY: campaign name / day
    });
  });
});

test.describe('Download Codes & Public Key', () => {
  test('download codes file and public key', { tag: '@positive' }, async ({ page }) => {
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

test.describe('Queued Requests', () => {
  test('view queued requests page', { tag: '@positive' }, async ({ page }) => {
    const nav = new NavigationBar(page);
    const queuedRequestsPage = new QueuedRequestsPage(page);

    await test.step('Navigate to Queued Requests', async () => {
      await nav.goTo('Queued Requests');
      await queuedRequestsPage.expectOnPage();
    });

    await test.step('Confirm a pending PS3 public key update entry', async () => {
      await queuedRequestsPage.expectEntryContains('Update PS3 Public Key File'); // VERIFY
    });
  });
});

test.describe('Logout', () => {
  test('log out of the portal', { tag: '@positive' }, async ({ page }) => {
    const nav = new NavigationBar(page);

    await test.step('Click Logout', async () => {
      await nav.logout();
    });
  });
});

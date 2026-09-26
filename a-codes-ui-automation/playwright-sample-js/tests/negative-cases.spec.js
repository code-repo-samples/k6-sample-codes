// negative-cases.spec.js
// ---------------------------------------------------------------
// Unlike e2e-program-journey.spec.js, these do NOT need to share state or
// run in order - each is a self-contained "try the wrong thing, confirm the
// app rejects it" scenario, so they use the normal per-test `page` fixture
// and can run in any order (or in parallel, if you flip fullyParallel later).
//
// NOTE: the "Login" describe deliberately does NOT log in via beforeEach -
// it needs to start from a logged-out state to test the login form itself.
// Every other describe below DOES log in first (scoped to that describe only),
// since Program/Release/Promotion screens require an authenticated session.
// ---------------------------------------------------------------

const { test, expect } = require('@playwright/test');

const { LoginPage } = require('../pages/LoginPage');
const { NavigationBar } = require('../pages/NavigationBar');
const { ProgramsPage } = require('../pages/ProgramsPage');
const { CreateProgramModal } = require('../pages/CreateProgramModal');
const { ProgramDetailPage } = require('../pages/ProgramDetailPage');
const { PromotionsPage } = require('../pages/PromotionsPage');

test.describe('Login', () => {
  test('shows an error for an incorrect password', { tag: '@negative' }, async ({ page }) => {
    const login = new LoginPage(page);

    await test.step('Open login page', async () => {
      await login.goto();
    });

    await test.step('Attempt sign in with a wrong password', async () => {
      const username = process.env.LOGIN_USERNAME || 'test-account@example.com';
      const errorShown = await login.attemptLoginWithWrongPassword(username, 'definitely-wrong-password');
      expect(errorShown).toBe(true);
    });
  });
});

test.describe('Create Program', () => {
  test.beforeEach(async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.loginWithEnvCredentials();
    await login.expectLoggedIn();
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
      await expect(modal.dialog).toBeVisible();
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
        name: `bad-date-range-${Date.now()}`,
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
  test.beforeEach(async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.loginWithEnvCredentials();
    await login.expectLoggedIn();
  });

  test('rejects creating a release with no name', { tag: '@negative' }, async ({ page }) => {
    const detailPage = new ProgramDetailPage(page);

    await test.step('Open a program for editing', async () => {
      // NOTE: assumes at least one program already exists to open - point this
      // at a known fixture/seed program rather than the journey's dynamic one.
      await detailPage.openEdit();
    });

    await test.step('Attempt to create a release with a blank name', async () => {
      const error = await detailPage.attemptCreateReleaseWithNoName();
      expect(error).toBeTruthy(); // VERIFY: exact required-field error text
    });
  });
});

test.describe('Promotions', () => {
  test.beforeEach(async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.loginWithEnvCredentials();
    await login.expectLoggedIn();
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

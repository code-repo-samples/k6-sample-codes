const { test, expect } = require('@playwright/test');
const { LoginPage } = require('../pages/LoginPage');
const { ProgramsPage } = require('../pages/ProgramsPage');
const { CreateProgramModal } = require('../pages/CreateProgramModal');
const { ProgramDetailPage } = require('../pages/ProgramDetailPage');

// NOTE: the outermost describe title becomes the "functional area" name
// in the dashboard report (see scripts/generate-report.js). Group specs
// by feature (e.g. 'Create Program', 'Risk Calculator', 'Release Accordion')
// rather than by page, since flows here span multiple pages/modals.
test.describe('Create Program', () => {

  test.beforeEach(async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.loginWithEnvCredentials();
    await login.expectLoggedIn();
  });

  test('create a new program end-to-end and verify release accordion', { tag: '@positive' }, async ({ page }) => {
    const programsPage = new ProgramsPage(page);
    const modal = new CreateProgramModal(page);
    const detailPage = new ProgramDetailPage(page);

    const programName = `Automation-${Date.now()}`;

    await test.step('Open Programs page', async () => {
      await programsPage.goto();
      await expect(page).toHaveURL(/\/programs$/);
    });

    await test.step('Open Create New Program modal', async () => {
      await programsPage.openCreateNewProgram();
      await expect(modal.dialog).toBeVisible();
    });

    await test.step('Fill program details', async () => {
      await modal.fillProgramDetails({
        name: programName,
        description: 'Created by Playwright automation',
        startDate: '2026-09-16T00:00:00',
        endDate: '2026-10-31T00:00:00',
        activeMarket: 'US',
        ownerGroup: 'QA-Team',
      });
    });

    await test.step('Set redemption rules and toggles', async () => {
      await modal.setRedemptionRules(25, 1, 'Days (Rolling)');
      await modal.toggleProfanityCheck(true);
    });

    await test.step('Run risk calculator and confirm gauge renders', async () => {
      await modal.runRiskCheck();
    });

    await test.step('Select character set (digits + uppercase)', async () => {
      await modal.selectCharacterSet({ digits: true, upper: true });
    });

    await test.step('Save program and confirm it appears in the list', async () => {
      await modal.save();
      await expect(modal.dialog).toBeHidden();
      await expect(page.getByRole('cell', { name: programName })).toBeVisible();
    });

    await test.step('Open new program and expand its first release', async () => {
      await programsPage.openProgramByName(programName);
      await expect(page.getByRole('heading', { name: programName })).toBeVisible();

      const releaseId = await detailPage.releaseRow('').locator('td').first().innerText();
      await detailPage.expandRelease(releaseId);

      const lots = await detailPage.getLotDetails(releaseId);
      expect(lots.allotedCodes).toContain('Alloted codes:');
    });
  });

  test('cancel button discards unsaved program', { tag: '@positive' }, async ({ page }) => {
    const programsPage = new ProgramsPage(page);
    const modal = new CreateProgramModal(page);

    await test.step('Open modal, partially fill, then cancel', async () => {
      await programsPage.goto();
      await programsPage.openCreateNewProgram();
      await modal.programName.fill('Should not be saved');
      await modal.cancelBtn.click();
      await expect(modal.dialog).toBeHidden();
    });
  });

});

// login-and-program.spec.js
// ---------------------------------------------------------------
// A small, self-contained smoke test: just Login + Create Program.
// Does NOT touch Release/Lot/Batch/Campaign - use this when you only
// need to confirm login + basic program creation still work, without
// running the full chained journey.
// ---------------------------------------------------------------

const { test, expect } = require('@playwright/test');
const config = require('../test-data/test-config.json');

const { LoginPage } = require('../pages/LoginPage');
const { NavigationBar } = require('../pages/NavigationBar');
const { ProgramsPage } = require('../pages/ProgramsPage');
const { CreateProgramModal } = require('../pages/CreateProgramModal');

test.describe('Login + Program', () => {
  test('login and create a new program', { tag: '@positive' }, async ({ page }) => {
    const login = new LoginPage(page);
    const nav = new NavigationBar(page);
    const programsPage = new ProgramsPage(page);
    const modal = new CreateProgramModal(page);

    await test.step('Login via SSO/IAP', async () => {
      await login.goto();
      await login.loginWithEnvCredentials();
      await login.expectLoggedIn();
    });

    await test.step('Open Programs page', async () => {
      await nav.goTo('Programs');
      await expect(programsPage.createNewBtn).toBeVisible();
    });

    await test.step('Create a new program from config', async () => {
      await programsPage.openCreateNewProgram();
      await expect(modal.dialog).toBeVisible();
      const programName = await modal.fillFromConfig(config.program);
      await modal.save();

      await programsPage.goto();
      const programId = await programsPage.getProgramIdByName(programName);
      console.log(`[login-and-program] created ${programName} (${programId})`);
    });
  });
});

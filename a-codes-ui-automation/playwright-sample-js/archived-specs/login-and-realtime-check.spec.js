// login-and-realtime-check.spec.js
// ---------------------------------------------------------------
// A small, self-contained smoke test: just Login + a "check a code right
// now" flow. Two candidate pages are included below since "realtime code
// check" could mean either - delete whichever one you don't need:
//   1. The "Real Time Test" page (exact nav link name)
//   2. The "Validate" page (pick a program, enter a code, see the result)
// ---------------------------------------------------------------

const { test, expect } = require('@playwright/test');
const { getAllCodes } = require('../utils/generatedCodesStore');

const { LoginPage } = require('../pages/LoginPage');
const { NavigationBar } = require('../pages/NavigationBar');
const { RealTimeTestPage } = require('../pages/RealTimeTestPage');
const { ValidatePage } = require('../pages/ValidatePage');

function getLatestGeneratedCode() {
  const codes = getAllCodes();
  return codes.length ? codes[codes.length - 1] : null;
}

test.describe('Login + Real Time Test', () => {
  test('login and open Real Time Test page', { tag: '@positive' }, async ({ page }) => {
    const login = new LoginPage(page);
    const nav = new NavigationBar(page);
    const realTimeTestPage = new RealTimeTestPage(page);

    await test.step('Login via SSO/IAP', async () => {
      await login.goto();
      await login.loginWithEnvCredentials();
      await login.expectLoggedIn();
    });

    await test.step('Navigate to Real Time Test', async () => {
      await nav.goTo('Real Time Test');
      await realTimeTestPage.expectOnPage();
    });
  });
});

test.describe('Login + Validate', () => {
  test('login and validate a code', { tag: '@positive' }, async ({ page }) => {
    const login = new LoginPage(page);
    const nav = new NavigationBar(page);
    const validatePage = new ValidatePage(page);

    const latest = getLatestGeneratedCode();
    const codeToTest = latest ? latest.code : process.env.TEST_VALID_CODE;
    test.skip(!codeToTest, 'No generated code available and TEST_VALID_CODE is not set in .env');

    await test.step('Login via SSO/IAP', async () => {
      await login.goto();
      await login.loginWithEnvCredentials();
      await login.expectLoggedIn();
    });

    await test.step('Navigate to Validate page', async () => {
      await nav.goTo('Validate');
      await validatePage.expectOnPage();
    });

    await test.step('Select program and validate the code', async () => {
      await validatePage.selectProgram('Program Test'); // VERIFY: exact program name
      await validatePage.validateCode(codeToTest);
    });

    await test.step('Confirm result', async () => {
      await validatePage.expectResultContains('Valid'); // VERIFY: exact success copy
    });
  });
});

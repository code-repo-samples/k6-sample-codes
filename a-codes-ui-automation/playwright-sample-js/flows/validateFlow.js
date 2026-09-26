const { NavigationBar } = require('../pages/NavigationBar');
const { ValidatePage } = require('../pages/ValidatePage');
const { getAllCodes } = require('../utils/generatedCodesStore');

async function validateLatestCode(page) {
  const codes = getAllCodes();
  const codeToTest = codes.length ? codes[codes.length - 1].code : process.env.TEST_VALID_CODE;
  if (!codeToTest) {
    throw new Error(
      'No generated code available in test-results/generated-codes.json and TEST_VALID_CODE is not set in .env'
    );
  }

  const nav = new NavigationBar(page);
  const validatePage = new ValidatePage(page);

  await nav.goTo('Validate');
  await validatePage.expectOnPage();
  await validatePage.selectProgram('Program Test'); // VERIFY: exact program name
  await validatePage.validateCode(codeToTest);
  await validatePage.expectResultContains('Valid'); // VERIFY: exact success copy
}

module.exports = { validateLatestCode };

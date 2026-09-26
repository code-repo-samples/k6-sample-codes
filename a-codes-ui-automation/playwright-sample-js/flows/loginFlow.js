const { LoginPage } = require('../pages/LoginPage');

async function login(page) {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.loginWithEnvCredentials();
  await loginPage.expectLoggedIn();
}

module.exports = { login };

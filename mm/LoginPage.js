const { expect } = require('@playwright/test');

class LoginPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.signInWithGoogleBtn = page.getByRole('button', { name: 'Sign in with Google' });
    this.emailInput = page.getByRole('textbox', { name: 'Email or phone' });
    this.nextBtn = page.getByRole('button', { name: 'Next' });
    this.passwordInput = page.getByRole('textbox', { name: 'Enter your password' });
    this.signInBtn = page.getByRole('button', { name: 'Sign in' });
    this.welcomeHeading = page.getByRole('heading');
  }

  async goto() {
    await this.page.goto('/');
  }

  async loginWithGoogle(email, password) {
    await this.signInWithGoogleBtn.click();
    await this.emailInput.fill(email);
    await this.nextBtn.click();
    await expect(this.page.getByRole('heading', { name: 'Enter password' })).toBeVisible();
    await this.passwordInput.fill(password);
    await this.nextBtn.click();
    await this.signInBtn.click();
  }

  async expectLoggedIn() {
    // VERIFY: exact welcome heading text
    await expect(this.welcomeHeading).toContainText('Welcome to Coke Real World Codes Portal');
  }
}

module.exports = { LoginPage };

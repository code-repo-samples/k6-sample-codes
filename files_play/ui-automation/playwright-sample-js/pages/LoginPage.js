const { expect } = require('@playwright/test');

/**
 * Models the SSO / IAP login flow:
 *   Landing page -> "Sign in" (redirects to IAP) -> username -> Next
 *   -> password -> Next/Sign in -> redirected back to the portal landing page.
 *
 * Credentials come from environment variables (.env, loaded by playwright.config.js
 * via dotenv) - never hardcode them here.
 */
class LoginPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.signInBtn = page.getByRole('button', { name: /sign in/i });
    this.usernameInput = page.getByRole('textbox', { name: /email or phone|username/i });
    this.nextBtn = page.getByRole('button', { name: 'Next' });
    this.passwordInput = page.getByRole('textbox', { name: /password/i });
    this.landingHeading = page.getByRole('heading');
  }

  async goto() {
    await this.page.goto('/');
  }

  /**
   * Logs in using LOGIN_USERNAME / LOGIN_PASSWORD from the environment.
   * Throws early with a clear message if they aren't set, rather than
   * failing confusingly deep inside a fill() call.
   */
  async loginWithEnvCredentials() {
    const username = process.env.LOGIN_USERNAME;
    const password = process.env.LOGIN_PASSWORD;
    if (!username || !password) {
      throw new Error(
        'LOGIN_USERNAME / LOGIN_PASSWORD are not set. Copy .env.example to .env and fill them in.'
      );
    }
    await this.login(username, password);
  }

  async login(username, password) {
    await this.signInBtn.click();
    // VERIFY: IAP may show an org/account chooser screen before the username field
    await this.usernameInput.fill(username);
    await this.nextBtn.click();

    await expect(this.page.getByRole('heading', { name: /enter password/i })).toBeVisible();
    await this.passwordInput.fill(password);
    await this.nextBtn.click();
  }

  async expectLoggedIn() {
    // VERIFY: exact welcome heading text on the portal landing page
    await expect(this.landingHeading).toContainText('Welcome to Coke Real World Codes Portal');
  }

  /** Negative case: attempts login with the given (bad) password and returns whether an error appeared. */
  async attemptLoginWithWrongPassword(username, wrongPassword) {
    await this.signInBtn.click();
    await this.usernameInput.fill(username);
    await this.nextBtn.click();
    await expect(this.page.getByRole('heading', { name: /enter password/i })).toBeVisible();
    await this.passwordInput.fill(wrongPassword);
    await this.nextBtn.click();
    // VERIFY: exact error copy (e.g. "Wrong password. Try again.")
    return this.page.getByText(/wrong password|incorrect password/i).isVisible();
  }
}

module.exports = { LoginPage };

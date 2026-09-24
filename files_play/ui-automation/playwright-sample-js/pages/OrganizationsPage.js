const { expect } = require('@playwright/test');

class OrganizationsPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.createOrgBtn = page.getByRole('button', { name: 'create organisation' });
    this.saveBtn = page.getByRole('button', { name: 'Save' });
  }

  async expectOnPage() {
    await expect(this.page.getByRole('heading', { name: 'My Organisations' })).toBeVisible();
  }

  async createOrganization(name) {
    await this.createOrgBtn.click();
    await expect(this.page.getByRole('heading', { name: 'Create new organisation' })).toBeVisible();

    await this.page.getByRole('checkbox').check(); // VERIFY: which checkbox (e.g. "active")
    await this.page.getByRole('textbox').first().fill(name);
    await this.saveBtn.click();
  }

  async expectOrgInGrid(name) {
    await expect(this.page.getByRole('grid')).toContainText(name);
  }

  /** Attempts to create an org with a name that (per the test) already exists. */
  async attemptCreateDuplicate(name) {
    await this.createOrgBtn.click();
    await this.page.getByRole('checkbox').check();
    await this.page.getByRole('textbox').first().fill(name);
    await this.saveBtn.click();
    const errorLocator = this.page.locator('[role="alert"], .error-message, .Mui-error'); // VERIFY
    if (await errorLocator.count()) return errorLocator.first().innerText();
    return null;
  }
}

module.exports = { OrganizationsPage };

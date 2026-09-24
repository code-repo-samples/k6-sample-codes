const { expect } = require('@playwright/test');

class ClosureMatrixPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.createNewClosureMatrixBtn = page.getByRole('button', { name: 'Create New ClosureMatrix' });
    this.saveBtn = page.getByRole('button', { name: 'Save' });
  }

  async createClosureList(name, flavors) {
    await this.createNewClosureMatrixBtn.click();
    await expect(this.page.getByRole('main')).toContainText('Create a new Closure List');

    await this.page.getByRole('textbox').first().fill(name); // VERIFY: field/value

    for (const flavor of flavors) {
      await this.page.getByRole('option', { name: flavor }).click();
    }

    await this.saveBtn.click();
  }
}

module.exports = { ClosureMatrixPage };

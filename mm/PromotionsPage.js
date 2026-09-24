const { expect } = require('@playwright/test');

class PromotionsPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.createNewPromotionBtn = page.getByRole('button', { name: 'Create New Promotion' });
    this.chooseDateBtn = page.getByRole('button', { name: 'Choose date' });
    this.okBtn = page.getByRole('button', { name: 'OK' });
    this.saveBtn = page.getByRole('button', { name: 'Save' });
    this.dialog = page.getByRole('dialog');
  }

  async expectOnPage() {
    await expect(this.page.getByRole('main')).toContainText('Create New Promotion');
  }

  async createPromotion(name, day) {
    await this.createNewPromotionBtn.click();
    await expect(this.page.getByRole('banner')).toContainText('Create New Promotion');
    await this.page.getByRole('textbox').first().fill(name);

    await this.chooseDateBtn.click();
    await this.page.getByRole('gridcell', { name: String(day) }).click(); // VERIFY: exact day
    await this.okBtn.click();

    await this.saveBtn.click();
    await expect(this.dialog).toContainText(name);
  }

  async openPromotionByName(name) {
    await this.page.getByRole('link', { name: new RegExp(`Promotion #${name}`) }).click();
  }

  /** Opens Create New Promotion, leaves the name blank, tries Save, returns error text if any. */
  async attemptCreateWithNoName() {
    await this.createNewPromotionBtn.click();
    await this.saveBtn.click();
    const errorLocator = this.page.locator('[role="alert"], .error-message, .Mui-error'); // VERIFY
    if (await errorLocator.count()) return errorLocator.first().innerText();
    return null;
  }
}

module.exports = { PromotionsPage };

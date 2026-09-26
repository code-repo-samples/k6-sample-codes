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

  /**
   * Creates a promotion mapped to a specific program (needed before batch
   * creation, since the batch step selects an existing promotion by name).
   * Returns { promotionId, promotionName }.
   */
  async createPromotionForProgram({ programName, name, startDay, endDay }) {
    await this.createNewPromotionBtn.click();
    await expect(this.page.getByRole('banner')).toContainText('Create New Promotion');

    await this.page.getByLabel('Program').click(); // VERIFY: exact label for the program picker
    await this.page.getByRole('option', { name: programName }).click();

    await this.page.getByRole('textbox').first().fill(name);

    await this.chooseDateBtn.click();
    await this.page.getByRole('gridcell', { name: String(startDay) }).click(); // VERIFY
    await this.okBtn.click();

    await this.page.getByRole('button', { name: 'Choose date' }).nth(1).click();
    await this.page.getByRole('gridcell', { name: String(endDay) }).click(); // VERIFY
    await this.okBtn.click();

    await this.saveBtn.click();
    await expect(this.dialog).toContainText(name);

    const row = this.page.getByRole('row', { name: new RegExp(name) });
    const promotionId = (await row.locator('td').first().innerText()).trim(); // VERIFY: ID column index
    return { promotionId, promotionName: name };
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

const { expect } = require('@playwright/test');

/**
 * Models the "Create New Program" modal seen across 3 scrollable sections:
 *  1. Program details (text fields, timezone/market/owner dropdowns, date pickers)
 *  2. Redemption rules (max attempts / per / period) + Profanity/Checksum checkboxes
 *     + Risk Calculator (Check Risk button, Show Examples link)
 *  3. Character set configuration (3 columns of checkboxes: digits / lowercase / uppercase)
 */
class CreateProgramModal {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.dialog = page.getByRole('dialog').filter({ hasText: 'Create New Program' });

    // Step 1
    this.programName = this.dialog.getByLabel('Program Name');
    this.programDescription = this.dialog.getByLabel('Program Description');
    this.startDateTimezone = this.dialog.getByLabel('Start Date Timezone');
    this.startDate = this.dialog.getByLabel('Start Date');
    this.endDateTimezone = this.dialog.getByLabel('End Date Timezone');
    this.endDate = this.dialog.getByLabel('End Date');
    this.activeMarket = this.dialog.getByLabel('Active Market');
    this.ownerGroup = this.dialog.getByLabel('Owner Group');

    // Redemption rules
    this.maxValidAttempts = this.dialog.getByLabel('Max valid attempts');
    this.perValue = this.dialog.locator('input').nth(0); // adjust: unlabeled "per" input
    this.periodDropdown = this.dialog.getByLabel('period');
    this.profanityCheckbox = this.dialog.getByRole('checkbox', { name: 'Enable Profanity Check' });
    this.luhnsChecksumCheckbox = this.dialog.getByRole('checkbox', { name: /Add Checksum Using Luhns/i });

    // Risk calculator
    this.checkRiskBtn = this.dialog.getByRole('button', { name: 'CHECK RISK' });
    this.showExamplesBtn = this.dialog.getByRole('button', { name: 'SHOW EXAMPLES' });
    this.riskGauge = this.dialog.locator('[data-testid="risk-gauge"]'); // adjust to real selector

    // Character set config
    this.selectAllDigits = this.dialog.getByRole('checkbox', { name: 'Select All' }).nth(0);
    this.selectAllLower = this.dialog.getByRole('checkbox', { name: 'Select All' }).nth(1);
    this.selectAllUpper = this.dialog.getByRole('checkbox', { name: 'Select All' }).nth(2);

    this.saveBtn = this.dialog.getByRole('button', { name: 'SAVE' });
    this.cancelBtn = this.dialog.getByRole('button', { name: 'CANCEL' });
  }

  async fillProgramDetails(data) {
    await this.programName.fill(data.name);
    if (data.description) await this.programDescription.fill(data.description);
    await this.startDate.fill(data.startDate);
    await this.endDate.fill(data.endDate);
    await this.activeMarket.click();
    await this.page.getByRole('option', { name: data.activeMarket }).click();
    await this.ownerGroup.click();
    await this.page.getByRole('option', { name: data.ownerGroup }).click();
  }

  async setRedemptionRules(maxAttempts, per, period) {
    await this.maxValidAttempts.fill(String(maxAttempts));
    await this.periodDropdown.click();
    await this.page.getByRole('option', { name: period }).click();
  }

  async toggleProfanityCheck(enable) {
    if (enable) await this.profanityCheckbox.check();
    else await this.profanityCheckbox.uncheck();
  }

  async runRiskCheck() {
    await this.checkRiskBtn.click();
    await expect(this.riskGauge).toBeVisible();
  }

  async selectCharacterSet(opts = {}) {
    if (opts.digits) await this.selectAllDigits.check();
    if (opts.lower) await this.selectAllLower.check();
    if (opts.upper) await this.selectAllUpper.check();
  }

  async save() {
    await this.saveBtn.click();
  }

  /** Attempts save and returns the visible validation error text, if any. */
  async saveAndGetValidationError() {
    await this.saveBtn.click();
    const errorLocator = this.dialog.locator('[role="alert"], .error-message, .Mui-error'); // VERIFY: real error selector
    if (await errorLocator.count()) {
      return errorLocator.first().innerText();
    }
    return null;
  }

  async expectFieldError(field, message) {
    const fieldError = this.dialog.locator(`text=${field}`).locator('..').locator('[role="alert"], .error-message');
    await expect(fieldError).toContainText(message);
  }
}

module.exports = { CreateProgramModal };

const { expect } = require('@playwright/test');

/**
 * Public Key (GPG) upload page: pick a file, pick a from/to date range,
 * click Submit. Selectors below are placeholders - swap in real
 * xpaths/locators once you have them (see class comment for how).
 */
class GpgUploadPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;

    // VERIFY: replace with real locators. If you only have xpaths, use
    // page.locator('xpath=//your/xpath/here') in place of any line below.
    this.fileInput = page.locator('input[type="file"]');
    this.fromDateInput = page.getByLabel('From Date');
    this.toDateInput = page.getByLabel('To Date');
    this.submitBtn = page.getByRole('button', { name: 'Submit' });
    this.successMessage = page.getByText(/success|uploaded/i);
  }

  async goto() {
    await this.page.goto('/public-key'); // VERIFY: real route/path
  }

  async uploadFile(filePath) {
    await this.fileInput.setInputFiles(filePath);
  }

  /** Dates as 'YYYY-MM-DD' or whatever format the date picker input expects. */
  async selectDateRange(fromDate, toDate) {
    await this.fromDateInput.fill(fromDate);
    await this.toDateInput.fill(toDate);
  }

  async submit() {
    await this.submitBtn.click();
  }

  async expectUploadSucceeded() {
    await expect(this.successMessage).toBeVisible();
  }

  /** One-call convenience wrapper for the whole flow. */
  async uploadPublicKey({ filePath, fromDate, toDate }) {
    await this.goto();
    await this.uploadFile(filePath);
    await this.selectDateRange(fromDate, toDate);
    await this.submit();
    await this.expectUploadSucceeded();
  }
}

module.exports = { GpgUploadPage };

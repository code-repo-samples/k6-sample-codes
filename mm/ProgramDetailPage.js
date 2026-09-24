const { expect } = require('@playwright/test');

class ProgramDetailPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.releasesTab = page.getByRole('tab', { name: 'Releases' });
    this.campaignsTab = page.getByRole('tab', { name: 'Campaigns' });
    this.searchReleaseInput = page.getByPlaceholder('Search Release by Name or Id');
    this.createNewReleaseBtn = page.getByRole('button', { name: /create new release/i });
  }

  releaseRow(releaseId) {
    return this.page.getByRole('row', { name: new RegExp(releaseId) });
  }

  async expandRelease(releaseId) {
    const row = this.releaseRow(releaseId);
    await row.locator('button[aria-expanded]').click(); // chevron/expand toggle
    await expect(row.locator('button[aria-expanded="true"]')).toBeVisible();
  }

  async getLotDetails(releaseId) {
    const panel = this.page.locator(`[data-release-id="${releaseId}"] >> text=Lots`).locator('..');
    return {
      name: await panel.locator('text=Name:').innerText(),
      allotedCodes: await panel.locator('text=Alloted codes:').innerText(),
    };
  }

  async getBatchOrgField(releaseId) {
    const panel = this.page.locator(`[data-release-id="${releaseId}"] >> text=Batches`).locator('..');
    return panel.locator('text=Org:').innerText();
  }

  // ---- Release / Lot / Batch creation (Edit page flow) ----

  async openEdit() {
    await this.page.getByRole('button', { name: 'Edit' }).click();
  }

  async createRelease(name, startDay, endDay) {
    await this.page.getByRole('button', { name: 'Create a new Release' }).click();
    await expect(this.page.getByRole('banner')).toContainText('Create a new Release');
    await this.page.getByRole('textbox').first().fill(name);

    await this.page.getByRole('button', { name: 'Choose date' }).first().click();
    await this.page.getByRole('option', { name: String(startDay) }).click(); // VERIFY
    await this.page.getByRole('button', { name: 'OK' }).click();

    await this.page.getByRole('button', { name: 'Choose date' }).click();
    await this.page.getByRole('gridcell', { name: String(endDay) }).click(); // VERIFY
    await this.page.getByRole('button', { name: 'OK' }).click();

    await this.page.getByRole('button', { name: 'Save' }).click();
  }

  async editReleaseDate() {
    await this.page.getByRole('button', { name: 'edit', exact: true }).click();
    await expect(this.page.getByRole('dialog').filter({ hasText: 'Edit Release/Release Name' })).toBeVisible();
    await this.page.getByRole('button', { name: 'Choose date' }).click();
    await this.page.getByRole('button', { name: 'Save' }).click();
  }

  async expandFirstRow() {
    await this.page.getByRole('button', { name: 'expand row' }).first().click();
  }

  async addLot(name) {
    await this.page.getByRole('button', { name: 'add new lot' }).click();
    await expect(this.page.getByRole('heading')).toContainText('Create a new Lot');
    await this.page.getByRole('textbox').first().fill(name);
    await this.page.getByRole('button', { name: 'Save' }).click();
  }

  /** Opens Create Release, leaves the name blank, and returns the validation error text (if any). */
  async attemptCreateReleaseWithNoName() {
    await this.page.getByRole('button', { name: 'Create a new Release' }).click();
    await expect(this.page.getByRole('banner')).toContainText('Create a new Release');
    await this.page.getByRole('button', { name: 'Save' }).click();
    const errorLocator = this.page.locator('[role="alert"], .error-message, .Mui-error'); // VERIFY
    if (await errorLocator.count()) return errorLocator.first().innerText();
    return null;
  }

  async addBatch(codesPerFile) {
    await this.page.getByRole('button', { name: 'expand row' }).click();
    await this.page.getByRole('button', { name: 'add new batch' }).click();
    await expect(this.page.getByRole('heading')).toContainText('Create a new Batch');
    await this.page.getByRole('textbox').first().fill(String(codesPerFile));
    await this.page.getByRole('button', { name: 'Save' }).click();
  }
}

module.exports = { ProgramDetailPage };

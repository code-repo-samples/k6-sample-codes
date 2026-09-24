const { expect } = require('@playwright/test');

/**
 * Program detail page: the Edit-program form, Releases tab (create/edit release,
 * expand -> create/edit lot), and a couple of read helpers for the release
 * accordion's Lots/Batches panels.
 *
 * Every create/edit method returns whatever ID/name got generated, since the
 * journey spec needs to carry those forward (release ID -> lot -> batch -> campaign).
 */
class ProgramDetailPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.releasesTab = page.getByRole('tab', { name: 'Releases' });
    this.campaignsTab = page.getByRole('tab', { name: 'Campaigns' });
    this.searchReleaseInput = page.getByPlaceholder('Search Release by Name or Id');
    this.createNewReleaseBtn = page.getByRole('button', { name: /create new release/i });
    this.editProgramBtn = page.getByRole('button', { name: 'EDIT' });
    this.saveBtn = page.getByRole('button', { name: 'Save' });
  }

  releaseRow(releaseId) {
    return this.page.getByRole('row', { name: new RegExp(releaseId) });
  }

  // ---- Program-level edit ----

  async openEdit() {
    await this.editProgramBtn.click();
  }

  /** Edits arbitrary top-level program fields (only fills what's passed in). */
  async editProgramFields(updates = {}) {
    if (updates.description) {
      await this.page.getByLabel('Program Description').fill(updates.description);
    }
    if (updates.maxValidAttempts) {
      await this.page.getByLabel('Max valid attempts').fill(String(updates.maxValidAttempts));
    }
    await this.saveBtn.click();
  }

  // ---- Release lifecycle ----

  /** Creates a release and returns { releaseId, releaseName }. */
  async createRelease({ name, startDay, endDay }) {
    await this.createNewReleaseBtn.click();
    await expect(this.page.getByRole('banner')).toContainText('Create a new Release');
    await this.page.getByRole('textbox').first().fill(name);

    await this.page.getByRole('button', { name: 'Choose date' }).first().click();
    await this.page.getByRole('option', { name: String(startDay) }).click(); // VERIFY
    await this.page.getByRole('button', { name: 'OK' }).click();

    await this.page.getByRole('button', { name: 'Choose date' }).click();
    await this.page.getByRole('gridcell', { name: String(endDay) }).click(); // VERIFY
    await this.page.getByRole('button', { name: 'OK' }).click();

    await this.page.getByRole('button', { name: 'Save' }).click();

    // Read back the generated Release ID from the newly added row.
    const row = this.releaseRow(name);
    await expect(row).toBeVisible();
    const releaseId = (await row.locator('td').nth(0).innerText()).trim(); // VERIFY: ID column index
    return { releaseId, releaseName: name };
  }

  async editRelease(releaseId, updates = {}) {
    const row = this.releaseRow(releaseId);
    await row.getByRole('button', { name: 'edit', exact: true }).click();
    await expect(this.page.getByRole('dialog').filter({ hasText: /Edit Release/i })).toBeVisible();

    if (updates.endDay) {
      await this.page.getByRole('button', { name: 'Choose date' }).click();
      await this.page.getByRole('gridcell', { name: String(updates.endDay) }).click(); // VERIFY
      await this.page.getByRole('button', { name: 'OK' }).click();
    }

    await this.page.getByRole('button', { name: 'Save' }).click();
  }

  async expandRelease(releaseId) {
    const row = this.releaseRow(releaseId);
    await row.locator('button[aria-expanded]').click(); // VERIFY: chevron/expand toggle
    await expect(row.locator('button[aria-expanded="true"]')).toBeVisible();
  }

  // ---- Lot lifecycle (inside an expanded release) ----

  /** Creates a lot under the currently expanded release and returns the generated Lot ID. */
  async addLot({ releaseId, name }) {
    const panel = this.page.locator(`[data-release-id="${releaseId}"]`); // VERIFY: real container attribute
    await panel.getByRole('button', { name: 'add new lot' }).click();
    await expect(this.page.getByRole('heading')).toContainText('Create a new Lot');
    await this.page.getByRole('textbox').first().fill(name);
    await this.page.getByRole('button', { name: 'Save' }).click();

    const lotRow = panel.getByRole('row', { name: new RegExp(name) });
    await expect(lotRow).toBeVisible();
    const lotId = (await lotRow.locator('td').nth(0).innerText()).trim(); // VERIFY: ID column index
    return lotId;
  }

  async editLot(lotId, updates = {}) {
    const row = this.page.getByRole('row', { name: new RegExp(lotId) });
    await row.getByRole('button', { name: 'edit', exact: true }).click();
    await expect(this.page.getByRole('dialog').filter({ hasText: /Edit Lot/i })).toBeVisible();

    if (updates.name) {
      await this.page.getByRole('textbox').first().fill(updates.name);
    }
    await this.page.getByRole('button', { name: 'Save' }).click();
  }

  // ---- Read helpers ----

  async getLotDetails(releaseId) {
    const panel = this.page.locator(`[data-release-id="${releaseId}"] >> text=Lots`).locator('..');
    return {
      name: await panel.locator('text=Name:').innerText(),
      allotedCodes: await panel.locator('text=Alloted codes:').innerText(),
    };
  }

  /** Attempt (negative test): create a release with a blank name, return validation error text. */
  async attemptCreateReleaseWithNoName() {
    await this.createNewReleaseBtn.click();
    await expect(this.page.getByRole('banner')).toContainText('Create a new Release');
    await this.page.getByRole('button', { name: 'Save' }).click();
    const errorLocator = this.page.locator('[role="alert"], .error-message, .Mui-error'); // VERIFY
    if (await errorLocator.count()) return errorLocator.first().innerText();
    return null;
  }
}

module.exports = { ProgramDetailPage };

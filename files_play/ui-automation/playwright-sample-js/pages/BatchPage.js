const { expect } = require('@playwright/test');

/**
 * Batch creation under a Lot, including selecting the mapped Organization ID
 * and Promotion (both parameter-driven from test-data/test-config.json), and
 * triggering + polling the async code-generation job (mirrors the
 * CODEGEN_COMPLETE state seen on the release detail screen).
 */
class BatchPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.organizationDropdown = page.getByLabel('Organization'); // VERIFY: exact label
    this.promotionDropdown = page.getByLabel('Promotion'); // VERIFY: exact label
    this.codesPerFileInput = page.getByLabel('Codes per file'); // VERIFY: exact label
    this.saveBtn = page.getByRole('button', { name: 'Save' });
    this.generateCodesIcon = page.getByRole('button', { name: /generate codes/i }); // VERIFY: icon's accessible name
  }

  /**
   * Creates a batch under the given lot, selecting organizationId and
   * promotionName from the parameter file rather than hardcoding them.
   * Returns the generated Batch ID.
   */
  async createBatch({ lotId, organizationId, promotionName, codesPerFile }) {
    const lotPanel = this.page.locator(`[data-lot-id="${lotId}"]`); // VERIFY: real container attribute
    await lotPanel.getByRole('button', { name: 'add new batch' }).click();
    await expect(this.page.getByRole('heading')).toContainText('Create a new Batch');

    await this.organizationDropdown.click();
    await this.page.getByRole('option', { name: organizationId }).click();

    await this.promotionDropdown.click();
    await this.page.getByRole('option', { name: promotionName }).click();

    await this.codesPerFileInput.fill(String(codesPerFile));
    await this.saveBtn.click();

    const batchRow = lotPanel.getByRole('row', { name: new RegExp(organizationId) });
    await expect(batchRow).toBeVisible();
    const batchId = (await batchRow.locator('td').nth(0).innerText()).trim(); // VERIFY: ID column index
    return batchId;
  }

  /** Clicks the code-generation trigger icon for a given batch. */
  async triggerCodeGeneration(batchId) {
    const batchRow = this.page.getByRole('row', { name: new RegExp(batchId) });
    await batchRow.locator(this.generateCodesIcon).click(); // VERIFY: icon scoped to the row
  }

  /**
   * Polls the batch/release status cell until it reads CODEGEN_COMPLETE
   * (matches the "State" column seen on the release detail screen), or times out.
   */
  async waitForCodeGenComplete(batchId, timeoutMs = 30_000) {
    const statusCell = this.page
      .getByRole('row', { name: new RegExp(batchId) })
      .getByText(/CODEGEN_COMPLETE|CODEGEN_FAILED|CODEGEN_IN_PROGRESS/);

    await expect(statusCell).toHaveText('CODEGEN_COMPLETE', { timeout: timeoutMs });
  }
}

module.exports = { BatchPage };

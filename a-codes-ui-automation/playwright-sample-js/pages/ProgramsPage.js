const { expect } = require('@playwright/test');

class ProgramsPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.createNewBtn = page.getByRole('button', { name: /create new/i });
    this.rows = page.locator('table tbody tr');
  }

  async goto() {
    await this.page.goto('/programs');
    await expect(this.page.getByRole('heading', { name: 'Programs' })).toBeVisible();
  }

  async openCreateNewProgram() {
    await this.createNewBtn.click();
  }

  async openProgramByName(name) {
    await this.page.getByRole('row', { name: new RegExp(name) }).click();
  }

  async rowCount() {
    return this.rows.count();
  }

  /**
   * Reads the generated Program ID from the list row matching `name`.
   * Based on the Programs table layout: ID is the first column, Name the second.
   */
  async getProgramIdByName(name) {
    const row = this.page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    const idCell = row.locator('td').first(); // VERIFY: ID column index
    return (await idCell.innerText()).trim();
  }
}

module.exports = { ProgramsPage };

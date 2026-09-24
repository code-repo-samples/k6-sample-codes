const { expect } = require('@playwright/test');

class CampaignsPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.campaignsTab = page.getByRole('tab', { name: 'Campaigns' });
    this.createNewCampaignBtn = page.getByRole('button', { name: 'Create New Campaign' });
    this.chooseDateBtn = page.getByRole('button', { name: 'Choose date' });
    this.okBtn = page.getByRole('button', { name: 'OK' });
    this.saveBtn = page.getByRole('button', { name: 'Save' });
  }

  async openTab() {
    await this.campaignsTab.click();
  }

  /** Creates a campaign and returns { campaignId, viralCode }. */
  async createCampaign({ name, day }) {
    await this.createNewCampaignBtn.click();
    await this.page.getByRole('textbox').first().fill(name); // VERIFY: campaign name field

    await this.chooseDateBtn.click();
    await this.page.getByRole('gridcell', { name: String(day) }).click(); // VERIFY: exact day
    await this.okBtn.click();

    await this.saveBtn.click();

    const row = this.page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    const campaignId = (await row.locator('td').first().innerText()).trim(); // VERIFY: ID column index
    const viralCode = await this.getViralCode(campaignId);

    return { campaignId, viralCode };
  }

  async editCampaign(campaignId, updates = {}) {
    const row = this.page.getByRole('row', { name: new RegExp(campaignId) });
    await row.getByRole('button', { name: 'edit', exact: true }).click();
    await expect(this.page.getByRole('dialog').filter({ hasText: /Edit Campaign/i })).toBeVisible();

    if (updates.name) {
      await this.page.getByRole('textbox').first().fill(updates.name);
    }
    await this.page.getByRole('button', { name: 'Save' }).click();
  }

  /** Reads the generated "viral code" for a campaign off its row/detail panel. */
  async getViralCode(campaignId) {
    const row = this.page.getByRole('row', { name: new RegExp(campaignId) });
    const codeCell = row.getByTestId('viral-code'); // VERIFY: real selector for the code column/cell
    return (await codeCell.innerText()).trim();
  }
}

module.exports = { CampaignsPage };

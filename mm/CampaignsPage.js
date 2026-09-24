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

  async createCampaign(name, day) {
    await this.createNewCampaignBtn.click();
    await this.page.getByRole('textbox').first().fill(name); // VERIFY: campaign name field

    await this.chooseDateBtn.click();
    await this.page.getByRole('gridcell', { name: String(day) }).click(); // VERIFY: exact day
    await this.okBtn.click();

    await this.saveBtn.click();
  }
}

module.exports = { CampaignsPage };

const { expect } = require('@playwright/test');

class DownloadCodesPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.downloadCodesLink = page.getByRole('link', { name: 'Download Codes' });
    this.publicKeyLink = page.getByRole('link', { name: 'Public Key' });
  }

  async downloadCodes() {
    const downloadPromise = this.page.waitForEvent('download');
    await this.downloadCodesLink.click();
    const download = await downloadPromise;
    return download;
  }

  async expectFilenameMatches(download, pattern) {
    expect(download.suggestedFilename()).toMatch(pattern);
  }

  async openPublicKey() {
    await this.publicKeyLink.click();
  }
}

module.exports = { DownloadCodesPage };

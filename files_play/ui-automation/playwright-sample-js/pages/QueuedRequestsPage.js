const { expect } = require('@playwright/test');

class QueuedRequestsPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
  }

  async expectOnPage() {
    await expect(this.page.getByRole('main')).toContainText('Queued Requests');
  }

  async expectEntryContains(text) {
    // VERIFY: exact row text, e.g. "Update PS3 Public Key File"
    await expect(this.page.getByRole('main')).toContainText(text);
  }
}

module.exports = { QueuedRequestsPage };

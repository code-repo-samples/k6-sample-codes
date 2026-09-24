const { expect } = require('@playwright/test');

class RealTimeTestPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
  }

  async expectOnPage() {
    await expect(this.page.getByRole('navigation')).toContainText('Real Time Test');
  }
}

module.exports = { RealTimeTestPage };

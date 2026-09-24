class NavigationBar {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
  }

  async goTo(linkName) {
    await this.page.getByRole('link', { name: linkName }).click();
  }

  async logout() {
    await this.page.getByRole('link', { name: 'Logout' }).click();
  }
}

module.exports = { NavigationBar };

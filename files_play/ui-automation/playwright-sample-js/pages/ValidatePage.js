const { expect } = require('@playwright/test');

class ValidatePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.selectProgramBtn = page.getByRole('button', { name: 'Select Program' });
    this.codeInput = page.getByRole('textbox', { name: 'Enter code' });
    this.validateCodeBtn = page.getByRole('button', { name: 'Validate Code' });
  }

  async expectOnPage() {
    await expect(this.page.getByRole('navigation')).toContainText('Validate');
  }

  async selectProgram(programName) {
    await this.selectProgramBtn.click();
    await this.page.getByRole('option', { name: programName }).click();
  }

  async validateCode(code) {
    await this.codeInput.fill(code);
    await this.validateCodeBtn.click();
  }

  async expectResultContains(text) {
    await expect(this.page.getByRole('main')).toContainText(text);
  }
}

module.exports = { ValidatePage };

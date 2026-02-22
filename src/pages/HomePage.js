import { BasePage } from './BasePage.js';

export class HomePage extends BasePage {
  constructor(page) {
    super(page);
    this.accountDropdown = page.locator('[data-test="account-dropdown-button"]');
  }

  async goto() {
    await this.page.goto('https://www.ocado.com/', { waitUntil: 'domcontentloaded' });
  }

  async isAuthenticated() {
    try {
      await this.accountDropdown.first().waitFor({ timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}
